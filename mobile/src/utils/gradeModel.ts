/**
 * gradeModel.ts — the course-grade arithmetic on VTOP's own numbers (ported
 * verbatim). Weights are VTOP's; an ungraded row is not a zero; theory and lab
 * are separate credit-weighted classes; credits are VTOP's registered credits
 * or nothing.
 */

import type { ComponentMark, CourseMarks, MarkPart } from '../types';
import { isPendingAssessment } from './assessmentStatus';
import { creditsOfMarkRecord, type CourseCreditProfile } from './courseCredits';

export type GradeLetter = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export const GRADE_ORDER: GradeLetter[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

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

export const TARGET_SCORES: Record<GradeLetter, number> = {
  S: 90, A: 80, B: 70, C: 60, D: 50, E: 40, F: 0,
};

export const VIT_FAT_MINIMUM_RATIO = 0.4;

/**
 * The course total VIT's regulation calls a pass: 50 of 100, with the
 * 40%-of-FAT floor above applying on top (FFCS Academic Regulations §9.4).
 */
export const VIT_PASS_PERCENT = 50;

export function gradeFromVitPercent(percent: number | null): GradeLetter | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent * 100) / 100;
  for (const band of VIT_BANDS) if (rounded >= band.min) return band.grade;
  return 'F';
}

export function gradePointsOf(grade: GradeLetter | null | undefined): number {
  return grade ? GRADE_POINTS[grade] ?? 0 : 0;
}

export interface AssessmentRow {
  key: string;
  title: string;
  part: MarkPart;
  max: number;
  scored: number | null;
  weightage: number;
  weightageMark?: number;
  status?: string;
  isFat: boolean;
  /** The row was added by this app, not served by VTOP. */
  assumed?: boolean;
}

type RowSource = {
  scored?: number;
  max: number;
  weightage: number;
  status?: string;
  weightageMark?: number;
  part?: MarkPart;
  title?: string;
};

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

export function assessmentRowsOf(course: CourseMarks): AssessmentRow[] {
  const defaultPart: MarkPart = course.labCredits && !course.theoryCredits ? 'L' : 'T';
  const rows: AssessmentRow[] = [];
  // The marks record carries VTOP's raw component shape (maxMarks/weightageMax);
  // the grade arithmetic below expects the RowSource shape (max/weightage), so
  // every component is normalised once here, never mixed mid-sum.
  const toSource = (cm: ComponentMark | undefined | null): RowSource | null => {
    if (!cm) return null;
    return {
      title: cm.title,
      max: cm.maxMarks,
      scored: cm.scored,
      weightage: cm.weightageMax,
      status: cm.status,
      weightageMark: cm.weightageMark,
      part: cm.part,
    };
  };
  const push = (key: string, isFat: boolean, cm: ComponentMark | undefined | null, title?: string, fallback?: MarkPart) => {
    const row = toSource(cm);
    if (!row || !published(row)) return;
    rows.push(toRow(key, row.part ?? fallback ?? defaultPart, isFat, row, title));
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
  // A record with two FATs has a lab half by construction, even when the cache
  // predates VTOP's class column.
  push('labfat', true, course.labFat, 'Lab FAT', 'L');
  return rows;
}

export interface PartStats {
  part: MarkPart;
  credits: number;
  configuredWeight: number;
  gradedWeight: number;
  pendingWeight: number;
  earned: number;
  lostWeight: number;
  maxPossibleWeight: number;
  gradedCount: number;
  pendingCount: number;
  rows: AssessmentRow[];
  fat: AssessmentRow | null;
}

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

export interface InternalMarksSummary {
  /** Weighted marks earned on graded internal rows. */
  earned: number;
  /** Weight of those graded internal rows — the denominator for `earned`. */
  gradedWeight: number;
  /** Weight VTOP declared for every internal row, graded or not. */
  declaredWeight: number;
  /** Declared internal weight still ungraded. */
  pendingWeight: number;
  /** earned / gradedWeight on 0–100; null when nothing internal is graded. */
  gradedPercent: number | null;
  /** Raw scored / max over graded internal rows, for records with no weights. */
  rawScored: number;
  rawMax: number;
}

/**
 * A course's internal marks, FAT excluded — the same arithmetic as the web
 * app. Raw cell sums mixed a 15-mark CAT with a 5-mark DA and ignored every
 * extra row, so a lab read "not available" with a full experiment sheet on the
 * page. Weighted first; raw cells only when VTOP declared no weight at all.
 */
export function internalMarksOf(course: CourseMarks): InternalMarksSummary {
  let earned = 0;
  let gradedWeight = 0;
  let declaredWeight = 0;
  let pendingWeight = 0;
  let rawScored = 0;
  let rawMax = 0;

  for (const row of assessmentRowsOf(course)) {
    if (row.isFat) continue;
    declaredWeight += row.weightage;
    if (row.scored === null) {
      pendingWeight += row.weightage;
      continue;
    }
    if (row.scored < 0) continue;
    gradedWeight += row.weightage;
    earned += earnedOf(row);
    rawScored += row.scored;
    rawMax += row.max;
  }

  return {
    earned: round2(earned),
    gradedWeight: round2(gradedWeight),
    declaredWeight: round2(declaredWeight),
    pendingWeight: round2(pendingWeight),
    gradedPercent: gradedWeight > 0 ? round2((earned / gradedWeight) * 100) : null,
    rawScored: round2(rawScored),
    rawMax: round2(rawMax),
  };
}

/**
 * The admission year a VIT register number states: "25BEE0001" → 2025.
 *
 * The batch decides how an embedded theory+lab course's two halves are
 * combined, and the register number is the only place the data states it.
 */
export function admissionYearOf(regNo: string | null | undefined): number | null {
  const match = /^\s*(\d{2})/.exec(regNo ?? '');
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

/** From this admission year an embedded course is a fixed 75% theory / 25% lab. */
export const EMBEDDED_FIXED_SPLIT_YEAR = 2025;
export const EMBEDDED_THEORY_SHARE = 0.75;

export type BlendBasis = 'single' | 'regulation-2025' | 'credits' | 'equal';

export interface CourseBlend {
  /** Share of the course total carried by the theory half, 0–1. */
  theory: number;
  lab: number;
  basis: BlendBasis;
}

function blendOf(
  hasTheory: boolean,
  hasLab: boolean,
  theoryCredits: number,
  labCredits: number,
  admissionYear: number | null,
): CourseBlend {
  if (!hasTheory && !hasLab) return { theory: 0, lab: 0, basis: 'single' };
  if (!hasLab) return { theory: 1, lab: 0, basis: 'single' };
  if (!hasTheory) return { theory: 0, lab: 1, basis: 'single' };
  if (admissionYear !== null && admissionYear >= EMBEDDED_FIXED_SPLIT_YEAR) {
    return { theory: EMBEDDED_THEORY_SHARE, lab: 1 - EMBEDDED_THEORY_SHARE, basis: 'regulation-2025' };
  }
  if (theoryCredits <= 0 && labCredits <= 0) return { theory: 0.5, lab: 0.5, basis: 'equal' };
  const theoryShare = theoryCredits > 0 ? theoryCredits : 1;
  const labShare = labCredits > 0 ? labCredits : 1;
  const total = theoryShare + labShare;
  return { theory: theoryShare / total, lab: labShare / total, basis: 'credits' };
}

/** How this course's two halves are combined, or null for a one-class course. */
export function blendLabel(model: CourseGradeModel): string | null {
  if (!model.isEmbedded) return null;
  const theory = Math.round(model.blend.theory * 100);
  const lab = 100 - theory;
  if (model.blend.basis === 'regulation-2025') return `theory ${theory}% · lab ${lab}% (2025 regulation)`;
  if (model.blend.basis === 'credits') return `theory ${theory}% · lab ${lab}% by credits`;
  return `theory ${theory}% · lab ${lab}%, split evenly because credits are not synced`;
}

/** What the model needs to know about the student to pick a regulation. */
export interface CourseModelOptions {
  /** VTOP register number; its first two digits are the admission year. */
  regNo?: string | null;
  /** The admission year stated directly; takes precedence over `regNo`. */
  admissionYear?: number | null;
}

export interface CourseGradeModel {
  courseCode: string;
  courseTitle: string;
  credits: number | null;
  creditProfile: CourseCreditProfile | null;
  theoryCredits: number;
  labCredits: number;
  isEmbedded: boolean;
  parts: { theory: PartStats | null; lab: PartStats | null };
  blend: CourseBlend;
  /** Admission year the blend was decided on; null when no register number was given. */
  admissionYear: number | null;
  /** Internal marks, FAT excluded; `configuredWeight` covers the whole course. */
  internal: InternalMarksSummary;
  configuredWeight: number;
  gradedPercent: number | null;
  pendingWeight: number;
  pendingTitles: string[];
  maxPossiblePercent: number | null;
  weightsUndeclared: boolean;
  creditsUnknown: boolean;
}

export function buildCourseModel(course: CourseMarks, options: CourseModelOptions = {}): CourseGradeModel {
  const rows = assessmentRowsOf(course);
  const creditProfile = creditsOfMarkRecord(course);
  const theoryCredits = creditProfile?.theory ?? 0;
  const labCredits = creditProfile?.lab ?? 0;
  const admissionYear = options.admissionYear ?? admissionYearOf(options.regNo);

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
    blend: blendOf(hasTheory, hasLab, theoryCredits, labCredits, admissionYear),
    admissionYear,
    internal: internalMarksOf(course),
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
  fatPercent?: number;
  pendingPercent?: number;
}

export function projectCoursePercent(model: CourseGradeModel, opts: ProjectionOptions = {}): number | null {
  const parts = [model.parts.theory, model.parts.lab].filter(Boolean) as PartStats[];
  if (!parts.length) return null;

  const pace = opts.pendingPercent ?? model.gradedPercent ?? null;
  if (pace === null) return null;
  let weightSum = 0;
  let total = 0;
  for (const part of parts) {
    if (part.configuredWeight <= 0) continue;
    let earned = part.earned;
    for (const row of part.rows) {
      if (row.scored !== null) continue;
      const assumed = row.isFat ? (opts.fatPercent != null ? opts.fatPercent : pace) : pace;
      if (assumed == null) continue;
      earned += (Math.max(0, Math.min(100, assumed)) / 100) * row.weightage;
    }
    const percent = (earned / part.configuredWeight) * 100;
    const share = part.part === 'T' ? model.blend.theory : model.blend.lab;
    weightSum += share;
    total += percent * share;
  }
  if (weightSum <= 0) return null;
  return round2(total / weightSum);
}

export function projectGrade(
  model: CourseGradeModel,
  opts: ProjectionOptions = {},
): { percent: number | null; grade: GradeLetter | null } {
  const percent = projectCoursePercent(model, opts);
  return { percent, grade: gradeFromVitPercent(percent) };
}

export type FatFeasibility = 'secured' | 'easy' | 'moderate' | 'tough' | 'miracle' | 'impossible' | 'unknown';

export interface FatTarget {
  targetPercent: number;
  targetGrade: GradeLetter;
  part: MarkPart;
  fatDeclared: boolean;
  /** The FAT weight is this app's assumption, not a figure VTOP published. */
  fatAssumed: boolean;
  fatWeight: number;
  fatMax: number;
  currentPercent: number | null;
  requiredRaw: number | null;
  requiredPercent: number | null;
  /** VTOP's own raw score on this paper, null while it is ungraded. */
  fatScored: number | null;
  isUnknown: boolean;
  isAlreadyAchieved: boolean;
  isAchievable: boolean;
  meetsVITMinimumCutoff: boolean;
  vitFatMinimumRaw: number | null;
  feasibility: FatFeasibility;
  message: string;
}

export function solveTargetFAT(
  model: CourseGradeModel,
  targetPercent: number,
  opts: ProjectionOptions = {},
): FatTarget {
  const targetGrade = gradeFromVitPercent(targetPercent) ?? 'F';
  const parts = [model.parts.theory, model.parts.lab].filter(Boolean) as PartStats[];
  const fatPart = parts.find((p) => p.fat && p.part === 'T')
    ?? parts.find((p) => !!p.fat)
    ?? null;
  const pace = opts.pendingPercent ?? model.gradedPercent ?? null;

  const base: FatTarget = {
    targetPercent,
    targetGrade,
    part: fatPart?.part ?? 'T',
    fatDeclared: !!fatPart?.fat,
    fatAssumed: !!fatPart?.fat?.assumed,
    fatWeight: fatPart?.fat?.weightage ?? 0,
    fatMax: fatPart?.fat?.max ?? 0,
    currentPercent: projectCoursePercent(model, opts),
    requiredRaw: null,
    requiredPercent: null,
    fatScored: fatPart?.fat?.scored ?? null,
    isUnknown: true,
    isAlreadyAchieved: false,
    isAchievable: false,
    meetsVITMinimumCutoff: false,
    vitFatMinimumRaw: null,
    feasibility: 'unknown',
    message: '',
  };

  if (!fatPart || !fatPart.fat || fatPart.fat.weightage <= 0) {
    return { ...base, message: 'VTOP has not declared the final exam weight for this course, so no FAT score can be answered yet.' };
  }
  if (pace === null) {
    return { ...base, message: 'Nothing is graded in this course yet, so there is no pace to solve a FAT target from. Re-check after the first internal is evaluated.' };
  }
  const fat = fatPart.fat;
  if (fat.scored !== null) {
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

  const shareOf = (p: PartStats) => (p.part === 'T' ? model.blend.theory : model.blend.lab);
  const active = parts.filter((p) => p.configuredWeight > 0);
  const weightSum = active.reduce((s, p) => s + shareOf(p), 0);

  const courseAt = (fatPct: number): number => {
    let total = 0;
    for (const part of active) {
      let earned = part.earned;
      for (const row of part.rows) {
        if (row.scored !== null) continue;
        const assumed = row === fat ? fatPct : (row.isFat ? (opts.fatPercent ?? pace) : pace);
        if (assumed == null) continue;
        earned += (clampPercent(assumed) / 100) * row.weightage;
      }
      total += ((earned / part.configuredWeight) * 100) * shareOf(part);
    }
    return weightSum > 0 ? total / weightSum : 0;
  };

  const floor = courseAt(0);
  const ceiling = courseAt(100);
  const perPoint = (ceiling - floor) / 100;

  const neededPercent = perPoint > 0 ? (targetPercent - floor) / perPoint : (targetPercent <= floor ? 0 : Infinity);
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

function clampPercent(pct: number): number {
  return Math.max(0, Math.min(100, pct));
}

// ---------------------------------------------------------------------------
// The FAT VTOP has not published
// ---------------------------------------------------------------------------

/** VIT's published final-exam weight when VTOP declared no FAT row. */
export const DEFAULT_FAT_WEIGHT = 40;

export function impliedFatWeight(configuredInternalWeight: number): { weight: number; derived: boolean } {
  const remaining = 100 - configuredInternalWeight;
  if (remaining >= 20 && remaining <= DEFAULT_FAT_WEIGHT) {
    return { weight: Math.round(remaining), derived: true };
  }
  return { weight: DEFAULT_FAT_WEIGHT, derived: false };
}

/** True when some half of this course already carries a FAT row from VTOP. */
export function hasDeclaredFat(model: CourseGradeModel): boolean {
  return [model.parts.theory, model.parts.lab].some(
    (part) => !!part && part.rows.some((row) => row.isFat),
  );
}

/** The class a FAT this app has to model would belong to. */
export function fatHostPart(model: CourseGradeModel): PartStats | null {
  if (model.parts.theory && model.parts.theory.configuredWeight > 0) return model.parts.theory;
  if (model.parts.lab && model.parts.lab.configuredWeight > 0) return model.parts.lab;
  return null;
}

/** The model with a labelled FAT row added for projection. */
export function withAssumedFat(model: CourseGradeModel, fatWeight: number): CourseGradeModel {
  if (!(fatWeight > 0) || hasDeclaredFat(model)) return model;
  const part: MarkPart = model.parts.theory && model.parts.theory.configuredWeight > 0
    ? 'T'
    : model.parts.lab && model.parts.lab.configuredWeight > 0 ? 'L' : 'T';
  const target = part === 'T' ? model.parts.theory : model.parts.lab;
  if (!target || target.configuredWeight <= 0) return model;

  const assumedFatRow: AssessmentRow = {
    key: 'fat',
    title: 'FAT',
    part,
    max: 100,
    scored: null,
    weightage: Math.round(fatWeight),
    isFat: true,
    assumed: true,
  };
  const augmented = computePartStats(
    [...target.rows, assumedFatRow],
    part,
    target.credits > 0 ? target.credits : 1,
  );
  const parts = {
    theory: part === 'T' ? augmented : model.parts.theory,
    lab: part === 'L' ? augmented : model.parts.lab,
  };
  const configuredWeight = round2((parts.theory?.configuredWeight ?? 0) + (parts.lab?.configuredWeight ?? 0));
  const gradedWeight = (parts.theory?.gradedWeight ?? 0) + (parts.lab?.gradedWeight ?? 0);
  const earned = (parts.theory?.earned ?? 0) + (parts.lab?.earned ?? 0);
  const pendingWeight = round2((parts.theory?.pendingWeight ?? 0) + (parts.lab?.pendingWeight ?? 0));
  const maxPossible = (parts.theory?.maxPossibleWeight ?? 0) + (parts.lab?.maxPossibleWeight ?? 0);

  return {
    ...model,
    parts,
    configuredWeight,
    gradedPercent: gradedWeight > 0 ? round2((earned / gradedWeight) * 100) : null,
    pendingWeight,
    pendingTitles: [...model.pendingTitles, 'FAT'],
    maxPossiblePercent: configuredWeight > 0 ? round2((maxPossible / configuredWeight) * 100) : null,
    weightsUndeclared: configuredWeight <= 0,
  };
}

// ---------------------------------------------------------------------------
// VTOP's own marks, and the pass line
// ---------------------------------------------------------------------------

/** One class's mark, built from the Weightage Mark VTOP printed for its rows. */
export interface HalfMark {
  earned: number;
  declared: number;
  graded: number;
  pending: number;
  percent: number | null;
  complete: boolean;
}

export interface PublishedMarks {
  /** VTOP's course total from the grade view; null until a grade is published. */
  courseTotal: number | null;
  theory: HalfMark | null;
  lab: HalfMark | null;
}

function halfMarkOf(part: PartStats | null): HalfMark | null {
  if (!part) return null;
  return {
    earned: part.earned,
    declared: part.configuredWeight,
    graded: part.gradedWeight,
    pending: part.pendingWeight,
    percent: part.configuredWeight > 0 ? round2((part.earned / part.configuredWeight) * 100) : null,
    complete: part.configuredWeight > 0 && part.pendingWeight <= 0,
  };
}

/**
 * The three course figures VTOP itself holds: its total from the grade view,
 * and each class's own mark from the rows under it.
 */
export function publishedMarksOf(model: CourseGradeModel, courseTotal: number | null = null): PublishedMarks {
  return {
    courseTotal: typeof courseTotal === 'number' && Number.isFinite(courseTotal) ? courseTotal : null,
    theory: halfMarkOf(model.parts.theory),
    lab: halfMarkOf(model.parts.lab),
  };
}

export type PassState = 'passed' | 'failed' | 'secured' | 'needs' | 'impossible' | 'unknown';

export interface PassLine {
  state: PassState;
  /** FAT marks to score: the larger of the 50%-course solve and the 40% floor. */
  requiredRaw: number | null;
  fatMax: number | null;
  /** VIT's 40%-of-the-FAT floor — the smallest paper score that can pass. */
  floorRaw: number | null;
  /** The course total on the marks that exist, ungraded internals at zero. */
  coursePercent: number | null;
  publishedGrade: string | null;
  publishedTotal: number | null;
  /** The FAT weight here is this app's assumption because VTOP published none. */
  assumedFat: boolean;
  message: string;
}

export interface PassLineOptions extends ProjectionOptions {
  publishedGrade?: string | null;
  publishedTotal?: number | null;
}

/**
 * The pass line on VTOP's numbers: what the FAT must give for the course to
 * clear VIT's 50% total and 40%-of-FAT rule. A grade VTOP has already
 * published is the fact; otherwise ungraded internals are held at zero.
 */
export function passLineOf(model: CourseGradeModel, opts: PassLineOptions = {}): PassLine {
  const publishedGrade = (opts.publishedGrade ?? '').trim().toUpperCase() || null;
  const publishedTotal = typeof opts.publishedTotal === 'number' && Number.isFinite(opts.publishedTotal)
    ? opts.publishedTotal
    : null;
  const base: PassLine = {
    state: 'unknown',
    requiredRaw: null,
    fatMax: null,
    floorRaw: null,
    coursePercent: publishedTotal,
    publishedGrade,
    publishedTotal,
    assumedFat: false,
    message: '',
  };

  if (publishedGrade) {
    const passed = /^[SABCDE]$/.test(publishedGrade);
    const failed = publishedGrade === 'F';
    return {
      ...base,
      state: passed ? 'passed' : failed ? 'failed' : 'unknown',
      message: publishedTotal !== null
        ? `VTOP published ${publishedTotal} / 100 · ${publishedGrade}.`
        : passed || failed
          ? `VTOP published grade ${publishedGrade}.`
          : `VTOP published ${publishedGrade}, which records no pass either way.`,
    };
  }

  const host = fatHostPart(model);
  const solveModel = hasDeclaredFat(model)
    ? model
    : host
      ? withAssumedFat(model, impliedFatWeight(host.configuredWeight).weight)
      : model;
  // Zero, not a pace: the marker answers "what if the rest is blank?".
  const target = solveTargetFAT(solveModel, VIT_PASS_PERCENT, { ...opts, pendingPercent: 0 });
  const fatMax = target.fatMax > 0 ? target.fatMax : null;
  const floorRaw = target.vitFatMinimumRaw !== null && target.vitFatMinimumRaw > 0 ? target.vitFatMinimumRaw : null;
  const shaped: PassLine = {
    ...base,
    fatMax,
    floorRaw,
    coursePercent: target.currentPercent,
    assumedFat: target.fatAssumed,
  };

  if (target.fatScored !== null && fatMax !== null) {
    const paper = (target.fatScored / fatMax) * 100;
    const overall = target.currentPercent;
    const passed =
      overall !== null &&
      overall >= VIT_PASS_PERCENT &&
      paper >= VIT_FAT_MINIMUM_RATIO * 100;
    return {
      ...shaped,
      state: passed ? 'passed' : 'failed',
      message: overall !== null
        ? `The FAT is graded: ${overall.toFixed(1)} / 100 overall, ${target.fatScored} / ${fatMax} in the paper.`
        : `The FAT is graded at ${target.fatScored} / ${fatMax}.`,
    };
  }

  if (target.isUnknown) {
    return { ...shaped, message: target.message };
  }

  const overallNeeded = target.requiredRaw;
  if (!target.isAchievable) {
    return {
      ...shaped,
      state: 'impossible',
      requiredRaw: overallNeeded,
      message: overallNeeded !== null
        ? `Even a full paper leaves the course short: ${overallNeeded} / ${fatMax} would be needed for 50.`
        : 'Even a full paper leaves the course short of 50.',
    };
  }
  if (overallNeeded === null || fatMax === null || floorRaw === null) {
    return { ...shaped, message: target.message };
  }

  const floorBinds = floorRaw >= overallNeeded;
  const requiredRaw = floorBinds ? floorRaw : overallNeeded;
  if (overallNeeded <= 0) {
    return {
      ...shaped,
      state: 'secured',
      requiredRaw: floorRaw,
      message: `The internals already clear 50; the 40% paper rule still needs ${floorRaw} / ${fatMax} in the FAT.`,
    };
  }
  return {
    ...shaped,
    state: 'needs',
    requiredRaw,
    message: floorBinds
      ? `Pass needs the 40% FAT floor: ${floorRaw} / ${fatMax}.`
      : `Pass needs ${Math.ceil(requiredRaw)} / ${fatMax} in the FAT.`,
  };
}
