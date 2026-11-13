/**
 * The opt-in contract around the shared marks aggregate: on by default,
 * persisted, deduped by cohort identity, withdrawn on opt-out, and never
 * quoting a group smaller than the privacy floor.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_COHORT_SIZE,
  cohortKeyOf,
  contextOf,
  contributionsOf,
  normalizeCohortStats,
  readCohortStats,
  readSharePreference,
  shareContributions,
  withdrawContributions,
  writeSharePreference,
  type CohortKey,
} from '../gradeSharing';
import { courseTotalsOf } from '../../utils/courseTotals';
import type { CourseMarks } from '../../types';

const empty = { scored: 0, max: 0, weightage: 0 };

function course(overrides: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'BEEE2023',
    courseTitle: 'Electric Circuits and Systems',
    cat1: { scored: 40, max: 50, weightage: 20, status: 'Evaluated', part: 'T' },
    cat2: { ...empty },
    da1: { scored: 10, max: 10, weightage: 10, status: 'Evaluated', part: 'T' },
    da2: { ...empty },
    da3: { ...empty },
    quiz: { ...empty },
    fat: { scored: 0, max: 100, weightage: 40, status: 'Pending', part: 'T' },
    extraComponents: [
      { title: 'Experiment', scored: 9, max: 10, weightage: 20, status: 'Evaluated', part: 'L' },
    ],
    labFat: { scored: 40, max: 50, weightage: 60, status: 'Evaluated', part: 'L' },
    totalScoredSoFar: 0,
    currentEstimatedGrade: '',
    credits: 4,
    theoryCredits: 3,
    labCredits: 1,
    ...overrides,
  };
}

function store(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

const context = { term: 'CH20252601', regulation: 'V2025', faculty: 'DR A', slot: 'A1' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sharing preference', () => {
  it('is on when the student has never touched it', () => {
    expect(readSharePreference(store())).toBe(true);
    expect(readSharePreference(null)).toBe(true);
  });

  it('persists an opt-out across sessions and clears it when turned back on', () => {
    const s = store();
    writeSharePreference(false, s);
    expect(s.map.get('ultracc.grades.share')).toBe('off');
    expect(readSharePreference(s)).toBe(false);
    writeSharePreference(true, s);
    expect(readSharePreference(s)).toBe(true);
  });

  it('treats an unreadable storage as the default rather than failing', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(readSharePreference(broken)).toBe(true);
    expect(() => writeSharePreference(false, broken)).not.toThrow();
  });
});

describe('what a course contributes', () => {
  it('sends both classes of an embedded course, each on its own pace', () => {
    const c = course();
    const { totals } = courseTotalsOf(c, { regNo: '25BEE0001' });
    const rows = contributionsOf(c, totals, context);
    expect(rows.map((r) => [r.component, r.percent, r.weight, r.stage])).toEqual([
      ['theory', 86.67, 70, 'internal'],
      // The lab's internal pace excludes its already-graded FAT.
      ['lab', 90, 80, 'internal'],
    ]);
    expect(rows.every((r) => r.term === context.term && r.regulation === 'V2025')).toBe(true);
  });

  it('does not send a class VTOP has published no marks for', () => {
    const c = course({ extraComponents: [], labFat: undefined });
    const { totals } = courseTotalsOf(c, { regNo: '25BEE0001' });
    expect(contributionsOf(c, totals, context).map((r) => r.component)).toEqual(['theory']);
  });

  it('stops contributing internals once VTOP has posted the course total', () => {
    const c = course();
    const { totals } = courseTotalsOf(c, { regNo: '25BEE0001', publishedTotal: 74 });
    expect(contributionsOf(c, totals, context)).toEqual([]);
  });

  it('contributes nothing when the term or the batch is unknown', () => {
    const c = course();
    const { totals } = courseTotalsOf(c, { regNo: '25BEE0001' });
    expect(contributionsOf(c, totals, { ...context, term: '' })).toEqual([]);
    expect(contributionsOf(c, totals, { ...context, regulation: '' })).toEqual([]);
  });
});

describe('cohort identity', () => {
  const base: CohortKey = {
    courseCode: 'BEEE2023',
    term: 'CH20252601',
    regulation: 'V2025',
    faculty: 'Dr A',
    slot: 'A1',
    component: 'theory',
    stage: 'internal',
  };

  it('compares case and spacing the same way', () => {
    expect(cohortKeyOf(base)).toBe(cohortKeyOf({ ...base, faculty: '  dr   a ' }));
  });

  it('separates every column the brief names', () => {
    const key = cohortKeyOf(base);
    for (const patch of [
      { courseCode: 'BEEE2024' },
      { term: 'CH20252602' },
      { regulation: 'V2024' },
      { faculty: 'Dr B' },
      { slot: 'B1' },
      { component: 'lab' as const },
      { stage: 'final' as const },
    ]) {
      expect(cohortKeyOf({ ...base, ...patch })).not.toBe(key);
    }
  });

  it('takes faculty and slot from the registered timetable', () => {
    const c = course({ slot: '' });
    const ctx = contextOf(c, [{
      id: 'x',
      courseCode: 'BEEE2023',
      courseTitle: 'Electric Circuits',
      slot: 'L36',
      facultyName: 'Dr A',
      venue: '',
      building: '',
      roomNo: '',
      day: 'Monday',
      startTime: '08:00',
      endTime: '08:50',
      isLab: false,
    }], { term: 'CH20252601', regNo: '25BEE0001' });
    expect(ctx).toEqual({ term: 'CH20252601', regulation: 'V2025', faculty: 'Dr A', slot: 'L36' });
  });
});

describe('the aggregate read keeps the privacy floor', () => {
  it('withholds figures below the floor even if the server sends them', () => {
    const stats = normalizeCohortStats({ count: 14, mean: 61.2, sd: 8 });
    expect(stats.suppressed).toBe(true);
    expect(stats.mean).toBeNull();
    expect(stats.sd).toBeNull();
  });

  it('passes a large enough group through', () => {
    const stats = normalizeCohortStats({ count: 33, mean: 55.18, sd: 2.76 });
    expect(stats).toEqual({ count: 33, mean: 55.18, sd: 2.76, suppressed: false });
    const reading = readCohortStats(stats, 60);
    expect(reading.level).toBe('ok');
    expect(reading.difference).toBe(4.82);
    expect(reading.band).toEqual([52.42, 57.94]);
  });

  it('says nothing but "not enough data" under the floor', () => {
    const reading = readCohortStats({ count: MIN_COHORT_SIZE - 1, mean: null, sd: null, suppressed: true }, 70);
    expect(reading.level).toBe('none');
    expect(reading.mean).toBeNull();
    expect(reading.difference).toBeNull();
    expect(reading.band).toBeNull();
  });

  it('warns on a small or widely spread group instead of sounding certain', () => {
    expect(readCohortStats({ count: 18, mean: 50, sd: 6, suppressed: false }, 50).warning).toContain('Small group');
    expect(readCohortStats({ count: 40, mean: 50, sd: 19, suppressed: false }, 50).warning).toContain('Wide spread');
  });
});

describe('withdrawal and repeated syncs', () => {
  it('withdraws this device through the RPC, never the table', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ withdrawn: true, removed: 2 }), { status: 200 });
    }));

    const done = await withdrawContributions('A'.repeat(24));
    expect(done).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/rest/v1/rpc/withdraw_marks');
    expect(calls[0].body).toEqual({ p_device_code: 'A'.repeat(24) });
  });

  it('sends the same dedupe key on every sync, so the server updates one row', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    const c = course();
    const { totals } = courseTotalsOf(c, { regNo: '25BEE0001' });
    const rows = contributionsOf(c, totals, context);
    await shareContributions('B'.repeat(24), rows);
    await shareContributions('B'.repeat(24), rows);

    expect(bodies).toHaveLength(rows.length * 2);
    expect(bodies[0]).toEqual(bodies[rows.length]);
    expect(Object.keys(bodies[0] as object)).toContain('p_device_code');
  });
});
