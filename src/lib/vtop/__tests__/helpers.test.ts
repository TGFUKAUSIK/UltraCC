import { describe, it, expect } from 'vitest';
import { isLikelyLoginPage, to24hTime, normalizeDate } from '../parsers/helpers';
import { loginPageHtml } from '../__fixtures__';

describe('parser helpers', () => {
  it('detects login pages (session expiry)', () => {
    expect(isLikelyLoginPage(loginPageHtml)).toBe(true);
    expect(isLikelyLoginPage('<html><body><table><tr><td>CSE2001</td></tr></table></body></html>')).toBe(false);
  });

  it('normalizes times to 24h', () => {
    expect(to24hTime('08:00 AM')).toBe('08:00');
    expect(to24hTime('08:50 AM')).toBe('08:50');
    expect(to24hTime('02:00 PM')).toBe('14:00');
    expect(to24hTime('12:30 PM')).toBe('12:30');
    expect(to24hTime('12:15 AM')).toBe('00:15');
    expect(to24hTime('8:00')).toBe('08:00');
    expect(to24hTime('not-a-time')).toBe('');
  });

  it('normalizes VTOP date formats to ISO', () => {
    expect(normalizeDate('18-AUG-2026')).toBe('2026-08-18');
    expect(normalizeDate('19/08/2026')).toBe('2026-08-19');
    expect(normalizeDate('2026-09-21')).toBe('2026-09-21');
    expect(normalizeDate('02-FEB-26')).toBe('2026-02-02');
    expect(normalizeDate('')).toBe('');
  });

  it('refuses to build a day that never happened', () => {
    // Reshaping digits into an ISO without checking them invented dates:
    // "08/18/2026" became "2026-18-08", and every countdown downstream let Date
    // roll month eighteen into a real instant eight months on. VTOP's own text
    // comes back unchanged, which the surfaces already render as "not released".
    expect(normalizeDate('08/18/2026')).toBe('08/18/2026');
    expect(normalizeDate('31/02/2026')).toBe('31/02/2026');
    expect(normalizeDate('29/02/2025')).toBe('29/02/2025'); // 2025 is not a leap year
    expect(normalizeDate('00/01/2026')).toBe('00/01/2026');
    expect(normalizeDate('31-FEB-2026')).toBe('31-FEB-2026');
  });

  it('still normalises the day that only looks impossible', () => {
    // The check is "does this day exist", not "is this day unusual" — June 30th
    // and a leap day are both ordinary, and must not be treated as noise.
    expect(normalizeDate('29/02/2028')).toBe('2028-02-29');
    expect(normalizeDate('29-FEB-28')).toBe('2028-02-29');
    expect(normalizeDate('30-JUN-2026')).toBe('2026-06-30');
    expect(normalizeDate('31-DEC-2026')).toBe('2026-12-31');
  });
});
