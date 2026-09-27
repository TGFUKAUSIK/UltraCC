/**
 * Exam helpers — next upcoming exam + exam↔timetable slot enrichment.
 *
 * Timezone safety: VTOP dates are India dates ("2026-08-18"). We interpret
 * them as Asia/Kolkata (UTC+05:30) and compare against the real current time,
 * so a countdown is correct regardless of the device's timezone.
 */

import { ExamRecord, TimetableSlot } from '../lib/vtop/types';
import { ExamSchedule } from '../types';

/** Asia/Kolkata is UTC+05:30. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * "2026-08-18" (+ optional "09:00 AM - 12:00 PM" / "14:00-15:40") -> epoch ms
 * interpreted in Asia/Kolkata. Returns null when the date isn't parseable.
 */
export function examStartMs(date: string, time: string): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);

  let hour = 0;
  let minute = 0;
  const timeMatch = time ? time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i) : null;
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    minute = parseInt(timeMatch[2], 10);
    const ap = (timeMatch[3] || '').toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    else if (ap === 'AM' && h === 12) h = 0;
    hour = h;
  }
  // Interpret as IST then convert to UTC epoch.
  return Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS;
}

/** Human countdown from now until an exam start (in IST terms). */
export function countdownLabel(startsAtMs: number, nowMs: number): string {
  const diff = startsAtMs - nowMs;
  if (diff <= 0) return 'Today';
  const days = Math.floor(diff / 86400000);
  if (days >= 1) return `${days} day${days > 1 ? 's' : ''}`;
  const hours = Math.floor(diff / 3600000);
  if (hours >= 1) return `${hours}h ${Math.floor((diff % 3600000) / 60000)}m`;
  return `${Math.max(1, Math.round(diff / 60000))}m`;
}

/**
 * Today's calendar date written the way VTOP writes it ("2026-08-18"), in the
 * India calendar rather than the device's.
 *
 * `new Date('2026-08-18')` parses as UTC midnight, so on any device west of
 * Greenwich "today" arrives a day late and comparisons against local midnight
 * silently drop today's exam (or tomorrow's) from the list. Comparing ISO date
 * labels is both cheaper and exactly right — India has no DST, and ISO labels
 * sort lexicographically.
 */
export function istDateLabel(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

/** True when a VTOP "YYYY-MM-DD" date string is today's date in India. */
export function isSameIstDay(dateStr: string | undefined, now: Date = new Date()): boolean {
  return !!dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim()) && dateStr.trim() === istDateLabel(now);
}

/**
 * The instant India's calendar day begins, as an epoch ms. Use this instead of
 * `new Date(y, m, d)` when the other side of the comparison is an IST-derived
 * instant: a device set to another zone would otherwise cut the day at its own
 * midnight and hide or repeat today's items.
 */
export function istTodayStartMs(now: Date = new Date()): number {
  return examStartMs(istDateLabel(now), '00:00') ?? Number.NaN;
}

export interface NextExam {
  exam: ExamSchedule;
  startsAtMs: number;
  countdown: string;
}

/**
 * The next upcoming exam chronologically (earliest start >= now), or null
 * when there is none. Never invents data — only exams with a parseable date
 * are candidates.
 */
export function nextUpcomingExam(exams: ExamSchedule[], nowMs = Date.now()): NextExam | null {
  const candidates = exams
    .map((exam) => ({ exam, startsAtMs: examStartMs(exam.date, exam.time) }))
    .filter((x): x is { exam: ExamSchedule; startsAtMs: number } => x.startsAtMs !== null)
    .filter((x) => x.startsAtMs >= nowMs)
    .sort((a, b) => a.startsAtMs - b.startsAtMs);
  const first = candidates[0];
  if (!first) return null;
  return {
    exam: first.exam,
    startsAtMs: first.startsAtMs,
    countdown: countdownLabel(first.startsAtMs, nowMs),
  };
}

/**
 * The VTOP exam schedule page has no course-code column, but the timetable
 * course list maps slot -> course. Join exam slots to timetable slots so the
 * dashboard can show "subject/course code (if available)". Deterministic
 * (same slot on the same semester's timetable) — never guessed.
 */
export function enrichExamsWithCourses(exams: ExamRecord[], timetable: TimetableSlot[]): ExamRecord[] {
  const courseBySlot = new Map<string, { code: string; title: string }>();
  for (const slot of timetable) {
    if (!courseBySlot.has(slot.slot)) {
      courseBySlot.set(slot.slot, { code: slot.courseCode, title: slot.courseTitle });
    }
  }
  return exams.map((e) => {
    const primarySlot = (e.slot || '').split('+')[0].trim();
    const course = primarySlot ? courseBySlot.get(primarySlot) : undefined;
    if (!course) return e;
    return {
      ...e,
      courseCode: course.code,
      courseTitle: course.title,
    };
  });
}
