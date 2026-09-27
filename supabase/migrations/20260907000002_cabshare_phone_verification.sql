-- ---------------------------------------------------------------------------
-- Cab Share phone verification + contact privacy.
--
-- Model: UltraCC Cab Share is accountless (capability tokens). Verified phone
-- numbers need a durable identity that is NOT the ride board. This migration
-- adds:
--
--   cabshare_identities  — one row per browser device_code. Stores the E.164
--                          phone, a last-4 display fragment, verification
--                          state and the "hide my number" preference.
--   cabshare_phone_otps  — short-lived OTP challenges. Only the SHA-256 hash
--                          of the code is stored; plaintext OTPs never touch
--                          the database.
--
-- PRIVACY RULES (enforced in SQL, not just UI):
--   * Both tables have RLS enabled with ZERO policies — anon/authenticated
--     clients cannot SELECT or modify rows directly. Every access goes
--     through SECURITY DEFINER RPCs that implement the rules below.
--   * Unverified numbers are never exposed: reveal paths require
--     phone_verified = true.
--   * Ride participants never see phone numbers before mutual confirmation:
--     the poster must confirm the rider (poster_confirmed) — joining alone
--     is only the rider's half of the confirmation.
--   * "Hide my number" hides the number even after confirmation (the other
--     party sees a masked fragment).
--   * OTP rate limits (send + verify) live in the DB, so they hold no
--     matter which client calls.
-- ---------------------------------------------------------------------------

-- pgcrypto provides digest() for OTP hashing.
create extension if not exists pgcrypto;

create table if not exists public.cabshare_identities (
  id             bigint generated always as identity primary key,
  device_code    text not null unique,
  phone_e164     text,                       -- E.164, e.g. +919876543210
  phone_last4    text,                       -- display fragment only
  phone_verified boolean not null default false,
  verified_at    timestamptz,
  hide_number    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.cabshare_phone_otps (
  id          bigint generated always as identity primary key,
  phone_e164  text not null,
  code_hash   text not null,                 -- digest(code, 'sha256')
  attempts    int not null default 0,
  expires_at  timestamptz not null,          -- created_at + 10 minutes
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists cabshare_phone_otps_phone_idx
  on public.cabshare_phone_otps (phone_e164, created_at desc);

-- Pending phone: lets a verified user start changing their number — the new
-- number is only promoted to phone_e164 after a successful verify.
alter table public.cabshare_identities
  add column if not exists pending_phone_e164 text;

-- Deny-all: no policies at all on purpose. SECURITY DEFINER functions bypass
-- RLS and are the ONLY read/write path.
alter table public.cabshare_identities enable row level security;
alter table public.cabshare_phone_otps  enable row level security;

-- The anon role's implicit table grants come from the default privileges;
-- revoke them explicitly so even table-scoped mistakes stay impossible.
revoke all on public.cabshare_identities from anon, authenticated;
revoke all on public.cabshare_phone_otps  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- OTP lifecycle (SECURITY DEFINER)
-- ---------------------------------------------------------------------------

-- Rate-limit guard shared by begin_phone_otp: max 3 sends per phone per
-- rolling hour, max 8 per rolling day.
create or replace function public.assert_otp_send_rate(p_phone_e164 text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour int;
  v_day  int;
begin
  select count(*) into v_hour
    from public.cabshare_phone_otps
   where phone_e164 = p_phone_e164
     and created_at > now() - interval '1 hour';
  if v_hour >= 3 then
    raise exception 'OTP_SEND_RATE_LIMITED';
  end if;
  select count(*) into v_day
    from public.cabshare_phone_otps
   where phone_e164 = p_phone_e164
     and created_at > now() - interval '24 hours';
  if v_day >= 8 then
    raise exception 'OTP_SEND_RATE_LIMITED';
  end if;
end;
$$;

-- The otp-gateway Edge Function (the only caller — it holds the SMS provider
-- secrets) stores the challenge AFTER the SMS has been accepted by the
-- provider. The plaintext code arrives only for hashing and is never stored.
create or replace function public.begin_phone_otp(p_phone_e164 text, p_code text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if p_phone_e164 !~ '^\+[1-9]\d{7,14}$' then
    raise exception 'OTP_INVALID_PHONE';
  end if;
  if p_code !~ '^\d{6}$' then
    raise exception 'OTP_INVALID_CODE';
  end if;
  perform public.assert_otp_send_rate(p_phone_e164);
  insert into public.cabshare_phone_otps (phone_e164, code_hash, expires_at)
  values (p_phone_e164, encode(digest(p_code, 'sha256'), 'hex'), now() + interval '10 minutes')
  returning id into v_id;
  return v_id;
end;
$$;

-- Verify: the browser presents its device_code + the code it received. One
-- identity per device; changing numbers resets verification (handled by
-- revoke_phone + a fresh challenge). Max 5 attempts per challenge.
create or replace function public.verify_phone_otp(p_device_code text, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_otp    public.cabshare_phone_otps%rowtype;
  v_hash   text;
  v_last4  text;
begin
  if p_device_code is null or length(trim(p_device_code)) < 16 then
    return false;
  end if;
  if p_code !~ '^\d{6}$' then
    return false;
  end if;
  v_hash := encode(digest(p_code, 'sha256'), 'hex');

  -- Latest unused, unexpired challenge for the identity's phone. The device
  -- must already have a phone attached by request_phone_otp_change OR be
  -- brand new; we locate the challenge via the most recent OTP row for the
  -- device's pending phone (see request_phone_otp_change).
  select * into v_otp
    from public.cabshare_phone_otps
   where used_at is null
     and expires_at > now()
     and phone_e164 = coalesce(
       (select pending_phone_e164 from public.cabshare_identities where device_code = p_device_code),
       (select phone_e164 from public.cabshare_identities where device_code = p_device_code)
     )
   order by created_at desc
   limit 1;

  if v_otp.id is null then
    return false;
  end if;

  if v_otp.attempts >= 5 then
    update public.cabshare_phone_otps set used_at = now() where id = v_otp.id;
    return false;
  end if;

  if v_otp.code_hash <> v_hash then
    update public.cabshare_phone_otps
       set attempts = attempts + 1
     where id = v_otp.id;
    return false;
  end if;

  -- Success: consume the challenge, mark the identity verified.
  update public.cabshare_phone_otps set used_at = now() where id = v_otp.id;
  v_last4 := right(v_otp.phone_e164, 4);
  insert into public.cabshare_identities (device_code, phone_e164, phone_last4, phone_verified, verified_at)
  values (p_device_code, v_otp.phone_e164, v_last4, true, now())
  on conflict (device_code) do update
    set phone_e164     = excluded.phone_e164,
        phone_last4    = excluded.phone_last4,
        phone_verified = true,
        verified_at    = now(),
        updated_at     = now();
  return true;
end;
$$;

-- Request a new challenge for a device. Rate limits apply per phone. The
-- plaintext code is delivered by the otp-gateway Edge Function (SMS), the
-- only caller of begin_phone_otp; this RPC reserves the intent by attaching
-- the pending phone to the device.
create or replace function public.request_phone_otp(p_device_code text, p_phone_e164 text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device_code is null or length(trim(p_device_code)) < 16 then
    raise exception 'OTP_INVALID_DEVICE';
  end if;
  if p_phone_e164 !~ '^\+[1-9]\d{7,14}$' then
    raise exception 'OTP_INVALID_PHONE';
  end if;
  perform public.assert_otp_send_rate(p_phone_e164);
  insert into public.cabshare_identities (device_code, pending_phone_e164)
  values (p_device_code, p_phone_e164)
  on conflict (device_code) do update
    set pending_phone_e164 = excluded.pending_phone_e164,
        updated_at         = now();
  return true;
end;
$$;

-- Masked identity status for UI. Never returns the full number.
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
    return jsonb_build_object('verified', false);
  end if;
  select * into v_row from public.cabshare_identities where device_code = p_device_code;
  if v_row.id is null then
    return jsonb_build_object('verified', false);
  end if;
  return jsonb_build_object(
    'verified', v_row.phone_verified,
    'last4', v_row.phone_last4,
    'hideNumber', v_row.hide_number,
    'verifiedAt', v_row.verified_at
  );
end;
$$;

-- "Hide my number" preference.
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
     and phone_verified;
  return found;
end;
$$;

-- Changing the number: clears verification + pending state. The user must
-- verify the new number before posting/joining again.
create or replace function public.revoke_phone(p_device_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cabshare_identities
     set phone_e164 = null,
         pending_phone_e164 = null,
         phone_last4 = null,
         phone_verified = false,
         verified_at = null,
         updated_at = now()
   where device_code = p_device_code;
  return found;
end;
$$;

grant execute on function public.request_phone_otp(text, text) to anon, authenticated;
grant execute on function public.verify_phone_otp(text, text) to anon, authenticated;
grant execute on function public.get_phone_identity(text) to anon, authenticated;
grant execute on function public.set_phone_visibility(text, boolean) to anon, authenticated;
grant execute on function public.revoke_phone(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ride confirmation + contact exchange
-- ---------------------------------------------------------------------------

alter table public.cabshare_rides
  add column if not exists poster_device_code text;
alter table public.cabshare_members
  add column if not exists identity_id bigint references public.cabshare_identities(id),
  add column if not exists poster_confirmed boolean not null default false;

-- Server-side enforcement of the verification gate: rides can only be
-- posted by a verified identity.
create or replace function public.enforce_verified_poster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.poster_device_code is null or length(trim(new.poster_device_code)) < 16 then
    raise exception 'PHONE_VERIFICATION_REQUIRED';
  end if;
  if not exists (
    select 1 from public.cabshare_identities
     where device_code = new.poster_device_code
       and phone_verified
  ) then
    raise exception 'PHONE_VERIFICATION_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists cabshare_rides_verified_poster on public.cabshare_rides;
create trigger cabshare_rides_verified_poster
  before insert on public.cabshare_rides
  for each row execute function public.enforce_verified_poster();

-- Joining now requires a verified identity and prevents the same verified
-- phone from holding seats on two open rides that overlap in time.
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
  -- Verification gate (new requirement). Legacy anonymous joins are refused.
  if p_device_code is null or length(trim(p_device_code)) < 16 then
    raise exception 'PHONE_VERIFICATION_REQUIRED';
  end if;
  select * into v_identity from public.cabshare_identities where device_code = p_device_code;
  if v_identity.id is null or not v_identity.phone_verified then
    raise exception 'PHONE_VERIFICATION_REQUIRED';
  end if;

  select * into v_ride from public.cabshare_rides where id = p_ride_id for update;
  if v_ride.id is null then return false; end if;

  -- Conflict prevention: one verified phone cannot hold seats on two open
  -- rides whose windows overlap (same date, within a 3-hour band).
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

-- Poster confirms a rider (the rider's half happened by joining). Mutual
-- confirmation = rider joined + poster confirmed.
create or replace function public.confirm_ride_member(p_ride_id bigint, p_poster_code text, p_member_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.cabshare_rides
     where id = p_ride_id and poster_code = p_poster_code
  ) then
    return false;
  end if;
  update public.cabshare_members
     set poster_confirmed = true
   where ride_id = p_ride_id
     and member_code = p_member_code;
  return found;
end;
$$;

-- Poster-only rider list (no phone data — just codes + confirmation state)
-- so the poster can confirm riders and exchange contacts afterwards.
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
      -- Masked fragment only — never the full number.
      'last4', i.phone_last4,
      'verified', i.phone_verified
    ) order by m.created_at), '[]'::jsonb)
  )
  from public.cabshare_members m
  left join public.cabshare_identities i on i.id = m.identity_id
  where m.ride_id = p_ride_id;
end;
$$;

-- Contact exchange. Caller presents their own capability code plus the
-- member code being revealed (their own, or a rider's when they are the
-- poster). The COUNTERPARTY's number is returned only when verification +
-- mutual confirmation + the counterparty's visibility preference all allow
-- it. Deleted/blocked identities degrade to a safe status instead of erroring.
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
    -- Poster revealing a rider: mutual confirmation = rider joined + poster confirmed them.
    if not v_member.poster_confirmed then
      return jsonb_build_object('status', 'needs_confirmation');
    end if;
    if v_member.identity_id is null then
      return jsonb_build_object('status', 'unavailable');
    end if;
    select * into v_other from public.cabshare_identities where id = v_member.identity_id;
  elsif v_member.member_code = p_code then
    -- Rider revealing the poster.
    if not v_member.poster_confirmed then
      return jsonb_build_object('status', 'awaiting_confirmation');
    end if;
    select * into v_other from public.cabshare_identities
     where device_code = v_ride.poster_device_code;
  else
    return jsonb_build_object('status', 'forbidden');
  end if;

  if v_other.id is null or not v_other.phone_verified then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_other.hide_number then
    return jsonb_build_object('status', 'hidden', 'masked', '•••• ' || coalesce(v_other.phone_last4, '••••'));
  end if;
  return jsonb_build_object('status', 'ok', 'phone', v_other.phone_e164);
end;
$$;

grant execute on function public.join_cabride_with_member(bigint, text, text) to anon, authenticated;
grant execute on function public.confirm_ride_member(bigint, text, text) to anon, authenticated;
grant execute on function public.list_ride_members(bigint, text) to anon, authenticated;
grant execute on function public.reveal_member_contact(bigint, text, text) to anon, authenticated;

-- Realtime: identity tables must NEVER be published. Ensure only rides are.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'cabshare_rides'
  ) then
    alter publication supabase_realtime add table public.cabshare_rides;
  end if;
end
$$;
