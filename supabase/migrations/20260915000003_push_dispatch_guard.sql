-- ---------------------------------------------------------------------------
-- Push dispatcher guard + health (2026-09-15).
--
-- WHY
-- The dispatcher is an HTTP endpoint. Left open, anyone who reads the public
-- repo could hammer it and burn the project's function quota — and a shared
-- secret baked into a migration would be committed to git. So the secret is
-- GENERATED INSIDE THE DATABASE, never written down anywhere:
--
--   * public.push_cron_config holds one random 32-byte secret. RLS is deny-all
--     and it is never granted to anon: only the SECURITY DEFINER function below
--     (service-role callers) can read it.
--   * The pg_cron job (migration ...0004) passes that secret in the
--     `x-cron-secret` header, reading it from this table at every run.
--   * The edge function verifies the caller's value with
--     authorize_push_dispatch() — so the secret never reaches the repository,
--     the function's environment, or a log.
--
-- public.push_dispatch_runs is the honest answer to "is background delivery
-- actually alive?": every run records whether it was authorized and what it
-- claimed/sent. Settings reads the latest authorized run through
-- push_dispatch_health(), so a student sees real evidence instead of a
-- toggle that merely claims to be on.
-- ---------------------------------------------------------------------------

create table if not exists public.push_cron_config (
  id         boolean primary key default true check (id),
  -- 256 bits of randomness from core gen_random_uuid() (two v4 UUIDs, dashes
  -- stripped) so this needs no extension: pgcrypto's gen_random_bytes lives in
  -- the extensions schema on Supabase and is not on the search path here.
  secret     text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

-- Exactly one row, with a generated secret. Re-running never rotates it.
insert into public.push_cron_config (id) values (true)
on conflict (id) do nothing;

alter table public.push_cron_config enable row level security;
revoke all on public.push_cron_config from anon, authenticated;
-- No policies: the function below is the only way to touch it.

create table if not exists public.push_dispatch_runs (
  id         bigint generated always as identity primary key,
  ran_at     timestamptz not null default now(),
  authorized boolean not null,
  claimed    int not null default 0,
  sent       int not null default 0,
  failed     int not null default 0
);

create index if not exists push_dispatch_runs_ran_at_idx
  on public.push_dispatch_runs (ran_at desc);

alter table public.push_dispatch_runs enable row level security;
revoke all on public.push_dispatch_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dispatcher-side RPCs (service role only)
-- ---------------------------------------------------------------------------

/**
 * Compare a caller-supplied secret with the generated one.
 *
 * Only the service role may execute this, so the value cannot be probed or
 * brute-forced through the public API: an attacker calling the edge function
 * gets a plain 401 and learns nothing.
 */
create or replace function public.authorize_push_dispatch(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  if p_secret is null or length(p_secret) < 16 then
    return false;
  end if;
  select secret into v_expected from public.push_cron_config limit 1;
  if v_expected is null then
    return false;
  end if;
  return p_secret = v_expected;
end;
$$;

/**
 * Record one dispatcher run.
 *
 * Unauthorized attempts are collapsed to at most one row per minute, so a spam
 * campaign cannot turn this into a write amplifier. History is trimmed to a
 * week — health only cares about "recently, and did it work".
 */
create or replace function public.record_push_dispatch_run(
  p_authorized boolean,
  p_claimed    int default 0,
  p_sent       int default 0,
  p_failed     int default 0
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not p_authorized and exists (
    select 1 from public.push_dispatch_runs
     where not authorized and ran_at > now() - interval '1 minute'
  ) then
    return false;
  end if;

  insert into public.push_dispatch_runs (authorized, claimed, sent, failed)
  values (coalesce(p_authorized, false), coalesce(p_claimed, 0), coalesce(p_sent, 0), coalesce(p_failed, 0));

  delete from public.push_dispatch_runs where ran_at < now() - interval '7 days';
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Client-facing health RPC (masked: timings and counts, never secrets)
-- ---------------------------------------------------------------------------

/**
 * What the deployment can honestly report about background delivery:
 *   { lastRunAt, claimed, sent, failed, deliveryActive }
 *
 * `deliveryActive` is false when no authorized run has ever been recorded,
 * which is exactly the case where the toggle would otherwise lie.
 */
create or replace function public.push_dispatch_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.push_dispatch_runs%rowtype;
begin
  select * into v_run
    from public.push_dispatch_runs
   where authorized
   order by ran_at desc
   limit 1;

  if v_run.id is null then
    return jsonb_build_object('deliveryActive', false, 'lastRunAt', null);
  end if;

  return jsonb_build_object(
    'deliveryActive', v_run.ran_at > now() - interval '10 minutes',
    'lastRunAt', v_run.ran_at,
    'claimed', v_run.claimed,
    'sent', v_run.sent,
    'failed', v_run.failed
  );
end;
$$;

grant execute on function public.authorize_push_dispatch(text) to service_role;
grant execute on function public.record_push_dispatch_run(boolean, int, int, int) to service_role;
grant execute on function public.push_dispatch_health() to anon, authenticated;

-- The anon key must never be able to read the generated secret or trip the
-- dispatcher without knowing it.
revoke execute on function public.authorize_push_dispatch(text) from public, anon, authenticated;
revoke execute on function public.record_push_dispatch_run(boolean, int, int, int) from public, anon, authenticated;

notify pgrst, 'reload schema';
