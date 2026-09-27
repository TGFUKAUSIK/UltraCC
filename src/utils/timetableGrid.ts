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

const toMinutes = (value: string): number | null => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

export function sortTimetableSlots(slots: TimetableSlot[]): TimetableSlot[] {
  return [...slots].sort((a, b) => (
    (toMinutes(a.startTime) ?? Number.MAX_SAFE_INTEGER) - (toMinutes(b.startTime) ?? Number.MAX_SAFE_INTEGER)
    || (toMinutes(a.endTime) ?? Number.MAX_SAFE_INTEGER) - (toMinutes(b.endTime) ?? Number.MAX_SAFE_INTEGER)
    || a.courseCode.localeCompare(b.courseCode)
    || a.id.localeCompare(b.id)
  ));
}

export function getTimetableDaySlots(timetable: TimetableSlot[], day: TimetableSlot['day']): TimetableSlot[] {
  return sortTimetableSlots(timetable.filter((slot) => slot.day === day));
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
    if (!existing || (toMinutes(slot.endTime) ?? 0) > (toMinutes(existing.endTime) ?? 0)) {
      rows.set(slot.startTime, { startTime: slot.startTime, endTime: slot.endTime });
    }
  });
  return [...rows.values()].sort((a, b) => (toMinutes(a.startTime) ?? 0) - (toMinutes(b.startTime) ?? 0));
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
  const at = toMinutes(startTime);
  if (at === null) return [];
  return sortTimetableSlots(timetable.filter((slot) => {
    if (slot.day !== day) return false;
    const start = toMinutes(slot.startTime);
    const end = toMinutes(slot.endTime);
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
 * The break between two consecutive time rows. Reported only when no synced
 * class actually runs through it — the grid used to hardcode "Lunch 12:35–2:00,
 * no scheduled classes" beside a real 12:30–13:20 lab.
 */
export function getTimetableGap(
  timetable: TimetableSlot[],
  row: TimetableTimeRow,
  nextRow: TimetableTimeRow | undefined,
): TimetableGap | null {
  if (!nextRow) return null;
  const start = toMinutes(row.endTime);
  const end = toMinutes(nextRow.startTime);
  if (start === null || end === null || end - start < 45) return null;
  const overlaps = timetable.some((slot) => {
    const slotStart = toMinutes(slot.startTime);
    const slotEnd = toMinutes(slot.endTime);
    return slotStart !== null && slotEnd !== null && slotStart < end && slotEnd > start;
  });
  if (overlaps) return null;
  return { start: row.endTime, end: nextRow.startTime, minutes: end - start, isLunch: start < 780 && end > 720 };
}

export function currentTimetableDay(now = new Date()): TimetableSlot['day'] | null {
  const day = now.toLocaleDateString('en-US', { weekday: 'long' }) as TimetableSlot['day'];
  return ALL_WEEK_DAYS.includes(day) ? day : null;
}

export function isTimetableSlotOngoing(slot: TimetableSlot, now = new Date()): boolean {
  const today = currentTimetableDay(now);
  if (today !== slot.day) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(slot.startTime);
  const end = toMinutes(slot.endTime);
  return start !== null && end !== null && current >= start && current < end;
}

export function getNextTimetableSlot(slots: TimetableSlot[], now = new Date()): TimetableSlot | null {
  const today = currentTimetableDay(now);
  if (!today) return null;
  const current = now.getHours() * 60 + now.getMinutes();
  return getTimetableDaySlots(slots, today).find((slot) => {
    const start = toMinutes(slot.startTime);
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

