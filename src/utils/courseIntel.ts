/**
 * courseIntel.ts — compact course-level analytics from data VTOP already
 * provides (attendance + assessment marks). All calculations reuse the
 * established models:
 *
 *   - attendance / safe bunks: calculateBunkStats (utils/nextActionEngine),
 *     against the student's saved target — the same number the Academics slider
 *     sets — so the two card sets on that screen can never disagree.
 *   - grade bands: the same 90/80/70/60/50/40 thresholds the what-if
 *     simulator uses (VTOP's standard weighted-total bands).
 *
 * Honesty: only EVALUATED assessment components count. Pending components
 * are never treated as zero, and targets are reported as achievable /
 * on-track / not achievable based on arithmetic — never invented grades.
 */

import { AttendanceRecord, CourseMarks } from '../types';
import { ATTENDANCE_TARGET_DEFAULT } from '../lib/settings';
import { calculateBunkStats } from './nextActionEngine';
import { curriculumAwareTotal, resolveMarkingScheme, type CourseKind } from './markingSchemes';
import { attendanceComponent, type AttendanceComponent } from './attendanceComponents';
import { isEvaluatedAssessment, pendingWeightage } from './assessmentStatus';
import { TARGET_SCORES, VIT_BANDS, buildCourseModel, gradeFromVitPercent, solveTargetFAT, weightedMarksFor } from './gradeModel';

export interface GradeBand {
  grade: string;
  min: number;
}

/**
 * VIT's bands, read from `gradeModel`.
 *
 * This module kept its own copy of the seven thresholds, which is how one
 * course could read as an A on these cards and a B on the predictor the same
 * second the bands changed in one place. The shape stays for the cards' own
 * dropdowns; the numbers are not owned here.
 */
export const GRADE_BANDS: GradeBand[] = VIT_BANDS.map(({ grade, min }) => ({ grade, min }));

export function gradeForTotal(total: number): string {
  return gradeFromVitPercent(total) ?? 'F';
}

interface EvaluatedComponent {
  scored: number;
  max: number;
  weightage: number;
  /** VTOP's own weighted mark for the row, when it served one. */
  weightageMark?: number;
  name: string;
}

/** Only components VTOP has actually evaluated (scored + max present). */
export function evaluatedComponents(marks: CourseMarks): EvaluatedComponent[] {
  const fixed: [string, CourseMarks['cat1'] | CourseMarks['cat2'] | CourseMarks['da1'] | CourseMarks['da2'] | CourseMarks['da3'] | CourseMarks['quiz'] | CourseMarks['fat']][] = [
    ['CAT 1', marks.cat1],
    ['CAT 2', marks.cat2],
    ['DA 1', marks.da1],
    ['DA 2', marks.da2],
    ['DA 3', marks.da3],
    ['Quiz', marks.quiz],
    ['FAT', marks.fat],
  ];
  const out: EvaluatedComponent[] = [];
  for (const [name, comp] of fixed) {
    // A row VTOP declared but has not graded is NOT a zero — it is excluded
    // here and counted as open weight by pendingComponents() instead.
    if (isEvaluatedAssessment(comp)) {
      out.push({ name, scored: comp!.scored as number, max: comp!.max as number, weightage: comp!.weightage, weightageMark: comp!.weightageMark });
    }
  }
  for (const extra of marks.extraComponents ?? []) {
    if (isEvaluatedAssessment(extra)) {
      out.push({ name: extra.title, scored: extra.scored, max: extra.max, weightage: extra.weightage, weightageMark: extra.weightageMark });
    }
  }
  return out;
}

/**
 * Components VTOP has declared but not graded yet, with the weight each one
 * still carries. This is the honest answer to "what is left?" — it comes from
 * VTOP's own rows and weightages, never from (100 - evaluated).
 */
export function pendingComponents(marks: CourseMarks): { name: string; weightage: number }[] {
  const fixed: [string, CourseMarks['cat1'] | CourseMarks['fat']][] = [
    ['CAT 1', marks.cat1],
    ['CAT 2', marks.cat2],
    ['DA 1', marks.da1],
    ['DA 2', marks.da2],
    ['DA 3', marks.da3],
    ['Quiz', marks.quiz],
    ['FAT', marks.fat],
  ];
  const out: { name: string; weightage: number }[] = [];
  for (const [name, comp] of fixed) {
    const weight = pendingWeightage(comp);
    if (weight > 0) out.push({ name, weightage: weight });
  }
  for (const extra of marks.extraComponents ?? []) {
    const weight = pendingWeightage(extra);
    if (weight > 0) out.push({ name: extra.title, weightage: weight });
  }
  return out;
}

export interface CourseIntel {
  courseCode: string;
  courseTitle: string;
  /**
   * Which VTOP component this row reports on. A course with an embedded lab
   * produces two rows (theory + lab), each with its own attendance figures.
   */
  component: AttendanceComponent;
  /**
   * The attendance bar these numbers were measured against — the student's own
   * target, not always VTOP's 75%. The card prints it so "3 safe bunks" cannot
   * be read as "3 bunks and still pass VTOP".
   */
  targetPercent: number;
  /** Course kind the marking scheme was resolved for ('unknown' = undetermined). */
  curriculum: CourseKind;
  /** Resolved scheme label ('Marking scheme unavailable' when undetermined). */
  schemeLabel: string;
  attendance: {
    attended: number;
    totalHeld: number;
    percentage: number | null;
    risk: 'safe' | 'borderline' | 'risk';
    safeBunks: number;
    mustAttend: number;
  };
  marks: {
    /** Weighted score accumulated so far (out of 100 total weight). */
    weightedSoFar: number;
    /** Weight still pending evaluation (FAT not yet held, etc.). */
    weightRemaining: number;
    evaluated: { name: string; scored: number; max: number; weightage: number }[];
    /** Declared-but-ungraded rows, with the weight each still carries. */
    pending: { name: string; weightage: number }[];
  };
  target: {
    grade: string;
    /** Weight still needed to reach the target band. */
    weightNeeded: number;
    /** Remaining weight available to earn it in. */
    weightRemaining: number;
    status: 'achieved' | 'on_track' | 'achievable' | 'not_achievable' | 'pending_final' | 'awaiting_final';
    /** Raw marks needed in the next pending assessment (null when none pending). */
    nextAssessment: { name: string; raw: number; max: number } | null;
    /** The pending FAT assessment, when VTOP has declared but not graded it. */
    pendingFat: { max: number; weightage: number } | null;
  } | null;
  nextAction: string;
}

export type TargetGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';

/**
 * Build the intelligence row for one course. `targetGrade` defaults to B and
 * `targetPercent` to VTOP's bar — the UI passes the student's own target from
 * the Academics slider, because these cards sit on the same screen as that
 * slider and a course cannot be "safe" here and "at risk" there.
 */
export function buildCourseIntel(
  attendance: AttendanceRecord | undefined,
  marks: CourseMarks | undefined,
  targetGrade: TargetGrade = 'B',
  targetPercent: number = ATTENDANCE_TARGET_DEFAULT,
  /** VTOP register number — its first two digits decide the theory/lab rule. */
  regNo?: string,
): CourseIntel | null {
  if (!attendance && !marks) return null;

  // --- Attendance (reuse the established safe-bunk arithmetic) ---
  const bunk = attendance
    ? calculateBunkStats(attendance, targetPercent)
    : null;
  const attRisk: CourseIntel['attendance']['risk'] = !bunk
    ? 'borderline'
    : bunk.state === 'on-target'
      ? bunk.safeToBunk
        ? 'safe'
        : 'borderline'
      : 'risk';

  // --- Marks ---
  const components = marks ? evaluatedComponents(marks) : [];
  const pending = marks ? pendingComponents(marks) : [];
  const weightedSoFar = marks
    // Curriculum-aware total: lab/project courses weight Experiments/Reviews
    // by their own schemes; unknown curricula keep the raw weighted sum.
    ? (curriculumAwareTotal(marks) ?? components.reduce((sum, c) => sum + weightedMarksFor(c), 0))
    : 0;

  // --- Target arithmetic ---
  let target: CourseIntel['target'] = null;
  if (marks && components.length > 0) {
    const targetMin = TARGET_SCORES[targetGrade];
    const weightNeeded = Math.max(0, targetMin - weightedSoFar);
    const remaining = weightRemainingTotal(marks);
    // The FAT VTOP has declared but not graded: this is the row the "score
    // ~X/100 in FAT" arithmetic needs, and it is identified by VTOP's own
    // status, not by a missing number (the parser reports 0 for ungraded).
    const pendingFat = !isEvaluatedAssessment(marks.fat) && (marks.fat?.weightage ?? 0) > 0 && (marks.fat?.max ?? 0) > 0
      ? marks.fat
      : null;
    // VTOP publishes the FAT row only when the final exam is declared. No FAT
    // info at all is UNKNOWN, not "nothing remains" — claiming not-achievable
    // from missing data is a false alarm (seen live on a fresh semester).
    const fatUnknown = (marks.fat?.max ?? 0) === 0 && (marks.fat?.weightage ?? 0) === 0;
    let status: CourseIntel['target']['status'];
    if (weightNeeded === 0) status = 'achieved';
    else if (pendingFat) status = 'pending_final';
    else if (fatUnknown) status = 'awaiting_final';
    else if (weightNeeded > remaining) status = 'not_achievable';
    else status = 'achievable';

    // The next pending assessment: FAT when unevaluated (the final one).
    //
    // How many marks that paper must carry is `solveTargetFAT`'s answer — the
    // same number the Grade Predictor and the Marks Simulator show for the same
    // target — and never less than VIT's 40%-of-FAT minimum. This module used to
    // divide the leftover weight by the FAT's weightage here, which asked a
    // student for 15/100 on a paper that fails them below 40, and for the whole
    // remaining need on a course whose other internals were still open.
    let nextAssessment: CourseIntel['target']['nextAssessment'] = null;
    if (pendingFat) {
      const solved = solveTargetFAT(buildCourseModel(marks, { regNo }), TARGET_SCORES[targetGrade]);
      if (!solved.isUnknown && solved.fatMax > 0) {
        const fromTarget = solved.isAlreadyAchieved ? 0 : (solved.requiredRaw ?? 0);
        const floor = Math.max(fromTarget, solved.vitFatMinimumRaw ?? 0);
        // A paper cannot be asked for more than it has, and VTOP's own marks are
        // whole numbers: round the ask up, never to a false decimal.
        const raw = Math.min(Math.ceil(floor - 1e-9), solved.fatMax);
        nextAssessment = { name: 'FAT', raw, max: solved.fatMax };
      }
    }
    target = { grade: targetGrade, weightNeeded, weightRemaining: remaining, status, nextAssessment, pendingFat: pendingFat ? { max: pendingFat.max, weightage: pendingFat.weightage } : null };
  }

  // --- One clear next action ---
  let nextAction: string;
  if (attRisk === 'risk' && bunk) {
    nextAction = bunk.message;
  } else if (target?.status === 'pending_final') {
    if (target.nextAssessment) {
      const { raw, max } = target.nextAssessment;
      nextAction = `Only the final exam remains. Score ~${raw}/${max} in FAT to reach ${target.grade}.`;
    } else {
      // No solve (nothing graded yet, or no FAT weight from VTOP): say what is
      // still owed in weight marks rather than inventing a paper score.
      nextAction = `Only the final exam remains, and ${Math.round(target.weightNeeded)} more weight marks are needed for ${target.grade}.`;
    }
  } else if (target?.status === 'awaiting_final') {
    // The final exam is not declared yet, so say what IS still open: VTOP's
    // own pending rows and the weight they carry. Blaming the FAT alone while
    // CAT 2 / DA / Quiz marks are missing reads as a wrong answer.
    const openWeight = Math.round(target.weightRemaining);
    const names = pending.map((p) => p.name);
    nextAction = openWeight > 0 && names.length > 0
      ? `${weightedSoFar.toFixed(1)}/100 so far, with ${openWeight}% of the course weight still ungraded (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}). The ${target.grade} target stays open until VTOP publishes those marks.`
      : `${weightedSoFar.toFixed(1)}/100 so far. The final exam isn't graded yet — the ${target.grade} target stays open until FAT marks arrive.`;
  } else if (target?.status === 'not_achievable') {
    nextAction = `Target ${target.grade} isn't reachable — ${weightedSoFar.toFixed(1)}/100 so far with no assessments left to raise it. Consider a target you can still reach.`;
  } else if (target?.nextAssessment) {
    nextAction = `You need ~${target.nextAssessment.raw}/${target.nextAssessment.max} in the ${target.nextAssessment.name} to stay on track for ${target.grade}.`;
  } else if (target?.status === 'achieved') {
    nextAction = `Weighted total already covers ${target.grade}. Hold attendance above ${targetPercent}% to keep it safe.`;
  } else if (attRisk === 'borderline') {
    nextAction = 'Attendance is borderline — attend the next classes before missing any.';
  } else if (bunk?.safeToBunk) {
    nextAction = `Attendance is safe (${bunk.canBunk} safe bunks). Focus on the next assessment.`;
  } else {
    nextAction = 'Sync VTOP to see attendance and marks intelligence for this course.';
  }

  const scheme = marks ? resolveMarkingScheme(marks) : null;
  return {
    courseCode: attendance?.courseCode ?? marks?.courseCode ?? '',
    courseTitle: attendance?.courseTitle ?? marks?.courseTitle ?? '',
    // The attendance row states the component outright; a marks-only course is
    // classified from its own code/title (VTOP's lab suffix), never guessed.
    component: attendanceComponent(
      attendance
        ?? { courseCode: marks?.courseCode ?? '', courseTitle: marks?.courseTitle ?? '', type: '' as AttendanceRecord['type'], slot: '' },
    ),
    targetPercent,
    curriculum: scheme?.kind ?? 'unknown',
    schemeLabel: scheme?.label ?? 'Marking scheme unavailable',
    attendance: {
      attended: attendance?.attended ?? 0,
      totalHeld: attendance?.totalHeld ?? 0,
      percentage: attendance && attendance.totalHeld > 0 ? attendance.percentage : null,
      risk: attRisk,
      safeBunks: bunk?.canBunk ?? 0,
      mustAttend: bunk?.mustAttend ?? 0,
    },
    marks: {
      weightedSoFar,
      weightRemaining: weightRemainingTotal(marks),
      evaluated: components.map((c) => ({ name: c.name, scored: c.scored, max: c.max, weightage: c.weightage })),
      pending,
    },
    target,
    nextAction,
  };
}

/**
 * Weight still pending evaluation: every row VTOP has declared but not graded,
 * each counted at the weightage VTOP itself published (CAT 2, DA 1/2, Quiz,
 * the FAT, plus lab Experiments / project Reviews).
 *
 * This deliberately does NOT use (100 - evaluated): that would assume
 * assessments VTOP may never have declared for this curriculum. A row with no
 * declared weight contributes nothing — unknown stays unknown.
 */
function weightRemainingTotal(marks: CourseMarks | undefined): number {
  if (!marks) return 0;
  return pendingComponents(marks).reduce((sum, c) => sum + c.weightage, 0);
}

/** Weight the target still needs (re-read from the target record). */
/** All courses with any intelligence signal, course-code aligned. */
export function buildCourseIntelRows(
  attendance: AttendanceRecord[],
  marks: CourseMarks[],
  targets: Record<string, TargetGrade> = {},
  /** The student's saved attendance bar, threaded from the Academics slider. */
  targetPercent: number = ATTENDANCE_TARGET_DEFAULT,
  /** VTOP register number — its first two digits decide the theory/lab rule. */
  regNo?: string,
): CourseIntel[] {
  const marksByCode = new Map<string, CourseMarks>();
  for (const mk of marks) marksByCode.set(mk.courseCode.toUpperCase(), mk);

  // One intel row per VTOP attendance record. A course's theory and lab halves
  // are separate records with separate conducted counts, so keying by course
  // code alone silently dropped one of them (last row overwrote the first).
  const rowsByCode = new Map<string, AttendanceRecord[]>();
  for (const att of attendance) {
    const key = att.courseCode.toUpperCase();
    const list = rowsByCode.get(key);
    if (list) list.push(att); else rowsByCode.set(key, [att]);
  }

  const rows: CourseIntel[] = [];
  for (const [code, list] of rowsByCode) {
    const mk = marksByCode.get(code);
    // Assessment marks belong to the COURSE, not to one component: attach them
    // once (to the theory row when a course has several) so the same weighted
    // total is never shown twice under two cards.
    const ownerIndex = Math.max(0, list.findIndex((a) => attendanceComponent(a) === 'Theory'));
    list.forEach((att, index) => {
      const row = buildCourseIntel(att, index === ownerIndex ? mk : undefined, targets[code] ?? 'B', targetPercent, regNo);
      if (row) rows.push(row);
    });
  }
  // Courses that only have marks so far (attendance not published yet).
  for (const [code, mk] of marksByCode) {
    if (rowsByCode.has(code)) continue;
    const row = buildCourseIntel(undefined, mk, targets[code] ?? 'B', targetPercent, regNo);
    if (row) rows.push(row);
  }
  // At-risk attendance first, then alphabetical.
  const riskRank = { risk: 0, borderline: 1, safe: 2 } as const;
  return rows.sort((a, b) => riskRank[a.attendance.risk] - riskRank[b.attendance.risk] || a.courseCode.localeCompare(b.courseCode));
}
