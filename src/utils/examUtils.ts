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

/** One calendar day, in the ms every countdown in this file is measured in. */
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * The same day, for code outside this file that needs to *step* across days
 * rather than count them. Exported so nobody writes `86400000` from memory.
 */
export const MILLISECONDS_IN_A_DAY = DAY_MS;

/** "9:30" + "PM" -> 21:30, VTOP-style, with the meridiem optional. */
function tokenToClock(h: string, minute: string, meridiem: string | undefined): { hour: number; minute: number } {
  let hour = parseInt(h, 10);
  const ap = (meridiem || '').toUpperCase();
  if (ap === 'PM' && hour !== 12) hour += 12;
  else if (ap === 'AM' && hour === 12) hour = 0;
  return { hour, minute: parseInt(minute, 10) };
}

const TIME_TOKEN = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i;
const TIME_TOKEN_GLOBAL = /(\d{1,2}):(\d{2})\s*(AM|PM)?/gi;

/**
 * Whether a (year, month, day) VTOP wrote is a day that actually exists: month
 * 1-12, and a day inside that month's own length, leap years included.
 *
 * `Date.UTC` does not object to an impossible day — it rolls it over. Hand it
 * February 30th and it returns a perfectly good instant on March 2nd, so every
 * countdown, notification and calendar entry built on it points at a day VTOP
 * never named. The parsers refuse to *make* such a date (see `normalizeDate`),
 * but a string can also reach here straight from cached VTOP text, so the check
 * is repeated at the boundary where text becomes an instant: a day that does not
 * exist is not a date, and the honest answer is null.
 *
 * Exported: every surface in `src/utils/` that turns digits into a calendar day
 * calls this instead of writing the arithmetic again.
 */
export function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * "2026-08-18" (+ optional "09:00 AM - 12:00 PM" / "14:00-15:40") -> epoch ms
 * interpreted in Asia/Kolkata. Returns null when there is no such day to count
 * down to — unparseable, out of range, or a day that month never had.
 */
export function examStartMs(date: string, time: string): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (!isRealCalendarDate(year, month, day)) return null;

  let hour = 0;
  let minute = 0;
  const timeMatch = time ? time.match(TIME_TOKEN) : null;
  if (timeMatch) {
    ({ hour, minute } = tokenToClock(timeMatch[1], timeMatch[2], timeMatch[3]));
  }
  // Interpret as IST then convert to UTC epoch.
  return Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS;
}

/**
 * The instant a VTOP exam finishes. VTOP writes the time as a range
 * ("10:00 AM - 11:30 AM"), so the end is its last clock token; a single time
 * gives no honest end and returns null rather than assuming a duration.
 */
export function examEndMs(date: string, time: string): number | null {
  if (!date || !time) return null;
  const tokens = [...time.matchAll(TIME_TOKEN_GLOBAL)];
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1];
  const start = examStartMs(date, time);
  const end = examStartMs(date, `${last[1]}:${last[2]}${last[3] ? ` ${last[3]}` : ''}`);
  // A range that ends before it starts spans midnight; there is no same-day
  // instant to report, so say nothing instead of showing a backwards countdown.
  if (end === null || start === null || end <= start) return null;
  return end;
}

/** Human countdown from now until an exam start (in IST terms). */
export function countdownLabel(startsAtMs: number, nowMs: number): string {
  const diff = startsAtMs - nowMs;
  if (diff <= 0) return 'Today';
  const days = Math.floor(diff / DAY_MS);
  if (days >= 1) return `${days} day${days > 1 ? 's' : ''}`;
  const hours = Math.floor(diff / HOUR_MS);
  if (hours >= 1) return `${hours}h ${Math.floor((diff % HOUR_MS) / MINUTE_MS)}m`;
  return `${Math.max(1, Math.round(diff / MINUTE_MS))}m`;
}

export interface IstClock {
  year: number;
  /** 0 = January, as JavaScript counts months. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
  /** The instant India's own calendar day containing this clock begins. */
  dayStartMs: number;
}

/**
 * The hour and date an instant reads on the India clock.
 *
 * VTOP instants are built from India calendar strings, so printing one with
 * `toLocaleTimeString` shows a device set to another zone a different hour from
 * the one the exam hall clock will show — and the countdown next to it would
 * disagree with the time it counts down to.
 */
export function istClock(ts: number): IstClock | null {
  if (!Number.isFinite(ts)) return null;
  const d = new Date(ts + IST_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return null;
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
    dayStartMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_OFFSET_MS,
  };
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

/**
 * The instant an India calendar day begins, for a date VTOP wrote as
 * "2026-09-16" (exams, calendar) or "16-09-2026" (LMS due dates).
 *
 * Both spellings reach the client from VTOP, and neither is a device-local
 * midnight: an app running on a clock west of Greenwich would otherwise read
 * "16-09" as the 15th, and a notification sent at 09:00 IST would call today's
 * submission overdue. Returns null for anything that is not a date — VTOP
 * writes "TBD" in these columns, and a guessed day is worse than none.
 */
export function vtopDateDayStartMs(raw: string | null | undefined): number | null {
  const text = (raw ?? '').trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  let year = NaN;
  let month = NaN;
  let day = NaN;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dmy) {
    year = Number(dmy[3]);
    month = Number(dmy[2]);
    day = Number(dmy[1]);
  } else {
    return null;
  }
  // Ranges *and* the day's existence: 2026-02-30 is inside every bound and is
  // still not a day, and Date.UTC would answer with March 2nd.
  if (!isRealCalendarDate(year, month, day)) return null;
  return Date.UTC(year, month - 1, day) - IST_OFFSET_MS;
}

/**
 * How many India calendar days a VTOP date falls from `nowMs` — 0 when it is
 * today, negative once it has passed.
 *
 * A date-only VTOP field means "on that date", so the day difference is the
 * honest measure and raw milliseconds are not: counting from the midnight
 * instant made everything due today look already past from the first hour of
 * the day, which is exactly when a student is still submitting it.
 */
export function calendarDaysUntil(raw: string | null | undefined, nowMs: number): number | null {
  const due = vtopDateDayStartMs(raw);
  if (due === null) return null;
  const today = vtopDateDayStartMs(istDateLabel(new Date(nowMs)));
  if (today === null) return null;
  return Math.round((due - today) / DAY_MS);
}

/**
 * India calendar days from `nowMs` to an instant already on the India calendar
 * (an exam's day start, say) — 0 today, 1 tomorrow, negative once past.
 *
 * This is the same count `calendarDaysUntil` makes from a VTOP date string, so
 * a screen holding an instant and a screen holding VTOP's own text cannot
 * disagree about whether "today" means today.
 */
export function istDayDiff(dayStartMs: number, nowMs: number): number {
  return Math.round((dayStartMs - istTodayStartMs(new Date(nowMs))) / DAY_MS);
}

/**
 * Whole days in a span that is still running, rounded up.
 *
 * For something with a lifetime rather than a date — a share code, a cached
 * login — a fraction of a day left is a day the student can still use. Telling
 * them "expires in 2 days" when the link lives into the third would send them
 * to re-share it for no reason.
 */
export function wholeDaysLeft(msLeft: number): number {
  return Math.max(0, Math.ceil(msLeft / DAY_MS));
}

/**
 * Time left until an instant, in the units a deadline is read in: "2d 4h",
 * "20h 5m", "9m".
 *
 * Deliberately a different register from `countdownLabel`, which answers "when
 * is my exam" in whole days; both live here so the day, hour and minute that
 * go into either answer come from one place.
 */
export function formatRemaining(msLeft: number): string {
  const left = Math.max(0, msLeft);
  const days = Math.floor(left / DAY_MS);
  const hours = Math.floor((left % DAY_MS) / HOUR_MS);
  const mins = Math.floor((left % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export interface NextExam {
  exam: ExamSchedule;
  startsAtMs: number;
  countdown: string;
  /**
   * True when VTOP published the date but no usable clock time. The countdown
   * then speaks about the day, not about an hour that was never given.
   */
  timePending: boolean;
}

/**
 * Every exam still ahead of the student, oldest date first.
 * Never invents data — only exams with a parseable date are candidates.
 *
 * An exam stays a candidate for the whole of its India calendar day when VTOP
 * gave no time: nothing in the data says the paper is over, and dropping it at
 * local midnight made the dashboard answer "what is my next exam" with "there
 * isn't one" on the morning of the exam. Once a time is published, the instant
 * is honoured and a paper already written drops out.
 */
export function upcomingExams(exams: ExamSchedule[], nowMs = Date.now()): NextExam[] {
  const todayIst = istDateLabel(new Date(nowMs));
  return exams
    .map((exam): NextExam | null => {
      const date = (exam.date || '').trim();
      if (!date) return null;
      const startsAtMs = examStartMs(date, exam.time);
      if (startsAtMs === null) return null;
      // The same predicate examStartMs uses, so the day-versus-instant rule
      // below can never disagree with the instant being compared.
      const timeKnown = !!exam.time && TIME_TOKEN.test(exam.time);
      if (!(timeKnown ? startsAtMs >= nowMs : date >= todayIst)) return null;
      return {
        exam,
        startsAtMs,
        timePending: !timeKnown,
        countdown: countdownLabel(startsAtMs, nowMs),
      };
    })
    .filter((x): x is NextExam => x !== null)
    .sort((a, b) => a.startsAtMs - b.startsAtMs);
}

/** The next upcoming exam chronologically, or null when there is none. */
export function nextUpcomingExam(exams: ExamSchedule[], nowMs = Date.now()): NextExam | null {
  return upcomingExams(exams, nowMs)[0] ?? null;
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
