import type { TimetableSlot } from '../types';
import { sessionDurationMinutes } from './labSessions';

export const TIMETABLE_DAYS: TimetableSlot['day'][] = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

export const ALL_WEEK_DAYS: TimetableSlot['day'][] = [...TIMETABLE_DAYS, 'Sunday'];

/** Days to render: Mon–Sat, plus Sunday only when the synced timetable has it. */
export function getTimetableDays(slots: TimetableSlot[]): TimetableSlot['day'][] {
  return slots.some((slot) => slot.day === 'Sunday') ? ALL_WEEK_DAYS : TIMETABLE_DAYS;
}

export interface TimetableTimeRow {
  startTime: string;
  endTime: string;
}

export const timetableTimeToMinutes = (value: string): number | null => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

/**
 * Where a clock sits on that same minutes-past-midnight axis.
 *
 * Every "is this class running?", "how soon does it start?" and "which period
 * is now" in the app compares two numbers produced by `timetableTimeToMinutes`,
 * so the device's own time has to be converted the same way. It was written out
 * by hand in five places; one call keeps them on one axis, and keeps a future
 * change — reading VTOP's IST instead of the device, say — a one-line edit
 * rather than a hunt.
 */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * A class time written the way students read a timetable — "14:00" becomes
 * "2:00 PM". VTOP only ever gives one time per session, so every screen and
 * every reminder quotes the same one; the fallback is up to the surface,
 * because a missing time means something different in a grid cell than it does
 * in a push body.
 */
export function formatClassTime(value: string, fallback = ''): string {
  const match = (value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function sortTimetableSlots(slots: TimetableSlot[]): TimetableSlot[] {
  return [...slots].sort((a, b) => (
    (timetableTimeToMinutes(a.startTime) ?? Number.MAX_SAFE_INTEGER) - (timetableTimeToMinutes(b.startTime) ?? Number.MAX_SAFE_INTEGER)
    || (timetableTimeToMinutes(a.endTime) ?? Number.MAX_SAFE_INTEGER) - (timetableTimeToMinutes(b.endTime) ?? Number.MAX_SAFE_INTEGER)
    || a.courseCode.localeCompare(b.courseCode)
    || a.id.localeCompare(b.id)
  ));
}

export function getTimetableDaySlots(timetable: TimetableSlot[], day: TimetableSlot['day']): TimetableSlot[] {
  return sortTimetableSlots(timetable.filter((slot) => slot.day === day));
}

/**
 * A day's sessions in class order, for any shape that carries a day and a start
 * time. Rows VTOP left without a start time are dropped instead of guessed at:
 * they belong at no hour, and comparing them as text puts them at the head of
 * the day — so a "first class today" built this way names a real class and a
 * real time.
 */
export function getTimedDaySlots<T extends { day: string; startTime: string }>(slots: T[], day: string): T[] {
  return slots
    .filter((slot) => slot.day === day && timetableTimeToMinutes(slot.startTime) !== null)
    .sort((a, b) => (timetableTimeToMinutes(a.startTime) ?? 0) - (timetableTimeToMinutes(b.startTime) ?? 0));
}

/**
 * Builds rows only from real VTOP start/end times. No empty classes or guessed
 * periods are introduced. A session's full endTime is retained so 2-period lab
 * sessions remain visibly longer than a normal 1-slot theory class.
 */
export function getTimetableTimeRows(timetable: TimetableSlot[]): TimetableTimeRow[] {
  const rows = new Map<string, TimetableTimeRow>();
  timetable.forEach((slot) => {
    if (!slot.startTime || !slot.endTime) return;
    const existing = rows.get(slot.startTime);
    if (!existing || (timetableTimeToMinutes(slot.endTime) ?? 0) > (timetableTimeToMinutes(existing.endTime) ?? 0)) {
      rows.set(slot.startTime, { startTime: slot.startTime, endTime: slot.endTime });
    }
  });
  return [...rows.values()].sort((a, b) => (timetableTimeToMinutes(a.startTime) ?? 0) - (timetableTimeToMinutes(b.startTime) ?? 0));
}

export function getTimetableCellSlots(timetable: TimetableSlot[], day: TimetableSlot['day'], startTime: string): TimetableSlot[] {
  return sortTimetableSlots(timetable.filter((slot) => slot.day === day && slot.startTime === startTime));
}

/**
 * Slots that are still running when this row starts without beginning in it —
 * a two-period lab (09:45–11:10) also covers the 10:35 row. The week grid used
 * to print "Free" in that cell, contradicting the class card one row above.
 */
export function getTimetableContinuationSlots(
  timetable: TimetableSlot[],
  day: TimetableSlot['day'],
  startTime: string,
): TimetableSlot[] {
  const at = timetableTimeToMinutes(startTime);
  if (at === null) return [];
  return sortTimetableSlots(timetable.filter((slot) => {
    if (slot.day !== day) return false;
    const start = timetableTimeToMinutes(slot.startTime);
    const end = timetableTimeToMinutes(slot.endTime);
    return start !== null && end !== null && start < at && end > at;
  }));
}

export interface TimetableGap {
  start: string;
  end: string;
  minutes: number;
  isLunch: boolean;
}

/**
 * The shortest break worth telling a student about, in minutes.
 *
 * This number used to live twice: the weekly grid printed a Break row only from
 * 45 minutes up, while the "free time today" card under the very same table
 * listed gaps from 40. A 42-minute hole in the day was therefore both a usable
 * gap and not one. One constant, read by both surfaces, so they cannot drift
 * apart again — and the card quotes it rather than restating a digit.
 */
export const MIN_FREE_GAP_MINUTES = 40;

/** Is a break of this length something a student can actually use? */
export function isUsableGap(minutes: number): boolean {
  return minutes >= MIN_FREE_GAP_MINUTES;
}

/**
 * The break between two consecutive time rows. Reported only when no synced
 * class actually runs through it — the grid used to hardcode "Lunch 12:35–2:00,
 * no scheduled classes" beside a real 12:30–13:20 lab.
 *
 * `timetable` spans the whole week and this row spans the whole week too, so a
 * class on any day hides it; that is why the grid's label says which days the
 * claim covers. The length rule is the shared `isUsableGap`, the same one the
 * per-day free-time card applies.
 */
export function getTimetableGap(
  timetable: TimetableSlot[],
  row: TimetableTimeRow,
  nextRow: TimetableTimeRow | undefined,
): TimetableGap | null {
  if (!nextRow) return null;
  const start = timetableTimeToMinutes(row.endTime);
  const end = timetableTimeToMinutes(nextRow.startTime);
  if (start === null || end === null || !isUsableGap(end - start)) return null;
  const overlaps = timetable.some((slot) => {
    const slotStart = timetableTimeToMinutes(slot.startTime);
    const slotEnd = timetableTimeToMinutes(slot.endTime);
    return slotStart !== null && slotEnd !== null && slotStart < end && slotEnd > start;
  });
  if (overlaps) return null;
  return { start: row.endTime, end: nextRow.startTime, minutes: end - start, isLunch: start < 780 && end > 720 };
}

export function currentTimetableDay(now = new Date()): TimetableSlot['day'] | null {
  const day = now.toLocaleDateString('en-US', { weekday: 'long' }) as TimetableSlot['day'];
  return ALL_WEEK_DAYS.includes(day) ? day : null;
}

/**
 * Any row the "is it running right now?" question can be asked of. The full
 * VTOP record satisfies this; the header's compact notification shape does too,
 * so one implementation of the ongoing rule serves every surface that asks it.
 */
export type TimetableTimeCell = { day: string; startTime: string; endTime: string };

export function isTimetableSlotOngoing(slot: TimetableTimeCell, now = new Date()): boolean {
  const today = currentTimetableDay(now);
  if (today !== slot.day) return false;
  const current = minutesOfDay(now);
  const start = timetableTimeToMinutes(slot.startTime);
  const end = timetableTimeToMinutes(slot.endTime);
  return start !== null && end !== null && current >= start && current < end;
}

export function getNextTimetableSlot(slots: TimetableSlot[], now = new Date()): TimetableSlot | null {
  const today = currentTimetableDay(now);
  if (!today) return null;
  const current = minutesOfDay(now);
  return getTimetableDaySlots(slots, today).find((slot) => {
    const start = timetableTimeToMinutes(slot.startTime);
    return start !== null && start > current;
  }) || null;
}

/**
 * Find the session covering `now` — including a 2-period lab session whose
 * second hour is in progress. `isTimetableSlotOngoing` answers per-slot;
 * this answers "what class am I in right now" over whole sessions.
 */
export function getOngoingTimetableSlot(slots: TimetableSlot[], now = new Date()): TimetableSlot | null {
  const today = currentTimetableDay(now);
  if (!today) return null;
  return getTimetableDaySlots(slots, today).find(
    (slot) => isTimetableSlotOngoing(slot, now),
  ) ?? null;
}

/** Duration of a class session in minutes (null when times are absent). */
export function timetableSessionDuration(slot: TimetableSlot): number | null {
  return sessionDurationMinutes(slot);
}

