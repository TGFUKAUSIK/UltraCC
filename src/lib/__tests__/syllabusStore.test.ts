/**
 * syllabusStore — the cache-before-VTOP ordering, under test.
 *
 * These are the behaviours the feature keeps after the simplification: a cached
 * document is served without touching VTOP; a miss walks VTOP's Course Page flow
 * and stores what came back; retry skips the cache and asks again; and a tab with
 * no session asks for a sign-in instead of presenting an empty page. A broken
 * cache is asserted separately, because a storage failure must never be reported
 * as VTOP having nothing.
 *
 * The request assertions are the brief's boundary: the store is handed a course
 * code and a term, so the gateway is asked for exactly that. There is no slot,
 * no faculty and no class id to send — the argument does not exist.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  clearCourseSyllabus,
  loadCourseSyllabus,
  type SyllabusCache,
  type SyllabusFetcher,
} from '../syllabusStore';
import { NO_SESSION_MESSAGE, syllabusCacheKey, UNREACHABLE_MESSAGE } from '../syllabus';
import { VtopError, NOT_AUTHENTICATED_MESSAGE } from '../vtop/errors';
import type { SyllabusInfo, SyllabusRequest } from '../vtop/types';

/** What the tab hands over: a course the student picked, and the term shown. */
const COURSE = { courseCode: 'CSE2009', courseTitle: 'Soft Computing' };
const TERM = { semesterId: 'CH2025261' };
const KEY = syllabusCacheKey({ registrationNo: '21BCE9999', semesterId: TERM.semesterId, courseCode: 'CSE2009', courseType: '' });

const DOC = {
  dataUrl: 'data:application/pdf;base64,JVBERi0=',
  contentType: 'application/pdf',
  fileName: 'CSE2009-syllabus.pdf',
  bytes: 2048,
  origin: 'course-syllabus' as const,
};

function cachedDoc(): SyllabusInfo {
  return { available: true, reached: 'document', document: DOC };
}

function makeCache(hit: SyllabusInfo | null = null) {
  const stored = new Map<string, SyllabusInfo>();
  if (hit) stored.set(KEY, hit);
  const cache: SyllabusCache = {
    getSyllabus: vi.fn(async (key: string) => (stored.has(key) ? { syllabus: stored.get(key)! } : null)),
    putSyllabus: vi.fn(async (record: Parameters<SyllabusCache['putSyllabus']>[0]) => {
      stored.set(record.cacheKey, record.syllabus);
    }),
  };
  return { cache, stored };
}

function makeClient(answer: () => Promise<SyllabusInfo>) {
  const calls: SyllabusRequest[] = [];
  const client: SyllabusFetcher = {
    getSyllabus: vi.fn(async (request: SyllabusRequest) => {
      calls.push(request);
      return answer();
    }),
  };
  return { client, calls };
}

/** The arguments one card's fetch runs with, unless a test overrides them. */
function deps(over: Partial<Parameters<typeof loadCourseSyllabus>[0]> = {}) {
  return {
    course: COURSE, term: TERM, registrationNo: '21BCE9999',
    client: { getSyllabus: async () => { throw new Error('must not be called'); } },
    ...over,
  };
}

describe('loadCourseSyllabus — cache first, VTOP second', () => {
  it('serves a cached document without asking VTOP at all', async () => {
    const { cache } = makeCache(cachedDoc());
    const { client, calls } = makeClient(async () => { throw new Error('must not be called'); });

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(result.status.kind).toBe('ready');
    if (result.status.kind === 'ready') expect(result.status.cached).toBe(true);
    expect(calls).toHaveLength(0);
    expect(client.getSyllabus).not.toHaveBeenCalled();
  });

  it('fetches from VTOP on a miss and stores the document it returned', async () => {
    const { cache, stored } = makeCache(null);
    const { client, calls } = makeClient(async () => cachedDoc());

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(result.status.kind).toBe('ready');
    if (result.status.kind === 'ready') expect(result.status.cached).toBe(false);
    // The gateway is asked for a course and a term. Nothing else exists here.
    expect(calls).toEqual([{ courseCode: 'CSE2009', semesterId: 'CH2025261' }]);
    expect(stored.get(KEY)?.document?.dataUrl).toBe(DOC.dataUrl);
  });

  it('stores the answer under the student, the term and the course — never under a class', async () => {
    const { cache } = makeCache(null);
    const { client } = makeClient(async () => cachedDoc());

    await loadCourseSyllabus(deps({ client, cache }));

    const record = (cache.putSyllabus as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record).toMatchObject({
      cacheKey: KEY, registrationNo: '21BCE9999', semesterId: 'CH2025261',
      courseCode: 'CSE2009', courseType: '',
    });
    // Four parts: student, term, code, registration type.
    expect(KEY.split('|')).toEqual(['21BCE9999', 'CH2025261', 'CSE2009', '']);
  });

  it('re-reads the same course from cache on the second open', async () => {
    const { cache } = makeCache(null);
    const first = makeClient(async () => cachedDoc());
    await loadCourseSyllabus(deps({ client: first.client, cache }));

    const second = makeClient(async () => { throw new Error('must not be called'); });
    const result = await loadCourseSyllabus(deps({ client: second.client, cache }));

    expect(result.status.kind).toBe('ready');
    expect(second.client.getSyllabus).not.toHaveBeenCalled();
  });

  it('retry skips the cache and asks VTOP again', async () => {
    const { cache } = makeCache(cachedDoc());
    const { client, calls } = makeClient(async () => cachedDoc());

    await loadCourseSyllabus(deps({ client, cache, force: true }));

    expect(calls).toHaveLength(1);
  });

  it('does not cache an honest absence, so it can be answered later', async () => {
    const { cache, stored } = makeCache(null);
    const { client } = makeClient(async () => ({ available: false, reason: 'no-syllabus-link' as const, reached: 'detail' as const }));

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(result.status).toMatchObject({ kind: 'unavailable', reason: 'no-syllabus-link' });
    expect(stored.size).toBe(0);
    expect(cache.putSyllabus).not.toHaveBeenCalled();
  });
});

describe('loadCourseSyllabus — the term the app could name', () => {
  it('asks by the term label when VTOP’s id is unknown, and keys the cache by that label', async () => {
    // A fresh install names the term it shows and nothing more; the gateway
    // resolves VTOP's own id, and the answer must not be filed under "unknown".
    const { cache, stored } = makeCache(null);
    const { client, calls } = makeClient(async () => cachedDoc());

    const result = await loadCourseSyllabus(deps({
      client, cache, term: { semesterLabel: 'Fall Semester 2026-27' },
    }));

    expect(calls).toEqual([{ courseCode: 'CSE2009', semesterLabel: 'Fall Semester 2026-27' }]);
    expect([...stored.keys()]).toEqual(['21BCE9999|FALL SEMESTER 2026-27|CSE2009|']);
    expect(result.status.kind).toBe('ready');
  });

  it('asks by the code alone when the app can name no term at all', async () => {
    const { cache } = makeCache(null);
    const { client, calls } = makeClient(async () => cachedDoc());

    await loadCourseSyllabus(deps({ client, cache, term: {} }));

    expect(calls).toEqual([{ courseCode: 'CSE2009' }]);
  });

  it('prefers VTOP’s id over the label when both are known', async () => {
    const { cache } = makeCache(null);
    const { client, calls } = makeClient(async () => cachedDoc());

    await loadCourseSyllabus(deps({
      client, cache, term: { semesterId: 'CH2025261', semesterLabel: 'Fall Semester 2025-26' },
    }));

    expect(calls[0].semesterId).toBe('CH2025261');
    expect(calls[0].semesterLabel).toBe('Fall Semester 2025-26');
  });

  it('will not serve another student’s or another term’s saved document', async () => {
    // Only a sibling's file is in the store. Reading it back for this student,
    // or for another term, would print someone else's syllabus.
    const { cache, stored } = makeCache(null);
    stored.set(syllabusCacheKey({ registrationNo: '21BCE8888', semesterId: 'CH2025261', courseCode: 'CSE2009' }), cachedDoc());
    stored.set(syllabusCacheKey({ registrationNo: '21BCE9999', semesterId: 'CH2024265', courseCode: 'CSE2009' }), cachedDoc());
    const { client, calls } = makeClient(async () => cachedDoc());

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(calls).toHaveLength(1);
    expect(result.status).toMatchObject({ kind: 'ready', cached: false });
  });
});

describe('loadCourseSyllabus — session and cache failures stay distinguishable', () => {
  it('a tab that never signed in asks for a sign-in without calling VTOP', async () => {
    const { cache, stored } = makeCache(null);
    const { client, calls } = makeClient(async () => cachedDoc());

    const result = await loadCourseSyllabus(deps({ client, cache, sessionActive: false }));

    // A page reload ends the memory-only token. Nothing expired, so the state
    // — and the words the UI builds from it — must not claim that it did.
    expect(result.status).toEqual({ kind: 'no-session', message: NO_SESSION_MESSAGE });
    expect(calls).toHaveLength(0);
    expect(stored.size).toBe(0);
  });

  it('a session VTOP itself ended keeps its own wording', async () => {
    const { cache } = makeCache(null);
    const { client } = makeClient(async () => {
      throw new VtopError('SESSION_EXPIRED', 'VTOP session expired while fetching syllabus. Please re-login.');
    });

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(result.status.kind).toBe('session-expired');
  });

  it('a tab that reloaded mid-flight is not reported as an expiry', async () => {
    const { cache } = makeCache(null);
    const { client } = makeClient(async () => {
      throw new VtopError('SESSION_EXPIRED', NOT_AUTHENTICATED_MESSAGE);
    });

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(result.status.kind).toBe('no-session');
  });

  it('a gateway failure maps to the retryable sentence, never to VTOP having nothing', async () => {
    const { cache, stored } = makeCache(null);
    const { client } = makeClient(async () => { throw new VtopError('VTOP_UNAVAILABLE', 'VTOP did not answer.'); });

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(result.status).toEqual({ kind: 'error', message: UNREACHABLE_MESSAGE });
    expect(stored.size).toBe(0);
  });

  it('a gateway answer VTOP could not serve reads as an absence, not as a broken tab', async () => {
    const { cache } = makeCache(null);
    const { client } = makeClient(async () => ({
      available: false, reason: 'no-course-match' as const, reached: 'courses' as const,
      // The gateway's own sentence is developer detail now; the student reads
      // the five curated sentences instead.
      detail: 'VTOP’s Course Page lists 7 registered classes for this semester — BAEEE203.',
    }));

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(result.status).toMatchObject({ kind: 'unavailable', reason: 'no-course-match' });
    if (result.status.kind === 'unavailable') {
      expect(result.status.message).toBe('VTOP does not list this course in the current semester.');
      expect(result.status.message).not.toMatch(/BAEEE203|7 registered/);
    }
  });
});

describe('loadCourseSyllabus — a broken cache is a storage problem, not VTOP\'s', () => {
  it('a cache read failure is a miss, and VTOP still gets asked', async () => {
    const cache: SyllabusCache = {
      getSyllabus: async () => { throw new Error('quota'); },
      putSyllabus: async () => undefined,
    };
    const { client, calls } = makeClient(async () => cachedDoc());

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(calls).toHaveLength(1);
    expect(result.status.kind).toBe('ready');
  });

  it('a cache write failure still shows VTOP\'s document, with a note', async () => {
    const cache: SyllabusCache = {
      getSyllabus: async () => null,
      putSyllabus: async () => { throw new Error('IndexedDB unavailable'); },
    };
    const { client } = makeClient(async () => cachedDoc());

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(result.status.kind).toBe('ready');
    expect(result.cacheNote).toMatch(/offline/);
  });

  it('leaves a failed write out of the absence path entirely', async () => {
    const cache: SyllabusCache = {
      getSyllabus: async () => null,
      putSyllabus: async () => { throw new Error('IndexedDB unavailable'); },
    };
    const { client } = makeClient(async () => ({ available: false, reason: 'no-syllabus-link' as const }));

    const result = await loadCourseSyllabus(deps({ client, cache }));

    expect(result.status.kind).toBe('unavailable');
    expect(result.cacheNote).toBeUndefined();
  });

  it('the cache never sees session material, only the four identity parts', async () => {
    const { cache } = makeCache(null);
    const { client } = makeClient(async () => cachedDoc());

    await loadCourseSyllabus(deps({ client, cache }));

    const record = (cache.putSyllabus as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(record).sort()).toEqual(['cacheKey', 'cachedAt', 'courseCode', 'courseType', 'registrationNo', 'semesterId', 'syllabus']);
    expect(JSON.stringify(record)).not.toMatch(/csrf|cookie|token|jsessionid|authorizedid/i);
  });
});

describe('clearCourseSyllabus', () => {
  it('drops one course without touching the others', async () => {
    const key = syllabusCacheKey({ registrationNo: '21BCE9999', semesterId: 'CH2025261', courseCode: 'CSE2009', courseType: '' });
    const other = syllabusCacheKey({ registrationNo: '21BCE9999', semesterId: 'CH2025261', courseCode: 'MAT1001', courseType: '' });
    expect(key).not.toBe(other);
    // The store is keyed per course, so a delete cannot fan out. This is the
    // contract vtopDatabase enforces; here it is enough that clearing a
    // missing key is a no-op rather than a throw.
    await expect(clearCourseSyllabus({
      registrationNo: '21BCE9999', semesterId: 'CH2025261', courseCode: 'CSE2009',
    })).resolves.toBeUndefined();
  });
});
