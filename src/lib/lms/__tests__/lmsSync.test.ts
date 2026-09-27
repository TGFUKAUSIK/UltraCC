/**
 * LMS sync orchestration + cache regression tests (LMS brief §1).
 *
 * syncLmsData is the layer that decides what a partial Moodle outage means for
 * the student's screen and for IndexedDB, so these tests pin the four rules the
 * product depends on:
 *   - a failed dataset keeps its last good cache (nothing is wiped to pass a
 *     failure off as "this course has no assignments");
 *   - every dataset reports its own outcome, so one dead page never takes the
 *     whole LMS section down;
 *   - "last synced" only ever moves when something actually synced;
 *   - a failure string that reaches the UI is copy, not a status line.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncLmsData } from '../syncLms';
import type { LmsRealClient } from '../realClient';
import { VtopError } from '../../vtop/errors';
import { vtopDb } from '../../db/vtopDatabase';
import { looksTechnical } from '../../errorCopy';
import type { LmsCourse } from '../types';

const COURSE: LmsCourse = {
  courseId: 4711,
  name: 'CSE2001 Data Structures',
  shortName: 'CSE2001',
  url: 'https://lms.vit.ac.in/course/view.php?id=4711',
};

/** The raw half of the production failure, for the wording assertions. */
const RAW_TLS = 'error sending request for url (https://lms.vit.ac.in/login/index.php): client error (Connect): invalid peer certificate: UnknownIssuer';

interface ClientStub {
  getCourses: ReturnType<typeof vi.fn>;
  getAssignments: ReturnType<typeof vi.fn>;
  getQuizWindows: ReturnType<typeof vi.fn>;
  getGradebook: ReturnType<typeof vi.fn>;
  getMaterials: ReturnType<typeof vi.fn>;
  getForumAnnouncements: ReturnType<typeof vi.fn>;
  getCalendarEvents: ReturnType<typeof vi.fn>;
}

/**
 * The stub doubles as the concrete class's shape (what syncLms calls) and as
 * the recorded mocks (what these tests assert on), so a test can write
 * `client.getAssignments.mockRejectedValueOnce(...)` without a cast.
 */
type StubbedClient = LmsRealClient & ClientStub;

function clientStub(overrides: Partial<ClientStub> = {}): StubbedClient {
  const stub: ClientStub = {
    getCourses: vi.fn().mockResolvedValue([COURSE]),
    getAssignments: vi.fn().mockResolvedValue([{ assignmentId: 1, name: 'Lab 1', dueDate: null, url: '' }]),
    getQuizWindows: vi.fn().mockResolvedValue([]),
    getGradebook: vi.fn().mockResolvedValue([]),
    getMaterials: vi.fn().mockResolvedValue([{ materialId: 9, name: 'Notes.pdf', fileType: 'pdf', downloadUrl: null, postedDate: null }]),
    getForumAnnouncements: vi.fn().mockResolvedValue([]),
    getCalendarEvents: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return stub as unknown as StubbedClient;
}

function resultFor(results: { key: string; ok: boolean; error?: string }[], key: string) {
  return results.find((r) => r.key === key);
}

// Spies are installed per test and restored after each one; the real
// `vtopDb` (fake-indexeddb) stays untouched unless a test opts in.
const spies: { mockRestore: () => void }[] = [];

type DbImpl = (...args: unknown[]) => unknown;

/**
 * Replace named `vtopDb` methods for one test. Arguments are forwarded, so the
 * assertions can read what the sync actually asked the cache to write.
 */
function stubDb(overrides: Record<string, DbImpl>) {
  for (const [name, impl] of Object.entries(overrides)) {
    const target = vtopDb as unknown as Record<string, unknown>;
    if (typeof target[name] !== 'function') throw new Error(`vtopDb.${name} is not a function`);
    const spy = vi.spyOn(vtopDb as never, name as never)
      .mockImplementation((...args: unknown[]) => impl(...args) as never);
    spies.push(spy as unknown as { mockRestore: () => void });
  }
}

/** Every cache writer a full sync touches, resolving to a no-op. */
function inertCache(overrides: Record<string, DbImpl> = {}) {
  stubDb({
    saveLmsCourses: () => undefined,
    saveLmsCourseData: () => undefined,
    saveLmsCalendar: () => undefined,
    saveLmsMetadata: () => undefined,
    getLmsCourses: () => [],
    getLmsMetadata: () => null,
    ...overrides,
  });
}

beforeEach(() => {
  spies.length = 0;
});

afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
});

describe('partial failure', () => {
  it('names the dataset that failed and leaves the rest alone', async () => {
    inertCache();
    const client = clientStub({
      getMaterials: vi.fn().mockRejectedValue(new VtopError('PARSE_FAILED', 'The LMS changed how its pages are built, so this could not be read.')),
    });

    const outcome = await syncLmsData(client);

    expect(resultFor(outcome.results, 'courses')?.ok).toBe(true);
    expect(resultFor(outcome.results, `${COURSE.courseId}:materials`)?.ok).toBe(false);
    expect(resultFor(outcome.results, `${COURSE.courseId}:assignments`)?.ok).toBe(true);
    expect(outcome.courses).toHaveLength(1);
  });

  it('never overwrites a good cache with the datasets that failed', async () => {
    const saveCourseData = vi.fn();
    inertCache({ saveLmsCourseData: saveCourseData });
    const client = clientStub({
      getQuizWindows: vi.fn().mockRejectedValue(new VtopError('VTOP_UNAVAILABLE', 'LMS is temporarily unavailable. Try again.')),
    });

    await syncLmsData(client);

    const [, data] = saveCourseData.mock.calls[0] as [number, Record<string, unknown>];
    // An undefined dataset means "don't touch these rows" to the store — an
    // empty array would mean "this course genuinely has none" and wipe them.
    expect(data.quizzes).toBeUndefined();
    expect(data.assignments).toHaveLength(1);
    expect(data.materials).toHaveLength(1);
  });

  it('keeps every failure string it reports as human copy', async () => {
    inertCache();
    const technical = new VtopError('VTOP_UNAVAILABLE', RAW_TLS);
    const client = clientStub({
      getAssignments: vi.fn().mockRejectedValue(technical),
      getGradebook: vi.fn().mockRejectedValue(technical),
      getMaterials: vi.fn().mockRejectedValue(technical),
      getForumAnnouncements: vi.fn().mockRejectedValue(technical),
      getQuizWindows: vi.fn().mockRejectedValue(technical),
      getCalendarEvents: vi.fn().mockRejectedValue(technical),
    });

    const { results } = await syncLmsData(client);
    const failures = results.filter((r) => !r.ok);

    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      expect(looksTechnical(failure.error || ''), `${failure.key}: ${failure.error}`).toBe(false);
      expect(failure.error).not.toMatch(/https?:\/\/|certificate|50\d|fetchdata|sessiontoken/i);
    }
  });
});

describe('cache behaviour', () => {
  it('a failed course list falls back to the cached courses instead of an empty list', async () => {
    const saveLmsCourses = vi.fn();
    inertCache({ saveLmsCourses, getLmsCourses: () => [COURSE] });
    const client = clientStub({
      getCourses: vi.fn().mockRejectedValue(new VtopError('VTOP_UNAVAILABLE', 'LMS is temporarily unavailable. Try again.')),
    });

    const outcome = await syncLmsData(client);

    expect(outcome.courses).toEqual([COURSE]);
    expect(saveLmsCourses).not.toHaveBeenCalled();
    expect(resultFor(outcome.results, 'courses')?.ok).toBe(false);
    // Cached courses are still worth syncing per-course datasets for.
    expect(client.getCourses).toHaveBeenCalledTimes(1);
    expect(outcome.courseResults).toHaveLength(1);
  });

  it('writes an empty course list when Moodle really returns none', async () => {
    const saveLmsCourses = vi.fn();
    inertCache({ saveLmsCourses });
    const client = clientStub({ getCourses: vi.fn().mockResolvedValue([]) });

    const outcome = await syncLmsData(client);

    expect(saveLmsCourses).toHaveBeenCalledWith([]);
    expect(outcome.courses).toEqual([]);
    expect(resultFor(outcome.results, 'courses')?.ok).toBe(true);
    expect(resultFor(outcome.results, 'courses')?.error).toBeUndefined();
  });

  it('keeps the previous "last synced" moment when nothing synced at all', async () => {
    const saveLmsMetadata = vi.fn();
    inertCache({ saveLmsMetadata, getLmsMetadata: () => ({ lastSyncedAt: 1000, usernameHint: '21bc', coursesSynced: 3 }) });
    const down = new VtopError('VTOP_UNAVAILABLE', 'LMS is temporarily unavailable. Try again.');
    const client = clientStub({
      getCourses: vi.fn().mockRejectedValue(down),
      getCalendarEvents: vi.fn().mockRejectedValue(down),
    });

    const { results } = await syncLmsData(client);

    const meta = saveLmsMetadata.mock.calls[0][0] as Record<string, unknown>;
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(meta.lastSyncedAt).toBe(1000);
    expect(meta.lastSyncStatus).toBe('failed');
    expect(Number(meta.lastAttemptedAt)).toBeGreaterThan(1000);
  });

  it('marks a run that got some datasets "partial" and still moves last-synced', async () => {
    const saveLmsMetadata = vi.fn();
    inertCache({ saveLmsMetadata, getLmsMetadata: () => ({ lastSyncedAt: 1000, usernameHint: '21bc', coursesSynced: 1 }) });
    const client = clientStub({
      getCalendarEvents: vi.fn().mockRejectedValue(new VtopError('PARSE_FAILED', 'The LMS sent an unreadable answer for the LMS calendar, so it was not saved.')),
    });

    await syncLmsData(client);

    const meta = saveLmsMetadata.mock.calls[0][0] as Record<string, unknown>;
    expect(meta.lastSyncStatus).toBe('partial');
    expect(Number(meta.lastSyncedAt)).toBeGreaterThan(1000);
    expect(meta.coursesSynced).toBe(1);
  });
});

describe('retry behaviour', () => {
  it('a second sync after a transient failure reports synced and persists again', async () => {
    const saveCourseData = vi.fn();
    inertCache({ saveLmsCourseData: saveCourseData });
    const client = clientStub();
    client.getAssignments
      .mockRejectedValueOnce(new VtopError('VTOP_UNAVAILABLE', 'LMS is temporarily unavailable. Try again.'));

    const first = await syncLmsData(client);
    expect(resultFor(first.results, `${COURSE.courseId}:assignments`)?.ok).toBe(false);

    const second = await syncLmsData(client);
    expect(second.results.every((r) => r.ok)).toBe(true);
    expect(client.getAssignments).toHaveBeenCalledTimes(2);
    const lastCall = saveCourseData.mock.calls.at(-1) as [number, Record<string, unknown>];
    expect(lastCall[1].assignments).toHaveLength(1);
  });

  it('fetches a course\'s datasets one at a time, so no response rolls the session back', async () => {
    inertCache();
    let inFlight = 0;
    let peak = 0;
    const track = <T>(value: T) => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight -= 1;
      return value;
    };
    const client = clientStub({
      getAssignments: vi.fn().mockImplementation(track([])),
      getQuizWindows: vi.fn().mockImplementation(track([])),
      getGradebook: vi.fn().mockImplementation(track([])),
      getMaterials: vi.fn().mockImplementation(track([])),
      getForumAnnouncements: vi.fn().mockImplementation(track([])),
      getCalendarEvents: vi.fn().mockImplementation(track([])),
    });

    await syncLmsData(client);

    expect(peak).toBe(1);
  });
});

describe('semester handling', () => {
  it('keeps LMS rows out of the VTOP semester cache, and clears them with the account', async () => {
    // Moodle has no VTOP semester: /my/ is one live dashboard. So LMS rows must
    // survive a semester switch (which clears and rewrites VTOP stores) and
    // must die with the account. Both halves are the same single-tenant
    // invariant the VTOP cache already documents.
    await vtopDb.clear();
    await vtopDb.saveLmsCourses([COURSE]);

    expect((await vtopDb.getLmsCourses()).map((c) => c.courseId)).toEqual([COURSE.courseId]);

    await vtopDb.clearVtopStores();
    expect((await vtopDb.getLmsCourses()).map((c) => c.courseId)).toEqual([COURSE.courseId]);

    await vtopDb.clearLmsData();
    expect(await vtopDb.getLmsCourses()).toEqual([]);
    expect(await vtopDb.getLmsMetadata()).toBeNull();
  });
});
