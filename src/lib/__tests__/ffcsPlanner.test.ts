import { describe, it, expect } from 'vitest';
import {
  FFCS_CATALOGUE,
  ffcsCourseOptions,
  ffcsSectionsFor,
  searchFfcsCourses,
  expandSlotString,
  allSlotTokens,
  meetingsOverlap,
  findPlanClashes,
  clashingSectionIds,
  planCredits,
  type PlanSection,
} from '../ffcsPlanner';

const section = (over: Partial<PlanSection>): PlanSection => ({
  id: over.id || 's1',
  code: over.code || 'CSE1001',
  title: over.title || 'Test Course',
  slot: over.slot || 'A1',
  type: over.type || 'TH',
  credits: over.credits ?? 4,
  venue: over.venue || 'SJT 101',
  faculty: over.faculty || 'Dr. Test',
});

describe('ffcs catalogue (vendored FFCSonTheGo snapshot)', () => {
  it('loads the full Chennai inventory with normalized fields', () => {
    expect(FFCS_CATALOGUE.length).toBeGreaterThan(2000);
    const first = FFCS_CATALOGUE[0];
    expect(first.code).toMatch(/^[A-Z]{5}\d{3}/);
    expect(first.credits).toBeGreaterThanOrEqual(0);
    expect(typeof first.slot).toBe('string');
  });

  it('builds unique course options with section counts', () => {
    const options = ffcsCourseOptions();
    expect(options.length).toBeGreaterThan(400);
    const withSections = options.find((o) => o.sectionCount > 1);
    expect(withSections).toBeDefined();
    const opts = ffcsSectionsFor(withSections!.code);
    expect(opts.length).toBe(withSections!.sectionCount);
  });

  it('search ranks code-prefix matches before substring matches', () => {
    const hits = searchFfcsCourses('BEEE');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.code.startsWith('BEEE') || h.title.toUpperCase().includes('BEEE'))).toBe(true);
    expect(searchFfcsCourses('')).toEqual([]);
  });

  it('returns no sections for an unknown code (honest empty)', () => {
    expect(ffcsSectionsFor('ZZZZZ999')).toEqual([]);
  });
});

describe('slot grid expansion', () => {
  it('expands a theory slot to its meetings across days', () => {
    // A1: Mon 08:00, Wed 08:55 per the Chennai schema.
    const meetings = expandSlotString('A1');
    expect(meetings).toHaveLength(2);
    const mon = meetings.find((m) => m.day === 'Monday');
    expect(mon).toMatchObject({ start: '08:00', end: '08:50' });
  });

  it('expands multi-slot strings like F1+TF1', () => {
    const meetings = expandSlotString('F1+TF1');
    expect(meetings.length).toBeGreaterThanOrEqual(2);
  });

  it('expands lab slots with their own time rows', () => {
    // L6 is 12:30-13:20 Mon per the Chennai lab schema.
    const meetings = expandSlotString('L6');
    const mon = meetings.find((m) => m.day === 'Monday');
    expect(mon).toMatchObject({ start: '12:30', end: '13:20' });
  });

  it('yields nothing for a slot that is not in the grid', () => {
    expect(expandSlotString('QQ99')).toEqual([]);
  });

  it('covers every published slot token, theory and lab', () => {
    const { theory, lab } = allSlotTokens();
    expect(theory.length).toBeGreaterThan(30);
    expect(lab.length).toBeGreaterThan(50);
    expect(lab.every((s) => s.startsWith('L'))).toBe(true);
  });
});

describe('clash detection', () => {
  it('flags two sections overlapping on the same day', () => {
    // A1 (Mon 08:00-08:50 + Wed 08:55-09:45) and B1 (Tue 08:00-08:50 + Thu
    // 08:55-09:45) never share wall-clock time — the standard slots are
    // designed not to collide. The real collision is a lunch-hour lab:
    // S11 (Mon 12:35-13:25) overlaps L6 (Mon 12:30-13:20).
    const noClash = findPlanClashes([section({ id: 'a', slot: 'A1' }), section({ id: 'b', slot: 'B1' })]);
    expect(noClash).toEqual([]);

    const clash = findPlanClashes([section({ id: 'a', slot: 'S11' }), section({ id: 'b', slot: 'L6' })]);
    expect(clash).toHaveLength(1);
    expect(clash[0]).toMatchObject({ day: 'Monday', start: '12:35', end: '13:20' });
    expect(clash[0].ids.sort()).toEqual(['a', 'b']);
  });

  it('treats touching time ranges as non-clashing', () => {
    expect(meetingsOverlap({ day: 'Monday', start: '08:00', end: '08:50' }, { day: 'Monday', start: '08:50', end: '09:40' })).toBe(false);
    expect(meetingsOverlap({ day: 'Monday', start: '08:00', end: '08:50' }, { day: 'Monday', start: '08:30', end: '09:20' })).toBe(true);
    expect(meetingsOverlap({ day: 'Monday', start: '08:00', end: '08:50' }, { day: 'Tuesday', start: '08:30', end: '09:20' })).toBe(false);
  });

  it('never flags a section against itself', () => {
    // A1 has multiple meetings; a section with slot A1 must not self-clash.
    expect(findPlanClashes([section({ id: 'a', slot: 'A1' })])).toEqual([]);
  });

  it('detects theory-vs-lab overlaps through wall-clock times', () => {
    // L2 is Mon 08:50-09:40; F1 is Mon 08:55-09:45 — overlapping ranges.
    const clashes = findPlanClashes([section({ id: 'lab', slot: 'L2' }), section({ id: 'th', slot: 'F1' })]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].day).toBe('Monday');
  });

  it('collects every clashing section id for highlighting', () => {
    const ids = clashingSectionIds([section({ id: 'a', slot: 'S11' }), section({ id: 'b', slot: 'L6' }), section({ id: 'c', slot: 'B1' })]);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(false);
  });

  it('an unknown slot expands to no meetings and therefore never clashes', () => {
    expect(findPlanClashes([section({ id: 'a', slot: 'QQ99' }), section({ id: 'b', slot: 'A1' })])).toEqual([]);
  });
});

describe('plan totals', () => {
  it('sums credits and treats missing credits as 0', () => {
    const noCredits = { ...section({}), credits: undefined } as unknown as PlanSection;
    expect(planCredits([section({ credits: 4 }), section({ credits: 2 }), noCredits])).toBe(6);
  });
});
