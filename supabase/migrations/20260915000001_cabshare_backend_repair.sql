-- ---------------------------------------------------------------------------
-- Cab Share backend repair (2026-09-15).
--
-- WHY THIS EXISTS
-- The live deployment is in a mixed state: 20260908000001 (retire OTP) never
-- completed. Observed on the deployed project:
--   * The insert gate still raises PHONE_VERIFICATION_REQUIRED, so no ride can
--     be posted at all.
--   * public.set_phone_identity(text, text) does not exist, while the legacy
--     public.request_phone_otp(text, text) survived — saving a contact number
--     therefore fails with a PostgREST schema-cache error.
--   * public.get_phone_identity(text) still answers with the retired
--     { "verified": ... } shape instead of { saved, last4, hideNumber }.
-- Net effect: students can read the board but can neither save a number, post,
-- nor join. The client is correct; the schema is behind.
--
-- WHAT THIS DOES (defensive on purpose — every step is idempotent and safe on
-- a project that already applied 20260908000001 cleanly):
--   1. Ensures cabshare_identities exists in its OTP-free shape.
--   2. Removes any insert gate on cabshare_rides that still demands a verified
--      poster (trigger is found by catalog lookup, not by guessed name).
--   3. Installs the registered-device gate: a device with a saved contact
--      number may post/join; verification does not exist.
--   4. Drops every overload of the OTP lifecycle functions and the ephemeral
--      challenge table. Drops are exception-safe so one stubborn legacy object
--      can never abort the repair.
--   5. Drops the verification-only columns (their data is already unused).
--   6. Re-creates the OTP-free RPCs the app calls, with the exact signatures
--      the client expects, plus the matching EXECUTE grants.
--
-- No ride/member data is touched, and no new feature is introduced.
-- ---------------------------------------------------------------------------

-- 1. Identity table (per-device contact number, deny-all + SECURITY DEFINER).
create table if not exists public.cabshare_identities (
  id          bigint generated always as identity primary key,
  device_code text not null unique,
  phone_e164  text,
  phone_last4 text,
  hide_number boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.cabshare_identities
  add column if not exists phone_e164  text,
  add column if not exists phone_last4 text,
  add column if not exists hide_number boolean not null default false,
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now();

alter table public.cabshare_identities enable row level security;
-- No policies on purpose. RPCs below are the only read/write path.
revoke all on public.cabshare_identities from anon, authenticated;

-- 2. Remove every non-internal trigger on cabshare_rides except our own gate.
--    (The retired verified-poster gate is the only other trigger that exists.)
do $$
declare
  trg record;
begin
  for trg in
    select t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'cabshare_rides'
       and not t.tgisinternal
       and t.tgname <> 'cabshare_rides_registered_poster'
  loop
    execute format('drop trigger if exists %I on public.cabshare_rides', trg.tgname);
    raise notice 'cabshare repair: dropped legacy trigger % on cabshare_rides', trg.tgname;
  end loop;
end;
$$;

drop function if exists public.enforce_verified_poster();

-- 3. Registered-device gate: a saved contact number is required to post, and
--    nothing else. Anonymity on the public board is unchanged — the number is
--    never displayed; only mutual confirmation can exchange it.
create or replace function public.enforce_registered_poster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.poster_device_code is null or length(trim(new.poster_device_code)) < 16 then
    raise exception 'PHONE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.cabshare_identities
     where device_code = new.poster_device_code
       and phone_e164 is not null
  ) then
    raise exception 'PHONE_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists cabshare_rides_registered_poster on public.cabshare_rides;
create trigger cabshare_rides_registered_poster
  before insert on public.cabshare_rides
  for each row execute function public.enforce_registered_poster();

-- 4. Retire the OTP era. Every overload is found via pg_proc and dropped by its
--    exact identity, so a signature mismatch can never skip or abort.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as identity
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'assert_otp_send_rate', 'begin_phone_otp', 'verify_phone_otp', 'request_phone_otp'
       )
  loop
    begin
      execute format('drop function if exists %s', fn.identity);
      raise notice 'cabshare repair: dropped legacy function %', fn.identity;
    exception when others then
      raise warning 'cabshare repair: could not drop legacy function % (%) — unused by the client, review manually', fn.identity, sqlerrm;
    end;
  end loop;
end;
$$;

drop table if exists public.cabshare_phone_otps;

-- 5. Verification state is gone. Column drops are guarded so a leftover
--    dependency reports a warning instead of aborting the repair.
do $$
begin
  alter table public.cabshare_identities
    drop column if exists pending_phone_e164;
  alter table public.cabshare_identities
    drop column if exists phone_verified;
  alter table public.cabshare_identities
    drop column if exists verified_at;
exception when others then
  raise warning 'cabshare repair: verification columns were not dropped (%) — they are unused by the client', sqlerrm;
end;
$$;

-- 6. OTP-free RPCs (self-declared number, no verification, no SMS).
create or replace function public.set_phone_identity(p_device_code text, p_phone_e164 text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device_code is null or length(trim(p_device_code)) < 16 then
    raise exception 'PHONE_INVALID_DEVICE';
  end if;
  if p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9]\d{7,14}$' then
    raise exception 'PHONE_INVALID_NUMBER';
  end if;
  insert into public.cabshare_identities (device_code, phone_e164, phone_last4)
  values (p_device_code, p_phone_e164, right(p_phone_e164, 4))
  on conflict (device_code) do update
    set phone_e164  = excluded.phone_e164,
        phone_last4 = excluded.phone_last4,
        updated_at  = now();
  return true;
end;
$$;

-- Masked identity status. Never returns the full number, and honestly has no
-- "verified" flag any more.
create or replace function public.get_phone_identity(p_device_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cabshare_identities%rowtype;
begin
  if p_device_code is null or length(trim(p_device_code)) < 16 then
    return jsonb_build_object('saved', false);
  end if;
  select * into v_row from public.cabshare_identities where device_code = p_device_code;
  if v_row.id is null or v_row.phone_e164 is null then
    return jsonb_build_object('saved', false);
  end if;
  return jsonb_build_object(
    'saved', true,
    'last4', v_row.phone_last4,
    'hideNumber', v_row.hide_number
  );
end;
$$;

create or replace function public.set_phone_visibility(p_device_code text, p_hide boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cabshare_identities
     set hide_number = coalesce(p_hide, false),
         updated_at  = now()
   where device_code = p_device_code
     and phone_e164 is not null;
  return found;
end;
$$;

create or replace function public.revoke_phone(p_device_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cabshare_identities
     set phone_e164 = null,
         phone_last4 = null,
         updated_at = now()
   where device_code = p_device_code;
  return found;
end;
$$;

-- The pre-OTP 2-arg join (no registered-device check) must not survive.
drop function if exists public.join_cabride_with_member(bigint, text);

create or replace function public.join_cabride_with_member(p_ride_id bigint, p_member_code text, p_device_code text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats int;
  v_identity public.cabshare_identities%rowtype;
  v_ride public.cabshare_rides%rowtype;
  v_conflicts int;
begin
  if p_member_code is null or length(trim(p_member_code)) < 16 then
    return false;
  end if;
  if p_device_code is null or length(trim(p_device_code)) < 16 then
    raise exception 'PHONE_REQUIRED';
  end if;
  select * into v_identity from public.cabshare_identities where device_code = p_device_code;
  if v_identity.id is null or v_identity.phone_e164 is null then
    raise exception 'PHONE_REQUIRED';
  end if;

  select * into v_ride from public.cabshare_rides where id = p_ride_id for update;
  if v_ride.id is null then return false; end if;

  -- One contact number cannot hold seats on two open rides whose windows
  -- overlap (same date, within a 3-hour band).
  select count(*) into v_conflicts
    from public.cabshare_members m
    join public.cabshare_rides r on r.id = m.ride_id
   where m.identity_id = v_identity.id
     and m.ride_id <> p_ride_id
     and r.travel_date = v_ride.travel_date
     and abs(extract(epoch from (r.travel_time::time - v_ride.travel_time::time))) < 3 * 3600
     and r.seats_left > 0
     and r.travel_date >= to_char(now(), 'YYYY-MM-DD');
  if v_conflicts > 0 then
    raise exception 'RIDE_TIME_CONFLICT';
  end if;

  select seats_left into v_seats from public.cabshare_rides where id = p_ride_id;
  if exists (select 1 from public.cabshare_members where ride_id = p_ride_id and member_code = p_member_code) then
    return true;
  end if;
  if v_seats <= 0 then return false; end if;
  insert into public.cabshare_members (ride_id, member_code, identity_id)
  values (p_ride_id, p_member_code, v_identity.id);
  update public.cabshare_rides
     set seats_left = seats_left - 1,
         participant_count = participant_count + 1
   where id = p_ride_id;
  return true;
end;
$$;

-- Poster-only rider list: codes, confirmation state and a masked fragment.
create or replace function public.list_ride_members(p_ride_id bigint, p_poster_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid boolean;
begin
  select exists (
    select 1 from public.cabshare_rides
     where id = p_ride_id and poster_code = p_poster_code
  ) into v_valid;
  if not v_valid then
    return jsonb_build_object('status', 'forbidden', 'members', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'members', coalesce(jsonb_agg(jsonb_build_object(
      'memberCode', m.member_code,
      'posterConfirmed', m.poster_confirmed,
      'joinedAt', m.created_at,
      'last4', i.phone_last4
    ) order by m.created_at), '[]'::jsonb)
  )
  from public.cabshare_members m
  left join public.cabshare_identities i on i.id = m.identity_id
  where m.ride_id = p_ride_id;
end;
$$;

-- Contact exchange: only after mutual confirmation, and only when the
-- counterparty has not hidden their number.
create or replace function public.reveal_member_contact(p_ride_id bigint, p_code text, p_member_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.cabshare_rides%rowtype;
  v_member public.cabshare_members%rowtype;
  v_other public.cabshare_identities%rowtype;
begin
  select * into v_ride from public.cabshare_rides where id = p_ride_id;
  if v_ride.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_member from public.cabshare_members
   where ride_id = p_ride_id and member_code = p_member_code;
  if v_member.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_ride.poster_code = p_code then
    if not v_member.poster_confirmed then
      return jsonb_build_object('status', 'needs_confirmation');
    end if;
    if v_member.identity_id is null then
      return jsonb_build_object('status', 'unavailable');
    end if;
    select * into v_other from public.cabshare_identities where id = v_member.identity_id;
  elsif v_member.member_code = p_code then
    if not v_member.poster_confirmed then
      return jsonb_build_object('status', 'awaiting_confirmation');
    end if;
    select * into v_other from public.cabshare_identities
     where device_code = v_ride.poster_device_code;
  else
    return jsonb_build_object('status', 'forbidden');
  end if;

  if v_other.id is null or v_other.phone_e164 is null then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_other.hide_number then
    return jsonb_build_object('status', 'hidden', 'masked', '•••• ' || coalesce(v_other.phone_last4, '••••'));
  end if;
  return jsonb_build_object('status', 'ok', 'phone', v_other.phone_e164);
end;
$$;

-- 7. Grants for the anon client (idempotent).
grant execute on function public.set_phone_identity(text, text) to anon, authenticated;
grant execute on function public.get_phone_identity(text) to anon, authenticated;
grant execute on function public.set_phone_visibility(text, boolean) to anon, authenticated;
grant execute on function public.revoke_phone(text) to anon, authenticated;
grant execute on function public.join_cabride_with_member(bigint, text, text) to anon, authenticated;
grant execute on function public.leave_cabride(bigint, text) to anon, authenticated;
grant execute on function public.confirm_ride_member(bigint, text, text) to anon, authenticated;
grant execute on function public.list_ride_members(bigint, text) to anon, authenticated;
grant execute on function public.reveal_member_contact(bigint, text, text) to anon, authenticated;
grant execute on function public.delete_cabride(bigint, text) to anon, authenticated;

-- 8. Capability codes must not be world-readable.
--
-- Both community boards are read straight from the REST API with the public
-- anon key. A table-wide SELECT grant therefore let anyone list every
-- listing's poster_code (and poster_device_code on rides) — the only secret
-- protecting a post — and then delete or manage other students' entries.
-- Anonymous reads are narrowed to the columns the app actually displays.
-- The client posts with `Prefer: return=minimal`, so no RETURNING clause needs
-- the withheld columns.
do $$
begin
  revoke select on public.cabshare_rides from anon, authenticated;
  grant select (id, from_place, to_place, travel_date, travel_time, seats, seats_left,
                participant_count, notes, contact, created_at)
    on public.cabshare_rides to anon, authenticated;
  raise notice 'cabshare repair: cabshare_rides reads narrowed to public columns';
exception when others then
  raise warning 'cabshare repair: could not narrow cabshare_rides grants (%)', sqlerrm;
end;
$$;

do $$
begin
  revoke select on public.qbank_papers from anon, authenticated;
  grant select (id, course_code, course_title, exam_type, title, url, uploaded_by, created_at)
    on public.qbank_papers to anon, authenticated;
  raise notice 'cabshare repair: qbank_papers reads narrowed to public columns';
exception when others then
  raise warning 'cabshare repair: could not narrow qbank_papers grants (%)', sqlerrm;
end;
$$;

-- Ask PostgREST to pick up the new function signatures immediately.
notify pgrst, 'reload schema';
