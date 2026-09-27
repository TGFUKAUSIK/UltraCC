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
});
