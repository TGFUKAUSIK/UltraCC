// @vitest-environment node

/**
 * Unit tests for flows.ts — the VTOP arming + login flow logic.
 * fetch is mocked; no network, no secrets. Covers the failure modes observed
 * live on vtopcc.vit.ac.in: transient 404s on prelogin/setup, the reCAPTCHA
 * variant, session-not-armed on DO_LOGIN, and the /content fallback.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  armStudentSession,
  submitLogin,
  ArmError,
  extractCaptchaDataUri,
  hasRecaptcha,
  describeLoginShape,
  extractVtopAlertText,
} from './flows';

const BASE = 'https://vtopcc.vit.ac.in/vtop';
const HEADERS = { 'User-Agent': 'test', 'Accept': 'text/html' };

const CSRF = 'csrf-token-123';
const CAPTCHA_URI = 'data:image/jpeg;base64,/9j/TEST';
const AUTH_MARKER = '<input type="hidden" id="authorizedIDX" value="CH12345" />';

function chooserHtml(session: string): string {
  return `<html><form><input name="_csrf" value="${CSRF}"><input type="hidden" name="flag" value="VTOP"></form>cookie=${session}</html>`;
}

function loginFormHtml(session: string, withCaptcha = true): string {
  const img = withCaptcha ? `<div id="captchaBlock"><img src="${CAPTCHA_URI}"></div>` : '';
  return `<html><form id="vtopLoginForm"><input name="_csrf" value="${CSRF}"><input name="username"><input name="password"><input name="captchaStr">${img}</form>cookie=${session}</html>`;
}

const recaptchaFormHtml = `<html><form id="vtopLoginForm"><div class="g-recaptcha" data-sitekey="6Lc_ABC"></div><input name="captchaStr"></form></html>`;

interface MockRoute {
  status?: number;
  headers?: Record<string, string>;
  body: string;
}

type Router = (method: string, path: string, cookieHeader: string, body: string) => MockRoute | Promise<MockRoute>;

/**
 * Minimal fake Response exposing exactly what requestWithJar consumes
 * (status, headers.get/getSetCookie, text). Deterministic across test
 * environments (happy-dom's Response drops status/body in some versions).
 */
function fakeResponse(route: MockRoute): Response {
  const headers = new Map(Object.entries(route.headers || {}));
  return {
    status: route.status ?? 200,
    headers: {
      get: (k: string) => headers.get(k.toLowerCase()) ?? null,
      getSetCookie: () => [...headers.entries()].filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v),
    },
    text: async () => route.body,
  } as unknown as Response;
}

/** Build a fetch implementation from a router; records every call. */
function mockFetch(router: Router) {
  const calls: { method: string; url: string; cookieHeader: string; body: string }[] = [];
  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const path = u.pathname.replace('/vtop', '');
    const method = (init.method || 'GET').toUpperCase();
    const rawHeaders = init.headers as Record<string, string>;
    const cookieHeader = typeof rawHeaders?.Cookie === 'string' ? rawHeaders.Cookie : '';
    const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ method, url: path, cookieHeader, body });
    const route = await router(method, path, cookieHeader, body);
    return fakeResponse(route);
  };
  return { impl, calls };
}

function makeRouter(overrides: Partial<Record<string, MockRoute>> = {}): Router {
  const base: Record<string, (session: string) => MockRoute> = {
    '/login': (s) => ({ body: chooserHtml(s) }),
    '/prelogin/setup': (s) => ({ body: loginFormHtml(s) }),
    '/login:POST': (s) => ({ body: chooserHtml(s) }), // not reached normally
    '/content': (s) => ({ body: `<html>dashboard cookie=${s}</html>` }),
  };
  return (method, path, _cookie, _body) => {
    // POST routes may be keyed with or without the ':POST' suffix.
    const key = method === 'POST' ? `${path}:POST` : path;
    const ov = overrides[key] ?? overrides[path];
    if (ov) return ov(_cookie);
    const b = base[key] ?? base[path];
    return b ? b(_cookie) : { body: `<html>unhandled ${key}</html>` };
  };
}

/** GET /login issues a fresh session id per call (like the real portal). */
let sessionCounter = 0;
function liveRouter(overrides: Partial<Record<string, MockRoute>> = {}) {
  sessionCounter = 0;
  return makeRouter({
    '/login': () => {
      sessionCounter++;
      return { body: chooserHtml(`sess${sessionCounter}`), headers: { 'set-cookie': `JSESSIONID=sess${sessionCounter}; Path=/` } };
    },
    ...overrides,
  });
}

describe('armStudentSession', () => {
  it('arms on the first attempt and returns cookie/csrf/captcha', async () => {
    const { impl, calls } = mockFetch(liveRouter());
    const result = await armStudentSession(impl, BASE, HEADERS);
    expect(result).toMatchObject({ csrf: CSRF, captchaUri: CAPTCHA_URI, attempts: 1, sawRecaptcha: false });
    expect(result.cookie).toContain('sess1');
    expect(calls.some((c) => c.method === 'GET' && c.url === '/login')).toBe(true);
    const setup = calls.find((c) => c.method === 'POST' && c.url === '/prelogin/setup');
    expect(setup).toBeDefined();
    expect(setup!.body).toContain('_csrf=');
    expect(setup!.body).toContain('flag=VTOP');
    // The setup POST must carry the session cookie from ITS OWN fresh GET.
    expect(setup!.cookieHeader).toContain('JSESSIONID=sess1');
  });

  it('re-rolls a FRESH session when the setup POST is 404-blocked, then succeeds', async () => {
    let setupCalls = 0;
    const { impl, calls } = mockFetch(
      liveRouter({
        '/prelogin/setup': (s) => {
          setupCalls++;
          if (setupCalls === 1) return { status: 404, body: '<h1>HTTP Status 404</h1>' };
          return { body: loginFormHtml(s) };
        },
      })
    );
    const result = await armStudentSession(impl, BASE, HEADERS, 4);
    expect(result.attempts).toBe(2);
    // Two fresh GET /login happened (two different sessions).
    const logins = calls.filter((c) => c.method === 'GET' && c.url === '/login');
    expect(logins).toHaveLength(2);
    // The successful setup used the SECOND session.
    const okSetup = calls.filter((c) => c.method === 'POST' && c.url === '/prelogin/setup')[1];
    expect(okSetup.cookieHeader).toContain('JSESSIONID=sess2');
    expect(result.cookie).toContain('sess2');
  });

  it('re-rolls when the login form is served without a captcha image', async () => {
    let n = 0;
    const { impl } = mockFetch(
      liveRouter({
        '/prelogin/setup': (s) => {
          n++;
          if (n === 1) return { body: `<html><form id="vtopLoginForm"><input name="captchaStr"></form></html>` };
          return { body: loginFormHtml(s) };
        },
      })
    );
    const result = await armStudentSession(impl, BASE, HEADERS, 4);
    expect(result.attempts).toBe(2);
    expect(result.captchaUri).toBe(CAPTCHA_URI);
  });

  it('throws a typed no-captcha error when VTOP keeps serving reCAPTCHA', async () => {
    const { impl } = mockFetch(
      liveRouter({ '/prelogin/setup': () => ({ body: recaptchaFormHtml }) })
    );
    const err = await armStudentSession(impl, BASE, HEADERS, 3).catch((e) => e);
    expect(err).toBeInstanceOf(ArmError);
    expect(err.kind).toBe('no-captcha');
    expect(err.message).toMatch(/reCAPTCHA/i);
  });

  it('throws a typed no-form error when the setup never serves the login form', async () => {
    const { impl } = mockFetch(
      liveRouter({ '/prelogin/setup': () => ({ status: 404, body: '<h1>404</h1>' }) })
    );
    const err = await armStudentSession(impl, BASE, HEADERS, 2).catch((e) => e);
    expect(err).toBeInstanceOf(ArmError);
    expect(err.kind).toBe('no-form');
    expect(err.message).toMatch(/student login form/i);
  });

  it('throws a typed unreachable error on persistent network failure', async () => {
    const impl = async () => { throw new TypeError('fetch failed'); };
    const err = await armStudentSession(impl as never, BASE, HEADERS, 2).catch((e) => e);
    expect(err).toBeInstanceOf(ArmError);
    expect(err.kind).toBe('unreachable');
  });

  it('treats a mid-attempt timeout as transient (re-rolls) and surfaces it when budget is exhausted', async () => {
    let n = 0;
    const impl = async (_url: string, init: RequestInit): Promise<Response> => {
      n++;
      if (n === 1) {
        // First GET /login: fail fast with the timeout marker error.
        return Promise.reject(new Error('VTOP request timed out after 15s per hop / 40s total (VTOP or its load balancer did not respond)'));
      }
      // Retry attempt: stall past the per-hop budget (honoring abort).
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    };
    const err = await armStudentSession(impl as never, BASE, HEADERS, 2).catch((e) => e);
    expect(err).toBeInstanceOf(ArmError);
    expect(err.kind).toBe('unreachable');
    // The timeout message from requestWithJar is surfaced verbatim (clearer
    // than the generic 'unreachable or refused the connection' text).
    expect(String(err.message)).toMatch(/timed out/i);
  }, 20_000);
});

describe('submitLogin', () => {
  const session = { cookie: 'JSESSIONID=sess1; SERVERID=node7', csrf: CSRF };
  const creds = { regNo: '23BCE0000', password: 'p@ss', captchaText: 'AbC123' };

  function postLoginRoute(body: string, status = 200): MockRoute {
    return { status, body };
  }

  it('succeeds when the login response inlines the authorizedIDX marker', async () => {
    const { impl, calls } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute(`<html>${AUTH_MARKER}</html>`) }));
    const out = await submitLogin(impl, BASE, HEADERS, session, creds);
    expect(out.kind).toBe('success');
    if (out.kind === 'success') expect(out.authorizedId).toBe('CH12345');

    const post = calls.find((c) => c.method === 'POST' && c.url === '/login')!;
    expect(post.cookieHeader).toContain('JSESSIONID=sess1');
    // EXACTLY the field set of VTOP's own login form (see realLoginFormHtml in
    // src/lib/vtop/__fixtures__/realLoginFixtures.ts) — captcha EXACTLY as typed.
    const form = new URLSearchParams(post.body);
    expect([...form.keys()].sort()).toEqual(['_csrf', 'captchaStr', 'password', 'username']);
    expect(form.get('captchaStr')).toBe('AbC123');
    expect(form.get('username')).toBe('23BCE0000');
  });

  it('never posts a gResponse field — that input means the Google reCAPTCHA variant', async () => {
    // `gResponse` used to be sent with the CAPTCHA text in it, on the theory
    // that vtopcc requires it. It does not: the captured image-CAPTCHA form has
    // no such input, and the live-tested reference reads the PRESENCE of
    // #gResponse as the signal that the reCAPTCHA variant is in play.
    const { impl, calls } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute(`<html>${AUTH_MARKER}</html>`) }));
    await submitLogin(impl, BASE, HEADERS, session, creds);
    const post = calls.find((c) => c.method === 'POST' && c.url === '/login')!;
    expect(post.body).not.toContain('gResponse');
    // …but a page that really does carry the hidden input is still detected.
    expect(hasRecaptcha('<input type="hidden" id="gResponse" name="gResponse" value="">')).toBe(true);
  });

  it('normalises the login id the way VTOP\'s own login field does', async () => {
    // The captured real form carries onkeyup="this.value = this.value.toUpperCase()"
    // on #username, so the portal only ever sees an uppercased login id — for a
    // registration number or a custom username. The app keeps the student's
    // typing in the field and applies VTOP's own rule here, at the single point
    // where the request is built.
    const { impl, calls } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute(`<html>${AUTH_MARKER}</html>`) }));
    const out = await submitLogin(impl, BASE, HEADERS, session, {
      regNo: '  rEg12345 ',
      password: 'p@ss',
      captchaText: 'AbC123',
    });
    expect(out.kind).toBe('success');

    const post = calls.find((c) => c.method === 'POST' && c.url === '/login')!;
    const form = new URLSearchParams(post.body);
    expect(form.get('username')).toBe('REG12345');
    // The CAPTCHA is NOT normalised — VTOP's own field uppercases it, but the
    // verified reference submits what was read/typed; never touch it here.
    expect(form.get('captchaStr')).toBe('AbC123');
  });

  it('recovers via the /content fallback on the SAME session when the dashboard is not inline', async () => {
    const { impl, calls } = mockFetch(
      makeRouter({
        '/login:POST': () => postLoginRoute('<html><p>redirecting…</p></html>'),
        '/content': () => ({ body: `<html>${AUTH_MARKER}</html>` }),
      })
    );
    const out = await submitLogin(impl, BASE, HEADERS, session, creds);
    expect(out.kind).toBe('success');
    if (out.kind === 'success') expect(out.authorizedId).toBe('CH12345');
    const content = calls.find((c) => c.method === 'GET' && c.url === '/content');
    expect(content).toBeDefined();
    // Same session jar on the fallback.
    expect(content!.cookieHeader).toContain('JSESSIONID=sess1');
  });

  it('still probes /content after an error page, and cannot be fooled by it', async () => {
    // The probe used to be suppressed on any recognizable failure page, which
    // also suppressed the one case that proves a login worked: VTOP answering
    // on a page that does not inline the dashboard. An unauthenticated /content
    // carries no marker, so probing an error page can never invent a success.
    const { impl, calls } = mockFetch(
      makeRouter({ '/login:POST': () => postLoginRoute('<html>Invalid Captcha</html>') })
    );
    const out = await submitLogin(impl, BASE, HEADERS, session, creds);
    expect(out.kind).toBe('invalid-captcha');
    expect(calls.some((c) => c.method === 'GET' && c.url === '/content')).toBe(true);
    expect(out.shape.contentProbe).toBe('none');
  });

  it('treats a marker on /content as the truth when the POST served the login form again', async () => {
    const { impl } = mockFetch(
      makeRouter({
        '/login:POST': () => postLoginRoute('<html><form id="vtopLoginForm"><input name="captchaStr"></form></html>'),
        '/content': () => ({ body: `<html>${AUTH_MARKER}</html>` }),
      })
    );
    const out = await submitLogin(impl, BASE, HEADERS, session, creds);
    expect(out.kind).toBe('success');
    if (out.kind === 'success') expect(out.authorizedId).toBe('CH12345');
    expect(out.shape.contentProbe).toBe('marker');
  });

  it('classifies the 404 session-not-armed case', async () => {
    const { impl } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute('<h1>404</h1>', 404) }));
    const out = await submitLogin(impl, BASE, HEADERS, session, creds);
    expect(out.kind).toBe('not-armed');
  });

  it('classifies invalid credentials / locked / max-attempts', async () => {
    const cases: [string, string][] = [
      ['Invalid Username / Password', 'invalid-credentials'],
      ['Account is locked', 'locked'],
      ['Maximum fail attempts reached', 'max-attempts'],
    ];
    for (const [text, expected] of cases) {
      const { impl } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute(`<html>${text}</html>`) }));
      const out = await submitLogin(impl, BASE, HEADERS, session, creds);
      expect(out.kind, text).toBe(expected as never);
    }
  });

  it('names an expired VTOP password instead of blaming the credentials', async () => {
    // VTOP expires student passwords on a rolling window (the live-tested
    // reference detects it page-wide on the "months" wording). A student with a
    // perfectly correct, perfectly current-in-their-head password gets rejected,
    // so the app must say which of the two it is.
    const alertCases: [string, string][] = [
      ['Your password has expired. Please change your password', 'password-expired'],
      ['Password expired after three months', 'password-expired'],
    ];
    for (const [text, expected] of alertCases) {
      const page = `<html><form id="vtopLoginForm"><input name="captchaStr"></form>` +
        `<span class="text-danger text-center" role="alert"><strong> ${text} </strong></span></html>`;
      const { impl } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute(page) }));
      const out = await submitLogin(impl, BASE, HEADERS, session, creds);
      expect(out.kind, text).toBe(expected as never);
    }
    // Page-wide, only when VTOP left its error slot empty …
    const { impl } = mockFetch(makeRouter({
      '/login:POST': () => postLoginRoute('<html>Your password has been expired after three months</html>'),
    }));
    const pageOut = await submitLogin(impl, BASE, HEADERS, session, creds);
    expect(pageOut.kind).toBe('password-expired');
    // …and the shape note says so plainly when the slot WAS empty.
    expect(describeLoginShape(pageOut.shape)).toContain('left its error message empty');
  });

  it('does not turn a login page help link into a password-expiry claim', async () => {
    // The login card carries "change your password" style help links, so the
    // page-wide expiry match is deliberately narrow. A plain credentials
    // rejection must stay a credentials rejection.
    const page = '<html>Invalid LoginId / Password. Trouble signing in? ' +
      'Change your password or contact support.</html>';
    const { impl } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute(page) }));
    const out = await submitLogin(impl, BASE, HEADERS, session, creds);
    expect(out.kind).toBe('invalid-credentials');
  });

  it('tells a known login id with the wrong password apart from an unknown one', async () => {
    // Live-probed through the deployed gateway 2026-09-19 with fake
    // credentials: a fresh CAPTCHA plus a login id VTOP does not know is
    // answered "Invalid Username/Password", while a login id it DOES know with
    // a password it does not hold is answered "Invalid Credentials". The
    // second is a password-on-record problem (changed on the portal, expired
    // and reset, autofilled out of date) — retyping it here cannot help, so it
    // must not be reported as a typing mistake.
    const cases: [string, string][] = [
      ['Invalid Credentials', 'password-mismatch'],
      ['Invalid Username/Password', 'invalid-credentials'],
    ];
    for (const [text, expected] of cases) {
      const page = `<html><form id="vtopLoginForm"><input name="captchaStr"></form>` +
        `<span class="text-danger text-center" role="alert"><strong> ${text} </strong></span></html>`;
      const { impl } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute(page) }));
      const out = await submitLogin(impl, BASE, HEADERS, session, creds);
      expect(out.kind, text).toBe(expected as never);
    }
    // Page-wide as well, when VTOP leaves its error slot empty.
    const { impl } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute('<html>Invalid Credentials</html>') }));
    const pageOut = await submitLogin(impl, BASE, HEADERS, session, creds);
    expect(pageOut.kind).toBe('password-mismatch');
  });

  it('reads VTOP\'s alert slot, which is where the real reason is printed', async () => {
    // Shape captured live: the login form is re-served and the reason goes in
    // <span class="text-danger text-center" role="alert"><strong> … </strong></span>
    // (see src/lib/vtop/__fixtures__/realLoginFixtures.ts). Wording VTOP may
    // reword now classifies from that slot instead of falling through to
    // "the page structure may have changed".
    const alertCases: [string, string][] = [
      ['Session Expired. Please login again', 'session-expired'],
      ['Captcha Mismatch', 'invalid-captcha'],
      ['Incorrect Password', 'invalid-credentials'],
      ['Too many failed login attempts', 'max-attempts'],
    ];
    for (const [text, expected] of alertCases) {
      const page = `<html><form id="vtopLoginForm"><input name="captchaStr"></form>` +
        `<span class="text-danger text-center" role="alert"><strong> ${text} </strong></span></html>`;
      const { impl } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute(page) }));
      const out = await submitLogin(impl, BASE, HEADERS, session, creds);
      expect(out.kind, text).toBe(expected as never);
      expect(out.shape.alert).toBe(text);
    }
  });

  it('describes an unrecognised response without leaking what was submitted', async () => {
    const page = '<html><form id="vtopLoginForm"><input name="captchaStr"></form>' +
      `<span role="alert"><strong> Wrong user ${creds.regNo} and p@ss </strong></span></html>`;
    const { impl } = mockFetch(makeRouter({
      '/login:POST': () => ({ status: 200, body: page }),
      '/content': () => ({ body: '<html>no marker</html>' }),
    }));
    const out = await submitLogin(impl, BASE, HEADERS, session, creds);
    expect(out.kind).toBe('unknown-failure');
    // VTOP's own message survives, the credentials in it do not.
    expect(out.shape.alert).toBe('Wrong user *** and ***');
    const note = describeLoginShape(out.shape);
    expect(note).toContain('VTOP replied 200');
    expect(note).toContain('the login form again');
    expect(note).not.toContain(creds.password);
    expect(note).not.toContain(creds.regNo);
  });

  it('classifies unknown failures (no marker, not an error page)', async () => {
    const { impl } = mockFetch(makeRouter({ '/login:POST': () => postLoginRoute('<html><p>some page</p></html>'), '/content': () => ({ body: '<html>no marker here</html>' }) }));
    const out = await submitLogin(impl, BASE, HEADERS, session, creds);
    expect(out.kind).toBe('unknown-failure');
  });
});

describe('extractVtopAlertText', () => {
  it('reads the reason out of the REAL captured error page', async () => {
    // Fixture captured live from vtopcc.vit.ac.in (sanitized): the login form
    // is re-served and the reason is printed in VTOP's alert slot.
    const { realLoginErrorExcerptHtml } = await import(
      '../../../src/lib/vtop/__fixtures__/realLoginFixtures'
    );
    expect(extractVtopAlertText(realLoginErrorExcerptHtml)).toBe('Invalid Captcha');
    expect(extractVtopAlertText('<html><body><p>no alert here</p></body></html>')).toBe('');
  });
});

describe('captcha helpers', () => {
  it('extracts the image data URI from #captchaBlock', () => {
    expect(extractCaptchaDataUri(`<div id="captchaBlock"><img src="${CAPTCHA_URI}"></div>`)).toBe(CAPTCHA_URI);
    expect(extractCaptchaDataUri('<html>no image</html>')).toBe('');
  });

  it('detects the reCAPTCHA / hCaptcha variants', () => {
    expect(hasRecaptcha('<div class="g-recaptcha" data-sitekey="abc"></div>')).toBe(true);
    expect(hasRecaptcha('<div class="h-captcha" data-sitekey="abc"></div>')).toBe(true);
    expect(hasRecaptcha('<html>plain</html>')).toBe(false);
  });
});
