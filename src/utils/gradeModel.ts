/**
 * gradeModel.ts — the course-grade arithmetic, on VTOP's own numbers.
 *
 * This is the model the grade predictor, the target-grade simulator and the
 * CGPA planner share. Its shape follows a published VIT Chennai
 * implementation of the same problem, with the parts that would have made a
 * claim VTOP never published removed:
 *
 *   1. WEIGHTS ARE VTOP'S. Every contribution is a row's declared
 *      `weightagePercent` — VTOP's Weightage % column — never a regulation
 *      50/40/10 split imposed from outside. Where VTOP also published its own
 *      Weightage Mark, that number wins over ours.
 *   2. A ROW VTOP HAS NOT GRADED IS NOT A ZERO. Pending weight is held out of
 *      the student's current percentage and projected separately, so an
 *      unheld CAT 2 cannot drag a projection down as a failed exam.
 *   3. THEORY AND LAB ARE DIFFERENT CLASSES. An embedded course is assessed
 *      twice and each half carries its own registered credits (3 + 1), so the
 *      course percentage is the credit-weighted mean of the two halves — not
 *      one blended pile of rows.
 *   4. CREDITS ARE VTOP'S REGISTERED CREDITS or nothing. `credits` is null
 *      when the cache predates credit capture, and every caller has to handle
 *      that instead of assuming 3.
 *
 * VIT's absolute grade bands (S ≥ 90 … F < 40, 10/9/8/7/6/5/0 grade points)
 * and the 40%-of-FAT minimum are used for the target calculation. The
 * community μ/σ relative curve in GradePredictor stays what it always was — a
 * separate, clearly-labelled estimate — and is applied to the score this model
 * produces.
 */

import type { CourseMarks, MarkPart } from '../types';
import { isPendingAssessment } from './assessmentStatus';
import { creditsOfMarkRecord, type CourseCreditProfile } from './courseCredits';

export type GradeLetter = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export const GRADE_ORDER: GradeLetter[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

/** VIT's absolute bands, as published in the academic regulations. */
export const VIT_BANDS: { grade: GradeLetter; min: number; points: number }[] = [
  { grade: 'S', min: 90, points: 10 },
  { grade: 'A', min: 80, points: 9 },
  { grade: 'B', min: 70, points: 8 },
  { grade: 'C', min: 60, points: 7 },
  { grade: 'D', min: 50, points: 6 },
  { grade: 'E', min: 40, points: 5 },
  { grade: 'F', min: 0, points: 0 },
];

export const GRADE_POINTS: Record<GradeLetter, number> = {
  S: 10, A: 9, B: 8, C: 7, D: 6, E: 5, F: 0,
};

/** Target score for each letter, i.e. the band floor. */
export const TARGET_SCORES: Record<GradeLetter, number> = {
  S: 90, A: 80, B: 70, C: 60, D: 50, E: 40, F: 0,
};

/** VIT requires at least this share of the FAT paper to pass the course. */
export const VIT_FAT_MINIMUM_RATIO = 0.4;

export function gradeFromVitPercent(percent: number | null): GradeLetter | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent * 100) / 100;
  for (const band of VIT_BANDS) if (rounded >= band.min) return band.grade;
  return 'F';
}

export function gradePointsOf(grade: GradeLetter | null | undefined): number {
  return grade ? GRADE_POINTS[grade] ?? 0 : 0;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface AssessmentRow {
  key: string;
  title: string;
  /** 'T' theory class / 'L' lab class, from VTOP's own column when available. */
  part: MarkPart;
  max: number;
  /** null = VTOP has not graded this row. Never a zeroed-out exam. */
  scored: number | null;
  /** VTOP's declared weight for this row (its Weightage % column). */
  weightage: number;
  /** VTOP's own weighted mark for the row, when it published one. */
  weightageMark?: number;
  status?: string;
  isFat: boolean;
}

type RowSource = {
  /** VTOP serves ungraded rows with a 0 here; `status` is what grades them. */
  scored?: number;
  max: number;
  weightage: number;
  status?: string;
  weightageMark?: number;
  part?: MarkPart;
  title?: string;
};

/**
 * Is this row one VTOP actually published?
 *
 * A placeholder for an assessment the portal has not declared carries nothing
 * at all (max 0, weight 0, no status); a declared-but-ungraded row carries its
 * max and weight. Only the first is dropped, and a row with no status and no
 * earned mark is treated as ungraded rather than as a scored zero.
 */
function published(row: RowSource | undefined | null): boolean {
  if (!row) return false;
  return (row.max ?? 0) > 0 || (row.weightage ?? 0) > 0;
}

function graded(row: RowSource): boolean {
  if (isPendingAssessment(row.status)) return false;
  if (!row.status && (row.scored ?? 0) === 0 && !row.weightageMark) return false;
  return (row.max ?? 0) > 0 && Number.isFinite(row.scored);
}

function toRow(key: string, part: MarkPart, isFat: boolean, row: RowSource, title?: string): AssessmentRow {
  return {
    key,
    title: title || row.title || fallbackTitle(key),
    part,
    max: row.max ?? 0,
    scored: graded(row) ? Number(row.scored) : null,
    weightage: row.weightage ?? 0,
    weightageMark: row.weightageMark,
    status: row.status,
    isFat,
  };
}

const TITLES: Record<string, string> = {
  cat1: 'CAT 1', cat2: 'CAT 2', da1: 'Digital Assignment 1', da2: 'Digital Assignment 2',
  da3: 'Digital Assignment 3',
  quiz: 'Quiz / Online Assessment', fat: 'FAT', labfat: 'Lab FAT',
};
function fallbackTitle(key: string): string {
  return TITLES[key] || key;
}

/**
 * Every assessment row VTOP served for one course, split into the theory and
 * lab halves it belongs to.
 *
 * Embedded courses arrive with a `part` from VTOP's Course Type / Slot column.
 * Records synced before that was captured fall back to the lab FAT's presence
 * and the course's registered lab credits — still not a guess from titles.
 */
export function assessmentRowsOf(course: CourseMarks): AssessmentRow[] {
  const defaultPart: MarkPart = course.labCredits && !course.theoryCredits ? 'L' : 'T';
  const rows: AssessmentRow[] = [];
  const push = (key: string, isFat: boolean, row: RowSource | undefined | null, title?: string) => {
    if (!published(row)) return;
    const r = row as RowSource;
    rows.push(toRow(key, r.part ?? defaultPart, isFat, r, title));
  };
  push('cat1', false, course.cat1);
  push('cat2', false, course.cat2);
  push('da1', false, course.da1);
  push('da2', false, course.da2);
  push('da3', false, course.da3);
  push('quiz', false, course.quiz);
  for (const [i, ec] of (course.extraComponents ?? []).entries()) {
    push(`extra-${i}`, false, ec, ec.title);
  }
  push('fat', true, course.fat);
  push('labfat', true, course.labFat, 'Lab FAT');
  return rows;
}

// ---------------------------------------------------------------------------
// Component stats (one class: theory or lab)
// ---------------------------------------------------------------------------

export interface PartStats {
  part: MarkPart;
  /** Registered credits for this class; 0 when VTOP's data has none. */
  credits: number;
  /** Σ of the weightage VTOP declared for the rows it published. */
  configuredWeight: number;
  /** Weight VTOP has graded. */
  gradedWeight: number;
  /** Weight VTOP declared but has not graded — still fully earnable. */
  pendingWeight: number;
  /** Weighted marks earned so far, on VTOP's own weights. */
  earned: number;
  /** Weight already out of reach (graded below full marks). */
  lostWeight: number;
  /** Ceiling for this class: everything not yet graded lands at full marks. */
  maxPossibleWeight: number;
  gradedCount: number;
  pendingCount: number;
  rows: AssessmentRow[];
  /** The FAT row of this class, when VTOP declared one. */
  fat: AssessmentRow | null;
}

/** Weighted marks a graded row earns: VTOP's own number when it published one. */
export function earnedOf(row: AssessmentRow): number {
  if (row.scored === null) return 0;
  if (typeof row.weightageMark === 'number' && Number.isFinite(row.weightageMark)) {
    return Math.max(0, Math.min(row.weightage, row.weightageMark));
  }
  if (row.max <= 0) return 0;
  return (row.scored / row.max) * row.weightage;
}

export function computePartStats(rows: AssessmentRow[], part: MarkPart, credits: number): PartStats {
  const stat: PartStats = {
    part,
    credits: Number.isFinite(credits) && credits > 0 ? credits : 0,
    configuredWeight: 0,
    gradedWeight: 0,
    pendingWeight: 0,
    earned: 0,
    lostWeight: 0,
    maxPossibleWeight: 0,
    gradedCount: 0,
    pendingCount: 0,
    rows: [],
    fat: null,
  };
  for (const row of rows) {
    if (row.part !== part) continue;
    stat.rows.push(row);
    stat.configuredWeight += row.weightage;
    if (row.isFat && !stat.fat) stat.fat = row;
    if (row.scored === null) {
      stat.pendingWeight += row.weightage;
      stat.pendingCount += 1;
      continue;
    }
    const earned = earnedOf(row);
    stat.gradedWeight += row.weightage;
    stat.gradedCount += 1;
    stat.earned += earned;
    stat.lostWeight += Math.max(0, row.weightage - earned);
  }
  stat.earned = round2(stat.earned);
  stat.lostWeight = round2(stat.lostWeight);
  stat.maxPossibleWeight = round2(Math.max(0, stat.configuredWeight - stat.lostWeight));
  return stat;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Course model
// ---------------------------------------------------------------------------

export interface CourseGradeModel {
  courseCode: string;
  courseTitle: string;
  /** VTOP's registered credits for the whole course; null when unsynced. */
  credits: number | null;
  creditProfile: CourseCreditProfile | null;
  theoryCredits: number;
  labCredits: number;
  /** Both halves published assessment rows, so each needs credit weighting. */
  isEmbedded: boolean;
  parts: { theory: PartStats | null; lab: PartStats | null };
  /** Σ configured weight over the rows VTOP declared (100 when fully weighted). */
  configuredWeight: number;
  /** Current percentage on the weight VTOP has graded so far. */
  gradedPercent: number | null;
  /** Weight VTOP has declared but not graded, at course level. */
  pendingWeight: number;
  /** Rows still ungraded, in VTOP's own titles. */
  pendingTitles: string[];
  /** Ceiling if every ungraded row lands at full marks. */
  maxPossiblePercent: number | null;
  /** True when VTOP published no weightage at all for this course. */
  weightsUndeclared: boolean;
  /** True when credits are unknown, so the blend is unweighted. */
  creditsUnknown: boolean;
}

export function buildCourseModel(course: CourseMarks): CourseGradeModel {
  const rows = assessmentRowsOf(course);
  const creditProfile = creditsOfMarkRecord(course);
  const theoryCredits = creditProfile?.theory ?? 0;
  const labCredits = creditProfile?.lab ?? 0;

  const hasTheory = rows.some((r) => r.part === 'T');
  const hasLab = rows.some((r) => r.part === 'L');
  const theory = hasTheory ? computePartStats(rows, 'T', theoryCredits || 1) : null;
  const lab = hasLab ? computePartStats(rows, 'L', labCredits || 1) : null;

  const configuredWeight = round2((theory?.configuredWeight ?? 0) + (lab?.configuredWeight ?? 0));
  const earned = (theory?.earned ?? 0) + (lab?.earned ?? 0);
  const gradedWeight = (theory?.gradedWeight ?? 0) + (lab?.gradedWeight ?? 0);
  const pendingWeight = round2((theory?.pendingWeight ?? 0) + (lab?.pendingWeight ?? 0));
  const pendingTitles = rows.filter((r) => r.scored === null).map((r) => r.title);
  const maxPossible = (theory?.maxPossibleWeight ?? 0) + (lab?.maxPossibleWeight ?? 0);

  return {
    courseCode: course.courseCode,
    courseTitle: course.courseTitle,
    credits: creditProfile ? creditProfile.total : null,
    creditProfile,
    theoryCredits,
    labCredits,
    isEmbedded: hasTheory && hasLab,
    parts: { theory, lab },
    configuredWeight,
    gradedPercent: gradedWeight > 0 ? round2((earned / gradedWeight) * 100) : null,
    pendingWeight,
    pendingTitles,
    maxPossiblePercent: configuredWeight > 0 ? round2((maxPossible / configuredWeight) * 100) : null,
    weightsUndeclared: configuredWeight <= 0,
    creditsUnknown: creditProfile === null,
  };
}

export interface ProjectionOptions {
  /**
   * Hypothetical FAT score as a percentage of the FAT paper (0–100), used for
   * FAT rows VTOP has not graded. Omit to project FAT rows at the student's
   * current pace instead of assuming a mark.
   */
  fatPercent?: number;
  /**
   * Percentage assumed for every other ungraded row. Defaults to the student's
   * own graded pace, which is the honest middle: an unheld CAT is neither a
   * zero nor a perfect score.
   */
  pendingPercent?: number;
}

/**
 * Projected course percentage (0–100 of the weight VTOP has declared).
 *
 * Null when nothing is graded and nothing is assumed — the model will not
 * publish a percentage built out of zeros.
 */
export function projectCoursePercent(
  model: CourseGradeModel,
  opts: ProjectionOptions = {},
): number | null {
  const parts = [model.parts.theory, model.parts.lab].filter(Boolean) as PartStats[];
  if (!parts.length) return null;

  const pace = opts.pendingPercent ?? model.gradedPercent ?? null;
  // Nothing graded means there is no pace to project the ungraded rows at, and
  // a percentage built out of assumptions nobody made is a zero wearing a
  // number. The model declines instead of publishing one.
  if (pace === null) return null;
  let weightSum = 0;
  let total = 0;
  for (const part of parts) {
    if (part.configuredWeight <= 0) continue;
    let earned = part.earned;
    for (const row of part.rows) {
      if (row.scored !== null) continue;
      const assumed = row.isFat
        ? (opts.fatPercent != null ? opts.fatPercent : pace)
        : pace;
      if (assumed == null) continue;
      earned += (Math.max(0, Math.min(100, assumed)) / 100) * row.weightage;
    }
    // VTOP sometimes declares only part of a course's scheme (a lab FAT that
    // has not been set up yet). Scale what it declared rather than treating
    // the missing weight as unearnable.
    const percent = (earned / part.configuredWeight) * 100;
    const creditWeight = part.credits > 0 ? part.credits : 1;
    weightSum += creditWeight;
    total += percent * creditWeight;
  }
  if (weightSum <= 0) return null;
  return round2(total / weightSum);
}

/** The same projection expressed against VIT's absolute bands. */
export function projectGrade(
  model: CourseGradeModel,
  opts: ProjectionOptions = {},
): { percent: number | null; grade: GradeLetter | null } {
  const percent = projectCoursePercent(model, opts);
  return { percent, grade: gradeFromVitPercent(percent) };
}

// ---------------------------------------------------------------------------
// Target FAT solver
// ---------------------------------------------------------------------------

export type FatFeasibility = 'secured' | 'easy' | 'moderate' | 'tough' | 'miracle' | 'impossible' | 'unknown';

export interface FatTarget {
  targetPercent: number;
  targetGrade: GradeLetter;
  /** The class whose FAT is being solved (an embedded course's theory paper). */
  part: MarkPart;
  fatDeclared: boolean;
  fatWeight: number;
  fatMax: number;
  /** Course percentage already locked in, with ungraded internals projected. */
  currentPercent: number | null;
  /** Raw marks needed on the FAT paper (0–fatMax); null when not solvable. */
  requiredRaw: number | null;
  requiredPercent: number | null;
  /** VTOP has not weighted the FAT, so no target can be answered. */
  isUnknown: boolean;
  isAlreadyAchieved: boolean;
  isAchievable: boolean;
  /** The required score also clears VIT's 40%-of-FAT minimum. */
  meetsVITMinimumCutoff: boolean;
  /** Marks that minimum itself demands, out of the paper. */
  vitFatMinimumRaw: number | null;
  feasibility: FatFeasibility;
  message: string;
}

/**
 * What must be scored in the FAT for a target course percentage.
 *
 * Solves the real equation for an embedded course: the target is the
 * credit-weighted mean of both halves, so the theory paper only carries
 * theoryCredits/(theoryCredits+labCredits) of it. The lab half is held at its
 * projected pace, exactly as the student's own marks do.
 */
export function solveTargetFAT(
  model: CourseGradeModel,
  targetPercent: number,
  opts: ProjectionOptions = {},
): FatTarget {
  const targetGrade = gradeFromVitPercent(targetPercent) ?? 'F';
  const parts = [model.parts.theory, model.parts.lab].filter(Boolean) as PartStats[];
  // Prefer the theory FAT (the bigger credit share); fall back to the lab's.
  const fatPart = parts.find((p) => p.fat && p.part === 'T')
    ?? parts.find((p) => !!p.fat)
    ?? null;
  const pace = opts.pendingPercent ?? model.gradedPercent ?? null;

  const base: FatTarget = {
    targetPercent,
    targetGrade,
    part: fatPart?.part ?? 'T',
    fatDeclared: !!fatPart?.fat,
    fatWeight: fatPart?.fat?.weightage ?? 0,
    fatMax: fatPart?.fat?.max ?? 0,
    currentPercent: projectCoursePercent(model, opts),
    requiredRaw: null,
    requiredPercent: null,
    isUnknown: true,
    isAlreadyAchieved: false,
    isAchievable: false,
    meetsVITMinimumCutoff: false,
    vitFatMinimumRaw: null,
    feasibility: 'unknown',
    message: '',
  };

  if (!fatPart || !fatPart.fat || fatPart.fat.weightage <= 0) {
    return {
      ...base,
      message: 'VTOP has not declared the final exam weight for this course, so no FAT score can be answered yet.',
    };
  }
  if (pace === null) {
    // Solving needs a pace to hold the ungraded internals at; assuming zero for
    // them would hand back a FAT target built out of marks nobody scored.
    return {
      ...base,
      message: 'Nothing is graded in this course yet, so there is no pace to solve a FAT target from. Re-check after the first internal is evaluated.',
    };
  }
  const fat = fatPart.fat;
  if (fat.scored !== null) {
    // The paper is already graded — the target is settled, not solvable.
    const percent = projectCoursePercent(model, opts);
    return {
      ...base,
      isUnknown: false,
      isAlreadyAchieved: percent !== null && percent >= targetPercent,
      feasibility: percent !== null && percent >= targetPercent ? 'secured' : 'impossible',
      message: percent !== null && percent >= targetPercent
        ? `Your FAT is already graded and the course sits at ${percent.toFixed(1)}% — ${targetGrade} is secured.`
        : `Your FAT is already graded; the course sits at ${(percent ?? 0).toFixed(1)}% and no retake is modelled here.`,
    };
  }

  const creditWeight = (p: PartStats) => (p.credits > 0 ? p.credits : 1);
  // A class VTOP has weighted nothing cannot move the course average, so it is
  // left out of the blend instead of being counted as a zero-credit freebie.
  const active = parts.filter((p) => p.configuredWeight > 0);
  const weightSum = active.reduce((s, p) => s + creditWeight(p), 0);

  /**
   * Course percentage when the solved-for paper is scored at `fatPct` percent
   * of itself, with every other ungraded row held at its projected pace.
   *
   * Linear in `fatPct`, which is what makes the solve exact rather than
   * searched: the theory paper only moves the course by its own credit share
   * of its own weight share.
   */
  const courseAt = (fatPct: number): number => {
    let total = 0;
    for (const part of active) {
      let earned = part.earned;
      for (const row of part.rows) {
        if (row.scored !== null) continue;
        const assumed = row === fat
          ? fatPct
          : (row.isFat ? (opts.fatPercent ?? pace) : pace);
        if (assumed == null) continue;
        earned += (clampPercent(assumed) / 100) * row.weightage;
      }
      total += ((earned / part.configuredWeight) * 100) * creditWeight(part);
    }
    return weightSum > 0 ? total / weightSum : 0;
  };

  const floor = courseAt(0);     // the paper goes blank
  const ceiling = courseAt(100); // the paper goes perfect
  const perPoint = (ceiling - floor) / 100;

  const neededPercent = perPoint > 0
    ? (targetPercent - floor) / perPoint
    : (targetPercent <= floor ? 0 : Infinity);
  const deficit = Math.max(0, neededPercent);
  const rawScore = round2((deficit / 100) * fat.max);
  const achievable = neededPercent <= 100 + 1e-9;
  const vitMin = round2(VIT_FAT_MINIMUM_RATIO * fat.max);
  const requiredPercent = Number.isFinite(neededPercent) ? round2(neededPercent) : null;

  let feasibility: FatFeasibility;
  if (neededPercent <= 0) feasibility = 'secured';
  else if (!achievable) feasibility = 'impossible';
  else if (neededPercent > 90) feasibility = 'miracle';
  else if (neededPercent > 75) feasibility = 'tough';
  else if (neededPercent > 50) feasibility = 'moderate';
  else feasibility = 'easy';

  const message = neededPercent <= 0
    ? `Already on track: ${targetGrade} needs no marks from the FAT on current projections.`
    : !achievable
      ? `Out of reach: even a perfect paper leaves this course at ${ceiling.toFixed(1)}%.`
      : `You need ${rawScore} / ${fat.max} in the ${fatPart.part === 'L' ? 'lab ' : ''}FAT for ${targetGrade}.`;

  return {
    ...base,
    isUnknown: false,
    requiredRaw: neededPercent <= 0 ? 0 : rawScore,
    requiredPercent,
    isAlreadyAchieved: neededPercent <= 0,
    isAchievable: achievable,
    meetsVITMinimumCutoff: rawScore >= vitMin,
    vitFatMinimumRaw: vitMin,
    feasibility,
    message,
  };
}

/** Keeps an assumed score inside the 0–100 band it is a percentage of. */
function clampPercent(pct: number): number {
  return Math.max(0, Math.min(100, pct));
}
