/**
 * syllabus.test.ts — VTOP's Course Page → syllabus-document flow (syllabus.ts).
 *
 * The HTML fixtures here are REFERENCE-SHAPED, not captured: they mirror the
 * markup structures the live-tested Vellore client pins in its own parser
 * tests (the `&#39;`-escaped detail onclick, the 9-column class table, the
 * `vtopDownload('<path>')` anchors, the hidden courseId/semesterSubId/classId
 * inputs). They prove the flow reads VTOP's structures and cannot invent an
 * answer; they do NOT prove Chennai's route spellings, which no synthetic
 * fixture can.
 *
 * Covers every outcome the brief demands a regression test for: successful
 * extraction, course identification, a missing syllabus, a malformed
 * response, an expired session, a gateway/transport failure, a
 * link/document response, an oversized file, and the download-path guard —
 * including the one this feature must never regress: the document request is
 * authenticated by COOKIE ONLY, never by putting _csrf/authorizedID in a URL.
 */

import { describe, it, expect } from 'vitest';
import {
  classifySyllabusFailure,
  courseCodeTokens,
  courseOptionMatchesCode,
  fetchCourseSyllabus,
  normalizeCourseCode,
  parseCoursePageOptions,
  parseCoursePageClassRows,
  parseCourseDetailPage,
  parseErpIdFromOnclick,
  pickCourseOption,
  pickClassRow,
  readSemesterOptions,
  resolveSemester,
  semesterMatchKey,
  isSafeDownloadPath,
  isVtopSemesterId,
  sniffDocumentType,
  fileNameFromDisposition,
  summarizeSyllabusDiag,
  summarizeSyllabusFailure,
  MAX_SYLLABUS_BYTES,
  MAX_SYLLABUS_REQUESTS,
  type SyllabusHtmlResult,
  type SyllabusDiagStep,
  type SyllabusRoutes,
  type SyllabusTransport,
} from './syllabus.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROUTES: SyllabusRoutes = {
  warmup: ['academics/common/StudentCoursePage', 'academics/common/StudentCoursePageChn'],
  courses: 'getCourseForCoursePage',
  slots: 'getSlotIdForCoursePage',
  detail: 'processViewStudentCourseDetail',
  coursePlan: 'academics/common/CoursePlanExcelDownload',
};

const SEM = 'CH2025261';
const SYLLABUS_PATH = 'courseSyllabusDownload/CHN/100123';

function selectHtml(entries: { value: string; label: string }[]): string {
  return `<select id="courseCode" name="courseCode">
    <option value="">-- Select Course --</option>
    ${entries.map((e) => `<option value="${e.value}">${e.label}</option>`).join('\n')}
  </select>`;
}

const COURSES = selectHtml([
  { value: '100123', label: 'CSE2009 - Soft Computing - ETH' },
  { value: '100124', label: 'MAT1001 - Calculus - Part II - TH1' },
  { value: '100199', label: 'CSE2009 - Soft Computing - LO' },
]);

/** One 9-column class row; the action cell carries the escaped onclick. */
function classRow(sl: string, cells: string[], withOnclick = true): string {
  const onclick = withOnclick
    ? `javascript: processViewStudentCourseDetail(&#39;${SEM}&#39;,&#39;${sl === '1' ? '70735' : '70736'}&#39;,&#39;AP2025264000${sl.padStart(3, '0')}&#39;);`
    : '';
  return `<tr><td>${sl}</td>${cells.map((c) => `<td>${c}</td>`).join('')}`
    + `<td><button type="button" onclick="${onclick}">View</button></td></tr>`;
}

const SLOTS_HTML = `<table>
  ${classRow('1', ['General', 'CSE2009', 'Soft Computing', 'ETH', 'AP2025264000001', 'E1/TE1', '70735 - S Subhani - SCOPE'])}
</table>`;

const SLOTS_TWO_ROWS = `<table>
  ${classRow('1', ['General', 'CSE2009', 'Soft Computing', 'ETH', 'AP2025264000001', 'E1', '70735 - S Subhani - SCOPE'])}
  ${classRow('2', ['General', 'CSE2009', 'Soft Computing', 'LO', 'AP2025264000002', 'L41', '70736 - K Raghav - SCOPE'])}
</table>`;

/** The detail page: 7-column summary (no serial), hidden ids, download links. */
function detailHtml(opts: { syllabusLink?: boolean; planLink?: boolean; withIds?: boolean } = {}): string {
  const { syllabusLink = true, planLink = false, withIds = true } = opts;
  const links: string[] = [];
  if (syllabusLink) {
    links.push(`<a href="javascript:vtopDownload(&#39;${SYLLABUS_PATH}&#39;)">Syllabus</a>`);
  }
  if (planLink) {
    links.push('<a href="javascript:vtopDownload(&#39;allCourseMeterialDownload/1/1&#39;)">All materials</a>');
  }
  return `<div id="main-section">
    ${withIds ? `<input type="hidden" name="courseId" value="100123"/>
      <input type="hidden" name="semesterSubId" value="${SEM}"/>
      <input type="hidden" name="classId" value="AP2025264000001"/>` : ''}
    <table>
      <tr><th>Class Group</th><th>Course Code</th><th>Course Title</th><th>Course Type</th><th>Class Id</th><th>Slot</th><th>Faculty</th></tr>
      <tr><td>General</td><td>CSE2009</td><td>Soft Computing</td><td>ETH</td><td>AP2025264000001</td><td>E1/TE1</td><td>70735 - S Subhani - SCOPE</td></tr>
    </table>
    ${links.join('\n')}
  </div>`;
}

const LOGIN_PAGE = '<html><body><form id="vtopLoginForm"><input name="captchaStr"/><input name="password"/></form></body></html>';
const NO_DATA = '<div id="main-section"><select id="courseCode"><option value="">-- Select Course --</option></select><p>No Data Found</p></div>';
const GARBAGE = '<html><body><p>Something went wrong</p></body></html>';

function pdfBytes(size = 2048): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0); // %PDF-
  return bytes;
}

// ---------------------------------------------------------------------------
// A scripted transport: each VTOP route gets a canned answer, and every call
// is recorded so a test can assert what was requested, not just what returned.
// ---------------------------------------------------------------------------

interface Call { path: string; fields?: Record<string, string>; query?: Record<string, string>; cookie: string }

function makeTransport(handlers: Record<string, Partial<SyllabusHtmlResult> | 'throw'> = {}) {
  const calls: Call[] = [];
  const files: Call[] = [];
  let fileResult: { bytes: Uint8Array; status: number; contentType: string; fileName: string } = {
    bytes: pdfBytes(), status: 200, contentType: 'application/pdf', fileName: '',
  };

  // A handler only changes the jar when it says it did — VTOP re-sends
  // Set-Cookie on some responses and nothing on most, and the flow must keep
  // the affinity cookies it was given in between.
  const answerFor = (path: string, requestCookie: string): SyllabusHtmlResult => {
    const h = handlers[path];
    if (h === 'throw') throw new Error(`VTOP request timed out after 15s per hop / 40s total`);
    return {
      html: h?.html ?? '',
      status: h?.status ?? 200,
      cookie: h?.cookie ?? requestCookie,
    };
  };

  const transport: SyllabusTransport = {
    async post(path, fields, cookie) {
      calls.push({ path, fields, cookie });
      return answerFor(path, cookie);
    },
    async getFile(path, query, cookie) {
      files.push({ path, query, cookie });
      return { ...fileResult, cookie };
    },
  };
  return {
    transport,
    calls,
    files,
    setFile(r: Partial<typeof fileResult>) { fileResult = { ...fileResult, ...r }; },
  };
}

const DEFAULT_HANDLERS = (html: Partial<Record<string, string>> = {}): Record<string, Partial<SyllabusHtmlResult>> => ({
  'academics/common/StudentCoursePage': { html: '<div id="main-section">course page</div>' },
  getCourseForCoursePage: { html: COURSES },
  getSlotIdForCoursePage: { html: SLOTS_HTML },
  processViewStudentCourseDetail: { html: html.detail ?? detailHtml() },
});

const baseInput = {
  csrf: 'csrf-token-value', authorizedId: '21BCE9999', semesterId: SEM,
  courseCode: 'CSE2009', routes: ROUTES,
};

// ---------------------------------------------------------------------------

describe('Course Page responses', () => {
  it('reads the dropdown, splitting a title that contains " - "', () => {
    const options = parseCoursePageOptions(COURSES);

    expect(options.map((o) => o.value)).toEqual(['100123', '100124', '100199']);
    expect(options[0]).toMatchObject({ courseCode: 'CSE2009', courseTitle: 'Soft Computing', courseType: 'ETH' });
    // The dash inside the title must not shift the type onto the title.
    expect(options[1]).toMatchObject({ courseTitle: 'Calculus - Part II', courseType: 'TH1' });
  });

  it('reads a class row, taking the faculty erpId out of its escaped onclick', () => {
    const rows = parseCoursePageClassRows(SLOTS_HTML);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      courseCode: 'CSE2009', courseType: 'ETH', classId: 'AP2025264000001',
      slot: 'E1/TE1', faculty: '70735 - S Subhani - SCOPE', erpId: '70735',
    });
  });

  it('skips a header row even when VTOP renders it with <td> cells', () => {
    const html = '<table><tr><td>Sl.No</td><td>Class Group</td><td>Course Code</td><td>Course Title</td><td>Course Type</td><td>Class Id</td><td>Slot</td><td>Faculty</td><td>Action</td></tr>'
      + classRow('1', ['General', 'CSE2009', 'Soft Computing', 'ETH', 'AP2025264000001', 'E1', '70735 - S Subhani']) + '</table>';

    expect(parseCoursePageClassRows(html)).toHaveLength(1);
  });

  it('yields no erpId when the action cell has no detail handler', () => {
    expect(parseErpIdFromOnclick('<button>View</button>')).toBe('');
    expect(parseCoursePageClassRows(SLOTS_HTML.replace(/processViewStudentCourseDetail/g, 'somethingElse'))[0].erpId).toBe('');
  });

  it('reads the detail page summary, its hidden ids and its syllabus link', () => {
    const detail = parseCourseDetailPage(detailHtml(), ROUTES.coursePlan);

    expect(detail.info).toMatchObject({
      courseCode: 'CSE2009', courseTitle: 'Soft Computing', courseType: 'ETH',
      classId: 'AP2025264000001', slot: 'E1/TE1', faculty: '70735 - S Subhani - SCOPE',
    });
    expect(detail.courseId).toBe('100123');
    expect(detail.syllabusPath).toBe(SYLLABUS_PATH);
  });

  it('builds a course-plan URL from the page\'s own ids, never a guessed one', () => {
    const detail = parseCourseDetailPage(detailHtml({ syllabusLink: false }), ROUTES.coursePlan);

    expect(detail.syllabusPath).toBe('');
    expect(detail.coursePlanPath)
      .toBe(`${ROUTES.coursePlan}?semesterSubId=${SEM}&classId=AP2025264000001`);
  });

  it('invents no course-plan URL when the page carries no ids', () => {
    expect(parseCourseDetailPage(detailHtml({ syllabusLink: false, withIds: false }), ROUTES.coursePlan).coursePlanPath).toBe('');
  });
});

describe('matching a course', () => {
  it('keeps theory and lab apart — they are separate registrations', () => {
    const options = parseCoursePageOptions(COURSES);

    expect(pickCourseOption(options, 'CSE2009', 'ETH')?.value).toBe('100123');
    expect(pickCourseOption(options, 'CSE2009', 'LO')?.value).toBe('100199');
    expect(pickCourseOption(options, 'MAT1001')?.value).toBe('100124');
    expect(pickCourseOption(options, 'CSE9999')).toBeNull();
  });

  it('matches a two-slot lab written "E1/TE1" against either slot', () => {
    const rows = parseCoursePageClassRows(SLOTS_HTML);

    expect(pickClassRow(rows, { slot: 'TE1' })?.erpId).toBe('70735');
    expect(pickClassRow(rows, { slot: 'E1' })?.erpId).toBe('70735');
  });

  it('narrows multiple classes by type and faculty', () => {
    const rows = parseCoursePageClassRows(SLOTS_TWO_ROWS);

    expect(pickClassRow(rows, { courseType: 'LO' })?.classId).toBe('AP2025264000002');
    expect(pickClassRow(rows, { faculty: 'Raghav' })?.classId).toBe('AP2025264000002');
    // Nothing matches the unknown faculty: no silent pick of row 1.
    expect(pickClassRow(rows, { faculty: 'Nobody' })).toBeNull();
  });
});

describe('fetchCourseSyllabus — the document path', () => {
  it('walks all five steps and returns VTOP\'s file as a data URL', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());

    const outcome = await fetchCourseSyllabus(t.transport, 'JSESSIONID=seed', baseInput);

    expect(outcome.info.available).toBe(true);
    expect(outcome.info.document?.contentType).toBe('application/pdf');
    expect(outcome.info.document?.dataUrl.startsWith('data:application/pdf;base64,')).toBe(true);
    expect(outcome.info.reached).toBe('document');
    expect(outcome.diag.success).toBe(true);
    // The identity in the answer is VTOP's naming for the course — and ONLY
    // the naming. The class VTOP used to get there (its class id, slot, faculty)
    // is how the document was found; a student who asked for a course never
    // reads VTOP's plumbing back.
    expect(outcome.info.course).toMatchObject({
      courseCode: 'CSE2009',
      courseTitle: 'Soft Computing',
      courseType: 'ETH',
    });
    expect(Object.keys(outcome.info.course ?? {}).sort()).toEqual(['courseCode', 'courseTitle', 'courseType']);
    expect(JSON.stringify(outcome.info)).not.toMatch(/"slot"|"faculty"|"classId"|"erpId"|"options"/);
    expect(t.calls.map((c) => c.path)).toEqual([
      'academics/common/StudentCoursePage',
      'getCourseForCoursePage',
      'getSlotIdForCoursePage',
      'processViewStudentCourseDetail',
    ]);
    // The dropdown is asked with VTOP's own field names.
    expect(t.calls[1].fields).toMatchObject({ semSubId: SEM, paramReturnId: 'getCourseForCoursePage' });
    expect(t.calls[2].fields).toMatchObject({ classId: '100123', praType: 'source', paramReturnId: 'getSlotIdForCoursePage' });
    // The erpId belongs to the class row, not the dropdown value: step 3 must
    // not invent one.
    expect(t.calls[2].fields?.erpId).toBeUndefined();
    expect(t.calls[3].fields).toMatchObject({ erpId: '70735', classId: 'AP2025264000001', semSubId: SEM });
  });

  it('sends the semester\'s course list, then finds the requested course in it', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', { ...baseInput, courseCode: 'MAT1001' });

    // MAT1001's dropdown value is 100124 — the slot lookup must use that id.
    expect(t.calls[2].fields?.classId).toBe('100124');
    expect(outcome.info.available).toBe(true);
  });

  it('names a document from VTOP\'s course code when the server sends no filename', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info.document?.fileName).toBe('CSE2009-syllabus.pdf');
    expect(outcome.info.document?.origin).toBe('course-syllabus');
  });

  it('keeps a filename VTOP did send', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());
    t.setFile({ fileName: 'CSE2009 SYLL 2025.pdf' });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info.document?.fileName).toBe('CSE2009 SYLL 2025.pdf');
  });

  it('falls back to VTOP\'s course plan and labels it as one', async () => {
    const t = makeTransport(DEFAULT_HANDLERS({
      detail: detailHtml({ syllabusLink: false }),
    }));

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info.available).toBe(true);
    expect(outcome.info.document?.origin).toBe('course-plan');
    expect(t.files[0].path).toContain('CoursePlanExcelDownload');
  });

  it('trusts the bytes over a wrong declared content type', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());
    t.setFile({ contentType: 'application/octet-stream' });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info.document?.contentType).toBe('application/pdf');
  });

  it('reports an unidentifiable file instead of guessing a MIME type', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());
    t.setFile({ bytes: new TextEncoder().encode('<html><body>an error page, not a pdf</body></html>'), contentType: 'text/html' });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info.available).toBe(false);
    expect(outcome.info.reason).toBe('document');
    expect(outcome.info.detail).toMatch(/cannot identify/);
    expect(outcome.diag.steps.some((s) => s.step === 'document' && s.note === 'unknown-type')).toBe(true);
  });
});

describe('fetchCourseSyllabus — honest absence', () => {
  it('says so when the course detail page links no syllabus', async () => {
    const t = makeTransport({
      'academics/common/StudentCoursePage': { html: '<div>ok</div>' },
      getCourseForCoursePage: { html: COURSES },
      getSlotIdForCoursePage: { html: SLOTS_HTML },
      processViewStudentCourseDetail: { html: detailHtml({ syllabusLink: false, withIds: false }) },
    });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info).toMatchObject({ available: false, reason: 'no-syllabus-link', reached: 'detail' });
    expect(outcome.info.course?.courseCode).toBe('CSE2009');
    expect(outcome.sessionExpired).toBe(false);
    expect(outcome.parseFailed).toBe(false);
  });

  it('says so when the semester lists no such course — and stops there', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', { ...baseInput, courseCode: 'CSE9999' });

    expect(outcome.info).toMatchObject({ available: false, reason: 'no-course-match', reached: 'courses' });
    // No point asking for the slots of a course VTOP says is not there.
    expect(t.calls.map((c) => c.path)).not.toContain('getSlotIdForCoursePage');
  });

  it('treats VTOP\'s explicit "No Data Found" as its own answer — an empty term, not a missing course', async () => {
    const t = makeTransport({ ...DEFAULT_HANDLERS(), getCourseForCoursePage: { html: NO_DATA } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    // NOT 'no-course-match': VTOP never got as far as listing courses, so this
    // is a fact about the term and must not be worded as one about the course.
    expect(outcome.info.reason).toBe('course-list-empty');
    expect(outcome.info.reason).not.toBe('no-course-match');
    expect(outcome.parseFailed).toBe(false);
  });

  it('calls a shapeless response a parse failure, not an empty semester', async () => {
    const t = makeTransport({ ...DEFAULT_HANDLERS(), getCourseForCoursePage: { html: GARBAGE } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.parseFailed).toBe(true);
    expect(outcome.error).toMatch(/could not be read/);
    expect(outcome.info.reason).not.toBe('no-course-match');
  });

  it('asks VTOP before it will call a semester unusable', async () => {
    // The page answered but carries no term dropdown, and the id the app sent
    // is not a VTOP semester id at all. VTOP WAS asked first: the Course Page
    // request is there, so the answer is a fact about VTOP's page rather than
    // the page-level dead end this flow used to open with.
    const t = makeTransport(DEFAULT_HANDLERS());

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', { ...baseInput, semesterId: 'SEM-1' });

    expect(outcome.parseFailed).toBe(false);
    expect(outcome.info.reason).toBe('semester-unknown');
    expect(outcome.info.reached).toBe('course-page');
    // Never "no such course": nothing about the course was learned.
    expect(outcome.info.reason).not.toBe('no-course-match');
    expect(t.calls.map((c) => c.path)).toEqual(['academics/common/StudentCoursePage']);
  });

  it('calls a Course Page that never answered unreachable, not an unknown semester', async () => {
    // Nothing was asked properly, so nothing about a term can be claimed.
    const t = makeTransport({
      'academics/common/StudentCoursePage': { html: 'gone', status: 404 },
      'academics/common/StudentCoursePageChn': { html: 'gone', status: 404 },
    });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', { ...baseInput, semesterId: 'SEM-1' });

    expect(outcome.info.reason).toBe('vtop-unreachable');
    expect(outcome.info.reason).not.toBe('semester-unknown');
    expect(outcome.sessionExpired).toBe(false);
  });

  it('asks nothing when no course was selected', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', { ...baseInput, courseCode: '' });

    expect(outcome.info.reason).toBe('no-course-match');
    expect(t.calls).toHaveLength(0);
  });

  it('tries Chennai\'s spelling only after the first one 404s', async () => {
    const t = makeTransport({
      // DEFAULT_HANDLERS first: the overrides below must win.
      ...DEFAULT_HANDLERS(),
      'academics/common/StudentCoursePage': { html: 'gone', status: 404 },
      'academics/common/StudentCoursePageChn': { html: '<div>ok</div>' },
    });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(t.calls[0].path).toBe('academics/common/StudentCoursePage');
    expect(t.calls[1].path).toBe('academics/common/StudentCoursePageChn');
    expect(outcome.info.available).toBe(true);
  });

  it('fetches nothing when the caller supplied no allowlisted route', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', {
      ...baseInput, routes: { ...ROUTES, warmup: [] },
    });

    expect(outcome.info.available).toBe(false);
    expect(outcome.error).toMatch(/no confirmed VTOP Course Page route/);
    expect(outcome.info.reason).toBe('vtop-unreachable');
    expect(t.calls).toHaveLength(0);
  });
});

describe('fetchCourseSyllabus — session and transport failures', () => {
  it('reports an expired session when VTOP serves the login page', async () => {
    const t = makeTransport({ 'academics/common/StudentCoursePage': { html: LOGIN_PAGE } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.sessionExpired).toBe(true);
    expect(outcome.error).toMatch(/session expired/i);
  });

  it('detects an expiry returned with HTTP 200 at the detail step', async () => {
    const t = makeTransport(DEFAULT_HANDLERS({ detail: LOGIN_PAGE }));

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.sessionExpired).toBe(true);
    expect(outcome.info.available).toBe(false);
  });

  it('surfaces a gateway/transport throw to the caller instead of swallowing it', async () => {
    const t = makeTransport({ 'academics/common/StudentCoursePage': 'throw' });

    await expect(fetchCourseSyllabus(t.transport, 'jar', baseInput)).rejects.toThrow(/timed out/);
  });

  it('reports an HTTP error on the document as a failure, not an empty syllabus', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());
    t.setFile({ status: 500, bytes: new Uint8Array(0) });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info.available).toBe(false);
    expect(outcome.info.detail).toMatch(/answered 500/);
  });

  it('reports an oversized file honestly and never as a missing syllabus', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());
    t.setFile({ bytes: pdfBytes(MAX_SYLLABUS_BYTES + 10) });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info.reason).toBe('document');
    expect(outcome.error).toMatch(/MB/);
  });

  it('stays inside its request budget however many steps remain', async () => {
    // Every route answers 404, so the warm-up tries both spellings and each
    // later step is still reached once; the budget is what bounds the total.
    const handlers: Record<string, Partial<SyllabusHtmlResult>> = {};
    for (const p of Object.keys(DEFAULT_HANDLERS())) handlers[p] = { html: '', status: 404 };
    const t = makeTransport(handlers);

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.diag.requests).toBeLessThanOrEqual(MAX_SYLLABUS_REQUESTS);
    expect(outcome.info.available).toBe(false);
  });
});

describe('the document request never carries session credentials', () => {
  it('authenticates with the cookie alone', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());

    await fetchCourseSyllabus(t.transport, 'JSESSIONID=abc; SERVERID=n1', baseInput);

    expect(t.files).toHaveLength(1);
    const { query, cookie } = t.files[0];
    expect(cookie).toContain('JSESSIONID=abc');
    // A URL is logged by proxies and access logs; a session token is not.
    expect(query._csrf).toBeUndefined();
    expect(query.authorizedID).toBeUndefined();
    const asString = JSON.stringify(query);
    expect(asString).not.toContain('csrf-token-value');
    expect(asString).not.toContain('21BCE9999');
  });

  it('carries the cookie jar forward from VTOP\'s own responses', async () => {
    const t = makeTransport({
      ...DEFAULT_HANDLERS(),
      'academics/common/StudentCoursePage': { html: '<div>ok</div>', cookie: 'JSESSIONID=rotated' },
    });

    const outcome = await fetchCourseSyllabus(t.transport, 'JSESSIONID=old', baseInput);

    expect(t.files[0].cookie).toBe('JSESSIONID=rotated');
    // The caller re-encrypts this into the session token.
    expect(outcome.cookie).toBe('JSESSIONID=rotated');
  });
});

describe('download-path guard', () => {
  it.each([
    ['courseSyllabusDownload/CHN/1', true],
    ['downloadPdf/A/B/19', true],
    ['academics/common/CoursePlanExcelDownload?semesterSubId=CH2025261&classId=1', true],
    ['vtop/courseSyllabusDownload/1', true],
    ['https://evil.example/x?courseSyllabusDownload', false],
    ['//evil.example/courseSyllabusDownload', false],
    ['../admin/courseSyllabusDownload', false],
    ['courseSyllabusDownload/..%2f..%2fetc', false],
    ['courseSyllabusDownload?a=<script>', false],
    ['someOtherHandler/1', false],
    ['', false],
  ])('isSafeDownloadPath(%s) === %s', (path, expected) => {
    expect(isSafeDownloadPath(path)).toBe(expected);
  });

  it('fetches nothing when VTOP offers neither a link nor its own ids', async () => {
    // withIds:false removes the hidden semesterSubId/classId, so the course
    // plan cannot be reconstructed either. UltraCC must not invent a URL.
    const t = makeTransport({
      ...DEFAULT_HANDLERS(),
      processViewStudentCourseDetail: { html: detailHtml({ syllabusLink: false, withIds: false }) },
    });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(t.files).toHaveLength(0);
    expect(outcome.info).toMatchObject({ available: false, reason: 'no-syllabus-link' });
  });

  it('refuses to fetch a link whose path fails the guard', async () => {
    // withIds:false so the course-plan fallback cannot answer instead: this
    // test is about the one unsafe link VTOP offered and UltraCC declined.
    const t = makeTransport({
      ...DEFAULT_HANDLERS(),
      processViewStudentCourseDetail: {
        html: detailHtml({ withIds: false }).replace(SYLLABUS_PATH, 'https://evil.example/courseSyllabusDownload'),
      },
    });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(t.files.map((f) => f.path)).toEqual([]);
    expect(outcome.info.available).toBe(false);
    expect(outcome.info.detail).toMatch(/will not follow/);
  });
});

describe('type and name detection', () => {
  it('identifies documents by magic bytes', () => {
    expect(sniffDocumentType(pdfBytes())?.extension).toBe('pdf');
    // OOXML is a ZIP, so the entry names are what separate a Word file from
    // a workbook from an archive.
    const ooxml = (entry: string) => new Uint8Array(
      [0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(entry)],
    );
    expect(sniffDocumentType(ooxml('docProps/word/document.xml'))?.extension).toBe('docx');
    expect(sniffDocumentType(ooxml('xl/workbook.xml'))?.extension).toBe('xlsx');
    expect(sniffDocumentType(ooxml('nothing/recognised/here'))?.extension).toBe('zip');
    expect(sniffDocumentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))?.contentType).toBe('image/png');
    expect(sniffDocumentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.extension).toBe('jpg');
    expect(sniffDocumentType(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('sanitises a server-supplied filename', () => {
    expect(fileNameFromDisposition('attachment; filename="Syllabus CSE2009.pdf"')).toBe('Syllabus CSE2009.pdf');
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''Syllabus%202025.pdf")).toBe('Syllabus 2025.pdf');
    // Nothing that could break out of an attribute or carry a path.
    expect(fileNameFromDisposition('attachment; filename="../../x.pdf"')).toBe('x.pdf');
    expect(fileNameFromDisposition('attachment; filename="a<b>c.pdf"')).toBe('');
    expect(fileNameFromDisposition('')).toBe('');
  });

  it('accepts only VTOP\'s real semester-id shape', () => {
    expect(isVtopSemesterId('CH2025261')).toBe(true);
    expect(isVtopSemesterId('AP2023242')).toBe(true);
    expect(isVtopSemesterId('SEM-1')).toBe(false);
    expect(isVtopSemesterId('')).toBe(false);
  });
});

describe('diagnostics hygiene', () => {
  it('summarises a run as step names, statuses and counts only', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());

    const outcome = await fetchCourseSyllabus(t.transport, 'JSESSIONID=topsecret', baseInput);
    const line = summarizeSyllabusDiag(outcome.diag);

    expect(line).toContain('syllabus served');
    expect(line).toContain('courses ok');
    expect(line).toContain('document ok');
    // The whole point: this line is safe to put in a log and in the browser.
    expect(line).not.toContain('topsecret');
    expect(line).not.toContain('csrf-token-value');
    expect(line).not.toContain('21BCE9999');
    expect(line).not.toContain('<');
  });

  it('names the failing step for a missing syllabus', async () => {
    const t = makeTransport({
      ...DEFAULT_HANDLERS(),
      processViewStudentCourseDetail: { html: detailHtml({ syllabusLink: false, withIds: false }) },
    });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(summarizeSyllabusDiag(outcome.diag)).toContain('detail fail(no-link)');
  });
});

// ---------------------------------------------------------------------------
// The class step: VTOP's own rows are read here and ITS FIRST VALID ROW is the
// pick. The student chooses a course and nothing else — there is no slot
// parameter, no faculty parameter and no class id on the wire, and none of the
// rows VTOP listed travels back to the browser.
// ---------------------------------------------------------------------------

/** Two registrations of one course, differing only in slot and faculty. */
const TWO_SECTIONS = `<table>
  ${classRow('1', ['General', 'CSE2009', 'Soft Computing', 'ETH', 'AP2025264000001', 'E1', '70735 - S Subhani - SCOPE'])}
  ${classRow('2', ['General', 'CSE2009', 'Soft Computing', 'ETH', 'AP2025264000002', 'E2', '70736 - K Raghav - SCOPE'])}
</table>`;

/** A table row written with VTOP's own ids, for cases `classRow` cannot state. */
function rawRow(sl: string, slot: string, faculty: string, erpId: string): string {
  const classId = `AP2025264000${sl.padStart(3, '0')}`;
  return `<tr><td>${sl}</td><td>General</td><td>CSE2009</td><td>Soft Computing</td><td>ETH</td>`
    + `<td>${classId}</td><td>${slot}</td><td>${faculty}</td>`
    + `<td><button onclick="javascript: processViewStudentCourseDetail('${SEM}','${erpId}','${classId}');">View</button></td></tr>`;
}

describe('the class is chosen for the student — VTOP’s first valid row, no picker', () => {
  it('skips a row it could not open and takes the next valid one', () => {
    const rows = parseCoursePageClassRows(`<table>
      ${rawRow('1', 'E1', '70735 - S Subhani', '')}
      ${rawRow('2', 'E2', '70736 - K Raghav', '70736')}
    </table>`);

    // A row with no erpId cannot be taken to its detail page, so it is not a
    // row the flow could have used — the pick moves on to VTOP's next one.
    expect(pickClassRow(rows, { courseCode: 'CSE2009' })?.erpId).toBe('70736');
  });

  it('takes VTOP’s first valid row without asking anyone', async () => {
    const t = makeTransport({ ...DEFAULT_HANDLERS(), getSlotIdForCoursePage: { html: TWO_SECTIONS } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info.available).toBe(true);
    // The detail page was opened with the FIRST row's ids — VTOP's own choice
    // for this course, made with no input from the student.
    expect(t.calls[3].fields).toMatchObject({ erpId: '70735', classId: 'AP2025264000001' });
    // And none of VTOP's rows travelled back: no slot, no faculty, no ids.
    expect(JSON.stringify(outcome.info)).not.toMatch(/"slot"|"faculty"|"classId"|"erpId"|"options"/);
  });

  it('needs no interaction when VTOP lists several classes for one course', async () => {
    // Three rows, the first without the ids its detail page needs: the row
    // that gets used is VTOP's first VALID one, exactly one detail page is
    // opened for it, and nothing was asked of the student to decide that.
    const many = `<table>
      ${rawRow('1', 'E1', '70735 - S Subhani', '')}
      ${rawRow('2', 'E2', '70736 - K Raghav', '70736')}
      ${rawRow('3', 'E3', '70737 - R Kumar', '70737')}
    </table>`;
    const t = makeTransport({ ...DEFAULT_HANDLERS(), getSlotIdForCoursePage: { html: many } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info.available).toBe(true);
    expect(t.calls.filter((c) => c.path === ROUTES.detail)).toHaveLength(1);
    expect(t.calls[3].fields).toMatchObject({ erpId: '70736', classId: 'AP2025264000002' });
    // Nothing to pick from reached the browser: the answer carries no options.
    expect('options' in outcome.info).toBe(false);
  });

  it('answers "no slot" when the class table offers nothing openable', async () => {
    const unopenable = `<table>${rawRow('1', 'E1', '70735 - S Subhani', '')}</table>`;
    const t = makeTransport({ ...DEFAULT_HANDLERS(), getSlotIdForCoursePage: { html: unopenable } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info).toMatchObject({ available: false, reason: 'no-slot', reached: 'slots' });
    // "VTOP listed a row but it carried no ids" is a different dead end from
    // "VTOP listed nothing", and the sentence says which one happened.
    expect(outcome.info.detail).toMatch(/1 class row.*none carried the ids/i);
  });

  it('answers "no slot" for an empty class table too, not a broken session', async () => {
    const t = makeTransport({ ...DEFAULT_HANDLERS(), getSlotIdForCoursePage: { html: '<table></table>' } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.info.reason).toBe('no-slot');
    expect(outcome.sessionExpired).toBe(false);
    expect(outcome.parseFailed).toBe(false);
    expect(outcome.diag.steps.some((s) => s.step === 'slots' && s.note === 'no-rows')).toBe(true);
  });

  it('keeps a 404 on the class table a missing dataset, not a dead session', async () => {
    const t = makeTransport({
      ...DEFAULT_HANDLERS(),
      getSlotIdForCoursePage: { html: '<html><body>HTTP Status 404 – Not Found</body></html>', status: 404 },
    });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.sessionExpired).toBe(false);
    expect(outcome.parseFailed).toBe(false);
    expect(outcome.info.reason).toBe('no-slot');
    expect(outcome.diag.steps.some((s) => s.step === 'slots' && s.status === 404 && s.note === 'not-found')).toBe(true);
  });

  it('still calls a login page at the class-table step an expired session', async () => {
    const t = makeTransport({ ...DEFAULT_HANDLERS(), getSlotIdForCoursePage: { html: LOGIN_PAGE } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.sessionExpired).toBe(true);
    expect(outcome.info.available).toBe(false);
  });

  it('ships a course identity, never VTOP’s class placement, to the browser', async () => {
    const t = makeTransport({ ...DEFAULT_HANDLERS(), getSlotIdForCoursePage: { html: TWO_SECTIONS } });

    const outcome = await fetchCourseSyllabus(t.transport, 'JSESSIONID=topsecret', baseInput);
    const shipped = JSON.stringify(outcome.info);

    // The document itself, VTOP's naming for the course, and the reasons it
    // might not exist — nothing else. No class id, no erpId, no slot, no
    // faculty, no session material and no raw HTML.
    expect(Object.keys(outcome.info).sort()).toEqual(['available', 'course', 'document', 'reached']);
    expect(shipped).not.toMatch(/AP20252640|70735|70736/);
    // The slots as values — quoted, since the course code itself contains the
    // letters "E2" and an unquoted search would find that and nothing real.
    expect(shipped).not.toMatch(/"E1"|"E2"|"E1\/TE1"/);
    expect(shipped).not.toMatch(/topsecret|csrf-token-value|21BCE9999/i);
    expect(shipped).not.toContain('<');
    expect('options' in outcome.info).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The production failure this file exists for, in the shape it actually took.
//
// A student opened BAEEE203 — a course VTOP's Course Page does list — and was
// told "VTOP's Course Page listed no such course for this semester". Eleven
// different dead ends all answered with that one sentence, so the sentence
// could not be trusted and neither could the flow: a course VTOP had listed,
// with a faculty and a slot VTOP had printed, was reported as one VTOP had
// never heard of, and the card's data quietly came from the timetable instead.
//
// The fixture below is the live Chennai shape: VTOP's own semester dropdown on
// the Course Page, its course dropdown with a decorated code and an explicit
// type, a 9-column class table whose code cell is decorated the same way, and a
// detail page whose download link is the syllabus.
// ---------------------------------------------------------------------------

/** VTOP's own term dropdown, the only place a term is ever read from. */
const SEMESTER_SELECT = `<select id="semesterSubId" name="semesterSubId">
  <option value="CH2024251">Fall Semester 2024-25</option>
  <option value="CH2025261" selected>Fall Semester 2025-26</option>
</select>`;

/** The term VTOP has selected when the client's own id is not in its list. */
const VTOP_TERM = 'CH2025261';
/** Another term VTOP lists — so an id from it is stale, but a real one. */
const STALE_TERM = 'CH2024251';
/** A term VTOP's dropdown does not list at all: the genuinely unknown id. */
const UNKNOWN_TERM = 'CH2026251';

/** The student's real registrations, decorated the way VTOP's dropdown prints. */
const BA_COURSES = selectHtml([
  { value: '100201', label: 'BAEEE203 - Microcontrollers and Embedded Programming - Embedded Theory' },
  { value: '100202', label: 'BAEEE203 - Microcontrollers and Embedded Programming - Embedded Lab' },
  { value: '100203', label: 'BMAT201L - Calculus and Linear Algebra - Embedded Theory' },
  { value: '100204', label: 'BEEE102P - Basic Electrical and Electronics Engineering - Embedded Lab' },
  { value: '100205', label: 'BCSE204L - Data Structures and Algorithms - Embedded Theory' },
  { value: '100206', label: 'BCHY101L - Engineering Chemistry - Embedded Theory' },
  { value: '100207', label: 'BENG101P - Communicative English - Embedded Lab' },
]);

/** The class table for BAEEE203, its code decorated as VTOP writes it. */
const BA_SLOTS = `<table>
  ${classRow('1', ['A3', 'BAEEE203', 'Microcontrollers and Embedded Programming', 'Embedded Theory', 'AP2025264000001', 'C1', '70735 - Dr Anand - SEEE'])}
</table>`;

/** The same page for the lab registration: same code, different class. */
const BA_LAB_SLOTS = `<table>
  ${classRow('2', ['L43', 'BAEEE203', 'Microcontrollers and Embedded Programming', 'Embedded Lab', 'AP2025264000002', 'TC1', '70736 - Dr Meera - SEEE'])}
</table>`;

const BA_DETAIL = `<div id="main-section">
  <input type="hidden" name="courseId" value="100201"/>
  <input type="hidden" name="semesterSubId" value="${VTOP_TERM}"/>
  <input type="hidden" name="classId" value="AP2025264000001"/>
  <table>
    <tr><th>Class Group</th><th>Course Code</th><th>Course Title</th><th>Course Type</th><th>Class Id</th><th>Slot</th><th>Faculty</th></tr>
    <tr><td>A3</td><td>BAEEE203</td><td>Microcontrollers and Embedded Programming</td><td>Embedded Theory</td><td>AP2025264000001</td><td>C1</td><td>70735 - Dr Anand - SEEE</td></tr>
  </table>
  <a href="javascript:vtopDownload(&#39;courseSyllabusDownload/CHN/BAEEE203&#39;)">Syllabus</a>
</div>`;

/** Keyed by VTOP's own route, exactly as the calls are: one override per path. */
function baTransport(over: Record<string, Partial<SyllabusHtmlResult> & { html: string }> = {}) {
  const answers: Record<string, Partial<SyllabusHtmlResult>> = {
    'academics/common/StudentCoursePage': { html: `<div id="main-section">${SEMESTER_SELECT}</div>` },
    getCourseForCoursePage: { html: BA_COURSES },
    getSlotIdForCoursePage: { html: BA_SLOTS },
    processViewStudentCourseDetail: { html: BA_DETAIL },
    ...over,
  };
  const t = makeTransport(answers);
  return { ...t, answers };
}

/**
 * One hop pushes two steps under its own name: the request, then what the flow
 * made of the answer. The analysis is the later of the two, and it is the one
 * that carries `found`, `codes` and the note.
 */
function lastStep(steps: SyllabusDiagStep[], step: string): SyllabusDiagStep | undefined {
  return [...steps].reverse().find((s) => s.step === step);
}

describe('the BAEEE203 failure — a course VTOP lists must never read as "not listed"', () => {
  it('walks semester → VTOP course → VTOP class row → VTOP ids → VTOP’s syllabus file', async () => {
    const t = baTransport();

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', {
      csrf: 'csrf-token-value', authorizedId: '21BCE9999', semesterId: VTOP_TERM,
      courseCode: 'BAEEE203', courseType: 'Embedded Theory', routes: ROUTES,
    });

    // 1. VTOP's own dropdown answered for the term UltraCC asked about, so no
    //    correction is claimed.
    expect(outcome.info.semester).toBeUndefined();

    // 2. BAEEE203 was found in VTOP's list and its own dropdown id used.
    expect(outcome.info.available).toBe(true);
    expect(t.calls[1].fields).toMatchObject({ semSubId: VTOP_TERM, paramReturnId: 'getCourseForCoursePage' });
    expect(t.calls[2].fields).toMatchObject({ classId: '100201', praType: 'source' });

    // 3. The answer carries VTOP's course naming and NOTHING of the class
    //    placement that got there: the slot, faculty, class group and ids were
    //    used, and a student who asked for a course does not read them back.
    expect(outcome.info.course).toEqual({
      courseCode: 'BAEEE203',
      courseTitle: 'Microcontrollers and Embedded Programming',
      courseType: 'Embedded Theory',
    });
    expect('options' in outcome.info).toBe(false);

    // 4. The detail page was opened with VTOP's OWN class identity — the ids
    //    from its class row, never the dropdown's course id and never a slot
    //    borrowed from the timetable.
    expect(t.calls[3].fields).toMatchObject({
      erpId: '70735', classId: 'AP2025264000001', semSubId: VTOP_TERM,
    });

    // 5. And the file itself came from the link on that page.
    expect(t.files.map((f) => f.path)).toEqual(['courseSyllabusDownload/CHN/BAEEE203']);
    expect(outcome.info.document?.origin).toBe('course-syllabus');
    expect(outcome.diag.success).toBe(true);
  });

  it('takes each registration’s own class row — the type decides which one', async () => {
    const labDetail = BA_DETAIL
      .replaceAll('100201', '100202')
      .replaceAll('AP2025264000001', 'AP2025264000002');
    const lab = baTransport({
      getSlotIdForCoursePage: { html: BA_LAB_SLOTS },
      processViewStudentCourseDetail: { html: labDetail },
    });

    const outcome = await fetchCourseSyllabus(lab.transport, 'jar', {
      csrf: 'csrf', authorizedId: '21BCE9999', semesterId: VTOP_TERM,
      courseCode: 'BAEEE203', courseType: 'Embedded Lab', routes: ROUTES,
    });

    // Both entries carry BAEEE203; the type is what separates the two
    // registrations, so the lab's own dropdown id is asked for — and the lab
    // class row VTOP lists is the one its detail page is opened with.
    expect(lab.calls[2].fields?.classId).toBe('100202');
    expect(lab.calls[3].fields).toMatchObject({ erpId: '70736', classId: 'AP2025264000002' });
    expect(outcome.info.available).toBe(true);
  });

  it('tells the student WHICH courses VTOP listed when the code really is absent', async () => {
    const t = baTransport();

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', {
      csrf: 'csrf', authorizedId: '21BCE9999', semesterId: VTOP_TERM,
      courseCode: 'BAEEE999', routes: ROUTES,
    });

    expect(outcome.info).toMatchObject({ available: false, reason: 'no-course-match', reached: 'courses' });
    // The sentence nobody could write before: it names VTOP's actual list.
    expect(outcome.info.detail).toMatch(/lists 7 registered classes/);
    expect(outcome.info.detail).toMatch(/BAEEE203/);
    expect(outcome.info.detail).toMatch(/none of them is BAEEE999/);
    // And the diagnostic says the same thing in a form a log can hold. Seven
    // rows, six distinct codes: theory and lab of BAEEE203 are two classes.
    const courses = lastStep(outcome.diag.steps, 'courses');
    expect(courses?.codes).toContain('BAEEE203');
    expect(courses?.codes).toHaveLength(6);
    // Nothing was asked of a course VTOP does not list.
    expect(t.calls.map((c) => c.path)).not.toContain(ROUTES.slots);
  });

  it('calls a list of non-codes a page-shape problem, not a missing course', async () => {
    // VTOP answered the Course Page. Its entries are not course codes — so the
    // failure is UltraCC's reading of the page, and saying "VTOP lists no such
    // course" would be a claim about VTOP made from data nobody could parse.
    const weird = selectHtml([
      { value: '100301', label: 'Registration One' },
      { value: '100302', label: 'Registration Two' },
    ]);
    const t = baTransport({ getCourseForCoursePage: { html: weird } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', {
      csrf: 'csrf', authorizedId: '21BCE9999', semesterId: VTOP_TERM,
      courseCode: 'BAEEE203', routes: ROUTES,
    });

    expect(outcome.info.available).toBe(false);
    // A page-shape failure, reported as one: not "VTOP has no such course".
    expect(outcome.parseFailed).toBe(true);
    expect(outcome.info.reason).toBe('vtop-unreachable');
    expect(outcome.sessionExpired).toBe(false);
    expect(lastStep(outcome.diag.steps, 'courses')?.note).toBe('labels-not-codes');
    // The comparison ran, and the answer explains itself in VTOP's own words
    // rather than silently substituting the timetable.
    expect(outcome.info.detail).toMatch(/not written as course codes/);
    expect(outcome.info.detail).toMatch(/Registration One/);
    expect(t.calls.map((c) => c.path)).toEqual([ROUTES.warmup[0], ROUTES.courses]);
  });

  it('reports the term VTOP answered for when UltraCC’s own id is not one of its terms', async () => {
    const t = baTransport();

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', {
      csrf: 'csrf', authorizedId: '21BCE9999', semesterId: UNKNOWN_TERM,
      courseCode: 'BAEEE203', routes: ROUTES,
    });

    // VTOP's selected term is used, and the answer says so instead of quietly
    // presenting a Fall 2025-26 course as the unknown term's.
    expect(outcome.info.semester).toEqual({
      requested: UNKNOWN_TERM, used: VTOP_TERM, label: 'Fall Semester 2025-26',
    });
    expect(t.calls[1].fields?.semSubId).toBe(VTOP_TERM);
    expect(outcome.diag.steps.some((s) => s.note === `semester-corrected:${UNKNOWN_TERM}->${VTOP_TERM}`)).toBe(true);
    expect(outcome.info.available).toBe(true);
  });

  it('does not correct a term VTOP itself lists', async () => {
    const t = baTransport();

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', {
      csrf: 'csrf', authorizedId: '21BCE9999', semesterId: STALE_TERM,
      courseCode: 'BAEEE203', routes: ROUTES,
    });

    // CH2024251 IS one of VTOP's terms, so the student's own choice is honoured
    // — the check only ever rescues an id VTOP does not have at all.
    expect(t.calls[1].fields?.semSubId).toBe(STALE_TERM);
    expect(outcome.info.semester).toBeUndefined();
  });

  it('reads VTOP’s semester dropdown without inventing a term from position', async () => {
    const options = readSemesterOptions(`<div>${SEMESTER_SELECT}</div>
      <select name="unrelated"><option value="X" selected>X</option></select>`);

    expect(options.map((o) => [o.value, o.selected])).toEqual([['CH2024251', false], ['CH2025261', true]]);
    expect(options[1].label).toBe('Fall Semester 2025-26');
    // A page with no term dropdown yields no opinion, never a first-option guess.
    expect(readSemesterOptions('<div><select name="courseCode"><option value="1">x</option></select></div>')).toEqual([]);
  });

  it('matches every decoration VTOP writes around a course code', () => {
    const labels = [
      'BAEEE203 - Microcontrollers and Embedded Programming - Embedded Theory',
      'BAEEE203 - Microcontrollers and Embedded Programming',
      'BAEEE203(Embedded Theory)',
      ' - BAEEE203 - Microcontrollers and Embedded Programming ( Embedded Theory )',
      'BAEEE203 / Microcontrollers and Embedded Programming',
      'BAEEE203',
    ];
    for (const label of labels) {
      const options = parseCoursePageOptions(selectHtml([{ value: '1', label }]));
      expect(options, label).toHaveLength(1);
      expect(options[0].courseCode, label).toBe('BAEEE203');
      expect(pickCourseOption(options, 'BAEEE203')?.value, label).toBe('1');
    }
    // The parenthesised type is VTOP's type, not part of the title.
    const typed = parseCoursePageOptions(selectHtml([
      { value: '1', label: 'BAEEE203 - Microcontrollers and Embedded Programming ( Embedded Theory )' },
    ]));
    expect(typed[0]).toMatchObject({ courseTitle: 'Microcontrollers and Embedded Programming', courseType: 'Embedded Theory' });
  });

  it('keeps a title that contains a slash whole once the dash separated it', () => {
    const options = parseCoursePageOptions(selectHtml([
      { value: '1', label: 'BMAT201L - Theory of Computation / Automata - Embedded Theory' },
    ]));

    // The slash is a separator in some labels, but a title may contain one too;
    // splitting on it here would file "Automata" as the registration's type.
    expect(options[0]).toMatchObject({
      courseCode: 'BMAT201L',
      courseTitle: 'Theory of Computation / Automata',
      courseType: 'Embedded Theory',
    });
    expect(pickCourseOption(options, 'BMAT201L', 'Embedded Theory')?.value).toBe('1');
  });

  it('never matches a longer code to the code asked for, in either direction', () => {
    const options = parseCoursePageOptions(selectHtml([
      { value: '1', label: 'BAEEE2030 - Advanced Microcontrollers - Embedded Theory' },
      { value: '2', label: 'BAEEE203L - Microcontrollers Lab - Embedded Lab' },
    ]));

    // A prefix rule would match both of these; a whole-token rule matches none.
    expect(pickCourseOption(options, 'BAEEE203')).toBeNull();
    expect(courseOptionMatchesCode({ courseCode: 'BAEEE2030' }, 'BAEEE203')).toBe(false);
    expect(courseOptionMatchesCode({ courseCode: 'BAEEE203' }, 'BAEEE2030')).toBe(false);
    // …and the real course still matches its own decorations.
    expect(courseOptionMatchesCode({ courseCode: 'BAEEE203' }, 'BAEEE203')).toBe(true);
    expect(courseCodeTokens('BAEEE 203 ( Embedded Theory )')).toEqual(['BAEEE', '203', 'EMBEDDED', 'THEORY']);
    expect(normalizeCourseCode('BAEEE 203')).toBe('BAEEE203');
  });

  it('the diagnostic names the code, the term and the step — and no VTOP HTML', async () => {
    const t = baTransport();

    const outcome = await fetchCourseSyllabus(t.transport, 'JSESSIONID=topsecret', {
      csrf: 'csrf-token-value', authorizedId: '21BCE9999', semesterId: UNKNOWN_TERM,
      courseCode: 'BAEEE203', routes: ROUTES,
    });
    const line = summarizeSyllabusDiag(outcome.diag);

    expect(line).toContain('warmup ok');
    expect(line).toContain(`semester-corrected:${UNKNOWN_TERM}->${VTOP_TERM}`);
    expect(line).toContain('BAEEE203');
    expect(line).toContain('document ok');
    expect(line).not.toContain('topsecret');
    expect(line).not.toContain('csrf-token-value');
    expect(line).not.toContain('21BCE9999');
    expect(line).not.toContain('<');
    expect(line).not.toContain('Microcontrollers');
  });

  it('asks about VTOP’s own term when the browser names none at all', async () => {
    const t = baTransport();

    // The case the old flow dead-ended on: no term from the client. VTOP's
    // Course Page is still asked, and its own selected term answers — the
    // student never had to tell UltraCC which semester they are in.
    const outcome = await fetchCourseSyllabus(t.transport, 'jar', {
      csrf: 'csrf', authorizedId: '21BCE9999', courseCode: 'BAEEE203', routes: ROUTES,
    });

    expect(t.calls.map((c) => c.path))
      .toEqual([ROUTES.warmup[0], ROUTES.courses, ROUTES.slots, ROUTES.detail]);
    expect(t.calls[1].fields?.semSubId).toBe(VTOP_TERM);
    expect(lastStep(outcome.diag.steps, 'warmup')?.note).toBe('semester:selected');
    // Nothing to correct, because nothing was claimed: no term line at all.
    expect(outcome.info.semester).toBeUndefined();
    expect(outcome.info.available).toBe(true);
  });

  it('uses the student’s semester label when that is all the app could send', async () => {
    // A Course Page that marks no term — then the caller's own label decides.
    const unmarked = `<div><select name="semesterSubId">
      <option value="CH2024251">Fall Semester 2024-25</option>
      <option value="CH2025261">Fall Semester 2025-26</option>
    </select></div>`;
    const t = baTransport({ 'academics/common/StudentCoursePage': { html: unmarked } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', {
      csrf: 'csrf', authorizedId: '21BCE9999', semesterLabel: 'Fall Semester 2024-25',
      courseCode: 'BAEEE203', routes: ROUTES,
    });

    // The label names VTOP's older term, and that term is asked about: a
    // student looking at Fall 2024-25 gets Fall 2024-25, not whichever term
    // VTOP happens to have open.
    expect(t.calls[1].fields?.semSubId).toBe(STALE_TERM);
    expect(lastStep(outcome.diag.steps, 'warmup')?.note).toBe('semester:by-label');
    // The label matched VTOP's own name for the term, so nothing was corrected.
    expect(outcome.info.semester).toBeUndefined();
    expect(outcome.info.available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The term itself: decided from VTOP's own page, in one documented order.
// ---------------------------------------------------------------------------

describe('resolveSemester — the term comes from VTOP, in the documented order', () => {
  const PAGE = `<div>${SEMESTER_SELECT}</div>`;

  it('prefers the term the caller named when VTOP’s list carries it', () => {
    const r = resolveSemester(PAGE, { semesterId: STALE_TERM });

    // Both the named term and the session's selected term are VTOP's own; the
    // named one wins, because an explicit choice outranks the session default.
    expect([r.id, r.note, r.corrected]).toEqual([STALE_TERM, 'semester:requested', false]);
  });

  it('falls back to VTOP’s own selection when no term was named', () => {
    // VTOP marks a term: that is the live term. A label alone cannot outrank
    // it, and the caller's id VTOP does not list cannot either — both land on
    // VTOP's own selection, and both are reported honestly.
    expect(resolveSemester(PAGE, {}))
      .toMatchObject({ id: VTOP_TERM, note: 'semester:selected', corrected: false });
    expect(resolveSemester(PAGE, { semesterLabel: 'Fall Semester 2024-25' }))
      .toMatchObject({ id: VTOP_TERM, note: 'semester:selected', corrected: true });
  });

  it('reads a label written either way, and admits when it corrected the caller', () => {
    // "2026-27" and "2026-2027" are one term; season + first year is the key.
    expect(semesterMatchKey('Fall Semester 2026-27')).toBe(semesterMatchKey('Fall Semester 2026-2027'));
    expect(semesterMatchKey('Fall Semester 2026-27')).not.toBe(semesterMatchKey('Winter Semester 2026-27'));
    expect(semesterMatchKey('Semester with no year')).toBe('');

    // An id VTOP does not list, with a label that matches nothing either.
    const r = resolveSemester(PAGE, { semesterId: UNKNOWN_TERM, semesterLabel: 'Winter Semester 2026-27' });
    expect([r.id, r.note, r.corrected]).toEqual([VTOP_TERM, 'semester:selected', true]);
  });

  it('takes the term VTOP lists first when it marks none, and never invents one', () => {
    const unmarked = `<select name="semesterSubId">
      <option value="CH2024251">Fall Semester 2024-25</option>
      <option value="CH2025261">Fall Semester 2025-26</option>
    </select>`;

    // No term marked: the caller's own label decides, matched against VTOP's
    // names for its terms — and a label VTOP does not list leaves the first
    // term standing, reported as a correction rather than hidden.
    expect(resolveSemester(unmarked, { semesterLabel: 'Fall Semester 2024-25' }))
      .toMatchObject({ id: STALE_TERM, note: 'semester:by-label', corrected: false });
    expect(resolveSemester(unmarked, {}))
      .toMatchObject({ id: STALE_TERM, note: 'semester:first-listed', corrected: false });
    expect(resolveSemester(unmarked, { semesterLabel: 'Winter Semester 2026-27' }))
      .toMatchObject({ id: STALE_TERM, note: 'semester:first-listed', corrected: true });

    // No dropdown answered: an id-shaped id is still asked with, unverified.
    expect(resolveSemester('<div></div>', { semesterId: VTOP_TERM }))
      .toMatchObject({ id: VTOP_TERM, note: 'semester:unverified' });
    // Nothing usable at all — the one honest "no term", reported not guessed.
    expect(resolveSemester('<div></div>', { semesterLabel: 'Fall Semester 2025-26' }).id).toBe('');
    expect(resolveSemester('<div></div>', { semesterId: 'not-a-term' }).id).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The structured failure: which STAGE died, in fixed vocabulary
//
// Every one of these outcomes used to reach the browser as the same sentence.
// The point of classifySyllabusFailure is that a live failure names its hop —
// and that the naming itself carries nothing sensitive (no cookie, no code, no
// HTML, no status line: stage + reason + status only).
// ---------------------------------------------------------------------------

describe('classifySyllabusFailure — the failing stage, from the flow’s own steps', () => {
  it('names a course VTOP does not list as COURSE, never as unreachable VTOP', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());

    // The list was read (CSE2009/MAT1001 are on it); the ask is another course.
    const outcome = await fetchCourseSyllabus(t.transport, 'jar', { ...baseInput, courseCode: 'BAEEE203' });

    expect(classifySyllabusFailure(outcome)).toEqual({
      stage: 'COURSE', reason: 'COURSE_NOT_FOUND', status: 200,
    });
    expect(summarizeSyllabusFailure(classifySyllabusFailure(outcome)))
      .toBe('stage=COURSE reason=COURSE_NOT_FOUND status=200');
  });

  it('names an empty course list as COURSE_LIST_EMPTY', async () => {
    const t = makeTransport({ ...DEFAULT_HANDLERS(), getCourseForCoursePage: { html: NO_DATA } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(classifySyllabusFailure(outcome)).toEqual({
      stage: 'COURSE', reason: 'COURSE_LIST_EMPTY', status: 200,
    });
  });

  it('names an unreadable course page as COURSE_PARSE_ERROR — the reading failed, not VTOP', async () => {
    const t = makeTransport({ ...DEFAULT_HANDLERS(), getCourseForCoursePage: { html: GARBAGE } });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(classifySyllabusFailure(outcome)).toEqual({
      stage: 'COURSE', reason: 'COURSE_PARSE_ERROR', status: 200,
    });
  });

  it('names a route that answered 404 as an UPSTREAM route miss', async () => {
    const t = makeTransport({
      ...DEFAULT_HANDLERS(),
      getCourseForCoursePage: { html: '', status: 404 },
    });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(classifySyllabusFailure(outcome)).toEqual({
      stage: 'UPSTREAM', reason: 'COURSE_PAGE_ROUTE_NOT_FOUND', status: 404,
    });
  });

  it('names a login page as SESSION, not as unreadable data', async () => {
    const t = makeTransport({
      ...DEFAULT_HANDLERS(),
      getCourseForCoursePage: { html: LOGIN_PAGE },
    });

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    // VTOP answers the expiry page with HTTP 200, so the status alone could
    // never have told this apart from a real answer — the body did.
    expect(classifySyllabusFailure(outcome)).toEqual({
      stage: 'SESSION', reason: 'SESSION_EXPIRED', status: 200,
    });
  });

  it('keeps the class, detail and download hops distinct', async () => {
    // The class list answered, but with no rows the flow can open.
    const noRows = makeTransport({ ...DEFAULT_HANDLERS(), getSlotIdForCoursePage: { html: '<table></table>' } });
    expect(classifySyllabusFailure(await fetchCourseSyllabus(noRows.transport, 'jar', baseInput)))
      .toEqual({ stage: 'SLOT', reason: 'CLASS_NOT_FOUND', status: 200 });

    const slot404 = makeTransport({ ...DEFAULT_HANDLERS(), getSlotIdForCoursePage: { html: '', status: 404 } });
    expect(classifySyllabusFailure(await fetchCourseSyllabus(slot404.transport, 'jar', baseInput)))
      .toEqual({ stage: 'SLOT', reason: 'CLASS_ROUTE_NOT_FOUND', status: 404 });

    // The detail page answered with no syllabus action on it. The file has to
    // be one the flow will not accept, or the plan fallback would serve a
    // document and there would be no failure left to classify.
    const noLink = makeTransport({
      ...DEFAULT_HANDLERS(),
      processViewStudentCourseDetail: { html: detailHtml({ syllabusLink: false, planLink: false }) },
    });
    noLink.setFile({ bytes: new Uint8Array(0), contentType: '', fileName: '', status: 200 });
    expect(classifySyllabusFailure(await fetchCourseSyllabus(noLink.transport, 'jar', baseInput)))
      .toEqual({ stage: 'DETAIL', reason: 'SYLLABUS_ACTION_NOT_FOUND', status: 200 });

    const detail404 = makeTransport({
      ...DEFAULT_HANDLERS(),
      processViewStudentCourseDetail: { html: '', status: 404 },
    });
    expect(classifySyllabusFailure(await fetchCourseSyllabus(detail404.transport, 'jar', baseInput)))
      .toEqual({ stage: 'DETAIL', reason: 'DETAIL_ROUTE_NOT_FOUND', status: 404 });

    // A link existed; the file that came back was not a document.
    const notADocument = makeTransport(DEFAULT_HANDLERS());
    notADocument.setFile({ bytes: new TextEncoder().encode('<html>nope</html>'), contentType: 'text/html' });
    expect(classifySyllabusFailure(await fetchCourseSyllabus(notADocument.transport, 'jar', baseInput)))
      .toEqual({ stage: 'DOWNLOAD', reason: 'UNKNOWN_DOCUMENT_TYPE', status: 200 });
  });

  it('reports a success as no failure at all', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());

    const outcome = await fetchCourseSyllabus(t.transport, 'jar', baseInput);

    expect(outcome.diag.success).toBe(true);
    // A served document can never be classified into a failure stage — the
    // gateway logs a failure line only when this returns one.
    expect(classifySyllabusFailure(outcome)).toBeNull();
  });

  it('is safe by construction: closed vocabulary, no VTOP content', async () => {
    const t = makeTransport(DEFAULT_HANDLERS());
    const outcome = await fetchCourseSyllabus(t.transport, 'jar', { ...baseInput, courseCode: 'BAEEE203' });

    const failure = classifySyllabusFailure(outcome)!;
    const line = summarizeSyllabusFailure(failure);

    // The vocabulary is a closed set — nothing is interpolated from the answer.
    expect(['SESSION', 'SEMESTER', 'COURSE', 'SLOT', 'FACULTY', 'DETAIL', 'DOWNLOAD', 'UPSTREAM'])
      .toContain(failure.stage);
    expect(failure.reason).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(line).not.toContain('jar');
    expect(line).not.toContain('csrf-token-value');
    expect(line).not.toContain('21BCE9999');
    expect(line).not.toContain('BAEEE203');
    expect(line).not.toContain('<');
  });
});

