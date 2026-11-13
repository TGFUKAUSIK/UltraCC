/**
 * smartNotifications.ts — local notification candidates across datasets.
 *
 * Pure candidate generation from already-synced VTOP data (assignments,
 * attendance, exams, marks) plus per-category preferences. Nothing here is
 * telemetry: state lives in localStorage on the device, content is
 * course/assignment names only, and a dedup ledger guarantees a candidate
 * fires at most once (no noise on re-render or re-sync).
 *
 * Categories (per-category preferences):
 *   assignments    — due soon (within 48h, pending only)
 *   attendance     — below VTOP's floor, at the urgency step attendanceBands sets
 *   exams          — within 3 days
 *   marks          — newly published marks since the last seen snapshot
 *   campusEvents   — important Event Hub events within 3 days
 *   timetable      — class reminders, ~10 minutes before each class starts
 *
 * Anti-noise rules baked in:
 *   - a candidate id fires at most once per device (dedup ledger)
 *   - each category is individually disableable
 *   - a hard per-day cap bounds total notifications
 */

import type { AssignmentTask, AttendanceRecord, ExamSchedule } from '../types';
import { attendanceComponent, componentLabel } from '../utils/attendanceComponents';
import { VTOP_ATTENDANCE_FLOOR, attendanceAlertUrgency, attendancePercentLabel } from '../utils/attendanceBands';
import { formatClassTime, getTimedDaySlots, minutesOfDay, timetableTimeToMinutes } from '../utils/timetableGrid';
import { calendarDaysUntil } from '../utils/examUtils';
import { localDateIso } from '../utils/localDate';

/**
 * The device's own day, written for a notification ledger key.
 *
 * Deliberately the device calendar rather than India's: a ledger id that
 * changed at 05:30 IST would let a class reminder fire twice in one morning
 * for a student whose phone is set to another zone.
 */
const isoDay = (ts: number): string => localDateIso(new Date(ts));

// ---------------------------------------------------------------------------
// Categories & preferences

export type NotificationCategory =
  | 'assignments'
  | 'attendance'
  | 'exams'
  | 'marks'
  | 'campusEvents'
  | 'timetable';

export const ALL_CATEGORIES: NotificationCategory[] = [
  'assignments', 'attendance', 'exams', 'marks', 'campusEvents', 'timetable',
];

export interface NotificationPrefs {
  enabled: boolean;
  categories: Record<NotificationCategory, boolean>;
  /** Max notifications surfaced per evaluation run. */
  maxPerRun: number;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  categories: {
    assignments: true,
    attendance: true,
    exams: true,
    marks: true,
    campusEvents: true,
    timetable: true,
  },
  maxPerRun: 5,
};

const PREFS_KEY = 'ultracc.notificationPrefs';
const LEDGER_KEY = 'ultracc.notificationLedger';
const MARKS_SEEN_KEY = 'ultracc.notificationMarksSeen';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — notifications simply don't persist
  }
}

export function loadNotificationPrefs(): NotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...readJson<Partial<NotificationPrefs>>(PREFS_KEY) };
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  writeJson(PREFS_KEY, prefs);
}

// ---------------------------------------------------------------------------
// Candidate model

export interface NotificationCandidate {
  /** Stable unique id — the dedup key. Encodes category + subject + day. */
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  urgency: 'info' | 'warning' | 'critical';
}

// ---------------------------------------------------------------------------
// Candidate generation (pure — takes data, returns candidates)

export interface SmartNotificationInput {
  assignments: AssignmentTask[];
  attendance: AttendanceRecord[];
  exams: ExamSchedule[];
  /** Marks snapshots keyed by course code — current state. */
  marksByCourse: Record<string, { totalScoredSoFar: number; estimatedGrade: string }>;
  campusEvents: Array<{ eid: string; title: string; date: string }>;
  /** Timetable rows are combined sessions — a 2-slot lab is ONE row. */
  timetable: Array<{ day: string; startTime: string; courseCode: string; venue?: string; endTime?: string; isLab?: boolean }>;
  now?: number;
}

export function generateNotificationCandidates(input: SmartNotificationInput): NotificationCandidate[] {
  const now = input.now ?? Date.now();
  const todayDay = new Date(now).toLocaleDateString('en-US', { weekday: 'long' });
  const out: NotificationCandidate[] = [];

  // Assignments due within ~48h (pending only). Date-only due dates mean
  // "due on that date", so urgency follows calendar days.
  for (const a of input.assignments) {
    if (a.status !== 'Pending') continue;
    const daysLeft = calendarDaysUntil(a.dueDate, now);
    if (daysLeft === null || daysLeft < 0 || daysLeft > 2) continue;
    const urgency = daysLeft === 0 ? 'critical' : daysLeft === 1 ? 'warning' : 'info';
    const when = daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : 'in 2 days';
    out.push({
      id: `assign:${a.id}:${isoDay(now)}`,
      category: 'assignments',
      title: `Assignment due ${when}: ${a.courseCode}`,
      body: `"${a.title}" is due ${when}${a.weightage ? ` (${a.weightage} weightage)` : ''}.`,
      urgency,
    });
  }

  // Attendance below VTOP's floor — one candidate per VTOP row, because
  // theory and lab are tracked separately and either half can be short on its
  // own. A component VTOP has not started yet is not "0% at risk". The floor and
  // the critical step both come from attendanceBands, so a notification can
  // never scream about a number the Academics cards call safe.
  for (const a of input.attendance) {
    if (!(a.totalHeld > 0) || a.percentage >= VTOP_ATTENDANCE_FLOOR) continue;
    const component = componentLabel(attendanceComponent(a));
    out.push({
      id: `attend:${a.courseCode}:${a.slot || component}:${isoDay(now)}`,
      category: 'attendance',
      title: `${component} attendance risk: ${a.courseCode}`,
      body: `${attendancePercentLabel(a.percentage)}% ${component.toLowerCase()} attendance in ${a.courseTitle || a.courseCode} (${a.attended}/${a.totalHeld} classes) — under VTOP’s ${VTOP_ATTENDANCE_FLOOR}% line.`,
      urgency: attendanceAlertUrgency(a.percentage),
    });
  }

  // Exams within 3 days
  for (const e of input.exams) {
    const daysLeft = calendarDaysUntil(e.date, now);
    if (daysLeft === null || daysLeft < 0 || daysLeft > 3) continue;
    out.push({
      id: `exam:${e.id}:${isoDay(now)}`,
      category: 'exams',
      title: daysLeft === 0 ? `Exam today: ${e.courseCode}` : `Exam in ${daysLeft} day${daysLeft === 1 ? '' : 's'}: ${e.courseCode}`,
      body: `${e.examType} for ${e.courseTitle || e.courseCode}${e.venue ? ` at ${e.venue}` : ''}${e.time ? `, ${e.time}` : ''}.`,
      urgency: daysLeft === 0 ? 'critical' : 'warning',
    });
  }

  // Newly published marks (diff against the last seen snapshot)
  const seen = readJson<Record<string, number>>(MARKS_SEEN_KEY) || {};
  for (const [courseCode, marks] of Object.entries(input.marksByCourse)) {
    const prev = seen[courseCode];
    if (prev !== undefined && marks.totalScoredSoFar > prev) {
      out.push({
        id: `marks:${courseCode}:${marks.totalScoredSoFar}`,
        category: 'marks',
        title: `New marks published: ${courseCode}`,
        body: `Internal total is now ${marks.totalScoredSoFar}${marks.estimatedGrade ? ` — estimated grade ${marks.estimatedGrade}` : ''}.`,
        urgency: 'info',
      });
    }
  }

  // Important campus events within 3 days
  for (const ev of input.campusEvents) {
    const daysLeft = calendarDaysUntil(ev.date, now);
    if (daysLeft === null || daysLeft < 0 || daysLeft > 3) continue;
    out.push({
      id: `event:${ev.eid}:${isoDay(now)}`,
      category: 'campusEvents',
      title: `Campus event: ${ev.title}`,
      body: daysLeft === 0 ? 'Happening today.' : `Coming up in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
      urgency: 'info',
    });
  }

  // Today's first class heads-up (once per day)
  const firstToday = getTimedDaySlots(input.timetable, todayDay)[0];
  if (firstToday) {
    out.push({
      id: `tt:${isoDay(now)}:${firstToday.courseCode}`,
      category: 'timetable',
      title: `First class: ${firstToday.courseCode}`,
      body: `Starts at ${formatClassTime(firstToday.startTime)}. Have a good day!`,
      urgency: 'info',
    });
  }

  // Class reminders — one per session, ~10 minutes before it starts (or as
  // soon as the app notices inside the final 10 minutes, e.g. after the tab
  // was asleep). Combined lab sessions are single rows, so a 2-period lab
  // gets exactly one reminder, never a second one for its next hour.
  const nowDate = new Date(now);
  const minutesNow = minutesOfDay(nowDate);
  for (const s of getTimedDaySlots(input.timetable, todayDay)) {
    const start = timetableTimeToMinutes(s.startTime);
    if (start === null) continue;
    const until = start - minutesNow;
    if (until <= 0 || until > 10) continue;
    out.push({
      id: `class:${isoDay(now)}:${s.courseCode}:${s.startTime}`,
      category: 'timetable',
      title: `Class soon: ${s.courseCode}`,
      body: `Starts in ${until} min${s.venue ? ` at ${s.venue}` : ''}${s.endTime ? ` · runs until ${formatClassTime(s.endTime, s.endTime)}` : ''}.`,
      urgency: 'warning',
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Delivery pipeline (dedup + prefs + cap)

export interface DeliveryResult {
  fired: NotificationCandidate[];
  /** Candidates suppressed by prefs, dedup or the cap — for debugging/UI. */
  suppressed: number;
}

/**
 * Evaluate candidates: filter by prefs, drop already-fired ids, cap the run,
 * then persist the ledger. Browser notifications fire only with permission;
 * the in-app bell always reflects the result.
 */
export function deliverNotifications(
  candidates: NotificationCandidate[],
  prefs: NotificationPrefs = loadNotificationPrefs(),
): DeliveryResult {
  if (!prefs.enabled) return { fired: [], suppressed: candidates.length };

  const ledger = readJson<Record<string, number>>(LEDGER_KEY) || {};
  const now = Date.now();
  const eligible = candidates.filter((c) => prefs.categories[c.category] !== false && !ledger[c.id]);
  const suppressed = candidates.length - eligible.length;
  const fired = eligible
    .sort((a, b) => urgencyRank(b.urgency) - urgencyRank(a.urgency))
    .slice(0, Math.max(1, prefs.maxPerRun));

  for (const c of fired) ledger[c.id] = now;
  writeJson(LEDGER_KEY, ledger);

  for (const c of fired) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(c.title, { body: c.body, icon: '/icon-192.svg', tag: c.id });
      } catch { /* best effort */ }
    }
  }
  return { fired, suppressed };
}

function urgencyRank(u: NotificationCandidate['urgency']): number {
  return u === 'critical' ? 3 : u === 'warning' ? 2 : 1;
}

/** Mark all current candidates as seen without firing (bell "mark read"). */
export function markAllSeen(candidates: NotificationCandidate[]): void {
  const ledger = readJson<Record<string, number>>(LEDGER_KEY) || {};
  const now = Date.now();
  for (const c of candidates) ledger[c.id] = ledger[c.id] ?? now;
  writeJson(LEDGER_KEY, ledger);
}

/** Record the current marks snapshot as "seen" (after showing marks notices). */
export function recordMarksSeen(marksByCourse: Record<string, { totalScoredSoFar: number }>): void {
  const seen = readJson<Record<string, number>>(MARKS_SEEN_KEY) || {};
  for (const [code, m] of Object.entries(marksByCourse)) seen[code] = m.totalScoredSoFar;
  writeJson(MARKS_SEEN_KEY, seen);
}

/** Test/diagnostic helper: clear the dedup ledger. */
export function clearNotificationLedger(): void {
  try { localStorage.removeItem(LEDGER_KEY); } catch { /* noop */ }
}
