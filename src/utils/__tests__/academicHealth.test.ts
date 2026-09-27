import { describe, it, expect } from 'vitest';
import {
  calculateAcademicHealth,
  calculateExamPressure,
  calculateWeeklySummary,
} from '../academicHealth';
import { AttendanceRecord, ExamSchedule, TimetableSlot } from '../../types';

describe('academicHealth analytics', () => {
  it('handles empty / unsynced profile safely without throwing', () => {
    const health = calculateAcademicHealth(null, []);
    expect(health.score).toBeNull();
    expect(health.status).toBe('Insufficient Data');

    const pressure = calculateExamPressure([]);
    expect(pressure.totalExams).toBe(0);
    expect(pressure.pressureLevel).toBe('Relaxed');

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
        category: 'Safe',
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
        category: 'Safe',
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
        category: 'Critical',
        lastUpdated: '2026-03-01',
        venue: 'AB1-203',
      },
    ];

    const health = calculateAcademicHealth(6.5, attendance);
    expect(health.score).toBeLessThan(75);
    expect(health.recommendations.some((r) => r.includes('under 75%'))).toBe(true);
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

  it('normalizes marks per curriculum scheme (lab vs theory) and keeps legacy /50 when unknown', () => {
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
      facultyName: 'Dr. T', attended: 30, totalHeld: 30, percentage: 100, category: 'Safe' as const,
      lastUpdated: '2026-09-01', venue: 'SJT',
    }];
    const health = calculateAcademicHealth(null, attendance, marks);
    // Theory: 75/50 evaluated weight → 100% · Lab: 34/40 evaluated weight → 85%.
    expect(health.marksScore).toBe(90);
    expect(health.score).not.toBeNull();
  });

  it('evaluates exam density and pressure metrics', () => {
    const today = new Date();
    const d1 = new Date(today);
    d1.setDate(today.getDate() + 3);
    const d2 = new Date(today);
    d2.setDate(today.getDate() + 5);

    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;

    const exams: ExamSchedule[] = [
      { id: 'ex1', courseCode: 'CSE1001', courseTitle: 'DSA', date: fmt(d1), time: '10:00 AM', slot: 'A1', venue: 'AB1-101', seatNo: '12', examType: 'CAT 1', syllabusTopics: [], topicsCompleted: 0, studyPriority: 'High' },
      { id: 'ex2', courseCode: 'MAT2001', courseTitle: 'Calculus', date: fmt(d2), time: '02:00 PM', slot: 'B1', venue: 'AB1-102', seatNo: '14', examType: 'CAT 1', syllabusTopics: [], topicsCompleted: 0, studyPriority: 'Medium' },
    ];

    const pressure = calculateExamPressure(exams);
    expect(pressure.totalExams).toBe(2);
    expect(pressure.examsIn7Days).toBe(2);
    expect(pressure.pressureLevel).toBe('High');
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
    category: 'Safe',
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
    expect(health.recommendations.some((r) => r.includes('under 75%'))).toBe(true);
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
