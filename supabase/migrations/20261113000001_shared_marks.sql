-- ---------------------------------------------------------------------------
-- shared_marks — opt-in anonymous marks behind the course Grade Prediction
--
-- One row per (device, course, term, component). The device code is a random
-- capability token issued by the browser; no registration number, name, email
-- or account id is stored, so a row cannot be traced back to a student by any
-- reader of this table.
--
-- The table is RLS deny-all with no policy and no table grant. The only paths
-- in or out are the three SECURITY DEFINER functions below:
--
--   share_marks        upsert this device's row (dedupe on the unique key)
--   withdraw_marks     delete every row this device owns (opt-out)
--   shared_marks_stats count / mean / stddev for one cohort, never rows
--
-- The stats function returns no figures below 15 contributors. That floor is
-- privacy, not statistics: an average of three is close to a student's own mark.
-- Cohort identity is course + term + regulation + faculty + slot + component +
-- stage, so different classes and different stages are never pooled.
-- ---------------------------------------------------------------------------

create table if not exists public.shared_marks (
  id           bigint generated always as identity primary key,
  device_code  text not null,
  course_code  text not null,
  term         text not null default '',
  regulation   text not null default '',
  faculty      text not null default '',
  slot         text not null default '',
  component    text not null check (component in ('theory', 'lab')),
  stage        text not null default 'internal' check (stage in ('internal', 'final')),
  percent      numeric(6,2) not null check (percent >= 0 and percent <= 100),
  weight       numeric(6,2) not null check (weight > 0 and weight <= 1000),
  updated_at   timestamptz not null default now(),
  -- One contribution per device per course per term per component. A re-sync
  -- updates this row; it can never add a second one.
  constraint shared_marks_one_per_device
    unique (device_code, course_code, term, component)
);

comment on table public.shared_marks is
  'Opt-in anonymous per-class marks. RLS deny-all; reachable only through share_marks, withdraw_marks and shared_marks_stats.';

create index if not exists shared_marks_cohort_idx
  on public.shared_marks (course_code, term, regulation, faculty, slot, component, stage);

alter table public.shared_marks enable row level security;

-- No policy is created on purpose: deny-all. Supabase's default privileges
-- hand anon/authenticated table access, so take it back explicitly.
revoke all on public.shared_marks from anon, authenticated;
revoke all on sequence public.shared_marks_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Write: one upsert, validated at the boundary
-- ---------------------------------------------------------------------------

create or replace function public.share_marks(
  p_device_code text,
  p_course_code text,
  p_term        text,
  p_regulation  text,
  p_faculty     text,
  p_slot        text,
  p_component   text,
  p_stage       text,
  p_percent     numeric,
  p_weight      numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device text := btrim(coalesce(p_device_code, ''));
  v_course text := upper(btrim(coalesce(p_course_code, '')));
begin
  if char_length(v_device) < 16 or char_length(v_device) > 128 then
    raise exception 'MARKS_INVALID_DEVICE';
  end if;
  if v_course = '' or char_length(v_course) > 32 then
    raise exception 'MARKS_INVALID_COURSE';
  end if;
  if p_component not in ('theory', 'lab') then
    raise exception 'MARKS_INVALID_COMPONENT';
  end if;
  if p_stage not in ('internal', 'final') then
    raise exception 'MARKS_INVALID_STAGE';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'MARKS_INVALID_PERCENT';
  end if;
  if p_weight is null or p_weight <= 0 or p_weight > 1000 then
    raise exception 'MARKS_INVALID_WEIGHT';
  end if;

  insert into public.shared_marks
    (device_code, course_code, term, regulation, faculty, slot, component, stage, percent, weight)
  values
    (left(v_device, 128), v_course,
     left(btrim(coalesce(p_term, '')), 64),
     left(btrim(coalesce(p_regulation, '')), 32),
     left(btrim(coalesce(p_faculty, '')), 64),
     left(btrim(coalesce(p_slot, '')), 32),
     p_component, p_stage, round(p_percent, 2), round(p_weight, 2))
  on conflict on constraint shared_marks_one_per_device
  do update set
    regulation = excluded.regulation,
    faculty    = excluded.faculty,
    slot       = excluded.slot,
    stage      = excluded.stage,
    percent    = excluded.percent,
    weight     = excluded.weight,
    updated_at = now();

  return jsonb_build_object('ok', true, 'component', p_component);
end;
$$;

-- ---------------------------------------------------------------------------
-- Opt-out: delete everything this device contributed
-- ---------------------------------------------------------------------------

create or replace function public.withdraw_marks(p_device_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device text := btrim(coalesce(p_device_code, ''));
  v_removed int := 0;
begin
  if char_length(v_device) < 16 then
    raise exception 'MARKS_INVALID_DEVICE';
  end if;
  delete from public.shared_marks where device_code = v_device;
  get diagnostics v_removed = row_count;
  return jsonb_build_object('withdrawn', true, 'removed', v_removed);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read: aggregates for one cohort, behind the privacy floor
-- ---------------------------------------------------------------------------

create or replace function public.shared_marks_stats(
  p_course_code text,
  p_term        text default '',
  p_regulation  text default '',
  p_faculty     text default '',
  p_slot        text default '',
  p_component   text default 'theory',
  p_stage       text default 'internal'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_mean  numeric;
  v_sd    numeric;
begin
  select count(*),
         round(avg(percent), 2),
         round(stddev_pop(percent), 2)
    into v_count, v_mean, v_sd
    from public.shared_marks
   where course_code = upper(btrim(coalesce(p_course_code, '')))
     and term        = btrim(coalesce(p_term, ''))
     and regulation  = btrim(coalesce(p_regulation, ''))
     and faculty     = btrim(coalesce(p_faculty, ''))
     and slot        = btrim(coalesce(p_slot, ''))
     and component   = coalesce(p_component, 'theory')
     and stage       = coalesce(p_stage, 'internal');

  -- Below the floor the count itself is useful (it tells the screen whether
  -- anyone is in the group) but the figures are withheld.
  if v_count < 15 then
    return jsonb_build_object('count', v_count, 'mean', null, 'sd', null, 'suppressed', true);
  end if;

  return jsonb_build_object('count', v_count, 'mean', v_mean, 'sd', v_sd, 'suppressed', false);
end;
$$;

-- Only the three functions — never the table — are callable by the client.
revoke all on function public.share_marks(text, text, text, text, text, text, text, text, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.withdraw_marks(text) from public, anon, authenticated;
revoke all on function public.shared_marks_stats(text, text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.share_marks(text, text, text, text, text, text, text, text, numeric, numeric)
  to anon, authenticated;
grant execute on function public.withdraw_marks(text) to anon, authenticated;
grant execute on function public.shared_marks_stats(text, text, text, text, text, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
