import { describe, it, expect } from 'vitest';
import { computeQuizTriggers } from '../notifications';
import { LmsQuizWindow } from '../types';

const NOW = new Date('2026-08-20T10:00:00+05:30').getTime();

function quiz(partial: Partial<LmsQuizWindow> = {}): LmsQuizWindow {
  return {
    quizId: 1,
    name: 'Unit 1 Quiz',
    openTime: null,
    closeTime: null,
    attemptLimit: null,
    timeLimitMins: null,
    submissionStatus: null,
    url: 'https://lms.vit.ac.in/mod/quiz/view.php?id=1',
    ...partial,
  };
}

describe('computeQuizTriggers', () => {
  it('schedules open + close alerts for a future quiz', () => {
    const q = quiz({
      openTime: new Date(NOW + 60 * 60 * 1000).toISOString(),      // opens in 1h
      closeTime: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(), // closes in 2h
    });
    const triggers = computeQuizTriggers(q, NOW);
    // 15min before open, 15min before close, 5min before close
    expect(triggers).toHaveLength(3);
    expect(triggers.map((t) => t.triggerKey)).toEqual(['opened', 'close-15min', 'close-5min']);
    // opened fires at open-15m
    expect(triggers[0].at).toBe(NOW + 45 * 60 * 1000);
    // close-15min fires at close-15m
    expect(triggers[1].at).toBe(NOW + 105 * 60 * 1000);
    // close-5min fires at close-5m
    expect(triggers[2].at).toBe(NOW + 115 * 60 * 1000);
  });

  it('does not schedule alerts for a quiz already closed', () => {
    const q = quiz({
      openTime: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
      closeTime: new Date(NOW - 60 * 60 * 1000).toISOString(),
    });
    expect(computeQuizTriggers(q, NOW)).toHaveLength(0);
  });

  it('keeps the open alert when the quiz is not yet open', () => {
    const q = quiz({ openTime: new Date(NOW + 30 * 60 * 1000).toISOString() });
    const triggers = computeQuizTriggers(q, NOW);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].triggerKey).toBe('opened');
  });

  it('produces stable unique ids for dedupe', () => {
    const q = quiz({ openTime: new Date(NOW + 60 * 60 * 1000).toISOString() });
    const [t] = computeQuizTriggers(q, NOW);
    expect(t.id).toBe('1:opened');
  });

  it('returns empty when timings are unknown (never fabricates)', () => {
    expect(computeQuizTriggers(quiz(), NOW)).toHaveLength(0);
  });
});
