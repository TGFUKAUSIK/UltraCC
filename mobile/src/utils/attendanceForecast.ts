/**
 * attendanceForecast.ts — the arithmetic behind "can I skip this class?".
 *
 * VTOP reports `attended` out of `totalHeld` per component. A future class that
 * is attended adds 1 to both; one that is skipped adds 1 to the total only. Both
 * questions a student asks follow from that:
 *
 *   - how many classes can I still miss and stay at or above the threshold?
 *       attended / (held + k) >= t   →   k <= attended / t - held
 *   - how many must I attend to get back to the threshold?
 *       (attended + n) / (held + n) >= t  →  n >= (t·held - attended) / (1 - t)
 *
 * `ceil` / `floor` are taken against the safe side of each inequality, and every
 * result is clamped at zero, so the screen never tells a student to "attend -3
 * classes". No VTOP record is mutated and nothing is invented: a course with no
 * classes held yet has no forecast.
 */

/** VIT's mandatory attendance threshold, as a percentage. */
export const ATTENDANCE_THRESHOLD = 75;

export interface AttendanceForecast {
  attended: number;
  totalHeld: number;
  /** 0..100, or null when nothing has been held yet. */
  percentage: number | null;
  /** True when `percentage` already meets `threshold`. */
  meetsThreshold: boolean;
  /** Classes that can still be skipped while staying at or above the threshold. */
  canSkip: number;
  /** Consecutive classes that must be attended to reach the threshold. */
  neededToReach: number;
  /** Threshold these numbers were computed against. */
  threshold: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Forecast for one component (a theory row or a lab row), which is how VTOP
 * itself reports attendance — mixing the two would hide a failing lab behind a
 * healthy theory record.
 */
export function forecastAttendance(
  attended: number,
  totalHeld: number,
  threshold: number = ATTENDANCE_THRESHOLD,
): AttendanceForecast {
  const held = Math.max(0, Math.floor(totalHeld) || 0);
  const present = Math.max(0, Math.min(Math.floor(attended) || 0, held));
  const t = Math.min(Math.max(threshold, 0), 100) / 100;

  const percentage = held > 0 ? round1((present / held) * 100) : null;
  const base: AttendanceForecast = {
    attended: present,
    totalHeld: held,
    percentage,
    meetsThreshold: percentage !== null && percentage / 100 >= t - 1e-9,
    canSkip: 0,
    neededToReach: 0,
    threshold,
  };
  if (held === 0) return base;

  // At (or above) the threshold: how many extra absences still keep it.
  // Above a 0% threshold every class is skippable, which is not a useful
  // answer, so the shortfall branch is left at zero.
  let canSkip = 0;
  if (t > 0) canSkip = Math.floor(present / t - held + 1e-9);

  let neededToReach = 0;
  if (present / held < t - 1e-9) {
    neededToReach = t >= 1 ? Infinity : Math.ceil((t * held - present) / (1 - t) - 1e-9);
  }

  return {
    ...base,
    canSkip: Math.max(0, Number.isFinite(canSkip) ? canSkip : 0),
    neededToReach: Math.max(0, Number.isFinite(neededToReach) ? neededToReach : 0),
  };
}

/**
 * The same forecast across every component of one course, so a list row can
 * show a course-level number next to the theory/lab split.
 */
export function forecastCourse(
  rows: { attended: number; totalHeld: number }[],
  threshold: number = ATTENDANCE_THRESHOLD,
): AttendanceForecast {
  const attended = rows.reduce((sum, row) => sum + (Math.max(0, Math.floor(row.attended) || 0)), 0);
  const totalHeld = rows.reduce((sum, row) => sum + (Math.max(0, Math.floor(row.totalHeld) || 0)), 0);
  return forecastAttendance(attended, totalHeld, threshold);
}

/**
 * "Attend 6 more classes, or skip none" — the one line a student reads. Never a
 * range, never a guess: it states the number that came out of the two formulas.
 */
export function forecastSentence(forecast: AttendanceForecast): string {
  if (forecast.totalHeld === 0) return 'No classes held yet.';
  if (!forecast.meetsThreshold) {
    return `Attend the next ${forecast.neededToReach} ${forecast.neededToReach === 1 ? 'class' : 'classes'} to reach ${forecast.threshold}%.`;
  }
  if (forecast.canSkip === 0) return `At exactly ${forecast.threshold}% — skip nothing from here.`;
  return `You can skip ${forecast.canSkip} more ${forecast.canSkip === 1 ? 'class' : 'classes'} and stay at or above ${forecast.threshold}%.`;
}
