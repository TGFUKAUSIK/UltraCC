import { beforeEach, describe, expect, it } from 'vitest';

import { vtopDb } from '../vtopDatabase';
import { loadCourseSyllabus } from '../../syllabusStore';
import type { CoursePageCacheEntry, SyllabusInfo, SyllabusRequest } from '../../vtop/types';

/**
 * `put()` of a row whose keyPath value is missing throws synchronously, which
 * aborts the whole transaction — one bad record used to discard every other
 * dataset in the same sync and surface as a failed login.
 */
describe('saveAllData key handling', () => {
  beforeEach(async () => {
    await vtopDb.clear();
  });

  it('caches a profile that VTOP served without a registration number', async () => {
    await vtopDb.saveAllData(
      { profile: { name: 'Asha', branch: 'CSE' } as never },
      'LIVE_VTOP',
      'SEM-1',
      '21BCE1111'
    );

    const cached = await vtopDb.getAllData();
    expect(cached?.profile?.name).toBe('Asha');
    expect(cached?.metadata.registrationNo).toBe('21BCE1111');
  });

  it('skips keyless rows but keeps every other dataset in the same sync', async () => {
    await vtopDb.saveAllData(
      {
        profile: { registrationNo: '21BCE2222', name: 'Baskar' } as never,
        attendance: [
          { courseCode: 'CSEL2041', facultyName: 'F', attendancePercentage: 88 } as never,
          { courseCode: undefined, facultyName: 'F', attendancePercentage: 0 } as never,
        ],
        timetable: [
          { id: 'slot-1', day: 'Monday', slot: 'A1', courseCode: 'CSEL2041' } as never,
          { day: 'Monday', slot: 'A2', courseCode: 'CSEL2041' } as never,
        ],
      },
      'LIVE_VTOP',
      'SEM-1',
      '21BCE2222'
    );

    const cached = await vtopDb.getAllData();
    expect(cached?.attendance).toHaveLength(1);
    expect(cached?.timetable).toHaveLength(1);
    expect(cached?.timetable[0].slot).toBe('A1');
    expect(cached?.profile?.name).toBe('Baskar');
    expect(vtopDb.lastCacheReadError).toBeNull();
  });
});

/**
 * The syllabus cache — the one store that holds VTOP *document bytes*, so its
 * key is the whole privacy story: nothing may be readable under a different
 * student, semester or course, and signing out must empty it with everything
 * else. These run against the real IndexedDB wrapper, not a mock.
 */
describe('syllabus cache', () => {
  // What the tab hands over: a course code and its name, nothing else. There
  // is no slot or faculty here to travel to the gateway any more.
  const course = { courseCode: 'CSE2009', courseTitle: 'Soft Computing' };
  const term = { semesterId: 'CH2025261' };

  const fetched = (dataUrl: string): SyllabusInfo => ({
    available: true,
    course: { courseCode: 'CSE2009', courseTitle: 'Soft Computing' },
    document: { dataUrl, contentType: 'application/pdf', fileName: 'CSE2009.pdf', bytes: 1234, origin: 'course-syllabus' },
  });

  /** Counts VTOP calls so a cache hit is provably not a refetch. */
  function countingClient(info: SyllabusInfo) {
    const calls: SyllabusRequest[] = [];
    return {
      calls,
      client: {
        getSyllabus: async (req: SyllabusRequest) => {
          calls.push(req);
          return info;
        },
      },
    };
  }

  beforeEach(async () => {
    await vtopDb.clear();
  });

  it('stores VTOP’s file under one key and reads it back byte-for-byte', async () => {
    await vtopDb.putSyllabus({
      cacheKey: '21BCE9999|CH2025261|CSE2009|ETH',
      registrationNo: '21BCE9999',
      semesterId: 'CH2025261',
      courseCode: 'CSE2009',
      courseType: 'ETH',
      syllabus: fetched('data:application/pdf;base64,JVBERi0x'),
      cachedAt: 1_700_000_000_000,
    });

    const hit = await vtopDb.getSyllabus('21BCE9999|CH2025261|CSE2009|ETH');
    expect(hit?.syllabus.document?.dataUrl).toBe('data:application/pdf;base64,JVBERi0x');
    expect(hit?.syllabus.document?.origin).toBe('course-syllabus');
    expect(hit?.cachedAt).toBe(1_700_000_000_000);
    expect(await vtopDb.getSyllabus('21BCE9999|CH2025261|CSE2009|')).toBeNull();
  });

  it('answers a second open from this device without asking VTOP again', async () => {
    const { calls, client } = countingClient(fetched('data:application/pdf;base64,JVBERi0x'));
    const deps = { course, term, registrationNo: '21BCE9999', client, sessionActive: true };

    const first = await loadCourseSyllabus(deps);
    expect(first.status).toMatchObject({ kind: 'ready', cached: false });
    expect(calls).toHaveLength(1);
    // What went to VTOP identifies the course and the term being viewed —
    // exactly that, and no class placement the student never chose.
    expect(calls[0]).toEqual({ courseCode: 'CSE2009', semesterId: 'CH2025261' });

    const second = await loadCourseSyllabus(deps);
    expect(second.status).toMatchObject({ kind: 'ready', cached: true });
    expect(calls).toHaveLength(1);

    // Re-check with VTOP is explicit and does reach it.
    const third = await loadCourseSyllabus({ ...deps, force: true });
    expect(third.status.kind).toBe('ready');
    expect(calls).toHaveLength(2);
  });

  it('keeps one course’s file out of another student’s and another term’s lookup', async () => {
    const { client } = countingClient(fetched('data:application/pdf;base64,JVBERi0x'));
    await loadCourseSyllabus({ course, term, registrationNo: '21BCE9999', client });

    expect(await vtopDb.getSyllabusKeys()).toEqual(['21BCE9999|CH2025261|CSE2009|']);
    // Same course, different student / term: misses, because the key has both.
    for (const key of [
      '21BCE8888|CH2025261|CSE2009|',
      '21BCE9999|CH2026261|CSE2009|',
    ]) {
      expect(await vtopDb.getSyllabus(key)).toBeNull();
    }
  });

  it('never stores an absence, and clearing the cache for sign-out removes stored files', async () => {
    const absent = { client: { getSyllabus: async () => ({ available: false, reason: 'no-syllabus-link' as const }) } };
    await loadCourseSyllabus({ course, term, registrationNo: '21BCE9999', client: absent.client });
    expect(await vtopDb.getSyllabusKeys()).toEqual([]);

    await loadCourseSyllabus({
      course, term, registrationNo: '21BCE9999',
      client: countingClient(fetched('data:application/pdf;base64,JVBERi0x')).client,
    });
    expect(await vtopDb.getSyllabusKeys()).toHaveLength(1);

    await vtopDb.clear();
    expect(await vtopDb.getSyllabusKeys()).toEqual([]);
  });
});

/**
 * The Course Page listing cache — VTOP's registration record for one student in
 * one semester, which is why its key is student + semester and nothing else
 * about the session. A listing that leaked across keys would show one student's
 * faculties and class ids to another.
 */
describe('course page listing cache', () => {
  const KEY = '21BCE9999|CH2025261';

  const record = (cacheKey: string, faculty: string): CoursePageCacheEntry => {
    const [registrationNo, semesterId] = cacheKey.split('|');
    return {
      cacheKey,
      registrationNo,
      semesterId,
      classes: [{
        courseCode: 'BAEEE202', courseTitle: 'Control Systems', courseType: 'ETH',
        classId: '771', classGroup: 'A3', slot: 'E1/TE1', faculty, erpId: '42', resolved: true,
      }],
      cachedAt: 1_700_000_000_000,
    };
  };

  beforeEach(async () => {
    await vtopDb.clear();
  });

  it('round-trips VTOP’s own rows, including the ones it left unresolved', async () => {
    const saved = record(KEY, 'Dr. Anandaji J');
    saved.classes[0].resolved = false;
    saved.classes[0].faculty = '';
    await vtopDb.putCoursePageClasses(saved);

    const hit = await vtopDb.getCoursePageClasses(KEY);
    expect(hit?.classes).toEqual(saved.classes);
    expect(hit?.cachedAt).toBe(1_700_000_000_000);
  });

  it('answers a different student or term with nothing, not with the saved listing', async () => {
    await vtopDb.putCoursePageClasses(record(KEY, 'Dr. Anandaji J'));

    expect(await vtopDb.getCoursePageClasses('21BCE8888|CH2025261')).toBeNull();
    expect(await vtopDb.getCoursePageClasses('21BCE9999|CH2026261')).toBeNull();
    expect(await vtopDb.getCoursePageClasses('')).toBeNull();
  });

  it('goes with the rest of the per-student data on account switch and on clear', async () => {
    await vtopDb.putCoursePageClasses(record(KEY, 'Dr. Anandaji J'));
    expect(await vtopDb.getCoursePageClasses(KEY)).not.toBeNull();

    await vtopDb.clearVtopStores();
    expect(await vtopDb.getCoursePageClasses(KEY)).toBeNull();

    await vtopDb.putCoursePageClasses(record(KEY, 'Dr. Anandaji J'));
    await vtopDb.clear();
    expect(await vtopDb.getCoursePageClasses(KEY)).toBeNull();
  });

  it('holds no session material in what it stores', async () => {
    await vtopDb.putCoursePageClasses(record(KEY, 'Dr. Anandaji J'));
    const hit = await vtopDb.getCoursePageClasses(KEY);
    expect(JSON.stringify(hit)).not.toMatch(/csrf|cookie|token|jsessionid|authorizedid/i);
  });
});
