/**
 * internalMarks.ts — truthful display helpers for the marks page. Pending
 * components are never shown as a zero, and the total is the weighted internal
 * figure from the shared grade model — not a raw sum of six cells that mixed a
 * 15-mark CAT with a 5-mark DA and ignored every extra VTOP row.
 */

import type { CourseMarks } from '../types';
import { internalMarksOf } from './gradeModel';

/**
 * A mark the way VTOP writes it: whole numbers stay whole, decimals keep at
 * most two places with trailing zeros trimmed (12.80 → 12.8, 12.00 → 12).
 */
export function formatInternalMark(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function getInternalMarksSummary(mark?: CourseMarks | null): string {
  if (!mark) return 'Internal marks not available';
  const summary = internalMarksOf(mark);

  if (summary.gradedWeight > 0) {
    return `Internal: ${formatInternalMark(summary.earned)}/${formatInternalMark(summary.gradedWeight)}`;
  }
  if (summary.rawMax > 0) {
    return `Internal: ${formatInternalMark(summary.rawScored)}/${formatInternalMark(summary.rawMax)}`;
  }
  return 'Internal marks not available';
}

export function getCourseAcademicLabel(mark?: CourseMarks | null, attendancePercentage?: number | null): string {
  if (mark) return getInternalMarksSummary(mark);
  return Number.isFinite(attendancePercentage) ? `${Number(attendancePercentage).toFixed(1)}% attendance` : 'Not available';
}

export interface InternalMarksRatio {
  scored: number;
  max: number;
  /** 0-100, already clamped — the marks a student has out of what was held. */
  percent: number;
}

export function getInternalMarksRatio(mark?: CourseMarks | null): InternalMarksRatio | null {
  if (!mark) return null;
  const summary = internalMarksOf(mark);
  const scored = summary.gradedWeight > 0 ? summary.earned : summary.rawScored;
  const max = summary.gradedWeight > 0 ? summary.gradedWeight : summary.rawMax;
  if (!(max > 0)) return null;
  return { scored, max, percent: Math.max(0, Math.min(100, (scored / max) * 100)) };
}
