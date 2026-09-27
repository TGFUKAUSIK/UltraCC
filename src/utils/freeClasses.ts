/**
 * Free Classes analysis — per-day free-period detection for the Chennai FFCS
 * grid. A "free class" is a standard FFCS period on that weekday that has no
 * class scheduled. Period timings are the public VIT Chennai FFCS facts
 * (theory grid, 08:00–19:25, lunch 13:25–14:00).
 */

export interface FreeClassPeriod {
  slot: string;
  start: string;
  end: string;
  /** true when a synced class occupies this period. */
  covered: boolean;
}

export interface FreeClassSummary {
  day: string;
  /** Total standard periods on that weekday. */
  totalPeriods: number;
  /** Periods with no class scheduled. */
  freeCount: number;
  /** Total free minutes across gaps between classes (>=40 min gaps). */
  freeMinutes: number;
  periods: FreeClassPeriod[];
}

/** Standard Chennai theory-period grid per weekday (public scheduling facts). */
const DAY_GRID: Record<string, { slot: string; start: string; end: string }[]> = {
  Monday: [
    { slot: 'A1', start: '08:00', end: '08:50' },
    { slot: 'F1', start: '08:55', end: '09:45' },
    { slot: 'D1', start: '09:50', end: '10:40' },
    { slot: 'TB1', start: '10:45', end: '11:35' },
    { slot: 'TG1', start: '11:40', end: '12:30' },
    { slot: 'S11', start: '12:35', end: '13:25' },
    { slot: 'A2', start: '14:00', end: '14:50' },
    { slot: 'F2', start: '14:55', end: '15:45' },
    { slot: 'D2', start: '15:50', end: '16:40' },
    { slot: 'TB2', start: '16:45', end: '17:35' },
    { slot: 'TG2', start: '17:40', end: '18:30' },
    { slot: 'S3', start: '18:35', end: '19:25' },
  ],
  Tuesday: [
    { slot: 'B1', start: '08:00', end: '08:50' },
    { slot: 'G1', start: '08:55', end: '09:45' },
    { slot: 'E1', start: '09:50', end: '10:40' },
    { slot: 'TC1', start: '10:45', end: '11:35' },
    { slot: 'TAA1', start: '11:40', end: '12:30' },
    { slot: 'L12', start: '12:35', end: '13:25' },
    { slot: 'B2', start: '14:00', end: '14:50' },
    { slot: 'G2', start: '14:55', end: '15:45' },
    { slot: 'E2', start: '15:50', end: '16:40' },
    { slot: 'TC2', start: '16:45', end: '17:35' },
    { slot: 'TAA2', start: '17:40', end: '18:30' },
    { slot: 'S1', start: '18:35', end: '19:25' },
  ],
  Wednesday: [
    { slot: 'C1', start: '08:00', end: '08:50' },
    { slot: 'A1', start: '08:55', end: '09:45' },
    { slot: 'F1', start: '09:50', end: '10:40' },
    { slot: 'TD1', start: '10:45', end: '11:35' },
    { slot: 'TBB1', start: '11:40', end: '12:30' },
    { slot: 'L18', start: '12:35', end: '13:25' },
    { slot: 'C2', start: '14:00', end: '14:50' },
    { slot: 'A2', start: '14:55', end: '15:45' },
    { slot: 'F2', start: '15:50', end: '16:40' },
    { slot: 'TD2', start: '16:45', end: '17:35' },
    { slot: 'TBB2', start: '17:40', end: '18:30' },
    { slot: 'S4', start: '18:35', end: '19:25' },
  ],
  Thursday: [
    { slot: 'D1', start: '08:00', end: '08:50' },
    { slot: 'B1', start: '08:55', end: '09:45' },
    { slot: 'G1', start: '09:50', end: '10:40' },
    { slot: 'TE1', start: '10:45', end: '11:35' },
    { slot: 'TCC1', start: '11:40', end: '12:30' },
    { slot: 'L24', start: '12:35', end: '13:25' },
    { slot: 'D2', start: '14:00', end: '14:50' },
    { slot: 'B2', start: '14:55', end: '15:45' },
    { slot: 'G2', start: '15:50', end: '16:40' },
    { slot: 'TE2', start: '16:45', end: '17:35' },
    { slot: 'TCC2', start: '17:40', end: '18:30' },
    { slot: 'S2', start: '18:35', end: '19:25' },
  ],
  Friday: [
    { slot: 'E1', start: '08:00', end: '08:50' },
    { slot: 'C1', start: '08:55', end: '09:45' },
    { slot: 'TA1', start: '09:50', end: '10:40' },
    { slot: 'TF1', start: '10:45', end: '11:35' },
    { slot: 'TDD1', start: '11:40', end: '12:30' },
    { slot: 'S15', start: '12:35', end: '13:25' },
    { slot: 'E2', start: '14:00', end: '14:50' },
    { slot: 'C2', start: '14:55', end: '15:45' },
    { slot: 'TA2', start: '15:50', end: '16:40' },
    { slot: 'TF2', start: '16:45', end: '17:35' },
    { slot: 'TDD2', start: '17:40', end: '18:30' },
  ],
  Saturday: [
    { slot: 'X11', start: '08:00', end: '08:50' },
    { slot: 'X12', start: '08:55', end: '09:45' },
    { slot: 'Y11', start: '09:50', end: '10:40' },
    { slot: 'Y12', start: '10:45', end: '11:35' },
    { slot: 'S8', start: '11:40', end: '12:30' },
    { slot: 'S8B', start: '12:35', end: '13:25' },
    { slot: 'X21', start: '14:00', end: '14:50' },
    { slot: 'Z21', start: '14:55', end: '15:45' },
    { slot: 'Y21', start: '15:50', end: '16:40' },
    { slot: 'W21', start: '16:45', end: '17:35' },
    { slot: 'W22', start: '17:40', end: '18:30' },
    { slot: 'Z22', start: '18:35', end: '19:25' },
  ],
};

function toMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export interface TimetableLike {
  day: string;
  startTime: string;
  endTime: string;
}

/**
 * Compute the free-class summary for a weekday. A period counts as covered
 * when a class starts within ±12 minutes of the period start (handles labs
 * and slot-map drift). Free minutes = total length of >=40-minute gaps
 * between consecutive classes.
 */
export function computeFreeClasses(day: string, classes: TimetableLike[]): FreeClassSummary {
  const grid = DAY_GRID[day] || [];
  const classStarts = classes
    .filter((c) => c.startTime)
    .map((c) => toMinutes(c.startTime));

  const periods = grid.map((p) => {
    const covered = classStarts.some((cs) => Math.abs(cs - toMinutes(p.start)) <= 12);
    return { ...p, covered };
  });

  // Gaps between consecutive classes (>=40 min counts as free time).
  const sorted = classes
    .filter((c) => c.startTime && c.endTime)
    .map((c) => ({ s: toMinutes(c.startTime), e: toMinutes(c.endTime) }))
    .sort((a, b) => a.s - b.s);
  let freeMinutes = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].s - sorted[i].e;
    if (gap >= 40) freeMinutes += gap;
  }

  return {
    day,
    totalPeriods: periods.length,
    freeCount: periods.filter((p) => !p.covered).length,
    freeMinutes,
    periods,
  };
}
