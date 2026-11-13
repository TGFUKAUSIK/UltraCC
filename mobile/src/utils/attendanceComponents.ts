/**
 * attendanceComponents.ts — theory / lab attendance separation (ported verbatim
 * from the web app). VTOP reports attendance as ONE ROW PER COMPONENT; this
 * module classifies and groups rows without inventing any weighting.
 */

import type { AttendanceRecord } from '../types';

export type AttendanceComponent = 'Theory' | 'Lab' | 'Project' | 'Unknown';

export const COMPONENT_ORDER: AttendanceComponent[] = ['Theory', 'Lab', 'Project', 'Unknown'];

export interface ComponentAttendance {
  kind: AttendanceComponent;
  rows: AttendanceRecord[];
  attended: number;
  conducted: number;
  percentage: number | null;
}

export interface CourseAttendanceGroup {
  key: string;
  courseCode: string;
  courseTitle: string;
  components: ComponentAttendance[];
  rows: AttendanceRecord[];
  attended: number;
  conducted: number;
  percentage: number | null;
  isSplit: boolean;
}

export interface ComponentTotals {
  theory: ComponentAttendance;
  lab: ComponentAttendance;
  project: ComponentAttendance;
  unknown: ComponentAttendance;
  present: ComponentAttendance[];
  attended: number;
  conducted: number;
  percentage: number | null;
}

const normalize = (value: string | undefined | null) =>
  (value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const LAB_SLOT = /^L\d{1,2}/;

export function attendanceComponent(
  record: Pick<AttendanceRecord, 'courseType' | 'slot' | 'courseCode' | 'courseTitle'>,
): AttendanceComponent {
  const type = normalize(record.courseType);
  if (['ELA', 'LO'].includes(type) || type.includes('LAB')) return 'Lab';
  if (['ETH', 'TH'].includes(type) || type.includes('THEORY')) return 'Theory';
  if (['EPJ', 'PJT'].includes(type) || type.includes('PROJECT')) return 'Project';

  const slot = (record.slot || '').trim().toUpperCase();
  if (LAB_SLOT.test(slot)) return 'Lab';
  if (hasLabCodeSuffix(record.courseCode) || hasLabTitleSuffix(record.courseTitle)) return 'Lab';
  return 'Unknown';
}

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

export function baseCourseCode(code: string | undefined | null): string {
  const c = (code || '').trim().toUpperCase();
  if (!c) return '';
  const stripped = c.replace(/\s*\(L\)\s*$/, '').replace(/\s+LAB$/, '').replace(/L$/, '');
  return stripped.length >= 4 ? stripped : c;
}

const sum = (rows: AttendanceRecord[]) =>
  rows.reduce(
    (acc, r) => ({ attended: acc.attended + (Number(r.attended) || 0), conducted: acc.conducted + (Number(r.totalHeld) || 0) }),
    { attended: 0, conducted: 0 },
  );

function toPercentage(attended: number, conducted: number): number | null {
  if (!conducted || conducted <= 0) return null;
  return Math.round((attended / conducted) * 1000) / 10;
}

function buildComponent(kind: AttendanceComponent, rows: AttendanceRecord[]): ComponentAttendance {
  const { attended, conducted } = sum(rows);
  return { kind, rows, attended, conducted, percentage: toPercentage(attended, conducted) };
}

function titleFor(rows: AttendanceRecord[]): string {
  return rows.find((r) => (r.courseTitle || '').trim())?.courseTitle || '';
}

export function groupCourseAttendance(records: AttendanceRecord[]): CourseAttendanceGroup[] {
  const groups = new Map<string, AttendanceRecord[]>();

  for (const record of records) {
    const base = baseCourseCode(record.courseCode);
    const key = base || `__ungrouped-${groups.size}`;
    const existing = groups.get(key);
    if (existing) existing.push(record);
    else groups.set(key, [record]);
  }

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
      isSplit: byKind.has('Theory') && (byKind.has('Lab') || byKind.has('Project')),
    } satisfies CourseAttendanceGroup;
  });
}

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

export function findCourseGroup(code: string, groups: CourseAttendanceGroup[]): CourseAttendanceGroup | null {
  if (!code) return null;
  const base = baseCourseCode(code);
  return groups.find((g) => g.key === base) ?? groups.find((g) => g.rows.some((r) => normalize(r.courseCode) === normalize(code))) ?? null;
}

export function componentLabel(kind: AttendanceComponent): string {
  switch (kind) {
    case 'Theory': return 'Theory';
    case 'Lab': return 'Lab';
    case 'Project': return 'Project';
    default: return 'Component unknown';
  }
}
