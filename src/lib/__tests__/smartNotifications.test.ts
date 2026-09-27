import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateNotificationCandidates, deliverNotifications, loadNotificationPrefs, saveNotificationPrefs,
  markAllSeen, recordMarksSeen, clearNotificationLedger, parseVtopDate,
  DEFAULT_NOTIFICATION_PREFS, NotificationCandidate, SmartNotificationInput,
} from '../smartNotifications';
import type { AssignmentTask, AttendanceRecord, ExamSchedule } from '../../types';

// Fixed "now": 2026-09-14 09:00 IST-ish (use a UTC anchor for determinism)
const NOW = new Date('2026-09-14T09:00:00').getTime();
const DAY = 24 * 60 * 60 * 1000;

const assignment = (over: Partial<AssignmentTask> = {}): AssignmentTask => ({
  id: 'a1', courseCode: 'CSE101', courseTitle: 'Problem Solving', title: 'DA 1',
  dueDate: '2026-09-14', dueTime: '23:59', status: 'Pending', weightage: '10', description: '',
  ...over,
});

const attendance = (over: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  courseCode: 'CSE101', courseTitle: 'Problem Solving', type: 'ETH', slot: 'A1',
  facultyName: 'Dr. A', attended: 20, totalHeld: 30, percentage: 66, category: 'Critical',
  lastUpdated: '', venue: '',
  ...over,
});

const exam = (over: Partial<ExamSchedule> = {}): ExamSchedule => ({
  id: 'e1', courseCode: 'CSE101', courseTitle: 'Problem Solving', examType: 'CAT 1',
  date: '2026-09-16', time: '09:00', venue: 'TT-01', seatNo: 'A12', syllabusTopics: [],
  topicsCompleted: 0, studyPriority: 'High',
  ...over,
});

const baseInput = (): SmartNotificationInput => ({
  assignments: [], attendance: [], exams: [], marksByCourse: {}, campusEvents: [],
  timetable: [], now: NOW,
});

beforeEach(() => {
  localStorage.clear();
});

describe('parseVtopDate', () => {
  it('parses VTOP DD-MM-YYYY and ISO dates', () => {
    expect(parseVtopDate('16-09-2026')).toBe(new Date(2026, 8, 16).getTime());
    expect(parseVtopDate('2026-09-16')).toBe(new Date(2026, 8, 16).getTime());
  });

  it('returns null for garbage', () => {
    expect(parseVtopDate('')).toBeNull();
    expect(parseVtopDate('TBD')).toBeNull();
  });
});

describe('generateNotificationCandidates', () => {
  it('flags pending assignments due within 48h, sorted urgency by proximity', () => {
    const out = generateNotificationCandidates({
      ...baseInput(),
      assignments: [
        assignment({ id: 'soon', dueDate: '2026-09-14' }),   // today → critical
        assignment({ id: 'later', dueDate: '2026-09-15' }),  // tomorrow → warning
        assignment({ id: 'far', dueDate: '2026-09-25' }),    // out of window
        assignment({ id: 'done', dueDate: '2026-09-14', status: 'Submitted' }), // not pending
      ],
    });
    expect(out.length).toBe(2);
    expect(out.find((c) => c.id.includes('soon'))!.urgency).toBe('critical');
    expect(out.find((c) => c.id.includes('later'))!.urgency).toBe('warning');
  });

  it('flags attendance below 75% only', () => {
    const out = generateNotificationCandidates({
      ...baseInput(),
      attendance: [attendance({ courseCode: 'RISK', percentage: 66 }), attendance({ courseCode: 'SAFE', percentage: 92, category: 'Safe' })],
    });
    expect(out.length).toBe(1);
    expect(out[0].title).toContain('RISK');
  });

  it('names the component in a lab attendance risk, not the theory figure', () => {
    const out = generateNotificationCandidates({
      ...baseInput(),
      attendance: [attendance({ courseCode: 'CSE2001', type: 'ELA', slot: 'L31+L32', attended: 3, totalHeld: 6, percentage: 50 })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain('Lab attendance risk');
    expect(out[0].title).not.toContain('Theory');
    expect(out[0].body).toContain('3/6');
    expect(out[0].urgency).toBe('critical'); // 50% is well under the line
  });

  it('gives theory and lab rows of the SAME course code distinct ids', () => {
    const out = generateNotificationCandidates({
      ...baseInput(),
      attendance: [
        attendance({ courseCode: 'CSE2001', type: 'ETH', slot: 'A1', attended: 20, totalHeld: 30, percentage: 66 }),
        attendance({ courseCode: 'CSE2001', type: 'ELA', slot: 'L31+L32', attended: 4, totalHeld: 6, percentage: 66.7 }),
      ],
    });
    expect(out.map((c) => c.id).sort()).toHaveLength(2);
    expect(new Set(out.map((c) => c.id)).size).toBe(2);
    expect(out.some((c) => c.title.startsWith('Theory'))).toBe(true);
    expect(out.some((c) => c.title.startsWith('Lab'))).toBe(true);
  });

  it('does not alarm about a component VTOP has not started yet', () => {
    // 0 classes conducted → percentage is 0, but that is "unknown", not "at risk".
    const out = generateNotificationCandidates({
      ...baseInput(),
      attendance: [attendance({ courseCode: 'CSE3001', type: 'ELA', slot: 'L11+L12', attended: 0, totalHeld: 0, percentage: 0 })],
    });
    expect(out.filter((c) => c.category === 'attendance')).toHaveLength(0);
  });

  it('flags exams within 3 days with honest day counts', () => {
    const out = generateNotificationCandidates({
      ...baseInput(),
      exams: [
        exam({ id: 'today', date: '2026-09-14' }),
        exam({ id: 'soon', date: '2026-09-16' }),
        exam({ id: 'far', date: '2026-09-30' }),
      ],
    });
    expect(out.length).toBe(2);
    expect(out.find((c) => c.id.includes('today'))!.title).toContain('Exam today');
    expect(out.find((c) => c.id.includes('soon'))!.title).toContain('2 days');
  });

  it('flags newly published marks only when the total increased', () => {
    const marks = { CSE101: { totalScoredSoFar: 42, estimatedGrade: 'A' } };
    const first = generateNotificationCandidates({ ...baseInput(), marksByCourse: marks });
    expect(first.filter((c) => c.category === 'marks').length).toBe(0); // nothing seen yet → no noise
    recordMarksSeen(marks);
    const increased = generateNotificationCandidates({ ...baseInput(), marksByCourse: { CSE101: { totalScoredSoFar: 50, estimatedGrade: 'S' } } });
    const marksNotes = increased.filter((c) => c.category === 'marks');
    expect(marksNotes.length).toBe(1);
    expect(marksNotes[0].body).toContain('50');
  });

  it('flags campus events within 3 days', () => {
    const out = generateNotificationCandidates({ ...baseInput(), campusEvents: [{ eid: 'ev1', title: 'Tech Fest', date: '2026-09-15' }] });
    expect(out.length).toBe(1);
    expect(out[0].category).toBe('campusEvents');
  });

  it('adds a single first-class heads-up for today', () => {
    const out = generateNotificationCandidates({
      ...baseInput(),
      timetable: [
        { day: 'Monday', startTime: '10:00', courseCode: 'LATE' },
        { day: 'Monday', startTime: '08:00', courseCode: 'EARLY' },
      ],
    });
    const tt = out.filter((c) => c.category === 'timetable');
    expect(tt.length).toBe(1);
    expect(tt[0].title).toContain('EARLY'); // the earliest, not just any
  });

  it('reminds ~10 minutes before EVERY class today (not just the first)', () => {
    // NOW = 2026-09-14 (a Monday) 09:00. VIT classes start on the hour; use
    // times that put CSE101 inside the 10-min pre-class window and MAT102 just
    // outside it, plus a class on another day that must never appear.
    const out = generateNotificationCandidates({
      ...baseInput(),
      timetable: [
        { day: 'Monday', startTime: '09:05', endTime: '09:55', venue: 'SJT-204', courseCode: 'CSE101' },
        { day: 'Monday', startTime: '11:00', endTime: '11:50', venue: 'AB1-102', courseCode: 'MAT102' },
        { day: 'Tuesday', startTime: '09:05', courseCode: 'TMRW' },
      ],
    });
    const reminders = out.filter((c) => c.id.startsWith('class:'));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].title).toContain('CSE101');
    expect(reminders[0].body).toContain('SJT-204');
    expect(reminders[0].body).toContain('5 min');
    expect(reminders[0].urgency).toBe('warning');
  });

  it('fires the reminder for any point inside the final 10 minutes', () => {
    // 09:05 start observed at 08:56 → 9 min out; at 09:04 → 1 min out.
    for (const nowMs of [new Date('2026-09-14T08:56:00').getTime(), new Date('2026-09-14T09:04:00').getTime()]) {
      const out = generateNotificationCandidates({
        ...baseInput(),
        timetable: [{ day: 'Monday', startTime: '09:05', courseCode: 'CSE101' }],
        now: nowMs,
      });
      expect(out.some((c) => c.id.startsWith('class:'))).toBe(true);
    }
  });

  it('does not remind after a class has started (no noise mid-class)', () => {
    const out = generateNotificationCandidates({
      ...baseInput(),
      timetable: [{ day: 'Monday', startTime: '09:00', courseCode: 'CSE101' }],
      now: new Date('2026-09-14T09:02:00').getTime(),
    });
    expect(out.some((c) => c.id.startsWith('class:'))).toBe(false);
  });

  it('includes combined lab sessions exactly once (single row, single reminder)', () => {
    const out = generateNotificationCandidates({
      ...baseInput(),
      timetable: [{ day: 'Monday', startTime: '14:00', endTime: '15:40', venue: 'AB1-Lab', courseCode: 'CSE2001' }],
      now: new Date('2026-09-14T13:53:00').getTime(), // 7 min before the block
    });
    const reminders = out.filter((c) => c.id.startsWith('class:'));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].body).toContain('15:40');
  });

  it('never fires duplicate ids for the same subject on the same day', () => {
    const input = { ...baseInput(), attendance: [attendance()] };
    const a = generateNotificationCandidates(input);
    const b = generateNotificationCandidates(input);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });
});

describe('deliverNotifications', () => {
  const candidates: NotificationCandidate[] = [
    { id: 'c1', category: 'exams', title: 'Exam', body: '', urgency: 'critical' },
    { id: 'c2', category: 'assignments', title: 'Due', body: '', urgency: 'warning' },
    { id: 'c3', category: 'attendance', title: 'Risk', body: '', urgency: 'info' },
  ];

  it('fires everything on defaults', () => {
    const res = deliverNotifications(candidates);
    expect(res.fired.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('never fires the same id twice (dedup ledger)', () => {
    deliverNotifications(candidates);
    const again = deliverNotifications(candidates);
    expect(again.fired.length).toBe(0);
    expect(again.suppressed).toBe(3);
  });

  it('honors per-category preferences', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, categories: { ...DEFAULT_NOTIFICATION_PREFS.categories, exams: false, attendance: false } };
    const res = deliverNotifications(candidates, prefs);
    expect(res.fired.map((c) => c.id)).toEqual(['c2']);
  });

  it('respects the master kill switch', () => {
    const res = deliverNotifications(candidates, { ...DEFAULT_NOTIFICATION_PREFS, enabled: false });
    expect(res.fired.length).toBe(0);
  });

  it('caps the run and prioritizes urgency', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, maxPerRun: 1 };
    const res = deliverNotifications(candidates, prefs);
    expect(res.fired.length).toBe(1);
    expect(res.fired[0].id).toBe('c1'); // critical wins
  });

  it('persists prefs via the settings helpers', () => {
    saveNotificationPrefs({ ...DEFAULT_NOTIFICATION_PREFS, enabled: false });
    expect(loadNotificationPrefs().enabled).toBe(false);
  });
});

describe('markAllSeen', () => {
  it('suppresses already-seen candidates without firing them', () => {
    const c: NotificationCandidate[] = [{ id: 'x1', category: 'exams', title: 'T', body: '', urgency: 'info' }];
    markAllSeen(c);
    const res = deliverNotifications(c);
    expect(res.fired.length).toBe(0);
  });
});

describe('browser notification boundary', () => {
  it('does not throw when Notification exists but permission is denied', () => {
    vi.stubGlobal('Notification', class { static permission = 'denied'; constructor(public title: string) {} });
    const res = deliverNotifications([{ id: 'n1', category: 'exams', title: 'T', body: '', urgency: 'info' }]);
    expect(res.fired.length).toBe(1); // recorded, just not OS-delivered
    vi.unstubAllGlobals();
  });
});
