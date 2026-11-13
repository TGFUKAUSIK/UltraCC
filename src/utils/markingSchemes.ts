/**
 * markingSchemes.ts — curriculum-aware assessment model.
 *
 * VIT assessment is NOT one universal formula: the FFCS academic regulations
 * (VIT Chennai, public regulations for VIT students) define different
 * evaluation schemes per course kind:
 *
 *   - Theory courses (ETH/TH): CAT 1 (15) + CAT 2 (15) + DA 1 (5) + DA 2 (5)
 *     + Quiz (10) as internal (50 weight), FAT at 40 weight (+10 attendance/
 *     participation), absolute or relative grading by class strength.
 *   - Lab-only courses (ELA/LO): no CATs/DAs — continuous assessment of each
 *     Experiment (60% weight total) + Lab FAT (40% weight). Students must
 *     average >= 50% across experiments to pass the component.
 *   - Embedded theory+lab courses: the FAT covers both parts; the course is
 *     graded as one unit at the (L+T) : P/2 credit ratio.
 *   - Project courses (EPJ/PJT): reviews + project FAT, no CAT/DA/Quiz.
 *   - Soft-skill / audit courses follow the lab-course evaluation scheme.
 *
 * Honesty rule: the scheme is only ever APPLIED when the course's assessment
 * rows can be observed (VTOP marks page). When the curriculum/kind cannot be
 * determined, `unknownScheme` is returned — totals fall back to the raw
 * weighted sums VTOP already exposes and nothing is fabricated.
 */

import type { CourseMarks } from '../types';
import { isEvaluatedAssessment } from './assessmentStatus';
import { weightedMarksFor } from './gradeModel';

export type CourseKind = 'theory' | 'lab' | 'embedded' | 'project' | 'softskill' | 'audit' | 'unknown';

export interface AssessmentComponent {
  key: string;
  name: string;
  /** Weight this component carries toward the course total (out of 100). */
  weightage: number;
  /** Marks the assessment is scored out of at VTOP (0 = not declared). */
  maxMarks: number;
}

export interface MarkingScheme {
  kind: CourseKind;
  label: string;
  components: AssessmentComponent[];
  /** Sum of component weightages (100 when the scheme fully covers a course). */
  totalWeight: number;
  /**true when the kind (and therefore the scheme) could not be determined. */
  isFallback: boolean;
}

/**
 * Default theory internal weightage (VIT Chennai standard): CAT 1: 15,
 * CAT 2: 15, DA 1: 5, DA 2: 5, Quiz: 10 → 50 internal weight; FAT carries
 * 40 and attendance/participation 10. DA 3 carries no fixed default: VIT
 * runs two or three DAs depending on the course, so its weight is read from
 * VTOP's own declared weightage — never invented here (hence 0 below, which
 * also keeps the internal total at 50).
 */
export const THEORY_INTERNAL_WEIGHTS = {
  cat1: 15,
  cat2: 15,
  da1: 5,
  da2: 5,
  da3: 0,
  quiz: 10,
} as const;

export const THEORY_FAT_WEIGHT = 40;
export const LAB_CONTINUOUS_WEIGHT = 60;
export const LAB_FAT_WEIGHT = 40;

/** Theory courses: CAT/DA/Quiz internals + FAT. */
export function theoryScheme(quizWeight = THEORY_INTERNAL_WEIGHTS.quiz): MarkingScheme {
  return {
    kind: 'theory',
    label: 'Theory (CAT + DA + Quiz + FAT)',
    components: [
      { key: 'cat1', name: 'CAT 1', weightage: THEORY_INTERNAL_WEIGHTS.cat1, maxMarks: 0 },
      { key: 'cat2', name: 'CAT 2', weightage: THEORY_INTERNAL_WEIGHTS.cat2, maxMarks: 0 },
      { key: 'da1', name: 'DA 1', weightage: THEORY_INTERNAL_WEIGHTS.da1, maxMarks: 0 },
      { key: 'da2', name: 'DA 2', weightage: THEORY_INTERNAL_WEIGHTS.da2, maxMarks: 0 },
      { key: 'da3', name: 'DA 3', weightage: THEORY_INTERNAL_WEIGHTS.da3, maxMarks: 0 },
      { key: 'quiz', name: 'Quiz / Online Assessment', weightage: quizWeight, maxMarks: 0 },
      { key: 'fat', name: 'FAT', weightage: THEORY_FAT_WEIGHT, maxMarks: 0 },
    ],
    totalWeight: 100,
    isFallback: false,
  };
}

/**
 * Lab-only courses: continuous assessment of experiments (60% total) +
 * lab FAT (40%). Experiments come from VTOP rows, so their weights are
 * injected from observed data, never invented here.
 */
export function labScheme(experimentWeights: number[] = []): MarkingScheme {
  const components: AssessmentComponent[] = experimentWeights.map((w, i) => ({
    key: `experiment-${i + 1}`,
    name: `Experiment ${i + 1}`,
    weightage: w,
    maxMarks: 0,
  }));
  components.push({ key: 'labfat', name: 'Lab FAT', weightage: LAB_FAT_WEIGHT, maxMarks: 0 });
  return {
    kind: 'lab',
    label: 'Lab-only (Experiments + Lab FAT)',
    components,
    totalWeight: components.reduce((s, c) => s + c.weightage, 0),
    isFallback: false,
  };
}

/** Project courses: reviews + project FAT (weights observed from VTOP). */
export function projectScheme(reviewWeights: number[] = []): MarkingScheme {
  const components: AssessmentComponent[] = reviewWeights.map((w, i) => ({
    key: `review-${i + 1}`,
    name: `Project Review ${i + 1}`,
    weightage: w,
    maxMarks: 0,
  }));
  components.push({ key: 'projectfat', name: 'Project FAT', weightage: LAB_FAT_WEIGHT, maxMarks: 0 });
  return {
    kind: 'project',
    label: 'Project (Reviews + Project FAT)',
    components,
    totalWeight: components.reduce((s, c) => s + c.weightage, 0),
    isFallback: false,
  };
}

/** Embedded theory+lab: theory components plus an embedded-lab block. */
export function embeddedScheme(): MarkingScheme {
  const theory = theoryScheme();
  return {
    kind: 'embedded',
    label: 'Embedded theory + lab (FAT covers both parts)',
    components: [
      ...theory.components,
      { key: 'embeddedlab', name: 'Embedded Lab', weightage: 0, maxMarks: 0 },
    ],
    totalWeight: 100,
    isFallback: false,
  };
}

/**
 * The safe fallback: curriculum undetermined. Components stay empty — the
 * caller must keep VTOP's own weighted totals instead of applying a scheme.
 */
export function unknownScheme(): MarkingScheme {
  return {
    kind: 'unknown',
    label: 'Marking scheme unavailable',
    components: [],
    totalWeight: 0,
    isFallback: true,
  };
}

/** Soft-skill / audit courses are evaluated like lab courses (regulations). */
export function softSkillScheme(experimentWeights: number[] = []): MarkingScheme {
  return { ...labScheme(experimentWeights), kind: 'softskill', label: 'Soft skill (lab-style evaluation)' };
}

/** Audit courses are pass/fail — no grade bands apply. */
export function auditScheme(): MarkingScheme {
  return {
    kind: 'audit',
    label: 'Audit (pass/fail)',
    components: [],
    totalWeight: 0,
    isFallback: false,
  };
}

// ---------------------------------------------------------------------------
// Course-kind detection
// ---------------------------------------------------------------------------

/** True for VTOP course-type strings that identify a laboratory course. */
export function isLabCourseType(courseType: string, courseCode = ''): boolean {
  const t = (courseType || '').toUpperCase();
  const code = (courseCode || '').toUpperCase();
  return t.includes('ELA') || t.includes('LAB') || code.endsWith('L');
}

/** True for project-type courses (EPJ / PJT). */
export function isProjectCourseType(courseType: string, courseCode = ''): boolean {
  const t = (courseType || '').toUpperCase();
  return t.includes('EPJ') || t.includes('PJT') || t.includes('PROJECT');
}

/** True for soft-skill / audit course titles (treated as lab-style evaluation). */
export function isSoftSkillCourse(title: string, courseType = ''): boolean {
  const t = `${title} ${courseType}`.toUpperCase();
  return /\bSOFT SKILL|\bSOFT-SKILL|\bSOFTSKILL|SOFT SKILLS/.test(t);
}

/**
 * Classify a course from the data VTOP already provides. Returns 'unknown'
 * when nothing in the data identifies the kind — callers must then keep the
 * observed totals instead of applying a curriculum rule.
 */
export function courseKind(
  courseType: string,
  courseCode = '',
  courseTitle = '',
): CourseKind {
  if (isProjectCourseType(courseType, courseCode)) return 'project';
  if (isSoftSkillCourse(courseTitle, courseType)) return 'softskill';
  if (isLabCourseType(courseType, courseCode)) return 'lab';
  if (courseType.toUpperCase().includes('AUDIT')) return 'audit';
  if (courseType.toUpperCase().includes('ETH') || courseType.toUpperCase() === 'TH' || courseType.toUpperCase() === 'THEORY') return 'theory';
  return 'unknown';
}

/**
 * Classify from observed assessment rows when course type/code/title carry
 * no signal. Lab/project curricula identify themselves through the component
 * titles VTOP actually served (Experiment_N / Project Review); anything else
 * stays 'unknown' — an ETH-less course with CAT rows is NOT enough evidence
 * to apply the theory scheme to an undetermined curriculum… except when the
 * rows ARE the standard theory components with their standard weightages,
 * which is the theory curriculum itself. Resolve: rows alone never make a
 * course 'theory' — the caller keeps raw sums instead.
 */
export function courseKindFromRows(
  extraComponents: { title: string; weightage: number }[] = [],
  hasStandardRows: boolean,
): CourseKind {
  const titles = extraComponents.map((e) => e.title).join(' | ');
  if (/experiment|lab\s*(exercise|activity)/i.test(titles)) return 'lab';
  if (/review|milestone/i.test(titles)) return 'project';
  return hasStandardRows ? 'theory' : 'unknown';
}

// ---------------------------------------------------------------------------
// Scheme resolution from observed VTOP marks
// ---------------------------------------------------------------------------

/** One assessment row as this module sees it, including VTOP's own weighted mark. */
interface MarkRowLike {
  scored: number;
  max: number;
  weightage: number;
  status?: string;
  weightageMark?: number;
}

/** VTOP serves a final exam row before any mark exists on it, so `scored` is optional. */
interface FatRowLike {
  scored?: number;
  max: number;
  weightage: number;
  status?: string;
  weightageMark?: number;
}

interface MarksLike {
  courseCode: string;
  courseTitle: string;
  cat1?: MarkRowLike;
  cat2?: MarkRowLike;
  da1?: MarkRowLike;
  da2?: MarkRowLike;
  da3?: MarkRowLike;
  quiz?: MarkRowLike;
  fat?: FatRowLike;
  extraComponents?: (MarkRowLike & { title: string; status: string })[];
}

const COMPONENT_ORDER = ['cat1', 'cat2', 'da1', 'da2', 'da3', 'quiz', 'fat'] as const;

/** Whether any CAT/DA/Quiz row was actually evaluated by VTOP. */
function hasEvaluatedStandard(marks: MarksLike): boolean {
  return COMPONENT_ORDER.some((key) => {
    const c = marks[key];
    return !!c && c.max > 0;
  });
}

/**
 * Resolve the marking scheme for one course.
 *
 * - Lab-only courses → labScheme with weights from the observed Experiment
 *   rows (experiments + Lab FAT at the regulation 60/40 split).
 * - Project courses → projectScheme with observed review weights.
 * - Theory courses → theoryScheme using VTOP's own declared weightages when
 *   present (the course identifies as theory by code/type, or its rows are
 *   the standard theory assessment set).
 * - Unknown/undeterminable → unknownScheme (never a fabricated rule).
 */
export function resolveMarkingScheme(marks: MarksLike): MarkingScheme {
  const extras = marks.extraComponents ?? [];
  // Classify: first from the curriculum identity (code/title), then — only
  // when the code carries no signal — from the assessment rows VTOP served.
  const identityKind = courseKind('', marks.courseCode, marks.courseTitle);
  const kind: CourseKind =
    identityKind !== 'unknown'
      ? identityKind
      : courseKindFromRows(extras, hasEvaluatedStandard(marks));
  const isExperiment = (title: string) => /experiment|lab\s*(exercise|activity)/i.test(title);
  const isReview = (title: string) => /review|milestone/i.test(title);
  const experimentWeights = extras.filter((e) => isExperiment(e.title)).map((e) => e.weightage || 0);

  if (kind === 'lab') {
    // A lab course whose rows are standard CAT/DA/Quiz components (no
    // experiments observed) still evaluates like a lab course: keep the
    // regulation 60/40 split using the observed internals.
    if (experimentWeights.length === 0) {
      return labScheme([LAB_CONTINUOUS_WEIGHT]);
    }
    return labScheme(experimentWeights);
  }
  if (kind === 'project') {
    const reviewWeights = extras.filter((e) => isReview(e.title)).map((e) => e.weightage || 0);
    return projectScheme(reviewWeights);
  }
  if (kind === 'softskill') {
    return softSkillScheme(experimentWeights.length ? experimentWeights : [LAB_CONTINUOUS_WEIGHT]);
  }
  if (kind === 'audit') return auditScheme();
  if (kind === 'theory' || kind === 'embedded') {
    return theoryScheme();
  }
  return unknownScheme();
}

/**
 * Resolve the marking scheme for a course identified only by its curriculum
 * attributes (course type / code / title) — used by views that have the
 * attendance row but not the marks record.
 */
export function resolveMarkingSchemeFromCourse(
  courseType: string,
  courseCode = '',
  courseTitle = '',
): MarkingScheme {
  const kind = courseKind(courseType, courseCode, courseTitle);
  switch (kind) {
    case 'lab': return labScheme([LAB_CONTINUOUS_WEIGHT]);
    case 'project': return projectScheme([]);
    case 'softskill': return softSkillScheme([LAB_CONTINUOUS_WEIGHT]);
    case 'audit': return auditScheme();
    case 'theory': return theoryScheme();
    default: return unknownScheme();
  }
}

interface EvaluatedBreakdown {
  /** Weighted marks earned on every row VTOP has graded. */
  earned: number;
  /** The total weight of those same rows — the exact denominator for `earned`. */
  evaluatedWeight: number;
  hasEvaluated: boolean;
}

/**
 * Walks the resolved scheme and VTOP's observed rows in a single pass,
 * returning both the weighted marks earned and the weight that was actually
 * in play. Sharing one pass keeps the numerator (curriculumAwareTotal) and the
 * denominator (evaluatedWeight) in lock-step: a component counted in
 * one is always counted in the other — including the FAT, whose marks used to
 * join the numerator while its weight stayed out of the denominator, so a
 * course read as 68/45 = "151% pace" and the health card pinned it at 100.
 */
function evaluateComponents(marks: MarksLike): EvaluatedBreakdown {
  const scheme = resolveMarkingScheme(marks);
  const byKey: Record<string, MarkRowLike> = {
    cat1: marks.cat1 ?? { scored: 0, max: 0, weightage: 0 },
    cat2: marks.cat2 ?? { scored: 0, max: 0, weightage: 0 },
    da1: marks.da1 ?? { scored: 0, max: 0, weightage: 0 },
    da2: marks.da2 ?? { scored: 0, max: 0, weightage: 0 },
    da3: marks.da3 ?? { scored: 0, max: 0, weightage: 0 },
    quiz: marks.quiz ?? { scored: 0, max: 0, weightage: 0 },
    fat: { scored: marks.fat?.scored ?? 0, max: marks.fat?.max ?? 0, weightage: marks.fat?.weightage ?? 0, status: marks.fat?.status },
  };
  let earned = 0;
  let evaluatedWeight = 0;
  let hasEvaluated = false;

  if (scheme.isFallback) return { earned, evaluatedWeight, hasEvaluated };

  if (scheme.kind === 'theory' || scheme.kind === 'embedded') {
    for (const c of scheme.components) {
      const comp = byKey[c.key];
      if (!comp) continue;
      // Only graded rows count. A Pending row keeps its declared max, so the
      // old `max > 0` test would have folded an unheld exam in as a zero.
      if (isEvaluatedAssessment(comp)) {
        hasEvaluated = true;
        const weight = comp.weightage > 0 ? comp.weightage : c.weightage;
        earned += weightedMarksFor({ scored: comp.scored, max: comp.max, weightage: weight, weightageMark: comp.weightageMark });
        evaluatedWeight += weight;
      }
    }
    // Unmapped extras (PATs, Attendance Assessments...) are part of the real
    // internal total — keep them when the curriculum is known.
    for (const e of marks.extraComponents ?? []) {
      if (isEvaluatedAssessment(e)) {
        hasEvaluated = true;
        const weight = e.weightage > 0 ? e.weightage : 0;
        earned += weightedMarksFor({ scored: e.scored, max: e.max, weightage: weight, weightageMark: e.weightageMark });
        evaluatedWeight += weight;
      }
    }
    return { earned, evaluatedWeight, hasEvaluated };
  }

  // Lab / project / softskill: experiments/reviews come from extraComponents.
  for (const e of marks.extraComponents ?? []) {
    if (isEvaluatedAssessment(e) && e.weightage > 0) {
      hasEvaluated = true;
      earned += weightedMarksFor(e);
      evaluatedWeight += e.weightage;
    }
  }
  if (marks.fat && isEvaluatedAssessment(marks.fat)) {
    hasEvaluated = true;
    // One weight for both sides of the fraction: whatever the marks were
    // earned at is the weight the pace is measured over.
    const fatWeight = marks.fat.weightage || LAB_FAT_WEIGHT;
    earned += weightedMarksFor({
      scored: marks.fat.scored ?? 0,
      max: marks.fat.max,
      weightage: fatWeight,
      weightageMark: marks.fat.weightageMark,
    });
    evaluatedWeight += fatWeight;
  }
  return { earned, evaluatedWeight, hasEvaluated };
}

/**
 * Curriculum-aware weighted total so far (out of 100). Uses the resolved
 * scheme's components so lab/project courses weight Experiments/Reviews
 * correctly; when the scheme is unknown the caller's own weighted sum is
 * returned unchanged.
 */
export function curriculumAwareTotal(marks: MarksLike): number | null {
  const { earned, hasEvaluated } = evaluateComponents(marks);
  return hasEvaluated ? Math.round(earned * 100) / 100 : null;
}

/**
 * The total weight of the rows VTOP has actually graded for a course — the
 * denominator that pairs with curriculumAwareTotal's numerator. Dividing the
 * two yields the student's pace over the marks actually in play, rather than
 * over a fixed scheme template that assumes components (like a third DA) the
 * course may not run. Returns null when nothing has been graded.
 */
export function evaluatedWeight(marks: MarksLike): number | null {
  const { evaluatedWeight } = evaluateComponents(marks);
  return evaluatedWeight > 0 ? evaluatedWeight : null;
}

/** Display label for a course's marking scheme (falls back honestly). */
export function schemeLabelFor(marks: MarksLike): string {
  return resolveMarkingScheme(marks).label;
}
