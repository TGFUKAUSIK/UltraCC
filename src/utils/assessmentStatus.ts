/**
 * assessmentStatus.ts — one rule for "has VTOP actually graded this row?"
 *
 * VTOP publishes assessment rows BEFORE they are evaluated: a declared FAT
 * arrives as maxMarks 100 / weightageMax 40 / scored 0 / status 'Pending'.
 * Every consumer that only tested `max > 0` therefore read a pending row as a
 * real zero, which produced three separate lies at once:
 *
 *   - "All graded assessments are in" while 35% of the weight was ungraded
 *   - a target declared unreachable when the FAT could still decide it
 *   - a scored 0/100 shown for an exam that has not been held
 *
 * The parser already carries VTOP's own status string; these helpers make it
 * the authority. When a record predates status capture (older caches) the
 * helpers fall back to the previous `max > 0` test — never to a fabricated
 * "graded" claim.
 */

/** Any component shape the marks model uses (UI, canonical or partial). */
export interface AssessmentLike {
  scored?: number | null;
  max?: number | null;
  weightage?: number | null;
  status?: string | null;
}

/**
 * True when VTOP's own row status says the assessment is not graded yet.
 * 'AB' (absent) is reported by the parser as Pending too — VTOP does not let
 * us tell "absent" from "not held" apart, so neither is read as a zero.
 */
export function isPendingAssessment(status?: string | null): boolean {
  const s = (status || '').trim().toUpperCase();
  if (!s) return false; // status unknown → caller falls back to max > 0
  return s === 'PENDING' || s === 'AB' || s === 'ABSENT' || s === 'N/A' || s.startsWith('NOT EVALUATED');
}

/** True when the row carries a grade VTOP published (status-aware). */
export function isEvaluatedAssessment(component?: AssessmentLike | null): boolean {
  if (!component) return false;
  if (isPendingAssessment(component.status)) return false;
  const scored = component.scored;
  const max = component.max;
  return Number.isFinite(scored as number) && Number.isFinite(max as number) && (max as number) > 0;
}

/**
 * Course weight VTOP has declared but not graded yet — the weight a student
 * can still earn. Only rows with an explicit declared weightage count; an
 * undeclared assessment is unknown, not "0% left".
 */
export function pendingWeightage(component?: AssessmentLike | null): number {
  if (!component || isEvaluatedAssessment(component)) return 0;
  const weight = Number(component.weightage);
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/** Total still-ungraded weight across a whole course record. */
export function pendingCourseWeightage(components: (AssessmentLike | null | undefined)[]): number {
  return components.reduce((sum, c) => sum + pendingWeightage(c), 0);
}

/** The three states the assignments UI can show. */
export type AssignmentRowStatus = 'Pending' | 'Submitted' | 'Graded';

/**
 * VTOP's Digital Assignments status word mapped onto those three states.
 *
 * The old mapping tested `/grade/i` before asking whether the word was
 * negated, so VTOP's own "Not Graded" became a blue "Graded" badge and the
 * course header claimed "All in" for work nobody had marked. Negation is
 * checked per phrase rather than as a blanket "contains not", because a row
 * reading "Submitted, not graded" is still a submitted row.
 */
export function classifyAssignmentStatus(raw?: string | null): AssignmentRowStatus {
  const s = (raw || '').toLowerCase();
  const graded = /\b(graded|checked|evaluated|published|declared)\b/.test(s)
    && !/\b(?:not|un)\s*(?:graded|checked|evaluated|published|declared)\b/.test(s);
  const submitted = /\b(submitted|uploaded)\b/.test(s)
    && !/\b(?:not|un)\s*(?:submitted|uploaded)\b/.test(s);
  if (graded) return 'Graded';
  if (submitted) return 'Submitted';
  return 'Pending';
}
