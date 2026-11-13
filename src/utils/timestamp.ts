/**
 * One timestamp format for the whole portal.
 *
 * Six views printed `new Date(x).toLocaleString()`, which renders whatever the
 * device's locale decides — "5/10/2026, 5:31:02 PM" on one phone and
 * "10/5/2026, 17:31:02" on another — and always with seconds, which no student
 * reads. Two more views kept private copies of the short form. A "last synced"
 * line is data, so it gets one rule and one shape here: day, short month, and
 * the hour the student's own clock shows.
 *
 * The stamp is an instant, so it is printed in the device's timezone on purpose:
 * a sync that happened at 18:00 IST is "6:00 PM" for a student in Chennai and
 * "12:30 PM" for one on a plane, and both are true. What must not vary is the
 * format.
 */

import { localDateIso } from './localDate';

/** An unparseable or missing stamp is a gap, not a lie. */
const EMPTY = '—';

function parts(date: Date): { dayMonth: string; year: string; time: string } {
  return {
    dayMonth: date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    year: date.toLocaleDateString('en-IN', { year: 'numeric' }),
    time: date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }),
  };
}

function parse(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "5 Oct, 5:31 PM" — and the year when it is not the year the student is in. */
export function formatTimestamp(value: string | number | Date | null | undefined, now: Date = new Date()): string {
  const d = parse(value);
  if (!d) return EMPTY;
  const { dayMonth, year, time } = parts(d);
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${dayMonth}, ${time}` : `${dayMonth} ${year}, ${time}`;
}

/**
 * "today, 5:31 PM" / "yesterday, 9:05 AM" / otherwise the date. For the
 * "last synced" stamps, where the distance from now is the information: a
 * student deciding whether to re-sync cares that it was this morning, not that
 * it was 05/10/2026.
 *
 * Lowercase on purpose — every call site reads "Synced today, 5:31 PM", and a
 * capital T in the middle of that sentence is a grammar error six pages deep.
 */
export function formatSyncStamp(value: string | number | Date | null | undefined, now: Date = new Date()): string {
  const d = parse(value);
  if (!d) return EMPTY;
  const { time } = parts(d);
  const days = daysBetween(localDateIso(d), localDateIso(now));
  if (days === 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  return formatTimestamp(d, now);
}

/** Whole days from the earlier local date to the later one; negative becomes 0. */
function daysBetween(earlierIso: string, laterIso: string): number {
  const a = Date.parse(`${earlierIso}T00:00:00`);
  const b = Date.parse(`${laterIso}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  const days = Math.round((b - a) / 86_400_000);
  return days > 0 ? days : 0;
}
