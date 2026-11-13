/**
 * Free Classes analysis — per-day free-period detection for the Chennai FFCS
 * grid. A "free class" is a standard FFCS period on that weekday that has no
 * class scheduled. The period grid is not a second opinion about the week: it
 * is derived from the same Chennai slot map that gives a synced class its
 * hours, so a period the timing table does not know can never be counted free.
 */

import { theoryPeriodsForDay } from './chennaiSlotMap';
import { isUsableGap, timetableTimeToMinutes } from './timetableGrid';

export interface FreeClassPeriod {
  slot: string;
  start: string;
  end: string;
  /** true when a synced class occupies this period. */
  covered: boolean;
}

export interface FreeClassGap {
  start: string;
  end: string;
  minutes: number;
}

export interface FreeClassSummary {
  day: string;
  /**
   * Standard periods on that weekday, or null when the Chennai slot map has no
   * such day. Sunday is the live case: the timetable can carry Sunday classes,
   * but there is no period table to call them free or busy against, and
   * printing "0 / 0" read as a fully-occupied day to a student with nothing
   * scheduled.
   */
  totalPeriods: number | null;
  /** Periods with no class scheduled; null whenever `totalPeriods` is. */
  freeCount: number | null;
  /** Total free minutes across the usable gaps — exactly the sum of `gaps`. */
  freeMinutes: number;
  /**
   * The usable gaps themselves, in time order, within the stretch of the day
   * this app is allowed to describe: the slot map's period grid for that
   * weekday when there is one, otherwise the hours its own classes actually
   * fill.
   */
  gaps: FreeClassGap[];
  periods: FreeClassPeriod[];
}

/**
 * VTOP times as minutes past midnight, or null when the cell is blank or
 * malformed — a missing time is missing, not 00:00, and reading it as midnight
 * would drag a free period's start twelve hours into the night.
 */
function toMinutes(t: string): number | null {
  return timetableTimeToMinutes(t || '');
}

/** Minutes past midnight back into the "HH:MM" VTOP writes. */
const toClock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export interface TimetableLike {
  day: string;
  startTime: string;
  endTime: string;
}

/**
 * Compute the free-class summary for a weekday. A period counts as covered
 * when a class starts within ±12 minutes of the period start (handles slot-map
 * drift) OR sits inside a class's own start→end span — a two-slot lab runs
 * 14:00–15:45 and its second period is not free time.
 *
 * Free minutes are the gaps of `MIN_FREE_GAP_MINUTES` or more inside the day,
 * where classes running at the same time count as one block of busy time. The
 * day is bounded by VTOP's own period grid for that weekday, so the time before
 * the first class and after the last is free time too — a Saturday with no
 * classes at all is a day of free time, not a day with "no gap between
 * classes", which is what measuring only between classes used to report.
 */
export function computeFreeClasses(day: string, classes: TimetableLike[]): FreeClassSummary {
  const grid = theoryPeriodsForDay(day);
  const classStarts = classes
    .map((c) => toMinutes(c.startTime))
    .filter((m): m is number => m !== null);

  const spans = classes
    .map((c) => ({ s: toMinutes(c.startTime), e: toMinutes(c.endTime) }))
    .filter((sp): sp is { s: number; e: number } => sp.s !== null && sp.e !== null);

  const periods = grid.flatMap((p) => {
    const startMin = toMinutes(p.start);
    const endMin = toMinutes(p.end);
    // A grid row VTOP cannot give times to is not a period anyone can be free in.
    if (startMin === null || endMin === null) return [];
    const covered =
      classStarts.some((cs) => Math.abs(cs - startMin) <= 12) ||
      spans.some((sp) => sp.s <= startMin && endMin <= sp.e);
    return [{ ...p, covered }];
  });

  // Gaps of usable length, measured over merged busy blocks.
  // Overlapping sessions merge first. VTOP files a tutorial and a lab in the
  // same hour ("A1+TA1", "L31+L32"), so two rows can run at once; measuring
  // from the last row that STARTED rather than the class that actually ENDS
  // made the card promise free minutes the student did not have.
  const sorted = spans
    .filter((sp) => sp.e > sp.s)
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const busy: { s: number; e: number }[] = [];
  for (const span of sorted) {
    const current = busy[busy.length - 1];
    if (current && span.s <= current.e) {
      if (span.e > current.e) current.e = span.e;
    } else {
      busy.push({ s: span.s, e: span.e });
    }
  }

  // What the day covers: the grid's own hours when this app knows them, and
  // otherwise only the stretch VTOP's classes actually occupy. Sunday has no
  // standard FFCS grid, so borrowing Monday's would hand a student hours of
  // "free time" built from a schedule VTOP never published.
  const gridStarts = grid.map((p) => toMinutes(p.start)).filter((m): m is number => m !== null);
  const gridEnds = grid.map((p) => toMinutes(p.end)).filter((m): m is number => m !== null);
  const dayStart = gridStarts.length
    ? Math.min(...gridStarts)
    : (busy[0]?.s ?? null);
  const dayEnd = gridEnds.length
    ? Math.max(...gridEnds)
    : (busy[busy.length - 1]?.e ?? null);

  const gaps: FreeClassGap[] = [];
  if (dayStart !== null && dayEnd !== null && dayEnd > dayStart) {
    let cursor = dayStart;
    for (const span of busy) {
      const end = Math.min(Math.max(span.s, cursor), dayEnd);
      if (isUsableGap(end - cursor)) {
        gaps.push({ start: toClock(cursor), end: toClock(end), minutes: end - cursor });
      }
      cursor = Math.max(cursor, Math.min(span.e, dayEnd));
    }
    if (isUsableGap(dayEnd - cursor)) {
      gaps.push({ start: toClock(cursor), end: toClock(dayEnd), minutes: dayEnd - cursor });
    }
  }
  const freeMinutes = gaps.reduce((sum, gap) => sum + gap.minutes, 0);

  // A weekday with no readable period grid has no period count to report; "0"
  // is a claim about a full day, not an absence of data.
  const measurable = periods.length > 0;

  return {
    day,
    totalPeriods: measurable ? periods.length : null,
    freeCount: measurable ? periods.filter((p) => !p.covered).length : null,
    freeMinutes,
    gaps,
    periods,
  };
}
