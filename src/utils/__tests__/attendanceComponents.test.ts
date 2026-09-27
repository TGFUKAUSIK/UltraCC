/**
 * attendanceComponents tests — the theory/lab separation contract.
 *
 * VTOP reports one attendance row per COMPONENT, so every figure the app shows
 * has to trace back to a row VTOP actually served: no blended percentages, no
 * weighting rules of our own, and an explicit "unknown" when the data does not
 * say which half a row is.
 */

import { describe, expect, it } from 'vitest';
import {
  attendanceComponent, baseCourseCode, componentLabel, componentTotals, componentsFor,
  findCourseGroup, groupCourseAttendance,
} from '../attendanceComponents';
import type { AttendanceRecord } from '../../types';

const row = (overrides: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  courseCode: 'CSE2001',
  courseTitle: 'Data Structures and Algorithms',
  type: 'ETH',
  slot: 'A1',
  facultyName: 'Dr. Vasudevan',
  attended: 18,
  totalHeld: 20,
  percentage: 90,
  category: 'Safe',
  lastUpdated: '2026-09-01',
  venue: 'SJT 204',
  ...overrides,
});

const theory = (overrides: Partial<AttendanceRecord> = {}) => row(overrides);
const lab = (overrides: Partial<AttendanceRecord> = {}) =>
  row({ courseCode: 'CSE2001L', courseTitle: 'Data Structures Lab', type: 'ELA', slot: 'L31+L32', attended: 8, totalHeld: 10, percentage: 80, ...overrides });

describe('attendanceComponent — classification comes from VTOP’s own fields', () => {
  it('reads the course-type column first', () => {
    expect(attendanceComponent(theory({ type: 'ETH' }))).toBe('Theory');
    expect(attendanceComponent(theory({ type: 'TH' }))).toBe('Theory');
    expect(attendanceComponent(lab({ type: 'ELA' }))).toBe('Lab');
    expect(attendanceComponent(lab({ type: 'LO' }))).toBe('Lab');
    expect(attendanceComponent(theory({ type: 'EPJ' }))).toBe('Project');
  });

  it('falls back to the slot token when the type cell is unusable', () => {
    expect(attendanceComponent(theory({ type: 'ETH' as AttendanceRecord['type'], slot: 'L31+L32' }))).toBe('Theory');
    // No type signal at all → the lab slot token decides.
    expect(attendanceComponent(row({ type: '' as AttendanceRecord['type'], slot: 'L31', courseCode: 'CSE9999', courseTitle: 'Mystery' }))).toBe('Lab');
  });

  it('falls back to VTOP’s lab code/title suffix', () => {
    expect(attendanceComponent(row({ type: '' as AttendanceRecord['type'], slot: '', courseCode: 'BCSE302L', courseTitle: 'Digital Electronics' }))).toBe('Lab');
    expect(attendanceComponent(row({ type: '' as AttendanceRecord['type'], slot: '', courseCode: 'BCSE302', courseTitle: 'Digital Electronics Laboratory' }))).toBe('Lab');
  });

  it('says unknown instead of guessing when nothing identifies the row', () => {
    const ambiguous = row({ type: '' as AttendanceRecord['type'], slot: '', courseCode: 'HUM1001', courseTitle: 'Ethics' });
    expect(attendanceComponent(ambiguous)).toBe('Unknown');
    expect(componentLabel(attendanceComponent(ambiguous))).toBe('Component unknown');
  });
});

describe('baseCourseCode — grouping VTOP’s sibling rows', () => {
  it('strips the lab suffix VTOP appends to the practical row', () => {
    expect(baseCourseCode('CSE2001L')).toBe('CSE2001');
    expect(baseCourseCode('CSE2001(L)')).toBe('CSE2001');
    expect(baseCourseCode('CSE2001 LAB')).toBe('CSE2001');
    expect(baseCourseCode('cse2001l')).toBe('CSE2001');
  });

  it('leaves theory codes and unusable values alone', () => {
    expect(baseCourseCode('CSE2001')).toBe('CSE2001');
    expect(baseCourseCode('')).toBe('');
    expect(baseCourseCode('L')).toBe('L');
  });
});

describe('groupCourseAttendance — one course, both halves kept apart', () => {
  it('pairs the theory and lab rows of one course', () => {
    const groups = groupCourseAttendance([theory(), lab()]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('CSE2001');
    expect(groups[0].isSplit).toBe(true);
    expect(groups[0].components.map(c => c.kind)).toEqual(['Theory', 'Lab']);
  });

  it('does not assume the rows arrive sorted or adjacent', () => {
    const groups = groupCourseAttendance([
      lab(),
      theory({ courseCode: 'MAT2001', courseTitle: 'Calculus', type: 'TH', slot: 'B1' }),
      theory(),
    ]);
    expect(groups.map(g => g.key)).toEqual(['CSE2001', 'MAT2001']);
    expect(groups[0].components.map(c => c.kind)).toEqual(['Theory', 'Lab']);
  });

  it('reports each component’s own attended / conducted / percentage', () => {
    const [group] = groupCourseAttendance([theory({ attended: 18, totalHeld: 20 }), lab({ attended: 8, totalHeld: 10 })]);
    const [theoryPart, labPart] = group.components;
    expect(theoryPart).toMatchObject({ kind: 'Theory', attended: 18, conducted: 20, percentage: 90 });
    expect(labPart).toMatchObject({ kind: 'Lab', attended: 8, conducted: 10, percentage: 80 });
  });

  it('combines by plain summation — never by weighting one half above the other', () => {
    const [group] = groupCourseAttendance([theory({ attended: 18, totalHeld: 20 }), lab({ attended: 8, totalHeld: 10 })]);
    // (18 + 8) / (20 + 10) — a 2× lab weight would have given 84.7 instead.
    expect(group.attended).toBe(26);
    expect(group.conducted).toBe(30);
    expect(group.percentage).toBe(86.7);
  });

  it('keeps two lab rows of one course as one component with both rows intact', () => {
    const [group] = groupCourseAttendance([
      theory(),
      lab({ slot: 'L31+L32', attended: 8, totalHeld: 10 }),
      lab({ slot: 'L41+L42', attended: 3, totalHeld: 6, facultyName: 'Dr. Other' }),
    ]);
    const labPart = group.components.find(c => c.kind === 'Lab')!;
    expect(labPart.rows).toHaveLength(2);
    expect(labPart.attended).toBe(11);
    expect(labPart.conducted).toBe(16);
    expect(group.components.map(c => c.kind)).toEqual(['Theory', 'Lab']);
  });

  it('keeps a course that only has a lab row as its own group', () => {
    const groups = groupCourseAttendance([lab()]);
    expect(groups).toHaveLength(1);
    expect(groups[0].isSplit).toBe(false);
    expect(groups[0].components.map(c => c.kind)).toEqual(['Lab']);
  });

  it('never blends a row whose component is unknown into theory or lab', () => {
    const groups = groupCourseAttendance([
      theory(),
      lab(),
      row({ type: '' as AttendanceRecord['type'], slot: '', courseCode: 'HUM1001L', courseTitle: 'Ethics', attended: 5, totalHeld: 5, percentage: 100 }),
    ]);
    const ethics = groups.find(g => g.key === 'HUM1001')!;
    expect(ethics.components.map(c => c.kind)).toEqual(['Lab']);
  });

  it('returns null percentage when VTOP has conducted nothing yet', () => {
    const [group] = groupCourseAttendance([theory({ attended: 0, totalHeld: 0, percentage: 0 })]);
    expect(group.percentage).toBeNull();
    expect(group.components[0].percentage).toBeNull();
  });

  it('finds the whole course from either of its rows', () => {
    const groups = groupCourseAttendance([theory(), lab()]);
    expect(findCourseGroup('CSE2001L', groups)?.key).toBe('CSE2001');
    expect(findCourseGroup('CSE2001', groups)?.key).toBe('CSE2001');
    expect(findCourseGroup('NOPE9999', groups)).toBeNull();
  });
});

describe('componentTotals — the semester-wide split', () => {
  it('separates theory from lab and sums each once', () => {
    const totals = componentTotals([
      theory({ attended: 18, totalHeld: 20 }),
      lab({ attended: 8, totalHeld: 10 }),
      theory({ courseCode: 'MAT2001', courseTitle: 'Calculus', type: 'TH', slot: 'B1', attended: 24, totalHeld: 30 }),
    ]);
    expect(totals.theory).toMatchObject({ attended: 42, conducted: 50, percentage: 84 });
    expect(totals.lab).toMatchObject({ attended: 8, conducted: 10, percentage: 80 });
    expect(totals.present.map(c => c.kind)).toEqual(['Theory', 'Lab']);
    // Overall is the plain sum: 50/60, not a weighted invention.
    expect(totals.attended).toBe(50);
    expect(totals.conducted).toBe(60);
    expect(totals.percentage).toBe(83.3);
  });

  it('keeps unknown rows visible instead of filing them under theory', () => {
    const totals = componentTotals([
      theory({ attended: 9, totalHeld: 10 }),
      row({ type: '' as AttendanceRecord['type'], slot: '', courseCode: 'HUM1001', courseTitle: 'Ethics', attended: 1, totalHeld: 10, percentage: 10 }),
    ]);
    expect(totals.theory.conducted).toBe(10);
    expect(totals.unknown.conducted).toBe(10);
    expect(totals.present.map(c => c.kind)).toEqual(['Theory', 'Unknown']);
  });

  it('reports nothing as available when there are no rows', () => {
    const totals = componentTotals([]);
    expect(totals.present).toEqual([]);
    expect(totals.percentage).toBeNull();
  });
});

describe('componentsFor — a course’s own split', () => {
  it('lists only the components that exist, in theory-then-lab order', () => {
    expect(componentsFor([lab(), theory()]).map(c => c.kind)).toEqual(['Theory', 'Lab']);
    expect(componentsFor([theory()]).map(c => c.kind)).toEqual(['Theory']);
    expect(componentsFor([])).toEqual([]);
  });
});
