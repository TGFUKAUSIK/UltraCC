/**
 * Syllabus state-mapping regression tests (client side of the feature).
 *
 * Contract under test: the student picks a COURSE — a code and a name, nothing
 * else — and the tab never fabricates either half of the answer. Whatever
 * VTOP's Course Page flow returns (a file, an honest absence, a malformed
 * payload, an auth failure) maps to a distinct, truthful per-course state; the
 * request the gateway is handed carries the course identity and the term, and
 * never a slot, a faculty or a class id, because those are how the gateway
 * locates the document — not something this layer chooses, sends or shows.
 *
 * The five sentences in `describeAbsence` are the whole student-facing error
 * vocabulary. These tests pin them verbatim and pin their absence from the
 * vocabulary the brief removed (slot, faculty, class id, VTOP term ids), so a
 * future edit cannot quietly reintroduce it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  coursesFromTimetable,
  describeAbsence,
  IDLE,
  isCachedSyllabusUsable,
  LOADING,
  mapSyllabusStatus,
  NO_COURSE_MESSAGE,
  NO_SEMESTER_MESSAGE,
  NO_SESSION_MESSAGE,
  NO_SYLLABUS_MESSAGE,
  syllabusCacheKey,
  syllabusRequestFor,
  UNREACHABLE_MESSAGE,
} from '../syllabus';
import { NOT_AUTHENTICATED_MESSAGE, VtopError, isMissingSessionError } from '../vtop/errors';
import type { SyllabusAbsentReason, SyllabusInfo, TimetableSlot } from '../vtop/types';

function slot(over: Partial<TimetableSlot>): TimetableSlot {
  return {
    id: over.id ?? Math.random().toString(36),
    slot: 'A1', courseCode: 'CSE1001', courseTitle: 'Problem Solving with Python',
    courseType: 'ETH', facultyName: 'Dr. R. Kanna', venue: 'TT-01', building: 'CSE Block 1',
    startTime: '09:00', endTime: '09:50', day: 'Monday', credits: 3, ...over,
  } as TimetableSlot;
}

const PDF = {
  dataUrl: 'data:application/pdf;base64,JVBERi0=',
  contentType: 'application/pdf',
  fileName: 'CSE2009-syllabus.pdf',
  bytes: 2048,
  origin: 'course-syllabus' as const,
};

/** Every way VTOP can answer "no syllabus" — the reasons the UI must separate. */
const ABSENT_REASONS: SyllabusAbsentReason[] = [
  'no-course-match', 'course-list-empty', 'vtop-unreachable', 'semester-unknown',
  'no-syllabus-link', 'document', 'no-slot', 'no-faculty',
];

const STUDENT_COPY = [NO_SESSION_MESSAGE, NO_SEMESTER_MESSAGE, NO_COURSE_MESSAGE, NO_SYLLABUS_MESSAGE, UNREACHABLE_MESSAGE];

/** VTOP's class-placement and gateway vocabulary — never in student copy. */
const INTERNAL_VOCABULARY = /\bslots?\b|\bfaculty\b|class\s*id|erp\s*id|\btimetable\b|\bgateway\b|\bparser\b|semester\s*id|CH\d{9}|AP\d{9}/i;

describe('coursesFromTimetable — the list is a course code and a name', () => {
  it('reduces a course to its code and title — nothing else travels to the card', () => {
    const courses = coursesFromTimetable([
      slot({ slot: 'A1', venue: 'TT-01', day: 'Monday', facultyName: 'Dr. R. Kanna', credits: 3 }),
      slot({ slot: 'F1', venue: 'SJT 402', day: 'Friday' }),
    ]);

    expect(courses).toHaveLength(1);
    expect(courses[0]).toEqual({ courseCode: 'CSE1001', courseTitle: 'Problem Solving with Python' });
    // No slot, venue, faculty, credits or type field survives — the shape a
    // card reads is exactly the two fields the student is shown.
    expect(Object.keys(courses[0]).sort()).toEqual(['courseCode', 'courseTitle']);
    expect(JSON.stringify(courses)).not.toMatch(/A1|F1|TT-01|SJT|Kanna|credits|ETH/);
  });

  it('shows theory and lab of one code as one course', () => {
    const courses = coursesFromTimetable([
      slot({ courseType: 'ETH' }),
      slot({ courseType: 'ELA', slot: 'L31+L32', facultyName: 'Mr. S. Ganesh' }),
    ]);
    expect(courses.map((c) => c.courseCode)).toEqual(['CSE1001']);
  });

  it('keeps whichever title VTOP gave, drops codeless rows, normalises and sorts by code', () => {
    const courses = coursesFromTimetable([
      slot({ courseCode: '  ', courseTitle: 'No Code' }),
      slot({ courseCode: 'mat2001', courseTitle: '' }),
      slot({ courseCode: 'MAT2001', courseTitle: 'Calculus' }),
      slot({ courseCode: 'baeee203', courseTitle: 'Microcontrollers' }),
    ]);

    expect(courses.map((c) => c.courseCode)).toEqual(['BAEEE203', 'MAT2001']);
    // The blank-title row was not allowed to overwrite the titled one.
    expect(courses[1].courseTitle).toBe('Calculus');
  });

  it('answers an empty list for no slots at all', () => {
    expect(coursesFromTimetable([])).toEqual([]);
    expect(coursesFromTimetable(undefined as unknown as TimetableSlot[])).toEqual([]);
  });
});

describe('syllabusRequestFor — the gateway is asked for a course, nothing else', () => {
  it('sends the course code and the term VTOP knows it by', () => {
    const request = syllabusRequestFor({ courseCode: 'cse2009' }, { semesterId: ' CH2025261 ' });

    expect(request).toEqual({ courseCode: 'CSE2009', semesterId: 'CH2025261' });
    expect(Object.keys(request).sort()).toEqual(['courseCode', 'semesterId']);
  });

  it('sends the term label when that is all the app has, and the code alone when it has neither', () => {
    // A fresh or un-synced app has no VTOP id; the gateway resolves the term
    // from VTOP's own Course Page rather than blocking the page.
    expect(syllabusRequestFor({ courseCode: 'BAEEE203' }, { semesterLabel: 'Fall Semester 2026-27' }))
      .toEqual({ courseCode: 'BAEEE203', semesterLabel: 'Fall Semester 2026-27' });
    expect(syllabusRequestFor({ courseCode: 'BAEEE203' })).toEqual({ courseCode: 'BAEEE203' });
    expect(syllabusRequestFor({ courseCode: 'BAEEE203' }, { semesterId: '  ' })).toEqual({ courseCode: 'BAEEE203' });
  });

  it('has no field for a slot, a faculty, a class id or a class row', () => {
    const request = syllabusRequestFor({ courseCode: 'BAEEE203' }, { semesterId: 'CH2025261' });

    for (const forbidden of ['slot', 'faculty', 'classId', 'erpId', 'slotOptions', 'facultyOptions', 'classGroup']) {
      expect(request).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(request)).not.toMatch(/slot|faculty|classId|erpId|options/i);
  });
});

describe('mapSyllabusStatus — honest states, never fabricated', () => {
  it('success: VTOP\'s file becomes ready, bytes and name untouched', () => {
    const info: SyllabusInfo = {
      available: true,
      reached: 'document',
      course: { courseCode: 'CSE2009', courseTitle: 'Soft Computing', courseType: 'ETH' },
      document: PDF,
    };
    const status = mapSyllabusStatus(info, null);

    expect(status).toEqual({ kind: 'ready', document: PDF, course: info.course, cached: false });
  });

  it('success from cache is marked as such, so the UI can say when', () => {
    const status = mapSyllabusStatus({ available: true, document: PDF }, null, { cached: true });

    expect(status.kind).toBe('ready');
    if (status.kind === 'ready') {
      expect(status.cached).toBe(true);
      expect(status.semester).toBeUndefined();
    }
  });

  it('a document answer with no file is parse-failed, not a success', () => {
    // The gateway said available:true but delivered nothing. Showing "ready"
    // with an empty viewer would be the fabrication this feature forbids.
    const status = mapSyllabusStatus({ available: true, document: null }, null);

    expect(status).toEqual({ kind: 'parse-failed', message: UNREACHABLE_MESSAGE });
  });

  it('a non-boolean available flag is parse-failed, not a guess', () => {
    expect(mapSyllabusStatus({ available: 'yes' } as unknown as SyllabusInfo, null).kind).toBe('parse-failed');
  });

  it('idle and loading claim nothing, and ask for nothing', () => {
    expect(IDLE).toEqual({ kind: 'idle' });
    expect(LOADING).toEqual({ kind: 'loading' });
  });

  it('each way VTOP says "no syllabus" keeps its own sentence', () => {
    // The production bug: eleven different dead ends answered with the one
    // sentence "VTOP's Course Page listed no such course", so a request that
    // never got through read as a claim about the student's registration.
    const want: Record<SyllabusAbsentReason, string> = {
      'no-course-match': NO_COURSE_MESSAGE,
      'course-list-empty': NO_COURSE_MESSAGE,
      'semester-unknown': NO_SEMESTER_MESSAGE,
      'no-syllabus-link': NO_SYLLABUS_MESSAGE,
      document: NO_SYLLABUS_MESSAGE,
      'no-slot': NO_SYLLABUS_MESSAGE,
      'no-faculty': NO_SYLLABUS_MESSAGE,
      'vtop-unreachable': UNREACHABLE_MESSAGE,
    };

    for (const reason of ABSENT_REASONS) {
      const status = mapSyllabusStatus({ available: false, reason, reached: 'detail' }, null);
      expect(status.kind, reason).toBe('unavailable');
      if (status.kind === 'unavailable') {
        expect(status.reason, reason).toBe(reason);
        expect(status.message, reason).toBe(want[reason]);
        // The student is told what VTOP answered, never how UltraCC asked.
        expect(status.message, reason).not.toMatch(INTERNAL_VOCABULARY);
      }
    }
    // "did not answer" and "has no such course" stay distinguishable facts.
    expect(describeAbsence('vtop-unreachable')).not.toBe(describeAbsence('no-course-match'));
    expect(describeAbsence('semester-unknown')).toMatch(/semester/i);
    expect(describeAbsence(undefined)).toBe(UNREACHABLE_MESSAGE);
  });

  it('the five sentences are exactly the prescribed copy', () => {
    expect(NO_SESSION_MESSAGE).toBe('Sign in to VTOP to view this syllabus.');
    expect(NO_SEMESTER_MESSAGE).toBe('VTOP did not provide a usable semester.');
    expect(NO_COURSE_MESSAGE).toBe('VTOP does not list this course in the current semester.');
    expect(NO_SYLLABUS_MESSAGE).toBe('VTOP did not provide a syllabus for this course.');
    expect(UNREACHABLE_MESSAGE).toBe('VTOP could not be reached right now. Try again.');

    for (const line of STUDENT_COPY) {
      expect(line).not.toMatch(INTERNAL_VOCABULARY);
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it('an absence carries VTOP\'s own course naming, so the sheet never titles itself from the timetable', () => {
    const course = { courseCode: 'BAEEE203', courseTitle: 'Microcontrollers', courseType: 'ETH' };
    const status = mapSyllabusStatus({ available: false, reason: 'no-syllabus-link', reached: 'detail', course }, null);

    expect(status.kind).toBe('unavailable');
    if (status.kind === 'unavailable') expect(status.course).toEqual(course);

    // Without VTOP's naming there is nothing to claim — no course object, and
    // in particular no timetable title smuggled in behind one.
    const bare = mapSyllabusStatus({ available: false, reason: 'no-syllabus-link' }, null);
    if (bare.kind === 'unavailable') expect(bare.course).toBeUndefined();
  });

  it('the term VTOP answered for travels with the answer, success or not', () => {
    const semester = { requested: 'CH2024251', used: 'CH2025261', label: 'Fall Semester 2025-26' };

    const ready = mapSyllabusStatus({ available: true, document: PDF, semester }, null);
    expect(ready.kind).toBe('ready');
    if (ready.kind === 'ready') expect(ready.semester).toEqual(semester);

    // An absence on a corrected term must carry it too: the sheet says which
    // term VTOP's answer is about, so a stale course is never silently reused.
    const absent = mapSyllabusStatus({ available: false, reason: 'course-list-empty', reached: 'courses', semester }, null);
    expect(absent.kind).toBe('unavailable');
    if (absent.kind === 'unavailable') expect(absent.semester).toEqual(semester);

    // A term that was never corrected is never claimed.
    const plain = mapSyllabusStatus({ available: false, reason: 'no-syllabus-link' }, null);
    if (plain.kind === 'unavailable') expect(plain.semester).toBeUndefined();
  });

  it('an expired session is a re-login status: VTOP rejected a session it had', () => {
    const err = new VtopError('SESSION_EXPIRED', 'VTOP session expired while fetching syllabus. Please re-login.');
    expect(mapSyllabusStatus(null, err)).toEqual({ kind: 'session-expired', message: NO_SESSION_MESSAGE });
  });

  it('a tab that never signed in is not an expired session', () => {
    // The session token is memory-only by design, so a page reload ends it
    // without VTOP revoking anything. Calling that "expired" reports an event
    // that never happened — and sends the student looking for an account
    // problem instead of a sign-in.
    const gate = mapSyllabusStatus(null, null);
    expect(gate.kind).toBe('no-session');
    if (gate.kind === 'no-session') {
      expect(gate.message).toBe(NO_SESSION_MESSAGE);
      expect(gate.message).not.toMatch(/expired/i);
    }
    expect(mapSyllabusStatus(undefined, null).kind).toBe('no-session');

    // The client's pre-flight guard travels as SESSION_EXPIRED (a gateway HTTP
    // 500 read as data would be worse), so the message is what separates "never
    // signed in here" from "VTOP ended the session".
    expect(mapSyllabusStatus(null, new VtopError('SESSION_EXPIRED', NOT_AUTHENTICATED_MESSAGE)).kind)
      .toBe('no-session');
  });

  it('gateway failure: an unreadable page and a dead connection both read as unreachable', () => {
    const parse = new VtopError('PARSE_FAILED', 'VTOP changed its Course Page response.');
    expect(mapSyllabusStatus(null, parse)).toEqual({ kind: 'parse-failed', message: UNREACHABLE_MESSAGE });

    // Any other failure — a transport error, an unwrapped gateway body — is the
    // one retryable sentence; its machine-authored text never reaches the UI.
    expect(mapSyllabusStatus(null, new VtopError('VTOP_UNAVAILABLE', 'VTOP served no page for this.')))
      .toEqual({ kind: 'error', message: UNREACHABLE_MESSAGE });
    const page = new VtopError('VTOP_UNAVAILABLE', 'HTTP 502 Bad Gateway: <html><body>upstream responded 500</body></html>');
    expect(mapSyllabusStatus(null, page)).toEqual({ kind: 'error', message: UNREACHABLE_MESSAGE });
    expect(mapSyllabusStatus(null, new TypeError('Failed to fetch')))
      .toEqual({ kind: 'error', message: UNREACHABLE_MESSAGE });
  });

  it('a cached record is trusted only when it holds a document', () => {
    expect(isCachedSyllabusUsable({ available: true, document: PDF })).toBe(true);
    expect(isCachedSyllabusUsable({ available: true, document: null })).toBe(false);
    expect(isCachedSyllabusUsable({ available: false, reason: 'no-syllabus-link' })).toBe(false);
    expect(isCachedSyllabusUsable(null)).toBe(false);
  });
});

/**
 * `isMissingSessionError` reads the client's sentence, so a reworded guard must
 * not be able to quietly start reporting a page reload as an expired session.
 * `NOT_AUTHENTICATED_MESSAGE` is the constant `RealVTOPClient` throws, which is
 * what keeps this coupled to the code rather than to a copy of the wording.
 */
describe('isMissingSessionError', () => {
  const src = readFileSync(resolve(__dirname, '../vtop/realClient.ts'), 'utf-8');

  it('recognises the guard RealVTOPClient actually throws', () => {
    expect(src).toContain('new VtopError(\'SESSION_EXPIRED\', NOT_AUTHENTICATED_MESSAGE)');
    expect(isMissingSessionError(new VtopError('SESSION_EXPIRED', NOT_AUTHENTICATED_MESSAGE))).toBe(true);
  });

  it('recognises the gateway phrasing of the same state', () => {
    expect(isMissingSessionError(new VtopError('SESSION_EXPIRED', 'Not authenticated — call DO_LOGIN first.')))
      .toBe(true);
  });

  it('leaves a real expiry alone, and ignores every other code', () => {
    expect(isMissingSessionError(new VtopError('SESSION_EXPIRED', 'VTOP session expired while fetching marks. Please re-login.')))
      .toBe(false);
    expect(isMissingSessionError(new VtopError('VTOP_UNAVAILABLE', 'Not authenticated somehow.'))).toBe(false);
    expect(isMissingSessionError(new Error('Not authenticated — call login() first.'))).toBe(false);
    expect(isMissingSessionError(null)).toBe(false);
    expect(isMissingSessionError(undefined)).toBe(false);
  });
});

/**
 * The brief's boundary, enforced on the source: a student picks a course, so no
 * client module may carry a field, parameter or API named after VTOP's class
 * placement. A future edit that reintroduces one fails here rather than in a
 * production screenshot.
 */
describe('the class-selection vocabulary is gone from the client', () => {
  const FILES = [
    '../syllabus.ts',
    '../syllabusStore.ts',
    '../vtop/realClient.ts',
    '../../components/SyllabusView.tsx',
  ];

  it('no client file declares or reads a slot/faculty/class-id field', () => {
    for (const file of FILES) {
      const src = readFileSync(resolve(__dirname, file), 'utf-8');
      const hits = src.match(/\b(?:slot|faculty|classId|erpId|slotOptions|facultyOptions)\s*[:?]/g);
      expect(hits, `${file} carries class-placement fields: ${hits?.join(', ')}`).toBeNull();
    }
  });

  it('no client file holds a Course Page class listing any more', () => {
    for (const file of FILES) {
      const src = readFileSync(resolve(__dirname, file), 'utf-8');
      expect(src, file).not.toMatch(/getCoursePageClasses|loadCoursePageClasses|CourseListFetcher|CourseListCache|coursePageCacheKey|coursePage/);
    }
  });
});

describe('syllabusCacheKey — the cache cannot cross students or terms', () => {
  const base = { registrationNo: '21bce9999', semesterId: 'ch2025261', courseCode: 'cse2009', courseType: '' };

  it('normalises case so one course does not cache twice', () => {
    expect(syllabusCacheKey(base)).toBe('21BCE9999|CH2025261|CSE2009|');
    expect(syllabusCacheKey({ ...base, registrationNo: '21BCE9999' })).toBe(syllabusCacheKey(base));
  });

  it('separates students, semesters and courses', () => {
    const keys = new Set([
      syllabusCacheKey(base),
      syllabusCacheKey({ ...base, registrationNo: '21BCE8888' }),
      syllabusCacheKey({ ...base, semesterId: 'CH2025262' }),
      syllabusCacheKey({ ...base, courseCode: 'MAT1001' }),
    ]);
    expect(keys.size).toBe(4);
  });

  it('keys a term by its label when VTOP\'s id is unknown, so two terms never collide', () => {
    // A fresh app can only name the term it is showing; collapsing that to
    // "unknown" would serve one semester's document under another's.
    expect(syllabusCacheKey({ registrationNo: '21BCE9999', semesterId: 'Fall Semester 2026-27', courseCode: 'BAEEE203' }))
      .toBe('21BCE9999|FALL SEMESTER 2026-27|BAEEE203|');
  });

  it('holds no session material', () => {
    expect(syllabusCacheKey(base)).not.toMatch(/csrf|cookie|token|jsessionid/i);
  });

  it('marks an unknown student or term instead of colliding them', () => {
    expect(syllabusCacheKey({ registrationNo: '', semesterId: '', courseCode: 'CSE2009' }))
      .toBe('unknown|unknown|CSE2009|');
  });
});
