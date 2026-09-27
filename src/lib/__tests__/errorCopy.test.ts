/**
 * humanErrorCopy regression tests (brief §8): the production UI explains
 * what happened in human words — but genuine, curated failures must still
 * come through, and no debug detail may be silently swallowed in dev.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { debugErrorDetail, humanErrorCopy, looksTechnical } from '../errorCopy';
import { VtopError } from '../vtop/errors';

afterEach(() => vi.restoreAllMocks());

describe('looksTechnical', () => {
  it('flags machine-authored shapes', () => {
    for (const raw of [
      'PostgrestError: could not find the function public.delete_qbank_paper(bigint, text)',
      'The request endpoint is https://your-project.supabase.co/functions/v1/vtop-gateway',
      'invalid peer certificate: UnknownIssuer',
      'upstream responded 500',
      'The origin returned 503 after 3 retries',
      'TypeError: Failed to fetch',
      'Error: at callGateway (index.ts:412:15)',
      '{"code":"23505","details":"Key (id)=(7) already exists."}',
      'x'.repeat(300),
    ]) {
      expect(looksTechnical(raw), raw.slice(0, 40)).toBe(true);
    }
  });

  it('passes human-curated copy through', () => {
    for (const ok of [
      'Could not post your ride.',
      'That ride is full — someone took the last seat.',
      'VTOP session expired while fetching marks. Please re-login.',
      'Your VTOP account is locked. Contact VIT administration.',
    ]) {
      expect(looksTechnical(ok), ok).toBe(false);
    }
  });
});

describe('humanErrorCopy', () => {
  it('returns curated Error messages untouched (genuine failures stay visible)', () => {
    expect(humanErrorCopy(new Error('Could not reach the question-paper bank'), 'FALLBACK'))
      .toBe('Could not reach the question-paper bank');
    expect(humanErrorCopy(new VtopError('SESSION_EXPIRED', 'VTOP session expired. Please re-login.'), 'FALLBACK'))
      .toBe('VTOP session expired. Please re-login.');
  });

  it('replaces transport noise with the caller\'s fallback copy', () => {
    expect(humanErrorCopy(new TypeError('Failed to fetch'), 'The service could not be reached.'))
      .toBe('The service could not be reached.');
    expect(humanErrorCopy('PostgrestError: relation "qbank_papers" does not exist', 'This feature is temporarily unavailable.'))
      .toBe('This feature is temporarily unavailable.');
  });

  it('never renders an empty failure as an empty message', () => {
    expect(humanErrorCopy(undefined, 'Please try again.')).toBe('Please try again.');
    expect(humanErrorCopy('', 'Please try again.')).toBe('Please try again.');
    expect(humanErrorCopy(null)).toBe('Something went wrong. Please try again.');
  });

  it('keeps the raw string out of user copy when hiding it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* capture */ });
    const raw = 'IndexedDBError: A transaction died unexpectedly';
    const shown = humanErrorCopy(new Error(raw), 'Local storage hiccup — reload the page.');
    expect(shown).toBe('Local storage hiccup — reload the page.');
    expect(shown).not.toContain('IndexedDB');
    expect(warn.mock.calls.some((c) => String(c[1] ?? c[0]).includes(raw) || String(c).includes(raw))).toBe(true);
  });
});

describe('raw markup from an upstream page', () => {
  // A gateway that answers with the upstream HTML instead of JSON used to
  // render Moodle's login page into the LMS panel.
  it('flags HTML and entities, including a truncated snippet', () => {
    for (const raw of [
      '<!DOCTYPE html><html><head><title>Login to Moodle</title></head></html>',
      '<div class="login-error">Invalid login</div>',
      '</body></html>',
      'Invalid login &nbsp;or&nbsp; password expired.',
      'Your session has expired &#8212; log in again',
      '<p>An error occurred while sending a message to the staff.</p>',
    ]) {
      expect(looksTechnical(raw), raw.slice(0, 40)).toBe(true);
    }
  });

  it('replaces an upstream page with the caller\'s sentence', () => {
    expect(humanErrorCopy('<div class="alert">Session expired</div>', 'The LMS is temporarily unavailable. Try again.'))
      .toBe('The LMS is temporarily unavailable. Try again.');
  });

  it('does not flag the curated copy the gateways send instead', () => {
    for (const ok of [
      'LMS is temporarily unavailable. Try again.',
      'Your LMS sign-in has expired. Please connect to the LMS again.',
      'The LMS changed how its pages are built, so this could not be read. Nothing was saved for it — your other data is unaffected.',
      'VTOP did not respond in time — it may be down or overloaded. Try again in a minute.',
      'The AI advisor could not answer just now. Check the API key in Settings, then try again.',
    ]) {
      expect(looksTechnical(ok), ok.slice(0, 40)).toBe(false);
    }
  });
});

describe('debugErrorDetail', () => {
  it('logs the raw half with its scope, capped so a whole page cannot be dumped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* capture */ });
    debugErrorDetail('lms-gateway HTTP 502', `<center>nginx</center>${'x'.repeat(4000)}`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe('[error-copy] lms-gateway HTTP 502:');
    const logged = String(warn.mock.calls[0][1]);
    expect(logged.length).toBeLessThanOrEqual(500);
  });

  it('formats an Error as name and message, not a stack', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* capture */ });
    debugErrorDetail('transport', new TypeError('Failed to fetch'));
    expect(String(warn.mock.calls[0][1])).toBe('TypeError: Failed to fetch');
    expect(String(warn.mock.calls[0][1])).not.toContain('at ');
  });

  it('is silent when the build is not a development build', () => {
    // `import.meta.env.DEV` is statically false in the shipped bundle, so the
    // guard must be the first thing the function does.
    const source = readFileSync(resolve(__dirname, '../errorCopy.ts'), 'utf8');
    const body = source.slice(source.indexOf('export function debugErrorDetail'));
    expect(/export function debugErrorDetail\([^)]*\)[^{]*\{\s*if \(!isDevelopment\(\)\) return;/.test(body))
      .toBe(true);
  });
});
