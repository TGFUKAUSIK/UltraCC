-- ---------------------------------------------------------------------------
-- Background push notifications (2026-09-15).
--
-- WHY: local notifications only fire while UltraCC is open. Class reminders and
-- LMS quiz windows need to reach a student whose browser is closed, which is
-- only possible with a real Web Push subscription held server-side.
--
-- MODEL (privacy first — this table never holds VTOP data or credentials):
--   * A browser subscribes with its own PushSubscription (endpoint + keys).
--   * The app uploads a REMINDER PLAN it already computed locally: absolute
--     epoch seconds plus the title/body/url to show. No timetable, no marks,
--     no registration number, no password ever reaches this table.
--   * `device_code` is an unguessable per-browser capability token (the same
--     model as Cab Share). It is the only key to the row and can be rotated by
--     simply toggling notifications off and on.
--   * RLS is deny-all: every read/write goes through the SECURITY DEFINER
--     functions below, so a leaked anon key still cannot enumerate endpoints.
--   * `claim_due_pushes` is dispatcher-only (service role); it is explicitly
--     revoked from anon/authenticated — otherwise anyone could stream every
--     subscriber's endpoint and key.
--
-- Delivery is idempotent: a claimed reminder id is recorded in push_sent, so
-- overlapping dispatcher runs can never double-notify a student.
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  device_code text not null unique,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  -- [{ id, at (epoch seconds, UTC), title, body, url, tag? }, …]
  reminders   jsonb not null default '[]'::jsonb,
  locale      text,
  user_agent  text,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.push_sent (
  device_code text not null,
  reminder_id text not null,
  sent_at     timestamptz not null default now(),
  primary key (device_code, reminder_id)
);

create index if not exists push_sent_sent_at_idx on public.push_sent (sent_at);

alter table public.push_subscriptions enable row level security;
alter table public.push_sent enable row level security;
-- No policies on purpose: SECURITY DEFINER functions are the only way in.
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_sent from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Client-facing RPCs (own device code only)
-- ---------------------------------------------------------------------------

/** Save or replace this device's subscription together with its reminder plan. */
create or replace function public.upsert_push_subscription(
  p_device_code text,
  p_endpoint    text,
  p_p256dh      text,
  p_auth        text,
  p_reminders   jsonb default '[]'::jsonb,
  p_locale      text default null,
  p_user_agent  text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device_code is null or length(trim(p_device_code)) < 16 then
    raise exception 'PUSH_INVALID_DEVICE';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' then
    raise exception 'PUSH_INVALID_ENDPOINT';
  end if;
  if coalesce(length(trim(p_p256dh)), 0) < 40 or coalesce(length(trim(p_auth)), 0) < 8 then
    raise exception 'PUSH_INVALID_KEYS';
  end if;

  insert into public.push_subscriptions as s
    (device_code, endpoint, p256dh, auth, reminders, locale, user_agent, enabled, updated_at)
  values
    (p_device_code, p_endpoint, p_p256dh, p_auth, coalesce(p_reminders, '[]'::jsonb), p_locale, p_user_agent, true, now())
  on conflict (device_code) do update
    set endpoint   = excluded.endpoint,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        reminders  = excluded.reminders,
        locale     = coalesce(excluded.locale, s.locale),
        user_agent = coalesce(excluded.user_agent, s.user_agent),
        enabled    = true,
        updated_at = now();
  return true;
end;
$$;

/**
 * Refresh only the reminder plan (every sync does this). Keeps the existing
 * subscription keys so the user never has to re-grant permission.
 */
create or replace function public.sync_push_reminders(
  p_device_code text,
  p_reminders   jsonb default '[]'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_subscriptions
     set reminders = coalesce(p_reminders, '[]'::jsonb),
         updated_at = now()
   where device_code = p_device_code
     and enabled;
  return found;
end;
$$;

/** Toggle off / forget this device. The row is removed, not just disabled. */
create or replace function public.delete_push_subscription(p_device_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_sent where device_code = p_device_code;
  delete from public.push_subscriptions where device_code = p_device_code;
  return found;
end;
$$;

/** Masked server-side status for the settings UI (no keys, ever). */
create or replace function public.get_push_subscription(p_device_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.push_subscriptions%rowtype;
begin
  if p_device_code is null or length(trim(p_device_code)) < 16 then
    return jsonb_build_object('registered', false);
  end if;
  select * into v_row from public.push_subscriptions where device_code = p_device_code;
  if v_row.id is null then
    return jsonb_build_object('registered', false);
  end if;
  return jsonb_build_object(
    'registered', true,
    'enabled', v_row.enabled,
    'reminders', coalesce(jsonb_array_length(v_row.reminders), 0),
    'updatedAt', v_row.updated_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Dispatcher RPC (service role only)
-- ---------------------------------------------------------------------------

/**
 * Atomically claim every reminder that is due now and return what to send.
 *
 * A reminder is due when its `at` (epoch seconds, UTC) is inside
 * [now - p_grace_seconds, now + p_window_seconds]. Claiming inserts into
 * push_sent, so two dispatcher runs racing each other still deliver once.
 */
create or replace function public.claim_due_pushes(
  p_window_seconds int default 90,
  p_grace_seconds  int default 3600
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    bigint := extract(epoch from now())::bigint;
  v_result jsonb;
begin
  -- Reminder ids never repeat, so claims older than two weeks are dead weight.
  delete from public.push_sent where sent_at < now() - interval '14 days';

  with due as (
    select distinct on (s.device_code, e.value->>'id')
           s.device_code, s.endpoint, s.p256dh, s.auth, e.value as reminder
      from public.push_subscriptions s
      cross join lateral jsonb_array_elements(s.reminders) as e(value)
     where s.enabled
       and (e.value->>'at') ~ '^[0-9]{9,12}$'
       and (e.value->>'at')::bigint between v_now - p_grace_seconds and v_now + p_window_seconds
     order by s.device_code, e.value->>'id'
  ),
  claimed as (
    insert into public.push_sent (device_code, reminder_id)
    select d.device_code, d.reminder->>'id' from due d
    on conflict (device_code, reminder_id) do nothing
    returning device_code, reminder_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'deviceCode', c.device_code,
           'endpoint',   d.endpoint,
           'p256dh',     d.p256dh,
           'auth',       d.auth,
           'reminder',   d.reminder
         )), '[]'::jsonb)
    into v_result
  from claimed c
  join due d
    on d.device_code = c.device_code
   and d.reminder->>'id' = c.reminder_id;

  return v_result;
end;
$$;

-- The anon key must never be able to stream subscribers' endpoints and keys.
revoke execute on function public.claim_due_pushes(int, int) from public;
revoke execute on function public.claim_due_pushes(int, int) from anon;
revoke execute on function public.claim_due_pushes(int, int) from authenticated;
grant execute on function public.claim_due_pushes(int, int) to service_role;

grant execute on function public.upsert_push_subscription(text, text, text, text, jsonb, text, text) to anon, authenticated;
grant execute on function public.sync_push_reminders(text, jsonb) to anon, authenticated;
grant execute on function public.delete_push_subscription(text) to anon, authenticated;
grant execute on function public.get_push_subscription(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Optional: call the dispatcher every minute with pg_cron + pg_net.
--
-- Supabase → Integrations → Cron can schedule the edge function from the
-- dashboard instead. If you prefer SQL, uncomment and fill in your project ref
-- plus a shared secret you also set on the function (CRON_SECRET):
--
-- select cron.schedule(
--   'push-dispatch',
--   '* * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/push-dispatch',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secret', '<same value as CRON_SECRET>'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
