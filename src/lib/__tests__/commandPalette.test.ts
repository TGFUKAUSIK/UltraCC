/**
 * commandPalette tests — ⌘K search over REAL synced records.
 *
 * Contract: courses/faculty/venues/exams/attendance/marks must be findable by
 * their real values (course code, faculty name, room, slot token), and
 * destinations must be reachable by intent words ("bunk", "printing", "mess").
 * Search is AND-multi-token and prefix matches outrank substring matches.
 */

import { describe, it, expect } from 'vitest';
import type { AttendanceRecord, CourseMarks, ExamSchedule, TimetableSlot } from '../../types';
import { buildPaletteIndex, searchPalette } from '../commandPalette';

const timetable: TimetableSlot[] = [
  {
    id: 't1', courseCode: 'CSE1012', courseTitle: 'Data Structures', slot: 'A1+A2',
    facultyName: 'Dr. Ramesh', venue: 'SJT-204', building: 'SJT', roomNo: '204',
    day: 'Monday', startTime: '08:00', endTime: '09:40', isLab: false,
  },
  {
    id: 't2', courseCode: 'CSE2001', courseTitle: 'DBMS Lab', slot: 'L31+L32',
    facultyName: 'Prof. Meena', venue: 'AB1-201', building: 'AB1', roomNo: '201',
    day: 'Tuesday', startTime: '14:00', endTime: '15:40', isLab: true,
  },
];

const attendance: AttendanceRecord[] = [
  {
    courseCode: 'CSE1012', courseTitle: 'Data Structures', type: 'TH', slot: 'A1+A2',
    facultyName: 'Dr. Ramesh', attended: 20, totalHeld: 24, percentage: 83,
    category: 'Safe', lastUpdated: '2026-09-14', venue: 'SJT-204',
  },
  {
    courseCode: 'MAT1001', courseTitle: 'Calculus', type: 'ETH', slot: 'B1',
    facultyName: 'Dr. Iyer', attended: 9, totalHeld: 14, percentage: 64,
    category: 'Critical', lastUpdated: '2026-09-14', venue: 'AB2-110',
  },
];

const exams: ExamSchedule[] = [
  {
    id: 'e1', slot: 'A1', courseCode: 'CSE1012', courseTitle: 'Data Structures',
    examType: 'CAT 1', date: '2026-09-20', time: '09:00', venue: 'AB1-301', seatNo: 'S12',
    syllabusTopics: [], topicsCompleted: 0, studyPriority: 'High',
  },
];

const marks: CourseMarks[] = [
  {
    courseCode: 'PHY1002', courseTitle: 'Physics', cat1: { scored: 18, max: 25, weightage: 10 },
    cat2: { scored: 0, max: 25, weightage: 10 }, da1: { scored: 8, max: 10, weightage: 5 },
    da2: { scored: 0, max: 10, weightage: 5 }, da3: { scored: 0, max: 10, weightage: 5 }, quiz: { scored: 3, max: 5, weightage: 5 },
    fat: { max: 40, weightage: 40 }, totalScoredSoFar: 29, currentEstimatedGrade: '—',
  },
];

const index = () => buildPaletteIndex({ timetable, attendance, exams, marks });

describe('buildPaletteIndex', () => {
  it('indexes courses with faculty and venue in keywords', () => {
    const items = index();
    const course = items.find((i) => i.id === 'course:CSE1012');
    expect(course).toBeDefined();
    expect(course!.title).toContain('CSE1012');
    expect(course!.keywords).toContain('ramesh');
    expect(course!.keywords).toContain('sjt-204');
    expect(course!.keywords).toContain('a1');
  });

  it('indexes attendance with percentage and bunk intents', () => {
    const course = index().find((i) => i.id.startsWith('attendance:MAT1001'));
    expect(course!.title).toContain('64%');
    expect(course!.keywords).toContain('bunk');
    expect(course!.subtitle).toContain('9/14');
  });

  it('indexes exams with venue and seat', () => {
    const exam = index().find((i) => i.category === 'Exam');
    expect(exam!.title).toContain('CAT 1');
    expect(exam!.keywords).toContain('ab1-301');
    expect(exam!.subtitle).toContain('S12');
  });

  it('indexes marks for courses not covered by timetable/attendance (no duplicates)', () => {
    const items = index();
    expect(items.filter((i) => i.id === 'marks:PHY1002')).toHaveLength(1);
    expect(items.filter((i) => i.id.startsWith('marks:CSE1012'))).toHaveLength(0);
  });

  it('indexes app destinations by intent keywords', () => {
    const items = index();
    const bunk = items.find((i) => i.id === 'go:academics');
    expect(bunk!.keywords).toContain('bunk');
    const mess = items.find((i) => i.id === 'go:hostel');
    expect(mess!.keywords).toContain('mess');
  });
});

describe('searchPalette', () => {
  it('finds courses by code — even when the query is just the code', () => {
    const hits = searchPalette(index(), 'cse1012');
    expect(hits[0].id).toBe('course:CSE1012');
  });

  it('finds faculty by name', () => {
    const hits = searchPalette(index(), 'meena');
    expect(hits.some((h) => h.id === 'course:CSE2001')).toBe(true);
  });

  it('finds rooms by venue token', () => {
    const hits = searchPalette(index(), 'sjt-204');
    expect(hits.some((h) => h.id === 'course:CSE1012')).toBe(true);
  });

  it('requires ALL tokens (AND semantics)', () => {
    const hits = searchPalette(index(), 'cse cat');
    expect(hits.map((h) => h.id)).toContain('exam:e1');
    expect(hits.every((h) => /cse|cat/.test(`${h.title} ${h.keywords}`))).toBe(true);
    // Iyer teaches MAT1001 only — no CSE record mentions Iyer.
    expect(searchPalette(index(), 'cse iyer')).toHaveLength(0);
  });

  it('ranks title prefix above substring', () => {
    const hits = searchPalette(index(), 'timetable');
    expect(hits[0].id).toBe('go:timetable');
  });

  it('finds destinations by intent words', () => {
    // "bunk" surfaces both the academics tab and the AI advisor (its subtitle
    // offers bunk planning) — the tab must be among the top hits.
    const bunkTabs = searchPalette(index(), 'bunk', 4).map((h) => h.tab);
    expect(bunkTabs).toContain('academics');
    expect(searchPalette(index(), 'printing')[0].tab).toBe('campus-utils');
    expect(searchPalette(index(), 'mess')[0].tab).toBe('hostel');
  });

  it('caps results at the limit', () => {
    expect(searchPalette(index(), 'cse', 3).length).toBeLessThanOrEqual(3);
  });
});
