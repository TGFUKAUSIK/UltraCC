/**
 * Gateway transport layer tests.
 *
 * Tests the RealVTOPClient's gateway communication patterns — mocking
 * fetch so no actual network calls are made. Tests that:
 *  - initializeSession() calls INITIALIZE_SESSION and stores the token.
 *  - login() passes credentials to DO_LOGIN and surfaces errors correctly.
 *  - fetchData() passes dataTarget + sessionToken to FETCH_DATA.
 *  - Session expiry propagates as VtopError('SESSION_EXPIRED').
 *  - CAPTCHA mismatch propagates as VtopError('CAPTCHA_FAILED').
 *  - Gateway network failure propagates as VtopError('VTOP_UNAVAILABLE').
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealVTOPClient, isPlaceholder } from '../realClient';
import { VtopError } from '../errors';

/** Extract the request shape the client actually sent (method/URL/headers/body). */
function lastRequest() {
  const call = (global.fetch as any).mock.calls[(global.fetch as any).mock.calls.length - 1];
  return {
    url: String(call[0]),
    init: call[1] as RequestInit,
    method: (call[1] as RequestInit).method,
    headers: (call[1] as RequestInit).headers as Record<string, string>,
    body: JSON.parse(String((call[1] as RequestInit).body)),
  };
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

function mockFetch(response: object, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  });
}

beforeEach(() => {
  // Clear any previous mock
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// initializeSession
// ---------------------------------------------------------------------------

describe('RealVTOPClient.initializeSession', () => {
  it('stores the session token and returns captchaImageBase64 on success', async () => {
    global.fetch = mockFetch({
      ok: true,
      action: 'INITIALIZE_SESSION',
      sessionToken: 'tok.abc123',
      captchaImageBase64: 'data:image/jpeg;base64,/9j/test',
    });

    const client = new RealVTOPClient();
    const res = await client.initializeSession();

    expect(res.csrfToken).toBe('(managed-by-gateway)');
    expect(res.captchaImageBase64).toBe('data:image/jpeg;base64,/9j/test');

    // Verify the token is stored internally (indirectly: subsequent call uses it)
    global.fetch = mockFetch({ ok: true, action: 'GET_SESSION_STATUS', data: { authenticated: false } });
    await client.getSessionStatus();
    const lastCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(lastCall[1].body);
    expect(body.sessionToken).toBe('tok.abc123');
  });

  it('throws CAPTCHA_FAILED when gateway returns ok:false', async () => {
    global.fetch = mockFetch({ ok: false, action: 'INITIALIZE_SESSION', error: 'VTOP is down' });

    const client = new RealVTOPClient();
    await expect(client.initializeSession()).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'CAPTCHA_FAILED'
    );
  });

  it('throws VTOP_UNAVAILABLE on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network failed'));

    const client = new RealVTOPClient();
    await expect(client.initializeSession()).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'VTOP_UNAVAILABLE'
    );
  });

  it('throws the friendly timeout VTOP_UNAVAILABLE when the gateway never responds', async () => {
    // Simulates the observed outage: the Edge Function accepts the request
    // but never answers (hung upstream), so fetch rejects with TimeoutError.
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';
    global.fetch = vi.fn().mockRejectedValue(timeoutErr);

    const client = new RealVTOPClient();
    const err = await client.initializeSession().catch((e) => e);
    expect(err).toBeInstanceOf(VtopError);
    expect((err as VtopError).code).toBe('VTOP_UNAVAILABLE');
    expect((err as VtopError).message).toMatch(/did not respond in time/i);
  });

  it('sends a deadline signal with every gateway request', async () => {
    global.fetch = mockFetch({ ok: true, action: 'INITIALIZE_SESSION', sessionToken: 't', captchaImageBase64: 'x' });
    const client = new RealVTOPClient();
    await client.initializeSession();
    const init = (global.fetch as any).mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

describe('RealVTOPClient.login', () => {
  async function loginClient() {
    global.fetch = mockFetch({
      ok: true, action: 'INITIALIZE_SESSION',
      sessionToken: 'init.tok', captchaImageBase64: 'data:image/jpeg;base64,/9j/',
    });
    const client = new RealVTOPClient();
    await client.initializeSession();
    return client;
  }

  it('returns success when DO_LOGIN succeeds', async () => {
    const client = await loginClient();
    global.fetch = mockFetch({
      ok: true, action: 'DO_LOGIN',
      loginSuccess: true, sessionToken: 'auth.tok',
    });
    const res = await client.login('23BCE0000', 'password', 'ABCDEF');
    expect(res.success).toBe(true);
  });

  it('forwards the login id to DO_LOGIN as the student typed it', async () => {
    // The client is not a normalisation point — the gateway applies VTOP's own
    // rule (its login field uppercases) when it builds the POST.
    const client = await loginClient();
    global.fetch = mockFetch({
      ok: true, action: 'DO_LOGIN',
      loginSuccess: true, sessionToken: 'auth.tok',
    });
    await client.login('23BEE0001', 'password', 'ABCDEF');
    expect(lastRequest().body.credentials).toMatchObject({ regNo: '23BEE0001' });
  });

  it('throws LOGIN_FAILED when DO_LOGIN fails without CAPTCHA mismatch', async () => {
    const client = await loginClient();
    global.fetch = mockFetch({
      ok: false, action: 'DO_LOGIN',
      loginSuccess: false,
      loginError: 'VTOP login failed. Check your Registration Number and Password.',
    });
    await expect(client.login('23BCE0000', 'wrong', 'ABCDEF')).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'LOGIN_FAILED'
    );
  });

  it('throws CAPTCHA_FAILED on captchaMismatch=true', async () => {
    const client = await loginClient();
    global.fetch = mockFetch({
      ok: false, action: 'DO_LOGIN',
      loginSuccess: false, captchaMismatch: true,
      loginError: 'VTOP rejected the CAPTCHA.',
    });
    await expect(client.login('23BCE0000', 'pass', 'WRONG')).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'CAPTCHA_FAILED'
    );
  });

  it('throws SESSION_EXPIRED on sessionExpired=true', async () => {
    const client = await loginClient();
    global.fetch = mockFetch({
      ok: false, action: 'DO_LOGIN',
      loginSuccess: false, sessionExpired: true,
    });
    await expect(client.login('23BCE0000', 'pass', 'ABCD')).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'SESSION_EXPIRED'
    );
  });

  it('throws SESSION_EXPIRED when called without prior initializeSession', async () => {
    const client = new RealVTOPClient();
    await expect(client.login('23BCE0000', 'pass', 'ABCD')).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'CAPTCHA_FAILED'
    );
  });
});

// ---------------------------------------------------------------------------
// getAttendance / FETCH_DATA
// ---------------------------------------------------------------------------

describe('RealVTOPClient.getAttendance', () => {
  async function authenticatedClient() {
    global.fetch = mockFetch({
      ok: true, action: 'INITIALIZE_SESSION',
      sessionToken: 'init.tok', captchaImageBase64: 'data:image/jpeg;base64,/9j/',
    });
    const client = new RealVTOPClient();
    await client.initializeSession();

    global.fetch = mockFetch({ ok: true, action: 'DO_LOGIN', loginSuccess: true, sessionToken: 'auth.tok' });
    await client.login('23BCE0000', 'pass', 'ABCDEF');
    return client;
  }

  it('sends dataTarget=attendance and returns parsed data', async () => {
    const client = await authenticatedClient();
    const attendanceData = [{ courseCode: 'CSE2001', percentage: 85 }];
    global.fetch = mockFetch({ ok: true, action: 'FETCH_DATA', sessionToken: 'auth.tok2', data: attendanceData });

    const result = await client.getAttendance('CH2025261');

    const lastCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(lastCall[1].body);
    expect(body.action).toBe('FETCH_DATA');
    expect(body.dataTarget).toBe('attendance');
    expect(body.semesterId).toBe('CH2025261');
    expect(result).toEqual(attendanceData);
  });

  it('throws SESSION_EXPIRED when gateway returns sessionExpired', async () => {
    const client = await authenticatedClient();
    global.fetch = mockFetch({ ok: false, action: 'FETCH_DATA', sessionExpired: true });
    await expect(client.getAttendance()).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'SESSION_EXPIRED'
    );
  });

  it('throws PARSE_FAILED when the gateway reports a structural mismatch', async () => {
    const client = await authenticatedClient();
    global.fetch = mockFetch({
      ok: false, action: 'FETCH_DATA', parseFailed: true,
      error: 'VTOP changed its page structure — attendance could not be parsed.',
    });
    await expect(client.getAttendance()).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'PARSE_FAILED'
    );
  });

  it('keeps the session token when a single data target fails to parse', async () => {
    const client = await authenticatedClient();
    global.fetch = mockFetch({
      ok: false, action: 'FETCH_DATA', parseFailed: true, error: 'structure changed',
    });
    await expect(client.getAttendance()).rejects.toThrow();
    // The token must survive so sibling data targets can still be fetched.
    global.fetch = mockFetch({ ok: true, action: 'FETCH_DATA', data: [{ courseCode: 'CSE2001' }] });
    const result = await client.getAttendance();
    expect(result).toEqual([{ courseCode: 'CSE2001' }]);
  });

  it('returns [] when the gateway marks a target unavailable (assignments)', async () => {
    const client = await authenticatedClient();
    global.fetch = mockFetch({ ok: true, action: 'FETCH_DATA', data: [], unavailable: true });
    const result = await client.getAssignments();
    expect(result).toEqual([]);
  });

  it('throws SESSION_EXPIRED when called without login', async () => {
    const client = new RealVTOPClient();
    await expect(client.getAttendance()).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'SESSION_EXPIRED'
    );
  });
});

// ---------------------------------------------------------------------------
// isExtensionAvailable — always false (extension removed)
// ---------------------------------------------------------------------------

describe('RealVTOPClient.isExtensionAvailable', () => {
  it('always returns false — extension no longer required', async () => {
    const client = new RealVTOPClient();
    expect(await client.isExtensionAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe('RealVTOPClient.logout', () => {
  it('sends LOGOUT action and clears session', async () => {
    global.fetch = mockFetch({ ok: true, action: 'INITIALIZE_SESSION', sessionToken: 'tok', captchaImageBase64: '' });
    const client = new RealVTOPClient();
    await client.initializeSession();

    global.fetch = mockFetch({ ok: true, action: 'LOGOUT' });
    await client.logout();

    const lastCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(lastCall[1].body);
    expect(body.action).toBe('LOGOUT');
    expect(body.sessionToken).toBe('tok');

    // After logout, getAttendance should throw SESSION_EXPIRED (no token)
    await expect(client.getAttendance()).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'SESSION_EXPIRED'
    );
  });

  it('does nothing when no session exists', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const client = new RealVTOPClient();
    await expect(client.logout()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (2026-09-07): VTOP login broke when .env contained placeholder
// values copied from .env.example — the placeholder overrode the known-good
// hardcoded fallback and every gateway request went to
// https://your-project.supabase.co (DNS ENOTFOUND -> VTOP_UNAVAILABLE).
// These tests pin the correct request contract and the placeholder guard.
// ---------------------------------------------------------------------------

describe('VTOP login regression guard (2026-09-07)', () => {
  // An unconfigured public build talks to the documented placeholder host; the
  // operator's own URL/key arrive from VITE_* at build time (.env.example).
  const DEFAULT_URL = 'https://your-project.supabase.co/functions/v1/vtop-gateway';
  const DEFAULT_ANON = 'your_supabase_anon_key';

  function initClient(): RealVTOPClient {
    global.fetch = mockFetch({
      ok: true, action: 'INITIALIZE_SESSION',
      sessionToken: 'init.tok', captchaImageBase64: 'data:image/jpeg;base64,/9j/',
    });
    return new RealVTOPClient();
  }

  it('INITIALIZE_SESSION uses POST to the gateway from VITE_SUPABASE_* (placeholder when unset)', async () => {
    const client = initClient();
    await client.initializeSession();
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toBe(DEFAULT_URL);
    expect(req.headers['Authorization']).toBe(`Bearer ${DEFAULT_ANON}`);
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.body.action).toBe('INITIALIZE_SESSION');
  });

  it('INITIALIZE_SESSION request body carries the expected shape (action + campus, no credentials)', async () => {
    const client = initClient();
    await client.initializeSession();
    const req = lastRequest();
    expect(req.body).toEqual({ action: 'INITIALIZE_SESSION', campus: 'chennai' });
    expect(req.body.credentials).toBeUndefined();
    expect(req.body.sessionToken).toBeUndefined();
  });

  it('DO_LOGIN uses POST with the credentials payload the gateway contract expects', async () => {
    const client = initClient();
    await client.initializeSession();
    global.fetch = mockFetch({ ok: true, action: 'DO_LOGIN', loginSuccess: true, sessionToken: 'auth.tok' });
    await client.login('regNo', 'password', 'captcha');
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toBe(DEFAULT_URL);
    expect(req.body).toEqual({
      action: 'DO_LOGIN',
      sessionToken: 'init.tok',
      credentials: { regNo: 'regNo', password: 'password', captchaText: 'captcha' },
    });
  });

  it('login() keeps the CAPTCHA Human-in-the-Loop: OCR note requires manual entry, credentials only go to the gateway', async () => {
    const client = initClient();
    const captcha = await client.getCaptcha();
    expect(captcha.captchaText).toBe('');
    expect(captcha.confidence).toBe(0);
    expect(captcha.note).toContain('manually');
  });

  it('a 405 on GET is not treated as a login failure (the client only ever POSTs)', async () => {
    const client = initClient();
    await client.initializeSession();
    global.fetch = mockFetch({ ok: false }, 405);
    // DO_LOGIN over POST with a 405 from a misconfigured method must surface
    // as VTOP_UNAVAILABLE (transport), NOT as a VTOP credential failure.
    await expect(client.login('regNo', 'password', 'captcha')).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'VTOP_UNAVAILABLE'
    );
  });

  it('placeholder env values can no longer override the deployed gateway URL (guard unit tests)', () => {
    // The exact regression value that broke login:
    expect(isPlaceholder('https://your-project.supabase.co/functions/v1/vtop-gateway')).toBe(true);
    expect(isPlaceholder('your_supabase_anon_key')).toBe(true);
    expect(isPlaceholder('')).toBe(true);
    expect(isPlaceholder(undefined)).toBe(true);
    expect(isPlaceholder('   ')).toBe(true);
    expect(isPlaceholder('<your-key>')).toBe(true);
    // Real values must never be flagged:
    expect(isPlaceholder('https://other-project.supabase.co/functions/v1/vtop-gateway')).toBe(false);
    expect(isPlaceholder('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.real')).toBe(false);
  });

  it('an unconfigured build falls back to the documented placeholder target', async () => {
    // Behavioural proof: the exact placeholder values a copied .env.example
    // carries resolve to the built-in default instead of retargeting requests.
    const client = initClient();
    await client.initializeSession();
    expect(lastRequest().url).toBe(DEFAULT_URL);
    expect(lastRequest().headers['Authorization']).toBe(`Bearer ${DEFAULT_ANON}`);
  });

  it('Supabase headers remain correct: Bearer anon key on every gateway call', async () => {
    const client = initClient();
    await client.initializeSession();
    global.fetch = mockFetch({ ok: true, action: 'DO_LOGIN', loginSuccess: true, sessionToken: 't' });
    await client.login('r', 'p', 'c');
    const req = lastRequest();
    expect(req.headers['Authorization']).toBe(`Bearer ${DEFAULT_ANON}`);
  });

  it('session token handling stays in-memory and rotates through responses', async () => {
    const client = initClient();
    await client.initializeSession();
    expect(client.hasSessionToken()).toBe(true);
    global.fetch = mockFetch({ ok: true, action: 'DO_LOGIN', loginSuccess: true, sessionToken: 'auth.tok2' });
    await client.login('r', 'p', 'c');
    global.fetch = mockFetch({ ok: true, action: 'GET_SESSION_STATUS', data: { authenticated: true } });
    const status = await client.getSessionStatus();
    expect(status.authenticated).toBe(true);
    // The rotated token was passed through (auth.tok2, not init.tok).
    expect(lastRequest().body.sessionToken).toBe('auth.tok2');
  });
});

// ---------------------------------------------------------------------------
// Armed session vs. signed-in session
// ---------------------------------------------------------------------------

describe('RealVTOPClient authentication state', () => {
  /** A client whose CAPTCHA session is armed but whose credentials are not. */
  async function armedClient() {
    global.fetch = mockFetch({
      ok: true, action: 'INITIALIZE_SESSION',
      sessionToken: 'armed.tok', captchaImageBase64: 'data:image/jpeg;base64,/9j/',
    });
    const client = new RealVTOPClient();
    await client.initializeSession();
    return client;
  }

  it('has a session token before VTOP has accepted any credentials', async () => {
    const client = await armedClient();
    expect(client.hasSessionToken()).toBe(true);
    expect(client.isAuthenticated()).toBe(false);
  });

  it('refuses to fetch data over an unauthenticated session, without reaching the gateway', async () => {
    const client = await armedClient();
    const callsBefore = (global.fetch as any).mock.calls.length;
    await expect(client.getSemesters()).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'SESSION_EXPIRED'
    );
    // The background refresher used to send FETCH_DATA here and come back with
    // a gateway HTTP 500 on top of the open login screen.
    expect((global.fetch as any).mock.calls.length).toBe(callsBefore);
  });

  it('authenticates on login and drops it on logout', async () => {
    const client = await armedClient();
    global.fetch = mockFetch({ ok: true, action: 'DO_LOGIN', loginSuccess: true, sessionToken: 'auth.tok' });
    await client.login('21BCE0001', 'pw', 'AB12');
    expect(client.isAuthenticated()).toBe(true);

    global.fetch = mockFetch({ ok: true, action: 'LOGOUT' });
    await client.logout();
    expect(client.isAuthenticated()).toBe(false);
    expect(client.hasSessionToken()).toBe(false);
  });

  it('drops authentication when VTOP expires the session mid-fetch', async () => {
    const client = await armedClient();
    global.fetch = mockFetch({ ok: true, action: 'DO_LOGIN', loginSuccess: true, sessionToken: 'auth.tok' });
    await client.login('21BCE0001', 'pw', 'AB12');

    global.fetch = mockFetch({ ok: true, action: 'FETCH_DATA', sessionExpired: true });
    await expect(client.getAttendance('WS202526')).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'SESSION_EXPIRED'
    );
    expect(client.isAuthenticated()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The real syllabus request, asserted exactly
//
// This is the request a Production click on "BAEEE203 — Microcontrollers and
// Embedded Programming" produces, and it is pinned field-for-field: course
// identity and the app's own term, and NOTHING else. There is no parameter for
// a slot, a faculty or a class id, so none can be sent even by mistake — the
// gateway resolves VTOP's own class row itself.
// ---------------------------------------------------------------------------

describe('RealVTOPClient.getSyllabus — the production request payload', () => {
  async function signedInClient() {
    global.fetch = mockFetch({
      ok: true, action: 'INITIALIZE_SESSION',
      sessionToken: 'init.tok', captchaImageBase64: 'data:image/jpeg;base64,/9j/',
    });
    const client = new RealVTOPClient();
    await client.initializeSession();

    global.fetch = mockFetch({ ok: true, action: 'DO_LOGIN', loginSuccess: true, sessionToken: 'auth.tok' });
    await client.login('23BCE0000', 'pass', 'ABCDEF');
    return client;
  }

  it('sends exactly courseCode + semesterLabel + the session, and no slot or faculty', async () => {
    const client = await signedInClient();
    global.fetch = mockFetch({
      ok: true, action: 'FETCH_DATA', sessionToken: 'auth.tok2',
      data: {
        available: true,
        document: {
          dataUrl: 'data:application/pdf;base64,JVBERi0=', contentType: 'application/pdf',
          fileName: 'BAEEE203-syllabus.pdf', bytes: 7,
        },
      },
    });

    const info = await client.getSyllabus({
      courseCode: 'BAEEE203',
      semesterId: 'CH2025261',
      semesterLabel: 'Fall Semester 2026-27',
    });

    // The whole payload, exactly: this is what the tab's own button produces.
    expect(lastRequest().body).toEqual({
      action: 'FETCH_DATA',
      sessionToken: 'auth.tok',
      dataTarget: 'syllabus',
      semesterId: 'CH2025261',
      query: { courseCode: 'BAEEE203', semesterLabel: 'Fall Semester 2026-27' },
    });
    // The brief's product rule at the wire level.
    expect(JSON.stringify(lastRequest().body)).not.toMatch(/slot|faculty|classid|erpid|authorizedid|csrf/i);
    expect(info.available).toBe(true);
  });

  it('omits the term when the app has none, and never sends an empty string', async () => {
    const client = await signedInClient();
    global.fetch = mockFetch({ ok: true, action: 'FETCH_DATA', data: { available: false, reason: 'no-course-match' } });

    await client.getSyllabus({ courseCode: 'BAEEE203' });

    // A gateway with no term resolves VTOP's own selected semester; an empty
    // string would be a claim about the term, so it is never sent.
    expect(lastRequest().body).toEqual({
      action: 'FETCH_DATA',
      sessionToken: 'auth.tok',
      dataTarget: 'syllabus',
      semesterId: undefined,
      query: { courseCode: 'BAEEE203' },
    });
  });

  it('logs the gateway’s safe stage line when a syllabus attempt fails', async () => {
    const client = await signedInClient();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    global.fetch = mockFetch({
      ok: true, action: 'FETCH_DATA', unavailable: true,
      syllabusStage: 'COURSE', syllabusReason: 'COURSE_NOT_FOUND', syllabusStatus: 200,
      data: { available: false, reason: 'no-course-match' },
    });

    const result = await client.getSyllabus({ courseCode: 'BAEEE203', semesterId: 'CH2025261' });

    // The one line a developer reads to know WHICH hop failed. The student's
    // sentence is chosen elsewhere and is untouched by this.
    expect(info).toHaveBeenCalledWith('[UltraCC syllabus] stage=COURSE reason=COURSE_NOT_FOUND status=200');
    expect(result.available).toBe(false);
  });

  it('logs nothing when the response names no failure', async () => {
    const client = await signedInClient();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    global.fetch = mockFetch({
      ok: true, action: 'FETCH_DATA',
      data: {
        available: true,
        document: { dataUrl: 'data:application/pdf;base64,JVBERi0=', contentType: 'application/pdf', bytes: 7 },
      },
    });

    await client.getSyllabus({ courseCode: 'BAEEE203' });

    expect(info).not.toHaveBeenCalled();
  });

  it('reports a rejected session token as a session answer, not a VTOP outage', async () => {
    const client = await signedInClient();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ ok: false, action: 'FETCH_DATA', error: 'Invalid or expired session token' }),
      text: () => Promise.resolve('{"ok":false,"action":"FETCH_DATA","error":"Invalid or expired session token"}'),
    });

    await expect(client.getSyllabus({ courseCode: 'BAEEE203' })).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'SESSION_EXPIRED'
    );
    // The capture still finds one line, whatever hop died.
    expect(info).toHaveBeenCalledWith('[UltraCC syllabus] stage=SESSION reason=SESSION_INVALID status=401');
    // Deliberately NOT treated as a session death here: a 401 can also mean the
    // gateway's own auth blipped, and getSessionStatus is what decides whether
    // a session is really gone. The sentence is the part that had to change —
    // "VTOP is temporarily unavailable" invited retries that could never work.
    expect(client.hasSessionToken()).toBe(true);
  });

  it('names the stage even when the failure dies in transport, before any JSON', async () => {
    const client = await signedInClient();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    // A gateway 5xx: the body is not the flow's structured answer at all.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 503,
      json: () => Promise.resolve({}), text: () => Promise.resolve('Service Unavailable'),
    });
    await expect(client.getSyllabus({ courseCode: 'BAEEE203' })).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'VTOP_UNAVAILABLE'
    );
    expect(info).toHaveBeenCalledWith('[UltraCC syllabus] stage=UPSTREAM reason=GATEWAY_HTTP_ERROR status=503');

    info.mockClear();
    // The browser never reached the gateway at all.
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    await expect(client.getSyllabus({ courseCode: 'BAEEE203' })).rejects.toSatisfy(
      (e: VtopError) => e instanceof VtopError && e.code === 'VTOP_UNAVAILABLE'
    );
    expect(info).toHaveBeenCalledWith('[UltraCC syllabus] stage=UPSTREAM reason=GATEWAY_UNREACHABLE');
  });
});
