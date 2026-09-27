# vtop-gateway — Supabase Edge Function

Stateless VTOP Chennai (vtopcc.vit.ac.in) proxy. The browser sends an opaque
AES-GCM `sessionToken` on every authenticated request; this function decrypts
it, performs the VTOP HTTP call, re-encrypts the updated session state, and
returns clean JSON to the browser.

**NOT zero-knowledge.** VTOP credentials (registration number, password,
CAPTCHA) transit this function over HTTPS. They are never stored or logged.
The UI shows this notice to the student.

## Deploy

```bash
# 1. Set a strong random secret FIRST — the function refuses to run without it.
supabase secrets set SESSION_SECRET="$(openssl rand -hex 32)"

# 2. Deploy
supabase functions deploy vtop-gateway
```

> Why SESSION_SECRET is required: the session token encrypts the full VTOP
> cookie jar + CSRF + authorizedID. A deterministic fallback derived from
> public values (SUPABASE_URL) would let anyone decrypt a stolen token. There
> is no fallback — the function errors loudly if the env var is missing.

## Verified flow (live, credential-free probes 2026-08-10)

```
GET  /vtop/login          -> role chooser, _csrf, sets JSESSIONID+SERVERID+cookiesession1
POST /vtop/prelogin/setup -> arms the session (redirect chain followed manually)
GET  /vtop/get/new/captcha-> fresh CAPTCHA image fragment
POST /vtop/login          -> _csrf + username + password + captchaStr (the exact
                             field set of VTOP's own form; a gResponse field means
                             the Google reCAPTCHA variant, never the image CAPTCHA)
GET  /vtop/content        -> authenticated home (authorizedIDX marker)
```

## FETCH_DATA targets (all POST, same session, `_csrf` + `authorizedID`)

| target | endpoint | fields |
| --- | --- | --- |
| attendance | processViewStudentAttendance | semesterSubId |
| timetable | processViewTimeTable | semesterSubId |
| marks | examinations/doStudentMarkView | semesterSubId |
| exams | examinations/doSearchExamScheduleForStudent | semesterSubId |
| semesters | academics/common/StudentTimeTableChn | verifyMenu + nocache |
| profile | studentsRecord/StudentProfileAllView | verifyMenu + nocache |
| grades | examinations/examGradeView/StudentGradeHistory | verifyMenu + nocache → CGPA / creditsRegistered / creditsEarned (null = unavailable, never 0) |
| od | processViewAttendanceDetail (per course, via attendance-page handles) | semesterSubId + classId + slotName → OD hours from "On Duty" rows (VIT cap 40 hrs/sem) |
| assignments | — | answered `unavailable: true` (no verified VTOP DA endpoint) |

Key invariants enforced by `session.ts`:

- The **full cookie jar** (JSESSIONID + SERVERID + cookiesession1) is preserved
  across every request and every redirect hop. VTOP's "armed" prelogin state is
  bound to the specific LB node via the affinity cookies — dropping them makes
  `DO_LOGIN` 404 ("session not armed").
- Redirects are followed **manually**, re-sending the jar and capturing
  `Set-Cookie` from every hop, so a redirect can never silently swap the
  session cookie.
- The same session (same JSESSIONID/CSRF) is used for INITIALIZE_SESSION →
  FETCH_CAPTCHA → DO_LOGIN → FETCH_DATA. Diagnostics report
  `sessionIdConsistency: same/different/first-seen` on every response
  (booleans/counts only — never cookie or CSRF values).
- TLS verification is **never disabled**. VTOP's Sectigo chain is supplied via
  `Deno.createHttpClient({ caCerts })`; if that client can't be built the
  function falls back to standard-verification fetch.
- CAPTCHAs are entered manually by the student, sent exactly as typed (they are
  case-sensitive). No OCR, no external solver, nothing sent to any AI.

## Honest verification status

- **VERIFIED (live, pre-auth):** role chooser CSRF, prelogin arming, embedded
  + refresh CAPTCHA, login failure paths, session-not-armed 404 quirk.
- **UNVERIFIED:** authenticated data endpoints (attendance, timetable, marks,
  exams, profile, semesters, grades, od) and their parsers — shapes are
  corroborated by the live-tested MIT-licensed VtopMCP reference and by fixture
  tests, but nothing is marked VERIFIED until a real authenticated session
  proves it. See `src/lib/vtop/verification.ts`.

## Operations

- Every response carries a safe `diag` object and the function logs
  `[vtop-gateway] <ACTION> diag: {...}`. If `sessionIdConsistency` ever says
  `different`, a redirect swapped the session mid-flow — that is a bug.
- VTOP serves a Google reCAPTCHA (unreadable) instead of the image CAPTCHA when
  its risk score for the caller IP is high (Supabase datacenter IPs
  intermittently trip this). The function retries the arming flow up to 3 times
  and reports a clear error if reCAPTCHA persists.
