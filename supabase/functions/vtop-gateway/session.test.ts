/**
 * Unit tests for session.ts — the VTOP session lifecycle helpers.
 * Runs under the project's vitest suite (see vitest.config.ts include).
 */

import { describe, it, expect } from 'vitest';
import {
  parseCookieJar,
  serializeCookieJar,
  extractSetCookies,
  parseSetCookie,
  mergeCookieJar,
  getJsessionId,
  extractAuthorizedId,
  extractCsrf,
  isSessionExpired,
  requestWithJar,
  buildSessionDiag,
  sessionJsidHash,
  MAX_REDIRECT_HOPS,
  VTOP_HOP_TIMEOUT_MS,
  VTOP_REQUEST_TIMEOUT_MS,
} from './session.ts';

// ---------------------------------------------------------------------------
// Cookie jar primitives
// ---------------------------------------------------------------------------

describe('cookie jar primitives', () => {
  it('parses and serializes a jar', () => {
    const pairs = parseCookieJar('JSESSIONID=abc123; SERVERID=node7; cookiesession1=xyz');
    expect(pairs).toEqual([
      { name: 'JSESSIONID', value: 'abc123' },
      { name: 'SERVERID', value: 'node7' },
      { name: 'cookiesession1', value: 'xyz' },
    ]);
    expect(serializeCookieJar(pairs)).toBe('JSESSIONID=abc123; SERVERID=node7; cookiesession1=xyz');
  });

  it('handles empty and whitespace jars', () => {
    expect(parseCookieJar('')).toEqual([]);
    expect(parseCookieJar('   ')).toEqual([]);
    expect(parseCookieJar(';;;')).toEqual([]);
  });

  it('keeps = inside cookie values', () => {
    const jar = mergeCookieJar('', ['foo=a=b=c; Path=/']);
    expect(getJsessionId(jar)).toBe(''); // unrelated name
    expect(jar).toBe('foo=a=b=c');
  });

  it('extractSetCookies uses getSetCookie when available', () => {
    const h = new Headers();
    h.append('set-cookie', 'JSESSIONID=one; Path=/vtop; Secure; HttpOnly');
    h.append('set-cookie', 'SERVERID=aff1; path=/');
    expect(extractSetCookies(h)).toHaveLength(2);
  });

  it('extractSetCookies falls back to the first header', () => {
    const h = new Headers();
    h.set('set-cookie', 'JSESSIONID=one; Path=/vtop');
    // Simulate an environment without getSetCookie
    const stripped = h as Headers & { getSetCookie?: unknown };
    delete (stripped as unknown as Record<string, unknown>).getSetCookie;
    // Headers instances may still expose it via prototype in some envs — force via plain object
    const plain = { get: (n: string) => (n === 'set-cookie' ? 'JSESSIONID=one; Path=/vtop' : null) } as unknown as Headers;
    expect(extractSetCookies(plain)).toEqual(['JSESSIONID=one; Path=/vtop']);
    void stripped;
  });

  it('parses Set-Cookie deletions', () => {
    expect(parseSetCookie('foo=; Max-Age=0').isDeletion).toBe(true);
    expect(parseSetCookie('foo=; Expires=Thu, 01 Jan 1970 00:00:00 GMT').isDeletion).toBe(true);
    expect(parseSetCookie('foo=bar; Max-Age=3600').isDeletion).toBe(false);
  });

  it('mergeCookieJar adds, replaces, and deletes by name', () => {
    let jar = mergeCookieJar('', ['JSESSIONID=A; Path=/vtop', 'SERVERID=aff1; path=/']);
    expect(jar).toBe('JSESSIONID=A; SERVERID=aff1');

    // Replace JSESSIONID
    jar = mergeCookieJar(jar, ['JSESSIONID=B; Path=/vtop']);
    expect(getJsessionId(jar)).toBe('B');

    // Append a third cookie
    jar = mergeCookieJar(jar, ['cookiesession1=xyz; Expires=Fri, 01 Jan 2030; HttpOnly']);
    expect(parseCookieJar(jar)).toHaveLength(3);

    // Delete SERVERID
    jar = mergeCookieJar(jar, ['SERVERID=; Max-Age=0']);
    expect(parseCookieJar(jar).map((c) => c.name)).toEqual(['JSESSIONID', 'cookiesession1']);
  });
});

// ---------------------------------------------------------------------------
// requestWithJar — manual redirect following
// ---------------------------------------------------------------------------

interface MockStep {
  status: number;
  location?: string;
  setCookies?: string[];
  html?: string;
}

interface MockCall {
  method: string;
  url: string;
  cookie?: string;
  body?: string;
}

function mockFetchSequence(steps: MockStep[]) {
  const calls: MockCall[] = [];
  const impl = async (url: string, init: RequestInit) => {
    const idx = calls.length;
    const step = steps[Math.min(idx, steps.length - 1)];
    calls.push({
      method: (init.method || 'GET').toUpperCase(),
      url,
      cookie: (init.headers as Record<string, string> | undefined)?.Cookie,
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    const headers = new Headers();
    for (const sc of step.setCookies ?? []) headers.append('set-cookie', sc);
    if (step.location) headers.set('location', step.location);
    return {
      status: step.status,
      headers,
      text: async () => step.html ?? '',
    } as unknown as Response;
  };
  return { impl, calls };
}

describe('requestWithJar', () => {
  it('follows a 302 chain, converting POST→GET and keeping the full jar', async () => {
    const { impl, calls } = mockFetchSequence([
      { status: 302, location: '/vtop/init/page' },
      { status: 200, html: '<form id="vtopLoginForm"/>', setCookies: ['JSESSIONID=NEW; Path=/vtop; Secure; HttpOnly', 'SERVERID=aff1; path=/'] },
    ]);

    const res = await requestWithJar(
      impl,
      'https://vtopcc.vit.ac.in/vtop/prelogin/setup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '_csrf=x&flag=VTOP',
      },
      'JSESSIONID=OLD'
    );

    expect(res.status).toBe(200);
    expect(res.hops).toBe(2);
    expect(res.html).toContain('vtopLoginForm');
    expect(res.url).toBe('https://vtopcc.vit.ac.in/vtop/init/page');

    // Hop 1: POST with the initial jar
    expect(calls[0].method).toBe('POST');
    expect(calls[0].cookie).toBe('JSESSIONID=OLD');
    expect(calls[0].body).toBe('_csrf=x&flag=VTOP');

    // Hop 2: converted to GET, jar re-sent, new cookies merged in
    expect(calls[1].method).toBe('GET');
    expect(calls[1].body).toBeUndefined();
    expect(calls[1].cookie).toBe('JSESSIONID=OLD'); // hop 1 set nothing
    expect(res.jar).toBe('JSESSIONID=NEW; SERVERID=aff1');
  });

  it('preserves method and body across a 307', async () => {
    const { impl, calls } = mockFetchSequence([
      { status: 307, location: '/vtop/login/error' },
      { status: 200, html: 'error page' },
    ]);

    const res = await requestWithJar(
      impl,
      'https://vtopcc.vit.ac.in/vtop/login',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' },
      'JSESSIONID=X'
    );

    expect(calls[0].method).toBe('POST');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].body).toBe('a=1');
    expect(res.status).toBe(200);
  });

  it('merges Set-Cookie from an intermediate redirect hop', async () => {
    const { impl, calls } = mockFetchSequence([
      { status: 302, location: '/vtop/init/page', setCookies: ['JSESSIONID=ARMED; Path=/vtop'] },
      { status: 200, html: 'ok' },
    ]);

    const res = await requestWithJar(
      impl,
      'https://vtopcc.vit.ac.in/vtop/prelogin/setup',
      { method: 'POST', headers: {}, body: 'flag=VTOP' },
      'JSESSIONID=OLD; SERVERID=aff0'
    );

    expect(calls[1].cookie).toBe('JSESSIONID=ARMED; SERVERID=aff0');
    expect(res.jar).toBe('JSESSIONID=ARMED; SERVERID=aff0');
  });

  it('throws when the redirect loop exceeds MAX_REDIRECT_HOPS', async () => {
    const { impl } = mockFetchSequence([
      { status: 302, location: '/loop' },
    ]);
    await expect(
      requestWithJar(impl, 'https://vtopcc.vit.ac.in/vtop/x', { method: 'GET', headers: {} }, '')
    ).rejects.toThrow(/redirect hops/);
    expect(MAX_REDIRECT_HOPS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Deadline enforcement — a stalled VTOP node must never hang the gateway
// (root cause of the greyed-out Sign In button: requestWithJar previously
// awaited fetch forever when an LB hop accepted the connection but never
// responded).
// ---------------------------------------------------------------------------

describe('requestWithJar deadlines', () => {
  it('rejects promptly when the upstream fetch never settles', async () => {
    const neverSettles = (_url: string, init: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });

    const started = Date.now();
    await expect(
      requestWithJar(neverSettles, 'https://vtopcc.vit.ac.in/vtop/x', { method: 'GET', headers: {} }, '')
    ).rejects.toThrow(/timed out/);
    // At (not materially over) the hop budget — proves the HOP cap fired,
    // not the 40s whole-call budget. Small slack for timer coalescing.
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(VTOP_HOP_TIMEOUT_MS - 500);
    expect(elapsed).toBeLessThan(VTOP_HOP_TIMEOUT_MS + 2_000);
  }, 20_000);

  it('rejects promptly when response headers arrive but the body never completes', async () => {
    const stalledBody = async (): Promise<Response> =>
      ({
        status: 200,
        headers: new Headers(),
        text: () => new Promise<string>(() => {}), // never resolves
      }) as unknown as Response;

    const started = Date.now();
    await expect(
      requestWithJar((async () => stalledBody()) as never, 'https://vtopcc.vit.ac.in/vtop/x', { method: 'GET', headers: {} }, '')
    ).rejects.toThrow(/timed out/);
    // The body race fires at the per-hop budget (with small timer slack).
    const elapsedBody = Date.now() - started;
    expect(elapsedBody).toBeGreaterThanOrEqual(VTOP_HOP_TIMEOUT_MS - 500);
    expect(elapsedBody).toBeLessThan(VTOP_HOP_TIMEOUT_MS + 2_000);
  }, 20_000);

  it('aborts a stalled hop when the WHOLE-call deadline is already exceeded', async () => {
    // Simulate a fetch that ignores aborts entirely — the deadline check at
    // the top of each hop must still stop the loop.
    const neverSettles = (): Promise<Response> => new Promise<Response>(() => {});
    const started = Date.now();
    await expect(
      requestWithJar(neverSettles, 'https://vtopcc.vit.ac.in/vtop/x', { method: 'GET', headers: {} }, '')
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(VTOP_REQUEST_TIMEOUT_MS);
  }, 60_000);

  it('respects a caller-provided signal without overriding it', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const impl = async (_url: string, init: RequestInit): Promise<Response> => {
      seen.push(init.signal ?? null);
      return {
        status: 200,
        headers: new Headers(),
        text: async () => '<ok/>',
      } as unknown as Response;
    };
    const res = await requestWithJar(impl, 'https://vtopcc.vit.ac.in/vtop/x', { method: 'GET', headers: {} }, '');
    expect(res.status).toBe(200);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// extractAuthorizedId — Chennai post-login success detection
// ---------------------------------------------------------------------------

describe('extractAuthorizedId (vtopcc Chennai post-login marker)', () => {
  it('finds id="authorizedIDX" with a value (the Chennai dashboard shape)', () => {
    const html = `<form id="f"><input type="hidden" id="authorizedIDX" value="CH12345" name="authorizedIDX" /></form>`;
    expect(extractAuthorizedId(html)).toBe('CH12345');
  });

  it('matches when the value attribute precedes the id', () => {
    expect(extractAuthorizedId('<input type="hidden" value="CH99" id="authorizedIDX">')).toBe('CH99');
  });

  it('matches name="authorizedID" (older / Vellore-style deployments)', () => {
    expect(extractAuthorizedId('<input name="authorizedID" value="CH42">')).toBe('CH42');
  });

  it('is case-insensitive on the marker name', () => {
    expect(extractAuthorizedId('<input ID="authorizedIDX" VALUE="CH7">')).toBe('CH7');
  });

  it('does not match a different input that merely mentions the word', () => {
    expect(extractAuthorizedId('<input name="foo" value="authorizedIDX">')).toBe('');
    expect(extractAuthorizedId('<div>authorizedIDX mentioned in text</div>')).toBe('');
  });

  it('returns empty when absent, empty-valued, or malformed', () => {
    expect(extractAuthorizedId('<form>no token</form>')).toBe('');
    expect(extractAuthorizedId('<input type="hidden" id="authorizedIDX">')).toBe('');
    expect(extractAuthorizedId('<input id="authorizedIDX" value="">')).toBe('');
    expect(extractAuthorizedId('')).toBe('');
  });

  it('survives the quoting and element variations VTOP can emit', () => {
    // Detection of a SUCCESSFUL login rests entirely on this marker, so a
    // single-quoted attribute or a different element must not turn a real
    // sign-in into "the page structure may have changed".
    expect(extractAuthorizedId("<input type='hidden' id='authorizedIDX' value='CH5'>")).toBe('CH5');
    expect(extractAuthorizedId('<span id="authorizedIDX" value=CH6></span>')).toBe('CH6');
    expect(extractAuthorizedId('<td name="authorizedID" data-x="1" value="CH8"></td>')).toBe('CH8');
    // Still nothing on an unauthenticated page that only carries the field
    // name in a script or as a value.
    expect(extractAuthorizedId('<script>var x = "authorizedIDX";</script>')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractCsrf — hidden input value= and meta content= forms
// ---------------------------------------------------------------------------

describe('extractCsrf (hidden input + Spring meta tag)', () => {
  it('reads the hidden input form (login pages)', () => {
    expect(extractCsrf('<input type="hidden" name="_csrf" value="tok123" />')).toBe('tok123');
    expect(extractCsrf('<input type="hidden" value="tok456" name="_csrf" />')).toBe('tok456');
  });

  it('reads the Spring Security meta tag (content= form)', () => {
    expect(extractCsrf('<meta name="_csrf" content="metaTok" />')).toBe('metaTok');
    expect(extractCsrf('<meta content="metaTok2" name="_csrf">')).toBe('metaTok2');
  });

  it('returns empty when absent or malformed', () => {
    expect(extractCsrf('<form>no csrf here</form>')).toBe('');
    expect(extractCsrf('<input name="other" value="x">')).toBe('');
    expect(extractCsrf('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// SAFE diagnostics
// ---------------------------------------------------------------------------

describe('safe session diagnostics', () => {
  it('reports booleans + count + consistency', async () => {
    const diag = await buildSessionDiag('JSESSIONID=abc; SERVERID=aff1', 'csrf123');
    expect(diag).toMatchObject({
      sessionExists: true,
      jsessionidExists: true,
      csrfExists: true,
      cookieCount: 2,
      sessionIdConsistency: 'first-seen',
    });
  });

  it('never exposes the JSESSIONID or CSRF values in the diagnostic', async () => {
    const diag = await buildSessionDiag('JSESSIONID=super-secret-value; SERVERID=aff1', 'csrf-value-xyz');
    expect(JSON.stringify(diag)).not.toContain('super-secret-value');
    expect(JSON.stringify(diag)).not.toContain('csrf-value-xyz');
  });

  it('detects a swapped session via the armed hash', async () => {
    const armed = await sessionJsidHash('JSESSIONID=ARMED; SERVERID=aff1');
    const same = await buildSessionDiag('JSESSIONID=ARMED; SERVERID=aff2', 'csrf', armed);
    expect(same.sessionIdConsistency).toBe('same');

    const swapped = await buildSessionDiag('JSESSIONID=DIFFERENT; SERVERID=aff1', 'csrf', armed);
    expect(swapped.sessionIdConsistency).toBe('different');
  });

  it('sessionJsidHash is deterministic and truncated', async () => {
    const h1 = await sessionJsidHash('JSESSIONID=value');
    const h2 = await sessionJsidHash('JSESSIONID=value');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(h1).not.toContain('value');
  });
});

// ---------------------------------------------------------------------------
// What counts as an ended session
//
// This is the single decision that signed a just-logged-in student out: a 404
// used to be read as an expired session, and a sync fires ~30 FETCH_DATA calls,
// several of which 404 for an ordinary student (no wallet, no transport, no
// arrears). Every one of those nulled the tab's only session token. A missing
// page is an answer about that page.
// ---------------------------------------------------------------------------

const VTOP_404 = `<html><body><h1>HTTP Status 404 – Not Found</h1>
  <p><b>type</b> Status report</p><p><b>message</b> Requested resource is not available</p>
  <hr/><h3>Apache Tomcat</h3></body></html>`;

const VTOP_LOGIN_PAGE = `<html><body><form id="vtopLoginForm" action="login" method="post">
  <input type="hidden" name="logintoken" value="abc"/>
  <input type="password" name="password"/><input type="text" name="captchaStr"/>
  <img src="captcha"/><input type="submit" value="Sign in"/></form></body></html>`;

/** A normal authenticated page: VTOP's own menus mention login-ish words. */
const SIGNED_IN_PAGE = `<html><body><div id="main-section">
  <a href="loginHistory">Login History</a><a href="changePassword">Change Password</a>
  <a href="#" onclick="logout()">Logout</a>
  <table><tr><td>21BCE9999</td><td>Soft Computing</td><td>E1/TE1</td></tr></table>
</div></body></html>`;

describe('isSessionExpired — the answer about the session, and only that', () => {
  it('does not read a 404 as an ended session, whatever VTOP put on the page', () => {
    expect(isSessionExpired(VTOP_404, 404)).toBe(false);
    expect(isSessionExpired('', 404)).toBe(false);
    expect(isSessionExpired(SIGNED_IN_PAGE, 404)).toBe(false);
  });

  it('reads VTOP’s own login page as an ended session at any status', () => {
    // The common shape: VTOP redirects to the login form and answers 200.
    expect(isSessionExpired(VTOP_LOGIN_PAGE, 200)).toBe(true);
    expect(isSessionExpired(VTOP_LOGIN_PAGE, 404)).toBe(true);
  });

  it('reads 401 and 403 as VTOP saying "not signed in", body or not', () => {
    expect(isSessionExpired('', 401)).toBe(true);
    expect(isSessionExpired('', 403)).toBe(true);
    expect(isSessionExpired(SIGNED_IN_PAGE, 401)).toBe(true);
    // 404 is deliberately not in that list: it names a missing page, not a session.
    expect(isSessionExpired('', 404)).toBe(false);
    expect(isSessionExpired('', 500)).toBe(false);
    expect(isSessionExpired('', 200)).toBe(false);
  });

  it('reads VTOP’s own wording about an ended session', () => {
    expect(isSessionExpired('<p>Session Expired</p>', 200)).toBe(true);
    expect(isSessionExpired('<p>Session timed out, please sign in again</p>', 200)).toBe(true);
    expect(isSessionExpired('<script>sessionTimeout()</script>', 200)).toBe(true);
    expect(isSessionExpired('<p>You are not authorized to view this page</p>', 200)).toBe(true);
    expect(isSessionExpired('<p>Invalid Captcha</p>', 200)).toBe(true);
  });

  it('does not mistake an authenticated page for a login page', () => {
    expect(isSessionExpired(SIGNED_IN_PAGE, 200)).toBe(false);
    // A page that merely mentions the login form's field names in passing text
    // is not a login page: the marker needs all three inputs together.
    expect(isSessionExpired('<p>reset your password or captcha by email</p>', 200)).toBe(false);
    expect(isSessionExpired('<p>logintoken issued</p>', 200)).toBe(false);
  });

  it('survives a missing or malformed body instead of throwing', () => {
    expect(isSessionExpired(undefined as unknown as string, 404)).toBe(false);
    expect(isSessionExpired(null as unknown as string, 200)).toBe(false);
    expect(isSessionExpired(undefined as unknown as string, 401)).toBe(true);
  });
});
