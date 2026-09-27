import { describe, it, expect } from 'vitest';
import { detectMismatches } from '../mismatch';
import { CourseMarks } from '../../../types';
import { LmsGradeItem } from '../types';

function vtopMarks(partial: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'MAT2002',
    courseTitle: 'Probability and Statistics',
    cat1: { scored: 18, max: 50, weightage: 15 },
    cat2: { scored: 20, max: 50, weightage: 15 },
    da1: { scored: 8, max: 10, weightage: 5 },
    da2: { scored: 7, max: 10, weightage: 5 },
    da3: { scored: 0, max: 0, weightage: 0 },
    quiz: { scored: 9, max: 10, weightage: 10 },
    fat: { max: 100, weightage: 40 },
    totalScoredSoFar: 40,
    currentEstimatedGrade: 'A',
    ...partial,
  };
}

function lmsItem(itemName: string, score: number | null, maxScore: number | null, pct: number | null = null): LmsGradeItem {
  return { itemName, itemType: 'unknown', score, maxScore, percentage: pct, feedback: null };
}

describe('detectMismatches', () => {
  it('flags a score divergence beyond tolerance', () => {
    const mismatches = detectMismatches([lmsItem('CAT 1', 15, 50)], vtopMarks());
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].component).toBe('CAT 1');
    expect(mismatches[0].lmsValue).toBe('15/50');
    expect(mismatches[0].vtopValue).toBe('18/50');
  });

  it('flags a max-marks difference even when scores are equal', () => {
    // LMS says 8/10 but VTOP says 8/8 — max marks differ, worth checking.
    const m = vtopMarks({ da1: { scored: 8, max: 8, weightage: 5 } });
    const mismatches = detectMismatches([lmsItem('Assignment 1 (DA 1)', 8, 10)], m);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].component).toBe('DA 1');
  });

  it('does NOT flag matching values', () => {
    expect(detectMismatches([lmsItem('CAT 2', 20, 50)], vtopMarks())).toHaveLength(0);
    expect(detectMismatches([lmsItem('Quiz 1', 9, 10)], vtopMarks())).toHaveLength(0);
  });

  it('ignores ungraded LMS items (null score) — never compares zeros', () => {
    expect(detectMismatches([lmsItem('CAT 1', null, 50)], vtopMarks())).toHaveLength(0);
  });

  it('ignores LMS items that match no VTOP component', () => {
    expect(detectMismatches([lmsItem('Final Project', 40, 50)], vtopMarks())).toHaveLength(0);
  });

  it('never auto-resolves — returns data for the student to check', () => {
    const mismatches = detectMismatches([lmsItem('CAT 1', 12, 50)], vtopMarks());
    expect(mismatches[0].detail).toContain('could be a sync delay or faculty entry error');
  });
});
