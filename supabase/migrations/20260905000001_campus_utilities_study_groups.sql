-- Campus utilities: user-generated study groups only.
-- No VTOP identity, credentials, grades, or tokens are stored.

create extension if not exists pgcrypto;

create table if not exists public.study_groups (
  id bigint generated always as identity primary key,
  course text not null check (char_length(course) between 1 and 80),
  assessment text not null default '' check (char_length(assessment) <= 30),
  topic text not null default '' check (char_length(topic) <= 120),
  meeting_time text not null default '' check (char_length(meeting_time) <= 80),
  location text not null default '' check (char_length(location) <= 120),
  group_size integer not null default 1 check (group_size between 1 and 50),
  display_name text not null default 'Anonymous' check (char_length(display_name) between 1 and 40),
  owner_token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.study_group_members (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.study_groups(id) on delete cascade,
  display_name text not null default 'Anonymous' check (char_length(display_name) between 1 and 40),
  member_token_hash text not null,
  created_at timestamptz not null default now(),
  unique (group_id, member_token_hash)
);

create index if not exists study_groups_course_idx on public.study_groups (course);
create index if not exists study_groups_created_idx on public.study_groups (created_at desc);
create index if not exists study_group_members_group_idx on public.study_group_members (group_id);

alter table public.study_groups enable row level security;
alter table public.study_group_members enable row level security;

drop policy if exists "public can view study group listings" on public.study_groups;
create policy "public can view study group listings"
  on public.study_groups for select to anon, authenticated using (true);

drop policy if exists "public can create study groups" on public.study_groups;
create policy "public can create study groups"
  on public.study_groups for insert to anon, authenticated with check (true);

-- The client reads the projection view below, never the base table (which
-- contains the opaque owner capability hash).
revoke select on public.study_groups from anon, authenticated;

-- Membership rows are never selectable directly; only the aggregate view below
-- is granted to the client. Joining/leaving is done through token-checked RPCs.
revoke all on public.study_group_members from anon, authenticated;

create or replace view public.study_groups_public as
select g.id, g.course, g.assessment, g.topic, g.meeting_time, g.location,
       g.group_size, g.display_name, g.created_at,
       count(m.id)::integer as member_count
from public.study_groups g
left join public.study_group_members m on m.group_id = g.id
group by g.id;

grant select on public.study_groups_public to anon, authenticated;

create or replace function public.join_study_group(
  p_group_id bigint,
  p_display_name text,
  p_member_token text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  max_size integer;
begin
  if p_member_token is null or char_length(p_member_token) < 16 then return false; end if;
  select group_size into max_size from public.study_groups where id = p_group_id;
  if max_size is null then return false; end if;
  if (select count(*) from public.study_group_members where group_id = p_group_id) >= max_size then return false; end if;
  insert into public.study_group_members(group_id, display_name, member_token_hash)
  values (p_group_id, left(coalesce(nullif(trim(p_display_name), ''), 'Anonymous'), 40), encode(digest(p_member_token, 'sha256'), 'hex'))
  on conflict (group_id, member_token_hash) do nothing;
  return true;
end;
$$;

create or replace function public.leave_study_group(p_group_id bigint, p_member_token text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.study_group_members
  where group_id = p_group_id
    and member_token_hash = encode(digest(p_member_token, 'sha256'), 'hex');
  return found;
end;
$$;

grant execute on function public.join_study_group(bigint, text, text) to anon, authenticated;
grant execute on function public.leave_study_group(bigint, text) to anon, authenticated;
