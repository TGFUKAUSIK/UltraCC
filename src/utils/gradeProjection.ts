/**
 * gradeProjection.ts — one answer to "what will I get, and what does it do to
 * my GPA?".
 *
 * The Grades screen used to answer that question three times: the predictor
 * projected a course out of a 58/12 class curve, the same card printed VIT's
 * absolute bands underneath it (so one score was a B and a C at once), and the
 * CGPA planner averaged letter grades into a semester GPA of its own. This file
 * is the single engine those screens share:
 *
 *   - A course's projected score is `gradeModel`'s (VTOP's weights, no free
 *     marks), and it is turned into a letter by exactly one rule chosen up
 *     front: the class curve when the cohort has enough shared marks, VIT's
 *     absolute bands otherwise. Never both.
 *   - A relative estimate needs same-class data. No default mean, no default
 *     spread: without a cohort the screen says so and falls back to the
 *     absolute rule, and a mean the student typed is labelled an assumption.
 *   - SGPA and CGPA are credit-weighted over the courses the regulation counts,
 *     not an average of letters.
 *   - The conservative / expected / optimistic scenarios are one function of the
 *     student's own internal pace, so all three move the grade, the SGPA and the
 *     CGPA together.
 *
 * Everything here is a projection. VIT's official grade remains whatever VTOP
 * publishes.
 */

import type { CourseMarks } from '../types';
import {
  DEFAULT_FAT_WEIGHT,
  GRADE_ORDER,
  GRADE_POINTS,
  VIT_FAT_MINIMUM_RATIO,
  buildCourseModel,
  fatHostPart,
  gradeFromVitPercent,
  hasDeclaredFat,
  projectCoursePercent,
  withAssumedFat,
  type CourseGradeModel,
  type GradeLetter,
} from './gradeModel';
import { classMarkLabel, combinedLabel, courseTotalsOf, type CourseTotals } from './courseTotals';

export type Scenario = 'conservative' | 'expected' | 'optimistic';

export const SCENARIO_ORDER: Scenario[] = ['conservative', 'expected', 'optimistic'];

export const SCENARIO_LABEL: Record<Scenario, string> = {
  conservative: 'Conservative',
  expected: 'Expected',
  optimistic: 'Optimistic',
};

/**
 * How far a scenario moves the FAT estimate from the student's own pace.
 *
 * The old screen ran 1,000 imaginary papers ±8 points around a score the student
 * chose, and its caption had to explain a study the app never validated. A
 * scenario is not a simulation: it is the student's own pace, and ten points
 * either side of it. Both numbers are shown on screen, and the student can move
 * any of them.
 */
export const SCENARIO_STEP = 10;

/** Anchor for the scenarios when nothing in the course has been graded yet. */
export const DEFAULT_FAT_PACE = 50;

export type Confidence = 'high' | 'medium' | 'low' | 'none';

/** The FAT score a scenario starts from, given the student's internal pace. */
export function scenarioFatPercent(pace: number | null, scenario: Scenario): number {
  const anchor = pace === null ? DEFAULT_FAT_PACE : pace;
  const shift = scenario === 'conservative' ? -SCENARIO_STEP : scenario === 'optimistic' ? SCENARIO_STEP : 0;
  return Math.round(Math.min(100, Math.max(0, anchor + shift)));
}

// ---------------------------------------------------------------------------
// Grade points and the two grade rules
// ---------------------------------------------------------------------------

/**
 * Points a letter is worth. `N` (not cleared, usually attendance) is 0 and keeps
 * the same role as an F: it counts against the GPA and earns nothing.
 */
export function pointsOfGrade(grade: string | null | undefined): number {
  const letter = (grade ?? '').trim().toUpperCase();
  if (letter === 'N') return 0;
  return GRADE_POINTS[letter as GradeLetter] ?? 0;
}

export function isKnownGrade(grade: string | null | undefined): boolean {
  const letter = (grade ?? '').trim().toUpperCase();
  return letter === 'N' || GRADE_ORDER.includes(letter as GradeLetter);
}

/** The next better letter, or null at the top of the scale. */
export function betterGrade(grade: GradeLetter): GradeLetter | null {
  const index = GRADE_ORDER.indexOf(grade);
  return index > 0 ? GRADE_ORDER[index - 1] : null;
}

/**
 * The community curve: S above μ+1.5σ, A +1σ..+1.5σ, B +0.5σ..+1σ, C ±0.5σ,
 * D −1σ..−0.5σ, E −1.5σ..−1σ, F below. Same cut-offs the predictor has always
 * used, applied here to the model's projection instead of to a second score.
 */
export function gradeFromRelative(percent: number, mean: number, sd: number): GradeLetter {
  if (!(sd > 0)) return gradeFromVitPercent(percent) ?? 'F';
  const z = (percent - mean) / sd;
  if (z >= 1.5) return 'S';
  if (z >= 1.0) return 'A';
  if (z >= 0.5) return 'B';
  if (z >= -0.5) return 'C';
  if (z >= -1.0) return 'D';
  if (z >= -1.5) return 'E';
  return 'F';
}

/** The same cut-offs as marks, so the screen can say where each letter starts. */
export function relativeCutoffs(mean: number, sd: number): { grade: GradeLetter; min: number }[] {
  const z: Record<GradeLetter, number | null> = {
    S: 1.5, A: 1, B: 0.5, C: -0.5, D: -1, E: -1.5, F: null,
  };
  return GRADE_ORDER
    .filter((g) => z[g] !== null)
    .map((g) => ({ grade: g, min: Math.round((mean + (z[g] as number) * sd) * 10) / 10 }));
}

/** Class statistics for one course's cohort, or a mean the student typed. */
export interface ClassReading {
  count: number;
  mean: number;
  sd: number;
  /** `class` = measured from shared marks; `manual` = an assumption, not data. */
  source: 'class' | 'manual';
}

// ---------------------------------------------------------------------------
// A course's projection
// ---------------------------------------------------------------------------

export interface PredictionOptions {
  regNo?: string | null;
  /** Same-class statistics, once the privacy floor has been met. */
  classStats?: ClassReading | null;
  /** VTOP's published letter for this course, when the grade view carries one. */
  publishedGrade?: string | null;
  /**
   * The FAT percentage the student expects for this course. It is the anchor the
   * three scenarios sit around (`SCENARIO_STEP` either side), so moving the
   * slider moves every reading instead of leaving two of them quoting a pace the
   * student just overrode. Omitted, the anchor is the student's internal pace.
   */
  fatPercent?: number | null;
}

export interface FatPlan {
  part: 'Theory' | 'Lab' | null;
  /** The paper's own maximum, from VTOP's FAT row when it published one. */
  max: number;
  weight: number;
  /** The weight is this app's assumption, not VTOP's published FAT. */
  assumedWeight: boolean;
  /** VTOP published the FAT row itself. */
  declared: boolean;
  /** The FAT still has to be sat or graded — the slider has something to move. */
  open: boolean;
}

export interface ScenarioReading {
  scenario: Scenario;
  fatPercent: number;
  percent: number | null;
  grade: GradeLetter | null;
  points: number | null;
}

export interface MarkFigure {
  label: string;
  value: string | null;
}

export interface CourseProjection {
  courseCode: string;
  courseTitle: string;
  credits: number | null;
  /** "Theory 3 + Lab 1" — the registered structure, when it is known. */
  structure: string;
  totals: CourseTotals;
  model: CourseGradeModel;
  /** VTOP's published letter, when this course already has one. */
  publishedGrade: string | null;
  /** The grade the semester GPA counts: VTOP's, or the expected one. */
  grade: string | null;
  points: number | null;
  /** The projected letter from the expected scenario. */
  expected: GradeLetter | null;
  /** Worst and best letter the three scenarios reach, best last. */
  range: [GradeLetter, GradeLetter] | null;
  percent: number | null;
  basis: 'relative' | 'absolute';
  /** What each class has earned, with its own denominator (classMarkLabel). */
  figures: MarkFigure[];
  /** Assessments VTOP has declared and not graded, in its own words. */
  pending: string[];
  fat: FatPlan;
  /** The student's own internal pace — the anchor every scenario starts from. */
  pace: number | null;
  scenarios: Record<Scenario, ScenarioReading>;
  confidence: Confidence;
  confidenceNote: string;
  /** The class curve this course was read against, and where it came from. */
  classStats: ClassReading | null;
  counted: boolean;
  exclusion: string | null;
}

/**
 * Courses the V5.0 regulations keep out of the programme GPA: pass/fail and
 * audit courses, and Minor, Honours and Second Major courses.
 *
 * VTOP states the course type on the grade list and the title usually says it
 * too. This is a label match, so it is only trusted where one of those words is
 * present — a course the data does not describe stays counted, which is the
 * conservative choice for a student's CGPA.
 */
export function exclusionOf(course: { courseTitle: string; courseType?: string | null }): string | null {
  const text = `${course.courseType ?? ''} ${course.courseTitle ?? ''}`;
  const match = /\b(pass\s*\/?\s*fail|audit|minor|honours|honors|second\s+major)\b/i.exec(text);
  if (!match) return null;
  const label = match[1].replace(/\s+/g, ' ').toLowerCase();
  return `${label} course — not counted in GPA or CGPA under the V5.0 regulations`;
}

/**
 * Which FAT the slider belongs to, how heavy it is, and whether VTOP said so.
 *
 * The weight is VTOP's when it published a FAT row and VIT's published 40%
 * otherwise. It is never a figure the student can move: the final exam is 40%
 * of the course, and a student who talks themselves into a lighter paper would
 * only be reading a projection VTOP has not promised.
 */
export function fatPlanOf(model: CourseGradeModel): FatPlan {
  const host = fatHostPart(model);
  const declared = host?.fat ?? null;
  if (declared) {
    return {
      part: declared.part === 'L' ? 'Lab' : 'Theory',
      max: declared.max > 0 ? declared.max : 100,
      weight: declared.weightage,
      assumedWeight: !!declared.assumed,
      declared: true,
      open: declared.scored === null,
    };
  }
  const weight = host ? DEFAULT_FAT_WEIGHT : 0;
  return {
    part: host ? (host.part === 'L' ? 'Lab' : 'Theory') : null,
    max: 100,
    weight,
    assumedWeight: weight > 0,
    declared: false,
    open: weight > 0,
  };
}

/**
 * Projected course percentage (0–100 of the weight VTOP has declared).
 *
 * The one projection helper the screen, its tests and the legacy callers share:
 * each row contributes its own weightage, an ungraded row is held at the
 * student's pace, the FAT takes the score passed here, and an embedded course's
 * halves combine by the shares of its registration. `null` — never 0 — when the
 * model cannot project.
 */
export function projectedTotal(
  course: CourseMarks,
  fatPercent: number,
  regNo?: string | null,
): number | null {
  const base = buildCourseModel(course, { regNo });
  const fat = fatPlanOf(base);
  const model = fat.weight > 0 && !hasDeclaredFat(base) ? withAssumedFat(base, fat.weight) : base;
  const percent = projectCoursePercent(model, {
    fatPercent: Math.min(100, Math.max(0, fatPercent)),
  });
  return percent === null ? null : Math.min(100, Math.max(0, percent));
}

function structureOf(model: CourseGradeModel): string {
  if (model.isEmbedded) {
    return `Theory ${model.theoryCredits || '—'} + Lab ${model.labCredits || '—'}`;
  }
  if (model.parts.lab && !model.parts.theory) return 'Lab only';
  return 'Theory only';
}

function confidenceOf(args: {
  percent: number | null;
  gradedShare: number;
  relative: boolean;
  assumedFat: boolean;
  count: number;
  weightsUndeclared: boolean;
}): { level: Confidence; note: string } {
  if (args.percent === null) {
    return {
      level: 'none',
      note: args.weightsUndeclared
        ? 'VTOP has not published this course’s assessment weightage, so there is nothing to project from.'
        : 'Nothing in this course has been graded yet, so there is no pace to project the rest at.',
    };
  }
  const graded = Math.round(args.gradedShare * 100);
  const classPart = args.relative
    ? args.count > 0
      ? ` ${args.count} classmates are in the comparison.`
      : ' The mean and spread are your own assumption, not classmates’ marks.'
    : ' There is no same-class data yet, so VIT’s published bands decide the letter.';
  const fatPart = args.assumedFat ? ' VTOP has not published the final-exam weight, so this uses VIT’s 40%.' : '';
  if (args.relative && args.gradedShare >= 0.8 && !args.assumedFat) {
    return { level: 'high', note: `${graded}% of the course weight is graded.${classPart}${fatPart}` };
  }
  if (args.gradedShare >= 0.5 || args.relative) {
    return { level: 'medium', note: `${graded}% of the course weight is graded.${classPart}${fatPart}` };
  }
  return { level: 'low', note: `Only ${graded}% of the course weight is graded.${classPart}${fatPart}` };
}

/**
 * The FAT paper, as a fraction of its own maximum.
 *
 * VIT passes a course only on 40% of the final-exam paper, however strong the
 * internals are: 60/60 on the internals buys nothing if the paper itself is
 * under 40. This reads the mark the paper actually has, or the one the scenario
 * projects, so the gate follows the slider. Null when there is no FAT to sit.
 */
function fatPaperRatioOf(model: CourseGradeModel, fatPercent: number): number | null {
  const rows = [model.parts.theory, model.parts.lab]
    .flatMap((part) => (part ? part.rows.filter((row) => row.isFat && row.max > 0) : []));
  if (!rows.length) return null;
  const expected = Math.min(100, Math.max(0, fatPercent)) / 100;
  return rows.reduce(
    (worst, row) => Math.min(worst, row.scored !== null ? row.scored / row.max : expected),
    1,
  );
}

/**
 * One course, projected three ways: conservative, expected, optimistic.
 *
 * The letter is decided by one rule for all three readings — the class curve if
 * `classStats` is usable, VIT's bands otherwise — so a course can never show a
 * relative grade in one place and an absolute one in another. Either rule sits
 * under the pass gate: a FAT paper below 40% is an F.
 */
export function projectCourse(
  course: CourseMarks,
  options: PredictionOptions = {},
): CourseProjection {
  const { totals, model } = courseTotalsOf(course, { regNo: options.regNo });
  const fat = fatPlanOf(model);
  const projectionModel = fat.weight > 0 && !hasDeclaredFat(model)
    ? withAssumedFat(model, fat.weight)
    : model;

  const stats = options.classStats ?? null;
  const basis: 'relative' | 'absolute' = stats ? 'relative' : 'absolute';
  const percentAt = (fatPercent: number) => {
    const percent = projectCoursePercent(projectionModel, { fatPercent });
    return percent === null ? null : Math.min(100, Math.max(0, percent));
  };
  const gradeAt = (percent: number | null, fatPercent: number): GradeLetter | null => {
    if (percent === null) return null;
    const letter = stats ? gradeFromRelative(percent, stats.mean, stats.sd) : gradeFromVitPercent(percent);
    const fatRatio = fatPaperRatioOf(projectionModel, fatPercent);
    return letter !== null && fatRatio !== null && fatRatio < VIT_FAT_MINIMUM_RATIO ? 'F' : letter;
  };

  const pace = model.gradedPercent;
  const anchor = typeof options.fatPercent === 'number' && Number.isFinite(options.fatPercent)
    ? Math.min(100, Math.max(0, Math.round(options.fatPercent)))
    : pace;
  const fatPercentOf = (scenario: Scenario): number => scenarioFatPercent(anchor, scenario);
  const scenarios = {} as Record<Scenario, ScenarioReading>;
  for (const scenario of SCENARIO_ORDER) {
    const fatPercent = fatPercentOf(scenario);
    const percent = percentAt(fatPercent);
    const grade = gradeAt(percent, fatPercent);
    scenarios[scenario] = {
      scenario,
      fatPercent,
      percent,
      grade,
      points: grade === null ? null : pointsOfGrade(grade),
    };
  }

  const expected = scenarios.expected.grade;
  const publishedLetter = (options.publishedGrade ?? '').trim().toUpperCase();
  const publishedGrade = isKnownGrade(publishedLetter) ? publishedLetter : null;
  const grade = publishedGrade ?? expected;
  const points = grade === null ? null : pointsOfGrade(grade);
  const conservative = publishedGrade ? null : scenarios.conservative.grade;
  const optimistic = publishedGrade ? null : scenarios.optimistic.grade;
  const range: [GradeLetter, GradeLetter] | null = conservative && optimistic
    ? [conservative, optimistic]
    : !publishedGrade && expected
      ? [expected, expected]
      : null;

  const figures: MarkFigure[] = totals.classes.map((c) => ({ label: c.label, value: classMarkLabel(c) }));
  if (totals.combined && totals.combined.finalMark !== null) {
    figures.push({ label: 'Course', value: combinedLabel(totals.combined) });
  }

  const gradedShare = model.configuredWeight > 0
    ? (model.configuredWeight - model.pendingWeight) / model.configuredWeight
    : 0;
  const confidence = confidenceOf({
    percent: scenarios.expected.percent,
    gradedShare,
    relative: basis === 'relative',
    assumedFat: fat.assumedWeight,
    count: stats?.count ?? 0,
    weightsUndeclared: model.weightsUndeclared,
  });

  const exclusion = exclusionOf(course);

  return {
    courseCode: course.courseCode,
    courseTitle: course.courseTitle,
    credits: model.credits,
    structure: structureOf(model),
    totals,
    model,
    publishedGrade,
    grade,
    points,
    expected,
    range,
    percent: scenarios.expected.percent,
    basis,
    figures,
    pending: model.pendingTitles,
    fat,
    pace,
    scenarios,
    confidence: confidence.level,
    confidenceNote: confidence.note,
    classStats: stats,
    counted: exclusion === null,
    exclusion,
  };
}

/**
 * The same projection read under one scenario.
 *
 * The panel's scenario control moves the grade, the SGPA and the CGPA together,
 * so the caller asks the engine for that reading instead of rebuilding the
 * letter from a percent itself — which is how two surfaces start to disagree.
 * A published grade is VTOP's and is never overridden by a scenario.
 */
export function withScenario(row: CourseProjection, scenario: Scenario): CourseProjection {
  if (row.publishedGrade !== null) return row;
  const reading = row.scenarios[scenario];
  const conservative = row.scenarios.conservative.grade;
  const optimistic = row.scenarios.optimistic.grade;
  const range: [GradeLetter, GradeLetter] | null = conservative && optimistic
    ? [conservative, optimistic]
    : reading.grade
      ? [reading.grade, reading.grade]
      : null;
  return {
    ...row,
    grade: reading.grade,
    points: reading.points,
    percent: reading.percent,
    expected: reading.grade,
    range,
  };
}

// ---------------------------------------------------------------------------
// Semester GPA
// ---------------------------------------------------------------------------

export interface SemesterGpa {
  sgpa: number | null;
  /** Credits the GPA was divided by. */
  credits: number;
  /** Courses that contributed to it. */
  courses: number;
  excluded: { courseCode: string; reason: string }[];
  /** Courses with no credit figure in any source — left out, not counted as 3. */
  missingCredits: string[];
  /** Courses with no grade at all to count — left out, never counted as an F. */
  missingGrades: string[];
}

/**
 * Credit-weighted semester GPA: Σ(credits × points) / Σ(credits).
 *
 * A published letter counts as actual, a projected one as an estimate, and both
 * weight by the registered credits. A course with no credit figure or no grade
 * is named and left out rather than being weighted as a default or graded F.
 */
export function semesterGpaOf(
  rows: CourseProjection[],
  creditsByCourse: Record<string, number> = {},
): SemesterGpa {
  let credits = 0;
  let points = 0;
  let courses = 0;
  const excluded: { courseCode: string; reason: string }[] = [];
  const missingCredits: string[] = [];
  const missingGrades: string[] = [];
  for (const row of rows) {
    if (!row.counted) {
      excluded.push({ courseCode: row.courseCode, reason: row.exclusion as string });
      continue;
    }
    const courseCredits = row.credits ?? creditsByCourse[row.courseCode] ?? null;
    if (!(typeof courseCredits === 'number' && courseCredits > 0)) {
      missingCredits.push(row.courseCode);
      continue;
    }
    if (row.grade === null) {
      missingGrades.push(row.courseCode);
      continue;
    }
    credits += courseCredits;
    points += courseCredits * pointsOfGrade(row.grade);
    courses += 1;
  }
  return {
    sgpa: credits > 0 ? points / credits : null,
    credits,
    courses,
    excluded,
    missingCredits,
    missingGrades,
  };
}

// ---------------------------------------------------------------------------
// CGPA
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  credits: number | null;
  grade: string | null;
}

export interface CgpaEstimate {
  cgpa: number | null;
  /**
   * `history` — summed from actual grades;
   * `approximate` — weighted from VTOP's published CGPA and earned credits;
   * `none` — not enough information.
   */
  mode: 'history' | 'approximate' | 'none';
  note: string | null;
}

export interface CgpaInput {
  semester: SemesterGpa;
  /** Per-course grades already awarded (VTOP's effective grades). */
  history?: HistoryEntry[] | null;
  /** VTOP's published cumulative CGPA. */
  previousCgpa?: number | null;
  /** VTOP's published earned credits — the denominator `previousCgpa` rides. */
  previousCredits?: number | null;
}

/**
 * Predicted CGPA after this semester.
 *
 * Preferred: sum the awarded courses' points and add the semester's, then divide
 * by the counted credits on both sides. When the awarded credits cannot be
 * trusted — VTOP's effective-grades table can omit a failed attempt, and it
 * carries no course code to dedupe a repeated course — the published CGPA times
 * the published earned credits is the fallback, and the result says so.
 *
 * Never the average of the two GPAs: that weights a 10-credit semester and a
 * 25-credit one equally.
 */
export function cgpaOf(input: CgpaInput): CgpaEstimate {
  const semester = input.semester;
  const history = (input.history ?? []).filter(
    (row) => isKnownGrade(row.grade) && typeof row.credits === 'number' && row.credits > 0,
  );

  if (semester.sgpa !== null && semester.credits > 0) {
    const historyCredits = history.reduce((sum, row) => sum + (row.credits as number), 0);
    // VTOP's published earned credits are the check on the table: a table that
    // adds up to less has missed a course (usually a failed attempt), and its
    // total points would then be short by exactly that course.
    const published = input.previousCredits;
    const tableAgrees = published === null || published === undefined
      ? historyCredits > 0
      : Math.abs(historyCredits - published) <= 1;
    if (historyCredits > 0 && tableAgrees) {
      const historyPoints = history.reduce(
        (sum, row) => sum + (row.credits as number) * pointsOfGrade(row.grade),
        0,
      );
      const totalCredits = historyCredits + semester.credits;
      return {
        cgpa: (historyPoints + semester.sgpa * semester.credits) / totalCredits,
        mode: 'history',
        note: null,
      };
    }
  }

  const previousCgpa = input.previousCgpa;
  const previousCredits = input.previousCredits;
  if (
    typeof previousCgpa === 'number' && previousCgpa > 0
    && typeof previousCredits === 'number' && previousCredits > 0
    && semester.sgpa !== null && semester.credits > 0
  ) {
    return {
      cgpa: (previousCgpa * previousCredits + semester.sgpa * semester.credits)
        / (previousCredits + semester.credits),
      mode: 'approximate',
      note: 'Approximate: VTOP publishes your CGPA and earned credits rounded, so this weights the semester against those figures.',
    };
  }

  return {
    cgpa: null,
    mode: 'none',
    note: semester.sgpa === null
      ? 'A CGPA estimate needs a semester GPA, and this semester has no grade to count yet.'
      : 'Add your current CGPA and the credits you have earned to estimate where this semester lands.',
  };
}

// ---------------------------------------------------------------------------
// Where a grade step moves the GPA most
// ---------------------------------------------------------------------------

export interface ImpactRow {
  courseCode: string;
  courseTitle: string;
  credits: number;
  from: GradeLetter;
  to: GradeLetter;
  /** Credits × the points the step is worth — the size of the move. */
  gainPoints: number;
  fromSgpa: number;
  toSgpa: number;
  remaining: string[];
}

/**
 * The open courses ranked by what one grade step does to the semester GPA.
 *
 * Only courses still being assessed are ranked: a published grade cannot move,
 * and an incomplete course ranked here is one where the remaining assessments
 * can still decide the letter.
 */
export function gpaImpactOf(
  rows: CourseProjection[],
  creditsByCourse: Record<string, number> = {},
  limit = 3,
): ImpactRow[] {
  const semester = semesterGpaOf(rows, creditsByCourse);
  if (semester.sgpa === null || semester.credits <= 0) return [];
  const impacts: ImpactRow[] = [];
  for (const row of rows) {
    if (!row.counted || row.publishedGrade !== null) continue;
    if (!isKnownGrade(row.grade) || row.grade === 'N') continue;
    if (row.confidence === 'none') continue;
    const courseCredits = row.credits ?? creditsByCourse[row.courseCode] ?? 0;
    if (!(courseCredits > 0)) continue;
    const from = row.grade as GradeLetter;
    const to = betterGrade(from);
    if (!to) continue;
    const gainPoints = courseCredits * (pointsOfGrade(to) - pointsOfGrade(from));
    if (gainPoints <= 0) continue;
    impacts.push({
      courseCode: row.courseCode,
      courseTitle: row.courseTitle,
      credits: courseCredits,
      from,
      to,
      gainPoints,
      fromSgpa: semester.sgpa,
      toSgpa: (semester.sgpa * semester.credits + gainPoints) / semester.credits,
      remaining: row.pending,
    });
  }
  return impacts.sort((a, b) => b.gainPoints - a.gainPoints).slice(0, limit);
}
