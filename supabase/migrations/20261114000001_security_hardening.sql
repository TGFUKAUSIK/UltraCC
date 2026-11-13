-- ---------------------------------------------------------------------------
-- Security hardening — 2026-11-14
--
-- 1. shared_marks stores a SHA-256 of the device capability token, not the
--    token itself. The flow stays anonymous (no auth.uid(), no account); the
--    token is still the only credential, so a reader of the table can no
--    longer lift it and act as that device. Plaintext never leaves the
--    browser: the server hashes before insert and before delete.
--
--    Stored values carry a `sha256:` marker. That makes "already hashed" a
--    fact about the value instead of a guess from its shape: the previous
--    draft skipped anything matching 64 lowercase hex characters, so a legacy
--    plaintext token of exactly that shape would have stayed in the clear.
--    Every row that does not carry the marker is hashed, and a CHECK
--    constraint refuses any future plaintext write.
-- 2. shared_marks refuses an empty term/regulation at the server, so a client
--    cannot pool itself with every other unsynced student.
-- 3. grade_stats is rebuilt over shared_marks, grouped by the class identity
--    VTOP actually publishes (course, term, regulation, faculty, slot,
--    component, stage), with the 15-contributor floor applied per group. The
--    old view grouped grade_predictions by course_id alone, so two terms or
--    two faculties of one course were pooled; that table carries no term,
--    faculty or slot, so the grouping could not be corrected in place.
-- 4. The dead anonymous INSERT path into grade_predictions is retired. No
--    client has written to it since grade sharing moved to shared_marks, and
--    nothing reads it any more: compute_grade_stats was the only reader and
--    has no caller.
-- 5. cabshare_datetime_format_check used '\\d' under standard_conforming_
--    strings, i.e. it required a literal backslash and rejected every real
--    date. Single backslashes now match what the comment always claimed.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1 + 2. shared_marks: hash the capability token, guard the cohort
-- ---------------------------------------------------------------------------

-- No extension needed: sha256(bytea) is built into PostgreSQL 11+.
update public.shared_marks
   set device_code = 'sha256:' || encode(sha256(convert_to(device_code, 'UTF8')), 'hex')
 where device_code !~ '^sha256:[0-9a-f]{64}$';

alter table public.shared_marks
  drop constraint if exists shared_marks_device_code_hashed;
alter table public.shared_marks
  add constraint shared_marks_device_code_hashed
  check (device_code ~ '^sha256:[0-9a-f]{64}$');

comment on column public.shared_marks.device_code is
  'sha256:<hex> of the browser device capability token. The plaintext token is never stored.';

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
  v_term   text := btrim(coalesce(p_term, ''));
  v_reg    text := btrim(coalesce(p_regulation, ''));
  v_hash   text;
begin
  if char_length(v_device) < 16 or char_length(v_device) > 128 then
    raise exception 'MARKS_INVALID_DEVICE';
  end if;
  if v_course = '' or char_length(v_course) > 32 then
    raise exception 'MARKS_INVALID_COURSE';
  end if;
  -- An empty cohort label would pool this student with every other unsynced
  -- one, so the server refuses it even though the client already does.
  if v_term = '' or char_length(v_term) > 64 then
    raise exception 'MARKS_INVALID_TERM';
  end if;
  if v_reg = '' or char_length(v_reg) > 32 then
    raise exception 'MARKS_INVALID_REGULATION';
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

  v_hash := 'sha256:' || encode(sha256(convert_to(v_device, 'UTF8')), 'hex');

  insert into public.shared_marks
    (device_code, course_code, term, regulation, faculty, slot, component, stage, percent, weight)
  values
    (v_hash, v_course,
     v_term, v_reg,
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

create or replace function public.withdraw_marks(p_device_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device text := btrim(coalesce(p_device_code, ''));
  v_hash   text;
  v_removed int := 0;
begin
  if char_length(v_device) < 16 or char_length(v_device) > 128 then
    raise exception 'MARKS_INVALID_DEVICE';
  end if;
  v_hash := 'sha256:' || encode(sha256(convert_to(v_device, 'UTF8')), 'hex');
  delete from public.shared_marks
   where device_code = v_hash;
  get diagnostics v_removed = row_count;
  return jsonb_build_object('withdrawn', true, 'removed', v_removed);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. grade_stats: one row per real class, behind the per-class privacy floor
-- ---------------------------------------------------------------------------

-- The column set changes, so the old view has to go rather than be replaced.
drop view if exists public.grade_stats;

create view public.grade_stats as
  select
    course_code,
    term,
    regulation,
    faculty,
    slot,
    component,
    stage,
    count(*)::int                            as contributor_count,
    round(avg(percent)::numeric, 2)          as mean_percent,
    round(stddev_pop(percent)::numeric, 2)   as stddev_percent
  from public.shared_marks
  group by course_code, term, regulation, faculty, slot, component, stage
  -- Same floor as shared_marks_stats: an average of three is close to a
  -- student's own mark, so a group below it describes nobody.
  having count(*) >= 15;

-- The view runs as its owner (the migration role), which is what lets it read
-- a deny-all table; the floor above keeps that read aggregate-only.
revoke all on public.grade_stats from anon, authenticated;
grant select on public.grade_stats to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Retire the unused anonymous write and read paths
-- ---------------------------------------------------------------------------

drop policy if exists "anon can submit anonymous grades" on public.grade_predictions;
revoke all on public.grade_predictions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. cabshare date/time check: one backslash, not two
-- ---------------------------------------------------------------------------

alter table public.cabshare_rides
  drop constraint if exists cabshare_datetime_format_check;

alter table public.cabshare_rides
  add constraint cabshare_datetime_format_check check (
    travel_date ~ '^\d{4}-\d{2}-\d{2}$' and travel_time ~ '^([01]\d|2[0-3]):[0-5]\d$'
  ) not valid;

notify pgrst, 'reload schema';
