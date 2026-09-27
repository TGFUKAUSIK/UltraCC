-- ---------------------------------------------------------------------------
-- pyq_papers — previous-year-question (PYQ) metadata from CodeChef-VIT Papers
-- (2026-09-20).
--
-- WHAT THIS IS
--   A local, normalised copy of the *metadata* of the public archive at
--   https://www.papers.codechefvit.com (MIT, Copyright (c) 2025 CodeChef-VIT):
--   which subject a paper belongs to, which exam / academic year / semester /
--   slot / campus it is for, and where the PDF lives.
--
--   No paper bytes are stored, downloaded or proxied. `paper_url` is the URL
--   CodeChef-VIT itself publishes, pointing at their own bucket. The upstream
--   project is MIT-licensed and the metadata is served from a public,
--   unauthenticated, read-only API, so there is nothing private in these two
--   tables: no student identity, no registration number, no VTOP session, no
--   VTOP data of any kind, no credentials.
--
-- WHY IT LIVES IN POSTGRES
--   Upstream offers no pagination, no filtering and no search. Every route is
--   `force-dynamic` and GET /api/papers?subject=<x> runs a case-insensitive
--   `$regex` SUBSTRING match over `subject` and returns the whole match set in
--   one ~30 KB response (page/limit/campus/exam/year/slot/semester are ignored
--   by upstream). Asking the student's browser to do that per keystroke would
--   mean re-downloading the archive. So the app reads Postgres and never talks
--   to CodeChef-VIT; all filtering, faceting and search happens here — which is
--   exactly what the indexes below are for.
--
-- WRITE PATH (deliberately narrow)
--   anon + authenticated may SELECT and nothing else. INSERT/UPDATE/DELETE are
--   revoked from them explicitly and are performed only by the pyq-sync edge
--   function using the service-role key, which is server-side and never ships
--   to the client. An upstream failure can therefore never wipe the archive:
--   the importer only upserts, never truncates and never deletes-then-inserts,
--   so a bad run leaves the previous metadata fully intact and records
--   status 'partial' or 'failed' in pyq_sync_runs instead.
--
-- SEARCH: TRADEOFF, STATED PLAINLY
--   There is no FTS/tsvector column and no stemming. The only searchable text
--   upstream has is `title` (the verbatim "Title [CODE]" string) and the
--   derived `course_title`, and what students actually type is a substring
--   ("prob", "MATS101"), not a word set — so a tsvector would not help. If
--   pg_trgm is available we build GIN trigram indexes and the client's
--   `ilike '%term%'` is index-backed. If the extension cannot be enabled we
--   create plain btree indexes instead, and substring search degrades to a
--   sequential scan over ~3,150 rows (a few ms at this size, and this table is
--   read-only in practice, so no vacuum pressure). Exact filters — course code,
--   exam, year, semester, slot, campus — stay index-only either way.
--
-- WHAT UPSTREAM ACTUALLY SENDS (verified against the live site and its repo)
--   Every document carries exactly: _id, subject, slot, year, exam, semester,
--   campus, thumbnail_url, file_url, answer_key_included. Occasionally __v and
--   public_id_cloudinary. There is NO difficulty, NO tags, NO separate title,
--   NO answer-key URL, and course code / course title are NOT split fields —
--   they are embedded in `subject` as "Title [CODE]", which the importer
--   separates. Nothing else is stored, because nothing else exists.
-- ---------------------------------------------------------------------------

-- Trigram support for substring search. Non-fatal by design: on a project
-- where the extension is unavailable the rest of this migration still applies.
do $$
begin
  create extension if not exists pg_trgm with schema extensions;
exception when others then
  raise notice 'pyq: pg_trgm could not be enabled (%) — substring search will fall back to a sequential scan; enable it in Database → Extensions and re-run this file', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- pyq_papers — one row per upstream paper document, keyed by its Mongo `_id`.
-- ---------------------------------------------------------------------------

create table if not exists public.pyq_papers (
  id                  bigint generated always as identity primary key,
  source              text not null default 'codechef-vit',

  -- Upstream Mongo `_id`, e.g. '6891d76bf6766a56a03f5f67'. The importer relies
  -- on this uniqueness: a substring query can return the same paper under
  -- several subjects, and a subject query can return papers from other
  -- subjects, so rows are deduped by _id and never by "one response = one
  -- subject".
  external_paper_id   text not null unique,

  -- Split of upstream `subject` ("Probability And Statistics [BMAT202L]").
  -- course_code is the bracket tail uppercased so the client's exact `eq.`
  -- filter cannot be defeated by upstream casing drift; course_title is the
  -- rest. `title` is the full normalised subject string — the only title
  -- upstream has.
  course_code         text,
  course_title        text,
  title               text,

  -- Verbatim upstream `subject`, before whitespace normalisation. Nullable and
  -- purely for debugging the splitter above: if a title ever looks mangled,
  -- this is what CodeChef-VIT actually sent. Nothing in the app reads it.
  subject_raw         text,

  -- Facets, stored as real columns so filtering and honest faceting happen
  -- here instead of in the browser. campus is NOT cosmetic: only ~39 of the
  -- 3,153 papers are Chennai (the rest are Vellore), and the client must be
  -- able to say so per row rather than imply the whole archive is Chennai's.
  exam_type           text,      -- upstream `exam`: CAT-1 / CAT-2 / FAT / Model …
  academic_year       text,      -- upstream `year`, e.g. '2024-2025' (kept as text)
  semester            text,      -- upstream `semester`
  slot                text,      -- upstream `slot`, e.g. 'B2'
  campus              text,      -- upstream `campus`

  -- Upstream `file_url`, HTTPS-only. A known corrupt record (_id
  -- 68a4da38991f450b79fcb7c5) has a double-scheme URL whose outer
  -- storage.googleapis.com part 404s while the trailing Cloudinary URL is the
  -- live one; the importer repairs it by taking the trailing URL, and the two
  -- checks below are the tripwire that keeps a nested scheme from ever being
  -- stored again.
  paper_url           text not null check (paper_url like 'https://%'),
  -- Rejected outright: a URL with a second scheme embedded in its path.
  constraint pyq_papers_paper_url_not_nested
    check (paper_url !~* 'https?://[^[:space:]]*/https?://'),

  -- RESERVED, intentionally always NULL today: CodeChef-VIT publishes no
  -- answer-key URL at all, only the boolean `answer_key_included` below. This
  -- column exists for a future source that really does have a separate
  -- key document. A NULL here is NOT missing data — there is nothing to put
  -- in it, and nobody should "fix" it by guessing a URL.
  answer_key_url      text,
  answer_key_included boolean,

  -- Upstream `thumbnail_url` (their own GCS bucket).
  thumbnail_url       text,

  -- Derived LOCALLY from the paper_url suffix ('pdf' for every real record).
  -- Upstream sends no content type or file type; this is a convenience so the
  -- client can pick a viewer without sniffing. NULL when the URL has no
  -- recognisable suffix.
  file_type           text,

  -- sha256 over the stable identity fields, hex. The importer compares it with
  -- the stored value and skips the write when nothing changed, which keeps a
  -- daily re-sync from rewriting 3,153 rows and from churning
  -- imported_at/first_seen_at.
  url_fingerprint     text,

  -- DERIVED, not sent by upstream: the first 4 bytes of a Mongo ObjectId are
  -- the creation seconds, so this is when CodeChef-VIT added the paper. NULL
  -- when `_id` is not a well-formed ObjectId or the decoded date is silly.
  source_created_at   timestamptz,

  imported_at         timestamptz not null default now(),
  -- Stamped by the column default on insert only: the importer deliberately
  -- omits this from its payload, so an upsert over an existing row cannot move
  -- a paper's first-seen date backwards or forwards.
  first_seen_at       timestamptz not null default now(),

  constraint pyq_papers_source_check check (source in ('codechef-vit', 'manual'))
);

-- The client's real filters, each index-backed. At ~3.1k rows any single one of
-- these is a few hundred blocks; they exist so `course_code=eq.…` and the
-- facet chips never fall back to a scan as the archive grows.
create index if not exists pyq_papers_course_code_idx
  on public.pyq_papers (course_code);
create index if not exists pyq_papers_exam_type_idx
  on public.pyq_papers (exam_type);
create index if not exists pyq_papers_academic_year_idx
  on public.pyq_papers (academic_year);
create index if not exists pyq_papers_semester_idx
  on public.pyq_papers (semester);
create index if not exists pyq_papers_slot_idx
  on public.pyq_papers (slot);
create index if not exists pyq_papers_campus_idx
  on public.pyq_papers (campus);
-- "Newest first" listing, ordered by when CodeChef-VIT added the paper.
create index if not exists pyq_papers_source_created_at_idx
  on public.pyq_papers (source_created_at desc nulls last);

-- Substring search: trigram GIN when pg_trgm made it, otherwise btree prefixes.
-- The qualified operator name matters — on Supabase pg_trgm lands in the
-- `extensions` schema, which is not on the search path.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create index if not exists pyq_papers_title_trgm_idx
      on public.pyq_papers using gin (title extensions.gin_trgm_ops);
    create index if not exists pyq_papers_course_title_trgm_idx
      on public.pyq_papers using gin (course_title extensions.gin_trgm_ops);
    raise notice 'pyq: pg_trgm available — GIN trigram indexes created for ilike search';
  else
    create index if not exists pyq_papers_course_title_idx
      on public.pyq_papers (course_title);
    create index if not exists pyq_papers_title_idx
      on public.pyq_papers (title);
    -- No literal percent signs here: RAISE reads "%" as a substitution marker
    -- and aborts the whole migration with "too few parameters specified for
    -- RAISE" when the format string asks for more values than it is given.
    raise notice 'pyq: pg_trgm unavailable — created btree fallbacks; substring (ilike) search will sequentially scan ~3k rows';
  end if;
exception when others then
  -- Most likely pg_trgm is present but not reachable from this search_path.
  create index if not exists pyq_papers_course_title_idx
    on public.pyq_papers (course_title);
  create index if not exists pyq_papers_title_idx
    on public.pyq_papers (title);
  raise notice 'pyq: trigram indexes unavailable (%) — using btree fallback indexes', sqlerrm;
end;
$$;

alter table public.pyq_papers enable row level security;

create policy "anon can view pyq papers"
  on public.pyq_papers for select to anon using (true);

create policy "authenticated can view pyq papers"
  on public.pyq_papers for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- pyq_sync_runs — the importer's log, and the client's "last synced" / "N
-- papers" source. One row per run, appended; a run is never rewritten except to
-- be finished.
-- ---------------------------------------------------------------------------

create table if not exists public.pyq_sync_runs (
  id                       bigint generated always as identity primary key,

  -- 'running' -> claimed by the importer, not over yet.
  -- 'complete'-> the whole catalogue was walked and every row landed.
  -- 'partial' -> upstream answered but the run ran out of its time budget or
  --              some subjects failed. Prior metadata stays valid and useful.
  -- 'failed'  -> nothing usable came back (or another run held the lock). The
  --              previously imported metadata is untouched either way.
  status                   text not null default 'running'
                             check (status in ('running', 'complete', 'partial', 'failed')),

  started_at               timestamptz not null default now(),
  finished_at              timestamptz,

  -- Sizes seen from upstream.
  subjects_enumerated      int not null default 0,  -- course-list entries
  subjects_fetched         int not null default 0,  -- of those, successfully fetched
  papers_discovered        int not null default 0,  -- unique _ids after substring dedupe

  -- What the run actually did to pyq_papers.
  papers_inserted          int not null default 0,
  papers_updated           int not null default 0,
  papers_skipped_unchanged int not null default 0,
  papers_failed            int not null default 0,  -- malformed rows / rejected batches

  -- A short, human-readable reason — e.g. 'course-list returned 500' or
  -- 'time budget reached after 412/648 subjects'. It is capped below and must
  -- NEVER contain a response body, an upstream payload or any header value:
  -- this table is readable by anon.
  error_summary            text check (error_summary is null or length(error_summary) <= 300),

  check (finished_at is null or finished_at >= started_at)
);

create index if not exists pyq_sync_runs_started_at_idx
  on public.pyq_sync_runs (started_at desc);
-- Lets "is a run in progress?" be answered without a scan.
create index if not exists pyq_sync_runs_running_idx
  on public.pyq_sync_runs (status)
  where status = 'running';

alter table public.pyq_sync_runs enable row level security;

create policy "anon can view pyq sync runs"
  on public.pyq_sync_runs for select to anon using (true);

create policy "authenticated can view pyq sync runs"
  on public.pyq_sync_runs for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- pyq_sync_config — optional home for the sync secret, so pg_cron can present
-- it without the value ever appearing in this file, in the repository, or in a
-- function log. Exactly like public.push_cron_config, and deliberately NOT
-- auto-populated: no row means no secret means the cron block at the bottom
-- refuses to schedule anything.
-- ---------------------------------------------------------------------------

create table if not exists public.pyq_sync_config (
  id         boolean primary key default true check (id),
  -- Set this yourself to the same value you store as the function secret
  -- PYQ_SYNC_SECRET, e.g.
  --   insert into public.pyq_sync_config (secret)
  --   values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
  -- Two v4 UUIDs is 256 bits of entropy from core — no pgcrypto needed, and no
  -- guessable default.
  secret     text not null,
  created_at timestamptz not null default now(),
  constraint pyq_sync_config_secret_long check (length(secret) >= 32)
);

alter table public.pyq_sync_config enable row level security;
-- No policies on purpose: the RPC below is the only way to touch it, and it is
-- never granted to anon.
revoke all on public.pyq_sync_config from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants. Read-only to the world, write-only to the service role.
-- ---------------------------------------------------------------------------

grant select on public.pyq_papers     to anon, authenticated;
grant select on public.pyq_sync_runs  to anon, authenticated;

-- Unambiguous: no anonymous or student-token writes, ever. RLS already denies
-- it (there are no insert/update/delete policies); these revokes make the
-- intent survive a future policy edit. The pyq-sync edge function writes with
-- the service-role key, which bypasses RLS by design.
revoke insert, update, delete, truncate, references, trigger
  on public.pyq_papers from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.pyq_sync_runs from anon, authenticated;

-- NOTE: nothing here touches public.qbank_papers. Student-contributed papers
-- and this imported archive are separate tables; qbank_papers keeps its
-- narrowed column-level grants, and poster_code stays unselectable by anon.

-- ---------------------------------------------------------------------------
-- Importer RPCs — SECURITY DEFINER, service-role only.
-- ---------------------------------------------------------------------------

-- The one place the sync secret is checked against the database copy. Mirrors
-- authorize_push_dispatch(): returns a bare boolean so a wrong guess yields
-- false and leaks nothing.
create or replace function public.authorize_pyq_sync(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  if p_secret is null or length(p_secret) < 32 then
    return false;
  end if;
  select secret into v_expected from public.pyq_sync_config limit 1;
  if v_expected is null then
    return false;
  end if;
  return p_secret = v_expected;
end;
$$;

/**
 * Claim a run, or refuse if one is already in flight.
 *
 * Single-flight matters because a full pass is ~648 upstream requests: two
 * overlapping runs would double the load on a third party's public site and
 * race each other's fingerprints. Returns the new run id, or NULL when a run
 * is already 'running' and not older than the stale window — a crashed run
 * therefore self-heals after 45 minutes instead of blocking forever.
 */
create or replace function public.pyq_sync_begin()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active bigint;
  v_id     bigint;
begin
  select id into v_active
    from public.pyq_sync_runs
   where status = 'running'
     and started_at > now() - interval '45 minutes'
   order by started_at desc
   limit 1;

  if v_active is not null then
    return null;
  end if;

  insert into public.pyq_sync_runs (status)
    values ('running')
  returning id into v_id;

  return v_id;
end;
$$;

/**
 * Close a run with its counters and, if anything went wrong, a short summary.
 * The summary is truncated here rather than rejected, because losing the whole
 * run record is worse than losing the tail of its explanation.
 */
create or replace function public.pyq_sync_finish(
  p_run_id                 bigint,
  p_status                 text,
  p_subjects_enumerated    int default 0,
  p_subjects_fetched       int default 0,
  p_papers_discovered      int default 0,
  p_papers_inserted        int default 0,
  p_papers_updated         int default 0,
  p_papers_skipped_unchanged int default 0,
  p_papers_failed          int default 0,
  p_error_summary          text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if p_status not in ('running', 'complete', 'partial', 'failed') then
    return false;
  end if;

  update public.pyq_sync_runs
     set status                   = p_status,
         finished_at              = now(),
         subjects_enumerated      = coalesce(p_subjects_enumerated, 0),
         subjects_fetched         = coalesce(p_subjects_fetched, 0),
         papers_discovered        = coalesce(p_papers_discovered, 0),
         papers_inserted          = coalesce(p_papers_inserted, 0),
         papers_updated           = coalesce(p_papers_updated, 0),
         papers_skipped_unchanged = coalesce(p_papers_skipped_unchanged, 0),
         papers_failed            = coalesce(p_papers_failed, 0),
         error_summary            = left(nullif(trim(p_error_summary), ''), 300)
   where id = p_run_id
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

/**
 * Everything the Q-Bank header shows: how much is here and how fresh it is.
 * Aggregated server-side so the client never pulls the table to count it.
 */
create or replace function public.pyq_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last      public.pyq_sync_runs%rowtype;
  v_papers    bigint;
  v_subjects  bigint;
  v_chennai   bigint;
begin
  select * into v_last
    from public.pyq_sync_runs
   where status <> 'running'
   order by started_at desc
   limit 1;

  select count(*), count(distinct nullif(course_code, '')),
         count(*) filter (where campus = 'Chennai')
    into v_papers, v_subjects, v_chennai
    from public.pyq_papers;

  return jsonb_build_object(
    'papers', v_papers,
    'subjects', v_subjects,
    'chennaiPapers', v_chennai,
    'lastSyncAt', case when v_last.id is null then null else v_last.finished_at end,
    'lastStatus', v_last.status,
    'lastRunStartedAt', v_last.started_at,
    'subjectsEnumerated', v_last.subjects_enumerated,
    'subjectsFetched', v_last.subjects_fetched,
    'papersDiscovered', v_last.papers_discovered,
    'papersInserted', v_last.papers_inserted,
    'papersUpdated', v_last.papers_updated,
    'papersSkippedUnchanged', v_last.papers_skipped_unchanged,
    'papersFailed', v_last.papers_failed,
    'errorSummary', v_last.error_summary
  );
end;
$$;

grant execute on function public.pyq_status() to anon, authenticated;

/**
 * Facet lists with real row counts, for the Q-Bank filter chips.
 *
 * This exists so the browser never pulls the table to find out what is in it.
 * Answering "which exam types are here?" from PostgREST would mean either a
 * `distinct` request PostgREST may or may not honour, or fetching every row's
 * facet columns — ~3.1k rows of payload to render eight chips. One aggregate
 * over an indexed 3k-row table costs a few hundred blocks and answers all five
 * facets at once.
 *
 * Values are grouped exactly as pyq_papers stores them (already normalised by
 * the importer: course_code uppercased, whitespace collapsed), and NULL/empty
 * comes back as 'Unspecified' with its count, so a gap upstream stays visible
 * instead of becoming an invisible filter that quietly drops papers.
 * The arrays are unordered — the client sorts them by meaning (canonical exam
 * order, newest academic year first), which is presentation, not data.
 */
create or replace function public.pyq_facets()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with
    f_exam as (
      select coalesce(nullif(trim(exam_type), ''), 'Unspecified') as value, count(*) as papers
        from public.pyq_papers group by 1
    ),
    f_year as (
      select coalesce(nullif(trim(academic_year), ''), 'Unspecified') as value, count(*) as papers
        from public.pyq_papers group by 1
    ),
    f_semester as (
      select coalesce(nullif(trim(semester), ''), 'Unspecified') as value, count(*) as papers
        from public.pyq_papers group by 1
    ),
    f_slot as (
      select coalesce(nullif(trim(slot), ''), 'Unspecified') as value, count(*) as papers
        from public.pyq_papers group by 1
    ),
    f_campus as (
      select coalesce(nullif(trim(campus), ''), 'Unspecified') as value, count(*) as papers
        from public.pyq_papers group by 1
    )
  select jsonb_build_object(
    'papers',     (select count(*) from public.pyq_papers),
    'examType',   coalesce((select jsonb_agg(jsonb_build_object('value', value, 'papers', papers)) from f_exam),     '[]'::jsonb),
    'year',       coalesce((select jsonb_agg(jsonb_build_object('value', value, 'papers', papers)) from f_year),     '[]'::jsonb),
    'semester',   coalesce((select jsonb_agg(jsonb_build_object('value', value, 'papers', papers)) from f_semester), '[]'::jsonb),
    'slot',       coalesce((select jsonb_agg(jsonb_build_object('value', value, 'papers', papers)) from f_slot),     '[]'::jsonb),
    'campus',     coalesce((select jsonb_agg(jsonb_build_object('value', value, 'papers', papers)) from f_campus),   '[]'::jsonb)
  );
$$;

grant execute on function public.pyq_facets() to anon, authenticated;

grant execute on function public.authorize_pyq_sync(text)                          to service_role;
grant execute on function public.pyq_sync_begin()                                  to service_role;
grant execute on function public.pyq_sync_finish(bigint, text, int, int, int, int, int, int, int, text) to service_role;

-- Keep the write-path RPCs off the public menu: anon must not be able to open
-- or close a run, nor use the secret check as a guessing oracle.
revoke execute on function public.authorize_pyq_sync(text)                          from public, anon, authenticated;
revoke execute on function public.pyq_sync_begin()                                  from public, anon, authenticated;
revoke execute on function public.pyq_sync_finish(bigint, text, int, int, int, int, int, int, int, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- OPTIONAL: once-a-day schedule, exactly as best-effort as the push dispatcher
-- (20260915000004). Everything below is non-fatal — with no pg_cron, no pg_net
-- or no configured secret, the app keeps serving the metadata already in
-- pyq_papers and an operator can trigger a sync by hand.
--
-- TO ACTIVATE (three deliberate steps, in this order):
--   1. Create a secret and store it in the database, so the value never lives
--      in this file or in the repository:
--        insert into public.pyq_sync_config (secret)
--        values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
--        on conflict (id) do nothing;
--   2. Give the edge function the SAME value:
--        supabase secrets set PYQ_SYNC_SECRET='<the value from step 1>'
--      (it is never set in a client, and never committed.)
--   3. Re-run this migration. Without step 1 the block below finds no secret
--      and refuses to schedule, rather than wiring up a job that would 401
--      every day and look like it was working.
--
-- Nothing here deletes rows: the function itself is the policy — it upserts by
-- fingerprint and leaves everything it did not touch alone.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
exception when others then
  raise notice 'pyq-sync: pg_cron could not be enabled (%) — enable it in Database → Extensions, then run this file again', sqlerrm;
end;
$$;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pyq-sync: pg_net could not be enabled (%) — enable it in Database → Extensions, then run this file again', sqlerrm;
end;
$$;

-- Replace any previous job so this file stays safe to run twice.
do $$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'pyq-sync' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
exception when others then
  raise notice 'pyq-sync: could not inspect cron.job (%)', sqlerrm;
end;
$$;

do $$
declare
  -- Your project's own URL (public, not a secret). Replace <project-ref>.
  v_project_url text := 'https://<project-ref>.supabase.co';
  v_secret      text;
  v_http_schema text;
  v_command     text;
begin
  -- No operator-configured secret -> no schedule. Never a default, never a
  -- placeholder, never a guessable value.
  select secret into v_secret from public.pyq_sync_config limit 1;
  if v_secret is null or length(v_secret) < 32 then
    raise notice 'pyq-sync: PYQ_SYNC_SECRET is not configured in public.pyq_sync_config, so no cron job was created — follow the three steps above, or trigger the sync yourself (see supabase/functions/pyq-sync)';
    return;
  end if;

  -- pg_net may live in `net`, in `extensions`, or wherever an operator put it.
  select n.nspname into v_http_schema
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post'
   order by (n.nspname = 'net') desc, (n.nspname = 'extensions') desc
   limit 1;

  if v_http_schema is null then
    raise notice 'pyq-sync: pg_net is not available, so no cron job was created — enable it in Database → Extensions and re-run this file';
    return;
  end if;

  -- 03:40 VIST (22:10 UTC) — quiet, and far from the push dispatcher's cadence.
  -- The secret is read from the table at every run, so it is not baked into the
  -- cron job either.
  v_command := format(
    $cmd$select %I.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-pyq-secret', (select secret from public.pyq_sync_config limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );$cmd$,
    v_http_schema,
    v_project_url || '/functions/v1/pyq-sync'
  );

  perform cron.schedule('pyq-sync', '40 3 * * *', v_command);
  raise notice 'pyq-sync: scheduled daily at 03:40 VIST through %', v_http_schema;
exception when others then
  raise notice 'pyq-sync: scheduling failed (%) — set the cron job up in Supabase → Integrations → Cron instead', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
