/**
 * One timestamp format (src/utils/timestamp.ts).
 *
 * Before this, six views each called `new Date(x).toLocaleString()`, so the same
 * "last synced" line rendered with seconds and in whatever order the device's
 * locale preferred, and two more views kept private copies of the short form.
 * These tests pin the shape, the Today/Yesterday wording, and the two cases the
 * formatter must never invent: an unparseable stamp and an empty one.
 */

import { describe, expect, it } from 'vitest';
import { formatSyncStamp, formatTimestamp } from '../timestamp';

/** A time on this device's own wall clock, so no timezone offset can move the day. */
function at(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

/** The student's now: 9:00 AM on 5 Oct 2026, on this device. */
const NOW = new Date(2026, 9, 5, 9, 0);

describe('formatTimestamp', () => {
  it('prints the day, the month and the hour without seconds', () => {
    expect(formatTimestamp(at(2026, 10, 5, 17, 31), NOW)).toMatch(/^5 Oct, 5:31\s?(AM|PM)$/i);
    expect(formatTimestamp(at(2026, 10, 5, 17, 31), NOW)).not.toMatch(/:\d\d:\d\d/);
  });

  it('adds the year only when it is not the student’s year', () => {
    expect(formatTimestamp(at(2026, 3, 1, 8, 0), NOW)).not.toMatch(/20\d\d/);
    expect(formatTimestamp(at(2024, 3, 1, 8, 0), NOW)).toContain('2024');
  });

  it('shows a gap instead of an invented time', () => {
    for (const blank of [null, undefined, '', 'not a date']) {
      expect(formatTimestamp(blank as string | null, NOW)).toBe('—');
    }
  });
});

describe('formatSyncStamp', () => {
  /**
   * Every call site puts this after a verb — "Synced …", "Directory synced …" —
   * so the words are lowercase and the tests match them literally, not
   * case-insensitively. A capital here is a grammar bug in six pages.
   */
  it('says today rather than repeating the date the student is already in', () => {
    expect(formatSyncStamp(at(2026, 10, 5, 6, 45), NOW)).toMatch(/^today, 6:45/);
  });

  it('says yesterday for the day before, by local calendar day', () => {
    expect(formatSyncStamp(at(2026, 10, 4, 20, 5), NOW)).toMatch(/^yesterday, 8:05/);
  });

  it('falls back to the date once it is older than yesterday', () => {
    const stamp = formatSyncStamp(at(2026, 9, 28, 11, 0), NOW);
    // en-IN abbreviates September as "Sept", not "Sep" — the portal's other
    // date labels already read that way, so the formatter keeps the locale.
    expect(stamp).toMatch(/^28 Sept?, 11:00/);
  });

  it('keeps a stamp from the small hours on the day it happened', () => {
    // UTC midnight-to-05:29 used to report "yesterday" for IST students; the
    // comparison is done on local calendar days, so a 12:10 AM sync is today.
    expect(formatSyncStamp(at(2026, 10, 5, 0, 10), NOW)).toMatch(/^today, 12:10/);
  });

  it('shows a gap instead of an invented time', () => {
    expect(formatSyncStamp(null, NOW)).toBe('—');
    expect(formatSyncStamp('', NOW)).toBe('—');
  });
});
