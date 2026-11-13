import { TimetableSlot } from '../types';
import { slotMeetings, slotTimeOn } from '../../../utils/chennaiSlotMap';
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
    const derived = slotTimeOn(day, slot);
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
      const meetings = slotMeetings(slot);
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
