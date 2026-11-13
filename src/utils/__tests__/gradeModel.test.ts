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
  admissionYearOf,
  assessmentRowsOf,
  blendLabel,
  buildCourseModel,
  earnedOf,
  gradeFromVitPercent,
  passLineOf,
  projectCoursePercent,
  publishedMarksOf,
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

  it('puts a lab FAT served without a class into the lab half', () => {
    // Caches synced before VTOP's class column was captured still carry the
    // second FAT. It belongs to the lab by construction; defaulting it to
    // theory made the theory half claim a lab paper and left the lab empty.
    const rows = assessmentRowsOf(course({
      fat: { scored: 0, max: 100, weightage: 40, status: 'Pending' },
      labFat: { scored: 18, max: 50, weightage: 40, status: 'Evaluated' },
    }));
    expect(rows.find((r) => r.key === 'fat')!.part).toBe('T');
    expect(rows.find((r) => r.key === 'labfat')!.part).toBe('L');
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

  it('scores a what-if row above the mark VTOP posted for it', () => {
    const model = buildCourseModel(course());
    // Internals are at 35 of 50 graded weight, so the pace is 70 and the whole
    // course projects to 70. Putting CAT 1 at a perfect 20/20 earns 6 more of
    // the 90 declared weight; the FAT stays at the pace VTOP actually showed.
    expect(projectCoursePercent(model)).toBeCloseTo(70, 1);
    expect(projectCoursePercent(model, { rowPercents: { cat1: 100 } })).toBeCloseTo(76.67, 1);
    expect(projectCoursePercent(model, { rowPercents: { quiz: 0 } })).toBeCloseTo(62.22, 1);
  });

  it('holds the untouched rows at the pace, not at the fantasy', () => {
    // A slider is a claim about one paper. It must not quietly re-mark the
    // assessments the student never mentioned, or the total stops being the sum
    // of the rows on the screen.
    const model = buildCourseModel(course());
    const one = projectCoursePercent(model, { rowPercents: { cat1: 100 } });
    const two = projectCoursePercent(model, { rowPercents: { cat1: 100, da1: 100 } });
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    expect(one).toBeCloseTo(76.67, 1);
    expect(two).toBeCloseTo(77.22, 1);
  });

  it('answers a fully simulated semester even with nothing graded yet', () => {
    const empty = course({
      cat1: { scored: 0, max: 20, weightage: 15, status: 'Pending' },
      cat2: { scored: 0, max: 20, weightage: 15, status: 'Pending' },
      da1: { scored: 0, max: 10, weightage: 5, status: 'Pending' },
      da2: { scored: 0, max: 10, weightage: 5, status: 'Pending' },
      quiz: { scored: 0, max: 10, weightage: 10, status: 'Pending' },
    });
    const model = buildCourseModel(empty);
    const every = Object.fromEntries(model.parts.theory!.rows.map((r) => [r.key, 90]));
    expect(projectCoursePercent(model, { rowPercents: every })).toBeCloseTo(90, 1);
    // With one row left unassumed and no pace behind it, the honest answer is
    // "I don't know" — not a total built out of that row's invented zero.
    const { fat: _fat, ...allButFat } = every;
    expect(projectCoursePercent(model, { rowPercents: allButFat })).toBeNull();
  });
});

describe('the batch rule for an embedded course', () => {
  /** Theory and lab both published, 4 + 1 registered credits, the halves at 100% and 0%. */
  const embedded = (over: Partial<CourseMarks> = {}): CourseMarks => course({
    credits: 5, theoryCredits: 4, labCredits: 1,
    cat1: { scored: 40, max: 40, weightage: 100, status: 'Evaluated', part: 'T' },
    cat2: { scored: 0, max: 0, weightage: 0 },
    da1: { scored: 0, max: 0, weightage: 0 },
    da2: { scored: 0, max: 0, weightage: 0 },
    quiz: { scored: 0, max: 0, weightage: 0 },
    fat: { scored: 0, max: 0, weightage: 0 },
    labFat: { scored: 0, max: 100, weightage: 100, status: 'Evaluated', part: 'L' },
    ...over,
  });

  it('reads the admission year from the register number', () => {
    expect(admissionYearOf('25BEE0001')).toBe(2025);
    expect(admissionYearOf('21bce1234')).toBe(2021);
    expect(admissionYearOf('')).toBeNull();
    expect(admissionYearOf(null)).toBeNull();
  });

  it('combines a 2025 batch course as 75/25 whatever the credits say', () => {
    const current = buildCourseModel(embedded(), { regNo: '25BEE0001' });
    expect(current.blend).toEqual({ theory: 0.75, lab: 0.25, basis: 'regulation-2025' });
    // Theory 100%, lab 0%: 75 under the 2025 rule, not the 80 a 4 + 1 credit
    // ratio would give.
    expect(projectCoursePercent(current)).toBeCloseTo(75, 1);
    expect(projectCoursePercent(buildCourseModel(embedded(), { regNo: '24BEE1303' }))).toBeCloseTo(80, 1);
    expect(projectCoursePercent(buildCourseModel(embedded()))).toBeCloseTo(80, 1);
  });

  it('uses 75/25 even when the credits never synced', () => {
    const noCredits = embedded({ credits: undefined, theoryCredits: undefined, labCredits: undefined });
    const model = buildCourseModel(noCredits, { regNo: '25BEE0001' });
    expect(model.creditsUnknown).toBe(true);
    expect(projectCoursePercent(model)).toBeCloseTo(75, 1);
    // No batch and no credits is the even split the model always fell back to.
    expect(projectCoursePercent(buildCourseModel(noCredits))).toBeCloseTo(50, 1);
  });

  it('leaves a one-class course alone', () => {
    const model = buildCourseModel(course(), { regNo: '25BEE0001' });
    expect(model.blend).toEqual({ theory: 1, lab: 0, basis: 'single' });
    expect(blendLabel(model)).toBeNull();
  });

  it('names the rule it used', () => {
    expect(blendLabel(buildCourseModel(embedded(), { regNo: '25BEE0001' })))
      .toBe('theory 75% · lab 25% (2025 regulation)');
    expect(blendLabel(buildCourseModel(embedded())))
      .toBe('theory 80% · lab 20% by credits');
  });

  it('solves the FAT target on the batch blend, not the credit ratio', () => {
    // Theory internals 60 at 100%, an open 40-weight theory FAT, and a lab half
    // already graded at 0. 4 + 1 credits would make a perfect paper enough.
    const solver = embedded({
      cat1: { scored: 60, max: 60, weightage: 60, status: 'Evaluated', part: 'T' },
      fat: { scored: 0, max: 100, weightage: 40, status: 'Pending', part: 'T' },
    });
    const onCredits = solveTargetFAT(buildCourseModel(solver), 80);
    expect(onCredits.isAchievable).toBe(true);
    expect(onCredits.requiredRaw).toBeCloseTo(100, 1);
    const onBatch = solveTargetFAT(buildCourseModel(solver, { regNo: '25BEE0001' }), 80);
    expect(onBatch.isAchievable).toBe(false);
    expect(onBatch.feasibility).toBe('impossible');
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

  it('solves the target from the student\'s own what-ifs', () => {
    const model = buildCourseModel(course());
    // Internals at 35 of 50 leaves a 92.5 demanded of a 100-mark paper for a C…
    expect(solveTargetFAT(model, 80).requiredRaw).toBeCloseTo(92.5, 1);
    // …and the simulator telling them CAT 1 went perfectly must lower that
    // demand, not leave it on the old marks: 41 earned of 50 needs 77.5.
    const simulated = solveTargetFAT(model, 80, { rowPercents: { cat1: 100 } });
    expect(simulated.requiredRaw).toBeCloseTo(77.5, 1);
    // The paper being solved for is the answer, not an input: a slider left on
    // the FAT cannot make the solver hand back that slider's own value.
    expect(solveTargetFAT(model, 80, { rowPercents: { cat1: 100, fat: 0 } }).requiredRaw)
      .toBeCloseTo(77.5, 1);
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

describe('publishedMarksOf', () => {
  it('reads each class from the Weightage Mark VTOP printed', () => {
    const model = buildCourseModel(course());
    const marks = publishedMarksOf(model);
    expect(marks.courseTotal).toBeNull();
    expect(marks.lab).toBeNull();
    expect(marks.theory).toEqual({
      earned: 35,
      declared: 90,
      graded: 50,
      pending: 40,
      percent: 38.89,
      complete: false,
    });
  });

  it('keeps VTOP\'s grade-view total instead of a projection of our own', () => {
    expect(publishedMarksOf(buildCourseModel(course()), 62).courseTotal).toBe(62);
    expect(publishedMarksOf(buildCourseModel(course()), Number.NaN).courseTotal).toBeNull();
  });

  it('reports an embedded course\'s theory and lab halves apart', () => {
    const embedded = course({
      credits: 4, theoryCredits: 3, labCredits: 1,
      cat1: { scored: 15, max: 30, weightage: 60, status: 'Evaluated', part: 'T' },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { scored: 0, max: 100, weightage: 40, status: 'Pending', part: 'T' },
      labFat: { scored: 35, max: 50, weightage: 40, status: 'Evaluated', part: 'L' },
    });
    const marks = publishedMarksOf(buildCourseModel(embedded));
    expect(marks.theory).toEqual({
      earned: 30,
      declared: 100,
      graded: 60,
      pending: 40,
      percent: 30,
      complete: false,
    });
    // The lab's own Weightage Mark column: 35/50 of a 40-weight paper.
    expect(marks.lab).toEqual({
      earned: 28,
      declared: 40,
      graded: 40,
      pending: 0,
      percent: 70,
      complete: true,
    });
  });
});

describe('passLineOf', () => {
  it('asks for the 40% FAT floor when the 50% total needs less', () => {
    const line = passLineOf(buildCourseModel(course()));
    // Internals 35 of 50; a blank FAT leaves 38.9 and the 50% total would only
    // need 25 of the paper, so VIT's 40-mark floor is what binds.
    expect(line.state).toBe('needs');
    expect(line.requiredRaw).toBe(40);
    expect(line.floorRaw).toBe(40);
    expect(line.fatMax).toBe(100);
    expect(line.coursePercent).toBeCloseTo(38.89, 2);
    expect(line.message).toMatch(/40% FAT floor/);
  });

  it('says the course is secured when the internals already clear 50', () => {
    const full = course({
      cat1: { scored: 20, max: 20, weightage: 15, status: 'Evaluated' },
      cat2: { scored: 20, max: 20, weightage: 15, status: 'Evaluated' },
      da1: { scored: 10, max: 10, weightage: 5, status: 'Evaluated' },
      da2: { scored: 10, max: 10, weightage: 5, status: 'Evaluated' },
      quiz: { scored: 10, max: 10, weightage: 10, status: 'Evaluated' },
    });
    const line = passLineOf(buildCourseModel(full));
    expect(line.state).toBe('secured');
    expect(line.requiredRaw).toBe(40);
    expect(line.message).toMatch(/internals already clear 50/);
  });

  it('holds ungraded internals at zero rather than at the student\'s pace', () => {
    // CAT 2 is still unmarked: a pass must survive it scoring nothing, so the
    // marker may not borrow the pace the projection uses.
    const model = buildCourseModel(course({
      cat2: { scored: 0, max: 20, weightage: 15, status: 'Pending' },
    }));
    const line = passLineOf(model);
    expect(line.coursePercent).toBeCloseTo((35 - 10.5) / 90 * 100, 1);
    expect(line.state).toBe('needs');
    // 24.5 of 90 with a blank CAT 2 needs more than the floor: (50-27.2)/0.444.
    expect(line.requiredRaw).toBeCloseTo(51.25, 1);
  });

  it('says an impossible pass out loud instead of inventing a paper mark', () => {
    const failed = course({
      cat1: { scored: 0, max: 20, weightage: 15, status: 'Evaluated' },
      cat2: { scored: 0, max: 20, weightage: 15, status: 'Evaluated' },
      da1: { scored: 0, max: 10, weightage: 5, status: 'Evaluated' },
      da2: { scored: 0, max: 10, weightage: 5, status: 'Evaluated' },
      quiz: { scored: 0, max: 10, weightage: 10, status: 'Evaluated' },
    });
    const line = passLineOf(buildCourseModel(failed));
    // Internals are a scored zero; even a perfect 40-weight paper tops out at
    // (0 + 40) / 90 = 44.4, short of the 50% total.
    expect(line.state).toBe('impossible');
    expect(line.fatMax).toBe(100);
    expect(line.message).toMatch(/leaves the course short/);
  });

  it('reports a graded FAT as passed or failed, never as a target', () => {
    const passed = passLineOf(buildCourseModel(course({
      fat: { scored: 95, max: 100, weightage: 40, status: 'Evaluated' },
    })));
    expect(passed.state).toBe('passed');
    expect(passed.requiredRaw).toBeNull();
    expect(passed.message).toMatch(/FAT is graded/);

    const failed = passLineOf(buildCourseModel(course({
      fat: { scored: 0, max: 100, weightage: 40, status: 'Evaluated' },
    })));
    expect(failed.state).toBe('failed');
    expect(failed.requiredRaw).toBeNull();
  });

  it('lets VTOP\'s published grade decide the outcome', () => {
    const model = buildCourseModel(course());
    expect(passLineOf(model, { publishedGrade: 'B', publishedTotal: 78 })).toMatchObject({
      state: 'passed',
      publishedGrade: 'B',
      publishedTotal: 78,
      coursePercent: 78,
    });
    expect(passLineOf(model, { publishedGrade: 'f' }).state).toBe('failed');
    expect(passLineOf(model, { publishedGrade: '  ' }).state).not.toBe('passed');
  });

  it('uses the labelled 40% assumption when VTOP declared no FAT', () => {
    const line = passLineOf(buildCourseModel(course({ fat: { scored: 0, max: 0, weightage: 0 } })));
    expect(line.assumedFat).toBe(true);
    expect(line.fatMax).toBe(100);
    expect(line.state).toBe('needs');
    expect(line.requiredRaw).toBe(40);
  });

  it('refuses a pass line for a course with nothing published', () => {
    const empty = course({
      cat1: { scored: 0, max: 0, weightage: 0 },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      da3: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { scored: 0, max: 0, weightage: 0 },
    });
    const line = passLineOf(buildCourseModel(empty));
    expect(line.state).toBe('unknown');
    expect(line.requiredRaw).toBeNull();
    expect(line.fatMax).toBeNull();
    expect(line.message).toMatch(/not declared the final exam/);
  });

  it('solves the embedded course\'s theory paper across the batch blend', () => {
    const embedded = course({
      credits: 4, theoryCredits: 3, labCredits: 1,
      cat1: { scored: 15, max: 30, weightage: 60, status: 'Evaluated', part: 'T' },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { scored: 0, max: 100, weightage: 40, status: 'Pending', part: 'T' },
      labFat: { scored: 35, max: 50, weightage: 40, status: 'Evaluated', part: 'L' },
    });
    const line = passLineOf(buildCourseModel(embedded, { regNo: '25BEE0001' }));
    expect(line.fatMax).toBe(100);
    expect(line.floorRaw).toBe(40);
    expect(line.state).toBe('needs');
    expect(line.requiredRaw).toBe(40);
  });
});
