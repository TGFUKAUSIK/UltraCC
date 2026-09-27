import { describe, it, expect } from 'vitest';
import { projectedTotal, gradeFromScore, gradeProbabilities } from '../../../components/GradePredictor';
import { CourseMarks } from '../../../types';

function marks(partial: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'MAT2002',
    courseTitle: 'Probability and Statistics',
    cat1: { scored: 40, max: 50, weightage: 15 },
    cat2: { scored: 35, max: 50, weightage: 15 },
    da1: { scored: 8, max: 10, weightage: 5 },
    da2: { scored: 7, max: 10, weightage: 5 },
    da3: { scored: 0, max: 0, weightage: 0 },
    quiz: { scored: 9, max: 10, weightage: 10 },
    fat: { max: 100, weightage: 40 },
    totalScoredSoFar: 0,
    currentEstimatedGrade: 'A',
    ...partial,
  };
}

/**
 * The numbers below are VTOP's own: each row is weighted by the weightage the
 * record carries, an ungraded row is projected at the student's pace, and no
 * marks are reserved for attendance VTOP never published. They replace the
 * 50/40/10 regulation split this file used to pin, which made every projection
 * wrong by whatever the course actually weighed.
 */
describe('projectedTotal', () => {
  it("weights each row by VTOP's declared weightage and scales to that scheme", () => {
    // cat1 40/50*15=12; cat2 35/50*15=10.5; da1 8/10*5=4; da2 7/10*5=3.5; quiz 9/10*10=9
    // → 39 earned over 50 graded weight (a 78% pace). The FAT is ungraded, so the
    // slider's 50% fills its declared 40: (39 + 20) / 90 declared weight × 100.
    expect(projectedTotal(marks(), 50)).toBeCloseTo(65.56, 1);
  });

  it('counts the third digital assignment instead of dropping it', () => {
    // The base fixture leaves DA 3 unpublished (max 0). VIT actually publishes
    // three DAs; once DA 3 arrives it must move the projection, never vanish.
    const withDA3 = marks({ da3: { scored: 6, max: 10, weightage: 5 } });
    // cat1 12 + cat2 10.5 + da1 4 + da2 3.5 + da3 3 + quiz 9 = 42 earned over
    // 95 declared weight; the FAT slider's 50% fills its 40 → (42 + 20) / 95.
    expect(projectedTotal(withDA3, 50)).toBeCloseTo(65.26, 1);
    expect(projectedTotal(withDA3, 50)).not.toBeCloseTo(projectedTotal(marks(), 50), 1);
  });

  it('adds no attendance marks VTOP never published', () => {
    // VTOP declares 60 of internals and a 40-mark FAT, every row graded at half.
    const m = marks({
      cat1: { scored: 15, max: 30, weightage: 15, status: 'Evaluated' },
      cat2: { scored: 15, max: 30, weightage: 15, status: 'Evaluated' },
      da1: { scored: 5, max: 10, weightage: 10, status: 'Evaluated' },
      da2: { scored: 5, max: 10, weightage: 10, status: 'Evaluated' },
      quiz: { scored: 5, max: 10, weightage: 10, status: 'Evaluated' },
      fat: { scored: 50, max: 100, weightage: 40, status: 'Evaluated' },
    });
    // Every row sits at 50%, so the course is at 50 — not the 55 the old formula
    // produced by handing out 10 free attendance marks.
    expect(projectedTotal(m, 0)).toBeCloseTo(50, 1);
  });

  it('clamps FAT to 100 and never exceeds 100', () => {
    expect(projectedTotal(marks(), 120)).toBeLessThanOrEqual(100);
    expect(projectedTotal(marks(), -10)).toBeGreaterThanOrEqual(0);
    // A perfect paper lands on the ceiling the declared scheme allows.
    expect(projectedTotal(marks(), 100)).toBeCloseTo(87.78, 1);
  });

  it('handles missing components as 0 (never NaN)', () => {
    const m = marks();
    m.cat1 = { scored: 0, max: 0, weightage: 15 };
    expect(Number.isFinite(projectedTotal(m, 60))).toBe(true);
  });

  it("projects an assessment VTOP has not graded at the student's pace, not zero", () => {
    // CAT 2 arrives from VTOP as a real row (max 50, weightage 15) with status
    // 'Pending' and scored 0. Reading that as a zero put the projection below a
    // student who actually failed the exam — it assumed a paper never held.
    const pending = marks({ cat2: { scored: 0, max: 50, weightage: 15, status: 'Pending' } });
    // graded internals 28.5 over 35 weight = an 81.43% pace; the pending CAT 2
    // joins at that pace and the FAT at the slider's 50%:
    // (28.5 + 12.21 + 20) / 90 × 100
    expect(projectedTotal(pending, 50)).toBeCloseTo(67.46, 1);
    // A graded zero is still a graded zero — that one must count.
    const gradedZero = marks({ cat2: { scored: 0, max: 50, weightage: 15, status: 'Evaluated' } });
    expect(projectedTotal(gradedZero, 50)).toBeCloseTo(53.89, 1);
    expect(projectedTotal(pending, 50)).toBeGreaterThan(projectedTotal(gradedZero, 50));
  });

  it('reports nothing when VTOP has published no weightage at all', () => {
    const blank = marks({
      cat1: { scored: 0, max: 0, weightage: 0 },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { max: 0, weightage: 0 },
    });
    expect(projectedTotal(blank, 80)).toBe(0);
  });
});

describe('gradeFromScore', () => {
  it('maps to the community cutoff bands', () => {
    expect(gradeFromScore(80, 58, 12)).toBe('S'); // z = 1.83
    expect(gradeFromScore(72, 58, 12)).toBe('A'); // z = 1.17
    expect(gradeFromScore(64, 58, 12)).toBe('B'); // z = 0.5
    expect(gradeFromScore(58, 58, 12)).toBe('C'); // z = 0
    expect(gradeFromScore(46, 58, 12)).toBe('D'); // z = -1.0 (D band: -1.0..-0.5)
    expect(gradeFromScore(40, 58, 12)).toBe('E'); // z = -1.5 (E band: -1.5..-1.0)
    expect(gradeFromScore(30, 58, 12)).toBe('F'); // z = -2.33
  });
});

describe('gradeProbabilities', () => {
  it('produces a distribution summing to 1', () => {
    const probs = gradeProbabilities(60, 58, 12);
    const sum = Object.values(probs).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it('peaks near the middle grade for a mean-centered score', () => {
    const probs = gradeProbabilities(58, 58, 12);
    expect(probs.C).toBeGreaterThan(probs.S);
    expect(probs.C).toBeGreaterThan(probs.F);
  });

  it('favors top grades for a far-above-mean score', () => {
    const probs = gradeProbabilities(95, 58, 12);
    expect(probs.S).toBeGreaterThan(0.9);
  });
});
