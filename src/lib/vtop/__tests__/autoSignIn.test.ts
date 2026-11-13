/**
 * The automatic sign-in flow a saved credential now uses.
 *
 * A manual refresh signs in silently with the credentials saved in Settings and
 * the login sheet runs the same sequence, so both share `attemptAutoSignIn`.
 * This pins the policy that keeps that honest: every rejected attempt is a real
 * failed login on the student's VTOP account, so the retry budget is one, a
 * shaky read is never submitted, and a refused password is handed straight back
 * for correction rather than guessed at again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VtopError } from '../errors';
import { attemptAutoSignIn, MAX_AUTO_RETRIES, MIN_AUTO_SUBMIT_CONFIDENCE } from '../autoSignIn';

const { initializeSession, login, resetLiveClient } = vi.hoisted(() => ({
  initializeSession: vi.fn(),
  login: vi.fn(),
  resetLiveClient: vi.fn(),
}));

vi.mock('../liveSession', () => ({
  getLiveClient: () => ({ initializeSession, login }),
  resetLiveClient: () => resetLiveClient(),
}));

const ARM = { csrfToken: '(managed-by-gateway)', captchaImageBase64: 'data:image/png;base64,AAAA' };
const CONFIDENT = { text: '86ZJYD', confidence: 0.94 };
const confidentReader = () => Promise.resolve(CONFIDENT);

beforeEach(() => {
  initializeSession.mockReset().mockResolvedValue(ARM);
  login.mockReset().mockResolvedValue({ success: true, message: 'ok' });
  resetLiveClient.mockReset();
});

describe('attemptAutoSignIn', () => {
  it('signs in when the CAPTCHA is read confidently', async () => {
    const steps: string[] = [];
    const result = await attemptAutoSignIn({
      regNo: '23BCE0000',
      password: 'pw',
      onProgress: (p) => steps.push(p.step),
      readCaptcha: confidentReader,
    });
    expect(result).toEqual({ status: 'ok' });
    expect(login).toHaveBeenCalledWith('23BCE0000', 'pw', '86ZJYD');
    expect(steps).toEqual(['initializing', 'solving-captcha', 'submitting']);
  });

  it('hands a credential rejection straight back instead of re-arming', async () => {
    login.mockRejectedValue(new VtopError('LOGIN_FAILED', 'Invalid Credentials'));
    const result = await attemptAutoSignIn({ regNo: 'x', password: 'y', readCaptcha: confidentReader });
    expect(result).toMatchObject({ status: 'handover', handover: 'rejected', code: 'LOGIN_FAILED', message: 'Invalid Credentials' });
    // A wrong password must cost exactly one real login attempt, not a retry loop.
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('never submits a shaky read', async () => {
    const result = await attemptAutoSignIn({
      regNo: 'x',
      password: 'y',
      readCaptcha: () => Promise.resolve({ text: '86ZJYD', confidence: MIN_AUTO_SUBMIT_CONFIDENCE - 0.01 }),
    });
    expect(result).toMatchObject({ status: 'handover', handover: 'low-confidence' });
    expect(login).not.toHaveBeenCalled();
  });

  it('hands over when the reader returns nothing, keeping the image', async () => {
    const result = await attemptAutoSignIn({
      regNo: 'x',
      password: 'y',
      readCaptcha: () => Promise.resolve({ text: '', confidence: 0.9 }),
    });
    expect(result).toMatchObject({ status: 'handover', handover: 'unreadable', captchaBase64: ARM.captchaImageBase64 });
    expect(login).not.toHaveBeenCalled();
  });

  it('hands over when VTOP serves no CAPTCHA image', async () => {
    initializeSession.mockResolvedValue({ csrfToken: 'x', captchaImageBase64: '' });
    const result = await attemptAutoSignIn({ regNo: 'x', password: 'y', readCaptcha: confidentReader });
    expect(result).toMatchObject({ status: 'handover', handover: 'no-captcha', captchaBase64: '' });
  });

  it('re-arms once after a wrong CAPTCHA, then hands over with the reason', async () => {
    login.mockRejectedValue(new VtopError('CAPTCHA_FAILED', 'Invalid Captcha'));
    const steps: string[] = [];
    const result = await attemptAutoSignIn({
      regNo: 'x',
      password: 'y',
      readCaptcha: confidentReader,
      onProgress: (p) => steps.push(p.step),
    });
    expect(result).toMatchObject({ status: 'handover', handover: 'captcha-exhausted', message: 'Invalid Captcha' });
    expect(login).toHaveBeenCalledTimes(MAX_AUTO_RETRIES + 1);
    expect(resetLiveClient).toHaveBeenCalledTimes(MAX_AUTO_RETRIES + 1);
    expect(steps.filter((s) => s === 'retrying')).toHaveLength(1);
  });

  it('succeeds on the retry with a fresh CAPTCHA', async () => {
    login
      .mockRejectedValueOnce(new VtopError('CAPTCHA_FAILED', 'Invalid Captcha'))
      .mockResolvedValueOnce({ success: true, message: 'ok' });
    const result = await attemptAutoSignIn({ regNo: 'x', password: 'y', readCaptcha: confidentReader });
    expect(result).toEqual({ status: 'ok' });
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('reports an unreachable VTOP instead of guessing', async () => {
    initializeSession.mockRejectedValue(new VtopError('CAPTCHA_FAILED', 'VTOP is down'));
    const result = await attemptAutoSignIn({ regNo: 'x', password: 'y', readCaptcha: confidentReader });
    expect(result).toMatchObject({ status: 'handover', handover: 'unavailable', code: 'CAPTCHA_FAILED' });
    expect(login).not.toHaveBeenCalled();
  });
});

describe('a manual refresh signs in with the saved credential', () => {
  const app = readFileSync(join(resolve(__dirname, '../../..'), 'App.tsx'), 'utf8');

  it('uses the shared automatic sign-in before it ever prompts', () => {
    expect(app).toContain('attemptAutoSignIn(');
    expect(app).toMatch(/getSavedCredentials\(\)/);
  });

  it('no longer opens the login sheet first when a saved credential exists', () => {
    // The old branch opened the sheet and toasted "your saved credentials are
    // ready. Sign in to refresh." — exactly the prompt this removes.
    expect(app).not.toContain('your saved credentials are ready');
  });

  it('routes every sign-in affordance through that same silent handler', () => {
    // The phone hides the header's Sign in button and taps the refresh lamp
    // instead, so the button was the one place a saved credential was still
    // re-asked for — on desktop. The header button, the signed-out CTAs, the
    // per-route connect prompt and the first-run step all share `requestSignIn`.
    expect(app).toMatch(/const requestSignIn = useCallback/);
    expect(app).toContain('onOpenLogin={requestSignIn}');
    expect(app).not.toMatch(/onOpenLogin=\{\(\)\s*=>\s*setIsLoginOpen\(true\)\}/);
    expect(app).not.toMatch(/onLogin=\{\(\)\s*=>\s*setIsLoginOpen\(true\)\}/);
  });

  it('switches term through the same silent handler instead of re-asking', () => {
    // The desktop term picker was the last affordance still opening the
    // credential sheet with no sign-in attempt: `handleSemesterChange` called
    // `setIsLoginOpen(true)` directly whenever the tab had no live session.
    // A session token is memory-only, so that fired on every reload — the
    // student picked a different term and was asked to sign in again. Picking a
    // term must reuse the saved login exactly as a refresh does.
    const gateStart = app.indexOf('const ensureVtopSession = useCallback');
    const gateEnd = app.indexOf('const handleRefresh = useCallback');
    expect(gateStart, 'the shared session gate is missing').toBeGreaterThan(-1);
    expect(gateEnd, 'the shared session gate must precede handleRefresh').toBeGreaterThan(gateStart);
    // The sheet still opens — but from the gate, which only does so when there
    // is nothing saved, or VTOP refused the pair / wants the CAPTCHA typed.
    expect(app.slice(gateStart, gateEnd)).toContain('setIsLoginOpen(true)');

    const semesterStart = app.indexOf('const handleSemesterChange');
    const semesterEnd = app.indexOf('return (', semesterStart);
    expect(semesterStart, 'handleSemesterChange is missing').toBeGreaterThan(-1);
    expect(semesterEnd).toBeGreaterThan(semesterStart);
    const semester = app.slice(semesterStart, semesterEnd);
    expect(semester).toContain('await ensureVtopSession()');
    expect(semester).not.toContain('setIsLoginOpen(true)');
  });
});
