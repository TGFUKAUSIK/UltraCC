/**
 * push tests — the planning half of background notifications.
 *
 * The server only delivers what this plan contains, so the contract matters:
 * absolute (timezone-proof) timestamps, one reminder per session, nothing in
 * the past, nothing duplicated, and a bounded payload.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPushPlan, classifyPushBackendError, countUpcoming, describePushHealth, type PushPlanInput,
} from '../push';
import type { LmsQuizWindow } from '../lms/types';

type PlanSlot = PushPlanInput['timetable'][number];

const slot = (overrides: Partial<PlanSlot> = {}): PlanSlot => ({
  day: 'Wednesday', startTime: '10:00', endTime: '10:50', courseCode: 'CSE1012', venue: 'AB1-301', isLab: false, slot: 'A1',
  ...overrides,
});

/** Plan for today only — most cases below are about a single day's classes. */
const todayOnly = (input: Omit<PushPlanInput, 'horizonDays'>) => buildPushPlan({ ...input, horizonDays: 0 });

// Local-time anchor: Wednesday 16 Sep 2026, 09:00.
const NOW = new Date(2026, 8, 16, 9, 0, 0).getTime();

describe('buildPushPlan — classes', () => {
  it('plans a reminder ten minutes before each upcoming class', () => {
    const plan = todayOnly({ timetable: [slot({})], now: NOW });

    expect(plan).toHaveLength(1);
    const expected = new Date(2026, 8, 16, 9, 50, 0).getTime();
    expect(plan[0].at).toBe(Math.floor(expected / 1000)); // epoch SECONDS
    expect(plan[0].title).toBe('Class soon: CSE1012');
    expect(plan[0].body).toContain('AB1-301');
    expect(plan[0].body).toContain('until 10:50 AM');
    expect(plan[0].url).toBe('/?tab=timetable');
  });

  it('never plans a reminder for a class that already started', () => {
    const plan = todayOnly({
      timetable: [slot({ startTime: '08:00', endTime: '08:50' }), slot({ startTime: '09:05', endTime: '09:55' })],
      now: NOW, // 09:00 — the 08:00 class is over, the 09:05 one is within the lead window
    });
    expect(plan).toHaveLength(0);
  });

  it('covers the whole planning horizon, not just today', () => {
    const plan = buildPushPlan({
      timetable: [slot({}), slot({ day: 'Thursday', startTime: '09:00', endTime: '09:50', courseCode: 'MAT2001' })],
      now: NOW,
      horizonDays: 7,
    });
    const thursday = plan.find((reminder) => reminder.id.includes('MAT2001'));
    expect(thursday).toBeDefined();
    expect(thursday!.at).toBe(Math.floor(new Date(2026, 8, 17, 8, 50, 0).getTime() / 1000));
  });

  it('covers a full week by default so a closed browser keeps its reminders', () => {
    const today = todayOnly({ timetable: [slot({})], now: NOW });
    const week = buildPushPlan({ timetable: [slot({})], now: NOW }); // default horizon
    expect(today).toHaveLength(1);
    // Today plus the same weekday next week — the plan must survive a week away.
    expect(week).toHaveLength(2);
    expect(week[1].at - week[0].at).toBe(7 * 24 * 60 * 60);
  });

  it('fires one reminder for a combined 2-slot lab session', () => {
    const plan = todayOnly({
      timetable: [slot({ startTime: '14:00', endTime: '15:40', courseCode: 'CSE1012', isLab: true })],
      now: NOW,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].at).toBe(Math.floor(new Date(2026, 8, 16, 13, 50, 0).getTime() / 1000));
  });

  it('names the VTOP slot in the reminder body so the student knows which period', () => {
    const plan = todayOnly({
      timetable: [
        slot({ slot: 'A1' }),
        slot({ startTime: '14:00', endTime: '15:40', courseCode: 'CSE1012L', isLab: true, slot: 'L31+L32' }),
      ],
      now: NOW,
    });
    expect(plan.find((r) => r.title === 'Class soon: CSE1012')!.body).toContain('slot A1');
    // The combined lab names BOTH VTOP tokens — one session, one reminder.
    expect(plan.find((r) => r.title === 'Class soon: CSE1012L')!.body).toContain('slot L31+L32');
  });

  it('deduplicates identical rows and stays chronological with unique ids', () => {
    const plan = todayOnly({
      timetable: [
        slot({ startTime: '14:00', endTime: '14:50' }),
        slot({ startTime: '10:00', endTime: '10:50' }),
        slot({ startTime: '10:00', endTime: '10:50' }),
      ],
      now: NOW,
    });
    expect(plan).toHaveLength(2);
    expect(plan[0].at).toBeLessThan(plan[1].at);
    expect(new Set(plan.map((reminder) => reminder.id)).size).toBe(2);
  });

  it('caps the payload so one device cannot upload an unbounded plan', () => {
    const busy = Array.from({ length: 40 }, (_, index) => slot({ startTime: `1${index % 6}:${index < 6 ? '00' : '10'}`, courseCode: `C${index}` }));
    const plan = todayOnly({ timetable: busy, now: NOW, maxReminders: 5 });
    expect(plan).toHaveLength(5);
  });

  it('plans nothing without timetable data', () => {
    expect(buildPushPlan({ timetable: [], now: NOW })).toEqual([]);
  });
});

describe('buildPushPlan — LMS quizzes', () => {
  const quiz = (overrides: Partial<LmsQuizWindow> = {}): LmsQuizWindow => ({
    quizId: 42,
    name: 'Quiz 1',
    openTime: null,
    closeTime: null,
    attemptLimit: 1,
    timeLimitMins: 20,
    submissionStatus: null,
    url: 'https://lms.vit.ac.in/mod/quiz/view.php?id=42',
    ...overrides,
  });

  it('mirrors the in-app quiz windows (open +15 min, close −15/−5 min)', () => {
    const plan = buildPushPlan({
      timetable: [],
      now: NOW,
      quizzes: [quiz({
        openTime: new Date(2026, 8, 16, 9, 30).toISOString(),
        closeTime: new Date(2026, 8, 16, 10, 20).toISOString(),
      })],
    });

    const ids = plan.map((reminder) => reminder.id);
    expect(ids).toContain('quiz:42:opened');
    expect(ids).toContain('quiz:42:close-15min');
    expect(ids).toContain('quiz:42:close-5min');
    const openReminder = plan.find((reminder) => reminder.id === 'quiz:42:opened')!;
    expect(openReminder.at).toBe(Math.floor(new Date(2026, 8, 16, 9, 15, 0).getTime() / 1000));
    expect(openReminder.url).toBe('/?tab=lms');
  });

  it('drops quiz triggers whose moment has already passed', () => {
    const plan = buildPushPlan({
      timetable: [],
      now: NOW,
      quizzes: [quiz({
        openTime: new Date(2026, 8, 16, 8, 30).toISOString(),  // opened and closed 30 min ago
        closeTime: new Date(2026, 8, 16, 8, 40).toISOString(),
      })],
    });
    expect(plan).toHaveLength(0);
  });
});

describe('classifyPushBackendError', () => {
  it('explains an un-migrated deployment in student copy, not operator copy', () => {
    // PostgREST's schema-cache 404 is what an un-migrated project returns. The
    // migration itself is operator work and only reaches the dev console, so
    // the rendered sentence has to say what still works for the student.
    const message = classifyPushBackendError(404, '{"code":"PGRST202","message":"Could not find the function"}');
    expect(message).toContain('aren\'t available yet');
    expect(message).not.toMatch(/migration|deploy|postgrest|sql|vapid|rpc/i);
  });

  it('keeps transient server failures distinct from configuration problems', () => {
    const message = classifyPushBackendError(503, 'upstream unavailable');
    expect(message).toContain('temporarily unavailable');
    expect(message).not.toContain('migration');
  });

  it('returns null when the underlying error is the clearest thing to show', () => {
    expect(classifyPushBackendError(400, 'PUSH_INVALID_KEYS')).toBeNull();
  });
});

describe('describePushHealth', () => {
  const NOW = new Date(2026, 8, 16, 9, 0, 0).getTime();
  const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

  it('says nothing when the backend cannot be reached', () => {
    expect(describePushHealth(null, NOW)).toBeNull();
  });

  it('admits that the scheduler has never checked in', () => {
    // This is the case where the toggle would otherwise pretend to be working.
    expect(describePushHealth({ deliveryActive: false, lastRunAt: null }, NOW)).toContain('not running');
  });

  it('reports a scheduler that has gone quiet', () => {
    const note = describePushHealth({ deliveryActive: false, lastRunAt: minutesAgo(40) }, NOW);
    expect(note).toContain('stopped checking in');
  });

  it('summarises a healthy dispatcher with real delivery counts', () => {
    const note = describePushHealth({
      deliveryActive: true, lastRunAt: minutesAgo(1), sent24h: 4, lastDeliveryAt: minutesAgo(12),
    }, NOW);
    expect(note).toContain('checked 1 min ago');
    expect(note).toContain('4 delivered in 24h');
    expect(note).toContain('last sent 12 min ago');
  });

  it('does not claim deliveries when there have been none', () => {
    const note = describePushHealth({ deliveryActive: true, lastRunAt: minutesAgo(0), sent24h: 0 }, NOW);
    expect(note).toContain('just now');
    expect(note).not.toContain('delivered');
  });
});

describe('countUpcoming', () => {
  it('counts only reminders still ahead of now', () => {
    const plan = buildPushPlan({
      timetable: [slot({}), slot({ day: 'Thursday', startTime: '09:00', endTime: '09:50' })],
      now: NOW,
      horizonDays: 1, // today (Wed) + tomorrow (Thu)
    });
    expect(plan).toHaveLength(2);
    expect(countUpcoming(plan, NOW)).toBe(2);
    // After today's class, only tomorrow's reminder is still ahead.
    expect(countUpcoming(plan, new Date(2026, 8, 16, 10, 0).getTime())).toBe(1);
    expect(countUpcoming(plan, new Date(2026, 8, 17, 9, 0).getTime())).toBe(0);
  });
});
