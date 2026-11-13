import { describe, it, expect } from 'vitest';
import { calculateAcademicHealth, calculateWeeklySummary } from '../academicHealth';
import { AttendanceRecord, TimetableSlot } from '../../types';

describe('academicHealth analytics', () => {
  it('handles empty / unsynced profile safely without throwing', () => {
    const health = calculateAcademicHealth(null, []);
    expect(health.score).toBeNull();
    expect(health.status).toBe('Insufficient Data');

    const summary = calculateWeeklySummary([]);
    expect(summary.totalSlots).toBe(0);
    expect(summary.busiestDay).toBeNull();
  });

  it('computes accurate composite academic health when CGPA and attendance are provided', () => {
    const attendance: AttendanceRecord[] = [
      {
        courseCode: 'CSE1001',
        courseTitle: 'Problem Solving and Programming',
        type: 'ETH',
        attended: 28,
        totalHeld: 30,
        percentage: 93.3,
        facultyName: 'Dr. Test',
        slot: 'A1',
        lastUpdated: '2026-03-01',
        venue: 'AB1-201',
      },
      {
        courseCode: 'MAT2001',
        courseTitle: 'Calculus',
        type: 'TH',
        attended: 24,
        totalHeld: 30,
        percentage: 80,
        facultyName: 'Dr. Math',
        slot: 'B1',
        lastUpdated: '2026-03-01',
        venue: 'AB1-202',
      },
    ];

    const health = calculateAcademicHealth(8.8, attendance);
    expect(health.score).toBeGreaterThan(80);
    expect(health.status).toBe('Excellent');
    expect(health.cgpaScore).toBe(88);
  });

  it('accurately identifies critical attendance debar risk in academic health', () => {
    const attendance: AttendanceRecord[] = [
      {
        courseCode: 'CSE1002',
        courseTitle: 'Data Structures',
        type: 'ETH',
        attended: 18,
        totalHeld: 30,
        percentage: 60,
        facultyName: 'Dr. Debar',
        slot: 'C1',
        lastUpdated: '2026-03-01',
        venue: 'AB1-203',
      },
    ];

    const health = calculateAcademicHealth(6.5, attendance);
    expect(health.score).toBeLessThan(75);
    expect(health.recommendations.some((r) => r.includes('under VTOP’s 75% line'))).toBe(true);
  });

  it('correctly calculates weekly load and identifies busiest day', () => {
    const slots: TimetableSlot[] = [
      { id: '1', courseCode: 'CSE1001', courseTitle: 'DSA', slot: 'A1', startTime: '08:00', endTime: '08:50', day: 'Monday', venue: 'AB1-201', building: 'AB1', roomNo: '201', facultyName: 'Dr. A', isLab: false },
      { id: '2', courseCode: 'CSE1001', courseTitle: 'DSA Lab', slot: 'L1+L2', startTime: '14:00', endTime: '15:40', day: 'Monday', venue: 'TT-101', building: 'Lab Block', roomNo: '101', facultyName: 'Dr. A', isLab: true },
      { id: '3', courseCode: 'MAT2001', courseTitle: 'Calculus', slot: 'B1', startTime: '09:00', endTime: '09:50', day: 'Tuesday', venue: 'AB1-202', building: 'AB1', roomNo: '202', facultyName: 'Dr. B', isLab: false },
    ];

    const summary = calculateWeeklySummary(slots);
    expect(summary.totalSlots).toBe(3);
    expect(summary.theorySlots).toBe(2);
    // The combined 2-period lab session counts its real 2-period load.
    expect(summary.labSlots).toBe(2);
    expect(summary.busiestDay?.day).toBe('Monday');
    expect(summary.busiestDay?.count).toBe(3); // theory period + 2 lab periods
    expect(summary.totalDaysWithClasses).toBe(2);
  });

  it('counts two independent lab sessions for different courses separately', () => {
    const slots: TimetableSlot[] = [
      { id: '1', courseCode: 'CSE1002', courseTitle: 'DS Lab', slot: 'L31+L32', startTime: '14:00', endTime: '15:40', day: 'Monday', venue: 'TT-101', building: 'Lab Block', roomNo: '101', facultyName: 'Dr. A', isLab: true },
      { id: '2', courseCode: 'CSE1003', courseTitle: 'OS Lab', slot: 'L33+L34', startTime: '15:50', endTime: '17:30', day: 'Monday', venue: 'TT-102', building: 'Lab Block', roomNo: '102', facultyName: 'Dr. B', isLab: true },
    ];
    const summary = calculateWeeklySummary(slots);
    expect(summary.totalSlots).toBe(2); // two class sessions
    expect(summary.labSlots).toBe(4); // four lab periods of load
  });

  it('normalizes marks over the weight VTOP graded, never an assumed 50', () => {
    const marks = [
      {
        courseCode: 'CSE1001',
        courseTitle: 'Theory Course',
        cat1: { scored: 25, max: 25, weightage: 15 },
        cat2: { scored: 20, max: 25, weightage: 15 },
        da1: { scored: 10, max: 10, weightage: 5 },
        da2: { scored: 10, max: 10, weightage: 5 },
        quiz: { scored: 5, max: 5, weightage: 10 },
        fat: { scored: 0, max: 0, weightage: 40 },
        extraComponents: [],
        totalScoredSoFar: 75,
        currentEstimatedGrade: '',
      },
      {
        courseCode: 'CSE1002L',
        courseTitle: 'Lab Course',
        cat1: { scored: 0, max: 0, weightage: 0 },
        cat2: { scored: 0, max: 0, weightage: 0 },
        da1: { scored: 0, max: 0, weightage: 0 },
        da2: { scored: 0, max: 0, weightage: 0 },
        quiz: { scored: 0, max: 0, weightage: 0 },
        fat: { scored: 0, max: 0, weightage: 0 },
        extraComponents: [
          { title: 'Experiment 1', scored: 90, max: 100, weightage: 20, status: 'Evaluated' },
          { title: 'Experiment 2', scored: 80, max: 100, weightage: 20, status: 'Evaluated' },
          { title: 'Experiment 3', scored: 0, max: 0, weightage: 0, status: 'Pending' },
        ],
        totalScoredSoFar: 34,
        currentEstimatedGrade: '',
      },
    ] as any[];
    const attendance = [{
      courseCode: 'CSE1001', courseTitle: 'Theory Course', type: 'ETH' as const, slot: 'A1',
      facultyName: 'Dr. T', attended: 30, totalHeld: 30, percentage: 100,
      lastUpdated: '2026-09-01', venue: 'SJT',
    }];
    const health = calculateAcademicHealth(null, attendance, marks);
    // Theory: 47 earned over the 50 weight VTOP graded → 94%.
    // Lab: 34 earned over its two graded 20-weight experiments → 85%.
    expect(health.marksScore).toBe(90);
    expect(health.score).not.toBeNull();
  });

  it('leaves out a course it cannot measure instead of dividing it by 50', () => {
    // The lab course is measurable: three experiments at 15 weight, 36 earned
    // out of 45 graded = 80%. The mystery course has no curriculum and no
    // declared weights, so it has no denominator — the old code still scored it
    // 20/50 = 40% and dragged the average to 60 off a number VTOP never gave.
    const lab = {
      courseCode: 'CSE1002L',
      courseTitle: 'Lab Course',
      cat1: { scored: 0, max: 0, weightage: 0 },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { scored: 0, max: 100, weightage: 40, status: 'Pending' },
      extraComponents: [
        { title: 'Experiment 1', scored: 90, max: 100, weightage: 15, status: 'Evaluated' },
        { title: 'Experiment 2', scored: 80, max: 100, weightage: 15, status: 'Evaluated' },
        { title: 'Experiment 3', scored: 70, max: 100, weightage: 15, status: 'Evaluated' },
      ],
      totalScoredSoFar: 36,
      currentEstimatedGrade: '',
    };
    const mystery = {
      courseCode: 'XYZ9999',
      courseTitle: 'Open Elective',
      cat1: { scored: 0, max: 0, weightage: 0 },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { scored: 0, max: 0, weightage: 0 },
      extraComponents: [{ title: 'Internal', scored: 20, max: 50, weightage: 0, status: 'Evaluated' }],
      totalScoredSoFar: 20,
      currentEstimatedGrade: '',
    };
    expect(calculateAcademicHealth(8, [], [lab] as any[]).marksScore).toBe(80);
    expect(calculateAcademicHealth(8, [], [lab, mystery] as any[]).marksScore).toBe(80);
    // Nothing measurable at all → no marks component, and the health index
    // composes from CGPA and attendance alone.
    expect(calculateAcademicHealth(8, [], [mystery] as any[]).marksScore).toBeNull();
  });

  it('stops reporting a perfect 100 the moment the FAT is graded', () => {
    // 36 earned over 45 graded experiment weight, then a 80/100 lab FAT worth
    // 40: earned 68 over weight 85 = 80%. The numerator used to take the FAT's
    // marks while the denominator refused its weight, reading 68/45 = 151% and
    // showing every post-FAT course as a flawless 100.
    const marks = [{
      courseCode: 'CSE1002L',
      courseTitle: 'Lab Course',
      cat1: { scored: 0, max: 0, weightage: 0 },
      cat2: { scored: 0, max: 0, weightage: 0 },
      da1: { scored: 0, max: 0, weightage: 0 },
      da2: { scored: 0, max: 0, weightage: 0 },
      quiz: { scored: 0, max: 0, weightage: 0 },
      fat: { scored: 80, max: 100, weightage: 40, status: 'Evaluated' },
      extraComponents: [
        { title: 'Experiment 1', scored: 90, max: 100, weightage: 15, status: 'Evaluated' },
        { title: 'Experiment 2', scored: 80, max: 100, weightage: 15, status: 'Evaluated' },
        { title: 'Experiment 3', scored: 70, max: 100, weightage: 15, status: 'Evaluated' },
      ],
      totalScoredSoFar: 68,
      currentEstimatedGrade: '',
    }];
    expect(calculateAcademicHealth(8, [], marks as any[]).marksScore).toBe(80);
  });
});

describe('academic health regressions', () => {
  const att = (courseCode: string, attended: number, totalHeld: number): AttendanceRecord => ({
    courseCode,
    courseTitle: `Course ${courseCode}`,
    type: 'ETH',
    slot: 'A1',
    facultyName: 'Dr. T',
    attended,
    totalHeld,
    percentage: totalHeld > 0 ? Math.round((attended / totalHeld) * 1000) / 10 : 0,
    lastUpdated: '2026-09-01',
    venue: 'SJT',
  });

  it('does not score an attendance sheet with no classes held as full marks', () => {
    // Semester just started: VTOP lists the courses but has held nothing yet.
    const health = calculateAcademicHealth(8.5, [att('CSE1001', 0, 0), att('MAT2001', 0, 0)]);
    expect(health.attendanceScore).toBeNull();
    // The empty sheet must not inflate the index above the CGPA-only value.
    expect(health.score).toEqual(calculateAcademicHealth(8.5, []).score);
  });

  it('aggregates attendance across real class counts, not a mean of percentages', () => {
    // 28/30 plus 1/2 is 29 attended out of 32 held = 91%, not the 72% an
    // unweighted average of the two course percentages produced.
    const health = calculateAcademicHealth(null, [att('CSE1001', 28, 30), att('MAT2001', 1, 2)]);
    expect(health.attendanceScore).toBe(91);
    expect(health.score).toBe(91);
  });

  it('flags a low-percentage course even when the aggregate is safe', () => {
    const health = calculateAcademicHealth(null, [att('CSE1001', 20, 30), att('MAT2001', 29, 30)]);
    expect(health.attendanceScore).toBe(82);
    expect(health.recommendations.some((r) => r.includes('under VTOP’s 75% line'))).toBe(true);
  });

  it('names one short component in the singular and two in the plural', () => {
    // A student reading this cannot count the rows, so the sentence has to agree
    // with the number it prints.
    expect(calculateAcademicHealth(null, [att('CSE1001', 20, 30)]).recommendations.join(' '))
      .toContain('One component is under VTOP’s 75% line (CSE1001 theory 66.7%)');
    expect(calculateAcademicHealth(null, [att('CSE1001', 20, 30), att('MAT2001', 20, 30)]).recommendations.join(' '))
      .toContain('2 components are under VTOP’s 75% line');
  });

  it('says what to do about a short component instead of only labelling it', () => {
    const alert = calculateAcademicHealth(null, [att('CSE1001', 20, 30)]).recommendations.join(' ');
    expect(alert).toMatch(/attend its next classes to get back above it\.$/);
    // The old sentence opened with "Attendance Alert:" — a log prefix, not advice.
    expect(alert).not.toMatch(/Attendance Alert/);
    expect(alert).not.toMatch(/mandatory threshold/i);
  });

  it('returns Insufficient Data instead of a fabricated zero when nothing is usable', () => {
    const health = calculateAcademicHealth(null, [att('CSE1001', 0, 0)]);
    expect(health.score).toBeNull();
    expect(health.status).toBe('Insufficient Data');
  });

  it('counts Sunday classes in the weekly load summary', () => {
    const sunday: TimetableSlot = {
      id: 'sun-a1', courseCode: 'CSE1001', courseTitle: 'PSL', slot: 'A1', facultyName: 'Dr. T',
      venue: 'SJT 201', building: 'SJT', roomNo: '201', day: 'Sunday', startTime: '08:00', endTime: '08:50', isLab: false,
    };
    const summary = calculateWeeklySummary([sunday]);
    expect(summary.daySlotCounts.Sunday).toBe(1);
    expect(summary.busiestDay).toEqual({ day: 'Sunday', count: 1 });
    expect(summary.totalDaysWithClasses).toBe(1);
  });
});
