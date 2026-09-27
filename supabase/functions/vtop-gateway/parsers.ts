/**
 * parsers.ts — strict VTOP Chennai HTML parsers for the Deno gateway.
 *
 * Pure string/regex parsers (Deno has no DOM) that mirror the page shapes
 * verified against the live vtopcc.vit.ac.in portal via the MIT-licensed
 * VtopMCP reference client (route names, table ids, column semantics) and
 * the DOMParser-based parsers in src/lib/vtop/parsers/.
 *
 * RULES:
 *   - Never fabricate values. Absent fields stay empty/0/''.
 *   - Column order is derived from header text, never assumed.
 *   - Pages that clearly mean "no data" ("no data found", "not found", ...)
 *     yield [] — that is a legitimate empty state.
 *   - Any OTHER structural mismatch throws ParseError so the gateway can
 *     answer PARSE_FAILED ("VTOP changed its page structure") instead of
 *     silently returning empty/fake data.
 *
 * Verification status: parsers are UNVERIFIED against an authenticated live
 * session (see src/lib/vtop/verification.ts); shapes are corroborated by the
 * live-tested reference and by the client-side fixture suite.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ParseError extends Error {
  readonly target: string;
  constructor(target: string, message: string) {
    super(message);
    this.name = 'ParseError';
    this.target = target;
  }
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const COURSE_CODE_RE = /^[A-Z]{2,6}\d{3,4}[A-Z]?L?$/;
const REGNO_RE = /^\d{2}[A-Z]{2,4}\d{4}$/;

export function isPlausibleCourseCode(code: string): boolean {
  return COURSE_CODE_RE.test(code.trim());
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Clean a raw VTOP course-title cell into a display title.
 *
 * VTOP packs several shapes into title cells: "Analog Electronics",
 * "CODE - Title", "CODE Title ( Embedded Theory )", and the strip-the-code
 * leftovers of those ("- Title ( Embedded Theory )"). Without this, UI shows
 * "- Analog Electronics ( Embedded Theory )" — a live-cache verified defect.
 * Removes a leading code (with optional separator), separator dashes, and the
 * trailing parenthesised course-type suffix the timetable serves.
 */
export function cleanCourseTitle(rawTitle: string, courseCode?: string): string {
  let t = (rawTitle || '').replace(/\s+/g, ' ').trim();
  if (courseCode) {
    // "BAEEE103 - Title" / "BAEEE103 Title" / "BAEEE103- Title" — drop the
    // code plus any single separator dash directly after it.
    t = t.replace(new RegExp(`^${courseCode}\\s*[-–:]?\\s*`, 'i'), '');
  }
  // Leftover leading separator when the code was already removed elsewhere.
  t = t.replace(/^[-–:]\s*/, '');
  // Timetable-style suffix: "( Embedded Theory )" / "(Embedded Lab)" etc.
  t = t.replace(/\s*\(\s*[^()]*\s*\)\s*$/, '');
  return t.trim();
}

/**
 * True when the page is a login / session-expiry variant rather than a data
 * page. Mirrors the client helpers (isLikelyLoginPage + isLikelySessionExpiredPage):
 * matches BOTH the legacy portal markup (processLogin/uname/captchaCheck) and
 * the CURRENT Chennai portal markup (vtopLoginForm/captchaStr), plus the
 * expiry markers emitted by the login/error page.
 */
export function isLoginOrExpiredPage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('processlogin') ||
    lower.includes('name="uname"') ||
    lower.includes('name="captchacheck"') ||
    lower.includes('vtoploginform') ||
    lower.includes('name="captchastr"') ||
    lower.includes('not authorized') ||
    lower.includes('session expired') ||
    lower.includes('session timed out') ||
    lower.includes('sessiontimeout') ||
    lower.includes('your session has expired') ||
    lower.includes('invalid captcha') ||
    (lower.includes('login') && lower.includes('password') && lower.includes('captcha'))
  );
}

/** True when VTOP explicitly says there is no data (a legitimate empty state). */
function hasNoDataMarker(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('no data') ||
    lower.includes('no records') ||
    lower.includes('not found') ||
    lower.includes('no attendance') ||
    lower.includes('no marks') ||
    lower.includes('no exam') ||
    lower.includes('no timetable')
  );
}

/** "08:00", "08:00 AM", "02:00 PM" -> "08:00" / "14:00" (24h). */
function to24hTime(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  else if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

/** Normalize VTOP date formats to ISO (18-AUG-2026 / 19/08/2026 / 2026-09-21). */
export function normalizeDate(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const mmm = value.match(/^(\d{1,2})[-/\s]+([A-Za-z]{3,4})[-/\s]+(\d{2,4})$/);
  if (mmm) {
    const month = monthMap[mmm[2].slice(0, 3).toLowerCase()];
    if (month) {
      const yyyy = mmm[3].length === 2 ? `20${mmm[3]}` : mmm[3];
      return `${yyyy}-${month}-${mmm[1].padStart(2, '0')}`;
    }
  }
  const dmy = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return value;
}

// ---------------------------------------------------------------------------
// Table extraction (pure regex — no DOM)
// ---------------------------------------------------------------------------

/** First table element with the given id, or null. */
function extractTableById(html: string, tableId: string): string | null {
  const re = new RegExp(`<table[^>]*id=["']${tableId}["'][\\s\\S]*?<\\/table>`, 'i');
  return html.match(re)?.[0] ?? null;
}

/**
 * Extract the OUTERMOST balanced table starting at the first <table> in html.
 * Handles NESTED tables (e.g. marks rows holding component tables) — a naive
 * non-greedy </table> match would truncate at the first inner close tag.
 */
function extractBalancedTable(html: string): string | null {
  const start = html.search(/<table[^>]*>/i);
  if (start < 0) return null;
  let depth = 0;
  const tagRe = /<\/?table\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return null;
}

/**
 * Split a table's HTML into its DIRECT <tr> row chunks only. Rows inside
 * nested tables (tableDepth > 1) are not split out — they stay inside their
 * owning direct row, so a summary row's nested component table is preserved.
 */
function directRowChunks(tableHtml: string): string[] {
  const chunks: string[] = [];
  const tagRe = /<\/?(?:tr|table)\b[^>]*>/gi;
  let tableDepth = 0;
  let rowStart: number | null = null;
  let rowDepth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(tableHtml)) !== null) {
    const tag = m[0];
    if (/^<\/?table/i.test(tag)) {
      tableDepth += tag.startsWith('</') ? -1 : 1;
      continue;
    }
    if (tag.startsWith('</')) {
      if (rowStart !== null) {
        rowDepth--;
        if (rowDepth === 0) {
          chunks.push(tableHtml.slice(rowStart, m.index + tag.length));
          rowStart = null;
        }
      }
      continue;
    }
    // Opening <tr>: only direct rows of the outer table start a chunk.
    if (tableDepth === 1) {
      rowStart = m.index;
      rowDepth = 1;
    } else if (rowStart !== null) {
      rowDepth++; // nested <tr> inside a captured row
    }
  }
  return chunks;
}

/** The element (any tag) with the given id — used for #studentDetailsList. */
function extractElementById(html: string, id: string): string | null {
  const re = new RegExp(`<(\\w+)[^>]*id=["']${id}["'][\\s\\S]*?<\\/\\1>`, 'i');
  return html.match(re)?.[0] ?? null;
}

function firstTableInside(html: string): string | null {
  return html.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? null;
}

/** Split a table's HTML into rows of cell texts. Header row is included. */
function tableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** Find a table whose header row contains every required header fragment. */
function findTableByHeaders(html: string, required: string[]): string[][] | null {
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tbl: RegExpExecArray | null;
  while ((tbl = tableRe.exec(html)) !== null) {
    const rows = tableRows(tbl[0]);
    if (!rows.length) continue;
    const headers = rows[0].map(normalizeHeader);
    const hasAll = required.every((req) => headers.some((h) => h.includes(req)));
    if (hasAll) return rows;
  }
  return null;
}

/** Whether this is a real <tr> header row (contains <th>). */
function isHeaderRow(rowHtml: string): boolean {
  return /<th[\s>]/i.test(rowHtml);
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export interface GatewayAttendanceRecord {
  courseCode: string;
  courseTitle: string;
  courseType: string;
  slot: string;
  facultyName: string;
  attended: number;
  totalHeld: number;
  percentage: number;
  category: string;
  lastUpdated: string;
}

/**
 * Real shape: table#getStudentDetails with Course Code / Course Title /
 * Course Type / Slot / Attended / Total / Percentage (+ Faculty Name) columns
 * in any order. Header-driven; rows without a plausible course code are
 * skipped (footers, spacers).
 */
export function parseAttendanceHtml(html: string): GatewayAttendanceRecord[] {
  if (isLoginOrExpiredPage(html)) return [];
  if (hasNoDataMarker(html)) return [];

  // Real shape: the table lives INSIDE the div#getStudentDetails container
  // (live-verified). Fall back to header-driven discovery when the id moves.
  const byContainer = (() => {
    const container = extractElementById(html, 'getStudentDetails');
    return container ? firstTableInside(container) : null;
  })();
  const rows =
    (byContainer ? tableRows(byContainer) : null) ||
    findTableByHeaders(html, ['course code', 'attended', 'percentage']);
  if (!rows) {
    throw new ParseError('attendance', 'No attendance table (#getStudentDetails table or Course Code/Attended/Percentage headers) found.');
  }

  const headers = rows[0].map(normalizeHeader);
  const idx = (fragments: string[]): number =>
    headers.findIndex((h) => fragments.some((f) => h.includes(f)));
  const col = {
    code: idx(['course code']),
    title: idx(['course title', 'course name']),
    type: idx(['course type']),
    slot: idx(['slot']),
    attended: idx(['attended']),
    total: idx(['total']) >= 0 ? idx(['total']) : idx(['held']),
    pct: idx(['percentage']),
    faculty: idx(['faculty']) >= 0 ? idx(['faculty']) : idx(['staff']),
  };
  if (col.code < 0 || col.attended < 0 || col.total < 0) {
    throw new ParseError('attendance', 'Attendance table found but required columns (course code / attended / total) are missing.');
  }

  const records: GatewayAttendanceRecord[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cell = (c: number) => (c >= 0 && c < row.length ? row[c] : '');
    const courseCode = cell(col.code);
    if (!isPlausibleCourseCode(courseCode)) continue;
    const attended = parseInt(cell(col.attended), 10);
    const total = parseInt(cell(col.total), 10);
    if (!Number.isFinite(attended) || !Number.isFinite(total) || total <= 0) continue;

    let pct = parseFloat(cell(col.pct));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) pct = Math.round((attended / total) * 1000) / 10;
    pct = Math.min(100, Math.max(0, pct));

    const courseType = cell(col.type) || (courseCode.endsWith('L') ? 'ELA' : 'ETH');
    const upperType = courseType.toUpperCase();
    records.push({
      courseCode,
      courseTitle: cleanCourseTitle(cell(col.title), courseCode) || courseCode,
      courseType,
      slot: cell(col.slot),
      facultyName: cell(col.faculty), // empty = VTOP provides none (never a placeholder)
      attended,
      totalHeld: total,
      percentage: pct,
      category: upperType.includes('LAB') || courseCode.toUpperCase().endsWith('L') ? 'Lab' : 'Theory',
      lastUpdated: new Date().toISOString().slice(0, 10),
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Timetable — course list (#studentDetailsList) + THEORY/LAB day×time grid
// ---------------------------------------------------------------------------

export interface GatewayTimetableSlot {
  id: string;
  slot: string;
  courseCode: string;
  courseTitle: string;
  courseType: string; // 'ETH' | 'ELA'
  facultyName: string;
  venue: string;
  building: string;
  startTime: string; // 24h
  endTime: string;   // 24h
  day: string;
  /** Credits from the course list's LTPJC column (0 when the source lacks it). */
  credits: number;
}

interface CourseMeta {
  code: string;
  title: string;
  type: string; // 'theory' | 'lab' | 'project'
  credits: number;
  slots: string[];
  venue: string;
  faculty: string;
}

/** Slot-like tokens: A1, F1, TB1, TAA1, S11, S8B, L1, X12 … */
const SLOT_TOKEN_RE = /^[A-Z]{1,3}[0-9]{1,2}[A-Z]?$/i;
/** Venue-like tokens: AB2-406, SJT-102, TT-401, AB3-404 … */
const VENUE_TOKEN_RE = /^[A-Z]+\d*\s*-\s*\d+\s*[A-Z]?$/i;

/** "F1 AB2-406" / "A1+TB1 TT-401" → { slots, venue }. */
function splitSlotVenue(slotVenue: string): { slots: string[]; venue: string } {
  const cleaned = (slotVenue || '').replace(/\s+/g, ' ').trim();
  const venueMatch = cleaned.match(/[A-Z]+\d*\s*-\s*\d+\s*[A-Z]?/gi);
  const venue = venueMatch ? venueMatch[venueMatch.length - 1] : '';
  const rest = cleaned
    .replace(venue, '')
    .replace(/[-\s]/g, ' ')
    .trim();
  const slots = rest
    .split(/[+\s]+/)
    .map((s) => s.trim())
    .filter((s) => SLOT_TOKEN_RE.test(s));
  return { slots, venue };
}

/**
 * Real Chennai course list — table.table with POSITIONAL cells (live-verified
 * ): [0] S.No, [1] Class Nbr, [2] Course
 * Code + Title, [3] L T P J C, [4] Category, [5] Course Type, [6] Class Id,
 * [7] Slot + Venue, [8] Faculty Details. Never guessed: if the cell count or
 * course shape doesn't fit, we report not-found and the grid fallback applies.
 */
function parseCourseList(html: string): { courses: CourseMeta[]; found: boolean } {
  const tableRe = /<table\b[^>]*\bclass=["'][^"']*\btable\b[^"']*["'][\s\S]*?<\/table>/gi;
  const courses: CourseMeta[] = [];
  let tbl: RegExpExecArray | null;
  while ((tbl = tableRe.exec(html)) !== null) {
    const rows = tableRows(tbl[0]);
    for (const row of rows) {
      if (row.length < 9) continue;
      const cell = (i: number) => (i < row.length ? (row[i] || '').trim() : '');
      const rawCourse = cell(2);
      const code = rawCourse.split(/\s+/)[0] || '';
      if (!isPlausibleCourseCode(code)) continue;
      const title = cleanCourseTitle(rawCourse, code) || code;
      const { slots, venue } = splitSlotVenue(cell(7));
      const isLab = slots.some((s) => s.toUpperCase().startsWith('L')) || /\bL\b/.test(cell(5)) || code.toUpperCase().endsWith('L');
      const ltpjc = cell(3);
      const creditTokens = ltpjc.split(/\s+/).filter(Boolean);
      const credits = parseInt(creditTokens[creditTokens.length - 1] || '0', 10) || 0;
      courses.push({
        code,
        title,
        type: isLab ? 'lab' : 'theory',
        credits,
        slots,
        venue,
        faculty: cell(8).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return { courses, found: courses.length > 0 };
}

// ---------------------------------------------------------------------------
// Chennai slot map — authoritative VIT Chennai slot → day/time timings.
// Public VIT scheduling facts used in production for VIT Chennai students
// (slot letter determines the
// meeting days AND times: e.g. A1 meets Mon 8:00–8:50 and Wed 8:55–9:45).
// ---------------------------------------------------------------------------

const CHENNAI_SLOT_TIMES_RAW: Record<string, Record<string, string>> = {
  MON: { A1: '8:00-8:50', F1: '8:55-9:45', D1: '9:50-10:40', TB1: '10:45-11:35', TG1: '11:40-12:30', S11: '12:35-1:25', A2: '2:00-2:50', F2: '2:55-3:45', D2: '3:50-4:40', TB2: '4:45-5:35', TG2: '5:40-6:30', S3: '6:35-7:25', L1: '8:00-8:50', L2: '8:50-9:40', L3: '9:50-10:40', L4: '10:40-11:30', L5: '11:40-12:30', L6: '12:30-1:20', L31: '2:00-2:50', L32: '2:50-3:40', L33: '3:50-4:40', L34: '4:40-5:30', L35: '5:40-6:30', L36: '6:30-7:20' },
  TUE: { B1: '8:00-8:50', G1: '8:55-9:45', E1: '9:50-10:40', TC1: '10:45-11:35', TAA1: '11:40-12:30', L12: '12:30-1:20', B2: '2:00-2:50', G2: '2:55-3:45', E2: '3:50-4:40', TC2: '4:45-5:35', TAA2: '5:40-6:30', S1: '6:35-7:25', L7: '8:00-8:50', L8: '8:50-9:40', L9: '9:50-10:40', L10: '10:40-11:30', L11: '11:40-12:30', L37: '2:00-2:50', L38: '2:50-3:40', L39: '3:50-4:40', L40: '4:40-5:30', L41: '5:40-6:30', L42: '6:30-7:20' },
  WED: { C1: '8:00-8:50', A1: '8:55-9:45', F1: '9:50-10:40', TD1: '10:45-11:35', TBB1: '11:40-12:30', L18: '12:35-1:25', C2: '2:00-2:50', A2: '2:55-3:45', F2: '3:50-4:40', TD2: '4:45-5:35', TBB2: '5:40-6:30', S4: '6:35-7:25', L13: '8:00-8:50', L14: '8:50-9:40', L15: '9:50-10:40', L16: '10:40-11:30', L17: '11:40-12:30', L43: '2:00-2:50', L44: '2:50-3:40', L45: '3:50-4:40', L46: '4:40-5:30', L47: '5:40-6:30', L48: '6:30-7:20' },
  THU: { D1: '8:00-8:50', B1: '8:55-9:45', G1: '9:50-10:40', TE1: '10:45-11:35', TCC1: '11:40-12:30', L24: '12:35-1:25', D2: '2:00-2:50', B2: '2:55-3:45', G2: '3:50-4:40', TE2: '4:45-5:35', TCC2: '5:40-6:30', S2: '6:35-7:25', L19: '8:00-8:50', L20: '8:50-9:40', L21: '9:50-10:40', L22: '10:40-11:30', L23: '11:40-12:30', L49: '2:00-2:50', L50: '2:50-3:40', L51: '3:50-4:40', L52: '4:40-5:30', L53: '5:40-6:30', L54: '6:30-7:20' },
  FRI: { E1: '8:00-8:50', C1: '8:55-9:45', TA1: '9:50-10:40', TF1: '10:45-11:35', TDD1: '11:40-12:30', S15: '12:35-1:25', E2: '2:00-2:50', C2: '2:55-3:45', TA2: '3:50-4:40', TF2: '4:45-5:35', TDD2: '5:40-6:30', L25: '8:00-8:50', L26: '8:50-9:40', L27: '9:50-10:40', L28: '10:40-11:30', L29: '11:40-12:30', L30: '12:30-1:20', L55: '2:00-2:50', L56: '2:50-3:40', L57: '3:50-4:40', L58: '4:40-5:30', L59: '5:40-6:30', L60: '6:30-7:20' },
  SAT: { X11: '8:00-8:50', X12: '8:55-9:45', Y11: '9:50-10:40', Y12: '10:45-11:35', S8: '11:40-12:30', S8B: '12:35-1:25', X21: '2:00-2:50', Z21: '2:55-3:45', Y21: '3:50-4:40', W21: '4:45-5:35', W22: '5:40-6:30', Z22: '6:35-7:25', L71: '8:00-8:50', L72: '8:50-9:40', L73: '9:50-10:40', L74: '10:40-11:30', L75: '11:40-12:30', L76: '12:30-1:20', L77: '2:00-2:50', L78: '2:50-3:40', L79: '3:50-4:40', L80: '4:40-5:30', L81: '5:40-6:30', L82: '6:30-7:20' },
};

/** Chennai schedule is 12-hour with afternoon times written as 1:xx–7:xx. */
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
  for (const [day, slots] of Object.entries(CHENNAI_SLOT_TIMES_RAW)) {
    const raw = slots[key];
    if (!raw) continue;
    const [s, e] = raw.split('-').map((t) => t.trim());
    out.push({ day: GRID_WEEKDAYS[day], start: to24hSlotTime(s), end: to24hSlotTime(e) });
  }
  return out;
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

const GRID_WEEKDAYS: Record<string, string> = {
  SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday',
  THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday',
};

/**
 * Real grid: a table whose first data row starts with a weekday (SUN..SAT),
 * built from paired rows per day — a THEORY row [weekday, THEORY, cells...]
 * followed by a LAB row [LAB, cells...]. Period times live in header rows
 * [THEORY, START, t1..tN], [LAB, START, t1..tN], [END, e1..eN], [END, e1..eN].
 * Occupied cells are "SLOT-COURSECODE-TYPE-VENUE-GROUP" (venue may contain
 * dashes); free cells are bare slot codes or "-".
 */
function parseTimetableGrid(html: string): { sessions: GridSession[]; found: boolean } {
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tbl: RegExpExecArray | null;
  while ((tbl = tableRe.exec(html)) !== null) {
    const rows = tableRows(tbl[0]);
    const isGrid = rows.some((r) => r.length > 0 && GRID_WEEKDAYS[r[0].toUpperCase()] !== undefined);
    if (!isGrid) continue;

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
        if (!isPlausibleCourseCode(courseCode)) continue;
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
      if (!row.length) continue;
      const c0 = (row[0] || '').toUpperCase();
      const c1 = (row[1] || '').toUpperCase();
      if (c0 === 'THEORY' && c1 === 'START') { theoryStart = row.slice(2); continue; }
      if (c0 === 'LAB' && c1 === 'START') { labStart = row.slice(2); continue; }
      if (c0 === 'END') {
        if (!theoryEnd.length) theoryEnd = row.slice(1);
        else labEnd = row.slice(1);
        continue;
      }
      if (GRID_WEEKDAYS[c0]) {
        currentDay = GRID_WEEKDAYS[c0];
        addSlots(row.slice(2), theoryStart, theoryEnd, 'THEORY', currentDay);
        continue;
      }
      if (c0 === 'LAB' && currentDay) {
        addSlots(row.slice(1), labStart, labEnd, 'LAB', currentDay);
      }
    }
    return { sessions, found: sessions.length > 0 };
  }
  return { sessions: [], found: false };
}

function venueInfo(venue: string): { venue: string; building: string } {
  const upper = venue.toUpperCase();
  let building = 'SJT (Silver Jubilee Tower)';
  if (upper.includes('AB1') || upper.includes('ACADEMIC BLOCK 1')) building = 'AB1 (Academic Block 1)';
  else if (upper.includes('AB2') || upper.includes('ACADEMIC BLOCK 2')) building = 'AB2 (Academic Block 2)';
  else if (upper.includes('MB') || upper.includes('MAIN BLOCK')) building = 'MB (Main Block)';
  else if (upper.includes('LAB') || upper.includes('TT')) building = 'Lab Block';
  else if (upper.includes('LIBRARY')) building = 'Central Library';
  return { venue: venue || 'TBA', building };
}

/**
 * Real Chennai timetable: the course list (table.table) is authoritative for
 * code/title/venue/faculty/slots; each slot's weekly meetings come from the
 * Chennai slot map (day + time — never fabricated). The legacy THEORY/LAB
 * day×time grid remains only as a fallback for pages that still render it.
 */
export function parseTimetableHtml(html: string): GatewayTimetableSlot[] {
  if (isLoginOrExpiredPage(html)) return [];
  if (hasNoDataMarker(html)) return [];

  const { courses, found: coursesFound } = parseCourseList(html);
  if (coursesFound) {
    const slots: GatewayTimetableSlot[] = [];
    let i = 0;
    for (const c of courses) {
      const { venue, building } = venueInfo(c.venue);
      const meetings =
        c.slots.length > 0
          ? c.slots.flatMap((slot) =>
              slotDayTimes(slot).map((m) => ({ slot, day: m.day, start: m.start, end: m.end }))
            )
          : [];
      if (meetings.length === 0) {
        // No day/time derivable from the slot map — emit the course with no
        // fabricated times (the UI hides day-less entries).
        slots.push({
          id: `${c.code}-${i++}`,
          slot: c.slots[0] || '',
          courseCode: c.code,
          courseTitle: c.title,
          courseType: c.type === 'lab' ? 'ELA' : 'ETH',
          facultyName: c.faculty, // empty = VTOP provides none (never a placeholder)
          venue,
          building,
          startTime: '',
          endTime: '',
          day: '',
          credits: c.credits,
        });
        continue;
      }
      for (const m of meetings) {
        slots.push({
          id: `${m.day}-${m.slot}-${c.code}-${i++}`,
          slot: m.slot,
          courseCode: c.code,
          courseTitle: c.title,
          courseType: c.type === 'lab' ? 'ELA' : 'ETH',
          facultyName: c.faculty, // empty = VTOP provides none (never a placeholder)
          venue,
          building,
          startTime: m.start,
          endTime: m.end,
          day: m.day,
          credits: c.credits,
        });
      }
    }
    return slots;
  }

  // Legacy fallback: THEORY/LAB day×time grid.
  const { sessions, found: gridFound } = parseTimetableGrid(html);
  if (gridFound) {
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
        day: s.day,
        credits: meta?.credits || 0,
      };
    });
  }

  throw new ParseError(
    'timetable',
    'No timetable structure found (course list table or a THEORY/LAB day×time grid).'
  );
}

// ---------------------------------------------------------------------------
// Marks — #fixedTableContainer nested component tables
// ---------------------------------------------------------------------------

export interface GatewayComponentMark {
  title: string;
  maxMarks: number;
  scored: number;
  weightageMax: number;
  weightageScored: number;
  status: 'Evaluated' | 'Pending';
  /**
   * VTOP's own "Weightage Mark" column for this row, when it published one.
   * The grade model prefers this over recomputing scored/max × weightage,
   * because VTOP — not us — decides how a row lands in the final score.
   */
  weightageMark?: number;
  /** Which half of the course this row belongs to: 'T' theory, 'L' lab. */
  part?: MarkPart;
}

export interface GatewayCourseMarksRecord {
  courseCode: string;
  courseTitle: string;
  cat1: GatewayComponentMark;
  cat2: GatewayComponentMark;
  da1: GatewayComponentMark;
  da2: GatewayComponentMark;
  da3: GatewayComponentMark;
  quiz: GatewayComponentMark;
  /** FAT assessment when the marks page exposes it (usually Pending pre-FAT). */
  fat?: GatewayComponentMark;
  /** The lab half's FAT for an embedded course (theory + lab each have one). */
  labFat?: GatewayComponentMark;
  /** Every assessment VTOP served that did not map onto CAT/DA/Quiz (lab
   *  Experiments, PATs, Project Review, Completion Status…), with its original
   *  VTOP title so the UI can display every row it was given. */
  extraComponents?: GatewayComponentMark[];
  /** VTOP's Course Type column ('ETH' / 'ELA' / …) for this course row. */
  courseType?: string;
  /** VTOP's Slot column for this course row ('A1', 'L36+L41', …). */
  slot?: string;
  totalInternalWeightScored: number;
  currentEstimatedGrade: string;
}

type MarkKey = 'cat1' | 'cat2' | 'da1' | 'da2' | 'da3' | 'quiz';
type MarkPart = 'T' | 'L';

/**
 * VTOP's Weightage % column is the only weight this portal uses, so a blank
 * weightage cell means the course has NO declared weight. Falling back to the
 * standard VIT Chennai split (CAT 1: 15, CAT 2: 15, DA 1: 5, DA 2: 5, Quiz: 10)
 * made every projection wrong: a CAT weighted at 20 was modelled at 15.
 * Unknown weight means exactly that — the grade model reports the scheme as
 * undeclared instead of inventing one.
 */
const UNDECLARED_WEIGHTAGE = 0;

/** Which half of the course a marks row belongs to, from VTOP's own Course Type
 *  and Slot columns. Lab slots are 'L…'; an embedded course therefore arrives as
 *  a 'T' row set and an 'L' row set that must be kept apart, not summed. */
function markPartOf(courseType: string, slot: string, courseCode: string): MarkPart {
  const t = (courseType || '').toUpperCase();
  if (t.includes('ELA') || t.includes('LAB')) return 'L';
  const firstSlot = (slot || '').toUpperCase().replace(/[^A-Z]/g, '').charAt(0);
  if (firstSlot === 'L') return 'L';
  if ((courseCode || '').toUpperCase().endsWith('L')) return 'L';
  return 'T';
}

/**
 * Map a VTOP assessment title onto the CAT 1 / CAT 2 / DA 1 / DA 2 / DA 3 /
 * Quiz slots. Tolerant of BOTH the short forms seen in fixtures ("CAT 1",
 * "CAT-1", "CAT1", "CAT I", "DA 1", "Quiz 1") AND the full-word titles the
 * live Chennai portal actually serves ("Continuous Assessment Test - I",
 * "Assignment - II", "Digital Assignment - I", "Quiz - I", "Online
 * Assessment"). Roman numerals and Arabic ordinals are both accepted.
 *
 * "Assessment - N" is the soft-skill/ACE equivalent of a digital assignment
 * (BASTS101 publishes "Assessment - 1/2/3" next to its CAT), so it maps to
 * DA N — but only for the theory half: a lab course's "Assessment - N" is an
 * experiment mark and stays unmapped. Lab-specific rows ("Experiment_N",
 * "PAT - N", "Project Review") are never forced into a CAT/DA/Quiz slot.
 */
function markKeyFromTitle(titleRaw: string, part: MarkPart = 'T'): MarkKey | null {
  const t = titleRaw.toLowerCase().replace(/\s+/g, ' ');
  const flat = t.replace(/[^a-z0-9]/g, '');
  // Suffix ordinal: "I"/"II"/"1"/"2"/"01" at the end of the title.
  const hasSuffixOne = /(^|[^a-z])(i|1)\s*$/.test(t);
  const hasSuffixTwo = /(^|[^a-z])(ii|2)\s*$/.test(t);
  // CAT: "CAT 1" / "CAT1" / "CAT I" / "Continuous Assessment Test - I"
  const isCat = flat.includes('cat') || /continuous\s*assessment\s*test/.test(t);
  if (isCat) {
    if (flat.includes('cat1') || t.includes('cat 1') || /\bcat\s*i\b/.test(t) || hasSuffixOne) return 'cat1';
    if (flat.includes('cat2') || t.includes('cat 2') || /\bcat\s*ii\b/.test(t) || hasSuffixTwo) return 'cat2';
  }
  // DA short forms first ("DA 1", "DA-1", "DA1" carry no "assignment" word).
  // VIT publishes THREE digital assignments, each its own row at its own
  // weightage — a third row mapped to nothing silently dropped a declared
  // component from the total.
  if (flat.includes('da1') || flat.includes('digitalassignment1')) return 'da1';
  if (flat.includes('da2') || flat.includes('digitalassignment2')) return 'da2';
  if (flat.includes('da3') || flat.includes('digitalassignment3')) return 'da3';
  // DA full words: "Digital Assignment 1" / "Assignment - I" ("assignment" is
  // NOT a substring of "assessment", so the soft-skill rows below are separate).
  const isAssignment = flat.includes('assignment');
  if (isAssignment) {
    if (/(^|[^a-z])i\b/.test(t) || t.includes(' 1')) return 'da1';
    if (/(^|[^a-z])ii\b/.test(t) || t.includes(' 2')) return 'da2';
    if (/(^|[^a-z])iii\b/.test(t) || t.includes(' 3')) return 'da3';
  }
  // Soft-skill / ACE courses name their digital-assignment equivalent
  // "Assessment - N" (BASTS101: "Assessment - 1", "Assessment - 2"). Map it to
  // DA N for the theory half only — a lab course's "Assessment - N" is an
  // experiment mark, not a DA, and must stay in extraComponents. CAT
  // ("Continuous Assessment Test") and FAT ("Final Assessment Test") are handled
  // above, so any "assessment" reaching here is a plain numbered assessment.
  if (part !== 'L' && flat.includes('assessment')) {
    if (/(^|[^a-z])i\b/.test(t) || t.includes(' 1')) return 'da1';
    if (/(^|[^a-z])ii\b/.test(t) || t.includes(' 2')) return 'da2';
    if (/(^|[^a-z])iii\b/.test(t) || t.includes(' 3')) return 'da3';
  }
  // Quiz: "Quiz" / "Quiz - I" / "Quiz 1" / "Online Assessment"
  if (flat.includes('quiz') || flat.includes('onlineassessment')) return 'quiz';
  return null;
}

function emptyComponent(weightage: number, part?: MarkPart): GatewayComponentMark {
  return { title: '', maxMarks: 0, scored: 0, weightageMax: weightage, weightageScored: 0, status: 'Pending', ...(part ? { part } : {}) };
}

/** A record for one course row VTOP served. The standard CAT/DA/Quiz slots are
 *  left EMPTY (weightage 0) until VTOP publishes a row for them: a fresh
 *  semester has no CAT 2 yet, and seeding the regulation weightage there made
 *  the page claim ungraded weight that does not exist. */
function emptyRecord(courseCode: string, courseTitle: string, courseType = '', slot = ''): GatewayCourseMarksRecord {
  const part = markPartOf(courseType, slot, courseCode);
  return {
    courseCode,
    courseTitle,
    cat1: emptyComponent(UNDECLARED_WEIGHTAGE, part),
    cat2: emptyComponent(UNDECLARED_WEIGHTAGE, part),
    da1: emptyComponent(UNDECLARED_WEIGHTAGE, part),
    da2: emptyComponent(UNDECLARED_WEIGHTAGE, part),
    da3: emptyComponent(UNDECLARED_WEIGHTAGE, part),
    quiz: emptyComponent(UNDECLARED_WEIGHTAGE, part),
    extraComponents: [],
    courseType,
    slot,
    totalInternalWeightScored: 0,
    currentEstimatedGrade: 'Internal marks not available',
  };
}

function componentTitle(key: MarkKey): string {
  switch (key) {
    case 'cat1': return 'CAT 1';
    case 'cat2': return 'CAT 2';
    case 'da1': return 'Digital Assignment 1';
    case 'da2': return 'Digital Assignment 2';
    case 'da3': return 'Digital Assignment 3';
    case 'quiz': return 'Quiz / Online Assessment';
  }
}

// Partial internals are not a reliable final-grade model. Keep the legacy
// response field for compatibility, but never return an inferred grade path
// or warning from incomplete assessment rows.
function estimateGrade(_internalWeight: number): string {
  return 'Grade estimate unavailable';
}

function hasEvaluatedInternal(record: GatewayCourseMarksRecord): boolean {
  const std = (['cat1', 'cat2', 'da1', 'da2', 'da3', 'quiz'] as const).some((key) => {
    const component = record[key];
    return component.status === 'Evaluated' && component.maxMarks > 0;
  });
  const extra = (record.extraComponents ?? []).some(
    (c) => c.status === 'Evaluated' && c.maxMarks > 0,
  );
  return std || extra;
}

function weightedScoreOf(c: GatewayComponentMark): number {
  // VTOP's own Weightage Mark column wins whenever it published one — that is
  // the number that lands in the student's final score, and VTOP rounds it in
  // ways our scored/max × weightage arithmetic does not always reproduce.
  if (c.status === 'Evaluated' && typeof c.weightageMark === 'number' && Number.isFinite(c.weightageMark)) {
    return Math.round(c.weightageMark * 100) / 100;
  }
  return c.maxMarks > 0 && c.weightageMax > 0
    ? Math.round((c.scored / c.maxMarks) * c.weightageMax * 100) / 100
    : 0;
}

/**
 * Merge two marks records for the SAME course into one (the live page serves
 * a theory assessment table AND a lab assessment table per course, each as a
 * separate course row + nested table — the two must never show as duplicate
 * rows, and a real value in either table must never be lost).
 *
 * For each slot, a component with a real score/max wins over an empty one;
 * ties keep the first (later rows in a table are later assessments — e.g. the
 * second "Assignment - II" row keeps its own value).
 */
function mergeMarksRecords(a: GatewayCourseMarksRecord, b: GatewayCourseMarksRecord): GatewayCourseMarksRecord {
  const filled = (c?: GatewayComponentMark) => !!c && c.maxMarks > 0 && Number.isFinite(c.scored);
  /** Rows kept in their slot; rows displaced by the other half are returned. */
  const displaced: GatewayComponentMark[] = [];
  const pick = (key: MarkKey, x?: GatewayComponentMark, y?: GatewayComponentMark): GatewayComponentMark => {
    if (!x) return y || emptyComponent(UNDECLARED_WEIGHTAGE);
    if (!y) return x;
    if (filled(y) && !filled(x)) {
      if (filled(x)) displaced.push({ ...x, title: x.title || componentTitle(key) });
      return y;
    }
    if (filled(x) && filled(y)) displaced.push({ ...y, title: y.title || componentTitle(key) });
    return x;
  };
  const merged: GatewayCourseMarksRecord = {
    ...a,
    cat1: pick('cat1', a.cat1, b.cat1),
    cat2: pick('cat2', a.cat2, b.cat2),
    da1: pick('da1', a.da1, b.da1),
    da2: pick('da2', a.da2, b.da2),
    da3: pick('da3', a.da3, b.da3),
    quiz: pick('quiz', a.quiz, b.quiz),
    extraComponents: [...(a.extraComponents || []), ...(b.extraComponents || [])],
    courseType: a.courseType || b.courseType || '',
    slot: a.slot || b.slot || '',
    courseTitle: a.courseTitle || b.courseTitle,
  };
  const fatA = a.fat;
  const fatB = b.fat;
  if (fatA || fatB) {
    merged.fat = fatA || fatB;
    // Two FAT rows (theory + lab) — keep both, ordered theory first.
    if (fatA && fatB) {
      merged.labFat = fatA.part === 'T' ? fatB : fatA;
      if (fatA.part === 'L' && fatB.part === 'T') merged.fat = fatB;
    }
  }
  if (a.labFat || b.labFat) merged.labFat = a.labFat || b.labFat;
  // Anything the merge could not keep in its slot is still VTOP's data.
  displaced.forEach((d) => merged.extraComponents!.push(d));
  return merged;
}

function finalizeRecord(record: GatewayCourseMarksRecord): GatewayCourseMarksRecord {
  const fallbackPart = markPartOf(record.courseType || '', record.slot || '', record.courseCode);
  const part: MarkPart = record.cat1?.part ?? fallbackPart;
  for (const key of ['cat1', 'cat2', 'da1', 'da2', 'da3', 'quiz'] as const) {
    record[key].title = record[key].title || componentTitle(key);
    if (part && !record[key].part) record[key].part = part;
    record[key].weightageScored = weightedScoreOf(record[key]);
  }
  if (record.fat) {
    if (part && !record.fat.part) record.fat.part = part;
    record.fat.weightageScored = weightedScoreOf(record.fat);
  }
  if (record.labFat) record.labFat.weightageScored = weightedScoreOf(record.labFat);
  // Also compute weightageScored for unmapped extra components (lab Experiments, PATs…).
  for (const ec of record.extraComponents ?? []) {
    if (part && !ec.part) ec.part = part;
    ec.weightageScored = weightedScoreOf(ec);
  }
  const baseScore = record.cat1.weightageScored + record.cat2.weightageScored +
    record.da1.weightageScored + record.da2.weightageScored +
    record.da3.weightageScored + record.quiz.weightageScored;
  const extraScore = (record.extraComponents ?? []).reduce((s, ec) => s + (ec.weightageScored ?? 0), 0);
  record.totalInternalWeightScored = Math.round((baseScore + extraScore) * 100) / 100;
  record.currentEstimatedGrade = hasEvaluatedInternal(record)
    ? estimateGrade(record.totalInternalWeightScored)
    : 'Internal marks not available';
  return record;
}

/** Parse one nested component table's rows into component values. */
function parseNestedComponents(
  innerTableHtml: string,
  record: GatewayCourseMarksRecord
): void {
  const rows = tableRows(innerTableHtml);
  if (rows.length < 2) return;
  const headers = rows[0].map(normalizeHeader);
  const idx = (fragments: string[]): number =>
    headers.findIndex((h) => fragments.some((f) => h.includes(f)));
  const titleIdx = idx(['title', 'component']);
  const maxIdx = headers.findIndex((h) => h.includes('max') && !h.includes('weightage'));
  const scoredIdx = idx(['scored']) >= 0 ? idx(['scored']) : idx(['obtained']);
  const maxWtIdx = headers.findIndex((h) => h.includes('%') || h.includes('weightage mark') || h.includes('max weightage'));
  const part = markPartOf(record.courseType || '', record.slot || '', record.courseCode);

  for (let j = 1; j < rows.length; j++) {
    const row = rows[j];
    const cell = (c: number) => (c >= 0 && c < row.length ? row[c] : '');
    const compTitle = cell(titleIdx);
    if (!compTitle) continue;
    const rawScored = cell(scoredIdx);
    const isAb = /^(ab|absent|na|-|--|pending)$/i.test(rawScored.replace(/\s+/g, ''));
    const max = parseFloat(cell(maxIdx)) || 0;
    const weightageMax = parseFloat(cell(maxWtIdx)) || UNDECLARED_WEIGHTAGE;
    const scored = isAb || !rawScored ? 0 : parseFloat(rawScored) || 0;
    const status: GatewayComponentMark['status'] = isAb || !rawScored ? 'Pending' : 'Evaluated';
    const key = markKeyFromTitle(compTitle, part);
    if (!key) {
      // unmapped component (lab Experiment, PAT…) — kept, never fabricated into a known slot
      (record.extraComponents ??= []).push({ title: compTitle, maxMarks: max, scored, weightageMax, weightageScored: 0, status, part });
      continue;
    }
    record[key] = { title: compTitle, maxMarks: max, scored, weightageMax, weightageScored: 0, status, part };
  }
}

/**
 * Parse one REAL Chennai marks assessment table (table.customTable-level1).
 * Cells are <output> elements: [0] S.No, [1] Assessment Title, [2] Max Mark,
 * [3] Weightage %, [4] Status, [5] Scored Mark, [6] Weightage Mark.
 * Titles are mapped onto CAT 1 / CAT 2 / DA 1 / DA 2 / Quiz (+ FAT); "AB" /
 * "Pending" status -> Pending (never fabricated as a real 0).
 */
function parseLevel1Assessments(innerHtml: string, record: GatewayCourseMarksRecord): void {
  const rows = tableRows(innerHtml);
  if (rows.length < 2) return;
  const part = markPartOf(record.courseType || '', record.slot || '', record.courseCode);
  for (let j = 1; j < rows.length; j++) {
    const row = rows[j];
    if (row.length < 7) continue;
    const title = (row[1] || '').trim();
    if (!title) continue;
    const statusRaw = (row[4] || '').trim().toLowerCase();
    const rawScored = (row[5] || '').trim();
    const isAb =
      /^(ab|absent|na|-|--|pending)$/i.test(rawScored.replace(/\s+/g, '')) ||
      statusRaw.includes('pending') ||
      statusRaw.includes('ab');
    const max = parseFloat(row[2]) || 0;
    const weightageMax = parseFloat(row[3]) || 0;
    const scored = isAb || !rawScored ? 0 : parseFloat(rawScored) || 0;
    const status: GatewayComponentMark['status'] = isAb || !rawScored ? 'Pending' : 'Evaluated';
    // VTOP's own Weightage Mark column (its final column) is the number the
    // portal puts into the total — it outranks our scored/max × weightage.
    const weightageMark = parseFloat(row[6]) || undefined;

    // FAT is a distinct assessment — capture it separately, never into
    // internals. The live portal titles it "Final Assessment Test" (no literal
    // "FAT"); the short "FAT" form appears in fixtures. "Mid Term" is NOT a
    // FAT (it is a separate exam on the same page).
    const isFat =
      (/\bfat\b/i.test(title) && !/cat/i.test(title)) ||
      /final\s*assessment\s*test/i.test(title) ||
      /^final\s*exam/i.test(title);
    if (isFat) {
      const fat: GatewayComponentMark = {
        title,
        maxMarks: max,
        scored,
        // No invented FAT weightage — VTOP declares it in the same column it
        // uses for every other row; a blank cell means the weight is unknown,
        // not 50 (which silently halved a 40-weight FAT target).
        weightageMax,
        weightageScored: 0,
        status,
        ...(weightageMark !== undefined ? { weightageMark } : {}),
        part,
      };
      // A second FAT row is the other half of an embedded course, not a
      // replacement for the first.
      if (record.fat) {
        if (record.labFat) (record.extraComponents ??= []).push(fat);
        else record.labFat = fat;
      } else {
        record.fat = fat;
      }
      continue;
    }

    const key = markKeyFromTitle(title, part);
    if (!key) {
      // unmapped component (lab Experiment, PAT, Project Review, Completion
      // Status…) — kept with its VTOP title, never fabricated into a known slot.
      (record.extraComponents ??= []).push({
        title,
        maxMarks: max,
        scored,
        weightageMax,
        weightageScored: 0,
        status,
        ...(weightageMark !== undefined ? { weightageMark } : {}),
        part,
      });
      continue;
    }
    record[key] = {
      title,
      maxMarks: max,
      scored,
      weightageMax,
      weightageScored: 0,
      status,
      ...(weightageMark !== undefined ? { weightageMark } : {}),
      part,
    };
  }
}

/**
 * Real shape (PRIMARY — live-verified): table.customTable with tr.tableContent course rows
 * [0] S.No, [1] Class Nbr, [2] Course Code, [3] Course Title, [4] Course
 * Type, [5] Course System, [6] Faculty, [7] Slot, [8] Course Mode, each
 * immediately followed by a tr.tableContent row holding a nested
 * table.customTable-level1 of assessment rows (see parseLevel1Assessments).
 *
 * Legacy fallbacks: div#fixedTableContainer with alternating course rows +
 * nested component tables; then a flat CAT/DA/Quiz table. "AB" -> Pending.
 */

/**
 * Sanitized marks diagnostic: per-course list of assessment titles VTOP
 * actually served (component names like "CAT 1"/"Quiz" — never marks values,
 * never credentials). Lets the UI prove whether CAT/DA rows existed before
 * blaming the parser.
 */
export function marksDiagnostic(html: string): { courseCode: string; courseTitle: string; assessments: string[] }[] {
  if (isLoginOrExpiredPage(html) || hasNoDataMarker(html)) return [];
  const out: { courseCode: string; courseTitle: string; assessments: string[] }[] = [];
  const customStart = html.search(/<table\b[^>]*\bclass=["'][^"']*\bcustomTable\b[^"']*["'][^>]*>/i);
  if (customStart < 0) return out;
  const customTable = extractBalancedTable(html.slice(customStart));
  if (!customTable) return out;
  const chunks = directRowChunks(customTable);
  let pending: { code: string; title: string; assessments: string[] } | null = null;
  for (const chunk of chunks) {
    if (/<table[\s>]/i.test(chunk)) {
      if (pending) {
        const inner = firstTableInside(chunk) || '';
        const rows = tableRows(inner);
        for (let j = 1; j < rows.length; j++) {
          const title = (rows[j][1] || '').trim();
          if (title) pending.assessments.push(title);
        }
        out.push({ courseCode: pending.code, courseTitle: pending.title, assessments: pending.assessments });
        pending = null;
      }
      continue;
    }
    if (isHeaderRow(chunk)) continue;
    const cells = Array.from(chunk.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)).map((c) => stripTags(c[1]));
    if (cells.length < 9) continue;
    const code = (cells[2] || '').trim();
    if (!isPlausibleCourseCode(code)) continue;
    pending = { code, title: (cells[3] || '').trim() || code, assessments: [] };
  }
  if (pending) out.push({ courseCode: pending.code, courseTitle: pending.title, assessments: pending.assessments });
  return out;
}

export function parseMarksHtml(html: string): GatewayCourseMarksRecord[] {
  if (isLoginOrExpiredPage(html)) return [];
  if (hasNoDataMarker(html)) return [];

  // --- Primary: table.customTable + nested customTable-level1 (real Chennai) ---
  const customStart = html.search(/<table\b[^>]*\bclass=["'][^"']*\bcustomTable\b[^"']*["'][^>]*>/i);
  if (customStart >= 0) {
    const customTable = extractBalancedTable(html.slice(customStart));
    if (customTable) {
      const chunks = directRowChunks(customTable);
      const records: GatewayCourseMarksRecord[] = [];
      let pending: GatewayCourseMarksRecord | null = null;
      for (const chunk of chunks) {
        // Nested assessment row FIRST (its inner customTable-level1 header uses
        // <th> — isHeaderRow must not swallow it). Belongs to the immediately
        // preceding course row.
        if (/<table[\s>]/i.test(chunk)) {
          if (pending) {
            const inner = firstTableInside(chunk) || '';
            parseLevel1Assessments(inner, pending);
            records.push(finalizeRecord(pending));
            pending = null;
          }
          continue;
        }
        if (isHeaderRow(chunk)) continue;
        const cells = Array.from(chunk.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)).map((c) => stripTags(c[1]));
        if (cells.length < 9) continue;
        const courseCode = (cells[2] || '').trim();
        if (!isPlausibleCourseCode(courseCode)) continue;
        pending = emptyRecord(
          courseCode,
          cleanCourseTitle(cells[3] || '', courseCode) || courseCode,
          cells[4] || '',
          cells[7] || '',
        );
      }
      if (pending) records.push(finalizeRecord(pending));
      if (records.length) {
        // Merge duplicate course records (theory + lab assessment tables for
        // the same course) so one course = one row, keeping real values.
        const byCode = new Map<string, GatewayCourseMarksRecord>();
        for (const rec of records) {
          const existing = byCode.get(rec.courseCode);
          if (existing) byCode.set(rec.courseCode, mergeMarksRecords(existing, rec));
          else byCode.set(rec.courseCode, rec);
        }
        return [...byCode.values()].map(finalizeRecord);
      }
    }
  }

  // --- Legacy fallback 1: #fixedTableContainer nested shape ---
  const containerStart = html.search(/<div[^>]*id=["']fixedTableContainer["'][^>]*>/i);
  let outerTable: string | null = null;
  if (containerStart >= 0) {
    // Extract the balanced outer table from the container (the container div
    // may itself BE the table — extractBalancedTable handles both).
    outerTable = extractBalancedTable(html.slice(containerStart));
  }

  if (outerTable) {
    const rows = tableRows(outerTable);
    if (rows.length >= 2) {
      const headers = rows[0].map(normalizeHeader);
      const idx = (fragments: string[]): number =>
        headers.findIndex((h) => fragments.some((f) => h.includes(f)));
      const codeIdx = idx(['course code']);
      const titleIdx = idx(['course title', 'course name']);
      if (codeIdx >= 0) {
        const records: GatewayCourseMarksRecord[] = [];
        const rowHtmls = directRowChunks(outerTable);
        for (let i = 1; i < rowHtmls.length; i++) {
          const rowHtml = rowHtmls[i];
          if (/<table[\s>]/i.test(rowHtml)) continue; // nested-table row
          const cells = Array.from(rowHtml.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)).map((c) => stripTags(c[1]));
          const cell = (c: number) => (c >= 0 && c < cells.length ? cells[c] : '');
          const courseCode = cell(codeIdx);
          if (!isPlausibleCourseCode(courseCode)) continue;
          const record = emptyRecord(courseCode, cell(titleIdx) || courseCode);
          const next = i + 1 < rowHtmls.length ? rowHtmls[i + 1] : '';
          if (/<table[\s>]/i.test(next)) {
            const innerTable = extractBalancedTable(next) || '';
            parseNestedComponents(innerTable, record);
          }
          records.push(finalizeRecord(record));
        }
        if (records.length) return records;
        throw new ParseError('marks', 'Marks table found but no valid course rows could be parsed.');
      }
    }
  }

  // --- Fallback: flat table with CAT/DA/Quiz columns ---
  const flat = findTableByHeaders(html, ['course code']);
  if (flat && flat.length >= 2) {
    const headers = flat[0].map(normalizeHeader);
    const idx = (fragments: string[]): number =>
      headers.findIndex((h) => fragments.some((f) => h.includes(f)));
    const col = {
      code: idx(['course code']),
      title: idx(['course title']),
      cat1: idx(['cat 1', 'cat1']),
      cat2: idx(['cat 2', 'cat2']),
      da1: idx(['da 1', 'da1', 'digital assignment 1']),
      da2: idx(['da 2', 'da2', 'digital assignment 2']),
      da3: idx(['da 3', 'da3', 'digital assignment 3']),
      quiz: idx(['quiz']),
    };
    if (col.cat1 >= 0 || col.cat2 >= 0 || col.da1 >= 0 || col.da2 >= 0 || col.da3 >= 0 || col.quiz >= 0) {
      const records: GatewayCourseMarksRecord[] = [];
      for (let i = 1; i < flat.length; i++) {
        const row = flat[i];
        const cell = (c: number) => (c >= 0 && c < row.length ? row[c] : '');
        const courseCode = cell(col.code);
        if (!isPlausibleCourseCode(courseCode)) continue;
        const record = emptyRecord(courseCode, cell(col.title) || courseCode);
        const set = (key: MarkKey, colIdx: number) => {
          if (colIdx < 0) return;
          const raw = cell(colIdx);
          const isAb = /^(ab|absent|na|-|--|pending)$/i.test(raw.replace(/\s+/g, ''));
          record[key] = {
            title: componentTitle(key),
            maxMarks: 0,
            scored: isAb || !raw ? 0 : parseFloat(raw) || 0,
            weightageMax: UNDECLARED_WEIGHTAGE,
            weightageScored: 0,
            status: isAb || !raw ? 'Pending' : 'Evaluated',
          };
        };
        set('cat1', col.cat1);
        set('cat2', col.cat2);
        set('da1', col.da1);
        set('da2', col.da2);
        set('da3', col.da3);
        set('quiz', col.quiz);
        records.push(finalizeRecord(record));
      }
      if (records.length) return records;
    }
  }

  throw new ParseError(
    'marks',
    'No marks table found (customTable-level1 nested assessments, #fixedTableContainer nested component tables, or flat CAT/DA/Quiz columns).'
  );
}

// ---------------------------------------------------------------------------
// Exams — colspan exam-type header rows, slot/date/time/venue/location/seat
// ---------------------------------------------------------------------------

export interface GatewayExamRecord {
  id: string;
  slot: string;
  courseCode: string;
  courseTitle: string;
  examType: string; // 'CAT 1' | 'CAT 2' | 'FAT' | 'Lab FAT' | 'Makeup' | …
  date: string;
  time: string;
  venue: string;
  seatNo: string;
  syllabusTopics: string[];
}

function examTypeOf(raw: string): GatewayExamRecord['examType'] {
  const upper = raw.toUpperCase();
  if (upper.includes('CAT 1') || upper === 'CAT1') return 'CAT 1';
  if (upper.includes('CAT 2') || upper === 'CAT2') return 'CAT 2';
  if (upper.includes('LAB')) return 'Lab FAT';
  return 'FAT';
}

/** Normalize the exam-type section header ("CAT 1 EXAMINATION" → "CAT 1"). */
function examTypeLabel(raw: string): string {
  const t = (raw || '').toUpperCase();
  if (t.includes('CAT 1')) return 'CAT 1';
  if (t.includes('CAT 2')) return 'CAT 2';
  if (t.includes('FAT')) return t.includes('LAB') ? 'Lab FAT' : 'FAT';
  if (t.includes('MAKEUP')) return 'Makeup';
  return (raw || 'Exam').trim() || 'Exam';
}

/**
 * Real Chennai exam schedule — HEADER-DRIVEN parsing (the only layout that
 * survives VTOP's column variations). The live-tested VtopMCP client reads
 * this page by header TEXT and finds NO course-code column: columns are
 * roughly [S.No, Slot, Exam Date, Session, Reporting Time, Exam Time, Venue,
 * Seat Location, Seat No], grouped under exam-type section rows (a single
 * cell spanning the full table width, e.g. "CAT 1").
 *
 * Some deployments DO expose a 13-column table with a Course Code
 * / Course Title column — this parser detects those by header text too, so
 * both shapes work. When no course-code column exists, courseCode/courseTitle
 * stay EMPTY (never invented); the client enriches them from the same
 * semester's timetable by slot.
 *
 * Header rows and spacer rows are NEVER read as data (the classic "Slot Slot"
 * and "Reporting Time in the time field" mis-parses). A row is only accepted
 * when its date cell normalizes to ISO or its slot looks like a real slot —
 * garbage rows are dropped, not fabricated.
 */
export function parseExamsHtml(html: string): GatewayExamRecord[] {
  if (isLoginOrExpiredPage(html)) return [];
  if (hasNoDataMarker(html)) return [];

  const tableRe = /<table\b[^>]*\bclass=["'][^"']*\bcustomTable\b[^"']*["'][\s\S]*?<\/table>/gi;
  const exams: GatewayExamRecord[] = [];
  let tbl: RegExpExecArray | null;
  let found = false;
  let rowIdx = 0;
  while ((tbl = tableRe.exec(html)) !== null) {
    const rows = tableRows(tbl[0]);
    if (rows.length < 2) continue;

    // --- Locate the header row by CONTENT (not position): the first row
    // whose cells include at least two recognizable exam headers.
    const HEADER_FRAGMENTS = ['slot', 'exam date', 'session', 'reporting', 'exam time', 'venue', 'seat', 'course code', 'class id'];
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      const hitCount = rows[i].filter((c) => HEADER_FRAGMENTS.some((f) => normalizeHeader(c).includes(f))).length;
      if (hitCount >= 2) {
        headerIdx = i;
        break;
      }
    }

    // --- Map column indices by header text.
    const headers = headerIdx >= 0 ? rows[headerIdx].map(normalizeHeader) : [];
    const col = (fragments: string[]): number => headers.findIndex((h) => fragments.some((f) => h.includes(f)));
    const slotIdx = col(['slot']);
    const dateIdx = col(['exam date', 'date']);
    const sessionIdx = col(['session']);
    const reportingIdx = col(['reporting']);
    const timeIdx = col(['exam time']);
    const venueIdx = col(['venue']);
    const seatLocIdx = col(['seat location', 'location']);
    const seatNoIdx = col(['seat no', 'seat number']);
    // Course columns exist only on the 13-column variant.
    const codeIdx = col(['course code']);
    const titleIdx = col(['course title']);

    let examType = '';
    for (let r = headerIdx >= 0 ? headerIdx + 1 : 0; r < rows.length; r++) {
      const row = rows[r];
      const cell = (i: number) => (i >= 0 && i < row.length ? (row[i] || '').trim() : '');

      // Exam-type section row: a single cell spanning the full table width.
      if (row.length === 1) {
        const text = cell(0);
        if (text && !/^\d+$/.test(text)) examType = text;
        continue;
      }

      // Skip rows that are themselves header labels (spacer/duplicate headers).
      const joined = row.join(' ').toLowerCase();
      if (/\bs\.?\s*no\b/.test(cell(0)) || /course code|course title|exam date|reporting time|seat no/.test(joined)) {
        continue;
      }

      const slot = cell(slotIdx);
      const date = normalizeDate(cell(dateIdx));
      // STRICT acceptance: only rows with a real date OR a slot-looking value.
      // (Header rows and shifted/garbage rows have neither and are dropped.)
      const looksLikeDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
      const looksLikeSlot = /^[A-Z]\d/.test(slot) || /^L\d/.test(slot);
      if (!looksLikeDate && !looksLikeSlot) continue;
      found = true;

      const courseCode = codeIdx >= 0 ? cell(codeIdx) : '';
      const courseTitle = titleIdx >= 0 ? cell(titleIdx) : '';
      const reportingTime = cell(reportingIdx);
      const examTime = cell(timeIdx);
      const seatLocation = cell(seatLocIdx);
      const seatNo = cell(seatNoIdx);
      exams.push({
        id: `exam-${courseCode || slot || 'x'}-${rowIdx++}`,
        slot: slot.split('+')[0].trim(),
        courseCode,
        courseTitle: cleanCourseTitle(courseTitle, courseCode) || courseTitle || courseCode,
        examType: examTypeLabel(examType),
        date,
        time: examTime || reportingTime || cell(sessionIdx),
        venue: cell(venueIdx),
        seatNo: seatNo || seatLocation,
        syllabusTopics: [],
      });
    }
  }
  if (!found) {
    throw new ParseError('exams', 'No exam schedule table (table.customTable with a header row) found.');
  }
  return exams;
}

// ---------------------------------------------------------------------------
// Special-exam modules (live-verified Chennai endpoints):
//   1. Makeup exams — 2-step: POST examinations/StudExamScheduleForMakeupExam
//      -> semester <select>, then POST
//      examinations/doSearchExamScheduleForStudentMakeupExam per semester.
//   2. Re-exam / reFAT — POST examinations/reFAT/StudentReFATRequestPageController
//      -> semester <select>, then POST .../StudentReFATRequestOnChange.
//   3. Compre — POST compre/registrationForm -> status/message.
// Each returns a clear UNAVAILABLE state when VTOP exposes nothing for this
// student (e.g. no makeup eligibility) instead of fabricating rows.
// ---------------------------------------------------------------------------

export interface GatewayMakeupExam extends GatewayExamRecord {
  semesterId: string;
  semesterName: string;
}

export interface GatewayRefatInfo {
  available: boolean;
  /** "Registration Open" / "Not Eligible" etc. — raw VTOP heading when present. */
  status: string;
  message: string;
  /** Semester -> course rows VTOP exposes for re-FAT registration. */
  semesters: { id: string; name: string; courses: { courseCode: string; courseTitle: string }[] }[];
}

export interface GatewayCompreInfo {
  available: boolean;
  status: string;
  message: string;
}

/** Reuse the exam-table row extraction on any exam-schedule table HTML. */
export function parseExamTableRows(html: string): GatewayExamRecord[] {
  if (isLoginOrExpiredPage(html) || hasNoDataMarker(html)) return [];
  const tableRe = /<table\b[^>]*\bclass=["'][^"']*\bcustomTable\b[^"']*["'][\s\S]*?<\/table>/gi;
  const out: GatewayExamRecord[] = [];
  let tbl: RegExpExecArray | null;
  let rowIdx = 0;
  while ((tbl = tableRe.exec(html)) !== null) {
    const rows = tableRows(tbl[0]);
    if (rows.length < 2) continue;
    const HEADER_FRAGMENTS = ['slot', 'exam date', 'session', 'reporting', 'exam time', 'venue', 'seat', 'course code', 'class id'];
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      const hits = rows[i].filter((c) => HEADER_FRAGMENTS.some((f) => normalizeHeader(c).includes(f))).length;
      if (hits >= 2) { headerIdx = i; break; }
    }
    if (headerIdx < 0) continue;
    const headers = rows[headerIdx].map(normalizeHeader);
    const col = (fragments: string[]): number => headers.findIndex((h) => fragments.some((f) => h.includes(f)));
    const slotIdx = col(['slot']);
    const dateIdx = col(['exam date', 'date']);
    const sessionIdx = col(['session']);
    const reportingIdx = col(['reporting']);
    const timeIdx = col(['exam time']);
    const venueIdx = col(['venue']);
    const seatLocIdx = col(['seat location', 'location']);
    const seatNoIdx = col(['seat no', 'seat number']);
    const codeIdx = col(['course code']);
    const titleIdx = col(['course title']);
    let examType = '';
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const cell = (i: number) => (i >= 0 && i < row.length ? (row[i] || '').trim() : '');
      if (row.length === 1) {
        const text = cell(0);
        if (text && !/^\d+$/.test(text)) examType = text;
        continue;
      }
      const joined = row.join(' ').toLowerCase();
      if (/\bs\.?\s*no\b/.test(cell(0)) || /course code|course title|exam date|reporting time|seat no/.test(joined)) continue;
      const slot = cell(slotIdx);
      const date = normalizeDate(cell(dateIdx));
      const looksLikeDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
      const looksLikeSlot = /^[A-Z]\d/.test(slot) || /^L\d/.test(slot);
      if (!looksLikeDate && !looksLikeSlot) continue;
      out.push({
        id: `makeup-${rowIdx++}`,
        slot: slot.split('+')[0].trim(),
        courseCode: codeIdx >= 0 ? cell(codeIdx) : '',
        courseTitle: titleIdx >= 0 ? cell(titleIdx) : (codeIdx >= 0 ? cell(codeIdx) : ''),
        examType: examTypeLabel(examType) === 'Exam' && /makeup/i.test(examType) ? 'Makeup' : examTypeLabel(examType),
        date,
        time: cell(timeIdx) || cell(reportingIdx) || cell(sessionIdx),
        venue: cell(venueIdx),
        seatNo: cell(seatNoIdx) || cell(seatLocIdx),
        syllabusTopics: [],
      });
    }
  }
  return out;
}

/** First non-empty h3/h4/box-title heading text on a page (refat status). */
export function parseHeadingText(html: string): string {
  const m = html.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/i)
    || html.match(/<[^>]+class=["'][^"']*box-title[^"']*["'][^>]*>([\s\S]*?)<\//i);
  return m ? stripTags(m[1]).trim() : '';
}

/** Extract semester <select> options from a special-exam init page. */
export function specialExamSemesters(html: string): { id: string; name: string }[] {
  if (isLoginOrExpiredPage(html)) return [];
  const selectRe = /<select\b[^>]*>([\s\S]*?)<\/select>/gi;
  const out: { id: string; name: string }[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = selectRe.exec(html)) !== null) {
    const block = sm[1];
    const optRe = /<option[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
    let om: RegExpExecArray | null;
    while ((om = optRe.exec(block)) !== null) {
      const id = om[1].trim();
      const name = stripTags(om[2]).trim();
      if (!id || id === '0' || id === '-1' || !name) continue;
      out.push({ id, name });
    }
    if (out.length) break;
  }
  return out;
}

/** Parse one reFAT "OnChange" response: a course table with code + title. */
export function parseRefatCourses(html: string): { courseCode: string; courseTitle: string }[] {
  if (isLoginOrExpiredPage(html) || hasNoDataMarker(html)) return [];
  const rows = tableRows(html);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  const idx = (fragments: string[]): number => headers.findIndex((h) => fragments.some((f) => h.includes(f)));
  const codeIdx = idx(['course code']);
  const titleIdx = idx(['course title', 'course name']);
  if (codeIdx < 0 && titleIdx < 0) return [];
  const out: { courseCode: string; courseTitle: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const cell = (c: number) => (c >= 0 && c < cells.length ? cells[c] : '');
    const code = cell(codeIdx);
    if (!code || !isPlausibleCourseCode(code)) continue;
    out.push({ courseCode: code, courseTitle: cell(titleIdx) || code });
  }
  return out;
}

/** Parse the compre registration page: heading + status message. */
export function parseCompreInfo(html: string): GatewayCompreInfo {
  if (isLoginOrExpiredPage(html)) return { available: false, status: 'unavailable', message: 'VTOP session required.' };
  const isComprePage = /comprehensive\s*examination/i.test(html);
  const dangerMatch = html.match(/<h3[^>]*class=["'][^"']*text-danger[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i);
  const status = dangerMatch ? stripTags(dangerMatch[1]).trim() : (isComprePage ? 'registration_open' : '');
  const available = isComprePage;
  return { available, status, message: status || (available ? 'Comprehensive Examination registration is open.' : '') };
}

// ---------------------------------------------------------------------------
// Profile — hidden regno input + label/value pairs
// ---------------------------------------------------------------------------

export interface GatewayProfile {
  registrationNo: string;
  name: string;
  program: string;
  /**
   * The academic branch VTOP states on the profile page. VTOP Chennai's
   * profile page has NO such row, so this is normally '' — the +2 group lives
   * in `groupStudied` and must never be read from here.
   */
  branch: string;
  /**
   * VTOP's "Branch / Group Studied" row: the Class-XII (+2) subject group the
   * student was admitted on — "PCM", "Computer with Maths", "CEBA". It is NOT
   * the degree branch and must never be used as a course or branch label.
   */
  groupStudied: string;
  school: string;
  semester: string;
  cgpa: number;
  proctorName: string;
  proctorEmail: string;
  proctorMobile: string;
  email: string;
  mobile: string;
  /** Internal-only source extracted from the authenticated profile HTML. */
  profilePhotoSource?: string;
}

/**
 * VTOP's profile page does not provide a stable JSON photo key. Find the
 * image element that VTOP itself labels as the student's photo/profile image.
 * This returns the source only inside the gateway; callers must resolve it
 * with the authenticated session before returning a data URI to the browser.
 *
 * Three accepted shapes:
 *  1. Keyword-labeled: id/class/alt/title matches photo|profile|student|
 *     avatar|user (any src shape). VTOP's classic markup.
 *  2. Bare inline base64: an unlabeled <img> whose src is a data URI at
 *     least MIN_BARE_PHOTO_B64 chars. Real photos are tens of KB of base64;
 *     VTOP's logos/icons are under ~300 chars, so the size floor separates
 *     them without any attribute hint.
 *  3. VTOP's real-world "data:null;base64,..." MIME (observed on the live
 *     Chennai portal and in independent VTOP clients): the img declares a
 *     NON-IMAGE MIME. Any data:<x>;base64 payload large enough to be a photo
 *     is accepted, and normalizeDataUri rewrites the MIME to what the bytes
 *     actually are (magic-byte sniff) so the browser can render it.
 */
export const MIN_BARE_PHOTO_B64 = 1_000;

const DATA_URI_RE = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/i;

/**
 * Rewrite a base64 data URI's MIME from the payload's magic bytes. VTOP
 * serves "data:null;base64,..." — the bytes are a real image, the label is
 * not. Sniffed: JPEG (\u00ffd8\u00ff), PNG, WEBP. Defaults to JPEG, the
 * format VTOP actually stores student photos in.
 */
export function normalizeDataUri(src: string): string | undefined {
  const m = src.match(DATA_URI_RE);
  if (!m) return undefined;
  const payload = m[1];
  const head = payload.slice(0, 6);
  const mime = head.startsWith('/9j/') ? 'image/jpeg'
    : head.startsWith('iVBORw') ? 'image/png'
    : head.startsWith('UklGR') ? 'image/webp'
    : 'image/jpeg';
  return `data:${mime};base64,${payload}`;
}

export function extractProfilePhotoSource(html: string): string | undefined {
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html)) !== null) {
    const tag = match[0];
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || '';
    const src = attr('src').trim();
    if (!src) continue;
    const hint = [attr('id'), attr('class'), attr('alt'), attr('title')].join(' ');
    const labeled = /photo|profile|student|avatar|user/i.test(hint);
    const dataUri = DATA_URI_RE.test(src) ? normalizeDataUri(src) : undefined;
    if (labeled) {
      if (dataUri && src.length <= 2_500_000) return dataUri;
      if (/^\/(?!\/)|^https?:\/\//i.test(src)) return src;
    } else if (dataUri && src.length >= MIN_BARE_PHOTO_B64 && src.length <= 2_500_000) {
      // Unlabeled inline image large enough to be a photo, not a logo.
      return dataUri;
    }
  }
  return undefined;
}

/**
 * Real shape: registration number in a hidden <input name="regno">; the rest
 * is label/value <td> pairs with first-match semantics (the first occurrence
 * of each label is the student's own block). A profile is only accepted when
 * a plausible reg number is present.
 *
 * VERIFIED against a live Chennai profile: its rows are "Programme" (level —
 * literally "UG"), "Branch / Group Studied" (the Class-XII group, e.g. "PCM"),
 * "School" (e.g. "Centre for e-Automation Technologies") and "Semester" is
 * absent. VTOP's own +2 group is the ONLY field whose label begins with
 * "Branch", so a loose /^branch/i match is what turned "PCM" into the
 * student's displayed branch on every screen. See GatewayProfile.branch /
 * GatewayProfile.groupStudied.
 */
export function parseProfileHtml(html: string): GatewayProfile {
  if (isLoginOrExpiredPage(html)) {
    throw new ParseError('profile', 'Received the login page instead of the profile.');
  }

  const regNoInput = html.match(/<input[^>]*name=["']regno["'][^>]*>/i)?.[0] || '';
  let regNo = regNoInput.match(/value=["']([^"']*)["']/i)?.[1]?.trim() || '';

  // Label/value <td> pairs — first match per field wins.
  const pairs: { label: string; value: string }[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cellRe = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowMatch[1])) !== null) cells.push(stripTags(cm[1]));
    if (cells.length >= 2) {
      const label = cells[0];
      const value = cells.slice(1).join(' ').replace(/\s+/g, ' ').trim();
      if (label && value) pairs.push({ label, value });
    }
  }

  const firstValue = (patterns: RegExp[]): string => {
    for (const { label, value } of pairs) {
      if (label.length <= 60 && patterns.some((re) => re.test(label))) return value;
    }
    return '';
  };

  if (!regNo) {
    regNo = firstValue([/^reg(?:istration)?(?:\s*no\.?|\s*number)?$/i, /^register\s*no\.?$/i]);
  }
  if (!REGNO_RE.test(regNo)) {
    throw new ParseError('profile', 'Profile page found but no plausible registration number could be read.');
  }

  return {
    registrationNo: regNo,
    name: firstValue([/^student\s*name$/i, /^name$/i]),
    program: firstValue([/^programme$/i, /^program$/i, /^applied\s*degree$/i, /^degree$/i]),
    // `branch` may ONLY be satisfied by a row VTOP labels as the academic
    // branch. A /^branch/i match lands first on "Branch / Group Studied" — the
    // Class-XII group ("PCM") — so the label is anchored, and the +2 row is
    // read separately into `groupStudied` below.
    branch: firstValue([
      /^branch$/i,
      /^branch\s*(name|of\s*study)?$/i,
      /^programme\s*\/\s*branch$/i,
      /^program\s*\/\s*branch$/i,
      /^speciali[sz]ation$/i,
    ]),
    groupStudied: firstValue([
      /^branch\s*\/\s*group\s*studied$/i,
      /^group\s*studied$/i,
      /^branch\s*\/\s*stream$/i,
      /^stream$/i,
      /^(class\s*)?xii\b.*\b(group|studied|subjects)$/i,
      /^(12th|plus\s*two)\b.*\b(group|studied|subjects)$/i,
    ]),
    school: firstValue([/^school$/i]),
    semester: firstValue([/^semester$/i]),
    cgpa: parseFloat(firstValue([/^cgpa$/i, /^cumulative\s*grade/i])) || 0,
    proctorName: firstValue([/^proctor(?:\s*name)?$/i]),
    // Proctor contact is ONLY read from proctor-prefixed labels. Generic
    // "Email"/"Mobile Number"/"Contact" labels belong to the student's own
    // block and appear BEFORE any proctor row — matching them here stored the
    // student's own address as the proctor's. The real proctor contact comes
    // from the separate proctor/viewProctorDetails page (parseProctorHtml).
    proctorEmail: firstValue([/^proctor\s*e-?mail$/i]),
    proctorMobile: firstValue([/^proctor\s*mobile$/i]),
    email: firstValue([/^e-?mail$/i]),
    mobile: firstValue([/^mobile\s*number$/i, /^phone$/i, /^contact$/i]),
    profilePhotoSource: extractProfilePhotoSource(html),
  };
}

// ---------------------------------------------------------------------------
// Grades — CGPA summary table on examinations/examGradeView/StudentGradeHistory
// ---------------------------------------------------------------------------

export interface GatewayGradeSummary {
  /** null = the page did not expose a CGPA value (never faked as 0). */
  cgpa: number | null;
  creditsRegistered: number | null;
  creditsEarned: number | null;
}

/**
 * Real shape (corroborated by the live-tested VtopMCP client): the grade
 * history page carries a summary table whose header row contains the words
 * "Credits" and "CGPA" — e.g. `Credits Registered | Credits Earned | CGPA |
 * S Grades | A Grades | ...`. The first header cells are labels and the cells
 * after them are the values, in the same order. Headers are matched by text
 * (not position), so reordered/extra columns are tolerated. Absent values
 * stay null — a missing CGPA is NEVER reported as 0.
 */
export function parseGradeSummaryHtml(html: string): GatewayGradeSummary {
  if (isLoginOrExpiredPage(html)) {
    throw new ParseError('grades', 'Received the login page instead of grade data.');
  }

  const tableRe = /<table[\s\S]*?<\/table>/gi;
  const tables: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(html)) !== null) tables.push(m[0]);

  // Match tables from the END (the CGPA summary is typically the last table).
  for (let i = tables.length - 1; i >= 0; i--) {
    const rows = tableRows(tables[i]);
    if (!rows.length) continue;
    const headers = rows[0].map(normalizeHeader);
    const headerText = headers.join(' | ');
    if (!headerText.includes('credits') || !headerText.includes('cgpa')) continue;

    // VTOP may render labels and values in one row OR across two rows — take
    // every cell in the table and split after the header labels (same approach
    // as the live-tested reference).
    const allCells = rows.flat();
    const valueCells = allCells.slice(headers.length);
    const get = (predicate: (h: string) => boolean): number | null => {
      const idx = headers.findIndex(predicate);
      if (idx < 0 || idx >= valueCells.length) return null;
      const n = parseFloat(valueCells[idx]);
      return Number.isFinite(n) ? n : null;
    };
    return {
      cgpa: get((h) => h === 'cgpa'),
      creditsRegistered: get((h) => h.includes('credits registered')),
      creditsEarned: get((h) => h.includes('credits earned') || (h.includes('credits') && h.includes('earned'))),
    };
  }

  throw new ParseError('grades', 'No CGPA summary table (headers containing Credits and CGPA) found.');
}

/**
 * PRIMARY CGPA/credits source — /vtop/get/dashboard/current/cgpa/credits
 * returns .list-group-item rows with a span.card-title label and a
 * span.fontcolor3 span value (live-verified via the production VTOP
 * dashboard). null = genuinely unavailable (never displayed as 0).
 */
export function parseCgpaCreditsHtml(html: string): GatewayGradeSummary {
  if (isLoginOrExpiredPage(html)) {
    throw new ParseError('grades', 'Received the login page instead of the CGPA/credits dashboard.');
  }
  let cgpa: number | null = null;
  let creditsRegistered: number | null = null;
  let creditsEarned: number | null = null;

  const itemRe = /<(div|li)[^>]*class=["'][^"']*\blist-group-item\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html)) !== null) {
    const inner = m[2];
    const label = stripTags(inner.match(/<span[^>]*\bclass=["'][^"']*\bcard-title\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '').trim();
    const value = stripTags(inner.match(/<span[^>]*\bclass=["'][^"']*\bfontcolor3\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '').trim();
    if (!label) continue;
    const num = parseFloat(value);
    const parsed = Number.isFinite(num) ? num : null;
    if (label.includes('Total Credits Required')) creditsRegistered = parsed;
    else if (label.includes('Earned Credits')) creditsEarned = parsed;
    else if (label.includes('Current CGPA')) cgpa = parsed;
  }

  return { cgpa, creditsRegistered, creditsEarned };
}

/** First table element whose class attribute contains the given class token. */
function firstTableWithClass(html: string, cls: string): string | null {
  const re = new RegExp(`<table\\b[^>]*\\bclass=["'][^"']*\\b${cls}\\b[^"']*["'][\\s\\S]*?<\\/table>`, 'i');
  return html.match(re)?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Grade history — per-semester grade view + cumulative grade history
// ---------------------------------------------------------------------------

export interface GatewaySemesterGrade {
  courseCode: string;
  courseTitle: string;
  courseType: string;
  /** Total marks out of 100 as shown by VTOP (null = not published). */
  grandTotal: number | null;
  /** Final letter grade (S/A/B/C/D/E/F/N). Empty = grade not yet published. */
  grade: string;
  /** VTOP class/course id — used only for future grade-breakdown fetches. */
  courseId: string | null;
}

export interface GatewaySemesterGrades {
  gpa: number | null;
  grades: GatewaySemesterGrade[];
}

export interface GatewayEffectiveGrade {
  basketTitle: string;
  courseType: string;
  creditsEarned: number | null;
  grade: string;
  distributionType: string;
}

export interface GatewayGradeHistory {
  cgpa: number | null;
  creditsRegistered: number | null;
  creditsEarned: number | null;
  gradeCounts: { S: number; A: number; B: number; C: number; D: number; E: number; F: number; N: number } | null;
  effectiveGrades: GatewayEffectiveGrade[];
}

/**
 * Per-semester grade view — /vtop/examinations/examGradeView/doStudentGradeView
 * (live-verified).
 * The page is a table.table-bordered whose first two rows are headers, followed
 * by a row with align="center" containing "GPA : X.XX" and course rows with
 * ≥11 cells: [0] S.No, [1] Course Code, [2] Course Title, [3] Course Type,
 * [9] Grand Total, [10] Grade, [11] a getGradeViewDetails('courseId') button.
 */
export function parseSemesterGradesHtml(html: string): GatewaySemesterGrades {
  if (isLoginOrExpiredPage(html)) {
    throw new ParseError('grades', 'Received the login page instead of grade data.');
  }
  if (hasNoDataMarker(html)) return { gpa: null, grades: [] };

  const grades: GatewaySemesterGrade[] = [];
  let gpa: number | null = null;
  const tableRe = /<table\b[^>]*\bclass=["'][^"']*\btable-bordered\b[^"']*["'][\s\S]*?<\/table>/gi;
  let tbl: RegExpExecArray | null;
  // Mirrors the reference: the first two rows of the (first) table are headers.
  let skippedHeaderRows = 0;
  while ((tbl = tableRe.exec(html)) !== null) {
    const chunks = directRowChunks(tbl[0]);
    for (const chunk of chunks) {
      if (skippedHeaderRows < 2) {
        skippedHeaderRows++;
        continue;
      }
      const txt = stripTags(chunk).replace(/\s+/g, ' ').trim();
      const alignCenter = /\balign\s*=\s*["']center["']/i.test(chunk);
      if (alignCenter || /GPA\s*:/i.test(txt)) {
        const m = txt.match(/GPA\s*:\s*([\d.]+)/i);
        if (m) gpa = parseFloat(m[1]) || null;
        continue;
      }
      const cells = Array.from(chunk.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)).map((c) => stripTags(c[1]));
      if (cells.length < 11) continue;
      const courseCode = (cells[1] || '').trim();
      if (!isPlausibleCourseCode(courseCode)) continue;
      const gradeRaw = (cells[10] || '').trim();
      const grandTotalRaw = (cells[9] || '').trim();
      const grandTotal = /^[\d.]+$/.test(grandTotalRaw) ? parseFloat(grandTotalRaw) : null;
      const courseIdMatch = chunk.match(/getGradeViewDetails\('([^']+)'\)/);
      grades.push({
        courseCode,
        courseTitle: (cells[2] || '').trim() || courseCode,
        courseType: (cells[3] || '').trim(),
        grandTotal,
        grade: /^[SABCDEFN]$/i.test(gradeRaw) ? gradeRaw.toUpperCase() : gradeRaw,
        courseId: courseIdMatch ? courseIdMatch[1] : null,
      });
    }
  }

  if (!grades.length && gpa === null) {
    throw new ParseError('grades', 'No grade view table (table.table-bordered with course rows) found.');
  }
  return { gpa, grades };
}

/**
 * Cumulative grade history — /vtop/examinations/examGradeView/StudentGradeHistory
 * (live-verified):
 *   - a CGPA summary table (headers containing Credits + CGPA) — see
 *     parseGradeSummaryHtml;
 *   - a grade-counts row in the first table.table-hover table (tds[3..10] =
 *     S/A/B/C/D/E/F/N counts);
 *   - an effective-grades table inside #fixedTableContainer (tr.tableContent
 *     rows with course title / course type / credits earned / grade).
 * Absent values stay null — a missing CGPA is NEVER reported as 0.
 */
export function parseGradeHistoryHtml(html: string): GatewayGradeHistory {
  if (isLoginOrExpiredPage(html)) {
    throw new ParseError('grades', 'Received the login page instead of grade history.');
  }

  let summary: GatewayGradeSummary = { cgpa: null, creditsRegistered: null, creditsEarned: null };
  try {
    summary = parseGradeSummaryHtml(html);
  } catch {
    // No Credits/CGPA summary table — grade counts + effective grades may still exist.
  }

  // Grade counts: first table.table-hover, first row with ≥11 cells, tds[3..10].
  let gradeCounts: GatewayGradeHistory['gradeCounts'] = null;
  const countsTable = firstTableWithClass(html, 'table-hover');
  if (countsTable) {
    const rows = tableRows(countsTable);
    for (const row of rows) {
      if (row.length < 11) continue;
      const values = row.slice(3, 11).map((c) => parseInt(c, 10));
      if (values.some((v) => !Number.isNaN(v))) {
        gradeCounts = {
          S: Number.isNaN(values[0]) ? 0 : values[0],
          A: Number.isNaN(values[1]) ? 0 : values[1],
          B: Number.isNaN(values[2]) ? 0 : values[2],
          C: Number.isNaN(values[3]) ? 0 : values[3],
          D: Number.isNaN(values[4]) ? 0 : values[4],
          E: Number.isNaN(values[5]) ? 0 : values[5],
          F: Number.isNaN(values[6]) ? 0 : values[6],
          N: Number.isNaN(values[7]) ? 0 : values[7],
        };
        break;
      }
    }
  }

  // Effective grades: header-driven table inside #fixedTableContainer with a
  // grade column (header text "Grade") + credits column.
  const effectiveGrades: GatewayEffectiveGrade[] = [];
  const container = extractElementById(html, 'fixedTableContainer');
  if (container) {
    const tables = Array.from(container.matchAll(/<table[\s\S]*?<\/table>/gi)).map((m) => m[0]);
    for (const tbl of tables) {
      const rows = tableRows(tbl);
      if (rows.length < 2) continue;
      const headers = rows[0].map(normalizeHeader);
      const idx = (fragments: string[]): number =>
        headers.findIndex((h) => fragments.some((f) => h.includes(f)));
      const titleIdx = idx(['course title', 'basket', 'subject']);
      const typeIdx = idx(['course type', 'type']);
      const creditsIdx = idx(['credits earned', 'credits']);
      const gradeIdx = idx(['grade']);
      const distIdx = idx(['distribution', 'mode']);
      if (gradeIdx < 0) continue;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cell = (c: number) => (c >= 0 && c < row.length ? (row[c] || '').trim() : '');
        const grade = cell(gradeIdx);
        if (!/^[SABCDEFN]$/i.test(grade)) continue;
        const credits = parseFloat(cell(creditsIdx));
        effectiveGrades.push({
          basketTitle: titleIdx >= 0 ? cell(titleIdx) : '',
          courseType: typeIdx >= 0 ? cell(typeIdx) : '',
          creditsEarned: Number.isFinite(credits) ? credits : null,
          grade: grade.toUpperCase(),
          distributionType: distIdx >= 0 ? cell(distIdx) : '',
        });
      }
      if (effectiveGrades.length) break;
    }
  }

  return { ...summary, gradeCounts, effectiveGrades };
}

/**
 * Proctor details — /vtop/proctor/viewProctorDetails returns a label/value
 * table.table (Faculty Name / Faculty Email / Faculty Mobile / Designation).
 * Returns empty strings when the page is missing (no proctor assigned).
 */
export function parseProctorHtml(html: string): { name: string; email: string; mobile: string; designation: string } {
  const result = { name: '', email: '', mobile: '', designation: '' };
  if (isLoginOrExpiredPage(html)) return result;

  const tableRe = /<table\b[^>]*\bclass=["'][^"']*\btable\b[^"']*["'][\s\S]*?<\/table>/gi;
  let tbl: RegExpExecArray | null;
  while ((tbl = tableRe.exec(html)) !== null) {
    const rows = tableRows(tbl[0]);
    for (const row of rows) {
      if (row.length < 2) continue;
      const label = row[0].replace(/\s+/g, ' ').trim().toLowerCase();
      const value = row[1].replace(/\s+/g, ' ').trim();
      if (!label || !value) continue;
      if (label.includes('faculty name')) result.name = value;
      else if (label.includes('faculty email')) result.email = value;
      else if (label.includes('faculty mobile') || label.includes('mobile number')) result.mobile = value;
      else if (label.includes('designation')) result.designation = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// On-Duty (OD) — per-class attendance detail (processViewAttendanceDetail)
// ---------------------------------------------------------------------------

export interface AttendanceDetailRef {
  courseCode: string;
  courseName: string;
  classId: string;
  slot: string;
}

/**
 * Real shape (corroborated by the live-tested VtopMCP client): on the main
 * attendance page every course row's "View" control carries an onclick like
 * `processViewAttendanceDetail('CLASSID','SLOT')`. Those handles are how the
 * per-class detail (the only VTOP Chennai page that marks OD) is reached.
 * Returns [] when no such refs exist (the page genuinely exposes no detail
 * view) — the caller then reports OD as unavailable, never fabricated.
 */
export function parseAttendanceDetailRefs(html: string): AttendanceDetailRef[] {
  if (isLoginOrExpiredPage(html)) return [];
  const refs: AttendanceDetailRef[] = [];

  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tbl: RegExpExecArray | null;
  while ((tbl = tableRe.exec(html)) !== null) {
    const tableHtml = tbl[0];
    if (!/processViewAttendanceDetail/i.test(tableHtml)) continue;
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
      const oc = rowMatch[1].match(/processViewAttendanceDetail\s*\(\s*(?:&#39;|['"])([^'"&]+)(?:&#39;|['"])\s*,\s*(?:&#39;|['"])([^'"&]+)/i);
      if (!oc) continue;
      const cells = Array.from(rowMatch[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)).map((c) => stripTags(c[1]));
      const headersRow = tableRows(tableHtml)[0]?.map(normalizeHeader) ?? [];
      const codeIdx = headersRow.findIndex((h) => h.includes('course') && h.includes('code'));
      const nameIdx = headersRow.findIndex((h) => h.includes('course') && (h.includes('title') || h.includes('name')));
      refs.push({
        courseCode: codeIdx >= 0 && cells[codeIdx] ? cells[codeIdx] : '',
        courseName: nameIdx >= 0 && cells[nameIdx] ? cells[nameIdx] : '',
        classId: oc[1],
        slot: oc[2],
      });
    }
    break;
  }
  return refs;
}

export interface AttendanceDetailCounts {
  present: number;
  absent: number;
  onDuty: number;
  total: number;
  /** OD time in class-hours (duration-based: a 2-period lab counts as 2). */
  odHours: number;
}

/** How many ~50-minute class periods a "Day And Timing" cell spans. */
function periodsFromTiming(timing: string): number {
  const tokens = timing.match(/\d{1,2}:\d{2}\s*(?:AM|PM)?/gi);
  if (!tokens || tokens.length < 2) return 1;
  const toMinutes = (token: string): number | null => {
    const m = token.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    else if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  };
  const start = toMinutes(tokens[0]);
  const end = toMinutes(tokens[tokens.length - 1]);
  if (start == null || end == null) return 1;
  let dur = end - start;
  if (dur < 0) dur += 12 * 60; // 11:00-01:40 PM crosses noon without PM on the end
  return dur <= 0 ? 1 : Math.max(1, Math.round(dur / 50));
}

/**
 * Parse one per-class attendance detail response (processViewAttendanceDetail)
 * and tally statuses. "On Duty" rows count as OD (never as present/absent);
 * each OD row contributes its period-span as hours. Mirrors the verified
 * reference behavior independently (regex, no DOM).
 */
export function parseAttendanceDetail(html: string): AttendanceDetailCounts {
  if (isLoginOrExpiredPage(html)) {
    throw new ParseError('attendance-detail', 'Received the login page instead of attendance detail.');
  }
  const counts: AttendanceDetailCounts = { present: 0, absent: 0, onDuty: 0, total: 0, odHours: 0 };
  const rows = tableRows(html);
  if (!rows.length) return counts;
  const headers = rows[0].map(normalizeHeader);
  const statusIdx = headers.findIndex((h) => h.includes('status'));
  const timingIdx = headers.findIndex((h) => h.includes('timing') || (h.includes('day') && h.includes('time')));
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length) continue;
    const status = ((statusIdx >= 0 ? row[statusIdx] : row[row.length - 1] ?? '') || '').toLowerCase();
    if (!status) continue;
    counts.total++;
    if (/on\s*duty/.test(status)) {
      counts.onDuty++;
      counts.odHours += periodsFromTiming(timingIdx >= 0 ? row[timingIdx] ?? '' : '');
    } else if (/present/.test(status)) counts.present++;
    else if (/absent/.test(status)) counts.absent++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Semesters — select#semesterSubId options
// ---------------------------------------------------------------------------

export interface GatewaySemester {
  id: string;
  name: string;
  isCurrent: boolean;
}

/**
 * Real shape: <select name="semesterSubId"> with option values like
 * "CH2025261". isCurrent is derived ONLY from the `selected` attribute (the
 * term VTOP serves by default) — never from text heuristics, which can pick a
 * past "Winter" term. Option ids are authoritative, never fabricated.
 */
export function parseSemestersHtml(html: string): GatewaySemester[] {
  if (isLoginOrExpiredPage(html)) return [];

  const selectMatch = html.match(/<select[^>]*(?:name|id)=["'](?:semesterSubId|semester[^"']*)["'][^>]*>([\s\S]*?)<\/select>/i);
  if (!selectMatch) return [];
  const optionRe = /<option[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
  const semesters: GatewaySemester[] = [];
  let m: RegExpExecArray | null;
  while ((m = optionRe.exec(selectMatch[1])) !== null) {
    const value = m[1].trim();
    const name = stripTags(m[2]);
    if (!value || value === '0' || value === '-1' || !name) continue;
    const attrs = m[0].slice(0, m[0].indexOf('>'));
    semesters.push({
      id: value,
      name,
      isCurrent: /\bselected\b/i.test(attrs),
    });
  }
  return semesters;
}

// ---------------------------------------------------------------------------
// Academic calendar — 3-step flow (live-tested via the MIT VtopMCP reference):
//   1. POST academics/common/CalendarPreview (establishes calendar context)
//   2. POST getListForSemester  -> month tokens ("01-DEC-2025")
//   3. POST processViewCalendar -> one month's day cells
// Month token -> [day cells]. Day cell spans: [dayNumber, info, detail, ...].
// A day is instructional when info starts with "Instructional Day"; a working
// Saturday etc. carries a "<Weekday> Day Order" note in a detail span.
// ---------------------------------------------------------------------------

export interface GatewayCalendarMonth {
  /** Month token as VTOP serves it, e.g. "01-DEC-2025". */
  token: string;
  /** "2025-12" derived key for the client's date logic. */
  monthKey: string;
}

export interface GatewayCalendarDay {
  /** ISO date "2025-12-01". */
  date: string;
  instructional: boolean;
  /** Timetable order to follow ("Day Order 1" etc.) — null for holidays. */
  dayOrder: string | null;
  /** Event/holiday label — empty when plain instructional. */
  label: string;
}

export function parseCalendarMonths(html: string): GatewayCalendarMonth[] {
  const tokens = [...new Set(
    [...html.matchAll(/processViewCalendar\([^)]*?(\d{2}-[A-Z]{3}-\d{4})/g)].map((m) => m[1]),
  )];
  return tokens.map((token) => {
    const [, mon, yr] = token.split('-');
    const monthNum = MONTH_NUM[(mon || '').toUpperCase()];
    const year = parseInt(yr || '', 10);
    const monthKey = monthNum && Number.isFinite(year)
      ? `${year}-${String(monthNum).padStart(2, '0')}`
      : '';
    return { token, monthKey };
  }).filter((m) => !!m.monthKey);
}

/** "2025-12" -> ISO date for the 1st of that month (client helper parity). */
function monthKeyToIso(monthKey: string): string {
  return `${monthKey}-01`;
}

const MONTH_NUM: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const DAY_ORDER_MAP: Record<string, string> = {
  SUNDAY: 'Day Order 1', MONDAY: 'Day Order 2', TUESDAY: 'Day Order 3',
  WEDNESDAY: 'Day Order 4', THURSDAY: 'Day Order 5', FRIDAY: 'Day Order 6',
  SATURDAY: 'Day Order 7',
};

/**
 * Parse one month's academic-calendar table (processViewCalendar response).
 * Fallbacks: table.calendar-table, then #list-wrapper table. Non-data pages
 * yield [] (legitimate empty). Structural garbage throws ParseError.
 */
export function parseAcademicCalendar(html: string, monthKey: string): GatewayCalendarDay[] {
  if (isLoginOrExpiredPage(html)) return [];
  if (hasNoDataMarker(html)) return [];

  const tableMatch = html.match(/<table\b[^>]*\bclass=["'][^"']*calendar-table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)
    || html.match(/<div[^>]*id=["']list-wrapper["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!tableMatch) {
    // The calendar page always carries a table; if neither fallback matched
    // this is an unexpected structure, not an empty month.
    throw new ParseError('calendar', 'No academic-calendar table found on the calendar page.');
  }

  const [year, month] = monthKey.split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [];

  const days: GatewayCalendarDay[] = [];
  // Each day cell holds <span> children: [dayNumber, info, detail, ...].
  const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  const spanRe = /<span[^>]*>([\s\S]*?)<\/span>/gi;
  let cell: RegExpExecArray | null;
  while ((cell = cellRe.exec(tableMatch[1])) !== null) {
    const spans: string[] = [];
    let sp: RegExpExecArray | null;
    while ((sp = spanRe.exec(cell[1])) !== null) spans.push(stripTags(sp[1]));
    if (!spans.length) continue;
    const day = parseInt(spans[0], 10);
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;

    const info = spans[1] || '';
    const instructional = /^instructional day/i.test(info);
    const joined = spans.join(' ');
    const orderMatch = joined.match(/(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY)\s+Day Order/i);
    // The regex captures the weekday as-written; the map is keyed UPPERCASE.
    const dayOrder = instructional && orderMatch ? DAY_ORDER_MAP[orderMatch[1].toUpperCase()] : null;
    // Holiday/event text lives in the parenthesised detail spans. The "<Weekday>
    // Day Order" note is a timetable directive, not an event — exclude it so a
    // plain instructional day's label stays empty (reference behavior).
    const details = spans.slice(1)
      .filter((s) => /^\(/.test(s))
      .map((s) => s.replace(/^\(|\)$/g, '').trim())
      .filter((s) => s && !/day order/i.test(s))
      .filter(Boolean);
    const label = [...new Set(details)].join(' / ');

    days.push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      instructional,
      dayOrder,
      label,
    });
  }
  if (!days.length) {
    throw new ParseError('calendar', 'Academic-calendar table found but no valid day cells could be parsed.');
  }
  return days;
}

/** Compute the derived month key for a calendar day (client convenience). */
export function calendarDayMonthKey(d: GatewayCalendarDay): string {
  return d.date.slice(0, 7);
}

// ---------------------------------------------------------------------------
// Degree / credit progress — parsed from the SAME cumulative grade-history
// page as gradeHistory (live-tested via the MIT VtopMCP reference):
//   table with "Curriculum Details" header -> [name, required, earned]
//   table with "Basket Details" header -> [name, distributionType, req, earned]
//   CGPA summary (parseCgpaSummary parity) -> registered credits + grade counts
// ---------------------------------------------------------------------------

export interface GatewayCurriculumRow {
  name: string;
  required: number;
  earned: number;
  distributionType?: string;
}

export interface GatewayCurriculumProgress {
  /** Total credits required to graduate + earned so far. */
  totals: {
    creditsRequired: number;
    creditsEarned: number;
    creditsRegistered: number;
    cgpa: number | null;
  };
  distributionTypes: GatewayCurriculumRow[];
  baskets: GatewayCurriculumRow[];
  gradeCounts: { S: number; A: number; B: number; C: number; D: number; E: number; F: number; N: number };
}

/** Parse a single "Curriculum Details"/"Basket Details" row [name, req, earned]. */
function curriculumRow(cells: string[]): GatewayCurriculumRow | null {
  const name = (cells[0] || '').trim();
  if (!name) return null;
  const required = parseFloat(cells[1]) || 0;
  const earned = parseFloat(cells[2]) || 0;
  return { name, required, earned };
}

export function parseCurriculumProgressHtml(html: string): GatewayCurriculumProgress {
  if (isLoginOrExpiredPage(html)) {
    return {
      totals: { creditsRequired: 0, creditsEarned: 0, creditsRegistered: 0, cgpa: null },
      distributionTypes: [], baskets: [],
      gradeCounts: { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, N: 0 },
    };
  }

  const totals = { creditsRequired: 0, creditsEarned: 0, creditsRegistered: 0, cgpa: null as number | null };
  const distributionTypes: GatewayCurriculumRow[] = [];
  const baskets: GatewayCurriculumRow[] = [];
  const gradeCounts = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, N: 0 };

  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableM: RegExpExecArray | null;
  while ((tableM = tableRe.exec(html)) !== null) {
    const tableHtml = tableM[0];
    const headerText = stripTags(tableHtml).toLowerCase();
    if (!headerText.includes('curriculum details') && !headerText.includes('basket details')) continue;

    const rows = tableRows(tableHtml);
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      if (cells.length < 3) continue;
      const row = curriculumRow(cells);
      if (!row) continue;
      if (headerText.includes('curriculum details')) {
        if (row.name.toLowerCase() === 'total credits') {
          totals.creditsRequired = row.required;
          totals.creditsEarned = row.earned;
          continue;
        }
        distributionTypes.push(row);
      } else {
        // Basket rows: [name, distributionType, required, earned]
        row.distributionType = (cells[1] || '').trim();
        row.required = parseFloat(cells[2]) || 0;
        row.earned = parseFloat(cells[3]) || 0;
        baskets.push(row);
      }
    }
  }

  // CGPA summary parity (parseCgpaSummary from VtopMCP): reads the registered
  // credits + CGPA + grade-count distribution from the summary table.
  const summaryMatch = html.match(/<table\b[^>]*>([\s\S]*?)\bCGPA\b([\s\S]*?)<\/table>/i);
  if (summaryMatch) {
    const summaryText = stripTags(summaryMatch[0]);
    const cgpaMatch = summaryText.match(/CGPA\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (cgpaMatch) totals.cgpa = parseFloat(cgpaMatch[1]);
    const regMatch = summaryText.match(/Registered\s*Credits\s*[:\-]?\s*([0-9]+)/i);
    if (regMatch) totals.creditsRegistered = parseFloat(regMatch[1]);
    // Grade counts: "S: 5 A: 3 ..." pattern anywhere in the summary.
    for (const letter of ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'N'] as const) {
      const m = summaryText.match(new RegExp(`\\b${letter}\\s*:\\s*([0-9]+)\\b`, 'i'));
      if (m) gradeCounts[letter] = parseInt(m[1], 10);
    }
  }

  return { totals, distributionTypes, baskets, gradeCounts };
}

// ---------------------------------------------------------------------------
// Arrear (backlog) courses — 2-step flow (live-verified Chennai endpoints):
//   1. POST examinations/arrearRegistration/LoadRegularArrearViewPage
//   2. POST examinations/arrearRegistration/viewRARArrearBySemesterWise
//      (with the semester field name from step 1's <select>)
// Returns semester-scoped rows: course code, title, credits, grade (if any),
// status (Pending / Cleared / Registered). "No data" -> [] (legitimate).
// ---------------------------------------------------------------------------

export interface GatewayArrearSemester {
  id: string;
  name: string;
  /** Semester <select> field name on the arrear page (used for the 2nd POST). */
  fieldName: string;
}

export interface GatewayArrear {
  semesterId: string;
  semesterName: string;
  courseCode: string;
  courseTitle: string;
  credits: number;
  /** Final grade if cleared, empty if still pending. */
  grade: string;
  status: 'Pending' | 'Cleared' | 'Registered';
}

export function parseArrearSemesters(html: string): GatewayArrearSemester[] {
  if (isLoginOrExpiredPage(html)) return [];
  const selectMatch = html.match(/<select\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/i);
  if (!selectMatch) return [];
  const optionRe = /<option[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
  const out: GatewayArrearSemester[] = [];
  let m: RegExpExecArray | null;
  while ((m = optionRe.exec(selectMatch[2])) !== null) {
    const id = m[1].trim();
    const name = stripTags(m[2]);
    if (!id || id === '0' || id === '-1' || !name) continue;
    out.push({ id, name, fieldName: selectMatch[1] });
  }
  return out;
}

export function parseArrearHtml(html: string, semesterId: string, semesterName: string): GatewayArrear[] {
  if (isLoginOrExpiredPage(html)) return [];
  if (hasNoDataMarker(html)) return [];

  const rows = tableRows(html);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  const idx = (fragments: string[]): number =>
    headers.findIndex((h) => fragments.some((f) => h.includes(f)));
  const codeIdx = idx(['course code']);
  const titleIdx = idx(['course title', 'course name']);
  const creditsIdx = idx(['credit']);
  const gradeIdx = idx(['grade']);
  const statusIdx = idx(['status']);
  if (codeIdx < 0 && titleIdx < 0) return [];

  const out: GatewayArrear[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const cell = (c: number) => (c >= 0 && c < cells.length ? cells[c] : '');
    const code = cell(codeIdx);
    if (!code || !isPlausibleCourseCode(code)) continue;
    const statusRaw = cell(statusIdx).toLowerCase();
    let status: GatewayArrear['status'] = 'Pending';
    if (/clear|pass|completed/i.test(statusRaw)) status = 'Cleared';
    else if (/registered|enrolled|rego/i.test(statusRaw)) status = 'Registered';
    out.push({
      semesterId,
      semesterName,
      courseCode: code,
      courseTitle: cell(titleIdx) || code,
      credits: parseFloat(cell(creditsIdx)) || 0,
      grade: cell(gradeIdx).trim(),
      status,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Circulars — single POST to admissions/costCentreCircularsViewPageController
// (live-verified). The page renders a nested <ul> tree
// (#tree1): category <span> parents with <a> children carrying the circular id
// in an onclick="viewCertificate('ID')" handler.
// ---------------------------------------------------------------------------

export interface GatewayCircular {
  id: string;
  title: string;
  /** Parent category name, e.g. "ACADEMIC CIRCULARS". */
  category: string;
  /** Empty when the page does not expose a date for this circular. */
  date: string;
}

/**
 * Extract the FULL inner content of <ul id="tree1">...</ul>, tracking nested
 * <ul> depth so an inner </ul> can never truncate the tree (the circulars
 * page nests one <ul> per category inside the tree).
 */
function extractTree1(html: string): string | null {
  const start = html.search(/<ul\b[^>]*\bid=["']tree1["'][^>]*>/i);
  if (start < 0) return null;
  const openTagEnd = html.indexOf('>', start) + 1;
  let depth = 1;
  let i = openTagEnd;
  const ulOpenRe = /<ul\b[^>]*>/gi;
  const ulCloseRe = /<\/ul\s*>/gi;
  while (i < html.length) {
    // Reset BOTH cursors each pass — a failed exec resets lastIndex to 0, and
    // reusing stale positions skips a </ul> (truncating the tree).
    ulOpenRe.lastIndex = i;
    ulCloseRe.lastIndex = i;
    const nextOpen = ulOpenRe.exec(html);
    const nextClose = ulCloseRe.exec(html);
    const o = nextOpen ? nextOpen.index : Infinity;
    const c = nextClose ? nextClose.index : Infinity;
    if (o === Infinity && c === Infinity) break;
    if (o < c) { depth++; i = o + nextOpen![0].length; }
    else { depth--; i = c + nextClose![0].length; if (depth === 0) return html.slice(openTagEnd, c); }
  }
  return null;
}

/**
 * Walk the tree1 <li> list with nesting awareness: a category <li> carries a
 * <span> (name) plus a nested <ul> of <li><a onclick="viewCertificate('ID')">
 * children; a flat <li> with an <a> is a circular under the current category.
 * Mirrors the live-verified Chennai structure (span + child <ul>).
 */
export function parseCircularsHtml(html: string): GatewayCircular[] {
  if (isLoginOrExpiredPage(html)) return [];
  if (hasNoDataMarker(html)) return [];

  const tree = extractTree1(html);
  if (tree === null) return [];

  const out: GatewayCircular[] = [];
  let category = '';

  // All viewCertificate links anywhere in a block, in document order.
  const linksIn = (block: string): { id: string; title: string }[] => {
    const linkRe = /<a\b[^>]*onclick=["'][^"']*viewCertificate\(['"]?([^'")\s]+)['"]?\)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
    const found: { id: string; title: string }[] = [];
    let l: RegExpExecArray | null;
    while ((l = linkRe.exec(block)) !== null) {
      found.push({ id: l[1], title: stripTags(l[2]).trim() });
    }
    return found;
  };

  // Any nested <ul> blocks inside a <li> (recurse into them for children).
  const nestedUls = (liHtml: string): string[] => {
    const out: string[] = [];
    const ulRe = /<ul\b[^>]*>([\s\S]*?)<\/ul>/gi;
    let u: RegExpExecArray | null;
    while ((u = ulRe.exec(liHtml)) !== null) out.push(u[1]);
    return out;
  };

  const walkList = (content: string): void => {
    // Each top-level <li> of this list (its full content, nested lis included).
    const liRe = /<li\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(content)) !== null) {
      const openEnd = liRe.lastIndex;
      // Find THIS <li>'s matching </li>, tracking nested <li> depth.
      let depth = 1;
      let j = openEnd;
      let close = -1;
      const innerRe = /<\/li\s*>|<li\b[^>]*>/gi;
      innerRe.lastIndex = j;
      let n: RegExpExecArray | null;
      while ((n = innerRe.exec(content)) !== null) {
        if (n[0].startsWith('</li')) { depth--; if (depth === 0) { close = n.index; break; } }
        else depth++;
      }
      if (close < 0) break;
      const liHtml = content.slice(openEnd, close);
      liRe.lastIndex = close + 5;

      // Category <li>: has a <span> name (and usually a nested <ul> of children).
      const span = liHtml.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
      if (span) {
        const name = stripTags(span[1]).trim();
        if (name) category = name;
        // Category children live in a nested <ul> inside the SAME <li> (the
        // live-verified Chennai structure) — recurse into each one.
        for (const ul of nestedUls(liHtml)) walkList(ul);
        continue;
      }

      // Circular <li>: one or more <a onclick="viewCertificate('ID')">.
      // Links sit either directly in the <li> or inside a wrapped <ul> — if
      // the li wraps list(s), recurse and let those walks collect the links
      // (collecting them here too would double-count).
      const uls = nestedUls(liHtml);
      if (uls.length === 0) {
        for (const link of linksIn(liHtml)) {
          out.push({ id: link.id, title: link.title, category, date: '' });
        }
      } else {
        for (const ul of uls) walkList(ul);
      }
    }
  };

  walkList(tree);
  return out;
}

// ---------------------------------------------------------------------------
// Payments (fee dues) — /vtop/p2p/Payments
// Live-verified Chennai shape: h3.box-title, a student-info row
// (div.container .row .text-primary b) and a green <font> "no dues" message.
// ---------------------------------------------------------------------------

export interface GatewayPaymentsInfo {
  title: string;
  registerNumber: string;
  studentName: string;
  programme: string;
  campus: string;
  message: string;
  hasDues: boolean;
  // Fee summary rows when a dues table exists (label/value pairs).
  rows: { label: string; value: string }[];
}

export function parsePaymentsHtml(html: string): GatewayPaymentsInfo {
  if (isLoginOrExpiredPage(html)) throw new ParseError('payments', 'login page returned');
  const title = (html.match(/<h3\b[^>]*class=["'][^"']*box-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Student info: the first div.container .row with .text-primary <b> cells.
  // The <b> cells live INSIDE the .row (`div.container .row .text-primary b`).
  const containerBlock = html.match(/<div\b[^>]*class=["'][^"']*\bcontainer\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || html;
  const rowBlock = containerBlock.match(/<div\b[^>]*class=["'][^"']*\brow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || containerBlock;
  const primaries = [...rowBlock.matchAll(/<b[^>]*class=["'][^"']*text-primary[^"']*["'][^>]*>([\s\S]*?)<\/b>/gi)]
    .map((m) => stripTags(m[1]).replace(/^:\s*/, '').trim());

  // Green <font color="green"> message — VTOP's explicit "no dues" marker.
  const msgMatch = html.match(/<font\b[^>]*color=["']?green["']?[^>]*>([\s\S]*?)<\/font>/i);
  let message = '';
  if (msgMatch) {
    message = msgMatch[1].replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Dues table: label/value rows, keyed by header position like other VTOP pages.
  const rows: { label: string; value: string }[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    for (const tr of [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]) {
      const tds = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]).trim());
      if (tds.length >= 2 && tds[0] && tds[1] && tds[0].length < 80) {
        rows.push({ label: tds[0], value: tds[1] });
      }
    }
  }

  const hasDues = !message && rows.length > 0;
  return {
    title,
    registerNumber: primaries[0] || '',
    studentName: primaries[1] || '',
    programme: primaries[2] || '',
    campus: primaries[3] || '',
    message,
    hasDues,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Credentials — /vtop/proctor/viewStudentCredentials
// Chennai shape: h3.box-title b, table.customTable rows.
// ---------------------------------------------------------------------------

export interface GatewayCredentialRow {
  account: string;
  username: string;
  defaultCredentials: string;
  url: string;
  venueDate: string;
  seatLocation: string;
}

export interface GatewayCredentialsInfo {
  title: string;
  credentials: GatewayCredentialRow[];
}

export function parseCredentialsHtml(html: string): GatewayCredentialsInfo {
  if (isLoginOrExpiredPage(html)) throw new ParseError('credentials', 'login page returned');
  const title = (html.match(/<h3\b[^>]*>[\s\S]*?<b[^>]*>([\s\S]*?)<\/b>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const credentials: GatewayCredentialRow[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*class=["'][^"']*customTable[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    const headers = [...t[1].matchAll(/<tr\b[^>]*class=["'][^"']*tableHeader[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)]
      .flatMap((tr) => [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]).trim()));
    if (!headers.includes('Account')) continue;
    for (const tr of [...t[1].matchAll(/<tr\b[^>]*class=["'][^"']*tableContent[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)]) {
      const cells = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);
      if (cells.length < 3) continue;
      const href = cells[3]?.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1] || '';
      credentials.push({
        account: stripTags(cells[0] || '').trim(),
        username: stripTags(cells[1] || '').trim(),
        defaultCredentials: stripTags(cells[2] || '').trim(),
        url: href || stripTags(cells[3] || '').trim(),
        venueDate: stripTags(cells[4] || '').trim(),
        seatLocation: stripTags(cells[5] || '').trim(),
      });
    }
  }
  return { title, credentials };
}

// ---------------------------------------------------------------------------
// Transport registration — /vtop/transport/transportRegistration
// Chennai shape: #busRouteId, table.table label/value rows, QR image.
// ---------------------------------------------------------------------------

export interface GatewayTransportInfo {
  hasRegistration: boolean;
  registerNumber: string;
  name: string;
  programme: string;
  branch: string;
  routeSelected: string;
  fpReference: string;
  paymentStatus: string;
  busRouteId: string;
  qrCode: string;
  rows: { label: string; value: string }[];
}

export function parseTransportHtml(html: string): GatewayTransportInfo {
  if (isLoginOrExpiredPage(html)) throw new ParseError('transport', 'login page returned');
  const busRouteId = html.match(/<input\b[^>]*id=["']busRouteId["'][^>]*value=["']([^"']*)["']/i)?.[1] || '';

  const rows: { label: string; value: string }[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*class=["'][^"']*\btable\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    for (const tr of [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]) {
      const tds = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => {
        const text = stripTags(m[1]).replace(/\s+/g, ' ').trim();
        return text || m[1].match(/(?:src|data-src)=["']([^"']+)["']/i)?.[1] || '';
      });
      if (tds.length >= 2) rows.push({ label: tds[0], value: tds[1] });
    }
  }
  const row = (label: string) => rows.find((r) => r.label.includes(label))?.value || '';

  // VTOP has used several QR markups over time: id before/after src,
  // alt/class labels instead of an id, and a QR row rendered by a template.
  // Inspect the complete img tag so attribute order does not matter.
  const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag: string, name: string) => {
    const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:["']([^"']+)["']|([^\\s>]+))`, 'i'))
      || tag.match(new RegExp(`data-${name}\\s*=\\s*(?:["']([^"']+)["']|([^\\s>]+))`, 'i'));
    return match?.[1] || match?.[2] || '';
  };
  const imageSrc = (tag: string) => {
    const src = attr(tag, 'src');
    const dataSrc = tag.match(/data-src\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/i);
    return /^data:image\//i.test(src) ? src : dataSrc?.[1] || dataSrc?.[2] || src;
  };
  const qrTag = imageTags.find((tag) => /qr|attendance|transport/i.test(tag));
  const qrCandidates = [(qrTag ? imageSrc(qrTag) : ''), ...imageTags.map(imageSrc)];
  const qrCode = qrCandidates.find(Boolean)
    || html.match(/data:image\/(?:png|jpeg|jpg|gif);base64,[A-Za-z0-9+/=]+/i)?.[0]
    || '';

  const data = {
    registerNumber: row('Register Number'),
    name: row('Name of the Student'),
    programme: row('Programme'),
    branch: row('Branch'),
    routeSelected: row('Route Selected'),
    fpReference: row('FP Reference Number'),
    paymentStatus: row('Payment Status'),
  };
  return {
    ...data,
    hasRegistration: !!(busRouteId && data.routeSelected && data.paymentStatus),
    busRouteId,
    qrCode,
    rows,
  };
}

// ---------------------------------------------------------------------------
// SAP info — /vtop/sap/SapInformation
// ---------------------------------------------------------------------------

export interface GatewaySapInfo {
  title: string;
  rows: { label: string; value: string }[];
  message: string;
  available: boolean;
}

export function parseSapInfoHtml(html: string): GatewaySapInfo {
  if (isLoginOrExpiredPage(html)) throw new ParseError('sapInfo', 'login page returned');
  const title = (html.match(/<h3\b[^>]*class=["'][^"']*box-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const rows: { label: string; value: string }[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    for (const tr of [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]) {
      const tds = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
      if (tds.length >= 2 && tds[0] && tds[1] && tds[0].length < 80) {
        rows.push({ label: tds[0], value: tds[1] });
      }
    }
  }
  // Warning/error box (e.g. "SAP ID not mapped yet").
  const message = (html.match(/<div\b[^>]*class=["'][^"']*(?:alert|text-danger|text-warning)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { title, rows, message, available: rows.length > 0 };
}

// ---------------------------------------------------------------------------
// Payment receipts — /vtop/p2p/getReceiptsApplno
// ---------------------------------------------------------------------------

export interface GatewayReceipt {
  receiptNumber: string;
  date: string;
  amount: string;
  campusCode: string;
  viewKey: string | null;
  applno: string;
  regno: string;
}

export interface GatewayPaymentReceiptsInfo {
  title: string;
  receipts: GatewayReceipt[];
  available: boolean;
}

export function parsePaymentReceiptsHtml(html: string): GatewayPaymentReceiptsInfo {
  if (isLoginOrExpiredPage(html)) throw new ParseError('paymentReceipts', 'login page returned');
  const title = (html.match(/<h3\b[^>]*class=["'][^"']*box-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const receipts: GatewayReceipt[] = [];
  const table = html.match(/<table\b[^>]*class=["'][^"']*table-bordered[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)?.[1] || '';
  if (table) {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (let i = 1; i < rows.length; i++) {
      const cells = [...rows[i][1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      if (cells.length < 5) continue;
      const keyMatch = cells[4].match(/doDuplicateReceipt\(['"]([^'"]+)['"]\)/i);
      const applno = cells[4].match(/name=["']applno["'][^>]*value=["']([^"']*)["']/i)?.[1] || '';
      const regno = cells[4].match(/name=["']regno["'][^>]*value=["']([^"']*)["']/i)?.[1] || '';
      receipts.push({
        receiptNumber: stripTags(cells[0]).trim(),
        date: stripTags(cells[1]).trim(),
        amount: stripTags(cells[2]).trim(),
        campusCode: stripTags(cells[3]).trim(),
        viewKey: keyMatch ? keyMatch[1] : null,
        applno,
        regno,
      });
    }
  }
  return { title, receipts, available: receipts.length > 0 || !!table };
}

// ---------------------------------------------------------------------------
// Employee search — /vtop/hrms/EmployeeSearchForStudent
// ---------------------------------------------------------------------------

export interface GatewayEmployeeSearchInfo {
  title: string;
  fields: { label: string; value: string }[];
  message: string;
  found: boolean;
}

export function parseEmployeeSearchHtml(html: string): GatewayEmployeeSearchInfo {
  if (isLoginOrExpiredPage(html)) throw new ParseError('employeeSearch', 'login page returned');
  const title = (html.match(/<h3\b[^>]*class=["'][^"']*box-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const fields: { label: string; value: string }[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    for (const tr of [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]) {
      const tds = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
      if (tds.length >= 2 && tds[0] && tds[1] && tds[0].length < 80) {
        fields.push({ label: tds[0], value: tds[1] });
      }
    }
  }
  // VTOP shows a warning/error line when nothing matches.
  const message = (html.match(/<div\b[^>]*class=["'][^"']*(?:alert|text-danger|text-warning)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { title, fields, message, found: fields.length > 0 };
}

// ---------------------------------------------------------------------------
// Generic single-step info pages — all share the same shape:
//   h3.box-title + label/value table rows (and/or a green success message).
// ---------------------------------------------------------------------------

function parseLabelValueRows(html: string): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    for (const tr of [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]) {
      const tds = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
      if (tds.length >= 2 && tds[0] && tds[1] && tds[0].length < 80) {
        rows.push({ label: tds[0], value: tds[1] });
      }
    }
  }
  return rows;
}

function parseTitle(html: string): string {
  return (html.match(/<h3\b[^>]*class=["'][^"']*box-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseGreenMessage(html: string): string {
  const m = html.match(/<font\b[^>]*color=["']?green["']?[^>]*>([\s\S]*?)<\/font>/i)
    || html.match(/<div\b[^>]*class=["'][^"']*(?:alert-success|text-success)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  return m ? m[1].replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

// --- Bank info — /vtop/studentBankInformation/BankInfoStudent ---
export interface GatewayBankInfo {
  title: string;
  rows: { label: string; value: string }[];
  message: string;
  available: boolean;
}

export function parseBankInfoHtml(html: string): GatewayBankInfo {
  if (isLoginOrExpiredPage(html)) throw new ParseError('bankInfo', 'login page returned');
  const rows = parseLabelValueRows(html);
  const message = parseGreenMessage(html);
  return { title: parseTitle(html), rows, message, available: rows.length > 0 };
}

// --- Biometric info — /vtop/academics/common/BiometricInfo ---
export interface GatewayBiometricInfo {
  title: string;
  rows: { label: string; value: string }[];
  message: string;
  available: boolean;
}

export function parseBiometricInfoHtml(html: string): GatewayBiometricInfo {
  if (isLoginOrExpiredPage(html)) throw new ParseError('biometric', 'login page returned');
  const rows = parseLabelValueRows(html);
  const message = parseGreenMessage(html);
  return { title: parseTitle(html), rows, message, available: rows.length > 0 };
}

// --- Proctor messages — /vtop/proctor/viewMessagesSendByProctor ---
export interface GatewayProctorMessage {
  from: string;
  subject: string;
  body: string;
  date: string;
}

export function parseProctorMessagesHtml(html: string): GatewayProctorMessage[] {
  if (isLoginOrExpiredPage(html)) throw new ParseError('proctorMessages', 'login page returned');
  const out: GatewayProctorMessage[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    const rows = [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    if (!rows.length) continue;
    // Find the header row by known header text; map columns positionally.
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      const cells = [...rows[i].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
      if (cells.some((c) => /^from$/i.test(c)) || cells.some((c) => /^subject$/i.test(c))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) continue;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = [...rows[i].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
      if (cells.length >= 4 && cells.some((c) => /\S/.test(c))) {
        out.push({ from: cells[0], subject: cells[1], body: cells[2], date: cells[3] });
      }
    }
  }
  return out;
}

// --- Login history — /vtop/show/login/history ---
export interface GatewayLoginHistoryRow {
  date: string;
  time: string;
  ip: string;
  status: string;
}

export function parseLoginHistoryHtml(html: string): GatewayLoginHistoryRow[] {
  if (isLoginOrExpiredPage(html)) throw new ParseError('loginHistory', 'login page returned');
  const out: GatewayLoginHistoryRow[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    const rows = [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    for (let i = 1; i < rows.length; i++) {
      const cells = [...rows[i].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
      if (cells.length >= 3 && /\d/.test(cells.join(' '))) {
        out.push({ date: cells[0], time: cells[1] || '', ip: cells[2] || '', status: cells[3] || '' });
      }
    }
  }
  return out;
}

// --- Class messages — /vtop/academics/common/StudentClassMessage ---
export interface GatewayClassMessage {
  from: string;
  subject: string;
  body: string;
  date: string;
}

export function parseClassMessagesHtml(html: string): GatewayClassMessage[] {
  if (isLoginOrExpiredPage(html)) throw new ParseError('classMessages', 'login page returned');
  const out: GatewayClassMessage[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const t of tables) {
    const rows = [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    if (!rows.length) continue;
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      const cells = [...rows[i].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
      if (cells.some((c) => /^from$/i.test(c)) || cells.some((c) => /^subject$/i.test(c))) { headerIdx = i; break; }
    }
    if (headerIdx < 0) continue;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = [...rows[i].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
      if (cells.length >= 4 && cells.some((c) => /\S/.test(c))) {
        out.push({ from: cells[0], subject: cells[1], body: cells[2], date: cells[3] });
      }
    }
  }
  return out;
}

// --- HOD/Dean details — /vtop/hrms/viewHodDeanDetails ---
export interface GatewayHodDean {
  title: string;
  rows: { label: string; value: string }[];
  available: boolean;
}

export function parseHodDeanHtml(html: string): GatewayHodDean {
  if (isLoginOrExpiredPage(html)) throw new ParseError('hodDean', 'login page returned');
  const rows = parseLabelValueRows(html);
  return { title: parseTitle(html), rows, available: rows.length > 0 };
}

// --- Student wallet — /vtop/finance/getStudentWallet ---
export interface GatewayWallet {
  title: string;
  rows: { label: string; value: string }[];
  message: string;
  available: boolean;
}

export function parseWalletHtml(html: string): GatewayWallet {
  if (isLoginOrExpiredPage(html)) throw new ParseError('wallet', 'login page returned');
  const rows = parseLabelValueRows(html);
  const message = parseGreenMessage(html);
  return { title: parseTitle(html), rows, message, available: rows.length > 0 };
}

// --- Extra-curricular activities — /vtop/academics/common/ExtraCurricular ---
export interface GatewayExtraCurricular {
  title: string;
  rows: { label: string; value: string }[];
  available: boolean;
}

export function parseExtraCurricularHtml(html: string): GatewayExtraCurricular {
  if (isLoginOrExpiredPage(html)) throw new ParseError('extraCurricular', 'login page returned');
  const rows = parseLabelValueRows(html);
  return { title: parseTitle(html), rows, available: rows.length > 0 };
}

// ---------------------------------------------------------------------------
// Digital Assignments (DAs) — /vtop/examinations/StudentDA then
// /vtop/examinations/processDigitalAssignment (Chennai capstone flow).
// Step 1 serves the page with a classId <select>; step 2 with { classId }
// returns the DA table (course, assignment, due date, status...).
// ---------------------------------------------------------------------------

export interface GatewayAssignment {
  id: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  dueDate: string;
  weightage: number | null;
  status: string;
}

/** Extract the classId <select> options (course/class groups) from the StudentDA page. */
export function parseDaClassOptions(html: string): { value: string; text: string }[] {
  if (isLoginOrExpiredPage(html)) throw new ParseError('assignments', 'login page returned');
  const out: { value: string; text: string }[] = [];
  const selects = [...html.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/gi)];
  for (const sel of selects) {
    for (const opt of [...sel[1].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)]) {
      const value = opt[0].match(/value=["']([^"']*)["']/i)?.[1] ?? '';
      const text = stripTags(opt[1]).trim();
      if (value || text) out.push({ value, text });
    }
  }
  return out;
}

/**
 * Parse the DA table from the processDigitalAssignment response. Column order
 * varies across semesters, so every column is matched by header text
 * (course / assignment / due / submission / status / marks). Rows missing a
 * usable course code are skipped; a page with a table but zero valid rows
 * throws ParseError so the sync modal reports it honestly.
 */
export function parseDaAssignmentsHtml(html: string): GatewayAssignment[] {
  if (isLoginOrExpiredPage(html)) throw new ParseError('assignments', 'login page returned');
  if (hasNoDataMarker(html)) return [];

  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  const out: GatewayAssignment[] = [];
  for (const t of tables) {
    const rows = [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    if (!rows.length) continue;
    // Header row: first row whose cells are mostly short (no course codes).
    let headerIdx = -1;
    let headers: string[] = [];
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      const cells = [...rows[i].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
      const codeCount = cells.filter((c) => isPlausibleCourseCode(c)).length;
      if (cells.length >= 3 && codeCount === 0 && /assignment|course|due|date|status/i.test(cells.join(' '))) {
        headerIdx = i;
        headers = cells.map((c) => normalizeHeader(c));
        break;
      }
    }
    if (headerIdx < 0) continue;

    const col = {
      course: headers.findIndex((h) => /course code/.test(h) || /course/.test(h) && h.length < 20),
      title: headers.findIndex((h) => /course title|course name|subject/.test(h)),
      assignment: headers.findIndex((h) => /assignment|title|description/.test(h) && !/course/.test(h)),
      due: headers.findIndex((h) => /due|submission date|last date/.test(h)),
      status: headers.findIndex((h) => /status|submitted|graded/.test(h)),
      marks: headers.findIndex((h) => /marks|weightage|max/.test(h)),
    };
    if (col.course < 0) col.course = col.title >= 0 ? col.title : -1;
    if (col.course < 0) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = [...rows[i].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
      if (cells.length <= col.course) continue;
      const courseRaw = cells[col.course] || '';
      const code = courseRaw.split(/\s+/).find((w) => isPlausibleCourseCode(w)) || '';
      if (!code && col.title >= 0) {
        // Some semesters serve the code in the title cell — reuse.
        const titleRaw = cells[col.title] || '';
        const tCode = titleRaw.split(/\s+/).find((w) => isPlausibleCourseCode(w)) || '';
        if (tCode) {
          out.push({
            id: `${tCode}-${i}-${stripTags(rows[i]).slice(0, 24)}`,
            courseCode: tCode,
            courseTitle: cleanCourseTitle(titleRaw, tCode),
            title: cells[col.assignment >= 0 ? col.assignment : col.title] || '',
            dueDate: normalizeDate(col.due >= 0 ? cells[col.due] || '' : ''),
            weightage: col.marks >= 0 ? (parseFloat(cells[col.marks]) || null) : null,
            status: col.status >= 0 ? cells[col.status] || '' : '',
          });
        }
        continue;
      }
      if (!code) continue;
      const title = col.title >= 0 && cells[col.title] ? cleanCourseTitle(cells[col.title], code) : '';
      out.push({
        id: `${code}-${i}-${stripTags(rows[i]).slice(0, 24)}`,
        courseCode: code,
        courseTitle: title,
        title: cells[col.assignment >= 0 ? col.assignment : col.title] || '',
        dueDate: normalizeDate(col.due >= 0 ? cells[col.due] || '' : ''),
        weightage: col.marks >= 0 ? (parseFloat(cells[col.marks]) || null) : null,
        status: col.status >= 0 ? cells[col.status] || '' : '',
      });
    }
  }
  if (out.length === 0 && tables.length > 0) {
    throw new ParseError('assignments', 'DA table found but no rows could be parsed.');
  }
  return out;
}
