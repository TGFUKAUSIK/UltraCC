import { AttendanceRecord, TimetableSlot, CourseMarks } from '../types';
import { ALL_WEEK_DAYS } from './timetableGrid';
import { sessionPeriodCount } from './labSessions';
import { curriculumAwareTotal, evaluatedWeight } from './markingSchemes';
import { attendanceComponent, componentLabel } from './attendanceComponents';
import { VTOP_ATTENDANCE_FLOOR, attendancePercentLabel } from './attendanceBands';

export interface AcademicHealthResult {
  score: number | null;
  status: 'Excellent' | 'Good' | 'Fair' | 'At Risk' | 'Critical' | 'Insufficient Data';
  color: string;
  summary: string;
  attendanceScore: number | null;
  cgpaScore: number | null;
  marksScore: number | null;
  recommendations: string[];
}

export interface WeeklySummaryResult {
  totalSlots: number;
  theorySlots: number;
  labSlots: number;
  busiestDay: { day: string; count: number } | null;
  lightestDay: { day: string; count: number } | null;
  daySlotCounts: Record<string, number>;
  totalDaysWithClasses: number;
}

export interface CourseHealthItem {
  courseCode: string;
  courseTitle: string;
  attendancePct: number;
  status: 'healthy' | 'warning' | 'danger';
  bunkAllowance: number;
  requiredClasses: number;
  internalScored: number | null;
}

/**
 * Calculates student academic health score (0-100) from genuine attendance, CGPA, and internal marks.
 * If data is unavailable, it gracefully scales available signals without fabricating placeholders.
 */
export function calculateAcademicHealth(
  cgpa: number | null | undefined,
  attendance: AttendanceRecord[],
  marks?: CourseMarks[]
): AcademicHealthResult {
  if ((!attendance || attendance.length === 0) && (cgpa === null || cgpa === undefined)) {
    return {
      score: null,
      status: 'Insufficient Data',
      color: 'text-zinc-500',
      summary: 'Sync VTOP data to calculate your academic health index.',
      attendanceScore: null,
      cgpaScore: null,
      marksScore: null,
      recommendations: ['Connect your VTOP account to see academic health insights.'],
    };
  }

  // 1. Attendance component (0-100). Null until at least one class has been
  // held — defaulting to 100 scored an empty attendance sheet as "Excellent".
  let attScore: number | null = null;
  const recommendations: string[] = [];

  if (attendance.length > 0) {
    const validAtt = attendance.filter((a) => a.totalHeld > 0);
    if (validAtt.length > 0) {
      const attended = validAtt.reduce((sum, a) => sum + a.attended, 0);
      const held = validAtt.reduce((sum, a) => sum + a.totalHeld, 0);
      attScore = Math.max(0, Math.min(100, (attended / held) * 100));
    }
    const criticalAtt = validAtt.filter((a) => a.percentage < VTOP_ATTENDANCE_FLOOR);
    if (criticalAtt.length > 0) {
      // Named per VTOP row: theory and lab are separate records, so the alert
      // says WHICH component is short instead of blaming the whole course.
      const worst = [...criticalAtt]
        .sort((a, b) => a.percentage - b.percentage)
        .slice(0, 3)
        .map((a) => `${a.courseCode} ${componentLabel(attendanceComponent(a)).toLowerCase()} ${attendancePercentLabel(a.percentage)}%`);
      recommendations.push(
        `${criticalAtt.length === 1 ? 'One component is' : `${criticalAtt.length} components are`} under VTOP’s ${VTOP_ATTENDANCE_FLOOR}% line (${worst.join(', ')}${criticalAtt.length > 3 ? ', …' : ''}) — attend ${criticalAtt.length === 1 ? 'its' : 'their'} next classes to get back above it.`
      );
    }
  }

  // 2. CGPA component (0-100)
  let cgpaScore: number | null = null;
  if (cgpa !== null && cgpa !== undefined && Number.isFinite(cgpa)) {
    cgpaScore = Math.max(0, Math.min(100, (cgpa / 10) * 100));
    if (cgpa >= 9.0) {
      recommendations.push('Outstanding CGPA! Eligible for 9-pointer attendance relaxation policy.');
    } else if (cgpa < 7.5) {
      recommendations.push('Target 8.0+ CGPA to maximize placement and intern shortlist eligibility.');
    }
  }

  // 3. Marks component (0-100)
  // Each course is normalised over the internal weight VTOP has actually
  // graded for THAT course — 45 earned out of a 60-weight lab internal is 75%,
  // not the 90% a "/50" assumption prints. A course with no observable
  // denominator (unknown curriculum, or rows VTOP never gave a weight for) is
  // left out entirely: the health index is an average of what can be measured,
  // and a guessed denominator is not a measurement. Its weight then falls away
  // — the composite renormalises over the components that did answer.
  let marksScore: number | null = null;
  if (marks && marks.length > 0) {
    const normalized: number[] = [];
    for (const m of marks) {
      if (!m.totalScoredSoFar || m.totalScoredSoFar <= 0) continue;
      const gradedWeight = evaluatedWeight(m);
      const curriculumTotal = curriculumAwareTotal(m);
      if (gradedWeight === null || curriculumTotal === null) continue;
      normalized.push(Math.min(100, (curriculumTotal / gradedWeight) * 100));
    }
    if (normalized.length > 0) {
      marksScore = normalized.reduce((s, v) => s + v, 0) / normalized.length;
    }
  }

  // Weighted composition
  let totalWeight = 0;
  let composite = 0;

  if (cgpaScore !== null) {
    composite += cgpaScore * 0.45;
    totalWeight += 0.45;
  }
  if (attScore !== null) {
    composite += attScore * 0.4;
    totalWeight += 0.4;
  }
  if (marksScore !== null) {
    composite += marksScore * 0.15;
    totalWeight += 0.15;
  }

  if (totalWeight === 0) {
    return {
      score: null,
      status: 'Insufficient Data',
      color: 'text-zinc-500',
      summary: 'No attendance, CGPA or marks data has been synced yet.',
      attendanceScore: null,
      cgpaScore: null,
      marksScore: null,
      recommendations: ['Sync VTOP data to calculate your academic health index.'],
    };
  }

  const finalScore = Math.round(composite / totalWeight);

  let status: AcademicHealthResult['status'] = 'Good';
  let color = 'text-emerald-400';
  let summary = 'Academic profile is on track.';

  if (finalScore >= 85) {
    status = 'Excellent';
    color = 'text-emerald-400';
    summary = 'Exceptional standing across attendance and grades.';
  } else if (finalScore >= 75) {
    status = 'Good';
    color = 'text-teal-400';
    summary = 'Stable academic performance. Maintain current attendance pace.';
  } else if (finalScore >= 60) {
    status = 'Fair';
    color = 'text-amber-400';
    summary = 'Moderate risk in attendance or grade benchmarks.';
  } else if (finalScore >= 45) {
    status = 'At Risk';
    color = 'text-orange-400';
    summary = 'Action required: attendance or coursework falling behind.';
  } else {
    status = 'Critical';
    color = 'text-rose-400';
    summary = 'Critical debar risk or severe grade deficit detected.';
  }

  return {
    score: finalScore,
    status,
    color,
    summary,
    attendanceScore: attScore !== null ? Math.round(attScore) : null,
    cgpaScore: cgpaScore !== null ? Math.round(cgpaScore) : null,
    marksScore: marksScore !== null ? Math.round(marksScore) : null,
    recommendations,
  };
}

/**
 * Summarizes the weekly academic load based on FFCS timetable sessions.
 *
 * Class sessions, not slot tokens, are counted: a 1-slot theory class adds 1
 * period; a 2-period lab session adds 2 periods but ONE class session (a lab
 * is one combined class, never two independent classes).
 */
export function calculateWeeklySummary(timetable: TimetableSlot[]): WeeklySummaryResult {
  const daySlotCounts: Record<string, number> = Object.fromEntries(
    ALL_WEEK_DAYS.map((day) => [day, 0]),
  );

  let theorySlots = 0;
  let labSlots = 0;

  for (const slot of timetable) {
    const day = slot.day;
    if (day && daySlotCounts[day] !== undefined) {
      // Sessions count once per day; lab periods add their real 2-period load.
      daySlotCounts[day] += sessionPeriodCount(slot);
    }
    if (slot.isLab || (slot.courseCode && slot.courseCode.endsWith('(L)'))) {
      labSlots += sessionPeriodCount(slot);
    } else {
      theorySlots++;
    }
  }

  const daysWithClasses = Object.entries(daySlotCounts).filter(([, count]) => count > 0);
  let busiestDay: { day: string; count: number } | null = null;
  let lightestDay: { day: string; count: number } | null = null;

  if (daysWithClasses.length > 0) {
    daysWithClasses.sort((a, b) => b[1] - a[1]);
    busiestDay = { day: daysWithClasses[0][0], count: daysWithClasses[0][1] };
    lightestDay = {
      day: daysWithClasses[daysWithClasses.length - 1][0],
      count: daysWithClasses[daysWithClasses.length - 1][1],
    };
  }

  return {
    totalSlots: timetable.length,
    theorySlots,
    labSlots,
    busiestDay,
    lightestDay,
    daySlotCounts,
    totalDaysWithClasses: daysWithClasses.length,
  };
}
