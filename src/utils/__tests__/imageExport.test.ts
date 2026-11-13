import { describe, it, expect } from 'vitest';
import {
  estimatedTextWidth, truncateToWidth, buildTimetableImageDoc, buildAttendanceImageDoc,
  buildExamsImageDoc, ImageDoc, PrintableExamRow,
} from '../imageExport';
import type { PrintableTimetableRow, PrintableAttendanceRow } from '../printExport';

const ttRow = (over: Partial<PrintableTimetableRow> = {}): PrintableTimetableRow => ({
  day: 'MON', startTime: '08:00', endTime: '08:50', courseCode: 'CSE101',
  courseTitle: 'Problem Solving', slot: 'A1', venue: 'TT-01', faculty: 'Dr. A', isLab: false,
  ...over,
});

const attRow = (over: Partial<PrintableAttendanceRow> = {}): PrintableAttendanceRow => ({
  courseCode: 'CSE101', courseTitle: 'Problem Solving', attended: 30, total: 40,
  percentage: 75, faculty: 'Dr. A',
  ...over,
});

const examRow = (over: Partial<PrintableExamRow> = {}): PrintableExamRow => ({
  courseCode: 'CSE101', courseTitle: 'Problem Solving', examType: 'CAT 1',
  date: '2026-09-20', time: '09:00', venue: 'TT-01', seatNo: 'A12',
  ...over,
});

describe('estimatedTextWidth / truncateToWidth', () => {
  it('width scales with text length and font size', () => {
    expect(estimatedTextWidth('abcd', 10)).toBeGreaterThan(estimatedTextWidth('ab', 10));
    expect(estimatedTextWidth('abcd', 20)).toBeGreaterThan(estimatedTextWidth('abcd', 10));
  });

  it('short strings pass through untouched', () => {
    expect(truncateToWidth('CSE101', 200, 12)).toBe('CSE101');
  });

  it('long strings get an ellipsis and fit the budget', () => {
    const long = 'A very long course title that certainly will not fit into a narrow column';
    const out = truncateToWidth(long, 90, 12);
    expect(out.length).toBeLessThan(long.length);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildTimetableImageDoc', () => {
  it('produces a doc with header, one section per day and rows', () => {
    const doc = buildTimetableImageDoc([ttRow(), ttRow({ day: 'TUE', courseCode: 'MAT201' })], { regNo: '22BRS1000' });
    const texts = doc.commands.filter((c) => c.kind === 'text').map((c) => (c as { text: string }).text);
    expect(texts).toContain('Weekly Timetable');
    expect(texts).toContain('MON');
    expect(texts).toContain('TUE');
    expect(texts).toContain('CSE101');
    expect(doc.height).toBeGreaterThan(200);
  });

  it('sorts rows by start time within a day', () => {
    const doc = buildTimetableImageDoc([ttRow({ startTime: '10:00' }), ttRow({ startTime: '08:00', courseCode: 'EARLY' })]);
    const codes = doc.commands.filter((c) => c.kind === 'text').map((c) => (c as { text: string }).text);
    expect(codes.indexOf('EARLY')).toBeLessThan(codes.indexOf('CSE101'));
  });

  it('skips days with no rows', () => {
    const doc = buildTimetableImageDoc([ttRow()]);
    const texts = doc.commands.filter((c) => c.kind === 'text').map((c) => (c as { text: string }).text);
    expect(texts).toContain('MON');
    expect(texts).not.toContain('SUN');
  });

  it('shows an honest empty state', () => {
    const doc = buildTimetableImageDoc([]);
    const texts = doc.commands.filter((c) => c.kind === 'text').map((c) => (c as { text: string }).text);
    expect(texts).toContain('No classes on this timetable.');
  });

  it('truncates long course titles to fit the column', () => {
    const doc = buildTimetableImageDoc([ttRow({ courseTitle: 'X'.repeat(120) })]);
    const titleTexts = doc.commands.filter((c) => c.kind === 'text' && (c as { text: string }).text.includes('…'));
    expect(titleTexts.length).toBeGreaterThan(0);
  });
});

describe('buildAttendanceImageDoc', () => {
  it('sorts worst courses first', () => {
    const doc = buildAttendanceImageDoc([attRow({ courseCode: 'GOOD', percentage: 95 }), attRow({ courseCode: 'BAD', percentage: 60 })]);
    const codes = doc.commands.filter((c) => c.kind === 'text').map((c) => (c as { text: string }).text);
    expect(codes.indexOf('BAD')).toBeLessThan(codes.indexOf('GOOD'));
  });

  it('colors at-risk percentages red', () => {
    const doc = buildAttendanceImageDoc([attRow({ percentage: 60 })]);
    const red = doc.commands.some((c) => c.kind === 'text' && (c as { color: string }).color === '#b91c1c');
    expect(red).toBe(true);
  });

  it('computes overall percentage in the subtitle', () => {
    const doc = buildAttendanceImageDoc([attRow({ attended: 30, total: 40 }), attRow({ attended: 10, total: 20 })]);
    const texts = doc.commands.filter((c) => c.kind === 'text').map((c) => (c as { text: string }).text);
    // 40 of 60 is 66.66…%, and the header prints it truncated to one decimal —
    // the same figure the app shows. Rounding here used to put "Overall 67%"
    // above rows the app calls 66.6%, and a round-up could push a 74.9% sheet
    // onto the 75% line its own colour says is unmet.
    expect(texts.some((t) => t.includes('Overall 66.6%'))).toBe(true);
  });
});

describe('buildExamsImageDoc', () => {
  it('includes date, venue and seat columns', () => {
    const doc = buildExamsImageDoc([examRow()]);
    const texts = doc.commands.filter((c) => c.kind === 'text').map((c) => (c as { text: string }).text);
    expect(texts).toContain('2026-09-20');
    expect(texts).toContain('TT-01');
    expect(texts).toContain('A12');
  });

  it('handles pending schedule fields honestly', () => {
    const doc = buildExamsImageDoc([examRow({ date: '', venue: '', seatNo: '' })]);
    const texts = doc.commands.filter((c) => c.kind === 'text').map((c) => (c as { text: string }).text);
    expect(texts).not.toContain('undefined');
    expect(texts).not.toContain('null');
  });
});

describe('doc integrity', () => {
  it('all commands stay inside the canvas bounds', () => {
    const docs: ImageDoc[] = [
      buildTimetableImageDoc([ttRow(), ttRow({ day: 'WED' })], { regNo: '22BRS1000' }),
      buildAttendanceImageDoc([attRow()]),
      buildExamsImageDoc([examRow()]),
    ];
    for (const doc of docs) {
      for (const c of doc.commands) {
        if (c.kind === 'rect') {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x + c.w).toBeLessThanOrEqual(doc.width);
          expect(c.y + c.h).toBeLessThanOrEqual(doc.height);
        } else if (c.kind === 'text') {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeLessThanOrEqual(doc.width);
          expect(c.y).toBeLessThanOrEqual(doc.height);
        }
      }
    }
  });
});
