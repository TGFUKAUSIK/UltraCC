/**
 * markingSchemes tests — curriculum-aware assessment model.
 *
 * Academic marking is curriculum-dependent: lab-only courses (experiments +
 * lab FAT at 60/40), theory courses (CAT/DA/Quiz + FAT), projects, and
 * soft-skill courses each have their own scheme. Unknown curricula must fall
 * back honestly — no rule is ever fabricated.
 */

import { describe, it, expect } from 'vitest';
import type { CourseMarks } from '../../types';
import {
  courseKind,
  resolveMarkingScheme,
  curriculumAwareTotal,
  evaluatedInternalWeight,
  schemeLabelFor,
  theoryScheme,
  labScheme,
  unknownScheme,
  isLabCourseType,
  isProjectCourseType,
} from '../markingSchemes';

function theoryMarks(overrides: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'CSE1001',
    courseTitle: 'Problem Solving and Programming',
    cat1: { scored: 40, max: 50, weightage: 15 },
    cat2: { scored: 30, max: 50, weightage: 15 },
    da1: { scored: 8, max: 10, weightage: 5 },
    da2: { scored: 7, max: 10, weightage: 5 },
    da3: { scored: 0, max: 0, weightage: 0 },
    quiz: { scored: 9, max: 10, weightage: 10 },
    fat: { scored: 0, max: 100, weightage: 40 },
    extraComponents: [],
    totalScoredSoFar: 37.8,
    currentEstimatedGrade: '',
    ...overrides,
  };
}

function labMarks(overrides: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'CSE1002L',
    courseTitle: 'Data Structures Lab',
    cat1: { scored: 0, max: 0, weightage: 0 },
    cat2: { scored: 0, max: 0, weightage: 0 },
    da1: { scored: 0, max: 0, weightage: 0 },
    da2: { scored: 0, max: 0, weightage: 0 },
    da3: { scored: 0, max: 0, weightage: 0 },
    quiz: { scored: 0, max: 0, weightage: 0 },
    fat: { scored: 0, max: 100, weightage: 40 },
    extraComponents: [
      { title: 'Experiment 1', scored: 90, max: 100, weightage: 15, status: 'Evaluated' },
      { title: 'Experiment 2', scored: 80, max: 100, weightage: 15, status: 'Evaluated' },
      { title: 'Experiment 3', scored: 70, max: 100, weightage: 15, status: 'Evaluated' },
      { title: 'Experiment 4', scored: 0, max: 100, weightage: 15, status: 'Pending' },
    ],
    totalScoredSoFar: 36,
    currentEstimatedGrade: '',
    ...overrides,
  };
}

describe('courseKind detection', () => {
  it('classifies lab courses from ELA type or L-suffixed codes', () => {
    expect(courseKind('ELA', 'CSE1002L')).toBe('lab');
    expect(courseKind('Lab Embedded', 'CSE1002L')).toBe('lab');
    expect(courseKind('', 'CSE2003L')).toBe('lab');
  });

  it('classifies theory courses and never invents a kind for empty data', () => {
    expect(courseKind('ETH', 'CSE1001')).toBe('theory');
    expect(courseKind('TH', 'MAT2001')).toBe('theory');
    expect(courseKind('', '', '')).toBe('unknown');
  });

  it('classifies project, soft-skill, and audit kinds', () => {
    expect(courseKind('EPJ', 'CSE4001')).toBe('project');
    expect(courseKind('PJT', 'CSE4002')).toBe('project');
    expect(courseKind('LO', 'MAT1001', 'Soft Skill - I')).toBe('softskill');
    expect(courseKind('Audit', 'OOP3001')).toBe('audit');
  });

  it('exposes the predicate helpers used by the data layer', () => {
    expect(isLabCourseType('ELA', 'CSE1002L')).toBe(true);
    expect(isLabCourseType('ETH', 'CSE1001')).toBe(false);
    expect(isProjectCourseType('EPJ', 'CSE4001')).toBe(true);
    expect(isProjectCourseType('ETH', 'CSE1001')).toBe(false);
  });
});

describe('resolveMarkingScheme — theory', () => {
  it('gives theory courses the CAT/DA/Quiz + FAT scheme', () => {
    const scheme = resolveMarkingScheme(theoryMarks());
    expect(scheme.kind).toBe('theory');
    expect(scheme.isFallback).toBe(false);
    expect(scheme.totalWeight).toBe(100);
    expect(scheme.components.map((c) => c.key)).toEqual(['cat1', 'cat2', 'da1', 'da2', 'da3', 'quiz', 'fat']);
    expect(scheme.components.find((c) => c.key === 'cat1')?.weightage).toBe(15);
    expect(scheme.components.find((c) => c.key === 'quiz')?.weightage).toBe(10);
    // DA 3's weight is observed from VTOP, never a hard-coded default, so the
    // internal total stays at the regulation 50 (CAT 30 + DA 10 + Quiz 10).
    expect(scheme.components.find((c) => c.key === 'da3')?.weightage).toBe(0);
    expect(scheme.components.find((c) => c.key === 'fat')?.weightage).toBe(40);
  });
});

describe('resolveMarkingScheme — lab', () => {
  it('gives lab-only courses the Experiments + Lab FAT scheme (60/40)', () => {
    const scheme = resolveMarkingScheme(labMarks());
    expect(scheme.kind).toBe('lab');
    expect(scheme.isFallback).toBe(false);
    // 4 experiments at 15 weight each = 60 continuous, + 40 lab FAT.
    expect(scheme.totalWeight).toBe(100);
    expect(scheme.components.filter((c) => c.key.startsWith('experiment')).map((c) => c.weightage)).toEqual([15, 15, 15, 15]);
    expect(scheme.components.some((c) => c.key === 'labfat')).toBe(true);
  });

  it('keeps the regulation 60/40 split for lab rows served with standard slots', () => {
    // Live shape: a lab course whose assessment rows still say CAT/Quiz —
    // the 60% continuous + 40% FAT split still applies.
    const scheme = resolveMarkingScheme(labMarks({ extraComponents: [] }));
    expect(scheme.kind).toBe('lab');
    expect(scheme.totalWeight).toBe(100);
    expect(scheme.components.map((c) => c.weightage)).toEqual([60, 40]);
  });
});

describe('curriculumAwareTotal', () => {
  it('theory: weighted CAT/DA/Quiz sum out of 100', () => {
    // 40/50*15 + 30/50*15 + 8/10*5 + 7/10*5 + 9/10*10 = 12+9+4+3.5+9 = 37.5
    expect(curriculumAwareTotal(theoryMarks())).toBeCloseTo(37.5, 2);
  });

  it('lab: experiments count by their own weights, FAT only when evaluated', () => {
    // (90+80+70)/100 * 15 each = 13.5 + 12 + 10.5 = 36; pending Exp 4 = 0.
    expect(curriculumAwareTotal(labMarks())).toBeCloseTo(36, 2);
  });

  it('lab: adds evaluated lab FAT weight when the final assessment is graded', () => {
    // 36 from experiments + 80/100 * 40 = 32 → 68.
    const withFat = labMarks({ fat: { scored: 80, max: 100, weightage: 40 } });
    expect(curriculumAwareTotal(withFat)).toBeCloseTo(68, 2);
  });

  it('project: reviews + project FAT by observed weights', () => {
    const project = labMarks({
      courseCode: 'CSE4001',
      courseTitle: 'Capstone Project',
      extraComponents: [
        { title: 'Project Review 1', scored: 80, max: 100, weightage: 20, status: 'Evaluated' },
        { title: 'Project Review 2', scored: 90, max: 100, weightage: 20, status: 'Evaluated' },
      ],
      fat: { scored: 70, max: 100, weightage: 40 },
    });
    expect(resolveMarkingScheme(project).kind).toBe('project');
    // 16 + 18 + 28 = 62
    expect(curriculumAwareTotal(project)).toBeCloseTo(62, 2);
  });

  it('returns null when nothing has been evaluated (never a fake 0)', () => {
    const pending = theoryMarks({
      cat1: { scored: 0, max: 0, weightage: 15 },
      cat2: { scored: 0, max: 0, weightage: 15 },
      da1: { scored: 0, max: 0, weightage: 5 },
      da2: { scored: 0, max: 0, weightage: 5 },
      quiz: { scored: 0, max: 0, weightage: 10 },
      fat: { scored: 0, max: 0, weightage: 40 },
      extraComponents: [],
    });
    expect(curriculumAwareTotal(pending)).toBeNull();
  });

  it('ignores a row VTOP declared but has not graded, even with a real max', () => {
    // The live fresh-semester shape: CAT 2 arrives as max 50 / weightage 15 /
    // scored 0 / status 'Pending'. The old `max > 0` gate folded it in as a
    // scored zero and reported 28.5 as though the exam had been failed.
    const partial = theoryMarks({ cat2: { scored: 0, max: 50, weightage: 15, status: 'Pending' } });
    expect(curriculumAwareTotal(partial)).toBeCloseTo(28.5, 2);
  });

  it('does not count a declared-but-ungraded FAT as an evaluated component', () => {
    // Only row VTOP has published is the FAT, and it is still Pending. There is
    // nothing graded yet, so the honest answer is null — not 0.
    const onlyPendingFat = theoryMarks({
      cat1: { scored: 0, max: 0, weightage: 15 },
      cat2: { scored: 0, max: 0, weightage: 15 },
      da1: { scored: 0, max: 0, weightage: 5 },
      da2: { scored: 0, max: 0, weightage: 5 },
      quiz: { scored: 0, max: 0, weightage: 10 },
      fat: { scored: 0, max: 100, weightage: 40, status: 'Pending' },
    });
    expect(curriculumAwareTotal(onlyPendingFat)).toBeNull();
  });

  it('still counts a graded zero, because that mark is real', () => {
    const absent = theoryMarks({ cat2: { scored: 0, max: 50, weightage: 15, status: 'Evaluated' } });
    // 37.5 - 9 (the CAT 2 contribution) = 28.5, reached by a different route:
    // an evaluated 0 is included, a pending row is not.
    expect(curriculumAwareTotal(absent)).toBeCloseTo(28.5, 2);
  });
});

describe('evaluatedInternalWeight', () => {
  it('sums only the internal weight VTOP has actually graded', () => {
    // CAT 15+15 + DA 5+5 + Quiz 10 = 50; the ungraded FAT is excluded.
    expect(evaluatedInternalWeight(theoryMarks())).toBe(50);
  });

  it('counts a third DA only when VTOP declares its weightage', () => {
    // No DA 3 row → the template must not inflate the denominator past 50.
    expect(evaluatedInternalWeight(theoryMarks())).toBe(50);
    const withDA3 = theoryMarks({ da3: { scored: 6, max: 10, weightage: 10 } });
    expect(evaluatedInternalWeight(withDA3)).toBe(60);
  });

  it('keeps lab pace on the graded experiment weight only', () => {
    // Exp 1–3 graded at 15 each = 45; pending Exp 4 (15) and the FAT are out.
    expect(evaluatedInternalWeight(labMarks())).toBe(45);
  });

  it('returns null when nothing internal has been graded', () => {
    expect(evaluatedInternalWeight(theoryMarks({
      cat1: { scored: 0, max: 0, weightage: 15 },
      cat2: { scored: 0, max: 0, weightage: 15 },
      da1: { scored: 0, max: 0, weightage: 5 },
      da2: { scored: 0, max: 0, weightage: 5 },
      quiz: { scored: 0, max: 0, weightage: 10 },
      fat: { scored: 0, max: 0, weightage: 40 },
    }))).toBeNull();
  });
});

describe('unknown / unsupported curriculum fallback', () => {
  it('returns the honest fallback scheme when the kind cannot be determined', () => {
    const scheme = resolveMarkingScheme({
      courseCode: 'XYZ9999',
      courseTitle: 'Mystery Course',
    } as CourseMarks);
    expect(scheme.isFallback).toBe(true);
    expect(scheme.kind).toBe('unknown');
    expect(scheme.components).toEqual([]);
    expect(scheme.totalWeight).toBe(0);
    expect(unknownScheme().label).toBe('Marking scheme unavailable');
  });

  it('a lab-suffixed code always resolves even when VTOP serves no rows', () => {
    // Determined from the curriculum (code/type), not from assessment rows.
    const scheme = resolveMarkingScheme(labMarks({ extraComponents: [], fat: { scored: 0, max: 0, weightage: 0 } }));
    expect(scheme.kind).toBe('lab');
    expect(scheme.isFallback).toBe(false);
  });

  it('schemeLabelFor reports availability honestly', () => {
    expect(schemeLabelFor(theoryMarks())).toContain('Theory');
    expect(schemeLabelFor(labMarks())).toContain('Lab');
    expect(schemeLabelFor({ courseCode: 'XYZ9999', courseTitle: 'Mystery' } as CourseMarks))
      .toBe('Marking scheme unavailable');
  });

  it('curriculumAwareTotal never applies a scheme to an unknown curriculum', () => {
    expect(curriculumAwareTotal({ courseCode: 'XYZ9999', courseTitle: 'Mystery' } as CourseMarks)).toBeNull();
  });

  it('the theory scheme factory is explicit about its curriculum', () => {
    expect(theoryScheme().kind).toBe('theory');
    expect(labScheme([15, 15, 15, 15]).totalWeight).toBe(100);
  });
});
