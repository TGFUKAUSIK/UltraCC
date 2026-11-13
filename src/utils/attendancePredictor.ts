import type { AttendanceRecord, TimetableSlot } from '../types';
import { combineLabSessions, isLabSession, periodsPerClass } from './labSessions';

export type AttendancePredictionAction = 'present' | 'absent' | 'ignore';

export interface PredictionClass {
  slot: TimetableSlot;
  attendanceIndex: number | null;
  action: AttendancePredictionAction;
  mapping: 'matched' | 'unavailable';
}

export interface ProjectedCourseAttendance {
  key: string;
  courseCode: string;
  courseTitle: string;
  currentAttended: number;
  currentTotal: number;
  projectedAttended: number;
  projectedTotal: number;
  currentPercentage: number;
  projectedPercentage: number;
  classCount: number;
}

export interface AttendanceProjection {
  classes: PredictionClass[];
  courses: ProjectedCourseAttendance[];
  overall: {
    currentAttended: number;
    currentTotal: number;
    projectedAttended: number;
    projectedTotal: number;
    currentPercentage: number;
    projectedPercentage: number;
  } | null;
}

const normalize = (value: string | undefined | null) => (value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

function attendanceKind(value: string | undefined | null): 'lab' | 'theory' | 'unknown' {
  const kind = normalize(value);
  if (kind.includes('LAB') || ['ELA', 'EPJ', 'LO'].includes(kind)) return 'lab';
  if (kind.includes('THEORY') || ['ETH', 'TH'].includes(kind)) return 'theory';
  return 'unknown';
}

/**
 * Find a VTOP attendance row only when the timetable row can be matched
 * confidently. Course-code-only matches are accepted only when unique;
 * duplicate theory/lab rows must also agree on slot or course kind.
 */
export function matchAttendanceRecord(slot: TimetableSlot, records: AttendanceRecord[]): number | null {
  const code = normalize(slot.courseCode);
  if (!code) return null;
  let candidates = records.map((record, index) => ({ record, index })).filter(({ record }) => normalize(record.courseCode) === code);
  if (candidates.length === 1) return candidates[0].index;

  const slotKey = normalize(slot.slot);
  if (slotKey) {
    const bySlot = candidates.filter(({ record }) => normalize(record.slot) === slotKey);
    if (bySlot.length === 1) return bySlot[0].index;
    if (bySlot.length > 0) candidates = bySlot;
  }

  // A lab session (possibly a combined 2-slot block) matches the lab
  // attendance row; theory matches theory.
  const kind = isLabSession(slot) ? 'lab' : 'theory';
  const byKind = candidates.filter(({ record }) => attendanceKind(record.type) === kind);
  return byKind.length === 1 ? byKind[0].index : null;
}

const percentage = (attended: number, total: number) => total > 0 ? (attended / total) * 100 : 0;

/** Pure, non-persisting projection. VTOP attendance records are never mutated. */
export function projectAttendance(
  classes: TimetableSlot[],
  records: AttendanceRecord[],
  actions: Record<string, AttendancePredictionAction> = {},
): AttendanceProjection {
  // VTOP's counts are 50-minute periods, so one marked lab adds two of them.
  // Combining first also keeps a caller that still holds the raw L31 / L32
  // pair from counting one lab session twice.
  const sessions = combineLabSessions(classes);
  const predictions = sessions.map((slot) => {
    const attendanceIndex = matchAttendanceRecord(slot, records);
    return {
      slot,
      attendanceIndex,
      action: actions[slot.id] || 'ignore',
      mapping: attendanceIndex === null ? 'unavailable' : 'matched',
    } satisfies PredictionClass;
  });

  const courses = records.map((record, index) => {
    const matched = predictions.filter((prediction) => prediction.attendanceIndex === index);
    // A class costs its own number of periods: 1 for theory, 2 for a lab
    // session. Adding one per class understated every lab in the projection.
    const periods = (action: AttendancePredictionAction) => matched
      .filter((prediction) => prediction.action === action)
      .reduce((sum, prediction) => sum + periodsPerClass(prediction.slot), 0);
    const present = periods('present');
    const absent = periods('absent');
    const projectedAttended = record.attended + present;
    const projectedTotal = record.totalHeld + present + absent;
    return {
      key: `${record.courseCode}-${record.slot || record.type || index}`,
      courseCode: record.courseCode,
      courseTitle: record.courseTitle,
      currentAttended: record.attended,
      currentTotal: record.totalHeld,
      projectedAttended,
      projectedTotal,
      currentPercentage: percentage(record.attended, record.totalHeld),
      projectedPercentage: percentage(projectedAttended, projectedTotal),
      classCount: matched.length,
    } satisfies ProjectedCourseAttendance;
  });

  const currentAttended = records.reduce((sum, record) => sum + record.attended, 0);
  const currentTotal = records.reduce((sum, record) => sum + record.totalHeld, 0);
  const projectedAttended = courses.reduce((sum, course) => sum + course.projectedAttended, 0);
  const projectedTotal = courses.reduce((sum, course) => sum + course.projectedTotal, 0);

  return {
    classes: predictions,
    courses,
    overall: records.length ? {
      currentAttended,
      currentTotal,
      projectedAttended,
      projectedTotal,
      currentPercentage: percentage(currentAttended, currentTotal),
      projectedPercentage: percentage(projectedAttended, projectedTotal),
    } : null,
  };
}
