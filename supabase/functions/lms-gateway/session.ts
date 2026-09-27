/**
 * session.ts — pure Moodle (LMS) session lifecycle helpers.
 *
 * No Deno APIs, no network side effects (fetch is injected), no secrets.
 * Used by index.ts (the Supabase Edge Function) and by the unit tests.
 *
 * Moodle session model (verified against lms.vit.ac.in):
 *   - GET /login/index.php sets a MoodleSession cookie and embeds a
 *     `logintoken` hidden field (CSRF for the login POST).
 *   - POST /login/index.php with { logintoken, username, password }.
 *     Success -> 303 redirect to /my/ (or the pre-login page); failure ->
 *     the login page is re-rendered in place with a "loginerrors" box.
 *   - The authenticated jar is a single MoodleSession cookie; redirects are
 *     followed MANUALLY so Set-Cookie from every hop is captured and merged
 *     and no hop can silently swap the session cookie.
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
 * Same-name cookies REPLACE; new names append; deletions remove.
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

// ---------------------------------------------------------------------------
// Redirect-aware HTTP with an explicit cookie jar
// ---------------------------------------------------------------------------

export const MAX_REDIRECT_HOPS = 6;

export interface FollowOpts {
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Bound every Moodle hop so a stalled upstream cannot leave sync hanging. */
  timeoutMs?: number;
}

export interface FollowResult {
  html: string;
  jar: string;
  status: number;
  url: string;
  hops: number;
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

/**
 * fetch with a full cookie jar and MANUAL redirect following.
 *
 * Every hop re-sends the full jar via the Cookie header, captures ALL
 * Set-Cookie headers and merges them into the jar, and follows Location per
 * browser semantics (303 -> GET; 301/302 POST -> GET; 307/308 keep method+body).
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
  const headers: Record<string, string> = { ...opts.headers };
  let currentJar = jar;

  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const hopHeaders: Record<string, string> = { ...headers };
    if (currentJar) hopHeaders['Cookie'] = currentJar;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await fetchImpl(currentUrl, {
        method,
        headers: hopHeaders,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`LMS upstream request timed out after ${opts.timeoutMs ?? 20_000}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const setCookies = extractSetCookies(res.headers);
    const mergedJar = mergeCookieJar(currentJar, setCookies);

    const location = res.headers.get('location');
    if (res.status >= 301 && res.status <= 308 && res.status !== 304 && location) {
      const next = new URL(location, currentUrl);
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        delete headers['Content-Type'];
      }
      currentUrl = next.href;
      currentJar = mergedJar;
      continue;
    }

    const html = await res.text();
    return { html, jar: mergedJar, status: res.status, url: currentUrl, hops: hop + 1 };
  }

  throw new Error('LMS request exceeded maximum redirect hops');
}

// ---------------------------------------------------------------------------
// SAFE session diagnostics (booleans/counts only — never values)
// ---------------------------------------------------------------------------

export interface SessionDiag {
  /** Whether the jar contains any cookies at all. */
  sessionExists: boolean;
  /** Whether a MoodleSession cookie is present (value never exposed). */
  moodleSessionExists: boolean;
  /** Whether a logintoken/CSRF is present (value never exposed). */
  logintokenExists: boolean;
  /** Number of cookies in the jar. */
  cookieCount: number;
  /** Whether the current session cookie matches the one first seen. */
  sessionIdConsistency: 'same' | 'different' | 'first-seen';
}

/** Truncated SHA-256 (first 16 hex chars) — safe to compare/log, not reversible. */
export async function safeHash(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, 16);
}

/** Hash of the MoodleSession value in a jar ('' when absent). Never the value. */
export async function lmsSessionHash(jar: string): Promise<string> {
  const pair = parseCookieJar(jar).find((c) => c.name === 'MoodleSession');
  return pair ? await safeHash(pair.value) : '';
}

export async function buildSessionDiag(
  jar: string,
  logintoken: string,
  firstSeenHash?: string
): Promise<SessionDiag> {
  const pairs = parseCookieJar(jar);
  const hasSession = pairs.some((c) => c.name === 'MoodleSession');
  const hash = hasSession ? await lmsSessionHash(jar) : '';
  const consistency: SessionDiag['sessionIdConsistency'] =
    !firstSeenHash
      ? 'first-seen'
      : hash === firstSeenHash
        ? 'same'
        : 'different';
  return {
    sessionExists: pairs.length > 0,
    moodleSessionExists: hasSession,
    logintokenExists: !!logintoken,
    cookieCount: pairs.length,
    sessionIdConsistency: consistency,
  };
}
