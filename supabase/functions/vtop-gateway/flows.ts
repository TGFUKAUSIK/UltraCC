/**
 * flows.ts — pure, testable VTOP login-flow logic (no Deno APIs, fetch is
 * injected). Used by index.ts (the Supabase Edge Function) and unit tests.
 *
 * WHY THIS EXISTS (verified live against vtopcc.vit.ac.in):
 *   VTOP intermittently blocks/throttles non-browser egress IPs: POST
 *   /prelogin/setup and POST /login can return Tomcat 404 (a WAF that hides
 *   the endpoint) or the login page can carry a Google reCAPTCHA instead of
 *   the readable image CAPTCHA. Both are TRANSIENT — retrying the whole
 *   arming flow from a FRESH session (new GET /login, new JSESSIONID) usually
 *   succeeds. Re-posting on the SAME session does not help when the block is
 *   session/IP-wide, so each retry re-rolls the session.
 *
 *   The CAPTCHA is generated per-session and cannot be replayed on another
 *   session, so DO_LOGIN is never retried against a different session — a
 *   failed/404 login requires a NEW captcha from a NEW arming.
 *
 * RULES:
 *   - No secrets are ever logged or returned: credentials exist only as
 *     function arguments, and only booleans/counts/typed states come back.
 *   - TLS verification is the caller's concern (index.ts); this module never
 *     disables it.
 */

import { requestWithJar, extractCsrf, extractAuthorizedId } from './session.ts';

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Arming
// ---------------------------------------------------------------------------

export interface ArmResult {
  /** Full cookie jar (JSESSIONID + SERVERID + cookiesession1 ...). */
  cookie: string;
  /** CSRF from the armed student login page (or the role chooser). */
  csrf: string;
  /** Data-URI of the image CAPTCHA served on the armed login page. */
  captchaUri: string;
  /** How many full arming attempts were made. */
  attempts: number;
  /** Whether ANY attempt served the Google reCAPTCHA variant. */
  sawRecaptcha: boolean;
}

export class ArmError extends Error {
  readonly kind: 'unreachable' | 'no-csrf' | 'no-form' | 'no-captcha' | 'recaptcha';
  constructor(kind: ArmError['kind'], message: string) {
    super(message);
    this.name = 'ArmError';
    this.kind = kind;
  }
}

/** Extract the CAPTCHA image data URI from the login page. */
export function extractCaptchaDataUri(html: string): string {
  // VTOP embeds the CAPTCHA as a data URI inside #captchaBlock.
  const m = html.match(/src=["'](data:image\/[a-z]+;base64,[^"']+)["']/i);
  return m ? m[1] : '';
}

/** True when VTOP served the Google reCAPTCHA / hCaptcha variant (unreadable). */
export function hasRecaptcha(html: string): boolean {
  return (
    /data-sitekey="[^"]+"/i.test(html) ||
    /hcaptcha/i.test(html) ||
    // The live-tested reference detects the Google variant by the hidden
    // #gResponse input itself (UniCC: `$('input#gResponse').length === 1`),
    // which catches deployments that render the widget without exposing the
    // sitekey attribute on the input tag.
    /<input[^>]*\bid=["']gResponse["']/i.test(html)
  );
}

function hasStudentLoginForm(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('vtoploginform') ||
    (lower.includes('captchastr') && lower.includes('password') && lower.includes('username'))
  );
}

/**
 * Arm a VTOP student prelogin session and obtain the image CAPTCHA.
 *
 * Each attempt is a FULL re-roll: GET /vtop/login (fresh session + cookies +
 * CSRF) then POST /vtop/prelogin/setup with that session's jar. The attempt
 * succeeds only when the student login form WITH an image CAPTCHA is served.
 * Transient VTOP blocks (404 on setup, reCAPTCHA variant, flaky LB hops,
 * connection errors) are retried with backoff on a fresh session.
 *
 * Throws ArmError (typed) when all attempts fail.
 */
export async function armStudentSession(
  fetchImpl: FetchImpl,
  base: string,
  headers: Record<string, string>,
  maxAttempts = 4,
  /** Hard wall-clock budget for the WHOLE arming flow (all attempts). Kept
   *  below the browser client's gateway deadline so VTOP-side failures come
   *  back as typed errors, not browser-side timeouts. */
  deadlineMs = 55_000
): Promise<ArmResult> {
  let sawRecaptcha = false;
  let lastFormMissing = false;
  const deadlineAt = Date.now() + deadlineMs;
  const remainingMs = () => deadlineAt - Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Never start a new multi-request attempt without budget left; the
    // per-request timeouts inside requestWithJar bound each individual call.
    if (remainingMs() <= 0) {
      throw new ArmError('unreachable', 'VTOP did not respond in time — the portal or its load balancer is too slow right now. Try again shortly.');
    }
    let chooserCookie = '';
    try {
      const chooser = await requestWithJar(fetchImpl, `${base}/login`, { method: 'GET', headers }, '');
      // requestWithJar returns the merged jar as `jar` (not `cookie`).
      // This is the ONLY source of the fresh session cookie.
      chooserCookie = chooser.jar;
      const csrf1 = extractCsrf(chooser.html);
      if (!csrf1) {
        if (attempt < maxAttempts && remainingMs() > 0) { await sleep(Math.min(backoff(attempt), remainingMs())); continue; }
        throw new ArmError('no-csrf', 'Could not obtain a CSRF token from the VTOP role chooser.');
      }

      const setup = await requestWithJar(
        fetchImpl,
        `${base}/prelogin/setup`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ _csrf: csrf1, flag: 'VTOP' }).toString(),
        },
        chooserCookie
      );

      if (setup.status === 404 || !hasStudentLoginForm(setup.html)) {
        // Transient WAF block / session-not-armed / flaky LB hop. A fresh
        // session on the next attempt is the only reliable recovery.
        lastFormMissing = true;
        if (attempt < maxAttempts && remainingMs() > 0) { await sleep(Math.min(backoff(attempt), remainingMs())); continue; }
        throw new ArmError(
          'no-form',
          sawRecaptcha
            ? 'VTOP served a Google reCAPTCHA instead of the image CAPTCHA (the server IP is risk-scored). Retry in a minute or use a different network.'
            : 'VTOP did not serve the student login form. This is usually a temporary block on non-browser connections — retry in a moment.'
        );
      }

      const loginHtml = setup.html;
      const captchaUri = extractCaptchaDataUri(loginHtml);
      if (captchaUri) {
        return {
          cookie: setup.jar || chooserCookie,
          csrf: extractCsrf(loginHtml) || csrf1,
          captchaUri,
          attempts: attempt,
          sawRecaptcha,
        };
      }

      // Login form served but no image captcha: usually the reCAPTCHA variant.
      if (hasRecaptcha(loginHtml)) sawRecaptcha = true;
      if (attempt < maxAttempts && remainingMs() > 0) { await sleep(Math.min(backoff(attempt), remainingMs())); continue; }
      throw new ArmError(
        'no-captcha',
        sawRecaptcha
          ? 'VTOP served a Google reCAPTCHA instead of the image CAPTCHA (the server IP is risk-scored). Retry in a minute or use a different network.'
          : 'No CAPTCHA image was returned on the login page.'
      );
    } catch (err: unknown) {
      if (err instanceof ArmError) throw err;
      // Network / TLS / redirect-loop / timeout failure on this attempt —
      // retry fresh (budget permitting).
      if (attempt < maxAttempts && remainingMs() > 0) {
        await sleep(Math.min(backoff(attempt), remainingMs()));
        continue;
      }
      const timedOut = err instanceof Error && err.message.includes('timed out');
      throw new ArmError(
        'unreachable',
        timedOut
          ? (err instanceof Error ? err.message : String(err))
          : `VTOP is unreachable or refused the connection: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`
      );
    }
  }
  // Unreachable (loop always returns or throws), kept for type narrowing.
  throw new ArmError(
    lastFormMissing ? 'no-form' : 'unreachable',
    'VTOP did not serve the student login form.'
  );
}

// ---------------------------------------------------------------------------
// Login submission
// ---------------------------------------------------------------------------

export interface LoginCreds {
  regNo: string;
  password: string;
  captchaText: string;
}

export type LoginFailureKind =
  | 'not-armed'
  | 'invalid-captcha'
  | 'invalid-credentials'
  /**
   * VTOP's OTHER credential answer, verified live 2026-09-19 by probing the
   * real portal through this gateway: a fresh CAPTCHA with an UNKNOWN login id
   * is answered "Invalid Username/Password", while a login id VTOP RECOGNIZES
   * but a password it does not have is answered "Invalid Credentials". The two
   * messages are therefore not synonyms — this one means the account exists
   * and the password on record differs from what was submitted (changed on the
   * portal, expired and reset, or autofilled out of date).
   */
  | 'password-mismatch'
  /** VTOP's 3-month password policy: the account can only be signed into
   *  after the student changes the password on the portal itself. */
  | 'password-expired'
  | 'locked'
  | 'max-attempts'
  /** VTOP's armed session died between showing the CAPTCHA and the POST. */
  | 'session-expired'
  | 'unknown-failure';

/**
 * What VTOP actually served back for POST /login, in safe bounded form: the
 * status, the final path, the size, which known page shape matched, and the
 * text from VTOP's own error slot. No cookie value, no token, and the message
 * is redacted against the credentials that were just submitted.
 */
export interface LoginResponseShape {
  status: number;
  /** Path only of the final URL after redirects, e.g. "/vtop/login/error". */
  path: string;
  bytes: number;
  /** The dashboard authorizedIDX marker appeared inline. */
  marker: boolean;
  /** The student login form was served again (i.e. not authenticated). */
  loginForm: boolean;
  /** A Google reCAPTCHA / hCaptcha risk widget was served. */
  recaptcha: boolean;
  /** VTOP's own error-slot message, redacted and truncated. */
  alert: string;
  /** Outcome of the authenticated /vtop/content probe on the same session. */
  contentProbe: 'not-run' | 'marker' | 'none' | 'error';
}

export interface LoginOutcomeBase {
  cookie: string;
  csrf: string;
  url: string;
  shape: LoginResponseShape;
}

export type LoginOutcome =
  | (LoginOutcomeBase & { kind: 'success'; authorizedId: string })
  | (LoginOutcomeBase & { kind: LoginFailureKind });

/** Strip markup/entities down to readable text (bounded by the caller). */
function toText(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hide anything the student just typed if VTOP happens to echo it back. */
function redact(text: string, creds: LoginCreds): string {
  let out = text;
  for (const secret of [creds.password, creds.regNo.trim(), creds.captchaText]) {
    if (secret && secret.length >= 3) out = out.split(secret).join('***');
  }
  return out;
}

/**
 * VTOP shows login problems in ONE fixed slot, not scattered through the page:
 *   <span class="text-danger text-center" role="alert"><strong> Invalid
 *   Captcha </strong></span>
 * (captured live — see src/lib/vtop/__fixtures__/realLoginFixtures.ts). Reading
 * that slot is far more reliable than grepping a whole page for wording VTOP
 * may change, and it is what lets the app name the real failure instead of
 * guessing "the page structure may have changed".
 */
export function extractVtopAlertText(html: string): string {
  const slot =
    html.match(/<[^>]*\brole=["']alert["'][^>]*>([\s\S]*?)<\/[a-z]+>/i)?.[1] ||
    html.match(/<span[^>]*class=["'][^"']*text-danger[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
    '';
  return toText(slot).slice(0, 140);
}

/** Phrases read from the alert slot — checked in order, first match wins. */
const ALERT_KINDS: [RegExp, LoginFailureKind][] = [
  [/captcha\s*(mismatch|is\s*(wrong|incorrect)|failed)|invalid\s*captcha|wrong\s*captcha|re-?enter\s*(the\s*)?captcha/i, 'invalid-captcha'],
  // EXACT phrase, checked before the generic credential pattern: live probes
  // (2026-09-19) show VTOP answers a KNOWN login id + wrong password with
  // "Invalid Credentials" and an UNKNOWN login id with "Invalid
  // Username/Password". Telling those apart is the difference between "retype
  // your login id" and "the password VTOP has is not this one".
  [/^\s*invalid\s+credentials\s*$/i, 'password-mismatch'],
  [/(invalid|incorrect|wrong)\s*(user\s*name|username|user\s*id|login\s*id|credentials?|password)|password\s*(is\s*)?(invalid|incorrect|wrong)/i, 'invalid-credentials'],
  // VTOP expires student passwords on a rolling window and says so in the same
  // slot it uses for every other login problem. The live-tested reference
  // (UniCC) matches this page-wide on the word "months"; here it is read from
  // the alert slot only, where VTOP puts the actual reason.
  [/password\s*(has\s*)?(got\s*)?(expired|expired\s*after)|expired\s*password|change\s*(your|the)\s*password|reset\s*(your|the)\s*password/i, 'password-expired'],
  [/account\s*(is\s*)?locked|locked\s*account/i, 'locked'],
  [/maximum\s*fail(ed)?\s*attempts?|too\s*many\s*(failed\s*|invalid\s*)?(login\s*)?attempts|attempt(s)?\s*limit/i, 'max-attempts'],
  [/session\s*(has\s*)?(expired|timed\s*out|invalid)|invalid\s*session|expired\s*session|please\s*(log\s*in|login)\s*again/i, 'session-expired'],
];

/**
 * Classify what VTOP served back. The alert slot decides first — it is where
 * the portal puts the real reason, and it is the only place a session-expiry
 * message is trusted (VTOP's own scripts mention expiry on every page). The
 * four phrases verified live are then matched page-wide as a fallback.
 */
function classifyFailure(html: string, alert: string): LoginFailureKind {
  if (alert) {
    for (const [re, kind] of ALERT_KINDS) if (re.test(alert)) return kind;
  }
  const lower = html.toLowerCase();
  if (lower.includes('invalid captcha')) return 'invalid-captcha';
  // Only when VTOP's error slot was empty: the exact phrase, page-wide.
  if (/\binvalid\s+credentials\b/.test(lower)) return 'password-mismatch';
  if (/invalid\s*(user\s*name|login\s*id|user\s*id)\s*\/\s*password/.test(lower)) return 'invalid-credentials';
  // Only reached when VTOP's own error slot was empty, so the loose "months"
  // wording (the live reference's expiry signal) is never allowed to hijack a
  // page that already named a different reason. "change your password" is NOT
  // matched here: the login card carries help links with that kind of wording,
  // and a page-wide match would turn every rejection into an expiry claim.
  if (/password.{0,40}expired|expired.{0,20}password|\bthree\s+months\b/.test(lower)) {
    return 'password-expired';
  }
  if (lower.includes('account is locked')) return 'locked';
  if (/maximum\s*fail(ed)?\s*attempts?/.test(lower)) return 'max-attempts';
  return 'unknown-failure';
}

/** One-line, credential-free summary of a failed login response. */
export function describeLoginShape(shape: LoginResponseShape): string {
  const bits = [
    `VTOP replied ${shape.status} at ${shape.path || 'an unexpected address'} (${shape.bytes} bytes)`,
  ];
  if (shape.loginForm) bits.push('it served the login form again');
  if (shape.recaptcha) bits.push('behind a Google/hCaptcha risk check');
  bits.push(shape.alert ? `VTOP said "${shape.alert}"` : 'VTOP left its error message empty');
  bits.push(`/vtop/content probe: ${shape.contentProbe}`);
  return bits.join(' — ');
}

/**
 * Submit credentials + captcha on the ARMED session (same cookie jar, same
 * CSRF). The captcha is single-use and session-bound, so this is never
 * retried against a different session — on any failure the student needs a
 * fresh captcha from a fresh arming.
 *
 * Success = the Chennai authorizedIDX marker appears inline (verified live:
 * a successful POST returns the dashboard HTML with the URL still on
 * /vtop/login), or — as a fallback — on the authenticated /vtop/content page
 * probed with the SAME session.
 */
export async function submitLogin(
  fetchImpl: FetchImpl,
  base: string,
  headers: Record<string, string>,
  session: { cookie: string; csrf: string },
  creds: LoginCreds
): Promise<LoginOutcome> {
  const resp = await requestWithJar(
    fetchImpl,
    `${base}/login`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: session.csrf,
        // Uppercased, exactly like VTOP's own login field does in the browser
        // (`onkeyup="this.value = this.value.toUpperCase()"` in the captured
        // fixture), so the portal always sees the shape it stores. The app's
        // form keeps the student's typing; this is the single normalisation
        // point and it matches VTOP rather than inventing a rule of our own.
        username: creds.regNo.trim().toUpperCase(),
        password: creds.password,
        // The CAPTCHA is submitted exactly as read/typed — never re-cased here.
        captchaStr: creds.captchaText,
        // Nothing else. `gResponse` is not part of VTOP's image-CAPTCHA form:
        // the captured page posts exactly _csrf + username + password +
        // captchaStr, and UniCC's live-tested backend treats the presence of a
        // #gResponse input as the signal that Google reCAPTCHA is in play.
        // Posting the field would make this request look like the reCAPTCHA
        // variant, the opposite of what is wanted.
      }).toString(),
    },
    session.cookie
  );

  // `jar` is the merged cookie jar from requestWithJar — destructure it as
  // `cookie` so the probe and the outcome carry the SAME (possibly updated)
  // session, never the pre-login one and never nothing.
  const { html, jar: cookie, status, url } = resp;
  let csrf = extractCsrf(html) || session.csrf;

  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    path = url ? url.slice(0, 80) : '';
  }
  const shape: LoginResponseShape = {
    status,
    path,
    bytes: html.length,
    marker: false,
    loginForm: /vtoploginform|name=["']captchaStr["']/i.test(html),
    recaptcha: hasRecaptcha(html),
    alert: redact(extractVtopAlertText(html), creds),
    contentProbe: 'not-run',
  };

  if (status === 404) {
    // VERIFIED live: a 404 on POST /login = the prelogin session was NOT
    // armed on the node this request hit. The captcha cannot be replayed —
    // a brand-new captcha is required.
    return { kind: 'not-armed', cookie, csrf, url, shape };
  }

  let authorizedId = extractAuthorizedId(html);
  shape.marker = !!authorizedId;

  if (!authorizedId) {
    // Probe the authenticated home with the SAME jar whenever the marker was
    // not inline — including when the POST served the login form again. A
    // failed login simply gets an unauthenticated page back (no marker), so
    // this cannot invent a success; suppressing it used to turn "the login
    // landed somewhere unexpected" into a false "page structure changed".
    try {
      const contentRes = await requestWithJar(fetchImpl, `${base}/content`, { method: 'GET', headers }, cookie);
      const probeId = extractAuthorizedId(contentRes.html);
      shape.contentProbe = probeId ? 'marker' : 'none';
      if (probeId) {
        authorizedId = probeId;
        csrf = extractCsrf(contentRes.html) || csrf;
      }
    } catch {
      shape.contentProbe = 'error';
      // Keep the original login response if the /content probe fails.
    }
  }

  if (authorizedId) {
    return { kind: 'success', authorizedId, cookie, csrf, url, shape };
  }

  return { kind: classifyFailure(html, shape.alert), cookie, csrf, url, shape };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Progressive backoff with jitter: 700ms, 1400ms, 2100ms ... ± 25%. */
function backoff(attempt: number): number {
  const base = 700 * attempt;
  const jitter = base * (0.75 + Math.random() * 0.5);
  return Math.round(jitter);
}
