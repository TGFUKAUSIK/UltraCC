/**
 * The course-grade model, on VTOP's numbers.
 *
 * These pin the four behaviours the predictor got wrong before: weights taken
 * from a regulation split instead of VTOP's declared weightage, ungraded rows
 * counted as zeros, theory and lab blended as one pile with no credit weight,
 * and a FAT target solved without the theory/lab split.
 */

import { describe, it, expect } from 'vitest';
import type { CourseMarks } from '../../types';
import {
  assessmentRowsOf,
  buildCourseModel,
  earnedOf,
  gradeFromVitPercent,
  projectCoursePercent,
  solveTargetFAT,
} from '../gradeModel';

function course(over: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'CSE2008',
    courseTitle: 'Problem Solving and Programming',
    cat1: { scored: 12, max: 20, weightage: 15, status: 'Evaluated' },
    cat2: { scored: 14, max: 20, weightage: 15, status: 'Evaluated' },
    da1: { scored: 9, max: 10, weightage: 5, status: 'Evaluated' },
    da2: { scored: 8, max: 10, weightage: 5, status: 'Evaluated' },
    da3: { scored: 0, max: 0, weightage: 0, status: 'Pending' },
    quiz: { scored: 7, max: 10, weightage: 10, status: 'Evaluated' },
    fat: { scored: 0, max: 100, weightage: 40, status: 'Pending' },
    totalScoredSoFar: 0,
    currentEstimatedGrade: '',
    ...over,
  };
}

describe('assessmentRowsOf', () => {
  it('drops the placeholder rows VTOP never published', () => {
    const rows = assessmentRowsOf(course({
      cat2: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
    }));
    expect(rows.map((r) => r.key)).toEqual(['cat1', 'da1', 'quiz', 'fat']);
  });

  it('reads a status-less zero as ungraded, never as a scored zero', () => {
    const rows = assessmentRowsOf(course({ cat1: { scored: 0, max: 20, weightage: 15 } }));
    expect(rows.find((r) => r.key === 'cat1')!.scored).toBeNull();
  });

  it('keeps the lab FAT beside the theory FAT instead of overwriting it', () => {
    const rows = assessmentRowsOf(course({
      fat: { scored: 0, max: 100, weightage: 40, status: 'Pending', part: 'T' },
      labFat: { scored: 18, max: 50, weightage: 40, status: 'Evaluated', part: 'L' },
    }));
    const fats = rows.filter((r) => r.isFat);
    expect(fats.map((r) => r.key)).toEqual(['fat', 'labfat']);
    expect(fats.map((r) => r.part)).toEqual(['T', 'L']);
  });
});

describe('earnedOf', () => {
  it('prefers VTOP\'s own weighted mark over ours', () => {
    const row = assessmentRowsOf(course({
      cat1: { scored: 12, max: 20, weightage: 15, status: 'Evaluated', weightageMark: 8.25 },
    }))[0];
    // Ours would say 12/20*15 = 9; VTOP's column says 8.25.
    expect(earnedOf(row)).toBe(8.25);
  });

  it('clamps a VTOP weighted mark that exceeds the row weight', () => {
    const row = assessmentRowsOf(course({
      cat1: { scored: 12, max: 20, weightage: 15, status: 'Evaluated', weightageMark: 30 },
    }))[0];
    expect(earnedOf(row)).toBe(15);
  });
});

describe('buildCourseModel', () => {
  it('sums VTOP\'s declared weightage rather than assuming a 50/40/10 scheme', () => {
    const model = buildCourseModel(course());
    expect(model.configuredWeight).toBe(90);
    expect(model.parts.theory!.gradedWeight).toBe(50);
    expect(model.parts.theory!.pendingWeight).toBe(40);
    expect(model.weightsUndeclared).toBe(false);
  });

  it('reports credits as unknown when VTOP has not supplied them', () => {
    const model = buildCourseModel(course());
    expect(model.credits).toBeNull();
    expect(model.creditsUnknown).toBe(true);
  });

  it('carries VTOP\'s registered credits and flags an embedded course', () => {
    const model = buildCourseModel(course({
      credits: 4, theoryCredits: 3, labCredits: 1,
      labFat: { scored: 40, max: 50, weightage: 40, status: 'Evaluated', part: 'L' },
    }));
    expect(model.credits).toBe(4);
    expect(model.isEmbedded).toBe(true);
    expect(model.creditsUnknown).toBe(false);
  });
});

describe('projectCoursePercent', () => {
  it('holds an ungraded row at the student\'s pace, never at zero', () => {
    const failedFat = course({
      fat: { scored: 0, max: 100, weightage: 40, status: 'Evaluated' },
    });
    const pendingFat = course({
      fat: { scored: 0, max: 100, weightage: 40, status: 'Pending' },
    });
    // Internals sit at 35/50 = 70%, so an unheld FAT is projected at 70 too.
    expect(projectCoursePercent(buildCourseModel(pendingFat))).toBeCloseTo(70, 1);
    // A FAT actually scored 0 is a scored 0: (35 + 0) / 90.
    expect(projectCoursePercent(buildCourseModel(failedFat))).toBeCloseTo(38.9, 1);
  });

  it('lets the FAT assumption move only the FAT row', () => {
    const model = buildCourseModel(course());
    // internals 35 of 50 graded weight, FAT's declared 40 at the assumption.
    expect(projectCoursePercent(model, { fatPercent: 100 })).toBeCloseTo(83.33, 1);
    expect(projectCoursePercent(model, { fatPercent: 0 })).toBeCloseTo(38.89, 1);
  });

  it('scales a scheme VTOP has only partly declared', () => {
    // VTOP lists internals worth 50 and no FAT row yet: those 50 are the course.
    const model = buildCourseModel(course({
      fat: { scored: 0, max: 0, weightage: 0 },
    }));
    expect(projectCoursePercent(model)).toBeCloseTo(70, 1);
  });

  it('credit-weights theory and lab instead of blending their rows', () => {
    const split = course({
      credits: 4, theoryCredits: 3, labCredits: 1,
      cat1: { scored: 20, max: 20, weightage: 100, status: 'Evaluated', part: 'T' },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { scored: 0, max: 0, weightage: 0 },
      labFat: { scored: 0, max: 100, weightage: 100, status: 'Evaluated', part: 'L' },
    });
    const model = buildCourseModel(split);
    // (100 * 3 + 0 * 1) / 4 — not 100, and not the 50 an unweighted blend gives.
    expect(projectCoursePercent(model)).toBeCloseTo(75, 1);
  });

  it('returns null when nothing is graded and nothing is assumed', () => {
    const empty = course({
      cat1: { scored: 0, max: 20, weightage: 15, status: 'Pending' },
      cat2: { scored: 0, max: 20, weightage: 15, status: 'Pending' },
      da1: { scored: 0, max: 10, weightage: 5, status: 'Pending' },
      da2: { scored: 0, max: 10, weightage: 5, status: 'Pending' },
      quiz: { scored: 0, max: 10, weightage: 10, status: 'Pending' },
    });
    expect(projectCoursePercent(buildCourseModel(empty))).toBeNull();
  });
});

describe('gradeFromVitPercent', () => {
  it('uses VIT\'s absolute bands', () => {
    expect(gradeFromVitPercent(92)).toBe('S');
    expect(gradeFromVitPercent(90)).toBe('S');
    expect(gradeFromVitPercent(89.4)).toBe('A');
    expect(gradeFromVitPercent(40)).toBe('E');
    expect(gradeFromVitPercent(39.9)).toBe('F');
    expect(gradeFromVitPercent(null)).toBeNull();
  });
});

describe('solveTargetFAT', () => {
  it('solves on VTOP\'s declared FAT weight', () => {
    // internals 50 weight at 80% pace = 40 earned; FAT weighs 40 of 90.
    const model = buildCourseModel(course({
      cat1: { scored: 16, max: 20, weightage: 15, status: 'Evaluated' },
      cat2: { scored: 16, max: 20, weightage: 15, status: 'Evaluated' },
      da1: { scored: 8, max: 10, weightage: 5, status: 'Evaluated' },
      da2: { scored: 8, max: 10, weightage: 5, status: 'Evaluated' },
      quiz: { scored: 8, max: 10, weightage: 10, status: 'Evaluated' },
    }));
    const t = solveTargetFAT(model, 90);
    // Need 90 of 100 → this scheme must earn 81 of 90 → 41 more from a 40-weight
    // paper, which is more than a perfect 100-mark sheet can give at that weight.
    expect(t.fatWeight).toBe(40);
    expect(t.isAchievable).toBe(false);
    expect(t.feasibility).toBe('impossible');
  });

  it('says a target is already secured without demanding negative marks', () => {
    const model = buildCourseModel(course());
    // Even a blank paper leaves this course at 38.9%, so a D target (50) is not
    // yet secured but a 30 is: the answer must be 0, never a negative need.
    const t = solveTargetFAT(model, 30);
    expect(t.isAlreadyAchieved).toBe(true);
    expect(t.requiredRaw).toBe(0);
    expect(t.feasibility).toBe('secured');
  });

  it('treats a graded FAT as settled rather than solvable', () => {
    const model = buildCourseModel(course({
      fat: { scored: 95, max: 100, weightage: 40, status: 'Evaluated' },
    }));
    const t = solveTargetFAT(model, 90);
    expect(t.isUnknown).toBe(false);
    expect(t.isAlreadyAchieved).toBe(false);
    expect(t.feasibility).toBe('impossible');
    expect(t.message).toMatch(/already graded/i);
  });

  it('respects VTOP\'s 40%-of-FAT minimum alongside the target', () => {
    const model = buildCourseModel(course({
      cat1: { scored: 4, max: 20, weightage: 15, status: 'Evaluated' },
      cat2: { scored: 4, max: 20, weightage: 15, status: 'Evaluated' },
      da1: { scored: 2, max: 10, weightage: 5, status: 'Evaluated' },
      da2: { scored: 2, max: 10, weightage: 5, status: 'Evaluated' },
      quiz: { scored: 2, max: 10, weightage: 10, status: 'Evaluated' },
    }));
    // Internals earned 10 of 50 (a 20% pace); the course runs (10 + 0.4·FAT)/90.
    const pass = solveTargetFAT(model, 50);
    expect(pass.isAchievable).toBe(true);
    expect(pass.requiredRaw).toBeCloseTo(87.5, 1);
    expect(pass.vitFatMinimumRaw).toBe(40);
    expect(pass.meetsVITMinimumCutoff).toBe(true);
    expect(pass.feasibility).toBe('tough');
    // A target that needs less than the minimum is still not a pass.
    const low = solveTargetFAT(model, 15);
    expect(low.isAlreadyAchieved).toBe(false);
    expect(low.requiredRaw).toBeLessThan(low.vitFatMinimumRaw!);
    expect(low.meetsVITMinimumCutoff).toBe(false);
  });

  it('refuses to invent a FAT weight VTOP never declared', () => {
    const model = buildCourseModel(course({ fat: { scored: 0, max: 0, weightage: 0 } }));
    const t = solveTargetFAT(model, 90);
    expect(t.isUnknown).toBe(true);
    expect(t.fatDeclared).toBe(false);
    expect(t.requiredRaw).toBeNull();
  });

  it('solves the theory paper against its credit share of an embedded course', () => {
    // 3 + 1 credits; theory internals are 60 weight at 100%, lab internals 40
    // weight at 0%, and only the theory FAT is still open.
    const embedded = course({
      credits: 4, theoryCredits: 3, labCredits: 1,
      cat1: { scored: 30, max: 30, weightage: 60, status: 'Evaluated', part: 'T' },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { scored: 0, max: 100, weightage: 40, status: 'Pending', part: 'T' },
      labFat: { scored: 0, max: 50, weightage: 40, status: 'Evaluated', part: 'L' },
    });
    const t = solveTargetFAT(buildCourseModel(embedded), 80);
    expect(t.part).toBe('T');
    // Course = (theory% × 3 + lab% × 1) / 4 with the lab pinned at 0, so even a
    // perfect theory paper leaves the course at (100×3 + 0)/4 = 75.
    expect(t.isAchievable).toBe(false);
    const easy = solveTargetFAT(buildCourseModel(embedded), 60);
    // theory must reach 80% of its own class: 20 of the 40-weight FAT row's 40
    // weight, i.e. half of a 100-mark paper — not the 20 a naive solver asks for.
    expect(easy.isAchievable).toBe(true);
    expect(easy.requiredRaw).toBeCloseTo(50, 1);
  });
});
