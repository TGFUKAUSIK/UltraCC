/**
 * gradeModel.ts — the course-grade arithmetic, on VTOP's own numbers.
 *
 * This is the model the grade predictor, the target-grade simulator and the
 * CGPA planner share. Its shape follows the two published VIT Chennai
 * implementations of the same problem (AmazeCC's `marksPredictor` and UniCC's
 * marks route), with the parts that would have made a claim VTOP never
 * published removed:
 *
 *   1. WEIGHTS ARE VTOP'S. Every contribution is a row's declared
 *      `weightagePercent` — VTOP's Weightage % column — never a regulation
 *      50/40/10 split imposed from outside. Where VTOP also published its own
 *      Weightage Mark, that number wins over ours.
 *   2. A ROW VTOP HAS NOT GRADED IS NOT A ZERO. Pending weight is held out of
 *      the student's current percentage and projected separately, so an
 *      unheld CAT 2 cannot drag a projection down as a failed exam.
 *   3. THEORY AND LAB ARE DIFFERENT CLASSES. An embedded course is assessed
 *      twice, and its two halves are combined by the rule the student's batch
 *      is under: 75% theory / 25% lab from the 2025 admission year onward, and
 *      the registered credit ratio (3 + 1) before it — never one blended pile
 *      of rows. `admissionYearOf` reads the batch from the VTOP register
 *      number because nothing else in the data states it.
 *   4. CREDITS ARE VTOP'S REGISTERED CREDITS or nothing. `credits` is null
 *      when the cache predates credit capture, and every caller has to handle
 *      that instead of assuming 3.
 *
 * VIT's absolute grade bands (S ≥ 90 … F < 40, 10/9/8/7/6/5/0 grade points)
 * and the 40%-of-FAT minimum are used for the target calculation. Choosing which
 * rule turns a projected score into a letter — the class curve once the cohort
 * is large enough, these bands otherwise — and turning letters into an SGPA or
 * CGPA belongs to `gradeProjection`, the one engine every grade surface reads.
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

/**
 * A grade point average exactly as the app writes it: two decimals, truncated.
 *
 * One CGPA used to be printed two ways — VTOP's own `8.925` on the dashboard and
 * in the Grades hero, `8.93` in My Info, the AI advisor, the placements card and
 * the CGPA simulator. A student reading the dashboard and then My Info saw two
 * numbers for one fact, and the roughest of them was the one they quoted to a
 * placement counsellor.
 *
 * It truncates rather than rounds, for the same reason the attendance label
 * does: a 7.996 CGPA is not an 8.0, and the bars a GPA is read against
 * (placement cut-offs, the 8.0 many students are aiming for) should be decided by
 * the digits the student actually has.
 */
export function gpaLabel(value: number): string {
  const floored = Math.floor(value * 100 + 1e-6) / 100;
  return floored.toFixed(2);
}

/**
 * A GPA the student has to *reach*, rounded the other way — up.
 *
 * "You need 7.13 SGPA this semester" is an instruction, not a measurement, so
 * trimming it down to 7.12 would tell a student to do slightly less than the
 * target actually requires and then watch them miss it. Anything they have
 * already earned truncates (it must not climb onto a bar); anything they still
 * owe rounds up.
 */
export function requiredGpaLabel(value: number): string {
  const ceiled = Math.ceil(value * 100 - 1e-6) / 100;
  return ceiled.toFixed(2);
}

/**
 * `gpaLabel` for a figure VTOP is supposed to have posted.
 *
 * The parser stores 0 when VTOP's profile page has no CGPA on it, and every
 * surface used to decide on its own whether 0 means "zero" or "not yet": the
 * dashboard printed "0", My Info said "Not available from VTOP", Grades printed
 * a bare "0" under a heading promising a cumulative average. One rule here, with
 * each screen's own wording for the empty case.
 */
export function publishedGpaLabel(
  value: number | null | undefined,
  fallback = 'Not available',
): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? gpaLabel(value) : fallback;
}

/** VIT requires at least this share of the FAT paper to pass the course. */
export const VIT_FAT_MINIMUM_RATIO = 0.4;

/**
 * The course total VIT's regulation calls a pass: 50 of 100, with the 40%-of-FAT
 * floor above applying on top (FFCS Academic Regulations §9.4).
 */
export const VIT_PASS_PERCENT = 50;

export function gradeFromVitPercent(percent: number | null): GradeLetter | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent * 100) / 100;
  for (const band of VIT_BANDS) if (rounded >= band.min) return band.grade;
  return 'F';
}

/**
 * A course's projected percentage, written the one way this app writes it.
 *
 * `projectCoursePercent` answers a percentage of the weightage VTOP has
 * published, and it answers `null` when there is no weightage to project from.
 * Two screens used to print that figure, and both had to invent a way out: the
 * simulator kept its own formatter and the predictor collapsed `null` into `0`,
 * so the same course showed "—" on one card and "0.0 / 100 · F" two cards above.
 * A projection the model could not make is not a zero, so both screens now say
 * the same thing when it happens.
 */
export function projectedPercentLabel(percent: number | null): string {
  return percent === null || !Number.isFinite(percent) ? '—' : percent.toFixed(1);
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
  /** True for a FAT row this app modelled because VTOP published none. */
  assumed?: boolean;
}

type RowSource = {
  /** VTOP serves ungraded rows with a 0 here; `status` is what grades them. */
  scored?: number | null;
  max?: number | null;
  weightage?: number | null;
  status?: string | null;
  weightageMark?: number | null;
  part?: MarkPart;
  title?: string;
};

/**
 * The minimum of a VTOP marks record the row builder needs.
 *
 * `CourseMarks` satisfies it; so does a partial record from a test or an older
 * cache. Keeping the shape loose is what lets the internal-marks summary walk
 * the same rows and the same rules as the grade model instead of reimplementing
 * "pending", "weighted" and "graded" beside it.
 */
export interface MarksLikeRow {
  scored?: number | null;
  max?: number | null;
  weightage?: number | null;
  weightageMark?: number | null;
  status?: string | null;
  title?: string;
  part?: MarkPart;
}

export interface MarksLikeCourse {
  cat1?: MarksLikeRow | null;
  cat2?: MarksLikeRow | null;
  da1?: MarksLikeRow | null;
  da2?: MarksLikeRow | null;
  da3?: MarksLikeRow | null;
  quiz?: MarksLikeRow | null;
  fat?: MarksLikeRow | null;
  labFat?: MarksLikeRow | null;
  extraComponents?: MarksLikeRow[] | null;
  theoryCredits?: number | null;
  labCredits?: number | null;
}

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
    weightageMark: row.weightageMark ?? undefined,
    status: row.status ?? undefined,
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
export function assessmentRowsOf(course: MarksLikeCourse): AssessmentRow[] {
  const defaultPart: MarkPart = course.labCredits && !course.theoryCredits ? 'L' : 'T';
  const rows: AssessmentRow[] = [];
  const push = (key: string, isFat: boolean, row: RowSource | undefined | null, title?: string, fallback?: MarkPart) => {
    if (!published(row)) return;
    const r = row as RowSource;
    rows.push(toRow(key, r.part ?? fallback ?? defaultPart, isFat, r, title));
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
  // A record that carries two FATs only does so because VTOP served a lab
  // half; caches synced before the class was captured still know that much.
  push('labfat', true, course.labFat, 'Lab FAT', 'L');
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
  /**
   * The internal half of the class, FAT excluded. A lab's experiments and a
   * theory class's CAT/DA/Quiz/PAT rows live here; the final exam does not.
   * These four fields are what the "Internal" figure on every screen reads.
   */
  internalWeight: number;
  internalGradedWeight: number;
  internalPendingWeight: number;
  internalEarned: number;
  rows: AssessmentRow[];
  /** The FAT row of this class, when VTOP declared one. */
  fat: AssessmentRow | null;
}

/** The few fields a weighted mark needs, from any marks source that has them. */
export interface WeightedRowSource {
  scored: number | null;
  max: number;
  weightage: number;
  weightageMark?: number;
}

/**
 * The weighted marks one row earns, in the one way this app earns them.
 *
 * VTOP's published Weightage Mark decides when it served one; otherwise the row
 * earns its own share of its declared weightage. Callers that walk their own
 * component list — the course-intelligence cards, the curriculum schemes — go
 * through here instead of re-multiplying `scored / max * weightage`, because a
 * row VTOP graded at 12/20 with a Weightage Mark of 8.8 used to read as 9.0
 * beside VTOP's own 8.8 on the very same screen.
 */
export function weightedMarksFor(row: WeightedRowSource): number {
  if (row.scored === null) return 0;
  if (typeof row.weightageMark === 'number' && Number.isFinite(row.weightageMark)) {
    return Math.max(0, Math.min(row.weightage, row.weightageMark));
  }
  if (row.max <= 0) return 0;
  return (row.scored / row.max) * row.weightage;
}

/** Weighted marks a graded row earns: VTOP's own number when it published one. */
export function earnedOf(row: AssessmentRow): number {
  return weightedMarksFor(row);
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
    internalWeight: 0,
    internalGradedWeight: 0,
    internalPendingWeight: 0,
    internalEarned: 0,
    rows: [],
    fat: null,
  };
  for (const row of rows) {
    if (row.part !== part) continue;
    stat.rows.push(row);
    stat.configuredWeight += row.weightage;
    if (row.isFat && !stat.fat) stat.fat = row;
    if (!row.isFat) stat.internalWeight += row.weightage;
    if (row.scored === null) {
      stat.pendingWeight += row.weightage;
      stat.pendingCount += 1;
      if (!row.isFat) stat.internalPendingWeight += row.weightage;
      continue;
    }
    const earned = earnedOf(row);
    stat.gradedWeight += row.weightage;
    stat.gradedCount += 1;
    stat.earned += earned;
    stat.lostWeight += Math.max(0, row.weightage - earned);
    if (!row.isFat) {
      stat.internalGradedWeight += row.weightage;
      stat.internalEarned += earned;
    }
  }
  stat.earned = round2(stat.earned);
  stat.lostWeight = round2(stat.lostWeight);
  stat.maxPossibleWeight = round2(Math.max(0, stat.configuredWeight - stat.lostWeight));
  stat.internalWeight = round2(stat.internalWeight);
  stat.internalGradedWeight = round2(stat.internalGradedWeight);
  stat.internalPendingWeight = round2(stat.internalPendingWeight);
  stat.internalEarned = round2(stat.internalEarned);
  return stat;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Internal marks (the FAT excluded)
// ---------------------------------------------------------------------------

/**
 * What a course's internal marks actually are, on VTOP's own numbers.
 *
 * The screens used to add up the raw Scored and Max cells of six fixed slots:
 * a CAT scored 42.5/50 and a DA scored 9/10 were summed as 51.5/60, even though
 * the CAT carries 15 course marks and the DA carries 5. The same sum also
 * ignored every row VTOP did not name CAT/DA/Quiz — a lab's experiments, a
 * PAT, an "Assessment - N" — so a lab-only course read "Internal marks not
 * available" with a full experiment sheet on the page.
 *
 * This is the weighted answer instead: every internal row contributes its
 * Weightage Mark (or scored/max × its declared weight when VTOP published no
 * Weightage Mark), so the figure is in the same weight space as the grade the
 * course will be awarded. `gradedWeight` is the weight those marks were earned
 * against — the denominator the student can actually be measured on — while
 * `declaredWeight` includes internals VTOP has declared but not graded.
 *
 * `rawScored`/`rawMax` are kept only for records that carry no declared weight
 * at all (older caches): there, "42.5/50" is the only true statement available.
 */
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

export function internalMarksOf(course: MarksLikeCourse): InternalMarksSummary {
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
    // A negative figure is not a mark; it must not drag the internal total.
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

// ---------------------------------------------------------------------------
// How an embedded course's two halves combine
// ---------------------------------------------------------------------------

/**
 * The admission year a VIT register number states: "25BEE0001" → 2025.
 *
 * The batch decides how an embedded theory+lab course's two halves are
 * combined, and this is the only place the data states it: every VTOP register
 * number begins with the year of admission. A number that does not start with
 * two digits answers null, so the model says it does not know the batch rather
 * than reading an unstated regulation into the student's marks.
 */
export function admissionYearOf(regNo: string | null | undefined): number | null {
  const match = /^\s*(\d{2})/.exec(regNo ?? '');
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

/**
 * From this admission year, an embedded course is combined as a fixed 75%
 * theory / 25% lab, whatever the registered credits say.
 *
 * Before it, the halves were combined by their registered credits — the 3 + 1
 * course the older regulation describes is 75/25 by arithmetic, but a 4 + 1 or
 * 2 + 1 course is not, and the credits were the rule either way.
 */
export const EMBEDDED_FIXED_SPLIT_YEAR = 2025;

/** The theory half's share of an embedded course from `EMBEDDED_FIXED_SPLIT_YEAR`. */
export const EMBEDDED_THEORY_SHARE = 0.75;

export type BlendBasis = 'single' | 'regulation-2025' | 'credits' | 'equal';

export interface CourseBlend {
  /** Share of the course total carried by the theory half, 0–1. */
  theory: number;
  lab: number;
  /**
   * Which rule produced the split: a one-class course (`single`), the 2025
   * regulation (`regulation-2025`), the registered credit ratio (`credits`), or
   * an even split because the credits are not synced at all (`equal`).
   */
  basis: BlendBasis;
}

/**
 * The shares the two halves carry in the course total.
 *
 * A credit ratio falls back to one credit for a half VTOP has not given a
 * credit figure, which is what the model always did: it keeps a half that
 * exists from vanishing out of the total. Both halves unknown is an even split,
 * and the basis says so rather than implying a rule nobody stated.
 */
export function blendOf(
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
    return {
      theory: EMBEDDED_THEORY_SHARE,
      lab: 1 - EMBEDDED_THEORY_SHARE,
      basis: 'regulation-2025',
    };
  }
  if (theoryCredits <= 0 && labCredits <= 0) {
    return { theory: 0.5, lab: 0.5, basis: 'equal' };
  }
  const theoryShare = theoryCredits > 0 ? theoryCredits : 1;
  const labShare = labCredits > 0 ? labCredits : 1;
  const total = theoryShare + labShare;
  return { theory: theoryShare / total, lab: labShare / total, basis: 'credits' };
}

/** How this course's two halves are combined, or null for a one-class course. */
export function blendLabel(model: CourseGradeModel): string | null {
  if (!model.isEmbedded) return null;
  return blendLabelOf(model.blend);
}

/** The same wording for a blend computed outside a full model. */
export function blendLabelOf(blend: CourseBlend): string {
  const theory = Math.round(blend.theory * 100);
  const lab = 100 - theory;
  if (blend.basis === 'regulation-2025') return `theory ${theory}% · lab ${lab}% (2025 regulation)`;
  if (blend.basis === 'credits') return `theory ${theory}% · lab ${lab}% by credits`;
  return `theory ${theory}% · lab ${lab}%, split evenly because credits are not synced`;
}

// ---------------------------------------------------------------------------
// Course model
// ---------------------------------------------------------------------------

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
  /** VTOP's registered credits for the whole course; null when unsynced. */
  credits: number | null;
  creditProfile: CourseCreditProfile | null;
  theoryCredits: number;
  labCredits: number;
  /** Both halves published assessment rows, so each needs its own share. */
  isEmbedded: boolean;
  parts: { theory: PartStats | null; lab: PartStats | null };
  /** The shares the halves carry in the course total (see `blendOf`). */
  blend: CourseBlend;
  /** Admission year the blend was decided on; null when no register number was given. */
  admissionYear: number | null;
  /**
   * The course's internal marks, FAT excluded — one summary every screen
   * prints. `configuredWeight` below is the whole course (internals + FAT, and
   * both halves of an embedded course), so it is not the denominator for an
   * internal figure.
   */
  internal: InternalMarksSummary;
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

// ---------------------------------------------------------------------------
// The FAT VTOP has not published
// ---------------------------------------------------------------------------

/**
 * VIT's published final-exam weight: the FAT paper is marked out of 100 and
 * carries 40% of a theory course (the internals the other 60). Used when a
 * course's own FAT weight cannot be read from VTOP and cannot be derived from
 * what VTOP did publish (see `impliedFatWeight`).
 */
export const DEFAULT_FAT_WEIGHT = 40;

/**
 * The FAT weight to model when VTOP has declared internals but no FAT row.
 *
 * VIT's regulations put the final exam at 40% of a theory course and the
 * internals at 60. So the FAT is VIT's published 40 unless VTOP's own declared
 * internals already account for 60% or more of the course, where the FAT is
 * simply what is left of 100 — 60% internals leaves 40%, a heavier continuous
 * scheme like 70% internals leaves 30%. Deriving from the remainder is only
 * trusted when it lands on a lower FAT than the standard, because a scheme whose
 * internals still add up to less than 60 (a semester with one CAT published, or
 * a cache that never captured every internal's weight) would otherwise read as a
 * nonsensical 50%-or-more FAT. There the model states VIT's 40 and reports
 * `derived: false`, so the screen says the weight is an assumption rather than
 * dressing the number up as arithmetic on VTOP's data.
 */
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

/**
 * The class a FAT this app has to model would belong to: the theory half when
 * VTOP weighted it, otherwise the lab.
 *
 * An ended lab and a theory class are two classes, each with its own FAT. The
 * course-level `configuredWeight` adds both halves together (50 + 60 for an
 * embedded course), so it is the wrong number to feed `impliedFatWeight` or to
 * quote as "the internals VTOP declared" — that is how the predictor came to
 * print "200 weightage published" and "what is left of 100 after the 200%".
 */
export function fatHostPart(model: CourseGradeModel): PartStats | null {
  if (model.parts.theory && model.parts.theory.configuredWeight > 0) return model.parts.theory;
  if (model.parts.lab && model.parts.lab.configuredWeight > 0) return model.parts.lab;
  return null;
}

/**
 * How VTOP's published weightage should be quoted on screen.
 *
 * A single class states its total ("90%"); an embedded course has two class
 * schemes, so it states both rather than their sum, which names a course that
 * does not exist.
 */
export function publishedWeightLabel(model: CourseGradeModel): string {
  const theory = Math.round(model.parts.theory?.configuredWeight ?? 0);
  const lab = Math.round(model.parts.lab?.configuredWeight ?? 0);
  if (model.isEmbedded) return `${theory}% theory + ${lab}% lab`;
  return `${Math.max(theory, lab)}%`;
}

/**
 * The model with a FAT row added for projection, when VTOP has not published one.
 *
 * Returns the model unchanged when VTOP already declared a FAT (that row is the
 * truth and always wins), when no weight was assumed, or when the course has no
 * published internals to hang a FAT off. The added row is marked `assumed`, so
 * every screen that reads it can say the FAT weight is an assumption rather than
 * VTOP's own figure.
 */
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
    // Name the assumed FAT alongside the rows VTOP itself left ungraded, so a
    // screen listing what is still open does not quietly omit the paper it is
    // projecting.
    pendingTitles: [...model.pendingTitles, 'FAT'],
    maxPossiblePercent: configuredWeight > 0 ? round2((maxPossible / configuredWeight) * 100) : null,
    weightsUndeclared: configuredWeight <= 0,
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
  /**
   * A what-if, row by row: `AssessmentRow.key` → the percentage of that row's
   * own paper to score. An override decides the row whatever VTOP has posted for
   * it, which is what the marks simulator drives. Rows left out keep their
   * graded marks and the pace rule above, so a student moving one slider does
   * not silently re-score the others.
   */
  rowPercents?: Record<string, number>;
}

/**
 * The weighted marks one row contributes to a projection.
 *
 * Three voices, in the order that gets to decide: the student's own what-if,
 * VTOP's graded mark (its published Weightage Mark when it served one), then the
 * pace every declared-but-ungraded row is held at. Null means the model has
 * nothing to say about this row, and a caller must then refuse to publish a
 * total rather than let the gap count as a zero.
 */
function projectedRowEarned(
  row: AssessmentRow,
  opts: ProjectionOptions,
  pace: number | null,
): number | null {
  const override = opts.rowPercents?.[row.key];
  if (typeof override === 'number' && Number.isFinite(override)) {
    return (clampPercent(override) / 100) * row.weightage;
  }
  if (row.scored !== null) return earnedOf(row);
  const assumed = row.isFat ? (opts.fatPercent ?? pace) : pace;
  if (assumed === null) return null;
  return (clampPercent(assumed) / 100) * row.weightage;
}

/**
 * Projected course percentage (0–100 of the weight VTOP has declared).
 *
 * An embedded course's halves carry the shares in `model.blend` — the 2025
 * regulation's 75/25 or the older credit ratio — rather than whatever credit
 * the timetable happened to leave in the cache. Null when nothing is graded and
 * nothing is assumed: the model will not publish a percentage built out of
 * zeros.
 */
export function projectCoursePercent(
  model: CourseGradeModel,
  opts: ProjectionOptions = {},
): number | null {
  const parts = [model.parts.theory, model.parts.lab].filter(Boolean) as PartStats[];
  if (!parts.length) return null;

  const pace = opts.pendingPercent ?? model.gradedPercent ?? null;
  let weightSum = 0;
  let total = 0;
  for (const part of parts) {
    if (part.configuredWeight <= 0) continue;
    let earned = 0;
    for (const row of part.rows) {
      const value = projectedRowEarned(row, opts, pace);
      // Nothing is graded, so there is no pace to hold this row at, and no
      // what-if covers it either. A total built out of the rows nobody scored
      // is a zero wearing a number, so the model declines instead of publishing
      // one — the student's own sliders, however, are a mark they did make.
      if (value === null) return null;
      earned += value;
    }
    // VTOP sometimes declares only part of a course's scheme (a lab FAT that
    // has not been set up yet). Scale what it declared rather than treating
    // the missing weight as unearnable.
    const percent = (earned / part.configuredWeight) * 100;
    const share = part.part === 'T' ? model.blend.theory : model.blend.lab;
    weightSum += share;
    total += percent * share;
  }
  if (weightSum <= 0) return null;
  // A half VTOP weighted nothing drops out above, so the remaining half takes
  // the whole total. Dividing by the shares that are actually in play is what
  // makes that a rescale rather than a silent 25% of a course missing.
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
  /** The FAT weight is this app's assumption, not a figure VTOP published. */
  fatAssumed: boolean;
  fatWeight: number;
  fatMax: number;
  /** Course percentage already locked in, with ungraded internals projected. */
  currentPercent: number | null;
  /** Raw marks needed on the FAT paper (0–fatMax); null when not solvable. */
  requiredRaw: number | null;
  requiredPercent: number | null;
  /** VTOP's own raw score on this paper, null while it is ungraded. */
  fatScored: number | null;
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
 * Solves the real equation for an embedded course: the target is the share-
 * weighted mean of both halves (`model.blend` — 75/25 from the 2025 admission
 * year, the credit ratio before it), so the theory paper only carries the
 * theory half's share of it. The lab half is held at its projected pace,
 * exactly as the student's own marks do.
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

  const shareOf = (p: PartStats) => (p.part === 'T' ? model.blend.theory : model.blend.lab);
  // A class VTOP has weighted nothing cannot move the course average, so it is
  // left out of the blend instead of being counted as a free share.
  const active = parts.filter((p) => p.configuredWeight > 0);
  const weightSum = active.reduce((s, p) => s + shareOf(p), 0);

  /**
   * Course percentage when the solved-for paper is scored at `fatPct` percent
   * of itself, with every other row at the mark it already has, the student's
   * what-if for it, or its projected pace.
   *
   * Linear in `fatPct`, which is what makes the solve exact rather than
   * searched: the theory paper only moves the course by its own share of the
   * course total, times its own weight share within its class.
   */
  const courseAt = (fatPct: number): number => {
    let total = 0;
    for (const part of active) {
      let earned = 0;
      for (const row of part.rows) {
        // The paper being solved for is the variable; a what-if on it would
        // answer the question the student did not ask.
        const value = row === fat
          ? (clampPercent(fatPct) / 100) * row.weightage
          : projectedRowEarned(row, opts, pace);
        if (value === null) continue;
        earned += value;
      }
      total += ((earned / part.configuredWeight) * 100) * shareOf(part);
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

  // When the FAT weight is this app's assumption rather than VTOP's figure, the
  // answer says so in the same breath as the number — a target solved on an
  // assumed weight must never read as if VTOP had promised that weight.
  const assumedNote = fat.assumed
    ? `Assuming the FAT is worth ${fat.weightage}% of this course (VTOP has not published its weight yet): `
    : '';
  const message = neededPercent <= 0
    ? `${assumedNote}already on track: ${targetGrade} needs no marks from the FAT on current projections.`
    : !achievable
      ? `${assumedNote}out of reach: even a perfect paper leaves this course at ${ceiling.toFixed(1)}%.`
      : `${assumedNote}you need ${rawScore} / ${fat.max} in the ${fatPart.part === 'L' ? 'lab ' : ''}FAT for ${targetGrade}.`;

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

// ---------------------------------------------------------------------------
// VTOP's own marks, and the pass line
// ---------------------------------------------------------------------------

/**
 * One class's mark, built from the Weightage Mark VTOP printed for its rows.
 *
 * `earned` is the sum of VTOP's own column — not a blend, not a re-weight —
 * and `declared` is the weight those rows carry. A half stays incomplete while
 * any of its weight is ungraded, so a screen can say "38.2 of 60 graded"
 * instead of presenting a partial sheet as the class's mark.
 */
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
 *
 * The grade view — not the marks page — is where VTOP prints a course total, so
 * it is passed in and stays null when absent. Nothing here substitutes this
 * app's blend for a total VTOP has not published.
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
  /** VTOP published the grade, so its outcome decides the marker. */
  publishedGrade: string | null;
  publishedTotal: number | null;
  /** The FAT weight here is this app's assumption because VTOP published none. */
  assumedFat: boolean;
  message: string;
}

export interface PassLineOptions extends ProjectionOptions {
  /** VTOP's published grade letter for the course, when the grade view has it. */
  publishedGrade?: string | null;
  /** VTOP's published course total, when the grade view has it. */
  publishedTotal?: number | null;
}

/**
 * The pass line on VTOP's numbers: what the FAT must give for the course to
 * clear VIT's 50% total and 40%-of-FAT rule.
 *
 * Ungraded internals are held at zero rather than at the student's pace — a
 * pass marker has to stay true whatever the unmarked CATs turn out to be. A
 * grade VTOP has already published is the fact, and no FAT is solved for.
 * When VTOP has not declared a FAT weight, the model's labelled 40% assumption
 * is used rather than refusing to answer a question the student is asking.
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
