import { describe, it, expect } from 'vitest';
import {
  encodeTimetableShare, decodeTimetableShare, describeExpiry, describeShareContents,
  DEFAULT_SHARE_DAYS, MAX_SHARE_DAYS, SHARE_PREFIX,
} from '../timetableShare';
import type { TimetableSlot } from '../vtop/types';

const slot = (over: Partial<TimetableSlot> = {}): TimetableSlot => ({
  id: 's1', day: 'Monday', startTime: '08:00', endTime: '08:50', courseCode: 'CSE101',
  courseTitle: 'Problem Solving', slot: 'A1', venue: 'TT-01', facultyName: 'Dr. A',
  courseType: 'ETH', building: 'TT',
  ...over,
} as TimetableSlot);

const NOW = 1_750_000_000_000; // fixed epoch for determinism

describe('encodeTimetableShare', () => {
  it('produces a prefixed code', () => {
    const code = encodeTimetableShare([slot()], { now: NOW });
    expect(code).toBeTruthy();
    expect(code!.startsWith(`${SHARE_PREFIX}:`)).toBe(true);
  });

  it('returns null for an empty timetable', () => {
    expect(encodeTimetableShare([], { now: NOW })).toBeNull();
  });

  it('defaults venue/faculty OFF and expiry to 7 days', () => {
    const code = encodeTimetableShare([slot()], { now: NOW });
    const out = decodeTimetableShare(code!, NOW);
    expect(out.ok).toBe(true);
    expect(out.data!.includeVenue).toBe(false);
    expect(out.data!.includeFaculty).toBe(false);
    expect(out.data!.slots[0].venue).toBeUndefined();
    expect(out.data!.slots[0].faculty).toBeUndefined();
    expect(out.data!.expiresAt).toBe(NOW + DEFAULT_SHARE_DAYS * 24 * 60 * 60 * 1000);
  });

  it('includes venue/faculty only when requested', () => {
    const code = encodeTimetableShare([slot()], { now: NOW, includeVenue: true, includeFaculty: true });
    const out = decodeTimetableShare(code!, NOW);
    expect(out.data!.slots[0].venue).toBe('TT-01');
    expect(out.data!.slots[0].faculty).toBe('Dr. A');
  });

  it('clamps expiry to the 1..90 day window', () => {
    const low = decodeTimetableShare(encodeTimetableShare([slot()], { now: NOW, expiresInDays: 0 })!, NOW);
    expect(low.data!.expiresAt).toBe(NOW + 1 * 24 * 60 * 60 * 1000);
    const high = decodeTimetableShare(encodeTimetableShare([slot()], { now: NOW, expiresInDays: 500 })!, NOW);
    expect(high.data!.expiresAt).toBe(NOW + MAX_SHARE_DAYS * 24 * 60 * 60 * 1000);
  });
});

describe('decodeTimetableShare', () => {
  it('round-trips slots faithfully', () => {
    const code = encodeTimetableShare([slot(), slot({ day: 'Tuesday', courseCode: 'MAT201' })], { now: NOW });
    const out = decodeTimetableShare(code!, NOW);
    expect(out.ok).toBe(true);
    expect(out.data!.slots.length).toBe(2);
    expect(out.data!.slots[1].code).toBe('MAT201');
  });

  it('rejects non-share text', () => {
    expect(decodeTimetableShare('hello world', NOW).reason).toBe('not-a-share-code');
    expect(decodeTimetableShare('', NOW).reason).toBe('not-a-share-code');
  });

  it('rejects corrupted payloads', () => {
    expect(decodeTimetableShare(`${SHARE_PREFIX}:!!!not-base64!!!`, NOW).reason).toBe('corrupted');
  });

  it('REFUSES expired codes — expiry is the revocation mechanism', () => {
    const code = encodeTimetableShare([slot()], { now: NOW, expiresInDays: 7 });
    const afterExpiry = NOW + 8 * 24 * 60 * 60 * 1000;
    const out = decodeTimetableShare(code!, afterExpiry);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('expired');
    expect(out.data).toBeUndefined();
  });

  it('accepts a code up to (not past) its expiry moment', () => {
    const code = encodeTimetableShare([slot()], { now: NOW, expiresInDays: 1 });
    const justBefore = NOW + 24 * 60 * 60 * 1000 - 1;
    expect(decodeTimetableShare(code!, justBefore).ok).toBe(true);
    expect(decodeTimetableShare(code!, NOW + 24 * 60 * 60 * 1000).ok).toBe(false);
  });
});

describe('describeExpiry', () => {
  it('describes remaining time honestly', () => {
    expect(describeExpiry(NOW - 1, NOW)).toBe('expired');
    expect(describeExpiry(NOW + 10 * 60 * 60 * 1000, NOW)).toBe('expires within a day');
    expect(describeExpiry(NOW + 5 * 24 * 60 * 60 * 1000, NOW)).toBe('expires in 5 days');
  });
});

describe('privacy contract', () => {
  it('default code contains no venue, faculty, reg no or token markers', () => {
    const code = encodeTimetableShare([slot({ venue: 'TT-SECRET', facultyName: 'Secret Name' })], { now: NOW });
    // Base64url is opaque, but the DECODED payload must not contain them:
    const out = decodeTimetableShare(code!, NOW);
    const json = JSON.stringify(out.data);
    expect(json).not.toContain('TT-SECRET');
    expect(json).not.toContain('Secret Name');
    expect(json).not.toContain('JSESSIONID');
  });

  it('contents description matches the options', () => {
    const plain = describeShareContents({});
    expect(plain.some((s) => s.includes('No registration number'))).toBe(true);
    const rich = describeShareContents({ includeVenue: true, includeFaculty: true });
    expect(rich).toContain('Venues');
    expect(rich).toContain('Faculty names');
  });
});
