import { describe, it, expect } from 'vitest';
import { examStartMs, countdownLabel, isSameIstDay, istDateLabel, istTodayStartMs, nextUpcomingExam, enrichExamsWithCourses } from '../examUtils';
import { ExamSchedule } from '../../types';
import { ExamRecord, TimetableSlot } from '../../lib/vtop/types';

const exam = (overrides: Partial<ExamSchedule>): ExamSchedule => ({
  id: 'ex1',
  courseCode: 'CSE2001',
  courseTitle: 'Data Structures',
  examType: 'CAT 2',
  date: '2026-08-18',
  time: '10:00 AM - 11:30 AM',
  venue: 'SJT 402',
  seatNo: 'Row 3, Desk 12',
  syllabusTopics: [],
  topicsCompleted: 0,
  studyPriority: 'High',
  ...overrides,
});

describe('examStartMs', () => {
  it('interprets VTOP dates as Asia/Kolkata (UTC+05:30)', () => {
    // 2026-08-18 10:00 AM IST == 2026-08-18 04:30 UTC
    const ms = examStartMs('2026-08-18', '10:00 AM - 11:30 AM')!;
    expect(ms).toBe(Date.UTC(2026, 7, 18, 4, 30));
  });

  it('handles 12-hour PM and plain 24-hour times', () => {
    expect(examStartMs('2026-08-18', '02:00 PM - 03:30 PM')).toBe(Date.UTC(2026, 7, 18, 8, 30));
    expect(examStartMs('2026-08-18', '14:00-15:40')).toBe(Date.UTC(2026, 7, 18, 8, 30));
  });

  it('defaults to start of IST day when no time is given', () => {
    expect(examStartMs('2026-08-18', '')).toBe(Date.UTC(2026, 7, 17, 18, 30));
  });

  it('returns null for unparseable dates', () => {
    expect(examStartMs('', '10:00 AM')).toBeNull();
    expect(examStartMs('not-a-date', '10:00 AM')).toBeNull();
  });
});

describe('countdownLabel', () => {
  const now = Date.UTC(2026, 7, 10, 0, 0);
  it('labels days, hours and minutes', () => {
    expect(countdownLabel(now + 8 * 86400000, now)).toBe('8 days');
    expect(countdownLabel(now + 3 * 3600000 + 20 * 60000, now)).toBe('3h 20m');
    expect(countdownLabel(now + 45 * 60000, now)).toBe('45m');
    expect(countdownLabel(now - 1000, now)).toBe('Today');
  });
});

describe('nextUpcomingExam', () => {
  const now = Date.UTC(2026, 7, 10, 0, 0); // 2026-08-10

  it('picks the earliest future exam chronologically, not the first in the list', () => {
    const exams = [
      exam({ id: 'later', courseCode: 'MAT2002', date: '2026-08-21', time: '10:00 AM' }),
      exam({ id: 'sooner', courseCode: 'CSE2004', date: '2026-08-12', time: '09:00 AM' }),
      exam({ id: 'past', courseCode: 'EEE1001', date: '2026-08-01', time: '09:00 AM' }),
    ];
    const next = nextUpcomingExam(exams, now);
    expect(next?.exam.id).toBe('sooner');
    expect(next?.countdown).toBe('2 days');
  });

  it('returns null when every exam is in the past or unparseable', () => {
    expect(nextUpcomingExam([exam({ date: '2026-08-01' })], now)).toBeNull();
    expect(nextUpcomingExam([exam({ date: '' })], now)).toBeNull();
    expect(nextUpcomingExam([], now)).toBeNull();
  });
});

describe('enrichExamsWithCourses', () => {
  const timetable: TimetableSlot[] = [
    { id: 't1', slot: 'A1', courseCode: 'CSE2001', courseTitle: 'Data Structures', courseType: 'ETH', facultyName: 'Dr. X', venue: 'SJT 204', building: '', startTime: '08:00', endTime: '08:50', day: 'Monday' },
    { id: 't2', slot: 'B1', courseCode: 'CSE2004', courseTitle: 'DBMS', courseType: 'ETH', facultyName: 'Prof. Y', venue: 'SJT 308', building: '', startTime: '09:00', endTime: '09:50', day: 'Monday' },
  ];

  it('fills courseCode/title by slot when the exam page lacks them', () => {
    const exams: ExamRecord[] = [
      { id: 'ex1', slot: 'A1', courseCode: '', courseTitle: '', examType: 'CAT 2', date: '2026-08-18', time: '10:00 AM - 11:30 AM', venue: 'SJT 402', seatNo: '', syllabusTopics: [] },
    ];
    const enriched = enrichExamsWithCourses(exams, timetable);
    expect(enriched[0].courseCode).toBe('CSE2001');
    expect(enriched[0].courseTitle).toBe('Data Structures');
  });

  it('leaves exams untouched when no slot matches (never guesses)', () => {
    const exams: ExamRecord[] = [
      { id: 'ex1', slot: 'Z9', courseCode: '', courseTitle: '', examType: 'FAT', date: '2026-09-01', time: '09:00 AM - 12:00 PM', venue: '', seatNo: '', syllabusTopics: [] },
    ];
    const enriched = enrichExamsWithCourses(exams, timetable);
    expect(enriched[0].courseCode).toBe('');
    expect(enriched[0].courseTitle).toBe('');
  });

  it('keeps explicit course codes from the source', () => {
    const exams: ExamRecord[] = [
      { id: 'ex1', slot: 'A1', courseCode: 'CSE2001', courseTitle: 'Data Structures', examType: 'CAT 2', date: '2026-08-18', time: '10:00 AM - 11:30 AM', venue: 'SJT 402', seatNo: '', syllabusTopics: [] },
    ];
    const enriched = enrichExamsWithCourses(exams, timetable);
    expect(enriched[0].courseCode).toBe('CSE2001');
  });
});

describe('istDateLabel / isSameIstDay', () => {
  it('reports the India calendar day, not the device or UTC day', () => {
    // 23:00 UTC on 20 Aug is already 04:30 IST on 21 Aug.
    expect(istDateLabel(new Date(Date.UTC(2026, 7, 20, 23, 0)))).toBe('2026-08-21');
    // 18:00 UTC on 20 Aug is 23:30 IST the same day.
    expect(istDateLabel(new Date(Date.UTC(2026, 7, 20, 18, 0)))).toBe('2026-08-20');
    // Just before the IST day turns over.
    expect(istDateLabel(new Date(Date.UTC(2026, 7, 20, 18, 29, 59)))).toBe('2026-08-20');
  });

  it('matches today only on the same India date', () => {
    const now = new Date(Date.UTC(2026, 7, 20, 23, 0)); // 21 Aug, 04:30 IST
    expect(isSameIstDay('2026-08-21', now)).toBe(true);
    expect(isSameIstDay('2026-08-20', now)).toBe(false);
    expect(isSameIstDay(undefined, now)).toBe(false);
    expect(isSameIstDay('21-08-2026', now)).toBe(false);
  });

  it('starts the India day at 00:00 IST (18:30 UTC the previous day)', () => {
    expect(istTodayStartMs(new Date(Date.UTC(2026, 7, 20, 23, 0)))).toBe(Date.UTC(2026, 7, 20, 18, 30));
  });
});
