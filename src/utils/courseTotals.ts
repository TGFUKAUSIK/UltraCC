/**
 * courseTotals.ts — the figures the course list and the course sheet print.
 *
 * `gradeModel` already decides how VTOP's rows are weighted and how an embedded
 * course's two halves combine. This file adds the one thing the redesign needs
 * on top of it: a per-course answer that says which classes exist, what each
 * class has earned, and whether a course total can honestly be printed yet.
 *
 * The rules it keeps, because each one was a wrong number on screen:
 *
 *   - VIT marks a class on a 60/40 scheme: internals are 60 and the FAT is 40,
 *     for a lab exactly as for theory. VTOP's own row weights rarely add up to
 *     those numbers (a theory half whose internals total 27.5 and whose FAT
 *     weighs 40 declares 67.5), so the class mark is normalized onto 60/40.
 *     Before the FAT is graded that is a mark out of 60; only once the FAT is
 *     graded does it become a /100 course total.
 *   - An embedded course's halves are combined only by the split the batch is
 *     under (75/25 from the 2025 regulation, the registered credit ratio
 *     otherwise). A registered half with no rows yet means no combined total.
 *   - A row VTOP has not graded is not a zero, so a class's pace is measured on
 *     the weight that has actually been graded. The denominator a student has
 *     not been measured on cannot make their average look worse.
 *   - Two separately registered courses are two records and are never combined.
 */

import type { CourseMarks, MarkPart } from '../types';
import {
  blendLabelOf,
  blendOf,
  buildCourseModel,
  type CourseBlend,
  type CourseGradeModel,
  type PartStats,
} from './gradeModel';

export type CourseKind = 'theory' | 'lab' | 'embedded';

/**
 * VIT's course mark: the internals carry 60 and the FAT 40, for a lab as for a
 * theory class. VTOP's declared row weights are only a scheme, not the mark, so
 * the earned internal pace is normalized onto this scale instead of being
 * printed against whatever total VTOP happened to declare.
 */
const INTERNAL_MARK = 60;
const FAT_MARK = 40;

export interface CourseClassTotal {
  part: MarkPart;
  label: 'Theory' | 'Lab';
  /** VTOP's own weighted marks on the graded rows of this class. */
  earned: number;
  /** Weight VTOP declared for the class, graded or not. */
  declared: number;
  /** Weight VTOP has graded in this class. */
  graded: number;
  /** Weight declared but still ungraded. */
  pending: number;
  /** Weight VTOP declared for the internal half, FAT excluded. */
  internalWeight: number;
  /** Internal weight VTOP has graded. */
  internalGraded: number;
  /** Internal earned / internal graded, 0–100. Null until an internal is graded. */
  percent: number | null;
  /** That pace as a mark out of 60. Null until an internal is graded. */
  internalMark: number | null;
  /** Internals plus FAT out of 100; null until every row, FAT included, is graded. */
  finalMark: number | null;
  /** Every declared row of this class is graded. */
  complete: boolean;
  /** Registered as a class, but VTOP published no weighted rows for it. */
  unpublished: boolean;
}

export interface CourseCombinedTotal {
  /** The two internal paces on the split shares — the internal pace of the course. */
  percent: number;
  /** The same pace as a course mark out of 60 before either FAT is graded. */
  internalMark: number;
  /** The weighted class marks out of 100, once both class FATs are graded. */
  finalMark: number | null;
  complete: boolean;
  /** "theory 75% · lab 25% (2025 regulation)" — the split the figure rides. */
  basis: string;
}

export interface CourseTotals {
  kind: CourseKind;
  classes: CourseClassTotal[];
  /** Only an embedded course has one, and only once both halves are graded. */
  combined: CourseCombinedTotal | null;
  /** VTOP's published course total from the grade view, when it posted one. */
  finalTotal: number | null;
  /** Some declared weight is ungraded, or a registered class has no rows yet. */
  incomplete: boolean;
  /** What is still missing: class names and VTOP's row titles. */
  missing: string[];
  /** A metadata conflict or unknown the student should be told about. */
  splitNote: string | null;
}

export interface CourseTotalOptions {
  regNo?: string | null;
  admissionYear?: number | null;
  /** VTOP's published course total, from the same semester's grade view. */
  publishedTotal?: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function classTotal(part: MarkPart, label: 'Theory' | 'Lab', stats: PartStats | null): CourseClassTotal {
  const declared = stats?.configuredWeight ?? 0;
  const graded = stats?.gradedWeight ?? 0;
  const earned = stats?.earned ?? 0;
  const internalWeight = stats?.internalWeight ?? 0;
  const internalGraded = stats?.internalGradedWeight ?? 0;
  const internalEarned = stats?.internalEarned ?? 0;
  const pending = stats?.pendingWeight ?? 0;
  const fat = stats?.fat ?? null;
  // A FAT row VTOP published without a max or a score cannot be placed on the
  // 40-mark half, so it does not close the class.
  const fatShare = fat && fat.scored !== null && fat.max > 0
    ? round2((fat.scored / fat.max) * FAT_MARK)
    : null;
  const complete = declared > 0 && pending <= 0;
  const percent = internalGraded > 0 ? round2((internalEarned / internalGraded) * 100) : null;
  const finalMark = complete && fatShare !== null && internalWeight > 0
    ? round2((internalEarned / internalWeight) * INTERNAL_MARK + fatShare)
    : null;
  return {
    part,
    label,
    earned,
    declared,
    graded,
    pending,
    internalWeight,
    internalGraded,
    percent,
    internalMark: percent !== null ? round2((percent / 100) * INTERNAL_MARK) : null,
    finalMark,
    complete,
    unpublished: declared <= 0,
  };
}

/**
 * One course's figures. `model` is passed back too so a caller prints the same
 * rows the totals were computed from instead of building the model twice.
 */
export function courseTotalsOf(
  course: CourseMarks,
  options: CourseTotalOptions = {},
): { totals: CourseTotals; model: CourseGradeModel } {
  const model = buildCourseModel(course, {
    regNo: options.regNo,
    admissionYear: options.admissionYear,
  });

  // A class exists if VTOP registered credits for it or published rows in it.
  const hasTheory = model.theoryCredits > 0 || model.parts.theory !== null;
  const hasLab = model.labCredits > 0 || model.parts.lab !== null;
  const classes: CourseClassTotal[] = [];
  if (hasTheory) classes.push(classTotal('T', 'Theory', model.parts.theory));
  if (hasLab) classes.push(classTotal('L', 'Lab', model.parts.lab));

  const kind: CourseKind = classes.length === 2
    ? 'embedded'
    : classes[0]?.part === 'L' ? 'lab' : 'theory';

  // The split is decided by the registration and the batch, not by which rows
  // VTOP has got round to publishing: a 3+1 course whose lab table is still
  // empty is still a 75/25 course.
  const blend = blendOf(hasTheory, hasLab, model.theoryCredits, model.labCredits, model.admissionYear);

  let combined: CourseCombinedTotal | null = null;
  if (kind === 'embedded') {
    const theory = classes[0];
    const lab = classes[1];
    // A half with nothing graded has no pace to combine. Printing the other
    // half's pace as the course's would be half a course wearing a whole one's
    // label, which is the defect this sheet exists to avoid.
    if (theory.percent !== null && lab.percent !== null) {
      combined = {
        percent: round2(theory.percent * blend.theory + lab.percent * blend.lab),
        internalMark: round2(
          (theory.internalMark as number) * blend.theory + (lab.internalMark as number) * blend.lab,
        ),
        finalMark: theory.finalMark !== null && lab.finalMark !== null
          ? round2(theory.finalMark * blend.theory + lab.finalMark * blend.lab)
          : null,
        complete: theory.complete && lab.complete,
        basis: blendLabelOf(blend),
      };
    }
  }

  const missing: string[] = [];
  for (const c of classes) {
    if (c.unpublished) missing.push(`${c.label.toLowerCase()} marks`);
  }
  for (const title of model.pendingTitles) {
    if (!missing.includes(title)) missing.push(title);
  }

  return {
    totals: {
      kind,
      classes,
      combined,
      finalTotal: typeof options.publishedTotal === 'number' && Number.isFinite(options.publishedTotal)
        ? options.publishedTotal
        : null,
      incomplete: classes.length === 0 || classes.some((c) => c.unpublished || !c.complete),
      missing,
      splitNote: splitNoteOf(blend, model.theoryCredits, model.labCredits),
    },
    model,
  };
}

/**
 * How the halves are split, and whether the registered credits disagree.
 *
 * The 2025 regulation fixes 75/25 whatever the credits say, so a 4+1 course
 * under it is a conflict worth stating rather than silently favouring one
 * source. Before 2025 the credit ratio is the rule, and missing credits are an
 * unknown, not a reason to imply 3+1.
 */
function splitNoteOf(blend: CourseBlend, theoryCredits: number, labCredits: number): string | null {
  if (blend.basis === 'single') return null;
  const known = theoryCredits > 0 && labCredits > 0;
  const creditShare = known ? theoryCredits / (theoryCredits + labCredits) : null;
  if (blend.basis === 'equal') {
    return 'Credits are not synced, so the two halves are split evenly until a sync supplies them.';
  }
  if (blend.basis === 'regulation-2025' && creditShare !== null && Math.abs(creditShare - blend.theory) > 0.005) {
    const percent = Math.round(creditShare * 100);
    return `Registered credits split this course ${percent} / ${100 - percent}, but the 2025 regulation fixes the course total at theory 75 / lab 25.`;
  }
  return blendLabelOf(blend);
}

/**
 * The one-line figure the course list prints for a class: "49.3 / 60" while
 * the FAT is ungraded, "86.0 / 100" once it is. Null when the class has no
 * declared weight at all, or nothing in it has been graded yet.
 */
export function classMarkLabel(total: CourseClassTotal): string | null {
  if (total.unpublished || total.declared <= 0) return null;
  if (total.finalMark !== null) return `${total.finalMark.toFixed(1)} / 100`;
  if (total.internalMark !== null) return `${total.internalMark.toFixed(1)} / 60`;
  return null;
}

/** "62.4 / 100" once both halves include their FAT; the /60 course mark before. */
export function combinedLabel(combined: CourseCombinedTotal | null): string | null {
  if (!combined) return null;
  return combined.finalMark !== null
    ? `${combined.finalMark.toFixed(1)} / 100`
    : `${combined.internalMark.toFixed(1)} / 60`;
}
