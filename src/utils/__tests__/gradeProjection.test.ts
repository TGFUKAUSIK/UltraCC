/**
 * The grade engine's own contract: one letter per course, one credit-weighted
 * SGPA, one CGPA that says whether it is exact or weighted from VTOP's rounded
 * figures, and a GPA-impact ranking computed from those same numbers.
 */

import { describe, expect, it } from 'vitest';
import type { CourseMarks } from '../../types';
import { gradeFromVitPercent } from '../gradeModel';
import {
  SCENARIO_STEP,
  cgpaOf,
  gpaImpactOf,
  gradeFromRelative,
  projectCourse,
  relativeCutoffs,
  semesterGpaOf,
  withScenario,
} from '../gradeProjection';

const empty = { scored: 0, max: 0, weightage: 0 };

/** Every internal graded at a 78% pace, the FAT still open at 40%. */
function course(over: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'MAT2002',
    courseTitle: 'Probability and Statistics',
    cat1: { scored: 40, max: 50, weightage: 15, status: 'Evaluated' },
    cat2: { scored: 35, max: 50, weightage: 15, status: 'Evaluated' },
    da1: { scored: 8, max: 10, weightage: 5, status: 'Evaluated' },
    da2: { scored: 7, max: 10, weightage: 5, status: 'Evaluated' },
    da3: { ...empty, status: 'Pending' },
    quiz: { scored: 9, max: 10, weightage: 10, status: 'Evaluated' },
    fat: { scored: 0, max: 100, weightage: 40, status: 'Pending' },
    totalScoredSoFar: 0,
    currentEstimatedGrade: '',
    credits: 4,
    ...over,
  };
}

/** Weightage published, not one mark graded: there is no pace to project at. */
function nothingGraded(over: Partial<CourseMarks> = {}): CourseMarks {
  return course({
    cat1: { ...empty, weightage: 15, status: 'Pending' },
    cat2: { ...empty, weightage: 15, status: 'Pending' },
    da1: { ...empty, weightage: 5, status: 'Pending' },
    da2: { ...empty, weightage: 5, status: 'Pending' },
    quiz: { ...empty, weightage: 10, status: 'Pending' },
    fat: { ...empty, weightage: 40, status: 'Pending' },
    ...over,
  });
}

/** A 3:1 embedded course: every row graded, so the blend is a closed mark. */
function embeddedCourse(): CourseMarks {
  return course({
    courseCode: 'BEEE2023',
    courseTitle: 'Electric Circuits and Systems',
    cat1: { scored: 40, max: 50, weightage: 20, status: 'Evaluated', part: 'T' },
    da1: { scored: 10, max: 10, weightage: 10, status: 'Evaluated', part: 'T' },
    cat2: { ...empty, status: 'Pending' },
    da2: { ...empty, status: 'Pending' },
    quiz: { ...empty, status: 'Pending' },
    fat: { scored: 30, max: 100, weightage: 40, status: 'Evaluated', part: 'T' },
    extraComponents: [
      { title: 'Experiment', scored: 9, max: 10, weightage: 20, status: 'Evaluated', part: 'L' },
    ],
    labFat: { scored: 40, max: 50, weightage: 60, status: 'Evaluated', part: 'L' },
    credits: 4,
    theoryCredits: 3,
    labCredits: 1,
  });
}

describe('one letter per course', () => {
  it('uses VIT bands when no class curve is available', () => {
    const row = projectCourse(course());
    expect(row.basis).toBe('absolute');
    expect(row.grade).toBe(gradeFromVitPercent(row.percent as number));
    expect(row.grade).toBe('B'); // 78 of the declared weight is VIT's B band
  });

  it('uses the class curve once same-class statistics exist', () => {
    const row = projectCourse(course(), { classStats: { count: 20, mean: 58, sd: 12, source: 'class' } });
    expect(row.basis).toBe('relative');
    expect(row.grade).toBe(gradeFromRelative(row.percent as number, 58, 12));
    // 78 is a z of 1.67: a relative S, not the absolute C the bands would give.
    expect(row.grade).toBe('S');
    expect(row.grade).not.toBe(gradeFromVitPercent(row.percent as number));
  });

  it('labels a mean the student typed as an assumption, not class data', () => {
    const row = projectCourse(course(), { classStats: { count: 0, mean: 70, sd: 8, source: 'manual' } });
    expect(row.basis).toBe('relative');
    expect(row.classStats?.source).toBe('manual');
    expect(row.grade).toBe(gradeFromRelative(row.percent as number, 70, 8));
  });

  it('keeps VTOP’s published grade over every scenario', () => {
    const row = projectCourse(course(), { publishedGrade: 'B' });
    expect(row.grade).toBe('B');
    expect(withScenario(row, 'optimistic').grade).toBe('B');
    expect(row.range).toBeNull();
  });

  it('exposes the same cut-offs it grades with', () => {
    for (const { grade, min } of relativeCutoffs(58, 12)) {
      expect(gradeFromRelative(min, 58, 12)).toBe(grade);
    }
  });
});

describe('the FAT paper decides a pass on its own', () => {
  it('fails a course whose FAT is under 40/100, however strong the internals', () => {
    // 39 of 50 internal weight is a 78% pace; with a 30% FAT the course total is
    // 56.7 — VIT's D band — but the paper itself is under the 40% pass line, so
    // the course is an F. No internal mark is allowed to lift it.
    const row = projectCourse(course(), { fatPercent: 30 });
    expect(row.percent).toBeCloseTo(56.7, 1);
    expect(gradeFromVitPercent(row.percent)).not.toBe('F');
    expect(row.grade).toBe('F');
    expect(row.points).toBe(0);
  });

  it('passes at exactly 40/100', () => {
    const row = projectCourse(course(), { fatPercent: 40 });
    expect(row.grade).not.toBe('F');
  });

  it('applies the gate per scenario, so the range shows the cliff', () => {
    // Expected 45 (through), conservative 35 (an F) — one anchor, two letters.
    const row = projectCourse(course(), { fatPercent: 45 });
    expect(row.scenarios.conservative.fatPercent).toBe(35);
    expect(row.scenarios.conservative.grade).toBe('F');
    expect(row.scenarios.expected.grade).not.toBe('F');
  });

  it('reads a FAT VTOP already graded, not the slider', () => {
    const row = projectCourse(course({
      fat: { scored: 35, max: 100, weightage: 40, status: 'Evaluated' },
    }), { fatPercent: 90 });
    expect(row.fat.open).toBe(false);
    expect(row.grade).toBe('F');
  });
});

describe('the FAT estimate anchors all three scenarios', () => {
  it('starts at the student’s own pace and steps symmetrically', () => {
    const row = projectCourse(course());
    expect(row.pace).toBe(78);
    expect(row.scenarios.expected.fatPercent).toBe(78);
    expect(row.scenarios.conservative.fatPercent).toBe(78 - SCENARIO_STEP);
    expect(row.scenarios.optimistic.fatPercent).toBe(78 + SCENARIO_STEP);
  });

  it('moves every reading when the student sets their own estimate', () => {
    const row = projectCourse(course(), { fatPercent: 95 });
    expect(row.scenarios.expected.fatPercent).toBe(95);
    expect(row.scenarios.conservative.fatPercent).toBe(95 - SCENARIO_STEP);
    expect(row.scenarios.optimistic.fatPercent).toBe(Math.min(100, 95 + SCENARIO_STEP));
    // Not one scenario quoting the 78% pace the student just overrode.
    expect(row.scenarios.conservative.fatPercent).not.toBe(78);
  });

  it('never lets a scenario rank above the one to its right', () => {
    const row = projectCourse(course());
    const percent = (s: 'conservative' | 'expected' | 'optimistic') => row.scenarios[s].percent as number;
    expect(percent('conservative')).toBeLessThanOrEqual(percent('expected'));
    expect(percent('expected')).toBeLessThanOrEqual(percent('optimistic'));
    expect(row.range).toEqual([row.scenarios.conservative.grade, row.scenarios.optimistic.grade]);
  });

  it('re-expresses the row under the selected scenario', () => {
    const row = projectCourse(course());
    const optimistic = withScenario(row, 'optimistic');
    expect(optimistic.grade).toBe(row.scenarios.optimistic.grade);
    expect(optimistic.points).toBe(row.scenarios.optimistic.points);
    expect(optimistic.percent).toBe(row.scenarios.optimistic.percent);
  });
});

describe('nothing to project from is said, never filled in', () => {
  it('refuses a percent when VTOP published no weightage', () => {
    const row = projectCourse(course({
      cat1: { ...empty }, cat2: { ...empty }, da1: { ...empty }, da2: { ...empty },
      quiz: { ...empty }, fat: { ...empty },
    }));
    expect(row.percent).toBeNull();
    expect(row.grade).toBeNull();
    expect(row.confidence).toBe('none');
    expect(row.confidenceNote).toContain('weightage');
  });

  it('refuses a percent when nothing has been graded', () => {
    const row = projectCourse(nothingGraded());
    expect(row.percent).toBeNull();
    expect(row.grade).toBeNull();
    expect(row.confidenceNote).toContain('graded');
  });

  it('names the open assessments the projection rests on', () => {
    const row = projectCourse(course());
    expect(row.pending.join(' ')).toContain('FAT');
  });
});

describe('an embedded course keeps its registered structure', () => {
  it('projects through the same blend the totals use', () => {
    const row = projectCourse(embeddedCourse(), { regNo: '25BEE0001' });
    expect(row.structure).toBe('Theory 3 + Lab 1');
    expect(row.model.isEmbedded).toBe(true);
    // The registered 3:1 registration is what decides the halves' shares — the
    // 2025 rule here — and the course total is that blend of the two classes.
    expect(row.model.blend.basis).toBe('regulation-2025');
    expect(row.model.blend.theory).toBeCloseTo(0.75, 6);
    // The same course registered 4+1 before 2025 is an 80/20 course, so the
    // registered structure — not a fixed 75/25 — decides the projection.
    const older = projectCourse(
      { ...embeddedCourse(), credits: 5, theoryCredits: 4, labCredits: 1 },
      { regNo: '24BEE1303' },
    );
    expect(older.model.blend.basis).toBe('credits');
    expect(older.model.blend.theory).toBeCloseTo(0.8, 6);
    expect(older.percent).not.toBe(row.percent);
    expect(row.figures.map((f) => f.label)).toContain('Theory');
    expect(row.figures.map((f) => f.label)).toContain('Lab');
  });

  it('never merges a separately registered theory and lab', () => {
    const theory = course({ courseCode: 'BEEE2023', courseTitle: 'Electric Circuits — Theory', credits: 3 });
    const lab = course({ courseCode: 'BEEE2023L', courseTitle: 'Electric Circuits — Lab', credits: 1 });
    expect(projectCourse(theory).model.isEmbedded).toBe(false);
    expect(projectCourse(lab).model.isEmbedded).toBe(false);
    expect(projectCourse(theory).structure).toBe('Theory only');
  });
});

describe('semester GPA', () => {
  const rows = [
    projectCourse(course({ courseCode: 'AAA', credits: 4 }), { publishedGrade: 'S' }),
    projectCourse(course({ courseCode: 'BBB', credits: 3 }), { publishedGrade: 'B' }),
    projectCourse(course({ courseCode: 'CCC', courseTitle: 'Audit Course', credits: 2 }), { publishedGrade: 'A' }),
  ];

  it('weights grade points by credits and counts the courses it used', () => {
    const semester = semesterGpaOf(rows);
    expect(semester.credits).toBe(7);
    expect(semester.courses).toBe(2);
    expect(semester.sgpa).toBeCloseTo((4 * 10 + 3 * 8) / 7, 6);
  });

  it('keeps pass/fail, audit and minor courses out of the GPA', () => {
    const semester = semesterGpaOf(rows);
    expect(semester.excluded.map((e) => e.courseCode)).toEqual(['CCC']);
    expect(semester.excluded[0].reason).toContain('not counted');
  });

  it('leaves a course with no credit figure out and names it', () => {
    const noCredits = projectCourse(course({ courseCode: 'DDD', credits: undefined }), { publishedGrade: 'A' });
    const semester = semesterGpaOf([...rows, noCredits]);
    expect(semester.missingCredits).toEqual(['DDD']);
    expect(semester.credits).toBe(7);
  });

  it('takes credits from the caller when the record carries none', () => {
    const noCredits = projectCourse(course({ courseCode: 'DDD', credits: undefined }), { publishedGrade: 'A' });
    const semester = semesterGpaOf([noCredits], { DDD: 3 });
    expect(semester.credits).toBe(3);
    expect(semester.sgpa).toBe(9);
  });

  it('never grades an unmarked course as an F', () => {
    const row = projectCourse(nothingGraded({ courseCode: 'EEE' }));
    const semester = semesterGpaOf([row]);
    expect(semester.sgpa).toBeNull();
    expect(semester.missingGrades).toEqual(['EEE']);
  });

  it('follows the scenario the student picked', () => {
    const row = projectCourse(course());
    const expected = semesterGpaOf([withScenario(row, 'expected')]).sgpa as number;
    const optimistic = semesterGpaOf([withScenario(row, 'optimistic')]).sgpa as number;
    expect(optimistic).toBeGreaterThan(expected);
  });
});

describe('predicted CGPA', () => {
  const semester = semesterGpaOf([
    projectCourse(course({ courseCode: 'AAA', credits: 4 }), { publishedGrade: 'S' }),
    projectCourse(course({ courseCode: 'BBB', credits: 3 }), { publishedGrade: 'B' }),
  ]); // 9.142857 over 7 credits

  it('sums awarded grades when the table agrees with VTOP’s earned credits', () => {
    const estimate = cgpaOf({
      semester,
      history: [{ credits: 21, grade: 'A' }],
      previousCgpa: 9,
      previousCredits: 21,
    });
    expect(estimate.mode).toBe('history');
    expect(estimate.cgpa).toBeCloseTo((21 * 9 + semester.sgpa! * 7) / 28, 6);
  });

  it('weights VTOP’s rounded CGPA when the table cannot be trusted', () => {
    const estimate = cgpaOf({
      semester,
      history: [{ credits: 18, grade: 'A' }], // short of VTOP's 21 earned credits
      previousCgpa: 8.6,
      previousCredits: 21,
    });
    expect(estimate.mode).toBe('approximate');
    expect(estimate.cgpa).toBeCloseTo((8.6 * 21 + semester.sgpa! * 7) / 28, 6);
    expect(estimate.note).toContain('Approximate');
    // Never the simple average of the two GPAs: that weights 21 credits and 7 equally.
    expect(estimate.cgpa).not.toBeCloseTo((8.6 + semester.sgpa!) / 2, 3);
  });

  it('says what is missing instead of inventing a figure', () => {
    const emptySemester = semesterGpaOf([projectCourse(nothingGraded())]);
    const estimate = cgpaOf({ semester: emptySemester });
    expect(estimate.cgpa).toBeNull();
    expect(estimate.mode).toBe('none');
    expect(estimate.note).toBeTruthy();
  });

  it('marks ≈ whenever the CGPA is not summed from actual grades', () => {
    const estimate = cgpaOf({ semester, previousCgpa: 8.6, previousCredits: 21 });
    expect(estimate.mode).toBe('approximate');
  });
});

describe('where a grade step moves the SGPA', () => {
  const rows = [
    projectCourse(course({ courseCode: 'BIG', credits: 4 })),
    projectCourse(course({ courseCode: 'SMALL', credits: 2 })),
    projectCourse(course({ courseCode: 'DONE', credits: 4 }), { publishedGrade: 'C' }),
  ];

  it('ranks by credits × the points the step is worth', () => {
    const impacts = gpaImpactOf(rows);
    expect(impacts.map((i) => i.courseCode)).toEqual(['BIG', 'SMALL']);
    expect(impacts[0].gainPoints).toBe(4); // 4 credits × (B 8 − C 7)
    expect(impacts[1].gainPoints).toBe(2);
  });

  it('quotes the semester GPA it is about to move', () => {
    const impacts = gpaImpactOf(rows);
    const semester = semesterGpaOf(rows);
    expect(impacts[0].fromSgpa).toBe(semester.sgpa);
    expect(impacts[0].toSgpa).toBeCloseTo(
      (semester.sgpa! * semester.credits + impacts[0].gainPoints) / semester.credits,
      6,
    );
  });

  it('never ranks a published grade or a course with nothing open', () => {
    const impacts = gpaImpactOf(rows);
    expect(impacts.map((i) => i.courseCode)).not.toContain('DONE');
  });

  it('names the assessments the step still depends on', () => {
    expect(gpaImpactOf(rows)[0].remaining.join(' ')).toContain('FAT');
  });
});
