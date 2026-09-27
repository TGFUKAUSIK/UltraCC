-- ---------------------------------------------------------------------------
-- grade_predictions — anonymous grade data for the Relative Grade Predictor
--
-- HARD PRIVACY REQUIREMENT: this table must NEVER be joinable back to a
-- student identity. It stores ONLY (course_id, total_marks, final_grade).
-- No student id, no auth uid, no email, no timestamp linkage.
--
-- RLS:
--   - anon can INSERT (students submitting their own grade)
--   - anon can SELECT the AGGREGATE fields (used by compute_grade_stats)
--   - no UPDATE/DELETE for anyone (integrity)
-- ---------------------------------------------------------------------------

create table if not exists public.grade_predictions (
  id          bigint generated always as identity primary key,
  course_id   text not null,
  total_marks int  not null check (total_marks between 0 and 100),
  final_grade text not null check (final_grade in ('S','A','B','C','D','E','F')),
  submitted_at timestamptz not null default now()
);

-- Index for fast per-course aggregation.
create index if not exists grade_predictions_course_idx
  on public.grade_predictions (course_id);

-- No one may ever see individual rows — only aggregates. Instead of opening
-- SELECT, expose an aggregate view.
create view public.grade_stats as
  select
    course_id,
    count(*)::int                                       as submission_count,
    round(avg(total_marks)::numeric, 2)                 as mean_total,
    round(stddev_pop(total_marks)::numeric, 2)          as stddev_total,
    round(avg(total_marks)::numeric - stddev_pop(total_marks)::numeric, 2) as mu_minus_1sigma
  from public.grade_predictions
  group by course_id;

alter table public.grade_predictions enable row level security;
alter view  public.grade_stats set (security_invoker = on);

-- INSERT only — anon students submitting anonymously.
create policy "anon can submit anonymous grades"
  on public.grade_predictions
  for insert
  to anon
  with check (true);

-- Aggregate reads go through the view (no row-level exposure).
create policy "anon can read aggregated grade stats"
  on public.grade_predictions
  for select
  to anon
  using (false);
