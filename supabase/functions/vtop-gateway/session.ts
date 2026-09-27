/**
 * session.ts — pure VTOP session lifecycle helpers.
 *
 * No Deno APIs, no network side effects (fetch is injected), no secrets.
 * Used by index.ts (the Supabase Edge Function) and by the unit tests.
 *
 * WHY THIS EXISTS (verified live against vtopcc.vit.ac.in):
 *   VTOP sets THREE cookies on the role-chooser page:
 *     - JSESSIONID        (the session id)
 *     - SERVERID          (load-balancer affinity cookie)
 *     - cookiesession1    (second LB / edge session cookie)
 *   The "armed" prelogin state (created by POST /prelogin/setup) lives on the
 *   specific backend node the session was created on. Preserving ONLY the
 *   JSESSIONID (as the earlier gateway did) makes every request land on a
 *   random LB node, so the DO_LOGIN POST usually 404s with "session not
 *   armed". Preserving the FULL cookie jar fixes it (verified: full jar =
 *   armed 5/5; JSESSIONID-only = armed 0/5).
 *
 *   Redirects are followed MANUALLY so that:
 *     - the full cookie jar is re-sent on every hop, and
 *     - Set-Cookie headers from EVERY hop are captured and merged, so a
 *       redirect can never silently replace the session cookie.
 */

// ---------------------------------------------------------------------------
// Cookie jar primitives
// ---------------------------------------------------------------------------

export interface CookiePair {
  name: string;
  value: string;
}

/** Split a jar string ("a=1; b=2") into name/value pairs. */
export function parseCookieJar(jar: string): CookiePair[] {
  if (!jar) return [];
  const out: CookiePair[] = [];
  for (const part of jar.split(';')) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    const name = (eq >= 0 ? p.slice(0, eq) : p).trim();
    const value = eq >= 0 ? p.slice(eq + 1) : '';
    if (name) out.push({ name, value });
  }
  return out;
}

/** Serialize cookie pairs back into a Cookie header value. */
export function serializeCookieJar(pairs: CookiePair[]): string {
  return pairs.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Pull every Set-Cookie header off a Headers object.
 * Deno (>=1.29) and Node expose getSetCookie(); fall back to the first
 * 'set-cookie' header for older environments.
 */
export function extractSetCookies(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') {
    return h.getSetCookie();
  }
  const first = headers.get('set-cookie');
  return first ? [first] : [];
}

/** Parse a single raw Set-Cookie value into { name, value, isDeletion }. */
export function parseSetCookie(raw: string): { name: string; value: string; isDeletion: boolean } {
  const parts = raw.split(';');
  const first = parts[0] ?? '';
  const eq = first.indexOf('=');
  const name = (eq >= 0 ? first.slice(0, eq) : first).trim();
  const value = eq >= 0 ? first.slice(eq + 1) : '';
  const lower = raw.toLowerCase();
  const maxAge0 = /max-age\s*=\s*0/.test(lower);
  const expired = /expires\s*=.*\b(?:1970|jan\s+01\s+1970)\b/.test(lower);
  return { name, value, isDeletion: (maxAge0 || expired) && value === '' };
}

/**
 * Merge Set-Cookie responses into an existing jar.
 * - A cookie with the same name REPLACES the existing entry.
 * - New names are appended.
 * - Deletions (Max-Age=0 / expired) remove the entry.
 */
export function mergeCookieJar(jar: string, setCookies: string[]): string {
  const pairs = parseCookieJar(jar);
  for (const raw of setCookies) {
    const c = parseSetCookie(raw);
    if (!c.name) continue;
    const existing = pairs.findIndex((p) => p.name === c.name);
    if (c.isDeletion) {
      if (existing >= 0) pairs.splice(existing, 1);
      continue;
    }
    if (existing >= 0) pairs[existing] = { name: c.name, value: c.value };
    else pairs.push({ name: c.name, value: c.value });
  }
  return serializeCookieJar(pairs);
}

/**
 * Extract the CSRF token from VTOP HTML.
 *
 * The Chennai portal emits `_csrf` as a hidden input (`name="_csrf"
 * value="..."`) on the login pages; the Spring Security meta tag
 * (`<meta name="_csrf" content="...">`) also appears on some pages. Both
 * attribute orders are accepted (mirrors the live-tested VtopMCP client's
 * CSRF_RE). Returns '' when absent — the VALUE is never logged.
 */
export function extractCsrf(html: string): string {
  const m =
    html.match(/name=["']_csrf["']\s+(?:content|value)=["']([^"']+)["']/i) ||
    html.match(/(?:content|value)=["']([^"']+)["']\s+name=["']_csrf["']/i);
  return m ? m[1] : '';
}

/** Extract the JSESSIONID value from a jar (or '' when absent). */
export function getJsessionId(jar: string): string {
  const pair = parseCookieJar(jar).find((c) => c.name === 'JSESSIONID');
  return pair ? pair.value : '';
}

/**
 * Extract the post-login authorization identity from VTOP HTML.
 *
 * The Chennai portal (vtopcc.vit.ac.in) embeds it as a hidden input:
 *   <input type="hidden" id="authorizedIDX" value="..." name="authorizedIDX">
 * `id` is the reliable anchor (older deployments use `name`, and attribute
 * order/quoting varies) — verified against the live portal via the
 * MIT-licensed VtopMCP client, which matches `id="authorizedIDX"`.
 * Returns '' when absent. The value is session-scoped; the marker itself is
 * not secret, the VALUE must never be logged.
 */
export function extractAuthorizedId(html: string): string {
  // One pass over the tags; the marker must be an id/name attribute literally
  // called authorizedIDX / authorizedID, quoted any way, on any element, and
  // its `value` attribute must be non-empty. Mentioning the name in text or
  // using it as a VALUE (name="foo" value="authorizedIDX") never matches.
  const isMarkerAttr = /\b(?:id|name)\s*=\s*(?:"authorizedIDX?"|'authorizedIDX?'|authorizedIDX?(?=[\s>]))/i;
  const tags = html.match(/<[a-zA-Z][^>]*>/g);
  if (!tags) return '';
  for (const tag of tags) {
    if (!isMarkerAttr.test(tag)) continue;
    const value = tag.match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    const found = value ? (value[1] ?? value[2] ?? value[3] ?? '') : '';
    if (found) return found;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Is this VTOP answer proof that the SESSION is gone?
// ---------------------------------------------------------------------------

/**
 * True when VTOP's RESPONSE BODY proves the session is gone: it served the
 * login page, or says so in words.
 *
 * A bare HTTP 404 deliberately does NOT qualify. A sync fires ~30 FETCH_DATA
 * calls at once, and several VTOP sub-pages genuinely 404 for an ordinary
 * student (no arrears, no wallet, transport not registered, a module not
 * offered this term). If 404 counted as expiry, every one of those answers
 * would null the single session token the whole app runs on and sign a
 * just-logged-in student straight back out. A missing page is a per-dataset
 * answer (`notAvailable` in the gateway response); only VTOP's own login page
 * is evidence of an expired session.
 *
 * The VTOP login form uses a specific id/class marker; incidental sidebar menu
 * items ("Change Password", "Login History") should NOT trigger this.
 */
export function isSessionExpired(html: string, status: number): boolean {
  // 401/403 are VTOP's own "you are not signed in" answers, and say so about
  // the session. A 404 does not — it only says that address has nothing for
  // this student.
  if (status === 401 || status === 403) return true;
  const lower = (html || '').toLowerCase();
  // Only flag as expired when the page is ACTUALLY a login form — not when
  // a sub-page contains incidental login-related text (VTOP menus often
  // include login/logout links even on authenticated pages).
  const hasLoginForm = lower.includes('vtoploginform') ||
    lower.includes('id="login"') ||
    // The actual login form has both logintoken+captcha+password in a form tag
    (lower.includes('logintoken') && lower.includes('captcha') && lower.includes('password'));
  return (
    lower.includes('not authorized') ||
    lower.includes('session expired') ||
    lower.includes('session timed out') ||
    lower.includes('sessiontimeout') ||
    lower.includes('invalid captcha') ||
    hasLoginForm
  );
}

// ---------------------------------------------------------------------------
// Redirect-aware HTTP with an explicit cookie jar
// ---------------------------------------------------------------------------

export const MAX_REDIRECT_HOPS = 6;

export interface FollowOpts {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface FollowResult {
  html: string;
  jar: string;
  status: number;
  url: string;
  hops: number;
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Deadline-aware fetch — a stalled VTOP node must never hang the function
// ---------------------------------------------------------------------------

/** Per-request budget for ONE hop (connection + response headers). */
export const VTOP_HOP_TIMEOUT_MS = 15_000;

/** Abort an in-flight fetch once the deadline passes; returns null on timeout.
 *  Two layers bound the call:
 *    1. ctrl.abort() cancels the real fetch (connect / headers / body).
 *    2. Promise.race settles even if the fetch implementation ignores its
 *       abort signal — requestWithJar can then NEVER hang past the budget.
 *  The abort timer stays armed until `release()` so a stalled response BODY
 *  (headers arrived, body never completes) is also aborted. */
interface DeadlineFetch {
  response: Response;
  /** The abort signal driving this fetch (exposed so body reads can map
   *  an abort to the friendly timeout error). */
  signal: AbortSignal;
  /** Call exactly once, after the response body has been consumed. */
  release: () => void;
}

async function fetchWithDeadline(
  fetchImpl: FetchImpl,
  url: string,
  init: RequestInit,
  deadlineAt: number
): Promise<DeadlineFetch | null> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return null;
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(), remaining);
  let raceTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlinePromise = new Promise<null>((resolve) => {
    raceTimer = setTimeout(() => resolve(null), remaining);
  });
  try {
    const settle = await Promise.race([
      fetchImpl(url, { ...init, signal: ctrl.signal }),
      deadlinePromise,
    ]);
    if (!settle) {
      clearTimeout(abortTimer);
      ctrl.abort(); // deadline won — make sure the real fetch stops too
      return null;
    }
    const response = settle as Response;
    return { response, signal: ctrl.signal, release: () => clearTimeout(abortTimer) };
  } catch (err: unknown) {
    clearTimeout(abortTimer);
    // Timeout (or caller abort) — surface as null so the caller can throw a
    // friendly typed error instead of a raw DOMException.
    if (ctrl.signal.aborted) return null;
    throw err;
  } finally {
    clearTimeout(raceTimer);
  }
}

/** Shared hard cap for a requestWithJar call (all hops included). */
export const VTOP_REQUEST_TIMEOUT_MS = 40_000;

/** Friendly typed message for any deadline breach (connect, headers, body). */
function vtopTimeoutError(): Error {
  return new Error(
    `VTOP request timed out after ${VTOP_HOP_TIMEOUT_MS / 1000}s per hop / ${VTOP_REQUEST_TIMEOUT_MS / 1000}s total (VTOP or its load balancer did not respond)`,
  );
}

/**
 * fetch with a full cookie jar and MANUAL redirect following.
 *
 * Every hop:
 *   - re-sends the full jar via the Cookie header,
 *   - captures ALL Set-Cookie headers and merges them into the jar,
 *   - follows Location per browser semantics (303 → GET; 301/302 POST → GET;
 *     307/308 keep method + body).
 */
export async function requestWithJar(
  fetchImpl: FetchImpl,
  url: string,
  opts: FollowOpts,
  jar: string
): Promise<FollowResult> {
  let currentUrl = url;
  let method = opts.method;
  let body: string | undefined = opts.body;
  // Persistent header set — the Cookie header is added per-hop, and
  // Content-Type is dropped when a POST is converted to a GET.
  const headers: Record<string, string> = { ...opts.headers };
  let currentJar = jar;

  // Hard deadline for the WHOLE call (all redirect hops). A stalled VTOP node
  // (or LB hop that accepts connections but never responds) previously hung
  // the Edge Function indefinitely — the browser then waited forever and the
  // Sign In button stayed greyed out. Both hop-level and whole-call budgets
  // now bound every request.
  const deadlineAt = Date.now() + VTOP_REQUEST_TIMEOUT_MS;

  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const hopHeaders: Record<string, string> = { ...headers };
    if (currentJar) hopHeaders['Cookie'] = currentJar;

    const hopDeadline = Math.min(deadlineAt, Date.now() + VTOP_HOP_TIMEOUT_MS);
    const res = await fetchWithDeadline(fetchImpl, currentUrl, {
      method,
      headers: hopHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
    }, hopDeadline);
    if (!res) {
      throw vtopTimeoutError();
    }
    const { response, signal, release } = res;

    const setCookies = extractSetCookies(response.headers);
    const mergedJar = mergeCookieJar(currentJar, setCookies);

    const location = response.headers.get('location');
    if (response.status >= 301 && response.status <= 308 && response.status !== 304 && location) {
      const next = new URL(location, currentUrl);
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        delete headers['Content-Type'];
      }
      currentUrl = next.href;
      currentJar = mergedJar;
      continue;
    }

    let html = '';
    // Race the body read against the same per-hop budget: a body that never
    // completes must be bounded exactly like a stalled connection.
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      html = await Promise.race([
        response.text(),
        new Promise<never>((_, reject) => {
          bodyTimer = setTimeout(() => reject(vtopTimeoutError()), Math.max(0, hopDeadline - Date.now()));
        }),
      ]);
    } finally {
      clearTimeout(bodyTimer);
      // Stop the abort timer whether the body read succeeded or failed — a
      // pending timer would otherwise abort a LATER request's signal context.
      release();
    }
    return { html, jar: mergedJar, status: response.status, url: currentUrl, hops: hop + 1 };
  }

  throw new Error('VTOP request exceeded maximum redirect hops');
}

// ---------------------------------------------------------------------------
// SAFE session diagnostics
// ---------------------------------------------------------------------------

export interface SessionDiag {
  /** Whether the jar contains any cookies at all. */
  sessionExists: boolean;
  /** Whether the jar contains a JSESSIONID (value never exposed). */
  jsessionidExists: boolean;
  /** Whether a CSRF token is present (value never exposed). */
  csrfExists: boolean;
  /** Number of cookies in the jar. */
  cookieCount: number;
  /** Whether the current JSESSIONID matches the one that was ARMED. */
  sessionIdConsistency: 'same' | 'different' | 'first-seen';
}

/**
 * Truncated SHA-256 (first 16 hex chars) of a secret value.
 * Safe to store/compare/log — cannot be reversed to the original value.
 */
export async function safeHash(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, 16);
}

/** Hash of the JSESSIONID in a jar ('' when absent). Never the value itself. */
export async function sessionJsidHash(jar: string): Promise<string> {
  const jsid = getJsessionId(jar);
  return jsid ? await safeHash(jsid) : '';
}

/**
 * Build the safe diagnostic object.
 * `armedJsidHash` is the hash recorded when the session was armed by
 * prelogin/setup; passing it makes the consistency check meaningful.
 */
export async function buildSessionDiag(
  jar: string,
  csrf: string,
  armedJsidHash?: string
): Promise<SessionDiag> {
  const pairs = parseCookieJar(jar);
  const jsid = pairs.some((c) => c.name === 'JSESSIONID');
  const hash = jsid ? await sessionJsidHash(jar) : '';
  const consistency: SessionDiag['sessionIdConsistency'] =
    !armedJsidHash
      ? 'first-seen'
      : hash === armedJsidHash
        ? 'same'
        : 'different';
  return {
    sessionExists: pairs.length > 0,
    jsessionidExists: jsid,
    csrfExists: !!csrf,
    cookieCount: pairs.length,
    sessionIdConsistency: consistency,
  };
}
