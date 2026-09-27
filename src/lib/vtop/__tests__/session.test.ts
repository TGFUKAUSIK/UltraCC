/**
 * The session regression the Syllabus feature was built on, under test.
 *
 * Production behaviour this pins: a student signed in successfully, the post
 * login sync fired its ~30 FETCH_DATA calls, several of VTOP's sub-pages
 * answered 404 (a wallet/transport/arrears page an ordinary student simply does
 * not have), and the gateway read that as an expired session — nulling the one
 * encrypted token the whole tab runs on. The sync still reported success, so
 * every honest reader of the session state (the Syllabus banner first among
 * them) kept saying "Sign in to fetch from VTOP" for the rest of the tab's life.
 *
 * So the contract is: an answer that is not about the session must never end
 * the session; an answer that IS about it must end it and be reported; and both
 * transitions must be observable from React without polling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RealVTOPClient } from '../realClient';
import {
  getLiveClient,
  getLiveSessionSnapshot,
  hadLiveSessionThisTab,
  isLiveSessionActive,
  resetLiveClient,
  subscribeLiveSession,
} from '../liveSession';
import { isVtopError } from '../errors';

type Body = Record<string, unknown>;

/** Route every gateway call through `handler(body)`, recording what was sent. */
function gateway(handler: (body: Body) => Body) {
  const calls: Body[] = [];
  const fn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Body;
    calls.push(body);
    const res = { ok: true, action: String(body.action), ...handler(body) };
    return {
      ok: true,
      status: 200,
      json: async () => res,
      text: async () => JSON.stringify(res),
    };
  });
  global.fetch = fn as unknown as typeof fetch;
  return { calls };
}

const INIT: Body = { ok: true, sessionToken: 'tok.armed', captchaImageBase64: 'data:image/jpeg;base64,/9j/x' };
const LOGGED_IN: Body = { ok: true, sessionToken: 'tok.live', loginSuccess: true };
/** Exactly what the gateway now answers for a VTOP 404: no page, live session. */
const NOT_AVAILABLE: Body = {
  ok: false, notAvailable: true, sessionExpired: false,
  error: 'VTOP served no page for this, so it is not available on your account.',
};

/** A client that has been through a real, successful DO_LOGIN in this test. */
async function signedInClient(): Promise<RealVTOPClient> {
  const client = new RealVTOPClient();
  gateway((b) => (b.action === 'INITIALIZE_SESSION' ? INIT : LOGGED_IN));
  await client.initializeSession();
  await client.login('21BCE9999', 'pw-never-stored', 'AB12CD');
  return client;
}

/** The datasets a student without wallet/transport/arrears gets 404s for. */
const SILENT_404_TARGETS = [
  (c: RealVTOPClient) => c.getWallet(),
  (c: RealVTOPClient) => c.getTransport(),
  (c: RealVTOPClient) => c.getArrears(),
  (c: RealVTOPClient) => c.getBiometricInfo(),
  (c: RealVTOPClient) => c.getHodDean(),
  (c: RealVTOPClient) => c.getProctorMessages(),
];

beforeEach(() => {
  vi.restoreAllMocks();
  resetLiveClient();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetLiveClient();
});

describe('a VTOP 404 answers about the dataset, never about the session', () => {
  it('leaves a signed-in client signed in, and reports the gap as unavailable', async () => {
    const client = await signedInClient();
    expect(client.isAuthenticated()).toBe(true);

    gateway((b) => (b.action === 'FETCH_DATA' ? NOT_AVAILABLE : LOGGED_IN));

    const err = await client.getTransport().catch((e) => e);
    expect(isVtopError(err)).toBe(true);
    expect((err as { code: string }).code).toBe('VTOP_UNAVAILABLE');
    // The bug this test exists for: this used to read `false` after a 404.
    expect(client.isAuthenticated()).toBe(true);
  });

  it('survives a bulk sync of 404s and keeps sending the token DO_LOGIN returned', async () => {
    const client = await signedInClient();
    const { calls } = gateway((b) => (b.action === 'FETCH_DATA' ? NOT_AVAILABLE : LOGGED_IN));

    const outcomes = await Promise.allSettled(SILENT_404_TARGETS.map((call) => call(client)));

    expect(outcomes).toHaveLength(SILENT_404_TARGETS.length);
    expect(outcomes.every((o) => o.status === 'rejected')).toBe(true);
    expect(client.isAuthenticated()).toBe(true);
    const fetches = calls.filter((c) => c.action === 'FETCH_DATA');
    expect(fetches).toHaveLength(SILENT_404_TARGETS.length);
    expect(fetches.every((c) => c.sessionToken === 'tok.live')).toBe(true);
  });

  it('a syllabus VTOP 404s is a retryable answer, not a sign-out', async () => {
    const client = await signedInClient();
    gateway((b) => (b.action === 'FETCH_DATA' ? NOT_AVAILABLE : LOGGED_IN));

    await expect(client.getSyllabus({ courseCode: 'CSE2009', semesterId: 'CH2025261' }))
      .rejects.toSatisfy((e: unknown) => isVtopError(e) && e.code === 'VTOP_UNAVAILABLE');
    expect(client.isAuthenticated()).toBe(true);
  });

  it('a syllabus request naming no term at all still travels and survives the answer', async () => {
    // The unsynced case: the browser sends course identity and nothing else.
    // It must still reach the gateway — the semester is resolved there — and a
    // 404 from deep inside VTOP is still a retryable answer, not a sign-out.
    const client = await signedInClient();
    const { calls } = gateway((b) => (b.action === 'FETCH_DATA' ? NOT_AVAILABLE : LOGGED_IN));

    await expect(client.getSyllabus({ courseCode: 'BAEEE203' }))
      .rejects.toSatisfy((e: unknown) => isVtopError(e) && e.code === 'VTOP_UNAVAILABLE');

    // Course identity in the query, no term anywhere: the gateway resolves it.
    const syllabusCall = calls.find((c) => c.action === 'FETCH_DATA');
    expect(syllabusCall).toMatchObject({ dataTarget: 'syllabus', query: { courseCode: 'BAEEE203' } });
    expect(syllabusCall?.semesterId).toBeUndefined();
    expect(client.isAuthenticated()).toBe(true);
  });
});

describe('a session VTOP really did end still ends here', () => {
  it('sessionExpired clears the client and reports SESSION_EXPIRED', async () => {
    const client = await signedInClient();
    gateway((b) => (b.action === 'FETCH_DATA'
      ? { ok: false, sessionExpired: true, error: 'VTOP session expired. Please re-login.' }
      : LOGGED_IN));

    await expect(client.getTransport())
      .rejects.toSatisfy((e: unknown) => isVtopError(e) && e.code === 'SESSION_EXPIRED');
    expect(client.isAuthenticated()).toBe(false);

    // Cleared, not merely distrusted: the next call never reaches the gateway.
    const { calls } = gateway(() => ({ ok: true, data: {} }));
    await expect(client.getWallet())
      .rejects.toSatisfy((e: unknown) => isVtopError(e) && /not authenticated/i.test(e.message));
    expect(calls).toHaveLength(0);
  });

  it('an unauthenticated client refuses FETCH_DATA locally instead of spending a call', async () => {
    const client = new RealVTOPClient();
    const { calls } = gateway(() => ({ ok: true, data: [] }));

    await expect(client.getTransport())
      .rejects.toSatisfy((e: unknown) => isVtopError(e) && e.code === 'SESSION_EXPIRED');
    expect(calls).toHaveLength(0);
  });

  it('re-logining on the same client recovers the syllabus, on the new token', async () => {
    const client = await signedInClient();
    const seen: boolean[] = [];
    client.setSessionWatcher((authed) => seen.push(authed));

    gateway((b) => (b.action === 'FETCH_DATA'
      ? { ok: false, sessionExpired: true, error: 'VTOP session expired. Please re-login.' }
      : b.action === 'INITIALIZE_SESSION'
        ? INIT
        : { ok: true, sessionToken: 'tok.second', loginSuccess: true }));

    await expect(client.getTransport())
      .rejects.toSatisfy((e: unknown) => isVtopError(e) && e.code === 'SESSION_EXPIRED');

    // The whole recovery path the Syllabus page offers: sign in again, same tab,
    // same client — no second session and nothing to reload.
    await client.initializeSession();
    await client.login('21BCE9999', 'pw', 'AB12CD');
    expect(client.isAuthenticated()).toBe(true);
    // [watcher installed, VTOP ended it, signed in again] — one push per change,
    // and arming a CAPTCHA is not one of them.
    expect(seen).toEqual([true, false, true]);

    const { calls } = gateway((b) => (b.action === 'FETCH_DATA'
      ? { ok: true, data: { available: false, reason: 'no-syllabus-link' } }
      : { ok: true }));
    await expect(client.getSyllabus({ courseCode: 'BAEEE202', semesterId: 'CH2025261' }))
      .resolves.toMatchObject({ available: false });
    // The expired token is gone: this request carries what the new DO_LOGIN gave.
    expect(calls.find((c) => c.action === 'FETCH_DATA'))
      .toMatchObject({ sessionToken: 'tok.second', dataTarget: 'syllabus' });
  });
});

describe('session transitions are observable, which is what the banner needs', () => {
  it('notifies on login, on expiry — and not on a 404', async () => {
    const client = new RealVTOPClient();
    const seen: boolean[] = [];
    client.setSessionWatcher((authed) => seen.push(authed));
    // Installing a watcher pushes the answer of the moment, so a screen that
    // mounted late can never render a stale "signed in". Nothing about that is
    // a transition, which is why every expectation below counts from here.
    expect(seen).toEqual([false]);

    gateway((b) => (b.action === 'INITIALIZE_SESSION' ? INIT : LOGGED_IN));
    await client.initializeSession();   // armed, not authorized: not a transition
    expect(seen).toEqual([false]);
    await client.login('21BCE9999', 'pw', 'AB12CD');
    expect(seen).toEqual([false, true]);

    gateway((b) => (b.action === 'FETCH_DATA' ? NOT_AVAILABLE : LOGGED_IN));
    await client.getTransport().catch(() => undefined);
    expect(seen).toEqual([false, true]);   // still nothing to tell anyone about

    gateway((b) => (b.action === 'FETCH_DATA' ? { ok: false, sessionExpired: true } : LOGGED_IN));
    await client.getTransport().catch(() => undefined);
    expect(seen).toEqual([false, true, false]);
  });

  it('a broken subscriber cannot break the VTOP call that changed state', async () => {
    const client = new RealVTOPClient();
    client.setSessionWatcher(() => { throw new Error('subscriber blew up'); });
    gateway((b) => (b.action === 'INITIALIZE_SESSION' ? INIT : LOGGED_IN));

    await client.initializeSession();
    await expect(client.login('21BCE9999', 'pw', 'AB12CD')).resolves.toMatchObject({ success: true });
    expect(client.isAuthenticated()).toBe(true);
  });

  it('liveSession tells its subscribers, and the snapshot is the same truth', async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeLiveSession(() => seen.push(isLiveSessionActive()));
    const live = getLiveClient();

    gateway((b) => (b.action === 'INITIALIZE_SESSION' ? INIT : LOGGED_IN));
    await live.initializeSession();
    expect(isLiveSessionActive()).toBe(false);
    await live.login('21BCE9999', 'pw', 'AB12CD');
    expect(seen).toEqual([true]);
    expect(getLiveSessionSnapshot()).toBe(true);

    // Throwing the session away is a transition too: a screen must not keep
    // claiming a sign-in that no longer exists.
    resetLiveClient();
    expect(seen).toEqual([true, false]);
    expect(getLiveSessionSnapshot()).toBe(false);

    // After unsubscribing, a fresh login on the new live client tells nobody.
    unsubscribe();
    const next = getLiveClient();
    await next.initializeSession();
    await next.login('21BCE9999', 'pw', 'AB12CD');
    expect(isLiveSessionActive()).toBe(true);
    expect(seen).toEqual([true, false]);
  });

  it('an armed CAPTCHA is not an active session', async () => {
    // Still matters: if the banner hid for a token-only session, the page would
    // ask VTOP with a session that cannot answer.
    const client = new RealVTOPClient();
    gateway(() => INIT);
    await client.initializeSession();
    expect(client.hasSessionToken()).toBe(true);
    expect(client.isAuthenticated()).toBe(false);
    expect(isLiveSessionActive()).toBe(false);
  });

  it('still knows this tab signed in after the session is thrown away', async () => {
    // `isLiveSessionActive()` answers "is there a session?"; the refresh toast
    // needs "did this tab ever have one?", because only that separates an expiry
    // from a page reload. Both are false after a reset — the distinction has to
    // survive the reset, and it does not come from the client.
    const live = getLiveClient();
    gateway((b) => (b.action === 'INITIALIZE_SESSION' ? INIT : LOGGED_IN));
    await live.initializeSession();
    await live.login('21BCE9999', 'pw', 'AB12CD');
    expect(hadLiveSessionThisTab()).toBe(true);

    resetLiveClient();
    expect(isLiveSessionActive()).toBe(false);
    expect(hadLiveSessionThisTab()).toBe(true);
  });
});

/**
 * A reload and an expired session give the same `isLiveSessionActive()` answer
 * and are different sentences, so the cold-tab half of `hadLiveSessionThisTab()`
 * needs its own module instance — every test above signs in first, and nothing
 * here is ever persisted, which is the point.
 */
describe('a tab that has never signed in', () => {
  it('has not had a session, so it must not report one as expired', async () => {
    vi.resetModules();
    const fresh = await import('../liveSession');
    expect(fresh.isLiveSessionActive()).toBe(false);
    expect(fresh.hadLiveSessionThisTab()).toBe(false);
  });

  it('App.tsx words its refresh toast by that distinction', () => {
    // The reload-reports-an-expiry bug lived in a ternary that had only one
    // branch. Pin the branch back in place: the toast may say "expired" only
    // when this tab actually held a session.
    const app = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf-8');
    expect(app).toContain('const everSignedInHere = hadLiveSessionThisTab();');
    expect(app).toMatch(/everSignedInHere[\s\S]{0,40}'VTOP session expired/);
    expect(app).toMatch(/: 'This tab is not signed in to VTOP/);
  });
});
