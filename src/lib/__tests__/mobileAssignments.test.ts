/**
 * The deadline maths behind the mobile Assignments screen. A wrong "Due in 3
 * days" makes a student skip real work, so every branch — the three date shapes
 * VTOP serves, the day count, the ordering and the totals — is pinned here with
 * a fixed "today" rather than trusted.
 *
 * The module lives in the app (mobile/src/utils/assignmentStatus.ts) and is
 * imported directly, the same way the other mobile helpers are tested.
 */

import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  dueLabel,
  groupAssignmentsByCourse,
  parseDueDate,
  summarizeAssignments,
  toAssignmentViews,
  todayAtMidnight,
  urgencyOf,
} from '../../../mobile/src/utils/assignmentStatus';
import type { AssignmentRecord } from '../../../mobile/src/types';

/** A fixed Wednesday, so no test depends on when it runs. */
const NOW = new Date(2026, 8, 30); // 2026-09-30 local
const NOW_ISO = '2026-09-30';

function row(overrides: Partial<AssignmentRecord> & { courseCode: string; title: string }): AssignmentRecord {
  return {
    id: `${overrides.courseCode}-${overrides.title}`,
    courseTitle: '',
    dueDate: '',
    weightage: 0,
    status: 'Pending',
    ...overrides,
  } as AssignmentRecord;
}

describe('the due date VTOP actually sends', () => {
  it('reads the normalised ISO form as a local calendar day', () => {
    const d = parseDueDate(NOW_ISO);
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(30);
  });

  it('reads day/month/year, which VTOP serves on some terms', () => {
    const d = parseDueDate('15/12/2026');
    expect(d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`).toBe('2026-12-15');
  });

  it('reads "12 Sep 2026" and "Sep 12, 2026"', () => {
    expect(parseDueDate('12 Sep 2026')?.getDate()).toBe(12);
    expect(parseDueDate('Sep 12, 2026')?.getMonth()).toBe(8);
  });

  it('refuses to guess at anything it does not recognise', () => {
    expect(parseDueDate('')).toBeNull();
    expect(parseDueDate(null)).toBeNull();
    expect(parseDueDate('TBA')).toBeNull();
    expect(parseDueDate('31 Feb 2026')).toBeNull();
    expect(parseDueDate('13/2026')).toBeNull();
  });
});

describe('counting days to a deadline', () => {
  it('is zero on the due day itself and never drifts with the time of day', () => {
    const morning = new Date(2026, 8, 30, 6, 12);
    const evening = new Date(2026, 8, 30, 22, 45);
    expect(daysBetween(todayAtMidnight(morning), parseDueDate(NOW_ISO)!)).toBe(0);
    expect(daysBetween(todayAtMidnight(evening), parseDueDate(NOW_ISO)!)).toBe(0);
  });

  it('counts ahead and behind correctly', () => {
    const today = todayAtMidnight(NOW);
    expect(daysBetween(today, parseDueDate('2026-10-07')!)).toBe(7);
    expect(daysBetween(today, parseDueDate('2026-09-27')!)).toBe(-3);
  });

  it('names each urgency band the way a student would say it', () => {
    expect(dueLabel(-3)).toBe('Overdue by 3 days');
    expect(dueLabel(-1)).toBe('Overdue by 1 day');
    expect(dueLabel(0)).toBe('Due today');
    expect(dueLabel(1)).toBe('Due tomorrow');
    expect(dueLabel(6)).toBe('Due in 6 days');
    expect(dueLabel(null)).toBe('No due date');
    expect(urgencyOf(7)).toBe('later');
    expect(urgencyOf(2)).toBe('soon');
    expect(urgencyOf(null)).toBe('undated');
  });
});

describe('the order rows appear in', () => {
  it('puts overdue work first and undated work last', () => {
    const views = toAssignmentViews([
      row({ courseCode: 'C4', title: 'no date', dueDate: '' }),
      row({ courseCode: 'C3', title: 'far', dueDate: '2026-11-30' }),
      row({ courseCode: 'C1', title: 'overdue', dueDate: '2026-09-20' }),
      row({ courseCode: 'C2', title: 'today', dueDate: NOW_ISO }),
    ], NOW);

    expect(views.map((v) => v.record.title)).toEqual(['overdue', 'today', 'far', 'no date']);
    expect(views[0].urgency).toBe('overdue');
    expect(views[3].urgency).toBe('undated');
  });

  it('breaks a tie on the course code so the list is stable', () => {
    const views = toAssignmentViews([
      row({ courseCode: 'BMES301', title: 'DA 2', dueDate: NOW_ISO }),
      row({ courseCode: 'BATM202', title: 'DA 1', dueDate: NOW_ISO }),
    ], NOW);
    expect(views.map((v) => v.record.courseCode)).toEqual(['BATM202', 'BMES301']);
  });
});

describe('grouping and totals', () => {
  const views = toAssignmentViews([
    row({ courseCode: 'BCSE305', title: 'DA 1', dueDate: '2026-09-28', status: 'Pending', courseTitle: 'Analysis of Algorithms' }),
    row({ courseCode: 'BCSE305', title: 'DA 2', dueDate: '2026-10-20', status: 'Submitted', courseTitle: 'Analysis of Algorithms' }),
    row({ courseCode: 'BTECH102', title: 'DA 1', dueDate: '2026-10-02', status: 'Pending', courseTitle: 'Professional Communication' }),
    row({ courseCode: 'BCYB301', title: 'DA 1', dueDate: '', status: 'Graded', courseTitle: 'Environmental Studies' }),
  ], NOW);

  it('leads with the course whose live deadline is nearest', () => {
    const groups = groupAssignmentsByCourse(views);
    expect(groups.map((g) => g.courseCode)).toEqual(['BCSE305', 'BTECH102', 'BCYB301']);
    expect(groups[0].nearestDaysLeft).toBe(-2);
  });

  it('counts only pending work as needing attention', () => {
    const groups = groupAssignmentsByCourse(views);
    expect(groups.find((g) => g.courseCode === 'BCSE305')!.pending).toBe(1);
    expect(groups.find((g) => g.courseCode === 'BCYB301')!.nearestDaysLeft).toBeNull();
  });

  it('summarises the whole term in one pass', () => {
    const summary = summarizeAssignments(views);
    expect(summary).toMatchObject({ total: 4, pending: 2, submitted: 1, graded: 1, needingAttention: 1, dueThisWeek: 1 });
  });
});
