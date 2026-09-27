/**
 * Truthful display helpers for the marks page.
 *
 * VTOP exposes assessment rows before a complete final-grade model exists.
 * These helpers intentionally summarize only evaluated marks and never turn
 * partial marks into a grade/status warning.
 */

import { isEvaluatedAssessment } from './assessmentStatus';

export interface InternalMarkComponent {
  scored?: number | null;
  max?: number | null;
  /** VTOP's own evaluation state — 'Pending' rows are never shown as a zero. */
  status?: string | null;
}

export interface InternalMarksLike {
  cat1?: InternalMarkComponent | null;
  cat2?: InternalMarkComponent | null;
  da1?: InternalMarkComponent | null;
  da2?: InternalMarkComponent | null;
  da3?: InternalMarkComponent | null;
  quiz?: InternalMarkComponent | null;
  /** Kept for compatibility with older cached records; never rendered here. */
  currentEstimatedGrade?: string | null;
}

const COMPONENTS = ['cat1', 'cat2', 'da1', 'da2', 'da3', 'quiz'] as const;

function evaluated(component: InternalMarkComponent | null | undefined): component is Required<InternalMarkComponent> {
  return isEvaluatedAssessment(component)
    && Number(component!.scored) >= 0;
}

function formatMark(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Return recorded marks only; pending components are not treated as zero. */
export function getInternalMarksSummary(mark?: InternalMarksLike | null): string {
  if (!mark) return 'Internal marks not available';
  const rows = COMPONENTS
    .map((key) => mark[key])
    .filter(evaluated);

  if (!rows.length) return 'Internal marks not available';

  const scored = rows.reduce((sum, row) => sum + Number(row.scored), 0);
  const max = rows.reduce((sum, row) => sum + Number(row.max), 0);
  return `Internal: ${formatMark(scored)}/${formatMark(max)}`;
}

/** Dashboard/course label that deliberately ignores legacy inferred grades. */
export function getCourseAcademicLabel(
  mark?: InternalMarksLike | null,
  attendancePercentage?: number | null,
): string {
  if (mark) return getInternalMarksSummary(mark);
  return Number.isFinite(attendancePercentage) ? `${Number(attendancePercentage).toFixed(1)}% attendance` : 'Not available';
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
  const rows = COMPONENTS.map((key) => mark[key]).filter(evaluated);
  if (!rows.length) return null;
  const scored = rows.reduce((sum, row) => sum + Number(row.scored), 0);
  const max = rows.reduce((sum, row) => sum + Number(row.max), 0);
  if (!(max > 0)) return null;
  return { scored, max, percent: Math.max(0, Math.min(100, (scored / max) * 100)) };
}
