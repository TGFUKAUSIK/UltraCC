import { describe, expect, it } from 'vitest';
import { getCourseAcademicLabel, getInternalMarksRatio, getInternalMarksSummary } from '../internalMarks';

const empty = {
  cat1: { scored: 0, max: 0 },
  cat2: { scored: 0, max: 0 },
  da1: { scored: 0, max: 0 },
  da2: { scored: 0, max: 0 },
  quiz: { scored: 0, max: 0 },
};

describe('internal marks display', () => {
  it('shows recorded 29/30 and never infers a low grade', () => {
    const label = getCourseAcademicLabel({
      ...empty,
      cat1: { scored: 29, max: 30 },
      currentEstimatedGrade: 'Below C — internal marks need improvement',
    });
    expect(label).toBe('Internal: 29/30');
    expect(label).not.toContain('Below C');
  });

  it('does not warn for high internal marks', () => {
    const label = getInternalMarksSummary({
      ...empty,
      cat1: { scored: 30, max: 30 },
      cat2: { scored: 28, max: 30 },
    });
    expect(label).toBe('Internal: 58/60');
    expect(label).not.toContain('improvement');
  });

  it('does not treat incomplete marks as zero or a warning', () => {
    expect(getInternalMarksSummary(empty)).toBe('Internal marks not available');
    expect(getInternalMarksSummary(null)).toBe('Internal marks not available');
  });

  it('ignores legacy/mock course warning values when rendering a course label', () => {
    const label = getCourseAcademicLabel({
      ...empty,
      currentEstimatedGrade: 'Below C — internal marks need improvement',
    });
    expect(label).toBe('Internal marks not available');
    expect(label).not.toContain('Below C');
  });
});

/**
 * The internal figure is VTOP's weighted mark, not the raw cell sum. A 15-mark
 * CAT and a 5-mark DA were added as "42.5/60" before, which is not a figure in
 * the course's own weight space and disagreed with the grade the predictor
 * projected from the same rows.
 */
describe('internal marks on VTOP weights', () => {
  const weighted = {
    ...empty,
    // 42.5/50 of a 15-weight CAT = 12.75; 9/10 of a 5-weight DA = 4.5.
    cat1: { scored: 42.5, max: 50, weightage: 15 },
    da1: { scored: 9, max: 10, weightage: 5 },
  };

  it('prints the weighted mark over the graded internal weight', () => {
    expect(getInternalMarksSummary(weighted)).toBe('Internal: 17.25/20');
  });

  it('draws the bar against the same weighted fraction', () => {
    const ratio = getInternalMarksRatio(weighted);
    expect(ratio!.scored).toBeCloseTo(17.25, 6);
    expect(ratio!.max).toBe(20);
    expect(ratio!.percent).toBeCloseTo(86.25, 4);
  });

  it('holds ungraded weight out of the denominator, not in it as a zero', () => {
    const withPending = {
      ...weighted,
      cat2: { scored: 0, max: 50, weightage: 15, status: 'Pending' },
    };
    expect(getInternalMarksSummary(withPending)).toBe('Internal: 17.25/20');
  });

  it('counts rows beyond CAT/DA/Quiz (a lab experiment) and VTOP\'s own Weightage Mark', () => {
    const lab = {
      ...empty,
      quiz: { scored: 40, max: 50, weightage: 15, weightageMark: 10 },
      extraComponents: [
        { title: 'Experiment 1', scored: 18, max: 20, weightage: 15, status: 'Evaluated' },
      ],
      labFat: { scored: 0, max: 100, weightage: 40, status: 'Pending' },
    };
    // 10 (VTOP's weighted mark) + 18/20 × 15 = 23.5; the FAT is excluded.
    expect(getInternalMarksSummary(lab)).toBe('Internal: 23.5/30');
  });
});

/**
 * The card meter beside the "Internal: 25/50" label. The bar used to be the
 * attendance figure with no label of its own, so a full attendance bar read as
 * a full marks bar on a course where half the marks were held.
 */
describe('internal marks ratio', () => {
  it('is the fraction of what was actually held, matching the printed label', () => {
    const ratio = getInternalMarksRatio({ ...empty, cat1: { scored: 25, max: 50 } });
    expect(ratio).toEqual({ scored: 25, max: 50, percent: 50 });
  });

  it('sums the graded rows only', () => {
    const ratio = getInternalMarksRatio({
      ...empty,
      cat1: { scored: 42.5, max: 50 },
      da1: { scored: 4, max: 10 },
    });
    expect(ratio!.scored).toBeCloseTo(46.5, 6);
    expect(ratio!.max).toBe(60);
    expect(ratio!.percent).toBeCloseTo(77.5, 1);
  });

  it('never lets an ungraded row dilute the bar to zero', () => {
    const graded = { ...empty, cat1: { scored: 25, max: 50 } };
    const withPending = {
      ...graded,
      // VTOP serves CAT 2 before grading it: max 0, no status of its own.
      cat2: { scored: 0, max: 0, status: 'Pending' },
    };
    expect(getInternalMarksRatio(withPending)).toEqual({ scored: 25, max: 50, percent: 50 });
  });

  it('claims nothing when nothing has been graded', () => {
    expect(getInternalMarksRatio(empty)).toBeNull();
    expect(getInternalMarksRatio(null)).toBeNull();
    // A row with marks but no maximum held cannot be a percentage.
    expect(getInternalMarksRatio({ ...empty, cat1: { scored: 10, max: 0 } })).toBeNull();
  });

  it('stays inside 0-100 however VTOP publishes the row', () => {
    const over = getInternalMarksRatio({ ...empty, cat1: { scored: 55, max: 50 } });
    expect(over!.percent).toBe(100);
    // A negative figure is not a mark, so `evaluated` rejects the row rather
    // than letting it drag the bar below zero.
    expect(getInternalMarksRatio({ ...empty, cat1: { scored: -5, max: 50, status: 'Evaluated' } })).toBeNull();
  });
});
