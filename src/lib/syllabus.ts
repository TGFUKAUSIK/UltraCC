/**
 * Syllabus view state — pure, testable mapping from the VTOP gateway outcome
 * to an honest per-course UI state.
 *
 * WHERE THE DATA COMES FROM: VTOP's own authenticated Course Page
 * (Academics → Course Page → the course → the syllabus link on its detail
 * page). The whole walk runs inside vtop-gateway under the student's session;
 * this module only shapes what comes back. The browser receives VTOP's file
 * bytes and VTOP's own naming for the course — never a cookie, CSRF token or
 * authorizedID, and never VTOP's class placement (class id, slot, faculty),
 * which is how the gateway locates the document and not part of the answer.
 *
 * DATA TRUTHFULNESS: an absence is a real answer. When VTOP's Course Page
 * lists no such course, links no syllabus, or serves an unreadable file, this
 * maps to `unavailable` with VTOP's reason and stops there. Units, topics and
 * textbooks are never invented to fill the gap, and the UI never bounces the
 * student off to Academics to find out for themselves.
 */

import { isMissingSessionError, isVtopError, VtopError } from './vtop/errors';
import { humanErrorCopy } from './errorCopy';
import type {
  SyllabusAbsentReason,
  SyllabusCourseIdentity,
  SyllabusDocument,
  SyllabusInfo,
  SyllabusRequest,
  SyllabusSemesterUsed,
  TimetableSlot,
} from './vtop/types';

/**
 * One course as the tab lists it — a course code and its name, nothing more.
 *
 * Deliberately nothing more: what the student picks here is a COURSE, and
 * everything VTOP needs to locate its syllabus (the term's id, the course's
 * row, the class, the slot, the faculty) is resolved inside the gateway. A
 * field VTOP's class placement could be read from is a field a future change
 * could start showing, so the shape does not carry one.
 */
export interface SyllabusCourse {
  courseCode: string;
  courseTitle: string;
}

/**
 * Per-course state — one course at a time, because each answer is a multi-step
 * walk through VTOP and a page of them would hammer the same session.
 */
export type SyllabusStatus =
  /** Not asked yet. The course card offers the ask; nothing was fetched. */
  | { kind: 'idle' }
  | { kind: 'loading' }
  /** VTOP served the file. `cached` marks a read from this browser's store. */
  | {
    kind: 'ready';
    document: SyllabusDocument;
    /** The course VTOP's own page named for this answer. */
    course?: SyllabusCourseIdentity;
    /** Set when VTOP answered for its own term rather than the selected one. */
    semester?: SyllabusSemesterUsed;
    cached: boolean;
  }
  /** VTOP was consulted and has nothing for this course — with its reason. */
  | {
    kind: 'unavailable';
    reason: SyllabusAbsentReason;
    message: string;
    /** The course VTOP named, when the flow got as far as a detail page. */
    course?: SyllabusCourseIdentity;
    /** Set when VTOP answered for its own term rather than the selected one. */
    semester?: SyllabusSemesterUsed;
  }
  /** Nothing to ask with: this tab never signed in (a reload, a fresh tab). */
  | { kind: 'no-session'; message: string }
  /** The session died mid-fetch — re-login needed before VTOP can answer. */
  | { kind: 'session-expired'; message: string }
  /** A VTOP page answered, but its shape matched nothing known. */
  | { kind: 'parse-failed'; message: string }
  /** Transport / gateway failure — retryable without touching VTOP's data. */
  | { kind: 'error'; message: string };

export const IDLE: SyllabusStatus = { kind: 'idle' };
export const LOADING: SyllabusStatus = { kind: 'loading' };

// ---------------------------------------------------------------------------
// The four sentences a student may read when VTOP has no syllabus. Each states
// one fact and stops: no slot ids, no term ids, no parser talk, and nothing
// about how UltraCC went looking. Everything else — which page answered, which
// step failed, what VTOP's own sentence was — stays in the gateway's
// diagnostic line for developers, not in the student's view.
// ---------------------------------------------------------------------------

/** No live VTOP session in this tab: signing in is the action. */
export const NO_SESSION_MESSAGE = 'Sign in to VTOP to view this syllabus.';

/** VTOP's Course Page offered no term that could be asked about. */
export const NO_SEMESTER_MESSAGE = 'VTOP did not provide a usable semester.';

/** VTOP's own Course Page was read, and this course is not in it. */
export const NO_COURSE_MESSAGE = 'VTOP does not list this course in the current semester.';

/** VTOP has the course, but no syllabus document came back for it. */
export const NO_SYLLABUS_MESSAGE = 'VTOP did not provide a syllabus for this course.';

/** VTOP was not reachable, or answered in a shape nothing could be read from. */
export const UNREACHABLE_MESSAGE = 'VTOP could not be reached right now. Try again.';

/**
 * VTOP's own reason, in the student's words.
 *
 * The reasons stay distinct internally because they are different facts, and
 * grouping them wrongly is exactly the bug this feature had: a page that was
 * never read must never be reported as a course VTOP does not list. The
 * sentences the student reads are therefore the small fixed set above, chosen
 * by what actually happened.
 */
export function describeAbsence(reason: SyllabusAbsentReason | undefined): string {
  switch (reason) {
    // The list WAS read and this course is not in it.
    case 'no-course-match':
    case 'course-list-empty':
      return NO_COURSE_MESSAGE;
    // The term itself could not be established from VTOP's own page.
    case 'semester-unknown':
      return NO_SEMESTER_MESSAGE;
    // VTOP has the course; no document came back for it.
    case 'no-syllabus-link':
    case 'no-slot':
    case 'no-faculty':
    case 'document':
      return NO_SYLLABUS_MESSAGE;
    // Nothing was asked properly, or the answer could not be read.
    case 'vtop-unreachable':
    default:
      return UNREACHABLE_MESSAGE;
  }
}

/**
 * Map one syllabus fetch outcome to an honest UI status.
 *
 * - error                    → SESSION_EXPIRED / PARSE_FAILED / transport, with
 *                              a session the client never had split from one VTOP
 *                              rejected — see `NO_SESSION_MESSAGE`.
 * - info === null            → the fetch never happened (no live session).
 * - available + document     → ready (the bytes VTOP served, unchanged).
 * - available without a file → parse-failed: the gateway claimed a syllabus it
 *                              did not deliver. Never rendered as a success.
 * - unavailable              → VTOP's own reason, worded by describeAbsence().
 */
export function mapSyllabusStatus(
  data: SyllabusInfo | null | undefined,
  error: unknown,
  opts: { cached?: boolean } = {},
): SyllabusStatus {
  if (error != null) {
    if (isVtopError(error)) {
      const e: VtopError = error;
      if (e.code === 'SESSION_EXPIRED') {
        // A session this tab never had and one VTOP rejected both end at the
        // same action — sign in — but they stay separate kinds, because only
        // one of them means something expired.
        return isMissingSessionError(e)
          ? { kind: 'no-session', message: NO_SESSION_MESSAGE }
          : { kind: 'session-expired', message: NO_SESSION_MESSAGE };
      }
      if (e.code === 'PARSE_FAILED') {
        return { kind: 'parse-failed', message: UNREACHABLE_MESSAGE };
      }
      return { kind: 'error', message: UNREACHABLE_MESSAGE };
    }
    // Transport noise (`TypeError: Failed to fetch`, an HTTP status, a gateway
    // stack line) stops here: the student gets the one sentence for "VTOP was
    // not reachable", and the machine-authored text goes to the dev console.
    return { kind: 'error', message: humanErrorCopy(error, UNREACHABLE_MESSAGE) };
  }
  if (data == null) {
    return { kind: 'no-session', message: NO_SESSION_MESSAGE };
  }
  if (typeof data.available !== 'boolean') {
    return { kind: 'parse-failed', message: UNREACHABLE_MESSAGE };
  }
  if (!data.available) {
    return {
      kind: 'unavailable',
      reason: data.reason ?? 'no-syllabus-link',
      message: describeAbsence(data.reason),
      // The course VTOP named travels with the absence so the sheet can title
      // itself with VTOP's own course naming rather than the timetable's.
      ...(data.course?.courseCode ? { course: data.course } : {}),
      ...(data.semester ? { semester: data.semester } : {}),
    };
  }
  const doc = data.document;
  if (!doc?.dataUrl || !doc.contentType) {
    return { kind: 'parse-failed', message: UNREACHABLE_MESSAGE };
  }
  return {
    kind: 'ready',
    document: doc,
    course: data.course,
    ...(data.semester ? { semester: data.semester } : {}),
    cached: !!opts.cached,
  };
}

/** What a cached record must still look like to be trusted. */
export function isCachedSyllabusUsable(info: SyllabusInfo | null | undefined): boolean {
  return !!info?.available && !!info.document?.dataUrl;
}

/**
 * Cache key: student identity + course + the term being viewed.
 *
 * All three parts matter. Without the student, one browser's shared tablet
 * would show another's syllabus; without the term, a course code that repeats
 * across semesters (repeat courses, re-takes) would serve the older document.
 *
 * The term part is VTOP's semester id when the app knows one and the
 * semester's own label when it does not — a term is a term either way, and a
 * key that collapsed to "unknown" would collide across terms exactly when the
 * id is missing. Session material — cookie, CSRF token, session token — is
 * never part of the key or the record.
 */
export function syllabusCacheKey(parts: {
  registrationNo: string;
  semesterId: string;
  courseCode: string;
  courseType?: string;
}): string {
  const reg = (parts.registrationNo || '').trim().toUpperCase();
  const sem = (parts.semesterId || '').trim().toUpperCase();
  const code = (parts.courseCode || '').trim().toUpperCase();
  const type = (parts.courseType || '').trim().toUpperCase();
  return `${reg || 'unknown'}|${sem || 'unknown'}|${code}|${type}`;
}

/**
 * The list of courses the tab shows: the student's own synced timetable for
 * the selected semester, reduced to what a student reads — a code and a name.
 *
 * THE TIMETABLE IS THE LIST HERE, NOT THE LOOKUP. A timetable row is a
 * schedule placement, and the fields that made it a bad registration record
 * (whose faculty, which slot, how many credits) are exactly the fields this
 * function drops rather than displays. The syllabus itself is never derived
 * from here: each card asks the gateway, which asks VTOP's own Course Page.
 *
 * Theory and lab of one course share a code and appear as one row — a student
 * thinks in courses, and the two share one syllabus document. Distinct courses
 * are sorted by code so the list is stable between syncs.
 */
export function coursesFromTimetable(slots: TimetableSlot[]): SyllabusCourse[] {
  const byCode = new Map<string, SyllabusCourse>();
  for (const s of slots ?? []) {
    const code = (s.courseCode || '').trim().toUpperCase();
    if (!code) continue;
    const title = (s.courseTitle || '').trim();
    const existing = byCode.get(code);
    if (existing) {
      // Whichever row VTOP gave a title for wins; a blank title is not one.
      if (!existing.courseTitle && title) existing.courseTitle = title;
      continue;
    }
    byCode.set(code, { courseCode: code, courseTitle: title });
  }
  return [...byCode.values()].sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

/**
 * Ask VTOP for exactly one course.
 *
 * The request carries the course and which term the student is looking at —
 * nothing else. The term's VTOP id goes along when the app has one, and the
 * semester's own name when it does not, so the gateway can resolve the term
 * from VTOP itself instead of failing on a missing id. No slot, no faculty, no
 * VTOP class id: those describe how the gateway will find the document, and the
 * student neither sees nor chooses them.
 */
export function syllabusRequestFor(
  course: Pick<SyllabusCourse, 'courseCode'>,
  term: { semesterId?: string; semesterLabel?: string } = {},
): SyllabusRequest {
  const semesterId = (term.semesterId || '').trim();
  const semesterLabel = (term.semesterLabel || '').trim();
  return {
    courseCode: (course.courseCode || '').trim().toUpperCase(),
    ...(semesterId ? { semesterId } : {}),
    ...(semesterLabel ? { semesterLabel } : {}),
  };
}

/** Human size for a fetched file ("1.4 MB" / "320 KB"). */
export function formatSyllabusSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
