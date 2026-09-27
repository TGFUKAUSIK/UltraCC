/**
 * iCal (.ics) export — generates a downloadable .ics file from academic
 * calendar events, exam schedules, and assignment deadlines.
 *
 * Format: RFC 5545 iCalendar (compatible with Google Calendar, Apple Calendar, Outlook).
 */

import type { AcademicCalendar } from '../lib/vtop/types';
import type { TimetableSlot } from '../types';

/** Escape text for iCal (RFC 5545 §3.3.11). */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Format a date as iCal VALUE=DATE (YYYYMMDD). */
function icalDate(dateStr: string): string {
  // dateStr is ISO "2025-12-01"
  return dateStr.replace(/-/g, '');
}

/** Format a datetime as iCal DATETIME (YYYYMMDDTHHMMSS). */
function icalDateTime(dateStr: string, timeStr: string): string {
  const date = dateStr.replace(/-/g, '');
  // timeStr is "10:00" or "10:00 AM"
  const m = timeStr.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!m) return `${date}T090000`;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  else if (ap === 'AM' && h === 12) h = 0;
  return `${date}T${String(h).padStart(2, '0')}${min}00`;
}

export interface ExamCalendarInput {
  id?: string;
  slot?: string;
  courseCode: string;
  courseTitle: string;
  examType: string;
  date: string;
  time: string;
  venue?: string;
  seatNo?: string;
}

function normalizeExamDate(dateStr: string): string | null {
  const iso = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return dateStr.trim();
  const dmy = dateStr.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!dmy) return null;
  return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
}

function parseClock(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (minute > 59 || hour > 23 || (meridiem && (hour > 12 || hour < 1))) return null;
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function examTimeRange(time: string): { start: string; end: string } | null {
  const parts = time.split(/\s*(?:-|–|—)\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const start = parseClock(parts[0]);
  const end = parseClock(parts[1]);
  return start && end ? { start, end } : null;
}

export function isExamCalendarReady(exam: Pick<ExamCalendarInput, 'date' | 'time'>): boolean {
  return !!normalizeExamDate(exam.date) && !!examTimeRange(exam.time || '');
}

/** Current timestamp in iCal format. */
function icalNow(): string {
  const d = new Date();
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/** Generate a UID for an event. */
function uid(prefix: string, id: string): string {
  return `${prefix}-${id}@ultracc.vit.ac.in`;
}

interface ICalEvent {
  uid: string;
  summary: string;
  description?: string;
  dtstart: string;
  dtend?: string;
  location?: string;
  categories?: string[];
  allday?: boolean;
}

function renderEvent(event: ICalEvent): string {
  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${icalNow()}`,
  ];

  if (event.allday) {
    lines.push(`DTSTART;VALUE=DATE:${event.dtstart}`);
    if (event.dtend) lines.push(`DTEND;VALUE=DATE:${event.dtend}`);
  } else {
    lines.push(`DTSTART;TZID=Asia/Kolkata:${event.dtstart}`);
    if (event.dtend) lines.push(`DTEND;TZID=Asia/Kolkata:${event.dtend}`);
  }

  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.categories?.length) lines.push(`CATEGORIES:${event.categories.map(escapeText).join(',')}`);

  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

function renderCalendar(events: string[], name: string): string {
  const calLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UltraCC//Academic Calendar//EN',
    `X-WR-CALNAME:${escapeText(name)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
  ];
  return calLines.join('\r\n');
}

// --- Public export functions ---

/** Export academic calendar events (holidays, instructional days, events). */
export function exportCalendarToIcs(calendar: AcademicCalendar): string {
  const events: string[] = [];

  for (const day of calendar.days) {
    if (day.label) {
      // Holiday or special event
      events.push(renderEvent({
        uid: uid('cal', day.date),
        summary: day.label,
        dtstart: icalDate(day.date),
        dtend: icalDate(day.date),
        categories: ['Academic Calendar', 'Holiday'],
        allday: true,
      }));
    } else if (day.instructional && day.dayOrder) {
      // Instructional day with day order
      events.push(renderEvent({
        uid: uid('day', day.date),
        summary: day.dayOrder,
        dtstart: icalDate(day.date),
        dtend: icalDate(day.date),
        categories: ['Academic Calendar', 'Instructional'],
        allday: true,
      }));
    }
  }

  return renderCalendar(events, 'UltraCC — Academic Calendar');
}

/** Export exam schedule to iCal. */
export function exportExamsToIcs(exams: ExamCalendarInput[]): string {
  const events: string[] = [];

  for (const exam of exams) {
    const date = normalizeExamDate(exam.date || '');
    const timeRange = examTimeRange(exam.time || '');
    if (!date || !timeRange) continue;

    events.push(renderEvent({
      uid: uid('exam', `${exam.id || `${exam.courseCode}-${exam.examType}`}-${date}`.replace(/[^A-Za-z0-9_-]/g, '_')),
      summary: `${exam.examType}: ${exam.courseCode} — ${exam.courseTitle}`,
      description: [
        exam.slot ? `Slot: ${exam.slot}` : '',
        `Exam Type: ${exam.examType}`,
        `Time: ${exam.time}`,
        exam.venue ? `Venue: ${exam.venue}` : 'Venue: Not released',
        exam.seatNo ? `Seat: ${exam.seatNo}` : '',
        '',
        'Generated by UltraCC',
      ].filter(Boolean).join('\\n'),
      dtstart: icalDateTime(date, timeRange.start),
      dtend: icalDateTime(date, timeRange.end),
      location: exam.venue || undefined,
      categories: ['Exam', exam.examType],
    }));
  }

  return renderCalendar(events, 'UltraCC — Exam Schedule');
}

/** Export today's/tomorrow's timetable as calendar events (recurring weekly). */
export function exportTimetableToIcs(timetable: TimetableSlot[]): string {
  const events: string[] = [];

  // Group by day for weekly recurrence
  const dayMap = new Map<string, TimetableSlot[]>();
  for (const slot of timetable) {
    if (!dayMap.has(slot.day)) dayMap.set(slot.day, []);
    dayMap.get(slot.day)!.push(slot);
  }

  for (const [, slots] of dayMap) {
    for (const slot of slots) {
      events.push(renderEvent({
        uid: uid('tt', `${slot.courseCode}-${slot.day}-${slot.startTime}`),
        summary: `${slot.courseCode} — ${slot.courseTitle}`,
        description: [
          `Faculty: ${slot.facultyName}`,
          `Slot: ${slot.slot}`,
          `Venue: ${slot.venue}`,
          `Type: ${slot.isLab ? 'Lab' : 'Theory'}`,
        ].join('\\n'),
        dtstart: icalDateTime('2025-01-06', slot.startTime), // Start from a Monday
        dtend: icalDateTime('2025-01-06', slot.endTime),
        location: slot.venue,
        categories: ['Timetable', slot.isLab ? 'Lab' : 'Theory'],
      }));
    }
  }

  return renderCalendar(events, 'UltraCC — Timetable');
}

/** Trigger a browser download of an iCal string. */
export function downloadIcs(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
