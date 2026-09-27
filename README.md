# UltraCC

A student portal for **VIT Chennai** that brings academic records, attendance,
timetable, examinations, LMS coursework and campus services into one web and
PWA experience.

UltraCC is an independent, community project. It is not affiliated with,
sponsored by, or endorsed by Vellore Institute of Technology.

## Features

- **Academics** — profile, attendance (with prediction), internal marks, grades
  and CGPA, weekly timetable, syllabus, academic calendar, exam schedule and
  seating, and FFCS planning with friend comparison.
- **LMS** — Moodle courses, assignments and deadlines, synced to a local cache.
- **Campus** — map, transport, facilities, rooms and labs, library, events,
  faculty directory and student services.
- **Student tools** — study groups, cab sharing, question bank, calendar
  export, and light/dark/midnight themes.
- **PWA** — installable, offline-capable, with background web-push reminders.

## Architecture

A React frontend talks to Supabase Edge Functions, which are the only place
authenticated university traffic happens. VTOP and Moodle credentials never
reach the browser; the functions hold the session server-side and return
normalized JSON.

- Session tokens are AES-GCM encrypted and kept in browser memory, gone on
  reload or logout.
- Credentials are not persisted; normalized data is cached in IndexedDB for
  offline viewing.
- Where an external source has no data, the UI says so instead of fabricating
  it.

## Tech stack

React + TypeScript · Vite · Tailwind CSS · Supabase (Edge Functions + Postgres)
· Vitest · Tesseract.js (CAPTCHA OCR) · optional Gemini API.

## Getting started

Requirements: Node.js 20+, and a Supabase project for the gateway functions.

```bash
git clone https://github.com/TGFUKAUSIK/UltraCC.git
cd UltraCC
cp .env.example .env.local   # fill in your gateway URLs and anon key
npm install
npm run dev                  # http://localhost:3000
```

Server-side secrets (the gateway `SESSION_SECRET`, VAPID keys) live in Supabase,
never in `.env.local`. Never commit `.env*`, credentials, or keys.

## Deployment

- **Frontend** — Vercel auto-deploys the `main` branch.
- **Edge Functions** — `npx supabase functions deploy <name> --project-ref <ref>`
  for `vtop-gateway`, `lms-gateway`, `event-hub`, `faculty-directory`,
  `campus-data`, `compute_grade_stats`, `push-dispatch`, and `pyq-sync`.
- **Database** — `supabase db push` applies the migrations in
  `supabase/migrations/`.

`push-dispatch` (background reminders) and `pyq-sync` (question-paper archive)
are called by scheduled jobs with a shared secret rather than a signed-in
browser, so they deploy with `--no-verify-jwt`. See the notes below.

### Background notifications

Class and quiz reminders work on-device while the app is open. For reminders
with the browser closed:

```bash
supabase db push
npm run vapid                       # prints a VAPID keypair
supabase functions deploy push-dispatch --no-verify-jwt
supabase secrets set VAPID_PUBLIC_KEY="…" VAPID_PRIVATE_KEY="…" VAPID_SUBJECT="mailto:you@example.com"
```

The dispatcher's trigger secret is generated inside the database
(`public.push_cron_config`) so it is never committed or stored in the function
environment.

### Question-paper archive

Q-Bank's full archive is a Postgres mirror of CodeChef-VIT's paper index
(metadata only; the PDFs stay on their hosts). The importer is `pyq-sync`.
See `THIRD_PARTY_NOTICES.md` for the attribution and licence.

```bash
supabase db push
npx supabase functions deploy pyq-sync --no-verify-jwt
```

Then create the shared secret, hand it to the function, and register the daily
schedule — in that order, since the schedule migration refuses to run until the
secret exists:

```bash
supabase db query --linked -o csv \
  "insert into public.pyq_sync_config (secret) \
   values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) \
   on conflict (id) do update set secret = excluded.secret returning secret;" > ~/.pyq_secret

supabase secrets set PYQ_SYNC_SECRET="$(tail -1 ~/.pyq_secret | tr -d '\r\n')"

supabase db push
```

## Validation

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Project structure

```
src/          frontend application
public/       static assets (icons, manifest, service worker)
supabase/     edge functions and database migrations
scripts/      build helpers
```

## Security

- Do not commit credentials, keys, or session cookies.
- Keep the service-role key server-side; only the public anon key ships to the
  browser.
- Clear cached account data on logout or account switch.

See `VTOP_AUTH_FLOW.md` for the VTOP session flow.

## Contributing

Bug reports and pull requests are welcome. A good change preserves existing
behaviour, keeps authentication boundaries intact, avoids fabricated
university data, and adds tests for meaningful logic. Run the validation
commands above before opening a PR.

Do not include personal student data, credentials, or tokens in issues or pull
requests.

## License

MIT — see [LICENSE](./LICENSE). Copyright (c) 2026 Kausik SS.

Third-party references and runtime services are documented in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## References

UltraCC was developed independently. These public student projects were used
as references for ideas and research only, with no code incorporated:

- [UniCC](https://github.com/Arya4930/UniCC) (MIT)
- [android-vtop-chennai](https://github.com/therealsujitk/android-vtop-chennai) (GPL-3.0)
- [CodeChef-VIT Papers](https://github.com/CodeChefVIT/papers-codechef)
  (MIT, Copyright (c) 2025 CodeChef-VIT) — source of the Q-Bank archive,
  mirrored metadata-only under the MIT licence.

UltraCC is not a fork of any of these projects.
