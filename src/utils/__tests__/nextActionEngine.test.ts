import { describe, it, expect } from 'vitest';
import { calculateBunkStats, calculateNextAction } from '../nextActionEngine';
import { AttendanceRecord, TimetableSlot, ExamSchedule } from '../../types';

describe('calculateBunkStats', () => {
  it('computes safe bunks above the threshold', () => {
    const stats = calculateBunkStats({ attended: 28, totalHeld: 32, percentage: 87.5 } as AttendanceRecord, 75);
    expect(stats.safeToBunk).toBe(true);
    expect(stats.canBunk).toBeGreaterThan(0);
    // attended / (total + x) >= 0.75 -> x <= (28/0.75 - 32) = 5.33 -> 5
    expect(stats.canBunk).toBe(5);
  });

  it('computes classes that must be attended below the threshold', () => {
    const stats = calculateBunkStats({ attended: 20, totalHeld: 28, percentage: 71.4 } as AttendanceRecord, 75);
    expect(stats.status).toBe('Debarred Risk');
    expect(stats.safeToBunk).toBe(false);
    // (20 + x) / (28 + x) = 0.75 -> x = 4
    expect(stats.mustAttend).toBe(4);
  });

  it('reports borderline when no bunks are safe', () => {
    const stats = calculateBunkStats({ attended: 24, totalHeld: 32, percentage: 75 } as AttendanceRecord, 75);
    expect(stats.canBunk).toBe(0);
    expect(stats.message).toContain('BORDERLINE');
  });
});

describe('calculateNextAction', () => {
  const monday = new Date(2026, 7, 10, 10, 30); // Monday 2026-08-10 10:30
  const sunday = new Date(2026, 7, 16, 10, 30); // Sunday 2026-08-16

  const timetable: TimetableSlot[] = [
    {
      id: 't1', courseCode: 'CSE2001', courseTitle: 'DSA', slot: 'A1',
      facultyName: 'Dr. V', venue: 'SJT 204', building: 'SJT', roomNo: '204',
      day: 'Monday', startTime: '08:00', endTime: '08:50', isLab: false,
    },
    {
      id: 't2', courseCode: 'CSE2004', courseTitle: 'DBMS', slot: 'B1',
      facultyName: 'Prof. A', venue: 'SJT 308', building: 'SJT', roomNo: '308',
      day: 'Monday', startTime: '09:00', endTime: '09:50', isLab: false,
    },
    {
      id: 't3', courseCode: 'CSE2008', courseTitle: 'OS', slot: 'D1',
      facultyName: 'Dr. J', venue: 'SJT 112', building: 'SJT', roomNo: '112',
      day: 'Monday', startTime: '14:00', endTime: '14:50', isLab: false,
    },
  ];

  const attendance = [
    { courseCode: 'CSE2001', percentage: 87.5 } as AttendanceRecord,
    { courseCode: 'CSE2004', percentage: 76.6 } as AttendanceRecord,
    { courseCode: 'CSE2008', percentage: 71.4 } as AttendanceRecord,
  ];

  const exams: ExamSchedule[] = [
    {
      id: 'ex1', courseCode: 'MAT2002', courseTitle: 'DMGT', examType: 'CAT 2',
      date: '2026-08-18', time: '10:00 AM - 11:30 AM', venue: 'AB1 205', seatNo: 'R1',
      syllabusTopics: [], topicsCompleted: 0, studyPriority: 'High',
    },
  ];

  it('flags Exam Day when an exam is today', () => {
    const examToday = new Date(2026, 7, 18, 9, 0); // Tuesday 2026-08-18
    const state = calculateNextAction(timetable, attendance, exams, examToday);
    expect(state.currentStatus).toBe('Exam Day');
  });

  it('detects an active class at 10:30 (between the 08:00 and 09:00 classes -> free period)', () => {
    const state = calculateNextAction(timetable, attendance, exams, monday);
    // 10:30 is after both morning classes and before 14:00 -> upcoming D1
    expect(state.currentStatus).toBe('Upcoming Class');
    expect(state.title).toContain('CSE2008');
  });

  it('detects active class during a class window', () => {
    const atClass = new Date(2026, 7, 10, 8, 20);
    const state = calculateNextAction(timetable, attendance, exams, atClass);
    expect(state.currentStatus).toBe('Class Active');
    expect(state.title).toContain('CSE2001');
  });

  it('handles weekends as free', () => {
    const state = calculateNextAction(timetable, attendance, exams, sunday);
    expect(state.currentStatus).toBe('Evening Free');
  });
});
