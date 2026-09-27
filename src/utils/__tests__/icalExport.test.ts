import { describe, expect, it } from 'vitest';
import { exportExamsToIcs, examTimeRange, isExamCalendarReady } from '../icalExport';

const exam = (overrides: Record<string, string> = {}) => ({
  id: 'exam-1', courseCode: 'CSE2001', courseTitle: 'Networks', examType: 'CAT 2', date: '2026-10-12', time: '10:00 AM - 12:00 PM', venue: 'AB1-101', seatNo: 'B12', ...overrides,
});

describe('exam calendar export', () => {
  it('requires authoritative date and a complete time range', () => {
    expect(isExamCalendarReady(exam())).toBe(true);
    expect(isExamCalendarReady(exam({ date: '' }))).toBe(false);
    expect(isExamCalendarReady(exam({ time: '' }))).toBe(false);
    expect(isExamCalendarReady(exam({ time: '10:00 AM' }))).toBe(false);
    expect(examTimeRange('10:00 AM - 12:00 PM')).toEqual({ start: '10:00', end: '12:00' });
  });

  it('emits India timezone, stable unique UIDs and authoritative details', () => {
    const ics = exportExamsToIcs([exam(), exam({ id: 'exam-2', courseCode: 'MAT2001' })]);
    expect(ics).toContain('DTSTART;TZID=Asia/Kolkata:20261012T100000');
    expect(ics).toContain('DTEND;TZID=Asia/Kolkata:20261012T120000');
    expect(ics).toContain('LOCATION:AB1-101');
    expect((ics.match(/UID:/g) || []).length).toBe(2);
    expect(new Set((ics.match(/UID:[^\r\n]+/g) || [])).size).toBe(2);
  });

  it('skips incomplete exams instead of inventing a time', () => {
    const ics = exportExamsToIcs([exam({ date: '', time: '' })]);
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).not.toContain('T090000');
  });
});
