# lms-gateway — Moodle (VIT LMS) Supabase Edge Function

Stateless proxy for `https://lms.vit.ac.in` (VIT Chennai students' Moodle),
mirroring the `vtop-gateway` architecture exactly.

## Why this exists

The VIT LMS (Moodle 3.x-era, PHP 7.4) exposes **no SSO with VTOP** and has
the **Moodle web services API disabled** (`login/token.php` returns
`enablewsdescription`). The only usable path is the standard Moodle HTML
flow: session cookie + CSRF token, scraped server-side.

## Auth path (researched live)

1. `GET /login/index.php` → sets `MoodleSession` cookie + `logintoken` field
2. `POST /login/index.php` with `{ logintoken, username, password }`
   - Success → 303 redirect to `/my/`
   - Failure → login page re-rendered with `loginerrors`
3. Authenticated requests carry the `MoodleSession` cookie; unauthenticated
   targets 303 → `/login/index.php` (session-expiry detection)

## Actions

| Action | Body | Notes |
|---|---|---|
| `INITIALIZE_SESSION` | — | Fetches login page, returns encrypted session token + `readyForAuth` |
| `DO_LOGIN` | `{ credentials: { username, password } }` | Credentials cleared immediately after use |
| `GET_SESSION_STATUS` | `{ sessionToken }` | GET `/my/`; false → session expired |
| `FETCH_DATA` | `{ sessionToken, dataTarget, courseId? }` | See targets |
| `LOGOUT` | `{ sessionToken }` | GET `/login/logout.php` best-effort |

## FETCH_DATA targets

| target | endpoint | ledger |
|---|---|---|
| `courses` | `GET /my/` | `lms:courses` |
| `assignments` | `GET /mod/assign/index.php?id={courseId}` | `lms:assignments` |
| `quiz-windows` | `GET /mod/quiz/index.php?id={courseId}` + each `/mod/quiz/view.php?id={quizId}` | `lms:quiz-windows` |
| `gradebook` | `GET /grade/report/user/index.php?id={courseId}` | `lms:gradebook` |
| `materials` | `GET /course/view.php?id={courseId}` | `lms:materials` |
| `forum` | course page → first `/mod/forum/view.php?id={forumId}` | `lms:forum` |
| `calendar` | `GET /calendar/view.php?view=upcoming` | `lms:calendar` |

Every target is **UNVERIFIED** until a real authenticated LMS session proves
it (see `src/lib/vtop/verification.ts`). Parsing failures answer
`parseFailed: true` — never silent empties.

## Deploy

```bash
supabase secrets set SESSION_SECRET=$(openssl rand -hex 32)
supabase functions deploy lms-gateway
```

`SESSION_SECRET` is required and shared with `vtop-gateway` (any value, kept
secret). TLS verification is never disabled — VIT's Sectigo intermediate is
provided via `caCerts` (same fix as `vtop-gateway`).

## Security

- Credentials exist only during the `DO_LOGIN` request lifetime.
- `MoodleSession` / `logintoken` travel encrypted (AES-GCM) in the session
  token; the browser never sees their values.
- No raw LMS HTML reaches the browser.
- No credentials, cookies, or HTML are logged.
- **Not zero-knowledge**: LMS credentials transit this function over HTTPS.
