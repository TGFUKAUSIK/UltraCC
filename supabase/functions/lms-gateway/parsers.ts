/**
 * parsers.ts — strict Moodle (LMS) HTML parsers for the Deno gateway.
 *
 * Pure string/regex parsers (Deno has no DOM) mirroring the standard Moodle
 * 3.x-era page structures served by lms.vit.ac.in (verified live: PHP 7.4,
 * MoodleSession cookie, logintoken hidden field, 303-to-login session guard).
 *
 * RULES (same as vtop-gateway parsers):
 *   - Never fabricate values. Absent fields stay null/''.
 *   - Pages that clearly mean "no data" ("no assignments", "no events", ...)
 *     yield [] — a legitimate empty state.
 *   - Any OTHER structural mismatch throws ParseError so the gateway can
 *     answer PARSE_FAILED instead of silently returning empty/fake data.
 *
 * Verification status: all lms:* parsers are UNVERIFIED against a live
 * authenticated LMS session (see src/lib/vtop/verification.ts); shapes are
 * the standard Moodle structures and will be flipped to VERIFIED after a
 * real pass.
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
// Shared helpers
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Extract all href="..." values from a chunk of HTML. */
function hrefs(html: string): string[] {
  const out: string[] = [];
  const re = /href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/** Extract the numeric id from a Moodle module URL (/mod/assign/view.php?id=456). */
function moduleIdFromHref(href: string): number {
  const m = href.match(/[?&]id=(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Parse a Moodle English date into an ISO-8601 string (India timezone).
 *
 * Handles the shapes Moodle 3.x emits:
 *   "Tuesday, 25 August 2026, 10:00 AM"
 *   "25 August 2026, 10:00 AM"
 *   "Tuesday, 25 August" (year omitted — calendar page)
 * When the year is omitted, picks the current year, rolling to the next if
 * the resulting instant is already in the past. Returns null when unparseable.
 */
export function parseMoodleDate(raw: string): string | null {
  if (!raw) return null;
  const text = raw.trim();
  const MONTHS: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  // Day, Month (Year,)? Time
  const m = text.match(
    /(\d{1,2})\s+([A-Za-z]+),?\s*(?:(\d{4}),?\s*)?(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  let hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  if (/pm/i.test(m[6]) && hour < 12) hour += 12;
  if (/am/i.test(m[6]) && hour === 12) hour = 0;

  // Year omitted -> prefer the current year; if that instant already passed,
  // assume the next year (Moodle calendar lists upcoming-only events anyway).
  if (!m[3]) {
    let candidate = new Date(Date.UTC(year, month, day, hour, minute));
    if (candidate.getTime() < Date.now() - 12 * 3600 * 1000) {
      year += 1;
      candidate = new Date(Date.UTC(year, month, day, hour, minute));
    }
  }

  // Emit an absolute instant. Moodle renders times in the user's timezone
  // (India Standard Time for VIT students): UTC+05:30.
  const utcMs = Date.UTC(year, month, day, hour, minute) - 5.5 * 3600 * 1000;
  return new Date(utcMs).toISOString();
}

/** Extract the logintoken (CSRF) from the Moodle login page. */
export function extractLogintoken(html: string): string {
  const m =
    html.match(/name=["']logintoken["'][^>]*value=["']([^"']+)["']/i) ||
    html.match(/value=["']([^"']+)["'][^>]*name=["']logintoken["']/i);
  return m ? m[1] : '';
}

/**
 * True when the body is (or redirects to) the Moodle login page — detects
 * both "not logged in" and "session expired" states.
 */
export function isLoginPage(html: string, url?: string): boolean {
  if (url && /\/login\/index\.php/.test(url)) return true;
  const lower = html.toLowerCase();
  return (
    lower.includes('name="logintoken"') ||
    lower.includes('id="login"') ||
    lower.includes('loginerrors') ||
    (lower.includes('log in') && lower.includes('username') && lower.includes('password'))
  );
}

/** True when the page explicitly reports no data (legitimate empty state). */
export function isNoDataPage(html: string, markers: string[]): boolean {
  const lower = html.toLowerCase();
  return markers.some((mk) => lower.includes(mk));
}

// ---------------------------------------------------------------------------
// Courses — GET /my/ (dashboard)
// ---------------------------------------------------------------------------

export interface LmsCourse {
  courseId: number;
  name: string;
  shortName: string;
  url: string;
}

/**
 * Parse the Moodle dashboard for enrolled courses.
 * Robust: finds every link to /course/view.php?id=N and takes the anchor
 * text as the course name, deduping by id (dashboard blocks render the same
 * course in multiple places).
 */
export function parseCourses(html: string): LmsCourse[] {
  const seen = new Map<number, LmsCourse>();
  const re = /<a[^>]*href="([^"]*\/course\/view\.php\?id=(\d+)(?:&[^"]*)?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = parseInt(m[2], 10);
    const name = stripTags(m[3]);
    if (!id || !name) continue;
    const existing = seen.get(id);
    // Prefer the longest anchor text (course cards > tiny block links).
    if (!existing || name.length > existing.name.length) {
      seen.set(id, { courseId: id, name, shortName: '', url: m[1] });
    }
  }
  const courses = Array.from(seen.values());

  // Best-effort short names: /course/view.php?id=N links often sit in a
  // block whose header carries the short name; skip when absent.
  for (const c of courses) {
    const block = html.match(new RegExp(`<div[^>]*class="[^"]*(?:course|card)[^"]*"[^>]*>[\\s\\S]{0,400}?href="[^"]*\\/course\\/view\\.php\\?id=${c.courseId}(?:&[^"]*)?"`, 'i'));
    if (block) {
      const sn = block[0].match(/class="[^"]*\bcoursename\b[^"]*"[^>]*>([^<]+)</i);
      if (sn) c.shortName = stripTags(sn[1]);
    }
  }

  if (!courses.length && !isNoDataPage(html, ['you are not enrolled', 'no courses', 'my courses'])) {
    throw new ParseError('courses', 'no /course/view.php?id= links found');
  }
  return courses;
}

// ---------------------------------------------------------------------------
// Assignments — GET /mod/assign/index.php?id={courseId}
// ---------------------------------------------------------------------------

export interface LmsAssignment {
  assignmentId: number;
  name: string;
  dueDate: string | null; // ISO
  url: string;
}

/**
 * Parse the per-course assignment index table.
 * Standard Moodle 3.x structure:
 *   <table class="generaltable mod_index">
 *     <tr class=""><td class="cell c0"><a href=".../mod/assign/view.php?id=456">Assignment 1</a></td>
 *                  <td class="cell c1">Tuesday, 25 August 2026, 11:59 PM</td></tr>
 * Row detection is link-driven (robust to column reordering): a row is an
 * assignment when it contains a /mod/assign/view.php?id=N link; the due
 * date is taken from whichever cell parses as a Moodle date.
 */
export function parseAssignments(html: string): LmsAssignment[] {
  const rows = html.split(/<tr[^>]*>/i).slice(1);
  const out: LmsAssignment[] = [];
  for (const row of rows) {
    const link = row.match(/<a[^>]*href="([^"]*\/mod\/assign\/view\.php\?id=(\d+)(?:&[^"]*)?)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const id = parseInt(link[2], 10);
    const name = stripTags(link[3]);
    if (!id || !name) continue;
    // Due date: scan every cell text for a parseable Moodle date.
    let due: string | null = null;
    const cells = row.split(/<td[^>]*>/i).slice(1);
    for (const cell of cells) {
      const text = stripTags(cell.split('</td>')[0]);
      const parsed = parseMoodleDate(text);
      if (parsed) { due = parsed; break; }
    }
    out.push({ assignmentId: id, name, dueDate: due, url: link[1] });
  }
  if (!out.length && !isNoDataPage(html, ['no assignments', 'you have no assignments', 'no activities'])) {
    throw new ParseError('assignments', 'no /mod/assign/view.php?id= links found');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quiz windows — GET /mod/quiz/index.php?id={courseId} then per-quiz view
// ---------------------------------------------------------------------------

export interface LmsQuizSummary {
  quizId: number;
  name: string;
  url: string;
}

/** Parse the quiz index table (quiz links only — timings come from each view). */
export function parseQuizList(html: string): LmsQuizSummary[] {
  const out: LmsQuizSummary[] = [];
  const re = /<a[^>]*href="([^"]*\/mod\/quiz\/view\.php\?id=(\d+)(?:&[^"]*)?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = parseInt(m[2], 10);
    const name = stripTags(m[3]);
    if (id && name) out.push({ quizId: id, name, url: m[1] });
  }
  if (!out.length && !isNoDataPage(html, ['no quizzes', 'you have no quizzes'])) {
    throw new ParseError('quiz-windows', 'no /mod/quiz/view.php?id= links found');
  }
  return out;
}

export interface LmsQuizWindow {
  quizId: number;
  name: string;
  openTime: string | null;  // ISO
  closeTime: string | null; // ISO
  attemptLimit: number | null;
  timeLimitMins: number | null;
  submissionStatus: string | null;
  url: string;
}

/**
 * Parse a single quiz view page. Moodle 3.x renders a summary table whose
 * rows are <th>label</th><td>value</td>:
 *   Opens / Closes / Time limit / Attempts allowed
 * plus an attempts area that shows "has been attempted N times" or
 * "This quiz is closed" when past the close time.
 */
export function parseQuizWindow(html: string, summary: LmsQuizSummary): LmsQuizWindow {
  let openTime: string | null = null;
  let closeTime: string | null = null;
  let attemptLimit: number | null = null;
  let timeLimitMins: number | null = null;
  let submissionStatus: string | null = null;

  const rowRe = /<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const label = normalizeHeader(stripTags(m[1]));
    const value = stripTags(m[2]);
    if (label === 'opens') openTime = parseMoodleDate(value);
    else if (label === 'closes') closeTime = parseMoodleDate(value);
    else if (label === 'attempts allowed') {
      const n = value.match(/(\d+)/);
      attemptLimit = n ? parseInt(n[1], 10) : null;
    } else if (label === 'time limit') {
      const mins = value.match(/(\d+)\s*(?:mins|minutes|min)/i);
      timeLimitMins = mins ? parseInt(mins[1], 10) : null;
    }
  }

  // Submission status: attempts made / closed state.
  const lower = html.toLowerCase();
  const attempted = lower.match(/has been attempted (\d+) times/);
  if (attempted) submissionStatus = `${attempted[1]} attempt${attempted[1] === '1' ? '' : 's'} made`;
  else if (lower.includes('this quiz is closed')) submissionStatus = 'closed';
  else if (lower.includes('attempt quiz now') || lower.includes('start attempt')) submissionStatus = 'open — not attempted';
  else submissionStatus = null;

  return {
    quizId: summary.quizId,
    name: summary.name,
    openTime,
    closeTime,
    attemptLimit,
    timeLimitMins,
    submissionStatus,
    url: summary.url,
  };
}

// ---------------------------------------------------------------------------
// Gradebook — GET /grade/report/user/index.php?id={courseId}
// ---------------------------------------------------------------------------

export interface LmsGradeItem {
  itemName: string;
  itemType: 'assignment' | 'quiz' | 'manual' | 'unknown';
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  feedback: string | null;
}

/**
 * Parse the single-user grade report (grade/report/user/index.php?id=X),
 * which renders the current user's grade items as a table:
 *   Grade item | Grade | Range | Percentage | Feedback
 * Grade values may be "8.00", "—", "N/A" or "-"; Range "0–10" or "0-100".
 */
export function parseGradebook(html: string): LmsGradeItem[] {
  const rows = html.split(/<tr[^>]*>/i).slice(1);
  const out: LmsGradeItem[] = [];
  for (const row of rows) {
    const cells = row.split(/<t[dh][^>]*>/i).slice(1).map((c) => stripTags(c.split('</t')[0]));
    if (cells.length < 2) continue;
    const itemName = cells[0];
    if (!itemName || normalizeHeader(itemName).startsWith('grade item')) continue;
    const gradeText = cells[1] || '';
    const rangeText = cells[2] || '';
    const pctText = cells[3] || '';
    const feedback = cells.length > 4 ? cells[4] || null : null;

    const score = /^[\d.]+$/.test(gradeText) ? parseFloat(gradeText) : null;
    const rangeM = rangeText.match(/(\d+(?:\.\d+)?)\s*[–\-—]\s*(\d+(?:\.\d+)?)/);
    const maxScore = rangeM ? parseFloat(rangeM[2]) : null;
    const pctM = pctText.match(/(\d+(?:\.\d+)?)\s*%/);
    const percentage = pctM ? parseFloat(pctM[1]) : null;

    const lower = itemName.toLowerCase();
    const itemType: LmsGradeItem['itemType'] =
      lower.includes('quiz') ? 'quiz'
      : lower.includes('assignment') || lower.includes('assess') ? 'assignment'
      : /^(cat|internal|total|overall)/i.test(lower) ? 'manual'
      : 'unknown';

    out.push({ itemName, itemType, score, maxScore, percentage, feedback });
  }
  if (!out.length && !isNoDataPage(html, ['no grades', 'no grade items', 'not graded'])) {
    throw new ParseError('gradebook', 'no grade-item rows found');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Materials — GET /course/view.php?id={courseId}
// ---------------------------------------------------------------------------

export interface LmsMaterial {
  materialId: number;
  name: string;
  fileType: string | null;
  downloadUrl: string | null;
  postedDate: string | null; // ISO
}

/**
 * Parse the course content page for downloadable resources.
 * Moodle 3.x renders each activity as <li class="activity modtype_resource ..."
 * id="module-123"> containing an <a> to the file (pluginfile.php) or a
 * resource view URL. We keep every activity that links to a file or folder;
 * module ids come from id="module-N".
 */
export function parseMaterials(html: string): LmsMaterial[] {
  const out: LmsMaterial[] = [];
  // Capture the whole opening tag + inner content: the class marks an
  // activity, id="module-N" may come after the class, and the name/href
  // live in the inner content.
  const liRe = /<li([^>]*class="[^"]*\bactivity\b[^"]*"[^>]*)>([\s\S]*?)<\/li>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = liRe.exec(html))) {
    const attrs = lm[1];
    const li = lm[2];
    const idM = attrs.match(/id="module-(\d+)"/);
    const materialId = idM ? parseInt(idM[1], 10) : 0;
    const hrefsIn = hrefs(li);
    const fileHref = hrefsIn.find((h) =>
      /pluginfile\.php/.test(h) || /mod\/resource\/view\.php/.test(h) || /mod\/folder\/view\.php/.test(h)
    );
    if (!fileHref) continue;
    const nameM = li.match(/class="instancename"[^>]*>([\s\S]*?)<\/span>/i) ||
      li.match(/<a[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const name = nameM ? stripTags(nameM[1]) : '';
    if (!name) continue;

    const typeM = attrs.match(/modtype_([a-z_]+)/i);
    const fileType = typeM ? typeM[1] : null;
    // Posted date rarely present on course pages — keep null (honest).
    out.push({ materialId, name, fileType, downloadUrl: fileHref, postedDate: null });
  }
  if (!out.length && !isNoDataPage(html, ['no resources', 'this course has no resources'])) {
    // Course pages without any file activities are legitimate (e.g. only
    // forums/quizzes) — return empty without throwing when the page clearly
    // rendered a course (course-header present).
    const hasCourseHeader = /id="page-header"|class="course-content"|section/.test(html);
    if (!hasCourseHeader) throw new ParseError('materials', 'no course content sections found');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Forum announcements — GET /mod/forum/view.php?id={forumId}
// ---------------------------------------------------------------------------

export interface LmsForumPost {
  postId: number;
  title: string;
  author: string;
  postedDate: string | null; // ISO
  bodyText: string;
}

/**
 * Parse forum discussion posts. Moodle 3.x renders each post as:
 *   <article class="forumpost ..." data-post-id="123">
 *     <div class="subject"><a ...>Title</a></div>
 *     <div class="author">By <a>Name</a> - <span class="time">Tue, 25 Aug 2026, 10:00 AM</span>
 *     <div class="posting fullpost">...body...</div>
 * The class includes "starter" for the first post of a discussion (the
 * announcement itself on the course news forum).
 */
export function parseForumPosts(html: string): LmsForumPost[] {
  const out: LmsForumPost[] = [];
  const articleRe = /<article[^>]*class="[^"]*forumpost[^"]*"[^>]*data-post-id="(\d+)"[^>]*>([\s\S]*?)<\/article>/gi;
  let am: RegExpExecArray | null;
  while ((am = articleRe.exec(html))) {
    const postId = parseInt(am[1], 10);
    const body = am[2];
    const titleM = body.match(/class="subject"[^>]*>([\s\S]*?)<\/div>/i) ||
      body.match(/<a[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleM ? stripTags(titleM[1]) : '';
    const authorM = body.match(/class="author"[^>]*>([\s\S]*?)<\/div>/i);
    const author = authorM ? stripTags(authorM[1]).replace(/^by\s+/i, '') : '';
    // Date: Moodle 3.x forums use a short "Tue, 25 Aug 2026, 10:00 AM" form.
    const dateM = body.match(/(?:class="time"[^>]*>|>)([^<>]*\d{1,2}\s+[A-Za-z]{3}\s+\d{4}[^<>]*?)(?:<|\()/i) ||
      body.match(/([A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4}, \d{1,2}:\d{2} (?:AM|PM))/i);
    let postedDate: string | null = null;
    if (dateM) {
      // Normalize "Tue, 25 Aug 2026, 10:00 AM" to the long form the parser wants.
      const MONTHS: Record<string, string> = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' };
      const dm = dateM[1].match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      if (dm && MONTHS[dm[2].toLowerCase()]) {
        postedDate = parseMoodleDate(`${dm[1]} ${MONTHS[dm[2].toLowerCase()]} ${dm[3]}, ${dm[4]}`);
      }
    }
    const bodyText = stripTags(body).slice(0, 2000);
    if (!postId) continue;
    out.push({ postId, title, author, postedDate, bodyText });
  }
  if (!out.length && !isNoDataPage(html, ['no discussions', 'there are no discussions', 'no posts'])) {
    throw new ParseError('forum', 'no forumpost articles found');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Calendar events — GET /calendar/view.php?view=upcoming
// ---------------------------------------------------------------------------

export interface LmsCalendarEvent {
  eventId: number;
  name: string;
  eventType: 'course' | 'user' | 'site' | 'unknown';
  courseId: number | null;
  date: string | null; // ISO
}

/**
 * Parse the upcoming events list. Moodle 3.x renders each event as:
 *   <div class="event" data-eventtype-course="...">
 *     <div class="date">Tuesday, 25 August</div>
 *     <div class="name"><a ...>Event Name</a></div>
 *     <div class="time">10:00 AM</div>
 *     <div class="course">Course short name</div>
 * The date block carries day + month (no year) and the time block the clock;
 * we combine them with parseMoodleDate.
 */
export function parseCalendarEvents(html: string): LmsCalendarEvent[] {
  const out: LmsCalendarEvent[] = [];
  const eventRe = /<div[^>]*class="[^"]*\bevent\b[^"]*"[^>]*data-eventtype-([a-z]+)="[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let em: RegExpExecArray | null;
  let fallbackUsed = false;
  while ((em = eventRe.exec(html))) {
    const eventType = em[1] as LmsCalendarEvent['eventType'];
    const body = em[2];
    const dateM = body.match(/class="date"[^>]*>([\s\S]*?)<\/div>/i);
    const timeM = body.match(/class="time"[^>]*>([\s\S]*?)<\/div>/i);
    const nameM = body.match(/class="name"[^>]*>([\s\S]*?)<\/div>/i);
    const courseM = body.match(/class="course"[^>]*>([\s\S]*?)<\/div>/i);
    const linkM = body.match(/<a[^>]*href="([^"]*\/event\/view\.php\?id=(\d+)(?:&[^"]*)?)"/i);

    const dateText = dateM ? stripTags(dateM[1]) : '';
    const timeText = timeM ? stripTags(timeM[1]).split(/\s*-\s*/)[0] : '';
    const name = nameM ? stripTags(nameM[1]) : '';
    let date: string | null = null;
    if (dateText && timeText) {
      const dayMonth = dateText.match(/(\d{1,2})\s+([A-Za-z]+)/);
      const clock = timeText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      if (dayMonth && clock) date = parseMoodleDate(`${dayMonth[1]} ${dayMonth[2]}, ${clock[1]}`);
    }
    if (!name) continue;
    out.push({
      eventId: linkM ? parseInt(linkM[2], 10) : 0,
      name,
      eventType,
      courseId: null,
      date,
    });
  }

  if (!out.length) {
    // Fallback: <li class="event ..."> items with the same inner classes.
    const liRe = /<li([^>]*class="[^"]*\bevent\b[^"]*"[^>]*)>([\s\S]*?)<\/li>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = liRe.exec(html))) {
      const attrs = lm[1];
      const body = lm[2];
      const dateM = body.match(/class="date"[^>]*>([\s\S]*?)<\/div>/i);
      const timeM = body.match(/class="time"[^>]*>([\s\S]*?)<\/div>/i);
      const nameM = body.match(/class="name"[^>]*>([\s\S]*?)<\/div>/i);
      const dateText = dateM ? stripTags(dateM[1]) : '';
      const timeText = timeM ? stripTags(timeM[1]).split(/\s*-\s*/)[0] : '';
      const name = nameM ? stripTags(nameM[1]) : '';
      const typeAttr = attrs.match(/data-eventtype-([a-z]+)=/i);
      const eventType = (typeAttr ? typeAttr[1] : 'unknown') as LmsCalendarEvent['eventType'];
      let date: string | null = null;
      if (dateText && timeText) {
        const dayMonth = dateText.match(/(\d{1,2})\s+([A-Za-z]+)/);
        const clock = timeText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
        if (dayMonth && clock) date = parseMoodleDate(`${dayMonth[1]} ${dayMonth[2]}, ${clock[1]}`);
      }
      if (!name) continue;
      out.push({ eventId: 0, name, eventType, courseId: null, date });
    }
    fallbackUsed = true;
  }

  if (!out.length && !fallbackUsed && !isNoDataPage(html, ['no events', 'nothing to display', 'there are no events'])) {
    throw new ParseError('calendar', 'no calendar event blocks found');
  }
  return out;
}
