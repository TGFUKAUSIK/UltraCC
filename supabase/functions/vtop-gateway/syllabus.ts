/**
 * syllabus.ts — the real VTOP Course Page → per-course syllabus document.
 *
 * WHERE VTOP PUTS A SYLLABUS (this is the whole point of this module):
 * VTOP has no "syllabus" entry in the Academics menu. The document lives
 * behind the Course Page flow:
 *
 *   1. POST academics/common/StudentCoursePage   (opens the page; VTOP will
 *                                                  not answer 2-4 without it)
 *   2. POST getCourseForCoursePage    { semSubId }          -> course dropdown
 *   3. POST getSlotIdForCoursePage    { semSubId, classId } -> class rows,
 *                                                 each carrying the faculty
 *                                                 erpId inside an onclick
 *   4. POST processViewStudentCourseDetail { semSubId, erpId, classId }
 *                                                 -> the course detail page,
 *                                                    whose vtopDownload('<path>')
 *                                                    links include one with
 *                                                    'courseSyllabusDownload'
 *   5. GET  /vtop/<path>?authorizedID&_csrf&x     -> the file bytes
 *
 * PROVENANCE — read this before changing a route. Steps 1-5 come from
 * `Udhay-Adithya/vitap-vtop-client`, a live-tested VTOP client for the
 * Vellore campus; its parser tests embed the real markup shapes (the
 * `&#39;`-escaped onclick, the 9-column class table, the `vtopDownload`
 * anchors), which is what the parsers below are written against.
 * UltraCC's own gateway already proves that VTOP's top-level, un-prefixed
 * `processView*` routes answer on Chennai — `processViewStudentAttendance`,
 * `processViewTimeTable`, `processViewStudentDA` and
 * `processViewAttendanceDetail` are all live-verified here — so steps 2-4 are
 * expected to work as spelled. Step 1 is the only `academics/common/...`
 * route, and Chennai renames some of those (`StudentTimeTableChn`), so it is
 * tried under both spellings.
 *
 * STILL UNVERIFIED against a live Chennai session: no synthetic probe can
 * reach a student's Course Page. That is why every step records itself in
 * `diag` — a first real failure names the route that died instead of looking
 * like "VTOP has no syllabus".
 *
 * DATA TRUTHFULNESS: nothing is inferred. A course with no syllabus link is
 * reported as absent (`reason: 'no-syllabus-link'`), never filled in with a
 * guessed URL or invented content. VTOP's bytes are returned untouched apart
 * from the MIME label, because VTOP declares document types inconsistently
 * (the same way it labels profile photos `data:null`) — there the magic bytes
 * win.
 *
 * SECURITY: no VTOP HTML, cookie, CSRF token or authorizedID ever leaves this
 * module toward the browser. The browser receives either the document as a
 * data URL or an honest absence reason.
 */

import { isLoginOrExpiredPage } from './parsers.ts';

/** VTOP syllabus documents run ~100 KB–2 MB. Beyond this we say so instead of
 *  streaming a payload that would blow the client's memory and its cache. */
export const MAX_SYLLABUS_BYTES = 8_000_000;

/** Ceiling on VTOP requests per answer: warm-up may be tried twice, then
 *  courses + slots + detail + two document candidates. A runaway sequence is
 *  a bug, not a retry strategy. */
export const MAX_SYLLABUS_REQUESTS = 8;

/**
 * The VTOP routes this flow may touch. The caller passes these from the
 * gateway's strict allowlist (ALLOWED_ENDPOINTS in index.ts), so this module
 * spells no VTOP URL of its own and cannot be talked into fetching something
 * the allowlist does not already list.
 */
export interface SyllabusRoutes {
  /** Course Page warm-up, most-likely spelling first. See PROVENANCE above. */
  warmup: string[];
  courses: string;
  slots: string;
  detail: string;
  /** Course-plan workbook route, used when VTOP links one instead. */
  coursePlan: string;
}

// ---------------------------------------------------------------------------
// Contract (mirrored by src/lib/vtop/types.ts on the client)
// ---------------------------------------------------------------------------

/** One file: VTOP's actual bytes, encoded for the browser. */
export interface SyllabusDocument {
  dataUrl: string;
  contentType: string;
  fileName: string;
  bytes: number;
  /** Which VTOP link produced it — the UI labels the two differently. */
  origin: 'course-syllabus' | 'course-plan';
}

/**
 * The class the document belongs to, as VTOP's own Course Page named it.
 *
 * THIS IS THE WIRE SHAPE and it carries course identity only — code, title,
 * registration type. VTOP's own class placement (classId, slot, faculty, class
 * group) is how UltraCC FINDS the syllabus, never something the student is
 * shown or asked about: it lives in `CourseClassIdentity` below, which is
 * internal to this module and cannot be serialised into an answer.
 */
export interface SyllabusCourseIdentity {
  courseCode: string;
  courseTitle: string;
  courseType?: string;
}

/** VTOP's class placement for a registration — internal, never on the wire. */
interface CourseClassIdentity extends SyllabusCourseIdentity {
  classId: string;
  slot: string;
  faculty: string;
  classGroup: string;
}

export type SyllabusAbsentReason =
  /**
   * VTOP's course list WAS read and this course is not in it. Only ever used
   * when the list itself came back — a request that failed, an empty answer or
   * an unreadable one is one of the reasons below, never this one.
   */
  | 'no-course-match'
  /** VTOP answered the Course Page, and it lists no courses for this semester. */
  | 'course-list-empty'
  /** Nothing was asked properly: no route, no answer, a 404, a failed request. */
  | 'vtop-unreachable'
  /** VTOP offered no usable term at all, so there was nothing to ask for. */
  | 'semester-unknown'
  /** The detail page carries no syllabus download link. */
  | 'no-syllabus-link'
  /** A link existed but its file could not be delivered. */
  | 'document'
  /**
   * VTOP's class table answered, but no usable slot came back — empty table,
   * rows without the erpId that opens the detail page, or a slot the caller
   * named that VTOP's own rows do not carry.
   */
  | 'no-slot'
  /** VTOP's rows carried slots, but none with a faculty the caller's name matches. */
  | 'no-faculty';

/**
 * One row of VTOP's class table: the slot, the faculty VTOP attributes to it,
 * and the two ids the detail page needs. Internal only — this is how the flow
 * picks a class for itself (first valid row), and it is never sent to the
 * browser, because a student never chooses a slot or a faculty.
 */
export interface SyllabusSlotOption {
  slot: string;
  faculty: string;
  classId?: string;
  erpId?: string;
  classGroup?: string;
}

/**
 * VTOP's own term, when its Course Page named a different one than UltraCC had
 * been told. Only ever set from values VTOP printed — the page's semester
 * dropdown — and always reported, never applied silently: the answer below is
 * about `used`, not about the term the caller had selected.
 */
export interface SyllabusSemesterUsed {
  /** What the caller named — its semester id, or its own label if it sent no id. */
  requested: string;
  /** The semester id the flow actually asked VTOP about. */
  used: string;
  /** VTOP's label for it, as printed. */
  label: string;
}

export interface SyllabusInfo {
  available: boolean;
  reason?: SyllabusAbsentReason;
  /** Safe, human-readable cause when a document was attempted and failed. */
  detail?: string;
  course?: SyllabusCourseIdentity;
  document?: SyllabusDocument | null;
  /** How far the flow got before answering. */
  reached?: 'course-page' | 'courses' | 'slots' | 'detail' | 'document';
  /** Set only when VTOP's own page named another term than the caller's. */
  semester?: SyllabusSemesterUsed;
}

// ---------------------------------------------------------------------------
// Transport — injected, so the flow is pure and every path is testable
// ---------------------------------------------------------------------------

export interface SyllabusHtmlResult {
  html: string;
  status: number;
  cookie: string;
}

export interface SyllabusFileResult {
  bytes: Uint8Array;
  status: number;
  contentType: string;
  /** Filename from Content-Disposition, when VTOP sent one. */
  fileName: string;
  cookie: string;
}

export interface SyllabusTransport {
  /** POST an x-www-form-urlencoded body to a /vtop/ path. */
  post(path: string, fields: Record<string, string>, cookie: string): Promise<SyllabusHtmlResult>;
  /** GET a binary response from a /vtop/ path. */
  getFile(path: string, query: Record<string, string>, cookie: string): Promise<SyllabusFileResult>;
}

// ---------------------------------------------------------------------------
// Diagnostics — safe to log: step names, statuses, counts. Never HTML.
// ---------------------------------------------------------------------------

export type SyllabusStepName = 'warmup' | 'courses' | 'slots' | 'detail' | 'document';

export interface SyllabusDiagStep {
  step: SyllabusStepName;
  ok: boolean;
  status?: number;
  /** Route that answered (warmup has two candidate spellings). */
  route?: string;
  /** Elements the step actually found: dropdown options, class rows, links. */
  found?: number;
  /** Short non-sensitive cause: 'expired' | 'not-found' | 'no-data' | … */
  note?: string;
  bytes?: number;
  contentType?: string;
  /**
   * Course codes the step read straight out of VTOP's answer (its own dropdown
   * labels), capped. This is the one field that answers "did VTOP actually
   * list this course?" without shipping any of VTOP's HTML — the codes are the
   * student's own registered courses.
   */
  codes?: string[];
}

export interface SyllabusDiag {
  steps: SyllabusDiagStep[];
  requests: number;
  success: boolean;
}

export interface SyllabusFlowOutcome {
  info: SyllabusInfo;
  /** Refreshed cookie jar — the caller re-encrypts it into the session token. */
  cookie: string;
  sessionExpired: boolean;
  parseFailed: boolean;
  error?: string;
  diag: SyllabusDiag;
}

// ---------------------------------------------------------------------------
// Minimal HTML reading. parsers.ts keeps its equivalents private; duplicating
// these small helpers is cheaper than restructuring a 3,000-line file.
// ---------------------------------------------------------------------------

function decodeEntities(raw: string): string {
  return raw
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** One attribute out of a tag's attribute string. */
function attr(attrs: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = attrs.match(re);
  if (!m) return '';
  return decodeEntities((m[1] ?? m[2] ?? m[3] ?? '').trim());
}

function readOptions(html: string): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const re = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const label = stripTags(m[2]);
    const value = attr(m[1], 'value');
    if (!value && !label) continue;
    out.push({ value, label });
  }
  return out;
}

/** One table row: its cells, and whether they were header (<th>) cells. */
export interface HtmlRow {
  cells: string[];
  isHeader: boolean;
}

function readRows(scopeHtml: string): HtmlRow[] {
  const rows: HtmlRow[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(scopeHtml)) !== null) {
    const cells: string[] = [];
    let isHeader = false;
    const cellRe = /<t([dh])\b[^>]*>([\s\S]*?)<\/t\1\s*>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      if (cm[1].toLowerCase() === 'h') isHeader = true;
      cells.push(cm[2]);
    }
    if (cells.length) rows.push({ cells, isHeader });
  }
  return rows;
}

/** Each <table> in document order, so a lookup can stay inside its own table
 *  instead of flattening every table on the page together. */
function readTables(html: string): string[] {
  const out: string[] = [];
  const re = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[0]);
  return out;
}

function hiddenInput(html: string, name: string): string {
  const re = /<input\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const key = (attr(attrs, 'name') || attr(attrs, 'id')).toLowerCase();
    if (key !== name.toLowerCase()) continue;
    const value = attr(attrs, 'value');
    if (value) return value;
  }
  return '';
}

/**
 * Pull the quoted path out of a `vtopDownload('<path>')` call. VTOP delivers
 * it with the single quotes HTML-escaped, in either `href` or `onclick`.
 */
export function extractVtopDownloadPath(attribute: string): string {
  const cleaned = decodeEntities(attribute || '');
  const marker = cleaned.indexOf('vtopDownload(');
  if (marker === -1) return '';
  const open = cleaned.indexOf("'", marker);
  if (open === -1) return '';
  const close = cleaned.indexOf("'", open + 1);
  if (close === -1) return '';
  return cleaned.slice(open + 1, close).trim();
}

interface DownloadLink { path: string; label: string; matched: string }

function readDownloadLinks(html: string): DownloadLink[] {
  const out: DownloadLink[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const candidates = [attr(m[1], 'href'), attr(m[1], 'onclick')];
    const matched = candidates.find((c) => c.includes('vtopDownload'));
    if (!matched) continue;
    const path = extractVtopDownloadPath(matched);
    if (!path) continue;
    out.push({ path, label: stripTags(m[2]), matched });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Steps 2-4: reading VTOP's Course Page responses
// ---------------------------------------------------------------------------

export interface CourseOption {
  /** VTOP's own <option> value — the classId the slot lookup needs. */
  value: string;
  label: string;
  courseCode: string;
  courseTitle: string;
  courseType: string;
}

/** VIT's course-code shape — "CSE2009", "BAEEE203", "BAEEE203L". Nothing else. */
const COURSE_CODE_SHAPE = /^[A-Z]{2,6}\d{3,4}[A-Z]?$/;

function looksLikeCourseCode(value: string): boolean {
  return COURSE_CODE_SHAPE.test(courseCodeTokens(value)[0] || '');
}

/**
 * A trailing "( Embedded Theory )" is VTOP's type, not part of the title — but a
 * title may legitimately be parenthesised too ("Calculus (Part II)"), so the
 * parenthesis is only taken as the type when the word inside is one VTOP uses
 * for a registration type. Theory and lab of the same code are separate rows in
 * VTOP's dropdown, and this is what tells them apart when it matters.
 */
const PAREN_TYPE = /^(.*?)\s*\(([^()]*)\)\s*$/;
const TYPE_WORD = /^(?:EMBEDDED\s+)?(?:THEORY|LAB|L\d+|LO|ETH|ELC|ELA|TH\d?|TE\d?)$/;

function splitTrailingType(text: string): { courseTitle: string; courseType: string } {
  const m = text.match(PAREN_TYPE);
  if (!m || !TYPE_WORD.test(m[2].trim().toUpperCase())) return { courseTitle: text, courseType: '' };
  return { courseTitle: m[1].trim(), courseType: m[2].trim() };
}

/**
 * Labels read "CSE2009 - Soft Computing - ETH". A title may itself contain
 * " - ", so only the first and last segments are fixed — the rule the
 * reference parser uses, and the reason its test pins "Calculus - Part II".
 *
 * Two shapes live VTOP prints are absorbed rather than mistaken for a missing
 * course: a leading separator (its marks table prints
 * " - Microcontrollers and Embedded Programming ( Embedded Theory )" too), and
 * the type glued onto the code in a trailing parenthesis ("BAEEE203(ELC)").
 * The code is therefore the segment that LOOKS like a code — the first one
 * when there is one — and the original label is kept untouched as the display
 * value VTOP wrote.
 */
export function parseCoursePageOptions(html: string): CourseOption[] {
  const out: CourseOption[] = [];
  for (const opt of readOptions(html)) {
    // Dropdowns lead with a "-- Select --" style prompt carrying no value.
    if (!opt.value || opt.label.startsWith('--')) continue;
    // VTOP separates a label with " - " and, in some lists, " / ". The dash is
    // tried first and " / " only when there is no dash at all, because a title
    // can legitimately contain a slash ("Theory of Computation / Automata") and
    // splitting it would file half the title as the registration's type. The
    // original label is kept as the display value either way, so nothing the
    // student reads is rewritten. A separator VTOP left at the very edge
    // (" - BAEEE203 - …") is stripped off the segment, or the code would be
    // read as the text "- BAEEE203" and match nothing.
    const dashParts = opt.label.split(/\s+-\s+/);
    const rawParts = dashParts.length > 1 ? dashParts : opt.label.split(/\s+\/\s+/);
    const parts = rawParts
      .map((p) => p.replace(/^[\s\-–—•·]+/, '').replace(/[\s\-–—•·]+$/, ''))
      .filter(Boolean);
    const codeAt = looksLikeCourseCode(parts[0] || '')
      ? 0
      : parts.findIndex(looksLikeCourseCode);
    let courseCode = codeAt >= 0 ? parts[codeAt] : (parts[0] ?? opt.label);
    const rest = codeAt >= 0 ? parts.slice(codeAt + 1) : parts.slice(1);
    // The last segment is the type only when something sits between it and the
    // code — one lone segment after the code is the title, not a type.
    let courseType = rest.length > 1 ? rest[rest.length - 1] : '';
    let titleParts = courseType ? rest.slice(0, -1) : rest;
    if (!courseType) {
      // "BAEEE203(Embedded Theory)" — no separator at all, the type glued to
      // the code in a parenthesis. Only a parenthesised TYPE word is taken.
      const fromCode = splitTrailingType(courseCode);
      if (fromCode.courseType) {
        courseCode = fromCode.courseTitle;
        courseType = fromCode.courseType;
      }
    }
    if (!courseType && titleParts.length) {
      // The same parenthesis on the title, the other shape live VTOP prints:
      // "Microcontrollers and Embedded Programming ( Embedded Theory )".
      const split = splitTrailingType(titleParts.join(' - '));
      if (split.courseType) {
        courseType = split.courseType;
        titleParts = split.courseTitle ? [split.courseTitle] : [];
      }
    }
    out.push({
      value: opt.value, label: opt.label, courseCode,
      courseTitle: titleParts.join(' - '), courseType,
    });
  }
  return out;
}

export interface CourseClassRow extends CourseClassIdentity {
  slNo: number;
  /**
   * VTOP's own erpId for the class, read out of the detail handler in the
   * row's action cell. A row without one cannot be opened, so it is never
   * chosen — and it never leaves this module.
   */
  erpId?: string;
}

/** Read the erpId (2nd argument) out of the course-detail handler. */
export function parseErpIdFromOnclick(cellHtml: string): string {
  const cleaned = decodeEntities(cellHtml || '');
  const at = cleaned.indexOf('processViewStudentCourseDetail');
  if (at === -1) return '';
  const open = cleaned.indexOf('(', at);
  const close = cleaned.lastIndexOf(')');
  if (open === -1 || close <= open) return '';
  const parts = cleaned.slice(open + 1, close).split(',');
  if (parts.length < 2) return '';
  return parts[1].trim().replace(/^['"`]|['"`]$/g, '');
}

/**
 * The class table from getSlotIdForCoursePage: Sl.No, class group, code,
 * title, type, class id, slot, faculty, then an action cell whose button
 * onclick is processViewStudentCourseDetail('<semSubId>','<erpId>','<classId>').
 * Rows are keyed on a numeric serial, because live VTOP sometimes renders its
 * header with <td> cells inside the same table — a 9-cell header row is not
 * a class the student is in.
 */
export function parseCoursePageClassRows(html: string): CourseClassRow[] {
  const out: CourseClassRow[] = [];
  for (const { cells } of readRows(html)) {
    if (cells.length < 9) continue;
    const slNo = Number.parseInt(stripTags(cells[0]), 10);
    if (!Number.isFinite(slNo) || slNo <= 0) continue;
    out.push({
      slNo,
      classGroup: stripTags(cells[1]),
      courseCode: stripTags(cells[2]),
      courseTitle: stripTags(cells[3]),
      courseType: stripTags(cells[4]),
      classId: stripTags(cells[5]),
      slot: stripTags(cells[6]),
      faculty: stripTags(cells[7]),
      erpId: parseErpIdFromOnclick(cells[8]),
    });
  }
  return out;
}

export interface CourseDetailPage {
  info: CourseClassIdentity;
  courseId: string;
  semesterSubId: string;
  classId: string;
  /** Path from the vtopDownload link carrying 'courseSyllabusDownload'. */
  syllabusPath: string;
  /** VTOP's course-plan workbook, from its own hidden inputs. */
  coursePlanPath: string;
  downloadLinks: number;
}

/**
 * Step 4's page. Its class summary is the FIRST table, 7 columns, and — unlike
 * the class-list table — leads with the class group rather than a serial, so
 * the header row is skipped by tag rather than by number.
 *
 * `coursePlanRoute` comes from the caller's allowlist: when VTOP offers the
 * course-plan workbook without an explicit link, the URL is assembled from
 * that route plus the page's own hidden inputs.
 */
export function parseCourseDetailPage(html: string, coursePlanRoute: string): CourseDetailPage {
  const info: CourseClassIdentity = {
    courseCode: '', courseTitle: '', courseType: '', classId: '', slot: '', faculty: '', classGroup: '',
  };
  // Live VTOP sometimes renders a header row with <td> cells inside the same
  // table, so "not a <th> row" alone is not enough: the row is confirmed as
  // the class by a course-code-shaped second cell, and only failing that do
  // we fall back to the first wide row after each table's header.
  const tables = readTables(html);
  let fallback: string[] | null = null;
  for (const table of tables) {
    const rows = readRows(table);
    for (let i = 1; i < rows.length; i++) {
      const { cells, isHeader } = rows[i];
      if (isHeader || cells.length < 7) continue;
      if (!fallback) fallback = cells;
      if (/^[A-Z]{2,6}\d{3,4}/i.test(stripTags(cells[1]))) {
        fallback = cells;
        break;
      }
    }
    if (fallback && /^[A-Z]{2,6}\d{3,4}/i.test(stripTags(fallback[1]))) break;
  }
  if (fallback) {
    const cells = fallback;
    info.classGroup = stripTags(cells[0]);
    info.courseCode = stripTags(cells[1]);
    info.courseTitle = stripTags(cells[2]);
    info.courseType = stripTags(cells[3]);
    info.classId = stripTags(cells[4]);
    info.slot = stripTags(cells[5]);
    info.faculty = stripTags(cells[6]);
  }

  const links = readDownloadLinks(html);
  const syllabus = links.find((l) => l.matched.includes('courseSyllabusDownload')
    || l.path.includes('courseSyllabusDownload'));
  const planLink = links.find((l) => l.path.includes('CoursePlanExcelDownload'));
  const semesterSubId = hiddenInput(html, 'semesterSubId');
  const classId = hiddenInput(html, 'classId') || info.classId || '';

  let coursePlanPath = planLink?.path || '';
  if (!coursePlanPath && coursePlanRoute && semesterSubId && classId) {
    // The same URL the reference client builds from these two inputs. Only
    // VTOP's own ids go into the query — never a cookie or a token.
    coursePlanPath = `${coursePlanRoute}?semesterSubId=${encodeURIComponent(semesterSubId)}&classId=${encodeURIComponent(classId)}`;
  }

  return {
    info,
    courseId: hiddenInput(html, 'courseId'),
    semesterSubId,
    classId,
    syllabusPath: syllabus?.path || '',
    coursePlanPath,
    downloadLinks: links.length,
  };
}

// ---------------------------------------------------------------------------
// Matching: the student asked about one course; VTOP listed a whole semester
// ---------------------------------------------------------------------------

/** Theory and lab share a course code and are separate registrations. */
function typeMatches(have: string | undefined, want: string): boolean {
  const h = (have || '').trim().toUpperCase();
  const w = want.trim().toUpperCase();
  if (!w || w === 'COURSE') return true;
  if (h === w) return true;
  // Live Chennai vocabulary: "ETH"/"ELC"/"LO"/"TH1" AND the words themselves
  // ("Embedded Theory" / "Embedded Lab") for the same registration.
  const isLab = (v: string) =>
    v === 'LO' || v === 'LAB' || /^L\d/.test(v) || v.endsWith('OL') || v.includes('LAB');
  const isTheory = (v: string) =>
    v === 'TH' || v === 'THEORY' || /^TH\d?$/.test(v) || v.includes('THEORY');
  return (isLab(h) && isLab(w)) || (isTheory(h) && isTheory(w));
}

// ---------------------------------------------------------------------------
// Course-code matching. A code is compared as a WHOLE TOKEN, never as a
// substring: VTOP prints the same course as "BAEEE203 - Microcontrollers…",
// " - BAEEE203 - …", "BAEEE203(Embedded Theory)" and plain "BAEEE203", and an
// exact-string test misses three of the four — which then reads to the student
// as "VTOP lists no such course" when VTOP listed it all along. The mirror
// hazard is just as important: "BAEEE203" must never match "BAEEE2030" or
// "BAEEE203L", which are different registrations, so no prefix or fuzzy rule is
// used anywhere here.
// ---------------------------------------------------------------------------

/** "BAEEE 203 (Embedded Theory)" → ['BAEEE', '203', 'EMBEDDED', 'THEORY']. */
export function courseCodeTokens(value: string): string[] {
  return decodeEntities(String(value ?? ''))
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/** The code with all punctuation and spacing removed: "BAEEE 203" → "BAEEE203". */
export function normalizeCourseCode(value: string): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The leading alphanumeric run — the code part of a label, or of a messy ask. */
export function wantedCourseCode(value: string): string {
  return courseCodeTokens(value)[0] || '';
}

/**
 * True when this dropdown entry is the course that was asked for: its own code
 * field first, then the code appearing as a whole token of the label. Both
 * directions are exact — the code as a token of its own — so every shape VTOP
 * writes around a code matches while a longer code never does.
 */
export function courseOptionMatchesCode(
  option: { courseCode: string; label?: string },
  wanted: string,
): boolean {
  const want = wantedCourseCode(wanted);
  if (!want) return false;
  // The code field is usually just the code; when the label had no separator
  // at all it holds the whole label, so its tokens are checked the same way.
  if (courseCodeTokens(option.courseCode).includes(want)) return true;
  if (option.label && courseCodeTokens(option.label).includes(want)) return true;
  return false;
}

export function pickCourseOption(
  options: CourseOption[], courseCode: string, courseType?: string
): CourseOption | null {
  const want = wantedCourseCode(courseCode);
  if (!want) return null;
  const matching = options.filter((o) => courseOptionMatchesCode(o, courseCode));
  if (!matching.length) return null;
  // The entry whose own code field IS the code asked for is VTOP's registration
  // row for it and beats one that only carried the code inside a label.
  const exact = matching.filter((o) => normalizeCourseCode(o.courseCode) === want);
  const pool = exact.length ? exact : matching;
  if (courseType) {
    const byType = pool.find((o) => typeMatches(o.courseType, courseType));
    if (byType) return byType;
  }
  return pool[0];
}

export interface WantedClass {
  courseCode?: string;
  courseType?: string;
  slot?: string;
  faculty?: string;
  classId?: string;
}

/** Which of the wanted facts VTOP's own rows could not satisfy. */
export type ClassMatchMiss = 'slot' | 'faculty' | 'none';

export interface ClassMatch {
  row: CourseClassRow | null;
  /**
   * Why the row was not found: a missing faculty is a different answer from a
   * missing slot, and the student is told which one VTOP did not provide.
   */
  missing: ClassMatchMiss;
}

/**
 * Narrow the class rows to the one the student's timetable describes.
 *
 * When nothing specific was asked for — the normal case, since UltraCC does not
 * make the student choose a slot — the first row with an erpId is the pick:
 * VTOP's own first valid slot, which is exactly the selection rule its Course
 * Page uses. `missing` only ever names a fact the CALLER supplied that VTOP's
 * rows do not carry, so "no-faculty" is never claimed about a name nobody sent.
 */
export function matchClassRows(rows: CourseClassRow[], wanted: WantedClass): ClassMatch {
  if (!rows.length) return { row: null, missing: 'slot' };
  let pool = rows;
  const keep = (list: CourseClassRow[]) => (list.length ? list : pool);
  // Read the hints into locals: narrowing does not survive into a filter
  // callback, and a hint is only consulted when it was actually supplied.
  const wantClassId = (wanted.classId || '').trim();
  const wantCode = wanted.courseCode || '';
  const wantType = wanted.courseType || '';

  // Idents are facts: if VTOP's own list carries no such class, saying "that
  // one" is a guess, so it returns nothing and the caller says so too.
  if (wantClassId) {
    pool = pool.filter((r) => r.classId === wantClassId);
    if (!pool.length) return { row: null, missing: 'slot' };
  }
  if (wantCode) {
    // The same whole-token rule the dropdown uses: VTOP's class rows decorate
    // the code exactly as its dropdown labels do, and a strictly-equal test
    // here was the second way a listed course could read as "not listed".
    pool = pool.filter((r) => courseOptionMatchesCode({ courseCode: r.courseCode }, wantCode));
    if (!pool.length) return { row: null, missing: 'slot' };
  }
  if (wanted.faculty?.trim()) {
    const f = wanted.faculty.trim().toLowerCase();
    const byFaculty = pool.filter((r) => r.faculty.toLowerCase().includes(f));
    if (!byFaculty.length) return { row: null, missing: 'faculty' };
    pool = byFaculty;
  }
  // Descriptions are VTOP's formatting: a type written "TH" vs "TH1", or a
  // lab slot split across cells, is the same class. Those stay lenient.
  if (wantType) pool = keep(pool.filter((r) => typeMatches(r.courseType, wantType)));
  if (wanted.slot) {
    // VTOP writes "E1/TE1" for a two-slot lab; the student's "TE1" is in it.
    const s = wanted.slot.trim().toUpperCase();
    pool = keep(pool.filter((r) => r.slot.toUpperCase().split(/[/,]/).map((v) => v.trim()).includes(s)));
  }
  // A row without an erpId cannot open the detail page.
  const row = pool.find((r) => r.erpId) || null;
  return row ? { row, missing: 'none' } : { row: null, missing: 'slot' };
}

/** Kept as the plain "which row" question; see `matchClassRows` for the why. */
export function pickClassRow(rows: CourseClassRow[], wanted: WantedClass): CourseClassRow | null {
  return matchClassRows(rows, wanted).row;
}

/** A course with an unusual number of registrations cannot flood the picker. */
export const MAX_SLOT_OPTIONS = 12;

/**
 * VTOP's class table as options a student can pick from.
 *
 * Only rows that could actually be opened are offered: a row with no slot has
 * nothing to choose, and a row with no erpId cannot be taken to its detail
 * page, so neither is a valid option. Everything else is passed through as
 * VTOP wrote it — no dedupe by name, no reordering, no invented slot.
 */
export function slotOptionsFromRows(rows: CourseClassRow[]): SyllabusSlotOption[] {
  const out: SyllabusSlotOption[] = [];
  const seen = new Set<string>();
  for (const r of rows ?? []) {
    const slot = (r.slot || '').trim();
    const erpId = (r.erpId || '').trim();
    if (!slot || !erpId) continue;
    const key = `${slot}|${(r.classId || '').trim()}|${erpId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      slot,
      faculty: (r.faculty || '').trim(),
      classId: (r.classId || '').trim() || undefined,
      erpId,
      classGroup: (r.classGroup || '').trim() || undefined,
    });
    if (out.length >= MAX_SLOT_OPTIONS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 5: the document itself
// ---------------------------------------------------------------------------

/**
 * Only ever a relative path under /vtop/ that came out of VTOP's own
 * vtopDownload() call: no scheme, no host, no "..", and one of the four
 * download route families this flow is known to produce. Anything else is
 * rejected rather than fetched — this module must not become a proxy.
 */
export function isSafeDownloadPath(path: string): boolean {
  if (!path) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return false;  // absolute URL
  if (path.startsWith('//')) return false;                  // protocol-relative
  if (path.includes('..') || path.includes('\\')) return false;
  const [head, query] = path.split('?');
  if (!/^\/?(?:vtop\/)?[A-Za-z0-9._/-]+$/.test(head)) return false;
  if (!/(?:courseSyllabusDownload|CoursePlanExcelDownload|allCourseMeterialDownload|downloadPdf)/.test(head)) {
    return false;
  }
  if (query !== undefined && !/^[A-Za-z0-9._~:&%+=,-]*$/.test(query)) return false;
  return true;
}

/** Last path segment, for diagnostics only (never a token-bearing query). */
function pathLabel(path: string): string {
  const head = path.split('?')[0];
  return (head.split('/').filter(Boolean).pop() || head).slice(0, 60);
}

export interface SniffedType { contentType: string; extension: string }

/**
 * What the bytes actually are, by magic number. The payload wins over the
 * declared header whenever it is recognised; an unrecognised shape returns
 * null so the caller can report it instead of guessing a MIME type.
 */
export function sniffDocumentType(bytes: Uint8Array): SniffedType | null {
  if (bytes.length < 4) return null;
  const b = (i: number) => bytes[i];
  const at = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) {
    return { contentType: 'application/pdf', extension: 'pdf' };
  }
  if (b(0) === 0x50 && b(1) === 0x4b && b(2) === 0x03 && b(3) === 0x04) {
    // OOXML is a ZIP: peek at the entry names so the file the student
    // downloads carries the right extension.
    const head = at(0, Math.min(bytes.length, 64));
    if (head.includes('word')) return { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' };
    if (head.includes('xl/')) return { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
    return { contentType: 'application/zip', extension: 'zip' };
  }
  if (b(0) === 0xd0 && b(1) === 0xcf && b(2) === 0x11 && b(3) === 0xe0) {
    return { contentType: 'application/msword', extension: 'doc' };
  }
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { contentType: 'image/jpeg', extension: 'jpg' };
  // PNG's signature is 0x89 followed by the literal "PNG".
  if (b(0) === 0x89 && at(1, 4) === 'PNG') return { contentType: 'image/png', extension: 'png' };
  return null;
}

/** A header-declared type we will hand straight to the browser. */
const DECLARED_OK = /^(application\/pdf|image\/png|image\/jpe?g|text\/plain)$/i;

/** Filename from Content-Disposition, sanitised to a plain display name. */
export function fileNameFromDisposition(header: string): string {
  if (!header) return '';
  const star = header.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i);
  const plain = header.match(/filename\s*=\s*(?:"([^"]*)"|([^;\s]+))/i);
  const raw = star ? decodeURIComponent(star[1].trim()) : (plain ? (plain[1] || plain[2] || '') : '');
  const name = (raw.split(/[\\/]/).pop() || '').trim();
  return /^[A-Za-z0-9 ._[()\]-]{1,120}$/.test(name) ? name : '';
}

function bytesToBase64(bytes: Uint8Array): string | null {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  try {
    return btoa(binary);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export interface SyllabusFlowInput {
  csrf: string;
  authorizedId: string;
  /**
   * The term to ask about, when the caller happens to know one (a
   * CH2025261-style id). It is a HINT, not a requirement: the flow resolves the
   * term from VTOP's own Course Page and only fails when VTOP itself offers no
   * usable one. Empty is a normal input.
   */
  semesterId?: string;
  /** The student's own semester name ("Fall Semester 2026-27"), a second hint. */
  semesterLabel?: string;
  /** The allowlisted routes for this flow. Nothing is fetched without one. */
  routes: SyllabusRoutes;
  courseCode?: string;
  courseType?: string;
  slot?: string;
  faculty?: string;
  /** Only if the caller already resolved them from an earlier lookup. */
  classId?: string;
  erpId?: string;
}

/** VTOP semester ids are two letters and seven digits (CH2025261 / AP2023242). */
export function isVtopSemesterId(id: string): boolean {
  return /^[A-Z]{2}\d{7}$/.test((id || '').trim().toUpperCase());
}

/** One option of VTOP's own semester dropdown, exactly as the page prints it. */
export interface VtopSemesterOption {
  value: string;
  label: string;
  selected: boolean;
}

/**
 * VTOP's own semester dropdown, from whichever page carries one.
 *
 * Used for a single decision: if the semester id UltraCC was handed is not
 * among VTOP's own options, that selection is stale — and VTOP's selected
 * option is the term its Course Page will actually answer for. A page with no
 * such dropdown yields [] and no opinion is formed, which is the honest
 * outcome; nothing is ever inferred from position or from the label text.
 */
export function readSemesterOptions(html: string): VtopSemesterOption[] {
  const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  let m: RegExpExecArray | null;
  while ((m = selectRe.exec(html)) !== null) {
    const name = (attr(m[1], 'name') || attr(m[1], 'id')).toLowerCase();
    if (!name.includes('sem')) continue;
    const out: VtopSemesterOption[] = [];
    const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let om: RegExpExecArray | null;
    while ((om = optRe.exec(m[2])) !== null) {
      const value = attr(om[1], 'value');
      if (!value) continue;
      out.push({ value, label: stripTags(om[2]), selected: /\bselected\b/i.test(om[1]) });
    }
    if (out.length) return out;
  }
  return [];
}

/**
 * A term's identity, independent of how VTOP spells it: the season words plus
 * the first year it names. "Fall Semester 2026-27" and "Fall Semester
 * 2026-2027" are the same term written two ways; "Winter Semester 2025-26" is
 * a different one. Empty when the text names no year at all, in which case no
 * claim is made from it.
 */
export function semesterMatchKey(text: string): string {
  const norm = (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const season = (norm.match(/^[A-Z]+/) || [''])[0];
  const year = (norm.match(/\d{4}/) || [''])[0];
  return season && year ? `${season}|${year}` : '';
}

/** Which rule chose the term, for the diagnostic line only. */
export interface SemesterResolution {
  /** The resolved VTOP semester id, or '' when VTOP offered no usable term. */
  id: string;
  option?: VtopSemesterOption;
  /** 'semester:selected' | 'semester:requested' | 'semester:by-label' | … */
  note: string;
  /** True when the caller named a different term than the one that answered. */
  corrected: boolean;
}

/**
 * WHICH TERM TO ASK ABOUT — decided from VTOP's own Course Page, never from
 * what UltraCC happens to have in its cache.
 *
 * The order is the product rule, in priority order:
 *   1. the term the caller named, when VTOP's own list carries it — an explicit
 *      choice (the student is looking at that semester's course list) outranks
 *      the term the VTOP session happens to sit on;
 *   2. otherwise VTOP's own live selection — the term the student is really on;
 *   3. otherwise the caller's semester LABEL, matched against VTOP's labels;
 *   4. otherwise the active term VTOP lists first;
 *   5. otherwise an id-shaped id, when no dropdown answered at all.
 * Only when none of these produces a term does the caller hear
 * `semester-unknown` — and by then the Course Page really was asked.
 */
export function resolveSemester(
  warmupHtml: string,
  asked: { semesterId?: string; semesterLabel?: string },
): SemesterResolution {
  const valid = readSemesterOptions(warmupHtml || '').filter((o) => isVtopSemesterId(o.value));
  const askedId = (asked.semesterId || '').trim().toUpperCase();
  const askedLabel = semesterMatchKey(asked.semesterLabel || '');

  const finish = (option: VtopSemesterOption, note: string): SemesterResolution => {
    const byId = !!askedId && option.value.trim().toUpperCase() === askedId;
    const byLabel = !!askedLabel && semesterMatchKey(option.label) === askedLabel;
    const hadHint = !!askedId || !!askedLabel;
    return { id: option.value, option, note, corrected: hadHint && !byId && !byLabel };
  };

  // 1. The term the caller named, when VTOP's own list carries it. A student
  //    browsing an older semester's courses must get that semester's syllabus,
  //    not the one the VTOP session is currently sitting on.
  const named = valid.find((o) => o.value.trim().toUpperCase() === askedId);
  if (named) return finish(named, 'semester:requested');
  // 2. VTOP's own live selection — what carries a caller that named no term.
  const selected = valid.find((o) => o.selected);
  if (selected) return finish(selected, 'semester:selected');
  // 3. The caller's semester label — the other half of "the student's own
  //    semester", and what a synced course list can always supply.
  if (askedLabel) {
    const byLabel = valid.find((o) => semesterMatchKey(o.label) === askedLabel);
    if (byLabel) return finish(byLabel, 'semester:by-label');
  }
  // 4. The active term: VTOP lists it first. Asking the live term beats
  //    refusing to ask — that refusal was the old page-level dead end.
  if (valid.length) return finish(valid[0], 'semester:first-listed');
  // 5. No dropdown answered. An id-shaped id is still worth asking with: VTOP
  //    answers an unknown semSubId with an empty list, which the flow reports
  //    as VTOP's answer rather than as a missing term.
  if (isVtopSemesterId(askedId)) return { id: askedId, note: 'semester:unverified', corrected: false };
  return { id: '', note: 'semester:absent', corrected: false };
}

/** The codes VTOP's own dropdown listed, deduped and capped — diagnostics only. */
function listedCourseCodes(options: { courseCode: string; label?: string }[], cap: number): string[] {
  const out: string[] = [];
  for (const o of options) {
    // A code-shaped entry is shown as its normalised code; anything else is
    // shown the way VTOP printed it, so a list of non-codes can be reported in
    // its own words instead of as a blob of stripped characters.
    const code = looksLikeCourseCode(o.courseCode)
      ? normalizeCourseCode(o.courseCode)
      : (o.courseCode || o.label || '').trim().slice(0, 40);
    if (code && !out.includes(code)) out.push(code);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * "VTOP's Course Page lists 7 courses for this semester — A, B, C — and none
 * of them is BAEEE203." The only sentence that may follow a course list that
 * WAS read: it names what VTOP actually had, so a mismatch is never dressed up
 * as VTOP having nothing.
 */
function noMatchSentence(options: CourseOption[], asked: string): string {
  const codes = listedCourseCodes(options, 40);
  const shown = codes.slice(0, 8).join(', ') + (codes.length > 8 ? ', …' : '');
  // "Registered classes": theory and lab of one code are two registrations, so
  // the count is VTOP's rows and the codes beside it are deduped. Saying
  // "courses" for both numbers would read as a miscount.
  const count = options.length === 1 ? 'one registered class' : `${options.length} registered classes`;
  return `VTOP’s Course Page lists ${count} for this semester — ${shown} — and none of them is ${asked}.`;
}

const SESSION_EXPIRED_MESSAGE = 'VTOP session expired. Please re-login.';

/**
 * Walk the Course Page flow for one course. Never throws: every VTOP outcome
 * becomes a document, an honest absence, `sessionExpired`, or `parseFailed` —
 * with the step that decided it named in `diag`.
 */
export async function fetchCourseSyllabus(
  transport: SyllabusTransport,
  cookie: string,
  start: SyllabusFlowInput
): Promise<SyllabusFlowOutcome> {
  const steps: SyllabusDiagStep[] = [];
  let requests = 0;
  let jar = cookie;
  /** Grows as each step resolves a classId / erpId for the next one. */
  let input = start;
  const routes = start.routes;

  const base = { _csrf: input.csrf, authorizedID: input.authorizedId };
  const stamp = () => new Date().toUTCString();

  function result(info: SyllabusInfo, opts: { sessionExpired?: boolean; parseFailed?: boolean; error?: string; success?: boolean } = {}): SyllabusFlowOutcome {
    return {
      info,
      cookie: jar,
      sessionExpired: opts.sessionExpired ?? false,
      parseFailed: opts.parseFailed ?? false,
      error: opts.error,
      diag: { steps, requests, success: opts.success ?? false },
    };
  }
  const unavailable = (info: SyllabusInfo, error?: string) => result(info, { error });
  const expired = (info: SyllabusInfo) => result(info, { sessionExpired: true, error: SESSION_EXPIRED_MESSAGE });

  /** One VTOP POST, with the cookie jar threaded forward. Null = over budget. */
  async function post(step: SyllabusStepName, path: string, fields: Record<string, string>): Promise<SyllabusHtmlResult | null> {
    if (requests >= MAX_SYLLABUS_REQUESTS) {
      steps.push({ step, ok: false, note: 'budget' });
      return null;
    }
    requests++;
    const res = await transport.post(path, fields, jar);
    jar = res.cookie || jar;
    // An expiry page arrives with HTTP 200, so the BODY decides. The result is
    // still returned: the caller reports the step and picks the outcome.
    const dead = res.status === 404 || isLoginOrExpiredPage(res.html);
    steps.push({
      step, ok: !dead, status: res.status, route: path,
      note: res.status === 404 ? 'not-found' : isLoginOrExpiredPage(res.html) ? 'expired' : undefined,
      // Response text length only — never the body. It is the difference
      // between an error page and a real answer when nothing else parses.
      bytes: res.html.length,
    });
    return res;
  }

  // Nothing is fetched unless the caller supplied the allowlisted routes.
  if (!routes?.warmup?.length || !routes.courses || !routes.slots || !routes.detail) {
    steps.push({ step: 'warmup', ok: false, note: 'no-routes' });
    return unavailable(
      { available: false, reason: 'vtop-unreachable' },
      'UltraCC has no confirmed VTOP Course Page route for this campus, so it did not ask VTOP anything.'
    );
  }

  const courseCode = (input.courseCode || '').trim().toUpperCase();
  if (!courseCode && !input.classId) {
    steps.push({ step: 'warmup', ok: false, note: 'no-course' });
    // Checked before step 1: an unselected course is the caller's question, not
    // a VTOP answer, so do not spend a request to find out nothing was asked.
    return unavailable(
      { available: false, reason: 'no-course-match' },
      'No course was selected, so there is nothing to ask VTOP for.'
    );
  }

  // --- Step 1: open the Course Page -------------------------------------
  // VTOP will not answer the course/slot lookups until this page is visited.
  // A miss under both spellings is recorded but does not abort: step 2 answers
  // for itself, one request cheaper than a wrong conclusion.
  let warmupHtml = '';
  for (const route of routes.warmup) {
    const res = await post('warmup', route, { ...base, verifyMenu: 'true', nocache: String(Date.now()) });
    if (!res) break;
    if (isLoginOrExpiredPage(res.html)) return expired({ available: false, reason: 'vtop-unreachable' });
    if (res.status !== 404) { warmupHtml = res.html; break; }
  }

  // Whichever term VTOP's own page names, when the caller's id is not in its
  // list — carried into every answer below, so the student is never told a
  // syllabus is about one term while it was really fetched from another.
  let semesterUse: SyllabusSemesterUsed | undefined;

  // --- Step 2: the semester's course dropdown ---------------------------
  if (!input.classId) {
    // WHICH TERM TO ASK: resolved from VTOP's own Course Page, never from what
    // UltraCC happens to have synced. This replaces the old dead end where a
    // missing VTOP semester id on the client stopped the flow before VTOP was
    // asked anything at all.
    const semesterOptions = readSemesterOptions(warmupHtml);
    const term = resolveSemester(warmupHtml, {
      semesterId: input.semesterId,
      semesterLabel: input.semesterLabel,
    });
    if (!term.id) {
      steps.push({ step: 'courses', ok: false, found: semesterOptions.length, note: term.note });
      if (!warmupHtml) {
        // VTOP's Course Page never answered, so nothing was ever asked. That is
        // an unreachable VTOP, not a missing term.
        return unavailable(
          { available: false, reason: 'vtop-unreachable', reached: 'course-page' },
          'VTOP’s Course Page did not answer, so the term to ask about could not be established.'
        );
      }
      return unavailable(
        { available: false, reason: 'semester-unknown', reached: 'course-page' },
        'VTOP’s Course Page offered no term UltraCC could ask about, so this course could not be located.'
      );
    }
    input = { ...input, semesterId: term.id };
    if (term.corrected && term.option) {
      // The answer below is about VTOP's term, not the one UltraCC held, and it
      // says so — never a document silently presented as another term's.
      const asked = (start.semesterId || '').trim() || (start.semesterLabel || '').trim();
      semesterUse = { requested: asked, used: term.id, label: term.option.label };
      steps.push({ step: 'warmup', ok: true, found: semesterOptions.length, note: `semester-corrected:${asked}->${term.id}` });
    } else {
      steps.push({ step: 'warmup', ok: true, found: semesterOptions.length, note: term.note });
    }

    const res = await post('courses', routes.courses, {
      ...base, paramReturnId: 'getCourseForCoursePage', semSubId: term.id, x: stamp(),
    });
    if (!res) {
      return unavailable(
        { available: false, reason: 'vtop-unreachable', ...(semesterUse ? { semester: semesterUse } : {}) },
        'UltraCC stopped before VTOP answered its Course Page — the request did not go through. Try again.'
      );
    }
    if (isLoginOrExpiredPage(res.html)) return expired({ available: false, reason: 'vtop-unreachable' });
    if (res.status === 404) {
      // The route did not answer. That is a fact about the request, never about
      // the course — so it must not read as "VTOP has no such course".
      return unavailable(
        {
          available: false, reason: 'vtop-unreachable', reached: 'course-page',
          ...(semesterUse ? { semester: semesterUse } : {}),
        },
        'VTOP did not answer its Course Page for this term (404), so nothing about this course is known yet.'
      );
    }

    const options = parseCoursePageOptions(res.html);
    if (!options.length) {
      // Either VTOP really has nothing for this term (it says so in words) or
      // the page changed shape. Those are different answers; never guess.
      const saidEmpty = /no data|no records|not found/i.test(res.html);
      steps.push({ step: 'courses', ok: saidEmpty, status: res.status, found: 0, note: saidEmpty ? 'no-data' : 'no-options' });
      if (saidEmpty) {
        return unavailable(
          {
            available: false, reason: 'course-list-empty', reached: 'courses',
            ...(semesterUse ? { semester: semesterUse } : {}),
          },
          'VTOP’s Course Page has no registered courses to show for this term, so there is no course page to open.'
        );
      }
      return result(
        {
          available: false, reason: 'vtop-unreachable', reached: 'courses',
          ...(semesterUse ? { semester: semesterUse } : {}),
        },
        { parseFailed: true, error: 'VTOP’s Course Page answered, but its course list could not be read — the page’s shape is not one UltraCC knows.' }
      );
    }
    const codes = listedCourseCodes(options, 14);
    const codesReadable = options.some((o) => looksLikeCourseCode(o.courseCode));
    steps.push({
      step: 'courses', ok: true, status: res.status, found: options.length, codes,
      // Entries that carry no code-shaped label are a page-shape problem, not a
      // missing course. The note is what makes that visible in the diagnostic.
      note: codesReadable ? undefined : 'labels-not-codes',
    });
    const picked = pickCourseOption(options, courseCode, input.courseType);
    if (!picked) {
      // Nothing in VTOP's list is written as a course code: the failure is
      // UltraCC's reading of the page, and saying "VTOP lists no such course"
      // would be a claim about VTOP made from an answer nobody could parse.
      if (!codesReadable) {
        const unreadable = `VTOP’s Course Page answered, but the courses it lists are not written as course codes, so UltraCC could not match one to ${courseCode}. VTOP listed: ${codes.slice(0, 8).join(', ')}.`;
        return result(
          {
            available: false, reason: 'vtop-unreachable', reached: 'courses',
            detail: unreadable,
            ...(semesterUse ? { semester: semesterUse } : {}),
          },
          { parseFailed: true, error: unreadable }
        );
      }
      // The list WAS read as codes. Say how many courses VTOP listed and which
      // ones, so a mismatch names VTOP's actual answer instead of claiming
      // silence.
      return unavailable({
        available: false, reason: 'no-course-match', reached: 'courses',
        detail: noMatchSentence(options, courseCode),
        ...(semesterUse ? { semester: semesterUse } : {}),
      });
    }
    input = { ...input, classId: picked.value, courseCode: picked.courseCode || courseCode };
  }

  const askedCode = (input.courseCode || courseCode).toUpperCase();
  /** The term every later hop is asked about — resolved above, never the input's. */
  const semSubId = input.semesterId || '';

  // --- Step 3: the class rows, which carry the ids the detail page needs --
  // The student never chooses a slot or a faculty: VTOP's own class table is
  // read here and its FIRST usable row is taken — the same selection VTOP's
  // Course Page makes for itself. The rows stay internal (diagnostics and the
  // gateway's own listing flow), never on the wire.
  let erpId = input.erpId || '';
  let row: CourseClassRow | null = null;
  let classRows: SyllabusSlotOption[] = [];
  if (!erpId) {
    const classId = input.classId;
    if (!classId) {
      return unavailable(
        {
          available: false, reason: 'vtop-unreachable', reached: 'courses',
          ...(semesterUse ? { semester: semesterUse } : {}),
        },
        'VTOP named the course but nothing it can be opened with, so its class list was not asked.'
      );
    }
    const res = await post('slots', routes.slots, {
      ...base,
      classId,
      praType: 'source',
      paramReturnId: 'getSlotIdForCoursePage',
      semSubId,
      x: stamp(),
    });
    if (!res) {
      return unavailable(
        {
          available: false, reason: 'no-slot', reached: 'courses',
          ...(semesterUse ? { semester: semesterUse } : {}),
        },
        'The request for this course’s class list did not go through. Try again.'
      );
    }
    if (isLoginOrExpiredPage(res.html)) return expired({ available: false, reason: 'no-slot' });
    // A 404 here is VTOP not having that page, not a dead session — the same
    // distinction the listing makes, and the reason the two never share a path.
    if (res.status === 404) {
      steps.push({ step: 'slots', ok: false, status: 404, note: 'not-found' });
      return unavailable({
        available: false, reason: 'no-slot', reached: 'slots',
        detail: 'VTOP has no class list for this course (404), so there is no class page to open.',
        ...(semesterUse ? { semester: semesterUse } : {}),
      });
    }

    const rows = parseCoursePageClassRows(res.html);
    classRows = slotOptionsFromRows(rows);
    const match = matchClassRows(rows, {
      courseCode: askedCode, courseType: input.courseType, slot: input.slot,
      faculty: input.faculty,
      // Only a class id the CALLER supplied identifies a row. The value step 2
      // picked is VTOP's course-dropdown id, which names the course, not the
      // class — filtering rows with it would match nothing.
      classId: start.classId,
    });
    row = match.row;
    // VTOP sometimes lists only its own default class for a course; a single
    // usable row IS the student's row, so do not call that "no match".
    if (!row && rows.length === 1 && rows[0].erpId) row = rows[0];
    steps.push({
      step: 'slots', ok: !!row, status: res.status, found: rows.length,
      codes: listedCourseCodes(rows, 14),
      note: row ? undefined
        : classRows.length ? (match.missing === 'faculty' ? 'no-faculty' : 'no-slot')
          : rows.length ? 'no-usable-row' : 'no-rows',
    });
    if (!row) {
      // Which fact is missing decides the answer, and the options go with it:
      // a faculty VTOP's rows do not carry is a different state from a course
      // whose class table came back with nothing usable at all.
      const facultyMissing = match.missing === 'faculty' && classRows.length > 0;
      return unavailable({
        available: false,
        reason: facultyMissing ? 'no-faculty' : 'no-slot',
        reached: 'slots',
        // Rows that came back without the ids its class page needs are a
        // different dead end from a class list that never matched this course.
        ...(classRows.length === 0 && rows.length
          ? {
            detail: `VTOP listed ${rows.length} class ${rows.length === 1 ? 'row' : 'rows'} for this course, but none carried the ids its class page is opened with.`,
          }
          : {}),
        ...(semesterUse ? { semester: semesterUse } : {}),
      });
    }
    erpId = row.erpId || '';
    if (!erpId) {
      // matchClassRows only ever returns a row that carries an erpId, and the
      // single-row fallback checks it too — so reaching here is a shape change,
      // not a VTOP answer, and it is reported as one.
      steps.push({ step: 'slots', ok: false, note: 'row-without-erp' });
      return unavailable({
        available: false, reason: 'no-slot', reached: 'slots',
        ...(semesterUse ? { semester: semesterUse } : {}),
      });
    }
    input = { ...input, classId: row.classId || classId };
  }

  // --- Step 4: the course detail page, which carries the link -----------
  const detailClassId = input.classId;
  if (!detailClassId) {
    return unavailable({
      available: false, reason: 'no-slot', reached: 'slots',
      detail: 'VTOP did not name a class for this course, so there is no course page to open.',
      ...(semesterUse ? { semester: semesterUse } : {}),
    });
  }
  const res = await post('detail', routes.detail, {
    ...base, semSubId, erpId, classId: detailClassId, x: stamp(),
  });
  if (!res) return unavailable({ available: false, reason: 'no-syllabus-link', reached: 'slots' }, 'Could not open this course’s page on VTOP — the request did not go through. Try again.');
  if (isLoginOrExpiredPage(res.html)) return expired({ available: false, reason: 'no-syllabus-link' });
  if (res.status === 404) return unavailable({
    available: false, reason: 'no-syllabus-link', reached: 'slots',
    detail: 'VTOP has no course page for this class (404).',
    ...(semesterUse ? { semester: semesterUse } : {}),
  });

  const detail = parseCourseDetailPage(res.html, routes.coursePlan);
  steps.push({ step: 'detail', ok: true, status: res.status, found: detail.downloadLinks });

  // VTOP's own naming for this class beats anything the client sent — and only
  // its NAMING is kept. The class placement (class id, slot, faculty) got the
  // flow here; serialising it would put VTOP's plumbing in front of a student
  // who asked for a course.
  const named: CourseClassIdentity = row ?? detail.info;
  const course: SyllabusCourseIdentity = {
    courseCode: named.courseCode || askedCode,
    courseTitle: named.courseTitle || '',
    courseType: named.courseType || input.courseType || '',
  };

  if (!detail.syllabusPath && !detail.coursePlanPath) {
    steps.push({ step: 'detail', ok: false, note: 'no-link' });
    return unavailable({
      available: false, reason: 'no-syllabus-link', course, reached: 'detail',
      ...(semesterUse ? { semester: semesterUse } : {}),
    });
  }

  // --- Step 5: the bytes — syllabus first, course plan as the fallback --
  const attempts: { path: string; origin: 'course-syllabus' | 'course-plan' }[] = [];
  if (detail.syllabusPath) attempts.push({ path: detail.syllabusPath, origin: 'course-syllabus' });
  if (detail.coursePlanPath) attempts.push({ path: detail.coursePlanPath, origin: 'course-plan' });

  let lastDetail = 'VTOP offered no readable document';
  for (const attempt of attempts) {
    if (requests >= MAX_SYLLABUS_REQUESTS) {
      steps.push({ step: 'document', ok: false, note: 'budget' });
      break;
    }
    if (!isSafeDownloadPath(attempt.path)) {
      steps.push({ step: 'document', ok: false, note: 'blocked-path' });
      lastDetail = `VTOP offered a download UltraCC will not follow (${pathLabel(attempt.path)})`;
      continue;
    }
    requests++;
    // Cookie only. The session's CSRF token and reg number are deliberately
    // absent: a URL is written into proxy and access logs, a header is not.
    // If VTOP ever demands them on the download, the transport in index.ts is
    // the one place that decides it — this flow never asks.
    const file = await transport.getFile(attempt.path, { x: stamp() }, jar);
    jar = file.cookie || jar;
    if (file.status >= 400) {
      steps.push({ step: 'document', ok: false, status: file.status, note: 'http-error' });
      lastDetail = `VTOP answered ${file.status} for the document`;
      continue;
    }
    if (!file.bytes.length) {
      steps.push({ step: 'document', ok: false, status: file.status, note: 'empty' });
      lastDetail = 'VTOP served an empty document';
      continue;
    }
    if (file.bytes.length > MAX_SYLLABUS_BYTES) {
      steps.push({ step: 'document', ok: false, bytes: file.bytes.length, note: 'too-large' });
      return unavailable(
        {
          available: false, reason: 'document', course, reached: 'detail',
          ...(semesterUse ? { semester: semesterUse } : {}),
        },
        `The syllabus file is ${(file.bytes.length / 1_000_000).toFixed(1)} MB, which UltraCC will not hold in memory.`
      );
    }
    const sniffed = sniffDocumentType(file.bytes);
    const declared = (file.contentType || '').split(';')[0].trim().toLowerCase();
    const contentType = sniffed?.contentType || (DECLARED_OK.test(declared) ? declared : '');
    if (!contentType) {
      steps.push({
        step: 'document', ok: false, status: file.status, bytes: file.bytes.length,
        contentType: declared || 'unknown', note: 'unknown-type',
      });
      lastDetail = `VTOP served a file UltraCC cannot identify (${declared || 'no type stated'})`;
      continue;
    }
    const encoded = bytesToBase64(file.bytes);
    if (!encoded) {
      steps.push({ step: 'document', ok: false, note: 'encode-failed' });
      lastDetail = 'The document could not be encoded for the browser';
      continue;
    }
    steps.push({
      step: 'document', ok: true, status: file.status, bytes: file.bytes.length,
      contentType, note: attempt.origin,
    });
    const extension = sniffed?.extension || (contentType === 'application/pdf' ? 'pdf' : 'bin');
    // The name is a local download label, built from VTOP's own course code
    // when the server did not send one. Nothing about the content is ours.
    const fileName = file.fileName
      || `${(course.courseCode || askedCode || 'VTOP').replace(/[^A-Za-z0-9._-]/g, '')}-${attempt.origin === 'course-plan' ? 'course-plan' : 'syllabus'}.${extension}`;
    return result({
      available: true,
      course,
      document: {
        dataUrl: `data:${contentType};base64,${encoded}`,
        contentType,
        fileName,
        bytes: file.bytes.length,
        origin: attempt.origin,
      },
      reached: 'document',
      ...(semesterUse ? { semester: semesterUse } : {}),
    }, { success: true });
  }

  return unavailable({
    available: false,
    reason: detail.syllabusPath ? 'document' : 'no-syllabus-link',
    detail: lastDetail,
    course,
    reached: 'detail',
    ...(semesterUse ? { semester: semesterUse } : {}),
  });
}

/**
 * One-line safe summary for development logs: steps, statuses, counts and the
 * course codes VTOP listed.
 *
 * The codes are the one piece of VTOP's CONTENT this prints, and they are what
 * answers the only question that used to be unanswerable from a log: did VTOP
 * put this course on the page, or did UltraCC fail to read it? They are course
 * codes — catalogue numbers printed on the tab's own cards — never a cookie, a
 * token, a session id or any VTOP HTML. Everything else here stays structural.
 */
export function summarizeSyllabusDiag(diag: SyllabusDiag, label = 'syllabus'): string {
  const parts = diag.steps.map((s) => {
    const bits = [
      s.status,
      s.found !== undefined ? `${s.found}` : undefined,
      s.bytes ? `${s.bytes}B` : undefined,
      s.codes?.length ? s.codes.join('+') : undefined,
      s.note,
      s.contentType,
    ].filter((v) => v !== undefined && v !== '');
    return `${s.step}${s.ok ? ' ok' : ' fail'}${bits.length ? `(${bits.join(',')})` : ''}`;
  });
  return `${label} ${diag.success ? 'served' : 'unavailable'} in ${diag.requests} request(s): ${parts.join(' -> ') || 'no steps'}`;
}

// ---------------------------------------------------------------------------
// Structured failure classification — WHICH hop died, in one fixed word
// ---------------------------------------------------------------------------

/**
 * The stage a syllabus attempt died at.
 *
 * WHY THIS EXISTS: a syllabus click fails at one of eight different places, and
 * every one of them used to reach the browser as the same sentence — "VTOP
 * could not be reached right now" is equally true of a 404 course route, an
 * unreadable page, a dead session and a refused connection, so a live failure
 * could not be traced from outside the gateway. This vocabulary gives the
 * failing hop a name that is safe to log and safe to return to a development
 * client: no cookie, no token, no session id, no VTOP HTML, no file bytes.
 */
export type SyllabusFailureStage =
  | 'SESSION'
  | 'SEMESTER'
  | 'COURSE'
  | 'SLOT'
  | 'FACULTY'
  | 'DETAIL'
  | 'DOWNLOAD'
  | 'UPSTREAM';

/**
 * One failure, in fixed vocabulary. `reason` is SCREAMING_SNAKE and is drawn
 * only from the literal set in `classifySyllabusFailure` — it is never built
 * from VTOP text, a course code, a status line or an error message.
 */
export interface SyllabusFailure {
  stage: SyllabusFailureStage;
  reason: string;
  /** The HTTP status of the step that decided it, when a route answered at all. */
  status?: number;
}

/** The last step that did not succeed — the step that decided the outcome. */
function failedStep(outcome: SyllabusFlowOutcome): SyllabusDiagStep | undefined {
  for (let i = outcome.diag.steps.length - 1; i >= 0; i--) {
    if (!outcome.diag.steps[i].ok) return outcome.diag.steps[i];
  }
  return undefined;
}

/**
 * The last step of a given name that answered anything — a status, a count, or
 * both. A step that "succeeded" can still be the one that decided the outcome
 * (an empty class table and a full one both answer 200), so the deciding step
 * is looked up by name rather than by whether it failed.
 */
function answeredStep(outcome: SyllabusFlowOutcome, name: SyllabusStepName): SyllabusDiagStep | undefined {
  for (let i = outcome.diag.steps.length - 1; i >= 0; i--) {
    const s = outcome.diag.steps[i];
    if (s.step === name && (s.status !== undefined || s.found !== undefined)) return s;
  }
  return undefined;
}

/**
 * Name the hop that failed, from the flow's own diagnostics. Null when the
 * flow served a document — there is no failure to name, and a caller must
 * never be handed a made-up one.
 *
 * The decisions are ordered by how much they know:
 *   1. an expired session and an unreadable page are decided by the outcome's
 *      own flags — they are never inferred from a step name;
 *   2. an absence VTOP stated is reported by its reason, so a course VTOP does
 *      not list can never read as "VTOP was unreachable";
 *   3. only when nothing was asked properly does the failed STEP decide, and a
 *      step that answered 404 is named as a route miss (`*_ROUTE_NOT_FOUND`),
 *      because "the route moved" and "nothing answered" are different fixes.
 */
export function classifySyllabusFailure(outcome: SyllabusFlowOutcome): SyllabusFailure | null {
  if (outcome.diag.success) return null;
  const failed = failedStep(outcome);
  const at = (stage: SyllabusFailureStage, reason: string, status?: number): SyllabusFailure => {
    const s = status ?? failed?.status;
    return s !== undefined ? { stage, reason, status: s } : { stage, reason };
  };

  if (outcome.sessionExpired) return at('SESSION', 'SESSION_EXPIRED', failed?.status);
  // `parseFailed` is only ever set when a page DID answer in a shape nothing
  // could be read from: the failure is UltraCC's reading, not VTOP's silence.
  if (outcome.parseFailed) return at('COURSE', 'COURSE_PARSE_ERROR', answeredStep(outcome, 'courses')?.status);

  const detailStep = answeredStep(outcome, 'detail');

  switch (outcome.info.reason) {
    case 'no-course-match':
      return at('COURSE', 'COURSE_NOT_FOUND', answeredStep(outcome, 'courses')?.status);
    case 'course-list-empty':
      return at('COURSE', 'COURSE_LIST_EMPTY', answeredStep(outcome, 'courses')?.status);
    case 'semester-unknown':
      return at('SEMESTER', 'SEMESTER_NOT_FOUND', answeredStep(outcome, 'warmup')?.status);
    case 'no-faculty':
      return at('FACULTY', 'FACULTY_NOT_FOUND', answeredStep(outcome, 'slots')?.status);
    case 'no-slot':
      return at('SLOT',
        failed?.note === 'not-found' ? 'CLASS_ROUTE_NOT_FOUND'
          : failed?.note === 'row-without-erp' ? 'CLASS_ROW_UNUSABLE'
            : failed?.note === 'budget' ? 'REQUEST_BUDGET_EXHAUSTED'
              : 'CLASS_NOT_FOUND',
        answeredStep(outcome, 'slots')?.status);
    case 'no-syllabus-link':
      return at('DETAIL',
        failed?.note === 'not-found' ? 'DETAIL_ROUTE_NOT_FOUND'
          // A detail page that answered with no download action on it is the
          // same fact however the flow then ended — the link was not there.
          : failed?.note === 'no-link' || detailStep?.found === 0 ? 'SYLLABUS_ACTION_NOT_FOUND'
            : failed?.note === 'budget' ? 'REQUEST_BUDGET_EXHAUSTED'
              : 'DETAIL_UNAVAILABLE',
        detailStep?.status);
    case 'document':
      return at('DOWNLOAD',
        failed?.note === 'too-large' ? 'SYLLABUS_FILE_TOO_LARGE'
          : failed?.note === 'unknown-type' ? 'UNKNOWN_DOCUMENT_TYPE'
            : failed?.note === 'http-error' ? 'DOCUMENT_HTTP_ERROR'
              : failed?.note === 'empty' ? 'EMPTY_DOCUMENT'
                : failed?.note === 'blocked-path' ? 'BLOCKED_DOWNLOAD_PATH'
                  : failed?.note === 'encode-failed' ? 'DOCUMENT_ENCODE_FAILED'
                    : 'INVALID_SYLLABUS_FILE',
        answeredStep(outcome, 'document')?.status);
    default:
      break;
  }

  // Nothing was asked properly (`vtop-unreachable` and anything unmapped), so
  // the failed STEP is the fact worth reporting.
  switch (failed?.step) {
    case 'slots':
      return at('SLOT', 'CLASS_ROUTE_UNREACHABLE');
    case 'detail':
      return at('DETAIL', 'DETAIL_ROUTE_UNREACHABLE');
    case 'document':
      return at('DOWNLOAD', 'DOCUMENT_UNREACHABLE');
    default:
      if (failed?.note === 'no-routes') return at('UPSTREAM', 'NO_ROUTES');
      if (failed?.note === 'budget') return at('UPSTREAM', 'REQUEST_BUDGET_EXHAUSTED');
      if (failed?.note === 'no-course') return at('COURSE', 'COURSE_NOT_SELECTED');
      return failed?.status === 404
        ? at('UPSTREAM', 'COURSE_PAGE_ROUTE_NOT_FOUND', 404)
        : at('UPSTREAM', 'COURSE_PAGE_UNREACHABLE', answeredStep(outcome, 'warmup')?.status);
  }
}

/**
 * One line, fixed alphabet: `stage=COURSE reason=COURSE_NOT_FOUND status=200`.
 * Safe in any log and on any wire — that is the whole point of the vocabulary.
 */
export function summarizeSyllabusFailure(failure: SyllabusFailure): string {
  const status = failure.status !== undefined && Number.isFinite(failure.status)
    ? ` status=${Math.trunc(failure.status)}`
    : '';
  return `stage=${failure.stage} reason=${failure.reason}${status}`;
}
