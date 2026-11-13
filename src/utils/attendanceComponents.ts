/**
 * attendanceComponents.ts — theory / lab attendance separation.
 *
 * VTOP reports attendance as ONE ROW PER COMPONENT: a course with an embedded
 * lab arrives as `CSE2001` (ETH) plus `CSE2001L` (ELA), each with its own
 * attended / conducted counts and its own percentage. Collapsing those rows
 * into a single course number hides the fact that the theory and the lab are
 * tracked separately, and weighting one of them (a 2× "lab counts double"
 * rule) invents a regulation VTOP never stated.
 *
 * This module therefore does only two honest things:
 *   1. classify each VTOP row as Theory / Lab / Project / Unknown from the
 *      data VTOP itself serves (course type, slot token, code/title suffix);
 *   2. group the rows that belong to the same course so callers can show
 *      `Theory 18/20 = 90%` next to `Lab 8/10 = 80%` and a combined figure
 *      that is the plain sum of the observed rows — never a weighted guess.
 *
 * A row whose component cannot be determined stays 'Unknown' and is rendered
 * as unknown rather than being folded into theory or lab.
 */

import type { AttendanceRecord } from '../types';
import { attendancePercentFromCounts } from './attendanceBands';

export type AttendanceComponent = 'Theory' | 'Lab' | 'Project' | 'Unknown';

/** Stable render order so a course always lists theory before lab. */
export const COMPONENT_ORDER: AttendanceComponent[] = ['Theory', 'Lab', 'Project', 'Unknown'];

export interface ComponentAttendance {
  kind: AttendanceComponent;
  /** The verbatim VTOP rows behind this component (never rewritten). */
  rows: AttendanceRecord[];
  attended: number;
  conducted: number;
  /** null when VTOP has conducted no classes for this component yet. */
  percentage: number | null;
}

export interface CourseAttendanceGroup {
  key: string;
  /** Base course code the group is filed under (`CSE2001L` → `CSE2001`). */
  courseCode: string;
  courseTitle: string;
  /** Only the components that actually exist for this course. */
  components: ComponentAttendance[];
  rows: AttendanceRecord[];
  attended: number;
  conducted: number;
  percentage: number | null;
  /** true when the course has separate theory and lab tracking to show. */
  isSplit: boolean;
}

export interface ComponentTotals {
  theory: ComponentAttendance;
  lab: ComponentAttendance;
  project: ComponentAttendance;
  unknown: ComponentAttendance;
  /** Every component with at least one observed row, in render order. */
  present: ComponentAttendance[];
  attended: number;
  conducted: number;
  percentage: number | null;
}

const normalize = (value: string | undefined | null) =>
  (value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Lab slot tokens are `L31`, `L31+L32`, `L1` … theory slots are `A1`, `B2`. */
const LAB_SLOT = /^L\d{1,2}/;

/**
 * Classify one VTOP attendance row from the fields VTOP serves.
 *
 * Priority: the course-type column (ETH/ELA/EPJ/LO/TH) is authoritative; the
 * slot token and the code/title lab suffix are the fallbacks for rows where
 * the type cell is missing or unrecognised. Anything still unresolved is
 * 'Unknown' — callers must not guess.
 */
export function attendanceComponent(record: Pick<AttendanceRecord, 'type' | 'slot' | 'courseCode' | 'courseTitle'>): AttendanceComponent {
  const type = normalize(record.type);
  if (['ELA', 'LO'].includes(type) || type.includes('LAB')) return 'Lab';
  if (['ETH', 'TH'].includes(type) || type.includes('THEORY')) return 'Theory';
  if (['EPJ', 'PJT'].includes(type) || type.includes('PROJECT')) return 'Project';

  const slot = (record.slot || '').trim().toUpperCase();
  if (LAB_SLOT.test(slot)) return 'Lab';
  if (hasLabCodeSuffix(record.courseCode) || hasLabTitleSuffix(record.courseTitle)) return 'Lab';
  return 'Unknown';
}

/** `CSE2001L` / `CSE2001(L)` / `CSE2001 LAB` → lab row. */
export function hasLabCodeSuffix(code: string | undefined | null): boolean {
  const c = (code || '').trim().toUpperCase();
  if (!c) return false;
  return /\(L\)$/.test(c) || /\bLAB$/.test(c) || /[A-Z0-9]L$/.test(c);
}

export function hasLabTitleSuffix(title: string | undefined | null): boolean {
  const t = (title || '').trim().toLowerCase();
  if (!t) return false;
  return /(\blab(oratory)?\b|\bpractical\b)\s*$/.test(t) || /\(\s*l\s*\)\s*$/.test(t);
}

/**
 * The base course code a row belongs to: the lab suffix VTOP appends to the
 * practical row is removed so `CSE2001` and `CSE2001L` group together. Codes
 * without a suffix are returned unchanged (upper-cased and trimmed).
 */
export function baseCourseCode(code: string | undefined | null): string {
  const c = (code || '').trim().toUpperCase();
  if (!c) return '';
  const stripped = c.replace(/\s*\(L\)\s*$/, '').replace(/\s+LAB$/, '').replace(/L$/, '');
  // Never strip down to nothing (`L` alone is not a base code).
  return stripped.length >= 4 ? stripped : c;
}

const sum = (rows: AttendanceRecord[]) =>
  rows.reduce(
    (acc, r) => ({ attended: acc.attended + (Number(r.attended) || 0), conducted: acc.conducted + (Number(r.totalHeld) || 0) }),
    { attended: 0, conducted: 0 },
  );

/**
 * A combined component, in tenths of a percent.
 *
 * A course's lab can be two VTOP rows, so this is a place an attendance figure
 * is *derived* rather than read from VTOP — the same place the attendance parser
 * stands when VTOP sends counts without a percentage. Both call the one shared
 * rule, `attendancePercentFromCounts`, so a derived figure is never a different
 * number from the label that prints it (see `attendanceBands` for why it
 * truncates).
 */
function toPercentage(attended: number, conducted: number): number | null {
  return attendancePercentFromCounts(attended, conducted);
}

function buildComponent(kind: AttendanceComponent, rows: AttendanceRecord[]): ComponentAttendance {
  const { attended, conducted } = sum(rows);
  return { kind, rows, attended, conducted, percentage: toPercentage(attended, conducted) };
}

function titleFor(rows: AttendanceRecord[]): string {
  return rows.find((r) => (r.courseTitle || '').trim())?.courseTitle || '';
}

/**
 * Group VTOP attendance rows by course, keeping theory and lab apart.
 *
 * Rows are never merged arithmetically inside a component: a course with two
 * lab rows (different slots/faculty) keeps both rows and reports their summed
 * counts, which is the same figure VTOP's own summary shows. Input order is
 * not assumed — grouping is by base code, so a lab row before its theory row
 * still lands in the same group.
 */
export function groupCourseAttendance(records: AttendanceRecord[]): CourseAttendanceGroup[] {
  const groups = new Map<string, AttendanceRecord[]>();

  for (const record of records) {
    const base = baseCourseCode(record.courseCode);
    // A row with no usable code cannot be grouped with anything — keep it as
    // its own single-row group instead of merging it into an unrelated course.
    const key = base || `__ungrouped-${groups.size}`;
    const existing = groups.get(key);
    if (existing) existing.push(record);
    else groups.set(key, [record]);
  }

  // Map iteration order is insertion order, so the result follows VTOP's own
  // row order regardless of how the input was sorted.
  return [...groups.entries()].map(([key, rows]) => {
    const byKind = new Map<AttendanceComponent, AttendanceRecord[]>();
    for (const row of rows) {
      const kind = attendanceComponent(row);
      const list = byKind.get(kind) ?? [];
      list.push(row);
      byKind.set(kind, list);
    }

    const components = COMPONENT_ORDER
      .filter((kind) => byKind.has(kind))
      .map((kind) => buildComponent(kind, byKind.get(kind)!));

    const { attended, conducted } = sum(rows);
    return {
      key,
      courseCode: rows.find((r) => attendanceComponent(r) === 'Theory')?.courseCode || rows[0].courseCode,
      courseTitle: titleFor(rows),
      components,
      rows,
      attended,
      conducted,
      percentage: toPercentage(attended, conducted),
      // Split only when theory AND a practical component are both observed.
      isSplit: byKind.has('Theory') && (byKind.has('Lab') || byKind.has('Project')),
    } satisfies CourseAttendanceGroup;
  });
}

/**
 * Course-wide component split for a set of rows (one course's theory + lab).
 * Returns only the components present, so callers can render an honest
 * "Lab attendance unavailable" instead of a fabricated 0%.
 */
export function componentsFor(records: AttendanceRecord[]): ComponentAttendance[] {
  const byKind = new Map<AttendanceComponent, AttendanceRecord[]>();
  for (const row of records) {
    const kind = attendanceComponent(row);
    const list = byKind.get(kind) ?? [];
    list.push(row);
    byKind.set(kind, list);
  }
  return COMPONENT_ORDER.filter((k) => byKind.has(k)).map((k) => buildComponent(k, byKind.get(k)!));
}

/**
 * Whole-semester component totals. The combined figure is the plain sum of
 * every observed row — theory and lab count once each, exactly as VTOP's own
 * aggregate does. No component is weighted above another.
 */
export function componentTotals(records: AttendanceRecord[]): ComponentTotals {
  const buckets: Record<AttendanceComponent, AttendanceRecord[]> = {
    Theory: [], Lab: [], Project: [], Unknown: [],
  };
  for (const row of records) buckets[attendanceComponent(row)].push(row);

  const theory = buildComponent('Theory', buckets.Theory);
  const lab = buildComponent('Lab', buckets.Lab);
  const project = buildComponent('Project', buckets.Project);
  const unknown = buildComponent('Unknown', buckets.Unknown);
  const present = [theory, lab, project, unknown].filter((c) => c.rows.length > 0);

  const { attended, conducted } = sum(records);
  return { theory, lab, project, unknown, present, attended, conducted, percentage: toPercentage(attended, conducted) };
}

/**
 * The single group a timetable/course code belongs to, so a course detail
 * page opened from a lab row can still show its theory half. Falls back to
 * the exact-code row when no grouping is possible.
 */
export function findCourseGroup(code: string, groups: CourseAttendanceGroup[]): CourseAttendanceGroup | null {
  if (!code) return null;
  const base = baseCourseCode(code);
  return groups.find((g) => g.key === base) ?? groups.find((g) => g.rows.some((r) => normalize(r.courseCode) === normalize(code))) ?? null;
}

/** Human label for a component, including the honest "unknown" case. */
export function componentLabel(kind: AttendanceComponent): string {
  switch (kind) {
    case 'Theory': return 'Theory';
    case 'Lab': return 'Lab';
    case 'Project': return 'Project';
    default: return 'Component unknown';
  }
}
