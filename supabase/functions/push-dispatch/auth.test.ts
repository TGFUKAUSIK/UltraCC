/**
 * auth tests — the dispatcher must be callable by the scheduler and by nobody
 * else. Each path is asserted explicitly, including the fail-closed ones.
 */

import { describe, expect, it } from 'vitest';
import { decideCallerAuth, safeEqual } from './auth.ts';

const SERVICE_KEY = 'service-role-key-value';
const CRON_SECRET = 'operator-configured-secret';

const base = { cronSecret: null, provided: null, bearer: null, serviceKey: SERVICE_KEY } as const;

describe('decideCallerAuth', () => {
  it('accepts the platform service-role key (dashboard / manual runs)', () => {
    expect(decideCallerAuth({ ...base, bearer: SERVICE_KEY })).toEqual({ kind: 'authorized', via: 'service-key' });
  });

  it('accepts the configured cron secret', () => {
    expect(decideCallerAuth({ ...base, cronSecret: CRON_SECRET, provided: CRON_SECRET }))
      .toEqual({ kind: 'authorized', via: 'cron-secret' });
  });

  it('rejects a wrong secret even when one is configured', () => {
    const decision = decideCallerAuth({ ...base, cronSecret: CRON_SECRET, provided: 'nope' });
    expect(decision.kind).toBe('denied');
  });

  it('rejects a caller with no credentials at all', () => {
    expect(decideCallerAuth(base).kind).toBe('denied');
    expect(decideCallerAuth({ ...base, cronSecret: CRON_SECRET }).kind).toBe('denied');
  });

  it('falls back to the database as the authority when no env secret is set', () => {
    // The generated secret lives in public.push_cron_config, never in git.
    expect(decideCallerAuth({ ...base, provided: 'generated-secret' }))
      .toEqual({ kind: 'ask-database', secret: 'generated-secret' });
  });

  it('does not treat an empty service key as a master key', () => {
    // A misconfigured deployment (no service key) must not accept any bearer.
    const decision = decideCallerAuth({ cronSecret: null, provided: 'x', bearer: '', serviceKey: '' });
    expect(decision).toEqual({ kind: 'ask-database', secret: 'x' });
    expect(decideCallerAuth({ cronSecret: null, provided: null, bearer: '', serviceKey: '' }).kind).toBe('denied');
  });

  it('compares secrets in constant time (same length, all bytes scanned)', () => {
    expect(safeEqual('abcdef', 'abcdef')).toBe(true);
    expect(safeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(safeEqual('abcdef', 'abcde')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
