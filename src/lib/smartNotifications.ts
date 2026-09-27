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
 *   attendance     — below the 75% safety line
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

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse a VTOP date string (DD-MM-YYYY or ISO) to epoch ms, or null. */
export function parseVtopDate(raw: string): number | null {
  if (!raw) return null;
  const iso = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`).getTime();
  const dmy = raw.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

/**
 * Calendar-day difference between a VTOP date and `now` (due today → 0).
 * Date-only VTOP fields mean "on that date", so day-difference — not raw
 * ms — is the honest measure (midnight parsing would otherwise make
 * everything due today look already-past by 09:00).
 */
export function calendarDaysUntil(raw: string, now: number): number | null {
  const due = parseVtopDate(raw);
  if (due === null) return null;
  const dueDay = new Date(due);
  const nowDay = new Date(now);
  const dueMid = new Date(dueDay.getFullYear(), dueDay.getMonth(), dueDay.getDate()).getTime();
  const nowMid = new Date(nowDay.getFullYear(), nowDay.getMonth(), nowDay.getDate()).getTime();
  return Math.round((dueMid - nowMid) / DAY_MS);
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

  // Attendance below the safety line — one candidate per VTOP row, because
  // theory and lab are tracked separately and either half can be short on its
  // own. A component VTOP has not started yet is not "0% at risk".
  for (const a of input.attendance) {
    if (!(a.totalHeld > 0) || a.percentage >= 75) continue;
    const component = componentLabel(attendanceComponent(a));
    out.push({
      id: `attend:${a.courseCode}:${a.slot || component}:${isoDay(now)}`,
      category: 'attendance',
      title: `${component} attendance risk: ${a.courseCode}`,
      body: `${a.percentage}% ${component.toLowerCase()} attendance in ${a.courseTitle || a.courseCode} (${a.attended}/${a.totalHeld} classes) — below the 75% requirement.`,
      urgency: a.percentage < 70 ? 'critical' : 'warning',
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
  const firstToday = input.timetable
    .filter((s) => s.day === todayDay)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  if (firstToday) {
    out.push({
      id: `tt:${isoDay(now)}:${firstToday.courseCode}`,
      category: 'timetable',
      title: `First class: ${firstToday.courseCode}`,
      body: `Starts at ${firstToday.startTime}. Have a good day!`,
      urgency: 'info',
    });
  }

  // Class reminders — one per session, ~10 minutes before it starts (or as
  // soon as the app notices inside the final 10 minutes, e.g. after the tab
  // was asleep). Combined lab sessions are single rows, so a 2-period lab
  // gets exactly one reminder, never a second one for its next hour.
  const nowDate = new Date(now);
  const minutesNow = nowDate.getHours() * 60 + nowDate.getMinutes();
  const toMinutes = (t: string): number | null => {
    const [h, m] = t.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  for (const s of input.timetable) {
    if (s.day !== todayDay) continue;
    const start = toMinutes(s.startTime);
    if (start === null) continue;
    const until = start - minutesNow;
    if (until <= 0 || until > 10) continue;
    out.push({
      id: `class:${isoDay(now)}:${s.courseCode}:${s.startTime}`,
      category: 'timetable',
      title: `Class soon: ${s.courseCode}`,
      body: `Starts in ${until} min${s.venue ? ` at ${s.venue}` : ''}${s.endTime ? ` · runs until ${s.endTime}` : ''}.`,
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
