import { TimetableSlot } from '../types';
import { combineLabSessions } from '../../../utils/labSessions';
import {
  parseDocument,
  cellText,
  parseOutcome,
  ParseOutcome,
  to24hTime,
  isLikelyLoginPage,
  isLikelySessionExpiredPage,
  normalizeHeader,
} from './helpers';

/**
 * Standard VIT FFCS slot timings (VIT Chennai). These are public scheduling
 * facts, reproduced independently. Slots rotate per weekday, e.g. Monday
 * starts with A1 at 08:00 while Tuesday starts with B1.
 *
 * Used only to enrich rows that VTOP does not render a time column for
 * (the fallback row-list shape). The real timetable grid carries explicit
 * start/end times, which always win.
 */
export const FFCS_SLOT_TIMES: Record<string, Record<string, { start: string; end: string }>> = {
  Monday: {
    A1: { start: '08:00', end: '08:50' }, F1: { start: '08:55', end: '09:45' }, D1: { start: '09:50', end: '10:40' },
    TB1: { start: '10:45', end: '11:35' }, TG1: { start: '11:40', end: '12:30' },
    A2: { start: '14:00', end: '14:50' }, F2: { start: '14:55', end: '15:45' }, D2: { start: '15:50', end: '16:40' },
    TB2: { start: '16:45', end: '17:35' }, TG2: { start: '17:40', end: '18:30' },
  },
  Tuesday: {
    B1: { start: '08:00', end: '08:50' }, G1: { start: '08:55', end: '09:45' }, E1: { start: '09:50', end: '10:40' },
    TC1: { start: '10:45', end: '11:35' }, TAA1: { start: '11:40', end: '12:30' },
    B2: { start: '14:00', end: '14:50' }, G2: { start: '14:55', end: '15:45' }, E2: { start: '15:50', end: '16:40' },
    TC2: { start: '16:45', end: '17:35' }, TAA2: { start: '17:40', end: '18:30' },
  },
  Wednesday: {
    C1: { start: '08:00', end: '08:50' }, A1: { start: '08:55', end: '09:45' }, F1: { start: '09:50', end: '10:40' },
    TD1: { start: '10:45', end: '11:35' }, TBB1: { start: '11:40', end: '12:30' },
    C2: { start: '14:00', end: '14:50' }, A2: { start: '14:55', end: '15:45' }, F2: { start: '15:50', end: '16:40' },
    TD2: { start: '16:45', end: '17:35' }, TBB2: { start: '17:40', end: '18:30' },
  },
  Thursday: {
    D1: { start: '08:00', end: '08:50' }, B1: { start: '08:55', end: '09:45' }, G1: { start: '09:50', end: '10:40' },
    TE1: { start: '10:45', end: '11:35' }, TCC1: { start: '11:40', end: '12:30' },
    D2: { start: '14:00', end: '14:50' }, B2: { start: '14:55', end: '15:45' }, G2: { start: '15:50', end: '16:40' },
    TE2: { start: '16:45', end: '17:35' }, TCC2: { start: '17:40', end: '18:30' },
  },
  Friday: {
    E1: { start: '08:00', end: '08:50' }, C1: { start: '08:55', end: '09:45' }, TA1: { start: '09:50', end: '10:40' },
    TF1: { start: '10:45', end: '11:35' }, TDD1: { start: '11:40', end: '12:30' },
    E2: { start: '14:00', end: '14:50' }, C2: { start: '14:55', end: '15:45' }, TA2: { start: '15:50', end: '16:40' },
    TF2: { start: '16:45', end: '17:35' }, TDD2: { start: '17:40', end: '18:30' },
  },
  Saturday: {
    X11: { start: '08:00', end: '08:50' }, X12: { start: '08:55', end: '09:45' }, Y11: { start: '09:50', end: '10:40' },
    Y12: { start: '10:45', end: '11:35' },
    X21: { start: '14:00', end: '14:50' }, Z21: { start: '14:55', end: '15:45' }, Y21: { start: '15:50', end: '16:40' },
    W21: { start: '16:45', end: '17:35' }, W22: { start: '17:40', end: '18:30' }, Z22: { start: '18:35', end: '19:25' },
  },
  Sunday: {
    Y11: { start: '08:00', end: '08:50' }, Y12: { start: '08:55', end: '09:45' }, X11: { start: '09:50', end: '10:40' },
    X12: { start: '10:45', end: '11:35' },
    Y21: { start: '14:00', end: '14:50' }, Z21: { start: '14:55', end: '15:45' }, X21: { start: '15:50', end: '16:40' },
    W21: { start: '16:45', end: '17:35' }, W22: { start: '17:40', end: '18:30' }, Z22: { start: '18:35', end: '19:25' },
  },
};

/** Lab slots run 50-60 minute blocks across the day; approximate mapping. */
const LAB_SLOT_TIMES: Record<string, { start: string; end: string }> = {
  L1: { start: '08:00', end: '08:50' }, L2: { start: '08:50', end: '09:40' },
  L3: { start: '09:50', end: '10:40' }, L4: { start: '10:40', end: '11:30' },
  L5: { start: '11:40', end: '12:30' }, L6: { start: '12:30', end: '13:20' },
  L31: { start: '14:00', end: '14:50' }, L32: { start: '14:50', end: '15:40' },
  L33: { start: '15:50', end: '16:40' }, L34: { start: '16:40', end: '17:30' },
  L35: { start: '17:40', end: '18:30' }, L36: { start: '18:30', end: '19:20' },
};

/**
 * Authoritative VIT Chennai slot → day/time timings (public scheduling facts
 * for VIT Chennai students). Slot letter determines meeting days AND times:
 * A1 meets Mon 08:00–08:50 and Wed 08:55–09:45; L31 is Mon 14:00–14:50.
 */
const CHENNAI_SLOT_TIMES: Record<string, Record<string, string>> = {
  MON: { A1: '8:00-8:50', F1: '8:55-9:45', D1: '9:50-10:40', TB1: '10:45-11:35', TG1: '11:40-12:30', A2: '2:00-2:50', F2: '2:55-3:45', D2: '3:50-4:40', TB2: '4:45-5:35', TG2: '5:40-6:30', L1: '8:00-8:50', L2: '8:50-9:40', L3: '9:50-10:40', L4: '10:40-11:30', L5: '11:40-12:30', L6: '12:30-1:20', L31: '2:00-2:50', L32: '2:50-3:40', L33: '3:50-4:40', L34: '4:40-5:30', L35: '5:40-6:30', L36: '6:30-7:20' },
  TUE: { B1: '8:00-8:50', G1: '8:55-9:45', E1: '9:50-10:40', TC1: '10:45-11:35', TAA1: '11:40-12:30', B2: '2:00-2:50', G2: '2:55-3:45', E2: '3:50-4:40', TC2: '4:45-5:35', TAA2: '5:40-6:30', L7: '8:00-8:50', L8: '8:50-9:40', L9: '9:50-10:40', L10: '10:40-11:30', L11: '11:40-12:30', L37: '2:00-2:50', L38: '2:50-3:40', L39: '3:50-4:40', L40: '4:40-5:30', L41: '5:40-6:30', L42: '6:30-7:20' },
  WED: { C1: '8:00-8:50', A1: '8:55-9:45', F1: '9:50-10:40', TD1: '10:45-11:35', TBB1: '11:40-12:30', C2: '2:00-2:50', A2: '2:55-3:45', F2: '3:50-4:40', TD2: '4:45-5:35', TBB2: '5:40-6:30', L13: '8:00-8:50', L14: '8:50-9:40', L15: '9:50-10:40', L16: '10:40-11:30', L17: '11:40-12:30', L43: '2:00-2:50', L44: '2:50-3:40', L45: '3:50-4:40', L46: '4:40-5:30', L47: '5:40-6:30', L48: '6:30-7:20' },
  THU: { D1: '8:00-8:50', B1: '8:55-9:45', G1: '9:50-10:40', TE1: '10:45-11:35', TCC1: '11:40-12:30', D2: '2:00-2:50', B2: '2:55-3:45', G2: '3:50-4:40', TE2: '4:45-5:35', TCC2: '5:40-6:30', L19: '8:00-8:50', L20: '8:50-9:40', L21: '9:50-10:40', L22: '10:40-11:30', L23: '11:40-12:30', L49: '2:00-2:50', L50: '2:50-3:40', L51: '3:50-4:40', L52: '4:40-5:30', L53: '5:40-6:30', L54: '6:30-7:20' },
  FRI: { E1: '8:00-8:50', C1: '8:55-9:45', TA1: '9:50-10:40', TF1: '10:45-11:35', TDD1: '11:40-12:30', E2: '2:00-2:50', C2: '2:55-3:45', TA2: '3:50-4:40', TF2: '4:45-5:35', TDD2: '5:40-6:30', L25: '8:00-8:50', L26: '8:50-9:40', L27: '9:50-10:40', L28: '10:40-11:30', L29: '11:40-12:30', L30: '12:30-1:20', L55: '2:00-2:50', L56: '2:50-3:40', L57: '3:50-4:40', L58: '4:40-5:30', L59: '5:40-6:30', L60: '6:30-7:20' },
  SAT: { X11: '8:00-8:50', X12: '8:55-9:45', Y11: '9:50-10:40', Y12: '10:45-11:35', X21: '2:00-2:50', Z21: '2:55-3:45', Y21: '3:50-4:40', W21: '4:45-5:35', W22: '5:40-6:30', Z22: '6:35-7:25', L71: '8:00-8:50', L72: '8:50-9:40', L73: '9:50-10:40', L74: '10:40-11:30', L75: '11:40-12:30', L76: '12:30-1:20', L77: '2:00-2:50', L78: '2:50-3:40', L79: '3:50-4:40', L80: '4:40-5:30', L81: '5:40-6:30', L82: '6:30-7:20' },
};

const GRID_WEEKDAYS: Record<string, string> = {
  SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday',
  THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday',
};

/** Chennai schedules use 12-hour times with afternoon slots written 1:xx–7:xx. */
function to24hSlotTime(t: string): string {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  if (h < 8) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** Every weekly (day, start, end) meeting for a slot code. */
function slotDayTimes(slot: string): { day: string; start: string; end: string }[] {
  const key = (slot || '').trim().toUpperCase();
  const out: { day: string; start: string; end: string }[] = [];
  for (const [day, slots] of Object.entries(CHENNAI_SLOT_TIMES)) {
    const raw = slots[key];
    if (!raw) continue;
    const [s, e] = raw.split('-').map((t) => t.trim());
    out.push({ day: GRID_WEEKDAYS[day], start: to24hSlotTime(s), end: to24hSlotTime(e) });
  }
  return out;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_CODES: Record<string, string> = {
  SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday',
  THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday',
};

/** VTOP mixes '-' with en/em dashes in slot and time strings. */
const DASH_SPLIT_RE = /\s*[-–—]\s*/;

function normalizeDay(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  for (const day of DAY_NAMES) {
    if (value === day.toLowerCase() || value === day.slice(0, 3).toLowerCase()) return day;
  }
  return null;
}

/** Replace <br> with newlines so multi-line cells split cleanly. */
function cellLines(row: Element, index: number): string[] {
  const cells = row.querySelectorAll('td');
  const cell = cells[index];
  if (!cell) return [];
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return clone.textContent
    ?.split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean) ?? [];
}

function splitCourseInfo(raw: string): { courseCode: string; courseTitle: string } {
  const value = raw.replace(/\s+/g, ' ').trim();
  const match = value.match(/^([A-Z]{2,6}\d{3,4}[A-Z]?L?)\s*[-–:)]?\s*(.*)$/);
  if (match) return { courseCode: match[1], courseTitle: match[2] || match[1] };
  return { courseCode: value.split(/\s+/)[0] || '', courseTitle: value };
}

function venueInfo(venue: string): { venue: string; building: string } {
  const upper = venue.toUpperCase();
  // '' = VTOP named a venue this campus map cannot resolve. Left empty rather
  // than defaulted to a building.
  let building = '';
  if (upper.includes('AB1') || upper.includes('ACADEMIC BLOCK 1')) building = 'AB1 (Academic Block 1)';
  else if (upper.includes('AB2') || upper.includes('ACADEMIC BLOCK 2')) building = 'AB2 (Academic Block 2)';
  else if (upper.includes('MB') || upper.includes('MAIN BLOCK')) building = 'MB (Main Block)';
  else if (upper.includes('LAB') || upper.includes('TT')) building = 'Lab Block';
  else if (upper.includes('LIBRARY')) building = 'Central Library';
  else if (upper.includes('SJT') || upper.includes('SILVER JUBILEE')) building = 'SJT (Silver Jubilee Tower)';
  return { venue: venue || 'TBA', building };
}

function slotTimes(day: string, slot: string): { start: string; end: string } | null {
  const firstToken = slot.trim().toUpperCase().split('+')[0].trim();
  const dayCode = Object.keys(DAY_CODES).find((code) => DAY_CODES[code] === day);
  const chennai = dayCode ? CHENNAI_SLOT_TIMES[dayCode]?.[firstToken] : undefined;
  if (chennai) {
    const [start, end] = chennai.split(DASH_SPLIT_RE).map((t) => to24hSlotTime(t.trim()));
    if (start && end) return { start, end };
  }
  const lab = firstToken.match(/^(L\d{1,2})$/);
  if (lab && LAB_SLOT_TIMES[lab[1]]) return LAB_SLOT_TIMES[lab[1]];
  const theory = FFCS_SLOT_TIMES[day]?.[firstToken];
  if (theory) return theory;
  return null;
}

function buildSlot(
  day: string,
  slot: string,
  courseInfo: string,
  venue: string,
  faculty: string,
  time?: string,
  idx = 0
): TimetableSlot | null {
  const { courseCode, courseTitle } = splitCourseInfo(courseInfo);
  if (!courseCode) return null;
  const { venue: venueName, building } = venueInfo(venue);

  let startTime = '';
  let endTime = '';
  if (time) {
    const [s, e] = time.split(DASH_SPLIT_RE).map((t) => to24hTime(t));
    startTime = s || '';
    endTime = e || '';
  }
  if (!startTime) {
    const derived = slotTimes(day, slot);
    if (derived) {
      startTime = derived.start;
      endTime = derived.end;
    }
  }

  return {
    id: `${day}-${slot}-${courseCode}-${idx}`,
    slot,
    courseCode,
    courseTitle,
    courseType: courseCode.toUpperCase().endsWith('L') ? 'ELA' : 'ETH',
    facultyName: faculty || '',
    venue: venueName,
    building,
    startTime,
    endTime,
    day: day as TimetableSlot['day'],
  };
}

// ---------------------------------------------------------------------------
// Real current-portal shapes (corroborated by the MIT-licensed VtopMCP client
// that was live-tested against vtopcc.vit.ac.in; parsing reimplemented here).
// ---------------------------------------------------------------------------

interface CourseMeta {
  code: string;
  title: string;
  type: string;
  credits: number;
  slots: string[];
  venue: string;
  faculty: string;
}

/**
 * Parse the REAL Chennai course list — table.table with POSITIONAL cells
 * (live-verified): [0] S.No, [1] Class Nbr,
 * [2] Course Code + Title, [3] L T P J C, [4] Category, [5] Course Type,
 * [6] Class Id, [7] Slot + Venue, [8] Faculty Details. Day + time come from
 * the Chennai slot map. Never guesses: if the shape doesn't fit we report
 * not-found and the legacy fallbacks apply.
 */
function parseCourseList(doc: Document): { courses: CourseMeta[]; found: boolean } {
  const courses: CourseMeta[] = [];
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    if (!/\btable\b/.test(table.className || '')) continue;
    const rows = Array.from(table.querySelectorAll('tr'));
    for (const row of rows) {
      if (Array.from(row.querySelectorAll('th')).length > 0) continue;
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 9) continue;
      const text = (i: number) => (cells[i]?.textContent || '').replace(/\s+/g, ' ').trim();
      const rawCourse = text(2);
      const code = rawCourse.split(/\s+/)[0] || '';
      if (!/^[A-Z]{2,6}\d{3,4}[A-Z]?L?$/.test(code)) continue;
      const title = rawCourse.split(/\s+/).slice(1).join(' ').trim() || code;

      const slotVenue = text(7);
      const venueMatch = slotVenue.match(/[A-Z]+\d*\s*-\s*\d+\s*[A-Z]?/gi);
      const venue = venueMatch ? venueMatch[venueMatch.length - 1].replace('-', ' ') : '';
      const rest = slotVenue.replace(venue, '').replace(/[-\s]/g, ' ').trim();
      const slots = rest
        .split(/[+\s]+/)
        .map((s) => s.trim())
        .filter((s) => /^[A-Z]{1,3}[0-9]{1,2}[A-Z]?$/i.test(s));

      const ltpjc = text(3).split(/\s+/).filter(Boolean);
      const credits = parseInt(ltpjc[ltpjc.length - 1] || '0', 10) || 0;
      const typeRaw = text(5).toUpperCase();
      const isLab = typeRaw.includes('ELA') || typeRaw.includes('LAB') || slots.some((s) => s.toUpperCase().startsWith('L'));

      courses.push({
        code,
        title,
        type: isLab ? 'lab' : 'theory',
        credits,
        slots,
        venue,
        faculty: text(8),
      });
    }
    if (courses.length > 0) break;
  }
  return { courses, found: courses.length > 0 };
}

interface GridSession {
  day: string;
  slot: string;
  courseCode: string;
  venue: string;
  startTime: string;
  endTime: string;
  type: 'THEORY' | 'LAB';
}

/**
 * Parse the weekly day×time grid out of the timetable page.
 *
 * Real shape: the grid table's first data row starts with a weekday (SUN..SAT).
 * It is built from paired rows per day — a THEORY row whose first two cells are
 * [weekday, "THEORY"], followed by a LAB row starting ["LAB", ...]. Period
 * start/end times live in header rows: [THEORY, START, t1..tN], [LAB, START,
 * t1..tN] and two [END, e1..eN] rows. Occupied cells are
 * "SLOT-COURSECODE-TYPE-VENUE-GROUP" (the venue may contain dashes); free
 * cells are bare slot codes or "-".
 */
function parseRealGrid(doc: Document): { sessions: GridSession[]; found: boolean } {
  const grid = Array.from(doc.querySelectorAll('table')).find((t) =>
    Array.from(t.querySelectorAll('tr')).some((r) => {
      const first = r.querySelector('td, th')?.textContent?.trim().toUpperCase() || '';
      return DAY_CODES[first] !== undefined;
    })
  );
  if (!grid) return { sessions: [], found: false };

  const rows = Array.from(grid.querySelectorAll('tr'));
  const rowCells = (r: Element): string[] =>
    Array.from(r.querySelectorAll('td, th')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());

  let theoryStart: string[] = [];
  let theoryEnd: string[] = [];
  let labStart: string[] = [];
  let labEnd: string[] = [];
  const sessions: GridSession[] = [];
  let currentDay: string | null = null;

  const addSlots = (slotCells: string[], starts: string[], ends: string[], type: 'THEORY' | 'LAB', day: string) => {
    for (let i = 0; i < slotCells.length; i++) {
      const cell = slotCells[i];
      if (!cell || /^lunch$/i.test(cell) || cell === '-') continue;
      const parts = cell.split('-').map((s) => s.trim());
      if (parts.length < 2) continue;
      const slot = parts[0];
      const courseCode = parts[1];
      if (!/^[A-Z]{2,6}\d{3,4}[A-Z]?L?$/.test(courseCode)) continue;
      // parts: [SLOT, CODE, TYPE, ...VENUE..., GROUP]
      const venue = parts.length >= 5 ? parts.slice(3, -1).join('-') : '';
      sessions.push({
        day,
        slot,
        courseCode,
        venue,
        startTime: starts[i] || '',
        endTime: ends[i] || '',
        type,
      });
    }
  };

  for (const row of rows) {
    const cells = rowCells(row);
    if (!cells.length) continue;
    const c0 = (cells[0] || '').toUpperCase();
    const c1 = (cells[1] || '').toUpperCase();

    if (c0 === 'THEORY' && c1 === 'START') { theoryStart = cells.slice(2); continue; }
    if (c0 === 'LAB' && c1 === 'START') { labStart = cells.slice(2); continue; }
    if (c0 === 'END') {
      if (!theoryEnd.length) theoryEnd = cells.slice(1);
      else labEnd = cells.slice(1);
      continue;
    }
    if (DAY_CODES[c0]) {
      currentDay = DAY_CODES[c0];
      addSlots(cells.slice(2), theoryStart, theoryEnd, 'THEORY', currentDay);
      continue;
    }
    if (c0 === 'LAB' && currentDay) {
      addSlots(cells.slice(1), labStart, labEnd, 'LAB', currentDay);
    }
  }

  return { sessions, found: sessions.length > 0 };
}

/** Merge grid sessions (day/time/venue) with course metadata (title/faculty). */
function mergeGridWithCourses(
  sessions: GridSession[],
  courses: CourseMeta[]
): TimetableSlot[] {
  const metaByCode = new Map(courses.map((c) => [c.code, c]));
  return sessions.map((s, i) => {
    const meta = metaByCode.get(s.courseCode);
    const { venue, building } = venueInfo(s.venue || meta?.venue || '');
    return {
      id: `${s.day}-${s.slot}-${s.courseCode}-${i}`,
      slot: s.slot,
      courseCode: s.courseCode,
      courseTitle: meta?.title || s.courseCode,
      courseType: s.type === 'LAB' ? 'ELA' : 'ETH',
      facultyName: meta?.faculty || '',
      venue,
      building,
      startTime: to24hTime(s.startTime) || '',
      endTime: to24hTime(s.endTime) || '',
      day: s.day as TimetableSlot['day'],
      // VTOP's L T P J C credit count for the registered class this session
      // belongs to.
      credits: meta?.credits,
    };
  });
}

/**
 * Legacy course list (#studentDetailsList, older deployments): header-keyed
 * "CODE - Title(TYPE)" cells. Only used when the real positional shape is
 * absent.
 */
function parseLegacyCourseList(doc: Document): { courses: CourseMeta[]; found: boolean } {
  const container = doc.querySelector('#studentDetailsList');
  const table = container ? container.querySelector('table') : null;
  if (!table) return { courses: [], found: false };

  const rows = Array.from(table.querySelectorAll('tr'));
  const headerRow = rows.find((r) =>
    Array.from(r.querySelectorAll('th, td')).some((c) => (c.textContent || '').trim())
  );
  if (!headerRow) return { courses: [], found: false };
  const headerTexts = Array.from(headerRow.querySelectorAll('th, td')).map((h) =>
    normalizeHeader(h.textContent || '')
  );
  const idx = (fragments: string[]): number =>
    headerTexts.findIndex((h) => fragments.some((f) => h.includes(f)));
  const courseIdx = idx(['course']);
  const slotVenueIdx = idx(['slot']);
  const facultyIdx = idx(['faculty']);
  if (courseIdx < 0) return { courses: [], found: false };

  const courses: CourseMeta[] = [];
  for (const row of rows) {
    if (Array.from(row.querySelectorAll('th')).length > 0) continue;
    const cells = Array.from(row.querySelectorAll('td'));
    const text = (i: number) => (cells[i]?.textContent || '').replace(/\s+/g, ' ').trim();
    const rawCourse = text(courseIdx);
    if (!rawCourse) continue;

    const typeMatch = rawCourse.match(/\(([^)]*)\)\s*$/);
    const typeRaw = (typeMatch ? typeMatch[1] : '').toLowerCase();
    const withoutType = typeMatch ? rawCourse.slice(0, typeMatch.index).trim() : rawCourse;
    const code = withoutType.split('-')[0].trim();
    const title = withoutType.split('-').slice(1).join('-').trim() || code;
    if (!/^[A-Z]{2,6}\d{3,4}[A-Z]?L?$/.test(code)) continue;

    const slotVenue = slotVenueIdx >= 0 ? text(slotVenueIdx) : '';
    const slotParts = slotVenue.split('-');
    const slots = (slotParts[0] || '').split('+').map((s) => s.trim()).filter(Boolean);
    const venue = slotParts.slice(1).join(' - ').trim();

    courses.push({
      code,
      title,
      type: typeRaw.includes('lab') ? 'lab' : typeRaw.includes('project') ? 'project' : 'theory',
      credits: 0,
      slots,
      venue,
      faculty: facultyIdx >= 0 ? text(facultyIdx).split('-')[0].trim() : '',
    });
  }
  return { courses, found: courses.length > 0 };
}

/**
 * Course-list rows carry slot + venue + faculty but no explicit day/time;
 * day + times are derived from the authoritative Chennai slot map (every
 * meeting for the slot: A1 → Mon 08:00 + Wed 08:55).
 */
function coursesToSlots(courses: CourseMeta[]): TimetableSlot[] {
  const slots: TimetableSlot[] = [];
  for (const c of courses) {
    for (const slot of c.slots) {
      const meetings = slotDayTimes(slot);
      if (!meetings.length) continue;
      const { venue, building } = venueInfo(c.venue);
      // One embedded course list row can carry both its theory and lab slots
      // ("A1+L36"). Labelling the whole row 'ELA' made the theory meeting look
      // like a lab class, so the type follows the individual slot.
      const slotIsLab = /^L\d/i.test(slot)
        || (c.type === 'lab' && c.slots.length > 0 && c.slots.every((s) => /^L\d/i.test(s)));
      meetings.forEach((m, i) => {
        slots.push({
          id: `${c.code}-${slot}-${m.day}-${i}`,
          slot,
          courseCode: c.code,
          courseTitle: c.title,
          courseType: slotIsLab ? 'ELA' : 'ETH',
          facultyName: c.faculty || '',
          venue,
          building,
          startTime: m.start,
          endTime: m.end,
          day: m.day as TimetableSlot['day'],
          credits: c.credits || undefined,
        });
      });
    }
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * VTOP Chennai "Time Table" page.
 *
 * Primary shapes (current portal, corroborated by live-tested VtopMCP):
 *   1. Course list in #studentDetailsList (Course / L T P J C / Slot / Faculty).
 *   2. Weekly THEORY/LAB day×time grid with explicit start/end header rows.
 *
 * Fallback shapes (older/other deployments): per-day row-list tables, or a
 * slot-rows × day-columns grid with multi-line cells.
 *
 * Verification status: UNVERIFIED until an authenticated live pass — see
 * src/lib/vtop/verification.ts
 *
 * Multi-slot labs (e.g. "L31+L32") are combined into ONE class session per
 * meeting — a single 2-period lab block, never two independent classes.
 */
export function parseTimetableHtml(htmlString: string): TimetableSlot[];
export function parseTimetableHtml(htmlString: string, withOutcome: true): ParseOutcome<TimetableSlot[]>;
export function parseTimetableHtml(htmlString: string, withOutcome?: true) {
  const warnings: ParseOutcome<TimetableSlot[]>['warnings'] = [];
  const doc = parseDocument(htmlString);
  const combine = (slots: TimetableSlot[]) => combineLabSessions(slots);

  if (isLikelyLoginPage(htmlString) || isLikelySessionExpiredPage(htmlString)) {
    return withOutcome
      ? parseOutcome([], [{ code: 'session-expired', detail: 'Received the login page instead of timetable data.' }], true)
      : [];
  }

  // --- Primary: real grid + course list ---
  const { sessions, found: gridFound } = parseRealGrid(doc);
  const { courses, found: listFound } = parseCourseList(doc);
  if (gridFound) {
    const merged = combine(mergeGridWithCourses(sessions, courses));
    return withOutcome ? parseOutcome(merged, warnings) : merged;
  }
  if (listFound) {
    // The real Chennai course list carries slot + venue + faculty; day and
    // times come from the authoritative Chennai slot map — complete on its own.
    const merged = combine(coursesToSlots(courses));
    return withOutcome ? parseOutcome(merged, warnings) : merged;
  }

  // --- Legacy #studentDetailsList course list (older deployments) ---
  const { courses: legacy, found: legacyFound } = parseLegacyCourseList(doc);
  if (legacyFound) {
    warnings.push({
      code: 'grid-absent',
      detail: 'Timetable course list found but no day×time grid — slots carry no day/times.',
    });
    const mergedLegacy = combine(coursesToSlots(legacy));
    return withOutcome ? parseOutcome(mergedLegacy, warnings) : mergedLegacy;
  }

  // --- Fallback: generic row-list / grid shapes ---
  const slots: TimetableSlot[] = [];
  const tables = Array.from(doc.querySelectorAll('table'));
  let structuralMismatch = true;

  for (const table of tables) {
    const caption = table.querySelector('caption')?.textContent?.trim() || '';
    const heading = findPrecedingHeading(table);
    const dayFromContext = normalizeDay(caption) || normalizeDay(heading);

    const rows = Array.from(table.querySelectorAll('tr'));
    const headerRow = rows.find((r) => Array.from(r.querySelectorAll('th, td')).some((c) => (c.textContent || '').trim()));
    if (!headerRow) continue;

    const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
    const headers = headerCells.map((c) => normalizeHeader(c.textContent || ''));

    const isRowList =
      headers.some((h) => h.includes('slot')) &&
      (headers.some((h) => h.includes('course code')) || headers.some((h) => h.includes('course'))) &&
      (headers.some((h) => h.includes('venue')) || headers.some((h) => h.includes('faculty')) || headers.some((h) => h.includes('day')));

    if (isRowList) {
      structuralMismatch = false;
      const idx = (key: string) => headers.findIndex((h) => h.includes(key));
      const dayCol = idx('day');
      const timeCol = idx('time') >= 0 ? idx('time') : idx('timing');

      rows.forEach((row, rowIdx) => {
        if (rowIdx === 0 && Array.from(row.querySelectorAll('th')).length > 0) return;
        if (Array.from(row.querySelectorAll('td')).every((c) => !(c.textContent || '').trim())) return;

        const slot = cellText(row, idx('slot'));
        const courseRaw = cellText(row, idx('course code') >= 0 ? idx('course code') : idx('course'));
        if (!slot || !courseRaw) return;

        const day = dayCol >= 0 ? normalizeDay(cellText(row, dayCol)) : dayFromContext;
        if (!day) {
          warnings.push({ code: 'day-unknown', detail: `Row ${courseRaw}: no day could be determined, skipped.` });
          return;
        }
        const time = timeCol >= 0 ? cellText(row, timeCol) : '';

        const built = buildSlot(
          day,
          slot,
          courseRaw,
          cellText(row, idx('venue')),
          cellText(row, idx('faculty')),
          time,
          rowIdx
        );
        if (built) slots.push(built);
      });
      continue;
    }

    // Generic grid shape: header row contains day names, first column is slot/time.
    const dayCols: { day: string; colIdx: number }[] = [];
    headerCells.forEach((cell, colIdx) => {
      const day = normalizeDay(cell.textContent || '');
      if (day && colIdx > 0) dayCols.push({ day, colIdx });
    });
    const firstHeader = normalizeHeader(headerCells[0]?.textContent || '');
    const isGrid = dayCols.length > 0 && (firstHeader.includes('slot') || firstHeader.includes('time') || firstHeader === '');

    if (isGrid) {
      structuralMismatch = false;
      rows.forEach((row, rowIdx) => {
        if (rowIdx === 0 && Array.from(row.querySelectorAll('th')).length > 0) return;
        const slot = cellText(row, 0);
        if (!slot) return;
        for (const { day, colIdx } of dayCols) {
          const lines = cellLines(row, colIdx);
          if (!lines.length) continue;
          const courseInfo = lines[0];
          const venueLine = lines.find((l) => /SJT|AB1|AB2|MB|LAB|TT|LIB|Room|^[A-Z]+\d/i.test(l) && l !== lines[0]);
          const facultyLine = lines.find((l) => /(prof|dr|mr|ms|faculty)/i.test(l));
          const built = buildSlot(day, slot, courseInfo, venueLine || '', facultyLine || '', '', rowIdx * 10 + colIdx);
          if (built) slots.push(built);
        }
      });
    }
  }

  if (!slots.length) {
    warnings.push({
      code: structuralMismatch ? 'no-timetable-table' : 'no-valid-rows',
      detail: structuralMismatch
        ? 'No timetable table structure was recognized in the page.'
        : 'Timetable table found but no valid course rows could be parsed.',
    });
  }

  return withOutcome ? parseOutcome(combine(slots), warnings, structuralMismatch) : combine(slots);
}

function findPrecedingHeading(table: HTMLTableElement): string {
  let node: Element | null = table;
  for (let i = 0; i < 4 && node; i++) {
    node = node.previousElementSibling;
    if (node && /^H[1-6]$/.test(node.tagName)) return node.textContent?.trim() || '';
    if (node && node.tagName === 'DIV') {
      const heading = node.querySelector('h1, h2, h3, h4, h5, h6, b, strong');
      if (heading) return heading.textContent?.trim() || '';
    }
  }
  return '';
}
