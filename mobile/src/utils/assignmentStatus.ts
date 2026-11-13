/**
 * assignmentStatus.ts — how a VTOP assignment row reads to a student.
 *
 * VTOP's DA list gives a course code, a title, a due date, a weightage and a
 * status word. Nothing here invents a grade or a submission: it only works out
 * how far away the due date is (in whole calendar days, never hours, so a
 * deadline does not slide when the phone's clock crosses midnight) and sorts the
 * rows so the ones that matter today sit at the top.
 *
 * Dates arrive from the gateway normalised to `YYYY-MM-DD` (see
 * normalizeDate in the vtop-gateway parsers), but VTOP also serves
 * `dd/MM/yyyy` and "12 Sep 2026" on some terms, so all three are accepted here
 * and anything else is treated as "no due date" rather than guessed at.
 */

import type { AssignmentRecord } from '../types';

export type AssignmentStatus = AssignmentRecord['status'];
export type AssignmentUrgency = 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later' | 'undated';

export interface AssignmentView {
  record: AssignmentRecord;
  /** Local midnight of the due day, or null when VTOP gave no readable date. */
  dueDate: Date | null;
  /** Whole days from today: negative is overdue, null is undated. */
  daysLeft: number | null;
  urgency: AssignmentUrgency;
  /** "Due in 3 days" / "Overdue by 2 days" — copy for the row. */
  dueLabel: string;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Local midnight for a Y-M-D triple, so timezone offsets cannot shift the day. */
function atLocalMidnight(year: number, month: number, day: number): Date | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 2000 || year > 2100 || month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(year, month, day);
  // Rejects 31 Feb-style input: Date rolls it over to March.
  return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year ? d : null;
}

/** Accepts the three shapes VTOP is known to serve; anything else is null. */
export function parseDueDate(raw: string | undefined | null): Date | null {
  const value = (raw || '').trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return atLocalMidnight(+iso[1], +iso[2] - 1, +iso[3]);

  const dmy = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return atLocalMidnight(+dmy[3], +dmy[2] - 1, +dmy[1]);

  const mdY = value.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{2,4})$/);
  if (mdY) {
    const month = MONTHS[mdY[2].slice(0, 3).toLowerCase()];
    const year = mdY[3].length === 2 ? 2000 + Number(mdY[3]) : Number(mdY[3]);
    if (month !== undefined) return atLocalMidnight(year, month, +mdY[1]);
  }

  const ymdText = value.match(/^([A-Za-z]{3,9})[\s-](\d{1,2}),?\s*(\d{4})$/);
  if (ymdText) {
    const month = MONTHS[ymdText[1].slice(0, 3).toLowerCase()];
    if (month !== undefined) return atLocalMidnight(+ymdText[3], month, +ymdText[2]);
  }

  return null;
}

/** Today at local midnight — the anchor every day count is measured from. */
export function todayAtMidnight(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Whole calendar days between today and the due day (negative = overdue). */
export function daysBetween(today: Date, due: Date): number {
  const MS_PER_DAY = 86_400_000;
  // Dates are already at local midnight; the DST-shift guard is the rounding.
  return Math.round((due.getTime() - today.getTime()) / MS_PER_DAY);
}

export function urgencyOf(daysLeft: number | null): AssignmentUrgency {
  if (daysLeft === null) return 'undated';
  if (daysLeft < 0) return 'overdue';
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  if (daysLeft <= 6) return 'soon';
  return 'later';
}

export function dueLabel(daysLeft: number | null): string {
  if (daysLeft === null) return 'No due date';
  if (daysLeft < 0) {
    const n = Math.abs(daysLeft);
    return `Overdue by ${n} ${n === 1 ? 'day' : 'days'}`;
  }
  if (daysLeft === 0) return 'Due today';
  if (daysLeft === 1) return 'Due tomorrow';
  return `Due in ${daysLeft} days`;
}

const URGENCY_RANK: Record<AssignmentUrgency, number> = {
  overdue: 0, today: 1, tomorrow: 2, soon: 3, later: 4, undated: 5,
};

/**
 * One row per assignment, with the nearest deadline first and undated work at
 * the end. `now` is injectable so the maths is testable against a fixed date.
 */
export function toAssignmentViews(
  records: AssignmentRecord[],
  now: Date = new Date(),
): AssignmentView[] {
  const today = todayAtMidnight(now);
  return records
    .map((record) => {
      const dueDate = parseDueDate(record.dueDate);
      const daysLeft = dueDate ? daysBetween(today, dueDate) : null;
      return {
        record,
        dueDate,
        daysLeft,
        urgency: urgencyOf(daysLeft),
        dueLabel: dueLabel(daysLeft),
      } satisfies AssignmentView;
    })
    .sort((a, b) => {
      const rank = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (rank !== 0) return rank;
      if (a.daysLeft !== null && b.daysLeft !== null && a.daysLeft !== b.daysLeft) {
        return a.daysLeft - b.daysLeft;
      }
      const byCourse = a.record.courseCode.localeCompare(b.record.courseCode);
      if (byCourse !== 0) return byCourse;
      return a.record.title.localeCompare(b.record.title);
    });
}

export interface CourseAssignmentGroup {
  courseCode: string;
  courseTitle: string;
  rows: AssignmentView[];
  pending: number;
  nearestDaysLeft: number | null;
}

/** Rows by course, courses ordered by their nearest live deadline. */
export function groupAssignmentsByCourse(views: AssignmentView[]): CourseAssignmentGroup[] {
  const map = new Map<string, AssignmentView[]>();
  for (const view of views) {
    const code = view.record.courseCode || 'Unlabelled';
    const list = map.get(code);
    if (list) list.push(view);
    else map.set(code, [view]);
  }

  return [...map.entries()]
    .map(([courseCode, rows]): CourseAssignmentGroup => ({
      courseCode,
      courseTitle: rows.find((r) => r.record.courseTitle)?.record.courseTitle || '',
      rows,
      pending: rows.filter((r) => r.record.status === 'Pending').length,
      nearestDaysLeft: rows
        .filter((r) => r.record.status === 'Pending' && r.daysLeft !== null)
        .reduce<number | null>((min, r) => (min === null || (r.daysLeft as number) < min ? (r.daysLeft as number) : min), null),
    }))
    .sort((a, b) => {
      const da = a.nearestDaysLeft ?? Number.MAX_SAFE_INTEGER;
      const db = b.nearestDaysLeft ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return a.courseCode.localeCompare(b.courseCode);
    });
}

export interface AssignmentSummary {
  total: number;
  pending: number;
  submitted: number;
  graded: number;
  /** Pending rows whose due day is today or already past. */
  needingAttention: number;
  /** Pending rows due within the next 7 days (today included). */
  dueThisWeek: number;
}

export function summarizeAssignments(views: AssignmentView[]): AssignmentSummary {
  const pending = views.filter((v) => v.record.status === 'Pending');
  return {
    total: views.length,
    pending: pending.length,
    submitted: views.filter((v) => v.record.status === 'Submitted').length,
    graded: views.filter((v) => v.record.status === 'Graded').length,
    needingAttention: pending.filter((v) => v.daysLeft !== null && v.daysLeft <= 0).length,
    dueThisWeek: pending.filter((v) => v.daysLeft !== null && v.daysLeft >= 0 && v.daysLeft <= 7).length,
  };
}
