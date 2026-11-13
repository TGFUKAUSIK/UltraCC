/**
 * The course list says what each class earned, and refuses to print a course
 * total it cannot stand behind: the 2025 75/25 rule, the older credit ratio,
 * legacy courses registered separately, ungraded rows held out of the pace,
 * and denominators that are the class's own weight rather than 100.
 */

import { describe, expect, it } from 'vitest';
import { classMarkLabel, combinedLabel, courseTotalsOf } from '../courseTotals';
import type { CourseMarks } from '../../types';

const empty = { scored: 0, max: 0, weightage: 0 };

function course(overrides: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'BEEE2023',
    courseTitle: 'Electric Circuits and Systems',
    cat1: { ...empty },
    cat2: { ...empty },
    da1: { ...empty },
    da2: { ...empty },
    da3: { ...empty },
    quiz: { ...empty },
    fat: { scored: 0, max: 100, weightage: 40, status: 'Pending', part: 'T' },
    totalScoredSoFar: 0,
    currentEstimatedGrade: '',
    credits: 4,
    theoryCredits: 3,
    labCredits: 1,
    ...overrides,
  };
}

/** Theory 26/30 internals graded (86.67%), lab 18/20 internals (90%) plus a graded FAT. */
const embedded = course({
  cat1: { scored: 40, max: 50, weightage: 20, status: 'Evaluated', part: 'T' },
  da1: { scored: 10, max: 10, weightage: 10, status: 'Evaluated', part: 'T' },
  fat: { scored: 0, max: 100, weightage: 40, status: 'Pending', part: 'T' },
  extraComponents: [
    { title: 'Experiment', scored: 9, max: 10, weightage: 20, status: 'Evaluated', part: 'L' },
  ],
  labFat: { scored: 40, max: 50, weightage: 60, status: 'Evaluated', part: 'L' },
});

describe('an embedded course is combined by the batch rule', () => {
  it('uses 75/25 for a 2025 batch on a 3+1 registration', () => {
    const { totals } = courseTotalsOf(embedded, { regNo: '25BEE0001' });
    expect(totals.kind).toBe('embedded');
    expect(totals.classes.map((c) => c.percent)).toEqual([86.67, 90]);
    // Theory internals are a mark out of 60 while its FAT is pending; the lab
    // has its FAT, so it is already a /100 course total.
    expect(classMarkLabel(totals.classes[0])).toBe('52.0 / 60');
    expect(classMarkLabel(totals.classes[1])).toBe('86.0 / 100');
    expect(totals.combined).toMatchObject({
      percent: 87.5,
      // The theory FAT is still pending, so this is a pace, not a closed mark.
      complete: false,
      basis: 'theory 75% · lab 25% (2025 regulation)',
    });
    expect(totals.incomplete).toBe(true);
  });

  it('uses the registered credit ratio before 2025, not a fixed 75/25', () => {
    const fourOne = courseTotalsOf(
      { ...embedded, credits: 5, theoryCredits: 4, labCredits: 1 },
      { regNo: '24BEE1303', admissionYear: 2024 },
    );
    // A 2+1 registration is a different ratio, so a hard-coded 75/25 fails here.
    const twoOne = courseTotalsOf(
      { ...embedded, credits: 3, theoryCredits: 2, labCredits: 1 },
      { admissionYear: 2024 },
    );
    expect(fourOne.totals.combined!.percent).toBe(87.34);
    expect(fourOne.totals.combined!.basis).toContain('by credits');
    expect(twoOne.totals.combined!.percent).toBe(87.78);
    expect(twoOne.totals.combined!.basis).toContain('theory 67% · lab 33%');
  });

  it('says when the 2025 regulation overrides a 4+1 registration', () => {
    const { totals } = courseTotalsOf(
      { ...embedded, credits: 5, theoryCredits: 4, labCredits: 1 },
      { regNo: '25BEE0001' },
    );
    expect(totals.combined!.basis).toContain('2025 regulation');
    expect(totals.splitNote).toContain('Registered credits split this course 80 / 20');
  });
});

describe('two separately registered courses are never combined', () => {
  it('keeps legacy theory and lab records as their own single-class courses', () => {
    const theory = courseTotalsOf(course({
      courseCode: 'BMEE301T',
      cat1: { scored: 40, max: 50, weightage: 20, status: 'Evaluated', part: 'T' },
      theoryCredits: 3,
      labCredits: 0,
      credits: 3,
      fat: { ...empty },
    }));
    const lab = courseTotalsOf(course({
      courseCode: 'BMEE301P',
      cat1: { ...empty },
      extraComponents: [
        { title: 'Experiment', scored: 9, max: 10, weightage: 20, status: 'Evaluated', part: 'L' },
      ],
      theoryCredits: 0,
      labCredits: 2,
      credits: 2,
      fat: { ...empty },
      labFat: { scored: 40, max: 50, weightage: 60, status: 'Evaluated', part: 'L' },
    }));

    expect(theory.totals.kind).toBe('theory');
    expect(lab.totals.kind).toBe('lab');
    expect(theory.totals.combined).toBeNull();
    expect(lab.totals.combined).toBeNull();
    expect(theory.totals.classes).toHaveLength(1);
    expect(lab.totals.classes).toHaveLength(1);
  });
});

describe('a row VTOP has not graded is not a zero', () => {
  const partial = course({
    theoryCredits: 3,
    labCredits: 0,
    credits: 3,
    cat1: { scored: 20, max: 25, weightage: 20, status: 'Evaluated', part: 'T' },
    cat2: { scored: 0, max: 25, weightage: 20, status: 'Pending', part: 'T' },
    fat: { ...empty },
  });

  it('measures the pace on the graded weight and keeps the pending row open', () => {
    const { totals } = courseTotalsOf(partial, { regNo: '25BEE0001' });
    const theory = totals.classes[0];
    expect(theory.earned).toBe(16);
    expect(theory.graded).toBe(20);
    expect(theory.pending).toBe(20);
    expect(theory.percent).toBe(80);
    expect(theory.complete).toBe(false);
    expect(totals.incomplete).toBe(true);
    expect(totals.missing).toContain('CAT 2');
  });

  it('prints the internal pace as a mark out of 60, not a /100 total', () => {
    const { totals } = courseTotalsOf(partial);
    // 16 earned on the 20 graded internal weight is 80%, and 80% of 60 is 48.
    expect(classMarkLabel(totals.classes[0])).toBe('48.0 / 60');
  });
});

describe('a registered class with no rows blocks the course total', () => {
  it('keeps a 3+1 embedded course open until the lab publishes marks', () => {
    const { totals } = courseTotalsOf(
      { ...embedded, extraComponents: [], labFat: undefined },
      { regNo: '25BEE0001' },
    );
    expect(totals.kind).toBe('embedded');
    expect(totals.classes.map((c) => c.unpublished)).toEqual([false, true]);
    expect(totals.combined).toBeNull();
    expect(totals.incomplete).toBe(true);
    expect(totals.missing).toContain('lab marks');
    expect(totals.splitNote).toContain('2025 regulation');
  });

  it('never labels a partial figure as a /100 final', () => {
    const { totals } = courseTotalsOf(
      { ...embedded, extraComponents: [], labFat: undefined },
      { regNo: '25BEE0001' },
    );
    expect(combinedLabel(totals.combined)).toBeNull();
    // Once the FAT is graded too, the same course carries a real /100 figure.
    const complete = courseTotalsOf(
      { ...embedded, fat: { scored: 70, max: 100, weightage: 40, status: 'Evaluated', part: 'T' } },
      { regNo: '25BEE0001' },
    ).totals;
    expect(complete.combined!.complete).toBe(true);
    // Theory: 26/30 internals → 52/60, FAT 70/100 → 28/40, so 80/100. Lab
    // already 86/100; on the 75/25 split that is 80×.75 + 86×.25 = 81.5.
    expect(combinedLabel(complete.combined)).toBe('81.5 / 100');
  });
});

describe("VTOP's published course total is a separate figure", () => {
  it('carries the grade view total when the semester has one', () => {
    const { totals } = courseTotalsOf(embedded, {
      regNo: '25BEE0001',
      publishedTotal: 74,
    });
    expect(totals.finalTotal).toBe(74);
    // The internal pace is still its own figure, not a copy of the final.
    expect(totals.combined!.percent).toBe(87.5);
  });

  it('reports the published total as missing when VTOP posted none', () => {
    expect(courseTotalsOf(embedded).totals.finalTotal).toBeNull();
  });
});
