/**
 * labSessions tests — the VIT FFCS class-session model.
 *
 * Theory class = 1 slot. Lab class = 2 consecutive slots rendered as ONE
 * combined session, never two independent classes.
 */

import { describe, it, expect } from 'vitest';
import type { TimetableSlot } from '../../types';
import {
  isLabSlotToken,
  isLabSession,
  sessionDurationMinutes,
  sessionsOverlap,
  mergeConsecutiveLabPair,
  combineLabSessions,
  sessionPeriodCount,
  periodsPerClass,
} from '../labSessions';

function theory(overrides: Partial<TimetableSlot> = {}): TimetableSlot {
  return {
    id: 'mon-a1-cse1001',
    courseCode: 'CSE1001',
    courseTitle: 'Problem Solving',
    slot: 'A1',
    facultyName: 'Dr. X',
    venue: 'SJT 101',
    building: 'SJT',
    roomNo: '101',
    day: 'Monday',
    startTime: '08:00',
    endTime: '08:50',
    isLab: false,
    ...overrides,
  };
}

function labRow(overrides: Partial<TimetableSlot> = {}): TimetableSlot {
  return {
    id: 'mon-l31-cse1002',
    courseCode: 'CSE1002',
    courseTitle: 'Data Structures Lab',
    slot: 'L31',
    facultyName: 'Dr. Y',
    venue: 'TT 302',
    building: 'Lab Block',
    roomNo: '302',
    day: 'Monday',
    startTime: '14:00',
    endTime: '14:50',
    isLab: true,
    ...overrides,
  };
}

describe('isLabSlotToken / isLabSession', () => {
  it('recognizes lab slot tokens and combined lab slot strings', () => {
    expect(isLabSlotToken('L31')).toBe(true);
    expect(isLabSlotToken('l7')).toBe(true);
    expect(isLabSlotToken('A1')).toBe(false);
    expect(isLabSlotToken('TB2')).toBe(false);
    expect(isLabSlotToken('TAA1')).toBe(false);

    expect(isLabSession(labRow({ slot: 'L31+L32' }))).toBe(true);
    expect(isLabSession(theory({ slot: 'A1+TA1' }))).toBe(false);
    // courseType identifies a lab even when the slot string is empty.
    expect(isLabSession({ ...theory({ isLab: false, slot: '' }), courseType: 'ELA' })).toBe(true);
  });
});

describe('session duration', () => {
  it('theory class = 1 slot = 50 minutes', () => {
    const t = theory();
    expect(sessionDurationMinutes(t)).toBe(50);
    expect(sessionPeriodCount(t)).toBe(1);
  });

  it('counts the periods a class costs even when the row carries no clock', () => {
    // Attendance rows have a slot but no start/end time. VTOP also shortens a
    // lab's slot to its first token in the detail link, so `L31` must still
    // cost two periods — the same fact sessionPeriodCount reads from 100 minutes.
    expect(periodsPerClass({ slot: 'A1', courseType: 'ETH' })).toBe(1);
    expect(periodsPerClass({ slot: 'L31+L32', courseType: 'ELA' })).toBe(2);
    expect(periodsPerClass({ slot: 'L31', courseType: 'ELA' })).toBe(2);
    expect(periodsPerClass({ slot: '', courseType: 'ELA' })).toBe(2);
  });

  it('combined 2-slot lab session = 100 minutes = 2 periods', () => {
    const lab = mergeConsecutiveLabPair(
      labRow({ slot: 'L31', startTime: '14:00', endTime: '14:50' }),
      labRow({ id: 'mon-l32-cse1002', slot: 'L32', startTime: '14:50', endTime: '15:40' }),
    )!;
    expect(lab).not.toBeNull();
    expect(lab.slot).toBe('L31+L32');
    expect(lab.startTime).toBe('14:00');
    expect(lab.endTime).toBe('15:40');
    expect(sessionDurationMinutes(lab)).toBe(100);
    expect(sessionPeriodCount(lab)).toBe(2);
  });

  it('returns null duration for missing/garbled times instead of guessing', () => {
    expect(sessionDurationMinutes(theory({ startTime: '', endTime: '08:50' }))).toBeNull();
    expect(sessionDurationMinutes(theory({ startTime: '08:50', endTime: '08:00' }))).toBeNull();
  });
});

describe('mergeConsecutiveLabPair', () => {
  it('merges exactly-consecutive lab rows for the same course/day', () => {
    const merged = mergeConsecutiveLabPair(
      labRow({ slot: 'L1', startTime: '08:00', endTime: '08:50' }),
      labRow({ id: 'mon-l2-cse1002', slot: 'L2', startTime: '08:50', endTime: '09:40' }),
    );
    expect(merged?.slot).toBe('L1+L2');
    expect(merged?.endTime).toBe('09:40');
    expect(merged?.isLab).toBe(true);
  });

  it('never merges non-consecutive rows, different courses, or different days', () => {
    // 10-minute gap between L3 and L4 boundaries (09:40 → 09:50) is NOT consecutive.
    expect(mergeConsecutiveLabPair(
      labRow({ slot: 'L3', startTime: '09:50', endTime: '10:40' }),
      labRow({ slot: 'L4', startTime: '11:40', endTime: '12:30' }),
    )).toBeNull();
    expect(mergeConsecutiveLabPair(
      labRow(),
      labRow({ id: 'mon-l32-cse9999', courseCode: 'CSE9999', slot: 'L32', startTime: '14:50', endTime: '15:40' }),
    )).toBeNull();
    expect(mergeConsecutiveLabPair(
      labRow(),
      labRow({ id: 'tue-l32-cse1002', day: 'Tuesday', slot: 'L32', startTime: '14:50', endTime: '15:40' }),
    )).toBeNull();
    // Theory rows are never merged.
    expect(mergeConsecutiveLabPair(
      theory({ slot: 'A1' }),
      theory({ id: 'mon-f1-cse1001', slot: 'F1', startTime: '08:55', endTime: '09:45' }),
    )).toBeNull();
  });
});

describe('combineLabSessions', () => {
  it('renders a 2-slot lab as ONE session while theory rows pass through', () => {
    const combined = combineLabSessions([
      theory({ slot: 'A1' }),
      labRow({ slot: 'L31', startTime: '14:00', endTime: '14:50' }),
      labRow({ id: 'mon-l32-cse1002', slot: 'L32', startTime: '14:50', endTime: '15:40' }),
      theory({ id: 'mon-b1-mat2001', courseCode: 'MAT2001', slot: 'B1', startTime: '09:50', endTime: '10:40' }),
    ]);
    expect(combined).toHaveLength(3);
    const lab = combined.find((s) => s.courseCode === 'CSE1002')!;
    expect(lab.slot).toBe('L31+L32');
    expect(lab.startTime).toBe('14:00');
    expect(lab.endTime).toBe('15:40');
    expect(lab.isLab).toBe(true);
  });

  it('keeps an unpaired lab row as its own session (never fabricated)', () => {
    const combined = combineLabSessions([
      labRow({ slot: 'L31', startTime: '14:00', endTime: '14:50' }),
    ]);
    expect(combined).toHaveLength(1);
    expect(combined[0].slot).toBe('L31');
    expect(combined[0].endTime).toBe('14:50');
  });

  it('merges two separate 2-slot labs for different courses independently', () => {
    const combined = combineLabSessions([
      labRow({ courseCode: 'CSE1002', slot: 'L31', startTime: '14:00', endTime: '14:50' }),
      labRow({ id: 'mon-l32-cse1002', courseCode: 'CSE1002', slot: 'L32', startTime: '14:50', endTime: '15:40' }),
      labRow({ id: 'mon-l33-cse1003', courseCode: 'CSE1003', slot: 'L33', startTime: '15:50', endTime: '16:40' }),
      labRow({ id: 'mon-l34-cse1003', courseCode: 'CSE1003', slot: 'L34', startTime: '16:40', endTime: '17:30' }),
    ]);
    expect(combined).toHaveLength(2);
    const c1 = combined.find((s) => s.courseCode === 'CSE1002')!;
    const c2 = combined.find((s) => s.courseCode === 'CSE1003')!;
    expect(c1.slot).toBe('L31+L32');
    expect(c2.slot).toBe('L33+L34');
  });

  it('does not lose existing combined sessions passed through unchanged', () => {
    const alreadyCombined = labRow({ slot: 'L31+L32', startTime: '14:00', endTime: '15:40' });
    const combined = combineLabSessions([theory(), alreadyCombined]);
    expect(combined).toHaveLength(2);
    expect(combined[1].slot).toBe('L31+L32');
  });

  // VTOP does not guarantee row order, and the grid sorted days only after
  // combining: a lab served as L32-then-L31 used to come back as one lone
  // session plus one overlapping merged session (the same lab twice).
  it('merges a lab served in descending slot order into ONE session', () => {
    const combined = combineLabSessions([
      labRow({ id: 'mon-l32-cse1002', slot: 'L32', startTime: '14:50', endTime: '15:40' }),
      labRow({ slot: 'L31', startTime: '14:00', endTime: '14:50' }),
    ]);
    expect(combined).toHaveLength(1);
    expect(combined[0].slot).toBe('L31+L32');
    expect(combined[0].startTime).toBe('14:00');
    expect(combined[0].endTime).toBe('15:40');
  });

  it('merges a lab served in arbitrary order without duplicating it', () => {
    const combined = combineLabSessions([
      theory({ id: 'mon-b1-mat2001', courseCode: 'MAT2001', slot: 'B1', startTime: '09:50', endTime: '10:40' }),
      labRow({ id: 'mon-l32-cse1002', slot: 'L32', startTime: '14:50', endTime: '15:40' }),
      theory({ slot: 'A1' }),
      labRow({ slot: 'L31', startTime: '14:00', endTime: '14:50' }),
    ]);
    const labs = combined.filter((s) => s.courseCode === 'CSE1002');
    expect(labs).toHaveLength(1);
    expect(labs[0].slot).toBe('L31+L32');
    expect(combined).toHaveLength(3);
  });

  it('never merges lab rows from different days even when times are consecutive', () => {
    const combined = combineLabSessions([
      labRow({ slot: 'L31', startTime: '14:00', endTime: '14:50' }),
      labRow({ id: 'tue-l32-cse1002', day: 'Tuesday', slot: 'L32', startTime: '14:50', endTime: '15:40' }),
    ]);
    expect(combined).toHaveLength(2);
    expect(combined.every((s) => !s.slot.includes('+'))).toBe(true);
  });
});

describe('sessionsOverlap (clash detection over whole sessions)', () => {
  it('detects a theory class clashing with the first hour of a lab session', () => {
    const lab = labRow({ slot: 'L31+L32', startTime: '14:00', endTime: '15:40' });
    const other = theory({ courseCode: 'MAT2001', slot: 'A2', startTime: '14:00', endTime: '14:50' });
    expect(sessionsOverlap(lab, other)).toBe(true);
  });

  it('detects a clash with the SECOND hour of a combined lab session', () => {
    const lab = labRow({ slot: 'L31+L32', startTime: '14:00', endTime: '15:40' });
    const late = theory({ courseCode: 'MAT2001', slot: 'F2', startTime: '14:55', endTime: '15:45' });
    expect(sessionsOverlap(lab, late)).toBe(true);
  });

  it('adjacent sessions do not clash', () => {
    const lab = labRow({ slot: 'L31+L32', startTime: '14:00', endTime: '15:40' });
    const next = theory({ courseCode: 'MAT2001', slot: 'D2', startTime: '15:50', endTime: '16:40' });
    expect(sessionsOverlap(lab, next)).toBe(false);
  });

  it('never clashes across days', () => {
    expect(sessionsOverlap(
      labRow({ slot: 'L31+L32', startTime: '14:00', endTime: '15:40' }),
      theory({ startTime: '14:00', endTime: '15:40', day: 'Tuesday' }),
    )).toBe(false);
  });
});
