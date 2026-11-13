import { AttendanceRecord } from '../types';
import { VTOP_ATTENDANCE_FLOOR, attendancePercentLabel } from './attendanceBands';
import { periodsPerClass } from './labSessions';

/**
 * The safe-bunk calculator every attendance surface quotes from: the Academics
 * detail rows, the at-risk list and per-course intel all call this one
 * function, so the same course cannot show two different bunk limits on two
 * screens.
 *
 * The file used to carry a second "what should I do right now" engine too. It
 * re-derived the running class from its own copy of the timetable clock rules
 * and no screen ever rendered it — the dashboard already answers that question
 * from the tested timetableGrid helpers. Only the shared maths stays here.
 */

export type BunkState = 'debar-risk' | 'below-target' | 'on-target';

export interface BunkStatsOptions {
  /**
   * Return the raw VTOP period budget. Only whole-semester aggregates need
   * this: they blend theory rows and lab rows, and there is no single class
   * span to convert with — a lab class costs two periods, a theory class one.
   * A single VTOP row always has a span and is reported in the unit a student
   * acts in (`class` or `lab session`).
   */
  periods?: boolean;
}

/**
 * What `canBunk` and `mustAttend` count. A lab is one class to a student but
 * two periods to VTOP, and printing the period number as a class count
 * promised twice the skips a lab course actually has.
 */
export type BunkUnit = 'class' | 'lab session' | 'period';

export interface BunkStats {
  state: BunkState;
  status: string;
  canBunk: number;
  mustAttend: number;
  message: string;
  safeToBunk: boolean;
  unit: BunkUnit;
}

/**
 * Which of the three situations a record is in. Machine-readable, because the
 * display wording below is prose a student reads and callers must not have to
 * string-match it to decide a colour.
 *
 * `debar-risk` is VTOP's own line; `below-target` is the student's. They used to
 * share one heading, "Debarred Risk", which told a student sitting at 78% with
 * an 85% bar that they were about to be debared — a warning nobody had earned,
 * and the kind of lie that makes a student stop trusting the numbers on screen.
 */
export function calculateBunkStats(
  attendanceRecord: AttendanceRecord,
  targetPct: number = VTOP_ATTENDANCE_FLOOR,
  options: BunkStatsOptions = {},
): BunkStats {
  const { attended, totalHeld } = attendanceRecord;
  const currentPct = totalHeld > 0 ? (attended / totalHeld) * 100 : 100;
  // VTOP counts periods; `canBunk` and `mustAttend` answer in classes. A lab
  // session is two periods, so six spare periods are three lab sessions, not
  // six — the old arithmetic printed the period budget as a class count.
  const span = options.periods ? 1 : periodsPerClass({ slot: attendanceRecord.slot, courseType: attendanceRecord.type });
  const unit: BunkUnit = options.periods ? 'period' : span > 1 ? 'lab session' : 'class';
  const plural = (count: number) => {
    if (count === 1) return unit;
    return unit === 'class' ? 'classes' : `${unit}s`;
  };
  // An aggregate has no single class span, so its message counts periods and
  // has to say what a period is worth in the one case that differs.
  const periodNote = options.periods ? ' A lab session counts as two.' : '';

  if (currentPct < targetPct) {
    // How many consecutive classes MUST be attended to reach targetPct?
    // (attended + x) / (totalHeld + x) = targetPct / 100
    // 100*(attended + x) = targetPct*(totalHeld + x)
    // 100*attended + 100*x = targetPct*totalHeld + targetPct*x
    // (100 - targetPct)*x = targetPct*totalHeld - 100*attended
    const requiredPeriods = Math.ceil((targetPct * totalHeld - 100 * attended) / (100 - targetPct));
    // Attending whole classes; a lab session supplies both of its periods at
    // once, so a fractional need still costs one whole session.
    const required = Math.ceil(requiredPeriods / span);
    const debarred = currentPct < VTOP_ATTENDANCE_FLOOR;
    return {
      state: debarred ? 'debar-risk' : 'below-target',
      status: debarred ? 'Debarred risk' : 'Below your target',
      canBunk: 0,
      mustAttend: Math.max(0, required),
      message: `Attend the next ${required} ${plural(required)} in a row to get back to ${targetPct}%.${periodNote}`,
      safeToBunk: false,
      unit,
    };
  } else {
    // How many classes can be safely skipped while staying >= targetPct?
    // attended / (totalHeld + x) >= targetPct / 100
    // 100 * attended >= targetPct * totalHeld + targetPct * x
    // targetPct * x <= 100 * attended - targetPct * totalHeld
    const maxBunkPeriods = Math.floor((100 * attended - targetPct * totalHeld) / targetPct);
    // Skip whole classes. A lab session burns two periods, so one spare period
    // is not a spare lab — `safeToBunk` follows the class count, not the
    // period count.
    const maxBunk = Math.floor(maxBunkPeriods / span);
    return {
      state: 'on-target' as BunkState,
      status: 'On target',
      canBunk: Math.max(0, maxBunk),
      mustAttend: 0,
      message: maxBunk > 0
        ? `You can miss ${maxBunk} more ${plural(maxBunk)} and stay above ${targetPct}%.${periodNote}`
        : `You are at ${attendancePercentLabel(currentPct)}% — one absence drops you below ${targetPct}%.${periodNote}`,
      safeToBunk: maxBunk > 0,
      unit,
    };
  }
}
