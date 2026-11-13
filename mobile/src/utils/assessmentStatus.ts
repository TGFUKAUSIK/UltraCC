/**
 * assessmentStatus.ts — one rule for "has VTOP actually graded this row?"
 * Ported verbatim; the parser already carries VTOP's own status string and
 * these helpers make it the authority.
 */

export interface AssessmentLike {
  scored?: number | null;
  max?: number | null;
  weightage?: number | null;
  status?: string | null;
}

export function isPendingAssessment(status?: string | null): boolean {
  const s = (status || '').trim().toUpperCase();
  if (!s) return false;
  return s === 'PENDING' || s === 'AB' || s === 'ABSENT' || s === 'N/A' || s.startsWith('NOT EVALUATED');
}

export function isEvaluatedAssessment(component?: AssessmentLike | null): boolean {
  if (!component) return false;
  if (isPendingAssessment(component.status)) return false;
  const scored = component.scored;
  const max = component.max;
  return Number.isFinite(scored as number) && Number.isFinite(max as number) && (max as number) > 0;
}

export function pendingWeightage(component?: AssessmentLike | null): number {
  if (!component || isEvaluatedAssessment(component)) return 0;
  const weight = Number(component.weightage);
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

export function pendingCourseWeightage(components: (AssessmentLike | null | undefined)[]): number {
  return components.reduce((sum, c) => sum + pendingWeightage(c), 0);
}
