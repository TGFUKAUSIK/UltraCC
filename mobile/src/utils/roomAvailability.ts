/**
 * roomAvailability.ts — Free Classrooms & Labs for the phone.
 *
 * Ported from the web engine (src/utils/roomAvailability.ts) with the same
 * rules and the same two data files, so the app and the site answer identically:
 *
 *   - A room is BUSY for a period when ANY scheduled class (theory OR lab)
 *     occupies it, and FREE otherwise. Nothing is invented.
 *   - Periods and slot→time mappings come ONLY from the authoritative Chennai
 *     FFCS slot grid, so theory slots (A1, TB2, …) and lab slots (L1..L60) are
 *     both honoured.
 *   - Campus-wide occupancy is precomputed from the FFCS course catalogue
 *     (every row pairs a VENUE with SLOT tokens like "F1+TF1", "L31+L32").
 *     Without it, every room the student is not standing in would read "free".
 *   - The student's own timetable rows are unioned on top, so an in-person
 *     class the catalogue misses still shows busy.
 *
 * The mobile catalogue is the web's rows reduced to VENUE + SLOT and
 * de-duplicated (84 KB instead of 347 KB) — occupancy is a set, so the
 * reduction cannot change an answer. parity with the web engine is enforced by
 * src/lib/__tests__/mobileRoomAvailability.test.ts.
 */

import slotGridJson from '../data/ffcs-slot-grid-chennai.json';
import catalogueJson from '../data/ffcs-catalogue-chennai.json';

// ---------------------------------------------------------------------------
// Time helpers (the same conversion the web planner uses)
// ---------------------------------------------------------------------------

/** "08:00 AM" / "1:30 PM" → "08:00" / "13:30". Anything else passes through. */
export function to24h(t: string): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

// ---------------------------------------------------------------------------
// Grid → periods (the single source of period/slot truth)
// ---------------------------------------------------------------------------

interface GridRow { start?: string; end?: string; days?: Record<string, string>; lunch?: boolean }
const GRID = slotGridJson as { theory: GridRow[]; lab: GridRow[] };

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type RoomDay = (typeof DAY_KEYS)[number] & string;

/** Internal day ids used by the UI (short codes). */
export const ROOM_DAYS: { id: RoomDay; label: string }[] = [
  { id: 'mon', label: 'Monday' },
  { id: 'tue', label: 'Tuesday' },
  { id: 'wed', label: 'Wednesday' },
  { id: 'thu', label: 'Thursday' },
  { id: 'fri', label: 'Friday' },
  { id: 'sat', label: 'Saturday' },
];

/** One schedulable period on one weekday, with the slots active in it. */
export interface RoomPeriod {
  /** Monotonic index within the day (used as the UI value). */
  idx: number;
  /** "08:00" */
  start: string;
  /** "08:50" */
  end: string;
  /** Minutes since midnight (for "now" comparisons). */
  startMin: number;
  endMin: number;
  /** True for the lunch interval (no classes scheduled). */
  lunch: boolean;
  /** Theory slots active this period on this day (e.g. "A1", "TB2"). */
  theorySlots: string[];
  /** Lab slots active this period on this day (e.g. "L31", "L4"). */
  labSlots: string[];
}

/** Periods per weekday derived from the grid, indexed 0..N per day. */
const PERIODS_BY_DAY: Record<RoomDay, RoomPeriod[]> = (() => {
  const out = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] } as Record<RoomDay, RoomPeriod[]>;
  // The grid describes Mon–Fri; Saturday carries evening slots only where
  // published. A day with no grid rows yields no periods (callers show an
  // honest "no schedule" state rather than fabricating one).
  const gridDays: RoomDay[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

  const toMinutes = (hhmm: string): number => {
    const [h, m] = to24h(hhmm).split(':').map(Number);
    return h * 60 + m;
  };

  for (const day of gridDays) {
    // Theory rows and lab rows share a period NUMBER but not a wall clock: VTOP
    // starts several lab periods five minutes before the theory class numbered
    // with them. A period's span is therefore the union of the two rows, so a
    // room is only ever listed as free when neither kind of class can be inside
    // it. Mirrors the web engine; the parity guard compares them cell by cell.
    const theoryRows = GRID.theory.filter((r) => !r.lunch && r.start && r.end);
    const labRows = GRID.lab.filter((r) => !r.lunch && r.start && r.end);
    const rowCount = Math.max(theoryRows.length, labRows.length);
    let idx = 0;
    for (let i = 0; i < rowCount; i++) {
      const tRow = theoryRows[i];
      const lRow = labRows[i];
      if (!tRow && !lRow) continue;
      const spans = [tRow, lRow].filter((r): r is GridRow => Boolean(r));
      const start = spans.reduce((a, b) => (toMinutes(a.start!) <= toMinutes(b.start!) ? a : b)).start!;
      const end = spans.reduce((a, b) => (toMinutes(a.end!) >= toMinutes(b.end!) ? a : b)).end!;
      const theorySlots: string[] = [];
      const labSlots: string[] = [];
      if (tRow?.days?.[day]) theorySlots.push(String(tRow.days[day]).toUpperCase());
      if (lRow?.days?.[day]) labSlots.push(String(lRow.days[day]).toUpperCase());
      out[day].push({
        idx: idx++,
        start: to24h(start),
        end: to24h(end),
        startMin: toMinutes(start),
        endMin: toMinutes(end),
        lunch: false,
        theorySlots,
        labSlots,
      });
    }
  }
  return out;
})();

/** Periods for a weekday (empty array when the day has no grid). */
export function periodsForDay(day: RoomDay): RoomPeriod[] {
  return PERIODS_BY_DAY[day] ?? [];
}

/**
 * How early a period already counts as "now" — the same walk-up the site uses,
 * so a student on the phone and a classmate on the web get one answer.
 */
export const PERIOD_START_GRACE_MINUTES = 10;

/** Index of the period running at `nowMin` (including its walk-up), else −1. */
export function currentPeriodIndex(day: RoomDay, nowMin: number): number {
  const periods = periodsForDay(day);
  return periods.findIndex(
    (p) => !p.lunch && nowMin >= p.startMin - PERIOD_START_GRACE_MINUTES && nowMin < p.endMin,
  );
}

// ---------------------------------------------------------------------------
// Rooms + occupancy
// ---------------------------------------------------------------------------

/** Rooms worth listing: catalogue venues + whatever the student attends. */
export function allKnownRooms(timetableVenues: string[]): string[] {
  const rooms = new Set<string>();
  for (const v of catalogueJson as { VENUE?: string }[]) {
    const room = normalizeRoom(v.VENUE || '');
    if (room) rooms.add(room);
  }
  for (const v of timetableVenues) {
    const room = normalizeRoom(v || '');
    if (room) rooms.add(room);
  }
  return [...rooms].sort();
}

/** Uppercase, whitespace-collapsed room name; junk rows dropped. */
export function normalizeRoom(venue: string): string {
  const v = (venue || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!v) return '';
  // Honest filters — VTOP/catalogue junk, not real rooms.
  if (v === 'NIL' || v === 'N/A' || v === 'NA' || v === 'TBA' || v === '-') return '';
  // Bare block prefixes ("AB3", "ADB") or bare numbers ("001") are not rooms.
  if (/^\d+$/.test(v)) return '';
  if (!v.includes('-') && v.length <= 4) return '';
  return v;
}

/** Block prefix of a room ("AB1-203A" → "AB1"); rooms without one → "Other". */
export function roomBlock(room: string): string {
  const i = room.indexOf('-');
  return i > 0 ? room.slice(0, i) : 'Other';
}

/** Lab-ish room (for the Theory/Lab split in the UI). */
export function isLabRoom(room: string): boolean {
  return /LAB|WORKSHOP/i.test(room);
}

// ---------------------------------------------------------------------------
// Campus-wide occupancy (FFCS course catalogue)
// ---------------------------------------------------------------------------

/**
 * Every slot token → the (day, period index) cells it occupies, inverted from
 * PERIODS_BY_DAY. A theory slot like "A1" appears in the grid on both Monday
 * 08:00 and Wednesday 08:55, so it maps to BOTH cells; lab slots (L1..L60) map
 * to their single cell. Tokens absent from the grid (catalogue junk such as
 * "NIL" or "-") are simply never present here.
 */
const SLOT_TO_CELLS: Map<string, { day: RoomDay; periodIdx: number }[]> = (() => {
  const map = new Map<string, { day: RoomDay; periodIdx: number }[]>();
  for (const day of Object.keys(PERIODS_BY_DAY) as RoomDay[]) {
    for (const period of PERIODS_BY_DAY[day]) {
      for (const slot of [...period.theorySlots, ...period.labSlots]) {
        const list = map.get(slot);
        if (list) list.push({ day, periodIdx: period.idx });
        else map.set(slot, [{ day, periodIdx: period.idx }]);
      }
    }
  }
  return map;
})();

/**
 * Rooms the FFCS catalogue schedules, indexed day → room → occupied period
 * indices. Built once at module load: every VENUE + SLOT pair is expanded
 * through SLOT_TO_CELLS and the venue marked busy in every matching cell.
 */
const CATALOGUE_OCCUPANCY: Map<RoomDay, Map<string, Set<number>>> = (() => {
  const byDay = new Map<RoomDay, Map<string, Set<number>>>();
  const mark = (day: RoomDay, room: string, periodIdx: number) => {
    let rooms = byDay.get(day);
    if (!rooms) { rooms = new Map(); byDay.set(day, rooms); }
    let periods = rooms.get(room);
    if (!periods) { periods = new Set(); rooms.set(room, periods); }
    periods.add(periodIdx);
  };
  for (const entry of catalogueJson as { VENUE?: string; SLOT?: string }[]) {
    const room = normalizeRoom(entry.VENUE || '');
    if (!room) continue;
    const tokens = (entry.SLOT || '').split('+').map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (!tokens.length) continue;
    for (const token of tokens) {
      const cells = SLOT_TO_CELLS.get(token);
      if (!cells) continue;
      for (const cell of cells) mark(cell.day, room, cell.periodIdx);
    }
  }
  return byDay;
})();

/**
 * Rooms the FFCS catalogue schedules on `day` during the period at
 * `periodIdx` — the campus-wide occupancy the free-classrooms view unions with
 * the student's own timetable.
 */
export function catalogueOccupiedRooms(day: RoomDay, periodIdx: number): Set<string> {
  const rooms = CATALOGUE_OCCUPANCY.get(day);
  const occupied = new Set<string>();
  if (!rooms) return occupied;
  for (const [room, periods] of rooms) {
    if (periods.has(periodIdx)) occupied.add(room);
  }
  return occupied;
}

/**
 * Which of the student's own rooms are occupied on `day` at `periodIdx`. A row
 * occupies the room when any of its slot tokens matches the period's theory OR
 * lab slot; slot strings may be "A1", "L31+L32", "MON/A1+B1" or "A1+L4".
 */
export function occupiedRoomsForPeriod(
  timetableRows: { slot: string; venue?: string; room?: string }[],
  day: RoomDay,
  periodIdx: number,
): Set<string> {
  const period = periodsForDay(day)[periodIdx];
  const occupied = new Set<string>();
  if (!period) return occupied;
  const active = new Set([...period.theorySlots, ...period.labSlots]);
  if (active.size === 0) return occupied;

  for (const row of timetableRows) {
    const room = normalizeRoom(row.venue || row.room || '');
    if (!room) continue;
    const tokens = (row.slot || '')
      .replace(/^[A-Za-z]{3}\//, '') // strip an optional day prefix ("MON/")
      .split('+')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    if (tokens.some((t) => active.has(t))) occupied.add(room);
  }
  return occupied;
}
