/**
 * The two poster addresses the event-hub function hands out, and the one rule
 * that keeps the mirror safe: a poster id is a small integer and nothing else,
 * because the mirror's upstream host is a constant and the id is the only part
 * a caller controls.
 */

import { describe, it, expect } from 'vitest';
import { directPosterUrl, isPosterId, posterIdFromUrl, proxyPosterUrl, publicFunctionUrl } from './poster';

const FUNCTION_URL = 'https://other-project.supabase.co/functions/v1/event-hub';

describe('directPosterUrl', () => {
  it('is the Event Hub route that serves the poster', () => {
    expect(directPosterUrl('1201')).toBe('https://eventhubcc.vit.ac.in/EventHub/image/?id=1201');
  });
});

describe('proxyPosterUrl', () => {
  it('hangs off this function\'s own address, so any project ref works', () => {
    expect(proxyPosterUrl(FUNCTION_URL, '1201')).toBe(`${FUNCTION_URL}?poster=1201`);
  });

  it('drops a query string the platform may have appended to the request URL', () => {
    expect(proxyPosterUrl(`${FUNCTION_URL}?x=1`, '1201')).toBe(`${FUNCTION_URL}?poster=1201`);
  });
});

describe('publicFunctionUrl', () => {
  // The platform hands the function its INTERNAL address — no `/functions/v1`,
  // plain http — which no browser can load. The mirror must be rebuilt from the
  // platform origin plus the slug the request arrived on.
  const INTERNAL = 'http://other-project.supabase.co/event-hub';
  const ORIGIN = 'https://other-project.supabase.co';

  it('rebuilds the public /functions/v1 address from the internal request URL', () => {
    expect(publicFunctionUrl(ORIGIN, INTERNAL)).toBe(FUNCTION_URL);
  });

  it('upgrades a plain-http platform origin, so the mirror is never mixed content', () => {
    expect(publicFunctionUrl('http://other-project.supabase.co', INTERNAL)).toBe(FUNCTION_URL);
  });

  it('keeps the slug the request actually arrived on, and ignores a trailing slash', () => {
    expect(publicFunctionUrl('https://x.supabase.co/', 'http://x.supabase.co/event-hub')).toBe(
      'https://x.supabase.co/functions/v1/event-hub',
    );
  });

  it('yields nothing rather than a dead address when either half is missing', () => {
    expect(publicFunctionUrl(undefined, INTERNAL)).toBe('');
    expect(publicFunctionUrl('', INTERNAL)).toBe('');
    expect(publicFunctionUrl(ORIGIN, 'http://x.supabase.co/')).toBe('');
  });

  it('composes into an address the poster route reads back — the whole point', () => {
    const self = publicFunctionUrl(ORIGIN, INTERNAL);
    const mirror = proxyPosterUrl(self, '1201');
    expect(mirror).toBe(`${FUNCTION_URL}?poster=1201`);
    expect(posterIdFromUrl(mirror)).toBe('1201');
  });
});

describe('isPosterId', () => {
  it('accepts the ids Event Hub actually uses', () => {
    expect(isPosterId('1201')).toBe(true);
    expect(isPosterId('9')).toBe(true);
  });

  it('rejects anything that could escape the poster route', () => {
    for (const bad of ['', ' ', '1; DROP', '../x', '1201 &foo', '12.5', '-1', '1e3', '1387999999999999']) {
      expect(isPosterId(bad), bad).toBe(false);
    }
  });
});

describe('posterIdFromUrl', () => {
  it('reads back the id from either address it was built into', () => {
    expect(posterIdFromUrl('1387')).toBe('1387');
    expect(posterIdFromUrl(proxyPosterUrl(FUNCTION_URL, '1387'))).toBe('1387');
    expect(posterIdFromUrl(directPosterUrl('1387'))).toBe('1387');
  });

  it('returns null instead of forwarding an unvalidated value upstream', () => {
    expect(posterIdFromUrl(null)).toBeNull();
    expect(posterIdFromUrl('')).toBeNull();
    expect(posterIdFromUrl('../../etc/passwd')).toBeNull();
    expect(posterIdFromUrl(`${FUNCTION_URL}?poster=1201&x=2`)).toBe('1201');
    expect(posterIdFromUrl(`${FUNCTION_URL}?poster=12a1`)).toBeNull();
  });
});
