-- ---------------------------------------------------------------------------
-- cabshare_rides — community ride-sharing board (VIT Chennai students)
--
-- Community feature (cab share + question bank), privacy-first:
--   - No student registration number / real name is stored.
--   - `contact` is an OPTIONAL handle the poster chooses (e.g. Telegram /
--     phone); posters decide what to expose. The UI never auto-fills it from
--     the VTOP profile.
--   - `poster_code` is a short random code the poster keeps to edit/delete
--     their own ride (no auth required, no account linkage).
--
-- RLS:
--   - anon can INSERT and SELECT (public community board)
--   - UPDATE/DELETE only via matching poster_code (handled in-app; the code
--     itself is the capability token, never stored alongside identity)
-- ---------------------------------------------------------------------------

create table if not exists public.cabshare_rides (
  id          bigint generated always as identity primary key,
  from_place  text not null,
  to_place    text not null,
  travel_date text not null,          -- YYYY-MM-DD
  travel_time text not null,          -- HH:mm
  seats       int  not null check (seats between 1 and 6),
  seats_left  int  not null check (seats_left between 0 and 6),
  notes       text default '',
  contact     text default '',        -- optional poster-chosen contact handle
  poster_code text not null,          -- capability token for edit/delete
  created_at  timestamptz not null default now()
);

create index if not exists cabshare_rides_date_idx
  on public.cabshare_rides (travel_date);

alter table public.cabshare_rides enable row level security;

create policy "anon can view cabshare rides"
  on public.cabshare_rides for select to anon using (true);

create policy "anon can post cabshare rides"
  on public.cabshare_rides for insert to anon with check (true);

-- A ride can be edited/deleted only when the correct poster_code is supplied.
-- The code is a capability token; we never store a hash because there is no
-- account system. The client only ever sends its own code.
create policy "poster can update own ride"
  on public.cabshare_rides for update to anon
  using (poster_code = current_setting('app.poster_code', true))
  with check (poster_code = current_setting('app.poster_code', true));

create policy "poster can delete own ride"
  on public.cabshare_rides for delete to anon
  using (poster_code = current_setting('app.poster_code', true));

-- ---------------------------------------------------------------------------
-- qbank_papers — community question-paper archive (shared by students)
--
-- Privacy: `uploaded_by` is an optional display handle chosen by the student
-- (defaults to 'anonymous'). No registration number is ever stored.
-- Papers are link-based (Google Drive / OneDrive / direct file URL) — the app
-- never uploads the binary itself, keeping storage needs out of the flow.
--
-- RLS: anon INSERT + SELECT (public archive), UPDATE/DELETE by poster code.
-- ---------------------------------------------------------------------------

create table if not exists public.qbank_papers (
  id          bigint generated always as identity primary key,
  course_code text not null,
  course_title text default '',
  exam_type   text default '',        -- CAT-1 / CAT-2 / FAT / Assignment ...
  title       text not null,
  url         text not null,
  uploaded_by text default 'anonymous',
  poster_code text not null,          -- capability token for edit/delete
  created_at  timestamptz not null default now()
);

create index if not exists qbank_papers_course_idx
  on public.qbank_papers (course_code);

alter table public.qbank_papers enable row level security;

create policy "anon can view qbank papers"
  on public.qbank_papers for select to anon using (true);

create policy "anon can share qbank papers"
  on public.qbank_papers for insert to anon with check (true);

create policy "poster can update own paper"
  on public.qbank_papers for update to anon
  using (poster_code = current_setting('app.poster_code', true))
  with check (poster_code = current_setting('app.poster_code', true));

create policy "poster can delete own paper"
  on public.qbank_papers for delete to anon
  using (poster_code = current_setting('app.poster_code', true));
