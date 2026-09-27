-- ---------------------------------------------------------------------------
-- Retire SMS/OTP phone verification from Cab Share (2026-09-08).
--
-- Decision: UltraCC does NOT verify phone ownership. A Cab Share contact
-- number is self-declared, is never displayed on the public board, and is
-- exchanged only after mutual ride confirmation (subject to the owner's
-- "hide my number" preference). Honest terminology everywhere: "mobile
-- number", "contact sharing" — never "verified".
--
-- WHAT IS REMOVED (application dependence + unused structures):
--   * phone_verified / verified_at / pending_phone_e164 columns on
--     cabshare_identities (verification state no longer exists).
--   * cabshare_phone_otps — EPHEMERAL OTP challenges (10-minute TTL, only
--     SHA-256 hashes, consumed or expired within minutes). Contains no
--     ride/member data; dropping it loses nothing users care about.
--   * OTP lifecycle functions (rate limiting, begin/verify/request OTP).
--   * The "verified poster" gate — replaced by a lighter gate: any device
--     with a saved contact number can post/join (registered-device gate).
--
-- WHAT IS PRESERVED: cabshare_rides, cabshare_members and every existing
-- cabshare_identities row (phone_e164, phone_last4, hide_number, timestamps).
-- ---------------------------------------------------------------------------

-- 1. Drop verification columns from the identity table.
alter table public.cabshare_identities
  drop column if exists pending_phone_e164,
  drop column if exists phone_verified,
  drop column if exists verified_at;

-- 2. Drop the ephemeral OTP challenge table (no long-lived data inside).
drop table if exists public.cabshare_phone_otps;

-- 3. Drop the OTP lifecycle functions (signatures must match exactly).
drop function if exists public.assert_otp_send_rate(text);
drop function if exists public.begin_phone_otp(text, text);
drop function if exists public.verify_phone_otp(text, text);
drop function if exists public.request_phone_otp(text, text);

-- 4. Replace the verified-poster gate with a registered-device gate.
drop trigger if exists cabshare_rides_verified_poster on public.cabshare_rides;
drop function if exists public.enforce_verified_poster();

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

-- 5. Save the contact number for this device (no verification, no OTP).
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

-- 6. Masked identity status for UI. Never returns the full number, and —
-- honestly — no "verified" flag exists anymore.
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

-- 7. "Hide my number" preference — applies to any device with a saved number.
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

-- 8. Changing/removing the number: clears it, keeps the identity + hide pref.
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

-- 9. Joining requires a registered device with a saved contact number and
-- keeps the overlap conflict guard. No verification check.
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

  -- Conflict prevention: one contact number cannot hold seats on two open
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

-- 10. Poster-only rider list (no phone data — codes + confirmation state +
-- masked fragment only).
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
      'last4', i.phone_last4
    ) order by m.created_at), '[]'::jsonb)
  )
  from public.cabshare_members m
  left join public.cabshare_identities i on i.id = m.identity_id
  where m.ride_id = p_ride_id;
end;
$$;

-- 11. Contact exchange. Unchanged privacy model, minus the verification
-- requirement: the counterparty's number is returned only after mutual
-- confirmation and only when they have not hidden it.
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

  if v_other.id is null or v_other.phone_e164 is null then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_other.hide_number then
    return jsonb_build_object('status', 'hidden', 'masked', '•••• ' || coalesce(v_other.phone_last4, '••••'));
  end if;
  return jsonb_build_object('status', 'ok', 'phone', v_other.phone_e164);
end;
$$;

-- 12. Grants (replace any that pointed at dropped functions).
grant execute on function public.set_phone_identity(text, text) to anon, authenticated;
grant execute on function public.get_phone_identity(text) to anon, authenticated;
grant execute on function public.set_phone_visibility(text, boolean) to anon, authenticated;
grant execute on function public.revoke_phone(text) to anon, authenticated;
grant execute on function public.join_cabride_with_member(bigint, text, text) to anon, authenticated;
grant execute on function public.confirm_ride_member(bigint, text, text) to anon, authenticated;
grant execute on function public.list_ride_members(bigint, text) to anon, authenticated;
grant execute on function public.reveal_member_contact(bigint, text, text) to anon, authenticated;
