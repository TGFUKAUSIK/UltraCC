# VTOP authentication and session flow

UltraCC supports VTOP access through the Supabase `vtop-gateway` Edge
Function. The browser submits credentials and the CAPTCHA over HTTPS during
login. The gateway does not persist credentials or return raw VTOP HTML.

## Login sequence

1. `INITIALIZE_SESSION` creates a VTOP session and returns the CAPTCHA image.
2. The student enters the CAPTCHA in the login modal. Local OCR may prefill a
   suggestion, but the student controls submission.
3. `DO_LOGIN` sends the registration number, password, and CAPTCHA to VTOP
   through the gateway.
4. The gateway encrypts the VTOP cookie jar, CSRF token, and authorization
   marker into an opaque session token.
5. Dataset requests send that token to the gateway, which refreshes and returns
   normalized JSON data.

## Session invariants

VTOP requires the complete cookie jar, including load-balancer affinity cookies,
to survive redirects and subsequent requests. The gateway therefore follows
redirects explicitly and merges every `Set-Cookie` response. It never logs
cookie values, CSRF values, credentials, or raw HTML.

The browser keeps the live session in memory. Saved VTOP credentials only
prefill the login form; they do not create a session by themselves. A page
reload or logout requires the normal login flow again.

## Data handling

Successful responses are parsed into typed records and cached in IndexedDB.
Dataset failures retain the last valid cached value and are reported to the UI.
The cache is local to the browser and is cleared on account switch or logout.

The authenticated endpoints and parser verification ledger are documented in
`src/lib/vtop/verification.ts` and the gateway README.
