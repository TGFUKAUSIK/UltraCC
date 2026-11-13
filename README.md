# UltraCC

A student portal for **VIT Chennai** that brings academic records, attendance,
timetable, examinations, LMS coursework and campus services into one web and
PWA experience, with an Expo client in `mobile/` for phones.

UltraCC is an independent, community project. It is not affiliated with,
sponsored by, or endorsed by Vellore Institute of Technology.

This repository is a self-hostable edition: it contains no production project
URL, no keys, no student data and no deployment credentials. Everything the app
talks to is configured through the environment variables described below.

## Features

- **Academics** — profile, attendance (with prediction), internal marks, grades
  and CGPA, weekly timetable, syllabus, academic calendar, exam schedule and
  seating, and FFCS planning with friend comparison.
- **Grades** — one projection engine for SGPA, CGPA and per-course letters, a
  grade predictor whose assumptions are labelled, and an opt-in, anonymous
  comparison against the class.
- **LMS** — Moodle courses, assignments and deadlines, synced to a local cache.
- **Campus** — map, transport, facilities, rooms and labs, library, events,
  faculty directory and student services.
- **Student tools** — study groups, cab sharing, question bank, calendar
  export, and light/dark/midnight themes.
- **PWA** — installable, offline-capable, with in-app reminders and optional
  background web push.

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
- The browser never contacts VTOP or Moodle directly — enforced by
  `src/lib/__tests__/upstreamIsolation.test.ts`.

## Tech stack

React + TypeScript · Vite · Tailwind CSS · Supabase (Edge Functions + Postgres)
· Vitest · Tesseract.js (CAPTCHA OCR) · optional Gemini API · Expo (mobile).

## Getting started

Requirements: Node.js 20+ and npm.

```bash
git clone https://github.com/TGFUKAUSIK/UltraCC.git
cd UltraCC
npm install
cp .env.example .env.local   # optional — see Configuration
npm run dev                  # http://localhost:3000
```

Without configuration the app starts and every backend screen states that it is
not configured; nothing is mocked or invented. Values that still read as
placeholders (`your-…`, `<…>`, `example.com`, `your-project.supabase.co`) are
treated as unset, so a half-filled file cannot silently point at someone else's
project.

## Configuration

All frontend values are compiled into the public bundle. Only the Supabase
**anon (publishable) key** belongs in them; the service-role key must never
leave the server.

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env.local` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` | Public anon key for that project |
| `VITE_VTOP_GATEWAY_URL` | `.env.local` | Deployed `vtop-gateway` function URL |
| `VITE_LMS_GATEWAY_URL` | `.env.local` | Deployed `lms-gateway` function URL |
| `VITE_VAPID_PUBLIC_KEY` | `.env.local` | Optional; public half of your VAPID pair |
| `EXPO_PUBLIC_SUPABASE_URL` | `mobile/.env.local` | Same project URL for the app |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `mobile/.env.local` | Same anon key for the app |

Edge-function secrets, set with `supabase secrets set` and never committed:

| Secret | Used by | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | `vtop-gateway`, `lms-gateway` | Random; encrypts upstream sessions |
| `APP_URL` | `vtop-gateway`, `lms-gateway` | Public URL used to build links |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `push-dispatch` | Generate a pair with `npm run vapid` |
| `CRON_SECRET` | `push-dispatch` | Optional override for the generated trigger secret |
| `PYQ_SYNC_SECRET` | `pyq-sync` | 32+ characters; see the question-bank section |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to every function by
the Supabase platform.

The AI Advisor has no operator key. The browser calls Gemini directly with the
key a student saves in Settings, held in that browser only. Do not add a
`VITE_` operator key for it — every `VITE_` value ships to visitors.

## Backend setup (your own Supabase project)

The app expects the edge functions and tables in this repository:

1. Create a Supabase project and link the CLI:
   `npx supabase link --project-ref <your-ref>`.
2. Replace the `<project-ref>` placeholder in the three scheduling migrations
   (`20260915000004_push_cron_schedule.sql`, `20260920000002_pyq_codechef.sql`,
   `20260920000003_pyq_sync_schedule.sql`). It is only used to build the cron
   URL; a placeholder schedules a job that fails harmlessly and can be re-run.
3. Apply the schema: `npx supabase db push`.
4. Deploy the functions:
   `npx supabase functions deploy vtop-gateway lms-gateway event-hub faculty-directory campus-data`
   and the two scheduled ones with `--no-verify-jwt`:
   `npx supabase functions deploy push-dispatch pyq-sync --no-verify-jwt`.
5. Set the secrets from the table above.

Every table is row-level-security protected and denies by default; the browser
only reaches data through the functions and a small set of RPCs. Read the
migration that adds a policy before you change one.

## Deployment

`npm run build` writes a static bundle to `dist/` and a bundled Express server
to `dist/server.cjs` (run it with `npm start`). Any static host works; the
included `vercel.json` carries the cache rules and security headers the app
expects. Set the `VITE_*` values in the host's build environment.

## Background notifications

Class and quiz reminders work on-device while the app is open. For reminders
with the browser closed:

```bash
npm run vapid                       # prints a VAPID keypair
supabase db push
supabase functions deploy push-dispatch --no-verify-jwt
supabase secrets set VAPID_PUBLIC_KEY="…" VAPID_PRIVATE_KEY="…" VAPID_SUBJECT="mailto:you@example.com"
```

Put the public half in `VITE_VAPID_PUBLIC_KEY` and rebuild. The dispatcher's
trigger secret is generated inside the database (`public.push_cron_config`), so
it is never committed or stored in the function environment.

## Question-paper archive

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
npx supabase db query --linked -o csv \
  "insert into public.pyq_sync_config (secret) \
   values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) \
   on conflict (id) do update set secret = excluded.secret returning secret;" > ~/.pyq_secret

npx supabase secrets set PYQ_SYNC_SECRET="$(tail -1 ~/.pyq_secret | tr -d '\r\n')"

npx supabase db push
```

## Mobile app

`mobile/` is an Expo React Native client of the same backend functions. It has
its own `package.json`:

```bash
cd mobile
npm install
cp .env.example .env.local   # EXPO_PUBLIC_SUPABASE_URL and _ANON_KEY
npx expo start
```

The repository ships no signing keystore and no EAS project id, so building a
store binary needs your own Expo account: run `eas init` in `mobile/` to attach
a project, then configure credentials with EAS. The app bundle id is
`com.ultracc.app`; change it if you publish under your own account.

## Known limitations

- **VIT Chennai only.** Other campuses are shown as unavailable rather than
  approximated.
- **Live data needs a deployed backend.** The gateways sign in to VTOP and
  Moodle with the student's own credentials; VTOP markup changes can break a
  parser until it is updated.
- **VTOP publishes no FAT weight**, so grade predictions model it as a labelled
  student assumption rather than a fact.
- **Class comparison is anonymous and per-browser.** It only shows aggregates
  once at least 15 peers have opted in, and clearing site data resets your
  contribution.
- **Push notifications** need `pg_cron` and `pg_net` enabled in your project.

## Validation

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

For the mobile client: `cd mobile && npx tsc --noEmit`.

## Project structure

```
src/          frontend application
public/       static assets (icons, manifest, service worker)
supabase/     edge functions and database migrations
mobile/       Expo React Native client
scripts/      build helpers
```

## Security

- Do not commit credentials, keys, or session cookies.
- Keep the service-role key server-side; only the public anon key ships to the
  browser.
- Clear cached account data on logout or account switch.
- Report vulnerabilities through the private advisory flow described in
  `SECURITY.md`, not the public issue tracker.

See `VTOP_AUTH_FLOW.md` for the VTOP session flow.

## Contributing

See `CONTRIBUTING.md`. Bug reports and pull requests are welcome; run the
validation commands above before opening one, and never include personal
student data, credentials, or tokens.

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
  mirrored metadata-only with their permission.

UltraCC is not a fork of any of these projects.
