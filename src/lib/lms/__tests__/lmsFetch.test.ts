/**
 * LMS transport regression tests (LMS brief §1 + §6).
 *
 * The trace these pin runs: LmsView → runFullLmsSync → LmsRealClient →
 * fetch(lms-gateway) → Moodle. The browser never sees Moodle's cookies or
 * HTML, so everything the student can read is decided by how this layer maps a
 * gateway answer onto a typed outcome. Production broke exactly here: a TLS
 * chain rejection surfaced as
 * "error sending request … invalid peer certificate: UnknownIssuer", and an
 * unauthenticated probe came back as a bare HTTP 500.
 *
 * Two invariants, tested from both ends:
 *   - the STATE is never collapsed (session expired ≠ unavailable ≠ empty ≠
 *     parse failure — each keeps its own flag and its own sentence, so the UI
 *     can offer the right next step);
 *   - the WORDING is never technical (no status line, no URL, no response
 *     body, no `dataTarget` identifier reaches a thrown message).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LmsRealClient } from '../realClient';
import { VtopError } from '../../vtop/errors';
import { looksTechnical } from '../../errorCopy';

// ---------------------------------------------------------------------------
// A stand-in for the Edge Function: this file tests the client half, so the
// gateway is represented by exactly what it sends back over the wire.
// ---------------------------------------------------------------------------

interface GatewayAnswer {
  status?: number;
  body?: unknown;
  raw?: string;
}

let sent: { payload: Record<string, unknown>; headers: Record<string, string> }[] = [];
let answers: GatewayAnswer[] = [];

function queue(...a: GatewayAnswer[]) {
  answers = [...a];
}

function okPayload(body: Record<string, unknown>): GatewayAnswer {
  return { status: 200, body };
}

function httpError(status: number, raw: string): GatewayAnswer {
  return { status, raw };
}

/** Feed the client a token without going through INITIALIZE_SESSION twice. */
const TOKEN_A = 'token-A';
const TOKEN_B = 'token-B';

beforeEach(() => {
  sent = [];
  answers = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    sent.push({
      payload: JSON.parse(body) as Record<string, unknown>,
      headers: init.headers as Record<string, string>,
    });
    const answer = answers.shift() ?? { status: 200, body: { ok: false, action: 'ERROR' } };
    const status = answer.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (answer.raw !== undefined) throw new SyntaxError('Unexpected token < in JSON');
        return answer.body;
      },
      text: async () => (answer.raw !== undefined ? answer.raw : JSON.stringify(answer.body)),
    };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function connectedClient(): LmsRealClient {
  const client = new LmsRealClient();
  queue(okPayload({ ok: true, action: 'INITIALIZE_SESSION', sessionToken: TOKEN_A, readyForAuth: true }));
  return client;
}

async function withSession(client: LmsRealClient): Promise<void> {
  await client.initializeSession();
}

/** Run `fn`, expecting a rejection, and hand back the error. */
async function rejection(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to reject, but it resolved');
}

// ---------------------------------------------------------------------------

describe('successful fetch', () => {
  it('returns the normalized rows and sends the gateway contract', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(okPayload({
      ok: true,
      action: 'FETCH_DATA',
      sessionToken: TOKEN_B,
      data: [{ courseId: 4711, name: 'CSE2001 Data Structures', shortName: 'CSE2001', url: 'https://lms.vit.ac.in/course/view.php?id=4711' }],
    }));

    const courses = await client.getCourses();

    expect(courses).toHaveLength(1);
    expect(courses[0].name).toBe('CSE2001 Data Structures');
    expect(sent[1].payload).toMatchObject({ action: 'FETCH_DATA', dataTarget: 'courses', sessionToken: TOKEN_A });
    expect(sent[1].headers.Authorization).toMatch(/^Bearer /);
  });

  it('adopts the rotated token from every response, so requests stay serial-safe', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(okPayload({ ok: true, action: 'FETCH_DATA', sessionToken: TOKEN_B, data: [] }));
    await client.getCourses();
    queue(okPayload({ ok: true, action: 'FETCH_DATA', sessionToken: 'token-C', data: [] }));
    await client.getAssignments(1);

    expect(sent[2].payload.sessionToken).toBe(TOKEN_B);
  });

  it('an empty LMS is an empty answer, not a failure', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(okPayload({ ok: true, action: 'FETCH_DATA', sessionToken: TOKEN_B, data: [] }));

    await expect(client.getCourses()).resolves.toEqual([]);
  });
});

describe('session expired', () => {
  it('clears the token and says the student has to reconnect', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(okPayload({ ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'Your LMS sign-in has expired. Please connect to the LMS again.' }));

    const err = await rejection(() => client.getCourses());
    expect(err).toBeInstanceOf(VtopError);
    expect((err as VtopError).code).toBe('SESSION_EXPIRED');
    expect((err as VtopError).message).toMatch(/connect to the LMS again/i);

    // The dead session must not be reused for a second request.
    const before = sent.length;
    const again = await rejection(() => client.getCourses());
    expect((again as VtopError).code).toBe('SESSION_EXPIRED');
    expect(sent.length).toBe(before);
  });

  it('reports a lost session distinctly from an unavailable service', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(okPayload({ ok: false, action: 'FETCH_DATA', unavailable: true, error: 'LMS is temporarily unavailable. Try again.' }));

    const err = await rejection(() => client.getCourses());
    expect((err as VtopError).code).toBe('VTOP_UNAVAILABLE');
    expect((err as VtopError).message).toMatch(/temporarily unavailable/i);
  });
});

describe('malformed response', () => {
  it('ok:true without an array is a failure, and never a silent undefined', async () => {
    const client = connectedClient();
    await withSession(client);
    // The exact shape that used to reach syncLms and blow up inside
    // `for (const a of assignments)` as "TypeError: … is not iterable".
    queue(okPayload({ ok: true, action: 'FETCH_DATA', sessionToken: TOKEN_B, data: null }));

    const err = await rejection(() => client.getCourses());
    expect((err as VtopError).code).toBe('PARSE_FAILED');
    expect(looksTechnical((err as VtopError).message)).toBe(false);
    expect((err as VtopError).message).not.toMatch(/undefined|null|dataTarget/i);
  });

  it('a non-JSON body never becomes a thrown parse error in the UI', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(httpError(502, '<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>'));

    const err = await rejection(() => client.getCourses());
    expect((err as VtopError).code).toBe('VTOP_UNAVAILABLE');
    expect((err as VtopError).message).toBe('LMS is temporarily unavailable. Try again.');
  });
});

describe('error wording (brief §6)', () => {
  it('an HTTP status line is never user-facing', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(httpError(500, '{"error":"internal server error"}'));

    const err = await rejection(() => client.getCourses()) as VtopError;
    expect(err.message).not.toMatch(/500|HTTP|gateway|\{|"error"/i);
    expect(looksTechnical(err.message)).toBe(false);
  });

  it('a TLS chain rejection from an older deployment is replaced by copy', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(okPayload({
      ok: false,
      action: 'FETCH_DATA',
      unavailable: true,
      error: 'error sending request for url (https://lms.vit.ac.in/login/index.php): client error (Connect): invalid peer certificate: UnknownIssuer',
    }));

    const err = await rejection(() => client.getCourses()) as VtopError;
    expect(err.message.toLowerCase()).not.toContain('certificate');
    expect(err.message).not.toMatch(/https?:\/\//);
    expect(looksTechnical(err.message)).toBe(false);
  });

  it('a rejected login names the next step without echoing the Moodle page', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(okPayload({
      ok: false,
      action: 'DO_LOGIN',
      loginSuccess: false,
      loginError: '<div class="loginerrors">Invalid login, you have exceeded the maximum number of failed login attempts!</div>',
    }));

    const err = await rejection(() => client.login('student', 'secret')) as VtopError;
    expect(err.code).toBe('LOGIN_FAILED');
    expect(err.message).not.toMatch(/<|div|loginerrors/i);
    expect(err.message).toMatch(/credentials/i);
  });

  it('never puts the password on the wire twice or into a message', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(okPayload({ ok: true, action: 'DO_LOGIN', loginSuccess: true, sessionToken: TOKEN_B }));

    await client.login('21bce000', 'a-secret-never-reused');
    const body = JSON.stringify(sent[1].payload);
    // Credentials are the one thing this transport must send — over HTTPS, to
    // the gateway only. Assert it is sent exactly once, on the login call.
    expect(body).toContain('a-secret-never-reused');
    expect(JSON.stringify(sent[0].payload)).not.toContain('a-secret-never-reused');
  });
});

describe('retry behaviour', () => {
  it('a failed call leaves no half-used session behind, so the next sync starts clean', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(httpError(503, 'Upstream Service Unavailable'));
    const first = await rejection(() => client.getCourses()) as VtopError;
    expect(first.code).toBe('VTOP_UNAVAILABLE');

    // The token was never invalidated by a transport failure — a retry with
    // the same client is what the UI's "Sync LMS" button performs.
    queue(okPayload({ ok: true, action: 'FETCH_DATA', sessionToken: TOKEN_B, data: [{ courseId: 1, name: 'CSE1001', shortName: 'CSE1001', url: '' }] }));
    const retry = await client.getCourses();
    expect(retry).toHaveLength(1);
    expect(sent[2].payload.sessionToken).toBe(TOKEN_A);
  });

  it('logs out best-effort and always drops the local token', async () => {
    const client = connectedClient();
    await withSession(client);
    queue(httpError(500, 'boom'));
    await client.logout();

    const err = await rejection(() => client.getCourses()) as VtopError;
    expect(err.code).toBe('SESSION_EXPIRED');
  });
});
