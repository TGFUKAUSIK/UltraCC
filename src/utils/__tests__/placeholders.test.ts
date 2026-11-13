/**
 * The one placeholder test every view asks before it prints a VTOP field.
 *
 * VTOP fills a field it has no value for with a stub — a bare "-", an em dash,
 * "R -" for a room it could not read, "Seat -", the word "None", or the literal
 * acronym "SELECT". Shown verbatim, any of them reads as a real fact on a screen
 * a student trusts, which is the class of bug this helper exists to end.
 */

import { describe, it, expect } from 'vitest';
import { isReal, placeOf } from '../placeholders';

describe('isReal', () => {
  it('accepts a real value, trimming it', () => {
    expect(isReal('SJT 402')).toBe(true);
    expect(isReal('  Dr. A. Kumar  ')).toBe(true);
    expect(isReal('A12')).toBe(true);
    expect(isReal(0)).toBe(true);
    expect(isReal(60)).toBe(true);
  });

  it('rejects a value VTOP only stubbed', () => {
    for (const stub of ['-', '—', '–', '--', 'R -', 'Seat -', 'Room 401 -', 'None', 'none', 'N/A', 'na', 'nil', 'null', 'TBA', 'Not available', 'SELECT']) {
      expect(isReal(stub), `${JSON.stringify(stub)} is a stub`).toBe(false);
    }
  });

  it('rejects the empty shapes', () => {
    expect(isReal('')).toBe(false);
    expect(isReal('   ')).toBe(false);
    expect(isReal(null)).toBe(false);
    expect(isReal(undefined)).toBe(false);
  });
});

describe('placeOf', () => {
  it('joins a venue and a distinct room', () => {
    expect(placeOf('SJT', '402')).toBe('SJT · 402');
  });

  it('does not repeat a room the venue already carries', () => {
    expect(placeOf('SJT 402', '402')).toBe('SJT 402');
  });

  it('drops a stub venue and keeps the room alone', () => {
    expect(placeOf('R -', '401')).toBe('401');
    expect(placeOf('-', '401')).toBe('401');
  });

  it('drops a stub room and keeps the venue alone', () => {
    expect(placeOf('SJT 402', '-')).toBe('SJT 402');
  });

  it('reports an empty string when both are stubs', () => {
    expect(placeOf('R -', 'Seat -')).toBe('');
    expect(placeOf('', '')).toBe('');
  });
});
