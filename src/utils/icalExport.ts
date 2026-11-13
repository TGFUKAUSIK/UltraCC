/**
 * iCal (.ics) export — generates a downloadable .ics file from academic
 * calendar events, exam schedules, and assignment deadlines.
 *
 * Format: RFC 5545 iCalendar (compatible with Google Calendar, Apple Calendar,
 * Outlook). Three promises the writer keeps, because a student imports the file
 * into the calendar app they live in and has no way to correct it there:
 * every line is folded to the 75-octet limit, every timed event's `TZID` is
 * answered by a `VTIMEZONE` the file actually ships, and a date or a clock the
 * app cannot vouch for drops the event instead of becoming a plausible guess.
 */

import type { AcademicCalendar } from '../lib/vtop/types';
import { isRealCalendarDate } from './examUtils';

/** Escape text for iCal (RFC 5545 §3.3.11). */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Format a date as iCal VALUE=DATE (YYYYMMDD), or `null` for a cell that names
 *  no day the month had — the same gate every other date in this file passes. */
function icalDate(dateStr: string): string | null {
  const iso = normalizeExamDate(dateStr);
  return iso ? iso.replace(/-/g, '') : null;
}

/** Format a datetime as iCal DATETIME (YYYYMMDDTHHMMSS), or `null` for a clock
 *  that cannot be read. There is deliberately no fallback hour: the writer used
 *  to answer 09:00 for a time it could not parse, which put an exam on the
 *  student's calendar at a time VTOP never printed. */
function icalDateTime(dateStr: string, timeStr: string): string | null {
  const date = dateStr.replace(/-/g, '');
  // timeStr is "10:00" or "10:00 AM"
  const m = timeStr.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  else if (ap === 'AM' && h === 12) h = 0;
  if (h > 23 || Number(min) > 59) return null;
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
  if (iso) {
    // A .ics is a contract with the student's real calendar app: a day that
    // never happened has no place in it, so refuse the whole event instead of
    // writing "20260230" or letting the reader roll it onto March 2nd.
    return isRealCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) ? dateStr.trim() : null;
  }
  const dmy = dateStr.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!dmy) return null;
  const key = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return isRealCalendarDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1])) ? key : null;
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

/** Whether an Event Hub card has a day the calendar app can be given. The
 *  button that offers "Add to Calendar" asks this, so a card is never clickable
 *  into a file that would come out empty — and a date shaped like a day but not
 *  one ("2026-02-30") is honest about having nothing to add. */
export function isEventCalendarReady(date: string): boolean {
  return !!normalizeExamDate(date || '');
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

/** India's zone has had no clock change since 1942, so one STANDARD period and
 *  no daylight rule describes it. A `TZID` that points at no `VTIMEZONE` is a
 *  reference to a table the file never ships: Google Calendar fills it in from
 *  its own list, and a stricter reader is free to treat the timed exam as a
 *  floating local hour — the app that imports it decides, not the student. */
const INDIA_TIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Kolkata',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0530',
  'TZOFFSETTO:+0530',
  'TZNAME:IST',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');

/** UTF-8 octets in a string, counted per code point so an em dash in a course
 *  title weighs what a calendar app will weigh it at. */
function octets(value: string): number {
  let total = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    total += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return total;
}

/** RFC 5545 §3.1: a logical line is 75 octets, and a continuation line starts
 *  with one space. An exam description is longer than that in the ordinary
 *  case, so without folding the venue and the seat number are exactly what a
 *  stricter calendar drops. */
function foldLine(line: string): string {
  if (octets(line) <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let used = 0;
  for (const ch of Array.from(line)) {
    const size = octets(ch);
    if (used + size > 75) {
      parts.push(current);
      current = ` ${ch}`;
      used = 1 + size;
    } else {
      current += ch;
      used += size;
    }
  }
  if (current) parts.push(current);
  return parts.join('\r\n');
}

/** The day after a proven day, as YYYYMMDD.
 *
 *  An all-day `DTEND` is exclusive, so a holiday on the 18th ends on the 19th —
 *  repeating the start day is what makes a calendar shade the day *and* the one
 *  after it. The input has already passed `normalizeExamDate`, so this is honest
 *  arithmetic on a day that exists, not a roll-over of one that does not. */
function nextIcalDay(ymd: string): string {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day = Number(ymd.slice(6, 8));
  if (!isRealCalendarDate(year, month, day)) return '';
  const probe = new Date(Date.UTC(year, month - 1, day));
  probe.setUTCDate(probe.getUTCDate() + 1);
  return `${probe.getUTCFullYear()}${String(probe.getUTCMonth() + 1).padStart(2, '0')}${String(probe.getUTCDate()).padStart(2, '0')}`;
}

function renderEvent(event: ICalEvent): string {
  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${icalNow()}`,
  ];

  if (event.allday) {
    lines.push(`DTSTART;VALUE=DATE:${event.dtstart}`);
    const end = event.dtend && event.dtend !== event.dtstart ? event.dtend : nextIcalDay(event.dtstart);
    if (end) lines.push(`DTEND;VALUE=DATE:${end}`);
  } else {
    lines.push(`DTSTART;TZID=Asia/Kolkata:${event.dtstart}`);
    if (event.dtend && event.dtend !== event.dtstart) lines.push(`DTEND;TZID=Asia/Kolkata:${event.dtend}`);
  }

  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.categories?.length) lines.push(`CATEGORIES:${event.categories.map(escapeText).join(',')}`);

  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

function renderCalendar(events: string[], name: string): string {
  const timed = events.some((block) => block.includes('TZID=Asia/Kolkata'));
  const blocks = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UltraCC//Academic Calendar//EN',
    `X-WR-CALNAME:${escapeText(name)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(timed ? [INDIA_TIMEZONE] : []),
    ...events,
    'END:VCALENDAR',
  ];
  return blocks
    .flatMap((block) => block.split('\r\n').map(foldLine))
    .join('\r\n') + '\r\n';
}

// --- Public export functions ---

/** Export academic calendar events (holidays, instructional days, events). */
export function exportCalendarToIcs(calendar: AcademicCalendar): string {
  const events: string[] = [];

  for (const day of calendar.days) {
    const written = icalDate(day.date);
    if (!written) continue;
    if (day.label) {
      // Holiday or special event
      events.push(renderEvent({
        uid: uid('cal', day.date),
        summary: day.label,
        dtstart: written,
        categories: ['Academic Calendar', 'Holiday'],
        allday: true,
      }));
    } else if (day.instructional && day.dayOrder) {
      // Instructional day with day order
      events.push(renderEvent({
        uid: uid('day', day.date),
        summary: day.dayOrder,
        dtstart: written,
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
    const dtstart = icalDateTime(date, timeRange.start);
    const dtend = icalDateTime(date, timeRange.end);
    if (!dtstart || !dtend) continue;

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
      ].filter(Boolean).join('\n'),
      dtstart,
      dtend,
      location: exam.venue || undefined,
      categories: ['Exam', exam.examType],
    }));
  }

  return renderCalendar(events, 'UltraCC — Exam Schedule');
}

/** Export one Event Hub event as an all-day iCal event. Event Hub's public
 *  cards carry a date but no start time, so the calendar entry is all-day on
 *  the event date — nothing is invented. The UID is stable per event id, so
 *  re-adding the same event to a calendar never creates a duplicate entry. */
export function exportEventToIcs(event: { eid: string; title: string; date: string; location?: string }): string {
  const written = icalDate(event.date || '');
  if (!written) return '';
  const icsEvent = renderEvent({
    uid: uid('event', event.eid),
    summary: event.title,
    dtstart: written,
    location: event.location || undefined,
    categories: ['Event Hub'],
    allday: true,
  });
  return renderCalendar([icsEvent], 'UltraCC — Event Hub');
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
