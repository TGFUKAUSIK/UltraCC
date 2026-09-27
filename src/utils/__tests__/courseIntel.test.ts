/**
 * courseIntel tests — pure analytics from real attendance + marks shapes.
 * Verifies the target arithmetic ("need ~X/Y in FAT for grade B") and the
 * honesty rules (pending components never counted as zero).
 */

import { describe, it, expect } from 'vitest';
import {
  buildCourseIntel, buildCourseIntelRows, evaluatedComponents,
  gradeForTotal, GRADE_BANDS,
} from '../courseIntel';
import { AttendanceRecord, CourseMarks } from '../../types';

function attendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    courseCode: 'CSE1001',
    courseTitle: 'Problem Solving',
    type: 'ETH',
    slot: 'A1',
    facultyName: 'Dr. X',
    attended: 20,
    totalHeld: 24,
    percentage: 83.3,
    category: 'Safe',
    lastUpdated: '2026-09-01',
    venue: 'SJT',
    ...overrides,
  };
}

function marks(overrides: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'CSE1001',
    courseTitle: 'Problem Solving',
    cat1: { scored: 20, max: 25, weightage: 15 },
    cat2: { scored: 18, max: 25, weightage: 15 },
    da1: { scored: 8, max: 10, weightage: 5 },
    da2: { scored: 0, max: 0, weightage: 5 },
    da3: { scored: 0, max: 0, weightage: 0 },
    quiz: { scored: 4, max: 5, weightage: 5 },
    fat: { max: 100, weightage: 40 },
    totalScoredSoFar: 50,
    currentEstimatedGrade: '',
    ...overrides,
  };
}

describe('gradeForTotal', () => {
  it('uses the same bands as the what-if simulator', () => {
    expect(GRADE_BANDS.map((b) => b.grade)).toEqual(['S', 'A', 'B', 'C', 'D', 'E', 'F']);
    expect(gradeForTotal(90)).toBe('S');
    expect(gradeForTotal(80)).toBe('A');
    expect(gradeForTotal(79.9)).toBe('B');
    expect(gradeForTotal(39)).toBe('F');
  });
});

describe('evaluatedComponents', () => {
  it('never treats pending components as zero', () => {
    const comps = evaluatedComponents(marks({ da2: { scored: 0, max: 0, weightage: 5 }, fat: { max: 100, weightage: 40 } }));
    expect(comps.map((c) => c.name)).toEqual(['CAT 1', 'CAT 2', 'DA 1', 'Quiz']);
  });

  it('includes FAT once evaluated', () => {
    const comps = evaluatedComponents(marks({ fat: { scored: 78, max: 100, weightage: 40 } }));
    expect(comps.some((c) => c.name === 'FAT')).toBe(true);
  });
});

describe('buildCourseIntel — target arithmetic', () => {
  it('computes weighted score from evaluated components only', () => {
    // 20/25*15 + 18/25*15 + 8/10*5 + 4/5*5 = 12 + 10.8 + 4 + 4 = 30.8
    const row = buildCourseIntel(attendance(), marks())!;
    expect(row.marks.weightedSoFar).toBeCloseTo(30.8, 5);
  });

  it('says exactly what FAT marks are needed for the target grade', () => {
    // Target B (70): needs 70 - 30.8 = 39.2 weight out of the pending 40.
    const row = buildCourseIntel(attendance(), marks(), 'B')!;
    expect(row.target?.weightNeeded).toBeCloseTo(39.2, 5);
    // FAT declared but ungraded → pending_final, never a false 'not achievable'.
    expect(row.target?.status).toBe('pending_final');
    expect(row.target?.pendingFat).toEqual({ max: 100, weightage: 40 });
    expect(row.target?.nextAssessment).toEqual({ name: 'FAT', raw: 98, max: 100 });
    expect(row.nextAction).toContain('98/100');
    expect(row.nextAction).toContain('B');
  });

  it('counts a declared-but-ungraded row as weight still available', () => {
    // Graded FAT (95/100 at weight 40) puts the total at 30.8 + 38 = 68.8 —
    // 1.2 short of B. DA 2 is declared at weightage 5 but VTOP has not graded
    // it, so the target is NOT closed: 5% of the course can still be earned.
    // (The old model read the unheld DA 2 as a scored zero and reported
    // not_achievable while an assessment was still to come.)
    const row = buildCourseIntel(
      attendance(),
      marks({ fat: { scored: 95, max: 100, weightage: 40 } }),
      'B',
    )!;
    expect(row.marks.weightedSoFar).toBeCloseTo(68.8, 5);
    expect(row.target?.weightRemaining).toBeCloseTo(5, 5);
    expect(row.target?.status).toBe('achievable');
    expect(row.marks.pending).toEqual([{ name: 'DA 2', weightage: 5 }]);
  });

  it('lists every ungraded row VTOP declared, at VTOP\'s own weightage', () => {
    // Live fresh-semester shape: CAT 2 / DA 2 / Quiz published as Pending rows
    // with real weightages, and no FAT declared at all.
    const row = buildCourseIntel(
      attendance(),
      marks({
        cat2: { scored: 0, max: 50, weightage: 15, status: 'Pending' },
        da2: { scored: 0, max: 10, weightage: 5, status: 'Pending' },
        quiz: { scored: 0, max: 10, weightage: 10, status: 'Pending' },
        fat: { scored: 0, max: 0, weightage: 0 },
      }),
    )!;
    expect(row.marks.pending).toEqual([
      { name: 'CAT 2', weightage: 15 },
      { name: 'DA 2', weightage: 5 },
      { name: 'Quiz', weightage: 10 },
    ]);
    expect(row.marks.weightRemaining).toBeCloseTo(30, 5);
    // The message names the open weight instead of blaming an undeclared FAT.
    expect(row.nextAction).toContain('30%');
    expect(row.nextAction).toContain('CAT 2');
  });

  it('flags achieved when the weighted total already covers the band', () => {
    const row = buildCourseIntel(
      attendance(),
      marks({
        cat1: { scored: 25, max: 25, weightage: 15 },
        cat2: { scored: 25, max: 25, weightage: 15 },
        da1: { scored: 10, max: 10, weightage: 5 },
        da2: { scored: 0, max: 0, weightage: 5 },
        quiz: { scored: 5, max: 5, weightage: 5 },
        fat: { scored: 90, max: 100, weightage: 40 },
      }),
      'B',
    )!;
    // 15+15+5+5+36 = 76 ≥ 70
    expect(row.target?.status).toBe('achieved');
  });
});

describe('buildCourseIntel — attendance risk', () => {
  it('reuses the safe-bunk arithmetic', () => {
    const row = buildCourseIntel(attendance({ attended: 20, totalHeld: 24 }), marks())!;
    expect(row.attendance.risk).toBe('safe');
    expect(row.attendance.safeBunks).toBe(2); // floor((100*20 - 75*24)/75) = floor(200/75) = 2
  });

  it('flags debar risk when below threshold', () => {
    const row = buildCourseIntel(attendance({ attended: 10, totalHeld: 20, percentage: 50 }), marks())!;
    expect(row.attendance.risk).toBe('risk');
    expect(row.attendance.mustAttend).toBeGreaterThan(0);
    expect(row.nextAction).toContain('attend');
  });
});

describe('buildCourseIntelRows — theory and lab are separate records', () => {
  it('keeps both components when VTOP files them under one course code', () => {
    const rows = buildCourseIntelRows(
      [
        attendance({ courseCode: 'CSE1001', type: 'ETH', slot: 'A1', attended: 20, totalHeld: 24, percentage: 83.3 }),
        attendance({ courseCode: 'CSE1001', type: 'ELA', slot: 'L31+L32', attended: 6, totalHeld: 12, percentage: 50 }),
      ],
      [marks({ courseCode: 'CSE1001' })],
    );
    // Previously the second row overwrote the first, so the theory half (and
    // the marks attached to it) vanished from course intelligence.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.component).sort()).toEqual(['Lab', 'Theory']);
    const labRow = rows.find((r) => r.component === 'Lab')!;
    expect(labRow.attendance.percentage).toBe(50);
    expect(labRow.attendance.risk).toBe('risk');
  });

  it('attaches assessment marks once, to the theory component', () => {
    const rows = buildCourseIntelRows(
      [
        attendance({ courseCode: 'CSE1001', type: 'ELA', slot: 'L31+L32' }),
        attendance({ courseCode: 'CSE1001', type: 'ETH', slot: 'A1' }),
      ],
      [marks({ courseCode: 'CSE1001' })],
    );
    const withMarks = rows.filter((r) => r.marks.evaluated.length > 0);
    expect(withMarks).toHaveLength(1);
    expect(withMarks[0].component).toBe('Theory');
  });

  it('labels a lab-suffixed code as the lab component even without an attendance type', () => {
    const [row] = buildCourseIntelRows(
      [attendance({ courseCode: 'CSE1001L', courseTitle: 'Problem Solving Lab', type: '' as AttendanceRecord['type'], slot: '' })],
      [],
    );
    expect(row.component).toBe('Lab');
  });

  it('still surfaces a course that only has marks', () => {
    const rows = buildCourseIntelRows([], [marks({ courseCode: 'CSE1001' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].courseCode).toBe('CSE1001');
    expect(rows[0].attendance.percentage).toBeNull();
  });
});

describe('buildCourseIntelRows', () => {
  it('merges attendance and marks per course and sorts risky first', () => {
    const rows = buildCourseIntelRows(
      [
        attendance({ courseCode: 'SAFE1', attended: 30, totalHeld: 30, percentage: 100 }),
        attendance({ courseCode: 'RISK1', attended: 8, totalHeld: 20, percentage: 40 }),
      ],
      [marks({ courseCode: 'RISK1' })],
    );
    expect(rows[0].courseCode).toBe('RISK1');
    expect(rows.find((r) => r.courseCode === 'SAFE1')).toBeTruthy();
  });

  it('returns nothing when there is no data', () => {
    expect(buildCourseIntelRows([], [])).toEqual([]);
    expect(buildCourseIntel(undefined, undefined)).toBeNull();
  });
});

describe('buildCourseIntel — missing FAT (VTOP has not declared the final exam)', () => {
  it('never claims not-achievable when the final exam is simply unknown', () => {
    // Live-observed fresh-semester shape: no FAT row at all from VTOP.
    const noFat = marks({ fat: { scored: 0, max: 0, weightage: 0 } });
    const row = buildCourseIntel(attendance(), noFat, 'B')!;
    expect(row.target?.status).toBe('awaiting_final');
    expect(row.nextAction).toMatch(/final exam isn't graded yet|stays open/i);
    expect(row.nextAction).not.toMatch(/isn't reachable|reconsider/i);
  });

  it('still reports genuinely closed targets when FAT is fully evaluated and short', () => {
    const gradedShort = marks({ fat: { scored: 10, max: 100, weightage: 40 } });
    const row = buildCourseIntel(attendance(), gradedShort, 'B')!;
    expect(row.target?.status).toBe('not_achievable');
  });
});

describe('buildCourseIntel — curriculum-aware marks', () => {
  it('lab courses weight Experiments + Lab FAT, never CAT/DA rows', () => {
    const labCourse = marks({
      courseCode: 'CSE1002L',
      courseTitle: 'Data Structures Lab',
      cat1: { scored: 0, max: 0, weightage: 0 },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { scored: 0, max: 100, weightage: 40 },
      extraComponents: [
        { title: 'Experiment 1', scored: 90, max: 100, weightage: 15, status: 'Evaluated' },
        { title: 'Experiment 2', scored: 80, max: 100, weightage: 15, status: 'Evaluated' },
      ],
    });
    const row = buildCourseIntel(attendance({ courseCode: 'CSE1002L' }), labCourse)!;
    // Curriculum resolved from the L-suffixed code: experiments (60) + lab FAT (40).
    expect(row.curriculum).toBe('lab');
    expect(row.schemeLabel).toContain('Lab');
    // 13.5 + 12 = 25.5 — weighted by the lab scheme, not the theory formula.
    expect(row.marks.weightedSoFar).toBeCloseTo(25.5, 5);
  });

  it('theory courses keep the CAT/DA/Quiz weighted total', () => {
    const row = buildCourseIntel(attendance(), marks(), 'B')!;
    expect(row.curriculum).toBe('theory');
    expect(row.marks.weightedSoFar).toBeCloseTo(30.8, 5);
  });

  it('unknown curriculum falls back to the raw weighted sum without a scheme', () => {
    // Genuinely undeterminable: no lab/project code signal, and only unmapped
    // assessment rows ("Assessment - 1") that match no curriculum signature.
    const mystery = marks({
      courseCode: 'XYZ9999',
      courseTitle: 'Mystery Course',
      cat1: { scored: 0, max: 0, weightage: 0 },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { scored: 0, max: 0, weightage: 0 },
      extraComponents: [
        { title: 'Assessment - 1', scored: 61.6, max: 100, weightage: 50, status: 'Evaluated' },
      ],
    });
    const row = buildCourseIntel(attendance({ courseCode: 'XYZ9999' }), mystery)!;
    expect(row.curriculum).toBe('unknown');
    expect(row.schemeLabel).toBe('Marking scheme unavailable');
    // Raw weighted sum of evaluated components is preserved — never fabricated.
    expect(row.marks.weightedSoFar).toBeCloseTo(30.8, 5);
  });

  it('a code-less course with the standard CAT/DA/Quiz row set resolves as theory', () => {
    // The standard component set at the standard weightages IS the theory
    // curriculum signature — data-driven, not fabricated.
    const row = buildCourseIntel(
      attendance({ courseCode: 'GEN1000' }),
      marks({ courseCode: 'GEN1000', courseTitle: 'General Course' }),
    )!;
    expect(row.curriculum).toBe('theory');
    expect(row.marks.weightedSoFar).toBeCloseTo(30.8, 5);
  });
});
