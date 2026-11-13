/**
 * Truthful display helpers for the marks page.
 *
 * VTOP exposes assessment rows before a complete final-grade model exists.
 * These helpers intentionally summarize only evaluated marks and never turn
 * partial marks into a grade/status warning.
 *
 * The arithmetic is `internalMarksOf` from the grade model — the same rows and
 * the same weights the predictor uses — so the "Internal: 12.8/15" a student
 * reads on a card is the weighted mark VTOP awarded, not a raw sum of cell
 * values that mixes a 15-mark CAT with a 5-mark DA. Records with no declared
 * weight at all (older caches) still fall back to their raw scored/max, because
 * there the plain division is the only true statement available.
 */

import { attendancePercentLabel } from './attendanceBands';
import { internalMarksOf, type MarksLikeCourse, type MarksLikeRow } from './gradeModel';

/** One VTOP assessment row; kept for callers that spell the shape themselves. */
export type InternalMarkComponent = MarksLikeRow;

export interface InternalMarksLike extends MarksLikeCourse {
  /** Kept for compatibility with older cached records; never rendered here. */
  currentEstimatedGrade?: string | null;
}

/**
 * A mark the way VTOP writes it: whole numbers stay whole, decimals keep at
 * most two places with trailing zeros trimmed (12.80 → 12.8, 12.00 → 12).
 */
export function formatInternalMark(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * The internal figure alone ("12.8/15"), for a table whose row label already
 * says "Internal". Null when nothing internal has been graded.
 */
export function internalMarksValueLabel(mark?: InternalMarksLike | null): string | null {
  if (!mark) return null;
  const summary = internalMarksOf(mark);

  // Weighted first: VTOP's own weight space, the one the final grade lives in.
  if (summary.gradedWeight > 0) {
    return `${formatInternalMark(summary.earned)}/${formatInternalMark(summary.gradedWeight)}`;
  }
  // No weights declared anywhere: the raw cells are all that can be stated.
  if (summary.rawMax > 0) {
    return `${formatInternalMark(summary.rawScored)}/${formatInternalMark(summary.rawMax)}`;
  }
  return null;
}

/** Return recorded marks only; pending components are not treated as zero. */
export function getInternalMarksSummary(mark?: InternalMarksLike | null): string {
  const value = internalMarksValueLabel(mark);
  return value ? `Internal: ${value}` : 'Internal marks not available';
}

/** Dashboard/course label that deliberately ignores legacy inferred grades. */
export function getCourseAcademicLabel(
  mark?: InternalMarksLike | null,
  attendancePercentage?: number | null,
): string {
  if (mark) return getInternalMarksSummary(mark);
  return Number.isFinite(attendancePercentage) ? `${attendancePercentLabel(Number(attendancePercentage))}% attendance` : 'Not available';
}

export interface InternalMarksRatio {
  scored: number;
  max: number;
  /** 0-100, already clamped — the marks a student has out of what was held. */
  percent: number;
}

/**
 * The same rows `getInternalMarksSummary` prints, as a fraction — so a bar can
 * be drawn against the figure the card already states in words.
 *
 * Evaluated rows only, exactly like the summary: a component VTOP has not
 * graded contributes neither marks nor maximum, so a 25/50 CAT 1 with CAT 2
 * still pending reads as 50%, never 25% and never 100%. Null when nothing has
 * been graded, because "0%" and "full" would both be a claim VTOP did not make.
 */
export function getInternalMarksRatio(mark?: InternalMarksLike | null): InternalMarksRatio | null {
  if (!mark) return null;
  const summary = internalMarksOf(mark);
  const scored = summary.gradedWeight > 0 ? summary.earned : summary.rawScored;
  const max = summary.gradedWeight > 0 ? summary.gradedWeight : summary.rawMax;
  if (!(max > 0)) return null;
  return { scored, max, percent: Math.max(0, Math.min(100, (scored / max) * 100)) };
}
