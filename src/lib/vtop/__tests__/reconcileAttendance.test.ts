import { describe, it, expect } from 'vitest';
import { reconcileAttendanceWithDetail } from '../reconcileAttendance';
import type { AttendanceDateRow, AttendanceRecord, OdEntry, OdSummary } from '../types';

/** A summary row as the gateway stores it after parsing VTOP's own table. */
function row(over: Partial<AttendanceRecord>): AttendanceRecord {
  return {
    courseCode: 'CSE2001',
    courseTitle: 'Data Structures and Algorithms',
    courseType: 'ETH',
    slot: 'A1',
    facultyName: 'Dr. S. K. Vasudevan',
    attended: 20,
    totalHeld: 20,
    percentage: 100,
    category: 'Theory',
    lastUpdated: '2026-10-12',
    ...over,
  };
}

/** Dated rows VTOP listed for one class: `present` then `absent`. */
function sessions(present: number, absent: number, timing = '09:00-09:50'): AttendanceDateRow[] {
  return [
    ...Array.from({ length: present }, (_, i) => ({ date: `0${(i % 9) + 1}-OCT-2026`, timing, status: 'Present' })),
    ...Array.from({ length: absent }, (_, i) => ({ date: `1${i}-OCT-2026`, timing, status: 'Absent' })),
  ];
}

function entry(over: Partial<OdEntry> & { dates: AttendanceDateRow[] }): OdEntry {
  return {
    courseCode: 'CSE2001',
    courseName: 'Data Structures and Algorithms',
    slot: 'A1',
    odHours: 0,
    onDutyCount: 0,
    present: 0,
    absent: 0,
    total: over.dates.length,
    ...over,
  };
}

function od(perCourse: OdEntry[]): OdSummary {
  return { available: true, limitHours: 40, totalOdHours: 0, perCourse };
}

describe('reconcileAttendanceWithDetail', () => {
  it('is a no-op without a usable per-class detail', () => {
    const rows = [row({})];
    expect(reconcileAttendanceWithDetail(rows, null)).toBe(rows);
    expect(reconcileAttendanceWithDetail(rows, { available: false, limitHours: null, totalOdHours: 0, perCourse: [] })).toBe(rows);
    expect(reconcileAttendanceWithDetail(rows, od([]))).toBe(rows);
  });

  it('leaves an older cache (no per-class dates) untouched', () => {
    const rows = [row({ attended: 20, totalHeld: 20 })];
    // An entry written before the gateway captured dates carries none.
    const stale = { ...entry({ dates: [] }), dates: undefined as unknown as AttendanceDateRow[] };
    const out = reconcileAttendanceWithDetail(rows, od([stale]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ attended: 20, totalHeld: 20 });
  });

  it("brings a stale summary up to the classes the detail recorded (today's, in the reported case)", () => {
    const rows = [row({ attended: 20, totalHeld: 20 })];
    // Four more classes today: one present, three absent.
    const out = reconcileAttendanceWithDetail(rows, od([entry({ dates: sessions(21, 3) })]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ attended: 21, totalHeld: 24 });
    // 21/24 = 87.5, the truncating rule the rest of the app prints with.
    expect(out[0].percentage).toBe(87.5);
  });

  it('never reduces a summary VTOP published', () => {
    const rows = [row({ attended: 20, totalHeld: 20 })];
    const out = reconcileAttendanceWithDetail(rows, od([entry({ dates: sessions(5, 0) })]));
    expect(out[0]).toMatchObject({ attended: 20, totalHeld: 20 });
  });

  it('counts a two-period lab session as two periods (the summary\'s own unit)', () => {
    const rows = [row({ courseCode: 'CSE2001L', slot: 'L31+L32', category: 'Lab', courseType: 'ELA', attended: 18, totalHeld: 18 })];
    // 9 sessions at 14:00-15:40 → 18 periods; 8 present + 1 on duty → 18 attended.
    const dates: AttendanceDateRow[] = Array.from({ length: 9 }, (_, i) => ({
      date: `0${i + 1}-OCT-2026`,
      timing: '14:00-15:40',
      status: i === 0 ? 'On Duty' : 'Present',
    }));
    const out = reconcileAttendanceWithDetail(rows, od([entry({ courseCode: 'CSE2001L', slot: 'L31+L32', dates })]));
    // 18 == 18, so nothing moves; the point is the span did not read as 9.
    expect(out[0]).toMatchObject({ attended: 18, totalHeld: 18 });
  });

  it('adds a component the summary omitted entirely, from the detail\'s own figures', () => {
    const rows = [
      row({ courseCode: 'BAEEE103', slot: 'L55+L56', category: 'Lab', courseType: 'Embedded Lab', attended: 18, totalHeld: 18 }),
      row({ courseCode: 'BAHUM103', slot: 'G1', attended: 20, totalHeld: 20 }),
    ];
    const theory = entry({ courseCode: 'BAEEE103', courseName: 'Analog Electronics', slot: 'F1+TF1', dates: sessions(27, 0) });
    const lab = entry({ courseCode: 'BAEEE103', slot: 'L55+L56', dates: Array.from({ length: 9 }, (_, i) => ({ date: `0${i + 1}-OCT-2026`, timing: '14:00-15:40', status: 'Present' })) });

    const out = reconcileAttendanceWithDetail(rows, od([theory, lab]));
    expect(out).toHaveLength(3);
    const added = out[2];
    expect(added).toMatchObject({
      courseCode: 'BAEEE103',
      courseTitle: 'Analog Electronics',
      slot: 'F1+TF1',
      courseType: 'ETH',
      facultyName: '',
      attended: 27,
      totalHeld: 27,
    });
    // The lab that was already listed keeps VTOP's own figures (18 = 9 × 2).
    expect(out[0]).toMatchObject({ attended: 18, totalHeld: 18 });
    expect(out[1]).toMatchObject({ courseCode: 'BAHUM103' });
  });

  it('does not add a class whose slot is only spelled differently', () => {
    const rows = [row({ courseCode: 'CSE2001L', slot: 'L31+L32', category: 'Lab', courseType: 'ELA', attended: 18, totalHeld: 18 })];
    const out = reconcileAttendanceWithDetail(
      rows,
      od([entry({ courseCode: 'CSE2001L', slot: 'L32+L31', dates: sessions(9, 0, '14:00-15:40') })]),
    );
    expect(out).toHaveLength(1);
  });

  // The reported bug (2026-10-12): the summary's Slot COLUMN reads "A1+TA1" while
  // the row's own View link — the handle the gateway follows — carries "A1". The
  // first cut compared the two slots for an exact set match, so the row and its
  // detail never met and the headline stayed stale under a correct daily list.
  it('joins a summary row to its detail when VTOP spells the slot two ways', () => {
    const rows = [row({ slot: 'A1+TA1', attended: 20, totalHeld: 20 })];
    const out = reconcileAttendanceWithDetail(rows, od([entry({ slot: 'A1', dates: sessions(21, 3) })]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'A1+TA1', attended: 21, totalHeld: 24 });
    expect(out[0].percentage).toBe(87.5);
  });

  it('does not add the same class twice when the detail shortens the slot', () => {
    const rows = [row({ slot: 'A1+TA1', attended: 20, totalHeld: 20 })];
    const out = reconcileAttendanceWithDetail(rows, od([entry({ slot: 'A1', dates: sessions(21, 3) })]));
    // The "A1" detail is the "A1+TA1" row's own record, not a second component.
    expect(out).toHaveLength(1);
  });

  it("adds a component the summary omitted even when the detail shortens its slot", () => {
    const rows = [row({ courseCode: 'BAEEE202', slot: 'L29+L30', category: 'Lab', courseType: 'Embedded Lab', attended: 18, totalHeld: 18 })];
    const lab = entry({ courseCode: 'BAEEE202', slot: 'L29', dates: sessions(9, 0, '14:00-15:40') });
    const theory = entry({ courseCode: 'BAEEE202', courseName: 'Analog Electronics', slot: 'A1', dates: sessions(27, 1) });

    const out = reconcileAttendanceWithDetail(rows, od([lab, theory]));
    expect(out).toHaveLength(2);
    // The lab row is joined by "L29" (span 2 periods) and kept at VTOP's 18.
    expect(out[0]).toMatchObject({ slot: 'L29+L30', attended: 18, totalHeld: 18 });
    // The theory half the summary never listed is added from its dated rows.
    expect(out[1]).toMatchObject({ courseCode: 'BAEEE202', slot: 'A1', courseType: 'ETH', attended: 27, totalHeld: 28 });
  });

  // A cache written before the gateway captured dates still carries the detail's
  // own tallies. Those are used rather than reporting the summary as fresh.
  it("falls back to the detail's own tallies when no dated rows were stored", () => {
    const rows = [row({ slot: 'A1+TA1', attended: 20, totalHeld: 20 })];
    const out = reconcileAttendanceWithDetail(
      rows,
      od([entry({ slot: 'A1', dates: [], present: 21, absent: 3, total: 24 })]),
    );
    expect(out[0]).toMatchObject({ attended: 21, totalHeld: 24 });
  });

  it('never halves a two-period lab from a dates-less cache', () => {
    const rows = [row({ courseCode: 'CSE2001L', slot: 'L31+L32', category: 'Lab', courseType: 'ELA', attended: 18, totalHeld: 18 })];
    // 9 sessions, 8 attended — the detail's own session tally, half the periods.
    const out = reconcileAttendanceWithDetail(
      rows,
      od([entry({ courseCode: 'CSE2001L', slot: 'L31', dates: [], present: 8, total: 9 })]),
    );
    expect(out[0]).toMatchObject({ attended: 18, totalHeld: 18 });
  });

  it('does not mutate the rows it was given', () => {
    const rows = [row({ attended: 20, totalHeld: 20 })];
    reconcileAttendanceWithDetail(rows, od([entry({ dates: sessions(21, 3) })]));
    expect(rows[0]).toMatchObject({ attended: 20, totalHeld: 20 });
  });
});
