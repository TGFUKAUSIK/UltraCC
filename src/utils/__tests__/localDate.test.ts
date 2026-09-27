/**
 * "Today" must be the student's local calendar day. `toISOString()` is UTC, so
 * for IST a class or exam dated today looked already past between midnight and
 * 05:29 local.
 */

import { describe, expect, it } from 'vitest';
import { localDateIso, localTodayIso } from '../localDate';

describe('localDateIso', () => {
  it('formats from local date components', () => {
    expect(localDateIso(new Date(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05');
    expect(localDateIso(new Date(2026, 8, 19, 23, 59, 59))).toBe('2026-09-19');
  });

  it('zero-pads month and day for lexicographic date comparison', () => {
    expect(localDateIso(new Date(2026, 8, 9))).toBe('2026-09-09');
    expect(localDateIso(new Date(2026, 8, 9)) < localDateIso(new Date(2026, 8, 10))).toBe(true);
  });

  it('keeps the IST small hours on the local day, where UTC reports yesterday', () => {
    const instant = new Date('2026-09-18T23:00:00Z');
    // The trap this helper exists to avoid.
    expect(instant.toISOString().slice(0, 10)).toBe('2026-09-18');
    const previous = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';
    try {
      expect(localDateIso(instant)).toBe('2026-09-19');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('localTodayIso defaults to the current day', () => {
    expect(localTodayIso()).toBe(localDateIso(new Date()));
  });
});
