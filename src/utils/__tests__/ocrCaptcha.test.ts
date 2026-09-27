import { describe, it, expect } from 'vitest';
import {
  normalizeCaptchaOcr,
  cleanOcrText,
  correctCommonConfusions,
  isPlausibleCaptchaLen,
  isCleanAlnum,
  scoreOcrAttempt,
  pickBestAttempt,
  fuseCaptchaResults,
} from '../../lib/vtop/ocrCaptcha';

describe('normalizeCaptchaOcr', () => {
  it('uppercases and strips non-alphanumeric noise', () => {
    expect(normalizeCaptchaOcr('k7p9m2')).toBe('K7P9M2');
    expect(normalizeCaptchaOcr(' a 3b!c ')).toBe('A3BC');
    expect(normalizeCaptchaOcr('Zx-9_1')).toBe('ZX91');
  });

  it('handles OCR confusions like l→I, o→O', () => {
    expect(normalizeCaptchaOcr('lOwer')).toBe('LOWER');
    expect(normalizeCaptchaOcr('zero o 0')).toBe('ZEROO0');
  });

  it('caps the length at the default 8 chars', () => {
    expect(normalizeCaptchaOcr('ABCDEFGHIJKLMNOP')).toBe('ABCDEFGH');
  });

  it('returns empty for empty or garbage input', () => {
    expect(normalizeCaptchaOcr('')).toBe('');
    expect(normalizeCaptchaOcr('   -_-  ')).toBe('');
    expect(normalizeCaptchaOcr(null as unknown as string)).toBe('');
  });
});

describe('cleanOcrText', () => {
  it('collapses whitespace and strips smart quotes', () => {
    expect(cleanOcrText('  K7  P9\nm2  ')).toBe('K7 P9 m2');
    expect(cleanOcrText('\u2018A\u2019 \u201CB\u201D')).toBe('A B');
  });
});

describe('correctCommonConfusions', () => {
  it('fixes O/I/l next to digits (O1 -> 01, 1O -> 10)', () => {
    expect(correctCommonConfusions('O1')).toBe('01');
    expect(correctCommonConfusions('1O')).toBe('10');
    expect(correctCommonConfusions('I7')).toBe('17');
    expect(correctCommonConfusions('7I')).toBe('71');
    expect(correctCommonConfusions('l2')).toBe('12');
  });

  it('leaves ambiguous standalone letters untouched', () => {
    expect(correctCommonConfusions('OIO')).toBe('OIO');
    expect(correctCommonConfusions('ABC')).toBe('ABC');
    expect(correctCommonConfusions('')).toBe('');
  });
});

describe('plausibility + scoring', () => {
  it('recognizes typical CAPTCHA lengths (4–8)', () => {
    expect(isPlausibleCaptchaLen('K7P9M2')).toBe(true);
    expect(isPlausibleCaptchaLen('ABCD')).toBe(true);
    expect(isPlausibleCaptchaLen('AB')).toBe(false);
    expect(isPlausibleCaptchaLen('ABCDEFGHIJ')).toBe(false);
    expect(isPlausibleCaptchaLen('')).toBe(false);
  });

  it('recognizes clean normalized text', () => {
    expect(isCleanAlnum('K7P9M2')).toBe(true);
    expect(isCleanAlnum('K7 P9')).toBe(false);
    expect(isCleanAlnum('')).toBe(false);
  });

  it('penalizes implausible or unclean attempts in scoring', () => {
    const clean6 = scoreOcrAttempt({ text: 'K7P9M2', confidence: 60, variant: 'v0-word' });
    const short = scoreOcrAttempt({ text: 'K7', confidence: 90, variant: 'v0-word' });
    const dirty = scoreOcrAttempt({ text: 'K7P9M2XQZ', confidence: 85, variant: 'v0-word' });
    // Higher raw confidence can still lose to a plausible-length clean word.
    expect(clean6).toBeGreaterThan(short);
    // 10 chars is outside the typical range -> halved.
    expect(dirty).toBe(85 * 0.5);
  });

  it('pickBestAttempt prefers variant consensus over one confident read', () => {
    // Three variants agree on K7P9M2 (moderate confidence); one mode read K7P9
    // with high confidence. Consensus must win — that is the robust signal.
    const best = pickBestAttempt([
      { text: 'K7P9M2', confidence: 70, variant: 'v0-word' },
      { text: 'K7P9M2', confidence: 74, variant: 'v1-line' },
      { text: 'K7P9M2', confidence: 66, variant: 'v2-raw' },
      { text: 'K7P9', confidence: 95, variant: 'v3-word' },
    ]);
    expect(best?.text).toBe('K7P9M2');
    expect(best?.confidence).toBe(74);
  });

  it('pickBestAttempt uses confidence to break same-count ties', () => {
    const best = pickBestAttempt([
      { text: 'K7P9M2', confidence: 70, variant: 'v0-word' },
      { text: 'K7P9M2', confidence: 74, variant: 'v1-line' },
      { text: 'K7P9MX', confidence: 90, variant: 'v2-raw' },
      { text: 'K7P9MX', confidence: 92, variant: 'v3-word' },
    ]);
    expect(best?.text).toBe('K7P9MX');
  });

  it('pickBestAttempt returns null when nothing usable exists', () => {
    expect(pickBestAttempt([])).toBeNull();
    expect(pickBestAttempt([{ text: 'K7', confidence: 95, variant: 'a' }])).toBeNull();
    expect(pickBestAttempt([{ text: 'K7 P9', confidence: 95, variant: 'a' }])).toBeNull();
  });
});

describe('fuseCaptchaResults', () => {
  it('returns null when neither solver produced a usable read', () => {
    expect(fuseCaptchaResults(null, null)).toBeNull();
  });

  it('returns the only solver that succeeded', () => {
    expect(fuseCaptchaResults(null, { text: 'ABC234', confidence: 0.6 }))
      .toEqual({ text: 'ABC234', confidence: 0.6 });
    expect(fuseCaptchaResults({ text: 'ABC234', confidence: 0.7 }, null))
      .toEqual({ text: 'ABC234', confidence: 0.7 });
  });

  it('boosts confidence when the two solvers agree', () => {
    const r = fuseCaptchaResults(
      { text: 'K7P9M2', confidence: 0.4 },
      { text: 'K7P9M2', confidence: 0.5 },
    );
    expect(r).toEqual({ text: 'K7P9M2', confidence: 0.7 });
  });

  it('caps the agreement boost at 1.0', () => {
    const r = fuseCaptchaResults(
      { text: 'K7P9M2', confidence: 0.95 },
      { text: 'K7P9M2', confidence: 0.9 },
    );
    expect(r!.confidence).toBe(1);
  });

  it('prefers the six-character read when the lengths disagree', () => {
    const r = fuseCaptchaResults(
      { text: 'K7P9M2', confidence: 0.35 },
      { text: 'K7P9M', confidence: 0.9 },
    );
    expect(r).toEqual({ text: 'K7P9M2', confidence: 0.35 });
  });

  it('prefers the more confident read when both are six characters', () => {
    const r = fuseCaptchaResults(
      { text: 'K7P9M2', confidence: 0.4 },
      { text: 'K7P9MX', confidence: 0.8 },
    );
    expect(r).toEqual({ text: 'K7P9MX', confidence: 0.8 });
  });
});
