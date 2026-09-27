/**
 * syllabusStore — fetch one course's syllabus, through this browser's cache.
 *
 * Why a separate module: the interesting part of this feature is the ORDER —
 * look in IndexedDB first, only then spend a five-step walk through VTOP, and
 * store what came back under a key that cannot collide with another student,
 * another semester or another section. That ordering is what a regression test
 * has to pin, so it lives here as a function with injected dependencies
 * rather than inside a component's effect.
 *
 * WHAT THE CALLER HANDS OVER: a course code and title, this student's
 * registration number, and whichever term the app can name. Nothing else —
 * there is no slot, no faculty and no class id in this API, because the
 * gateway resolves VTOP's own class row for the course and the student is
 * never asked to pick one.
 *
 * WHAT IS CACHED: VTOP's document bytes and its own naming for the course.
 * WHAT IS NEVER CACHED: the cookie jar, the CSRF token, authorizedID or the
 * encrypted session token — none of them are arguments to this module, so none
 * of them can be written by accident. An honest "no syllabus" answer is not
 * cached either, because it can change the moment VTOP publishes the file; a
 * document, once it exists, does not.
 */

import { vtopDb as db } from './db/vtopDatabase';
import {
  mapSyllabusStatus,
  NO_SESSION_MESSAGE,
  syllabusCacheKey,
  syllabusRequestFor,
  type SyllabusCourse,
  type SyllabusStatus,
} from './syllabus';
import type { SyllabusInfo, SyllabusRequest } from './vtop/types';
import { isVtopError } from './vtop/errors';

/** The client surface this module needs — injectable for tests. */
export interface SyllabusFetcher {
  getSyllabus(request: SyllabusRequest): Promise<SyllabusInfo>;
}

/** The cache surface this module needs — injectable for tests. */
export interface SyllabusCache {
  getSyllabus(cacheKey: string): Promise<{ syllabus: SyllabusInfo } | null>;
  putSyllabus(record: {
    cacheKey: string;
    registrationNo: string;
    semesterId: string;
    courseCode: string;
    courseType: string;
    syllabus: SyllabusInfo;
    cachedAt: number;
  }): Promise<void>;
}

/** Which term the app is showing, when it can name one at all. */
export interface SyllabusTerm {
  /** VTOP's own semester id, when the app has one from a sync. */
  semesterId?: string;
  /** Its label ("Fall Semester 2026-27") — the gateway's fallback. */
  semesterLabel?: string;
}

export interface LoadSyllabusDeps {
  course: Pick<SyllabusCourse, 'courseCode' | 'courseTitle'>;
  term: SyllabusTerm;
  registrationNo: string;
  client: SyllabusFetcher;
  /** Defaults to the app's IndexedDB wrapper; a failed read never blocks VTOP. */
  cache?: SyllabusCache;
  /** Retry: skip the cached answer and ask VTOP again. */
  force?: boolean;
  /** Session gate — false means do not touch VTOP at all. */
  sessionActive?: boolean;
}

export interface LoadSyllabusResult {
  status: SyllabusStatus;
  /** Set when a cache write/read failed — a storage problem, not an auth one. */
  cacheNote?: string;
}

/** A cache that throws must not look like VTOP is unreachable. */
async function readCache(cache: SyllabusCache, key: string): Promise<SyllabusInfo | null> {
  try {
    const hit = await cache.getSyllabus(key);
    return hit?.syllabus ?? null;
  } catch {
    return null;
  }
}

/**
 * One course's syllabus: cache first, VTOP second, and a status that says
 * which of the two answered.
 */
export async function loadCourseSyllabus(deps: LoadSyllabusDeps): Promise<LoadSyllabusResult> {
  const { course, term, registrationNo, client } = deps;
  const cache = deps.cache ?? db;
  // The cache key needs a stable term string; a VTOP id when there is one, its
  // label otherwise (same rule the gateway uses to choose a term).
  const semesterId = (term.semesterId || term.semesterLabel || '').trim();
  const key = syllabusCacheKey({
    registrationNo, semesterId, courseCode: course.courseCode, courseType: '',
  });

  if (!deps.force) {
    const cached = await readCache(cache, key);
    if (cached?.available && cached.document?.dataUrl) {
      return { status: mapSyllabusStatus(cached, null, { cached: true }) };
    }
  }

  if (deps.sessionActive === false) {
    return {
      status: { kind: 'no-session', message: NO_SESSION_MESSAGE },
    };
  }

  const request = syllabusRequestFor(course, term);
  try {
    const info = await client.getSyllabus(request);
    const status = mapSyllabusStatus(info, null);
    if (status.kind === 'ready') {
      try {
        await cache.putSyllabus({
          cacheKey: key,
          registrationNo,
          semesterId,
          courseCode: course.courseCode,
          courseType: '',
          syllabus: info,
          cachedAt: Date.now(),
        });
      } catch {
        // The document is already in memory; a storage failure is a note, not
        // a reason to tell the student VTOP has nothing.
        return { status, cacheNote: 'This syllabus could not be saved for offline use.' };
      }
    }
    return { status };
  } catch (err) {
    // A dead session is worth reporting as such even if the cache is broken.
    if (isVtopError(err) && err.code === 'SESSION_EXPIRED') return { status: mapSyllabusStatus(null, err) };
    return { status: mapSyllabusStatus(null, err) };
  }
}

/**
 * Drop what this browser holds for one course — used by the retry button so a
 * stale file cannot be served straight back after a failure.
 */
export async function clearCourseSyllabus(parts: {
  registrationNo: string;
  semesterId: string;
  courseCode: string;
  courseType?: string;
}): Promise<void> {
  const key = syllabusCacheKey(parts);
  try {
    await db.deleteSyllabus(key);
  } catch {
    // Nothing to clear, or storage is unavailable; either way the fetch above
    // is the authoritative action.
  }
}
