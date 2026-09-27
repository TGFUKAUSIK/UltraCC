/**
 * Q-Bank paper-removal regression tests.
 *
 * Two rules the UI must not drift back into:
 *
 *  1. Removing a paper never asks the user to type a code. The old flow
 *     borrowed Cab Share's "poster code" window.prompt, which made no sense
 *     for a paper someone else shared. Authorization is instead derived from
 *     codes THIS device holds (bound at upload), and the server still verifies
 *     the code on delete — the protection was never removed.
 *
 *  2. A paper this device cannot prove it shared must not be removable from
 *     here (canRemovePaper() gates the delete affordance entirely).
 */

import { describe, it, expect } from 'vitest';
import {
  canRemovePaper, codesForPaper, consumePaperCode, paperKey, recordPaperCode,
} from '../qbankOwnership';

describe('qbank paper ownership', () => {
  const key = paperKey({ course_code: ' baele102 ', title: ' CAT 1 — May 2024 ', url: ' https://drive.google.com/x ' });

  it('keys papers by their normalized content', () => {
    expect(key).toBe('BAELE102|CAT 1 — May 2024|https://drive.google.com/x');
    // Same key regardless of how the fields were spaced/cased when shared.
    expect(paperKey({ course_code: 'BAELE102', title: 'CAT 1 — May 2024', url: 'https://drive.google.com/x' })).toBe(key);
  });

  it('binds a code without mutating the previous map and ignores duplicates', () => {
    const before = {};
    const after = recordPaperCode(before, key, 'AAAA1111');
    expect(after[key]).toEqual(['AAAA1111']);
    expect(before[key]).toBeUndefined();
    expect(recordPaperCode(after, key, 'AAAA1111')).toBe(after);
  });

  it('tracks multiple codes for one paper', () => {
    let map = recordPaperCode({}, key, 'AAAA1111');
    map = recordPaperCode(map, key, 'BBBB2222');
    expect(codesForPaper(map, key)).toEqual(['AAAA1111', 'BBBB2222']);
    expect(canRemovePaper(map, key)).toBe(true);
  });

  it('reports papers this device cannot remove', () => {
    expect(codesForPaper({}, key)).toEqual([]);
    expect(canRemovePaper({}, key)).toBe(false);
  });

  it('consumes one code after a successful delete and keeps siblings', () => {
    let map = recordPaperCode(recordPaperCode({}, key, 'AAAA1111'), key, 'BBBB2222');
    map = consumePaperCode(map, key, 'AAAA1111');
    expect(codesForPaper(map, key)).toEqual(['BBBB2222']);
    map = consumePaperCode(map, key, 'BBBB2222');
    expect(canRemovePaper(map, key)).toBe(false);
    expect(map[key]).toBeUndefined();
  });

  it('leaves the map untouched when consuming an unknown code', () => {
    const map = recordPaperCode({}, key, 'AAAA1111');
    expect(consumePaperCode(map, key, 'NOPE9999')).toEqual(map);
  });

  it('never needs user input: a device without codes simply cannot remove', () => {
    // The delete button is only rendered when canRemovePaper() is true, so
    // there is no path that would ask the user to type a code back in.
    expect(canRemovePaper({}, key)).toBe(false);
  });
});
