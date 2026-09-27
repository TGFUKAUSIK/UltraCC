-- Cab Share participant accounting.
-- The original board only decremented seats and therefore could not safely
-- support leave/re-join. Member codes are random, browser-session capability
-- tokens; no VTOP identity is stored.

alter table public.cabshare_rides
  add column if not exists participant_count int not null default 0
  check (participant_count between 0 and 6);

-- Enable Supabase Realtime notifications for board changes. Keep this
-- idempotent because hosted projects may already have the table published.
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

-- Validate new public-board writes at the database boundary as well as in the
-- form. NOT VALID keeps an older malformed row from blocking the migration,
-- while PostgreSQL still enforces each check for future inserts/updates.
alter table public.cabshare_rides
  add constraint cabshare_route_length_check check (
    length(trim(from_place)) between 1 and 120 and length(trim(to_place)) between 1 and 120
  ) not valid;
alter table public.cabshare_rides
  add constraint cabshare_datetime_format_check check (
    travel_date ~ '^\\d{4}-\\d{2}-\\d{2}$' and travel_time ~ '^([01]\\d|2[0-3]):[0-5]\\d$'
  ) not valid;
alter table public.cabshare_rides
  add constraint cabshare_notes_length_check check (length(notes) <= 240 and length(contact) <= 100) not valid;

create table if not exists public.cabshare_members (
  id            bigint generated always as identity primary key,
  ride_id       bigint not null references public.cabshare_rides(id) on delete cascade,
  member_code   text not null,
  created_at    timestamptz not null default now(),
  unique (ride_id, member_code)
);

alter table public.cabshare_members enable row level security;
-- Member codes must never be publicly readable. SECURITY DEFINER RPCs below
-- are the only read/write path for anonymous users.

create or replace function public.join_cabride_with_member(p_ride_id bigint, p_member_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats int;
begin
  if p_member_code is null or length(trim(p_member_code)) < 16 then
    return false;
  end if;
  select seats_left into v_seats
    from public.cabshare_rides
   where id = p_ride_id
   for update;
  if v_seats is null then return false; end if;
  if exists (select 1 from public.cabshare_members where ride_id = p_ride_id and member_code = p_member_code) then
    return true;
  end if;
  if v_seats <= 0 then return false; end if;
  insert into public.cabshare_members (ride_id, member_code) values (p_ride_id, p_member_code);
  update public.cabshare_rides
     set seats_left = seats_left - 1,
         participant_count = participant_count + 1
   where id = p_ride_id;
  return true;
end;
$$;

create or replace function public.leave_cabride(p_ride_id bigint, p_member_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer;
begin
  perform 1 from public.cabshare_rides where id = p_ride_id for update;
  delete from public.cabshare_members
   where ride_id = p_ride_id and member_code = p_member_code;
  get diagnostics v_removed = row_count;
  if v_removed = 0 then return false; end if;
  update public.cabshare_rides
     set seats_left = least(seats, seats_left + 1),
         participant_count = greatest(0, participant_count - 1)
   where id = p_ride_id;
  return true;
end;
$$;

grant execute on function public.join_cabride_with_member(bigint, text) to anon, authenticated;
grant execute on function public.leave_cabride(bigint, text) to anon, authenticated;
