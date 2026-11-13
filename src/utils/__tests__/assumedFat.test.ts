/**
 * A course whose FAT weight VTOP has not published yet is still answerable.
 *
 * Early in a semester VTOP publishes a course's internals (CAT 1 graded, CAT 2
 * and the DAs declared with their weightage) but no FAT row at all. On that data
 * the predictor's FAT slider moved nothing and the target solver refused every
 * question — "the simulator is not working". This pins the fix: the model takes
 * a FAT weight (VIT's published 40% final exam, or what is left of 100 when
 * VTOP's own internals already exceed 60%), appends a FAT row it marks
 * `assumed`, and solves from it — while a course whose FAT weight VTOP DID
 * publish is never touched, and a course with no published weight is still
 * honestly unanswerable.
 */

import { describe, it, expect } from 'vitest';
import type { CourseMarks } from '../../types';
import {
  DEFAULT_FAT_WEIGHT,
  buildCourseModel,
  hasDeclaredFat,
  impliedFatWeight,
  projectCoursePercent,
  solveTargetFAT,
  withAssumedFat,
} from '../gradeModel';

/**
 * VTOP has graded one internal (6/50 → a 12% pace) and declared the rest of the
 * internals, but serves no FAT row. This is the real shape a Semester-1 student
 * sees after the first CAT.
 */
function courseWithoutFat(over: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'BAEEE103',
    courseTitle: 'Analog Electronics',
    cat1: { scored: 6, max: 50, weightage: 15, status: 'Evaluated' },
    cat2: { scored: 0, max: 0, weightage: 15, status: 'Pending' },
    da1: { scored: 0, max: 0, weightage: 5, status: 'Pending' },
    da2: { scored: 0, max: 0, weightage: 5, status: 'Pending' },
    da3: { scored: 0, max: 0, weightage: 0, status: 'Pending' },
    quiz: { scored: 0, max: 0, weightage: 10, status: 'Pending' },
    fat: { scored: 0, max: 0, weightage: 0, status: 'Pending' },
    totalScoredSoFar: 0,
    currentEstimatedGrade: '',
    ...over,
  };
}

/** A course whose FAT VTOP did publish: the assumed path must leave it alone. */
function courseWithFat(): CourseMarks {
  return courseWithoutFat({ fat: { scored: 0, max: 100, weightage: 40, status: 'Pending' } });
}

describe('impliedFatWeight', () => {
  it('reads the FAT as what is left of 100 when VTOP\'s internals are the heavier share', () => {
    // 60% internals is VIT's standard split, and it happens to leave the same 40.
    expect(impliedFatWeight(60)).toEqual({ weight: 40, derived: true });
    // A heavier continuous scheme: what is left is a smaller final exam.
    expect(impliedFatWeight(70)).toEqual({ weight: 30, derived: true });
  });

  it('states VIT\'s published 40% final exam when the internals do not add up to 60', () => {
    // VIT's regulations: the FAT is 40% of a theory course. VTOP's declared
    // internals summing to 50 (a semester part-way through, or a cache that
    // missed an internal's weight) must not read as a 50%-weighted final exam.
    expect(impliedFatWeight(50)).toEqual({ weight: 40, derived: false });
    // One CAT published: "what is left" would be an absurd 85% FAT.
    expect(impliedFatWeight(15)).toEqual({ weight: DEFAULT_FAT_WEIGHT, derived: false });
    expect(impliedFatWeight(0)).toEqual({ weight: DEFAULT_FAT_WEIGHT, derived: false });
  });

  it('keeps VIT\'s published 40% as the default the model falls back to', () => {
    expect(DEFAULT_FAT_WEIGHT).toBe(40);
  });
});

describe('withAssumedFat', () => {
  it('adds a 100-mark FAT row VTOP never published, weighted at 40', () => {
    const base = buildCourseModel(courseWithoutFat());
    expect(base.configuredWeight).toBe(50);
    expect(hasDeclaredFat(base)).toBe(false);

    const model = withAssumedFat(base, DEFAULT_FAT_WEIGHT);
    expect(hasDeclaredFat(model)).toBe(true);
    // VTOP declared 50 of internals; VIT's published 40 for the FAT brings the
    // course to 90 of the 100 marks VTOP has weighted one way or another.
    expect(model.configuredWeight).toBe(90);
    const fat = model.parts.theory!.fat!;
    expect(fat.assumed).toBe(true);
    expect(fat.weightage).toBe(40);
    expect(fat.max).toBe(100);
    expect(fat.scored).toBeNull();
  });

  it('leaves a course whose FAT weight VTOP published exactly as it was', () => {
    const base = buildCourseModel(courseWithFat());
    expect(withAssumedFat(base, 40)).toBe(base);
  });

  it('is a no-op with no assumed weight, or with nothing to weight against', () => {
    const base = buildCourseModel(courseWithoutFat());
    expect(withAssumedFat(base, 0)).toBe(base);
    const unweighted = buildCourseModel(courseWithoutFat({
      cat1: { scored: 6, max: 50, weightage: 0, status: 'Evaluated' },
      cat2: { scored: 0, max: 0, weightage: 0, status: 'Pending' },
      da1: { scored: 0, max: 0, weightage: 0, status: 'Pending' },
      da2: { scored: 0, max: 0, weightage: 0, status: 'Pending' },
      quiz: { scored: 0, max: 0, weightage: 0, status: 'Pending' },
    }));
    expect(withAssumedFat(unweighted, 40)).toBe(unweighted);
  });

  it('makes the FAT score move the projection it never used to move', () => {
    const model = withAssumedFat(buildCourseModel(courseWithoutFat()), DEFAULT_FAT_WEIGHT);
    // Internals held at the 12% pace (6 of 50), the FAT worth 40 of the 90 the
    // model now weighs: FAT 0 → 6.7%, a perfect paper → 51.1%.
    expect(projectCoursePercent(model, { fatPercent: 0 })).toBeCloseTo(6.7, 1);
    expect(projectCoursePercent(model, { fatPercent: 100 })).toBeCloseTo(51.1, 1);
    expect(projectCoursePercent(model, { fatPercent: 60 })).toBeCloseTo(33.3, 1);
  });
});

describe('solveTargetFAT on an assumed FAT', () => {
  it('still refuses when nothing has been assumed', () => {
    // The guard the whole design rests on: VTOP published no FAT weight and the
    // caller assumed none, so there is no target to answer.
    const target = solveTargetFAT(buildCourseModel(courseWithoutFat()), 40);
    expect(target.isUnknown).toBe(true);
    expect(target.requiredRaw).toBeNull();
  });

  it('answers from the assumed weight and says the weight is assumed', () => {
    const model = withAssumedFat(buildCourseModel(courseWithoutFat()), DEFAULT_FAT_WEIGHT);
    const target = solveTargetFAT(model, 40);
    expect(target.isUnknown).toBe(false);
    expect(target.fatAssumed).toBe(true);
    expect(target.fatWeight).toBe(40);
    expect(target.fatMax).toBe(100);
    // Internals at a 12% pace, the FAT worth 40 of the 90 the model weighs: an
    // E (40) needs 75 of the 100-mark paper — and that clears VIT's 40% floor.
    expect(target.requiredRaw).toBeCloseTo(75, 0);
    expect(target.meetsVITMinimumCutoff).toBe(true);
    expect(target.message).toContain('Assuming the FAT is worth 40%');
  });

  it('does not call a published FAT weight assumed', () => {
    const target = solveTargetFAT(buildCourseModel(courseWithFat()), 60);
    expect(target.fatAssumed).toBe(false);
    expect(target.message).not.toContain('Assuming the FAT');
  });
});
