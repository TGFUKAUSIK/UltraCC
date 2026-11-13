import { readFileSync } from 'node:fs';
import { TextEncoder } from 'node:util';
import { describe, expect, it } from 'vitest';
import { exportCalendarToIcs, exportEventToIcs, isEventCalendarReady, exportExamsToIcs, examTimeRange, isExamCalendarReady } from '../icalExport';
import type { AcademicCalendar, CalendarDay } from '../../lib/vtop/types';

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

  it('writes no day that never existed', () => {
    expect(isExamCalendarReady(exam({ date: '2026-02-30' }))).toBe(false);
    expect(isExamCalendarReady(exam({ date: '30/02/2026' }))).toBe(false);
    expect(isExamCalendarReady(exam({ date: '31/04/2026' }))).toBe(false);
    // A leap day is not an impossible day.
    expect(isExamCalendarReady(exam({ date: '2028-02-29' }))).toBe(true);

    const written = exportExamsToIcs([
      exam({ id: 'impossible', date: '30/02/2026' }),
      exam({ id: 'real', date: '14-09-2026' }),
    ]);
    expect(written).not.toContain('exam-impossible');
    expect(written).toContain('exam-real');
    expect((written.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
  });

  it('offers the calendar only when there is a day to write', () => {
    // An impossible day is not a date, so there is nothing to add — and a card
    // VTOP dated in dd-mm-yyyy is a date, so it must not be refused either.
    expect(isEventCalendarReady('2026-02-30')).toBe(false);
    expect(isEventCalendarReady('31-04-2026')).toBe(false);
    expect(isEventCalendarReady('TBD')).toBe(false);
    expect(isEventCalendarReady('')).toBe(false);
    expect(isEventCalendarReady('2026-09-14')).toBe(true);
    expect(isEventCalendarReady('30-09-2026')).toBe(true);

    expect(exportExamsToIcs([exam({ id: 'impossible', date: '30/02/2026' })])).not.toContain('BEGIN:VEVENT');
  });

  it('gives an Event Hub card with an impossible date no calendar entry at all', () => {
    expect(exportEventToIcs({ eid: 'e1', title: 'Fest', date: '31-04-2026' })).toBe('');
    expect(exportEventToIcs({ eid: 'e2', title: 'Fest', date: '30-04-2026' }))
      .toContain('DTSTART;VALUE=DATE:20260430');
  });
});

/**
 * The file is a contract with a calendar app UltraCC never sees.
 *
 * An exam .ics is downloaded once, imported once, and then read by Google or
 * Apple or Outlook with no chance to argue. Three things used to be left to that
 * app's mercy: `DTSTART;TZID=Asia/Kolkata` pointed at a zone table the file never
 * shipped, so a reader that did not recognise the name was free to treat a 10:00
 * exam as floating local time; every line was written as one long physical line,
 * and RFC 5545 caps a line at 75 octets, so the description past that point — the
 * venue, usually — was the reader's to truncate; and a single all-day holiday
 * repeated its own day as `DTEND`, which is an exclusive end, so the holiday
 * covered the day after it too.
 *
 * The writer also carried `exportTimetableToIcs`, which no screen called. It
 * stamped every class of the semester onto one Monday, 2025-01-06, and its comment
 * promised weekly recurrence it never wrote an `RRULE` for — a dead exporter whose
 * only dates were invented.
 */

const octets = (value: string): number => new TextEncoder().encode(value).length;
const unfold = (ics: string): string => ics.replace(/\r\n /g, '');

const longExam = () => ({
  ...exam(),
  courseTitle: 'Design and Analysis of Algorithms for Distributed Systems',
  venue: 'SJT Conference Hall, Second Floor, VIT Chennai Main Campus',
  seatNo: 'B-12-COL-3',
});

describe('the file a student imports into their own calendar', () => {
  it('ships the timezone table its timed events point at', () => {
    const ics = exportExamsToIcs([exam(), exam({ id: 'exam-2', courseCode: 'MAT2001' })]);
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('TZID:Asia/Kolkata');
    expect(ics).toContain('TZOFFSETTO:+0530');
    // One table for the whole file, not one per event.
    expect((ics.match(/BEGIN:VTIMEZONE/g) || []).length).toBe(1);
    expect(ics.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(ics.indexOf('BEGIN:VEVENT'));

    // An all-day file names no zone, so it ships no table.
    const allDay = exportEventToIcs({ eid: 'e3', title: 'Fest', date: '2026-09-14' });
    expect(allDay).not.toContain('VTIMEZONE');
    expect(allDay).not.toContain('TZID');
  });

  it('covers exactly the day a single-day event names', () => {
    // An all-day DTEND is exclusive, so the day after is where the event ends.
    // Shipping the start day as the end day is what made a holiday shade two.
    const ics = exportEventToIcs({ eid: 'e4', title: 'Habakkuk', date: '2026-09-14' });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260914');
    expect(ics).toContain('DTEND;VALUE=DATE:20260915');
    expect(ics).not.toContain('DTEND;VALUE=DATE:20260914');

    const calendar = exportCalendarToIcs(twoDays());
    expect((calendar.match(/DTSTART;VALUE=DATE:/g) || []).length).toBe(2);
    expect(calendar).toContain('DTEND;VALUE=DATE:20261003');
    expect(calendar).toContain('DTEND;VALUE=DATE:20261006');

    // Crossing a year and a leap day by real days, not by adding one to a string.
    expect(exportEventToIcs({ eid: 'e5', title: 'Novena', date: '2026-12-31' })).toContain('DTEND;VALUE=DATE:20270101');
    expect(exportEventToIcs({ eid: 'e6', title: 'Leap', date: '2028-02-29' })).toContain('DTEND;VALUE=DATE:20280301');
  });

  it('keeps every physical line inside the 75 octets a reader is owed', () => {
    const ics = exportExamsToIcs([longExam()]);
    const lines = ics.split('\r\n');
    const tooLong = lines.filter((line) => octets(line) > 75);
    expect(tooLong, `lines past the limit: ${tooLong.join(' | ')}`).toEqual([]);
    // A continuation is one space and then the rest of the value.
    const continuations = lines.filter((line) => line.startsWith(' '));
    expect(continuations.length).toBeGreaterThan(0);
    // The em dash in the summary weighs three bytes, so a character count would
    // have folded it in the wrong place.
    expect(unfold(ics)).toContain('SUMMARY:CAT 2: CSE2001 — Design and Analysis of Algorithms');
  });

  it('unfolds back to the whole description, venue and seat included', () => {
    const ics = exportExamsToIcs([longExam()]);
    const body = unfold(ics);
    expect(body).toMatch(/DESCRIPTION:[^\r\n]*Venue: SJT Conference Hall/);
    expect(body).toMatch(/DESCRIPTION:[^\r\n]*Seat: B-12-COL-3/);
    expect(body).toMatch(/LOCATION:[^\r\n]*VIT Chennai Main Campus/);
    // The description's line breaks are escaped once, so the calendar shows lines
    // rather than the literal text "\n" between them.
    expect(ics).not.toContain('\\\\n');
  });

  it('writes no academic-calendar day the month never had', () => {
    const days: CalendarDay[] = [
      { date: '2026-02-30', instructional: false, dayOrder: null, label: 'Founders Day' },
      { date: '2026-10-01', instructional: false, dayOrder: null, label: 'Gandhi Jayanti' },
    ];
    const ics = exportCalendarToIcs({ months: [], days, available: true });
    expect(ics).not.toContain('20260230');
    expect(ics).toContain('20261001');
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
  });

  it('leaves the writer with no invented hour and no dead timetable export', () => {
    const stripComments = readFileSync('src/utils/icalExport.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const FORBIDDEN: { pattern: RegExp; why: string }[] = [
      { pattern: /T090000/, why: 'a clock the writer could not read became 9 AM' },
      { pattern: /2025-01-06/, why: 'a Monday the app invented and stamped every class on' },
      { pattern: /exportTimetableToIcs/, why: 'an exporter no screen ever called' },
      { pattern: /if \(event\.dtend\) lines\.push\(/, why: 'a one-day holiday that also covered the day after it' },
      { pattern: /\.join\('\\\\n'\)/, why: 'a description whose line breaks reached the calendar as the text \\n' },
    ];

    for (const { pattern, why } of FORBIDDEN) {
      expect(stripComments, `the writer still contains the copy that ${why}`).not.toMatch(pattern);
    }

    // And no ban above is watching an empty room: each one has to catch the code
    // that used to be in the file.
    const DELETED_COPIES = [
      "  const m = timeStr.match(/(\\d{1,2}):(\\d{2})/i);\n  if (!m) return `${date}T090000`;",
      "        dtstart: icalDateTime('2025-01-06', slot.startTime), // Start from a Monday",
      'export function exportTimetableToIcs(timetable: TimetableSlot[]): string {',
      '  if (event.dtend) lines.push(`DTEND;VALUE=DATE:${event.dtend}`);',
      "      ].filter(Boolean).join('\\\\n'),",
    ];
    for (const { pattern, why } of FORBIDDEN) {
      expect(DELETED_COPIES.some((copy) => pattern.test(copy)), `nothing proves the ban meant to catch ${why}`).toBe(true);
    }

    expect(stripComments).toContain('BEGIN:VTIMEZONE');
    expect(stripComments).toContain('foldLine');
  });
});

function twoDays(): AcademicCalendar {
  const days: CalendarDay[] = [
    { date: '2026-10-02', instructional: true, dayOrder: 'Day Order 41', label: '' },
    { date: '2026-10-05', instructional: false, dayOrder: null, label: 'Holiday' },
  ];
  return { months: [], days, available: true };
}
