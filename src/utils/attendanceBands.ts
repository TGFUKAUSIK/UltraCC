/**
 * The attendance bands a student sees inside the app, and what each one is
 * worth saying out loud.
 *
 * The rule itself is two lines: VTOP withholds attendance credit below 75%,
 * and the student's own target decides what counts as safe. That is not in
 * dispute. What used to be invisible is the rule itself — the Academics summary
 * cards printed "Safe 4 · Warning 1 · At Risk 2" with no line named, so the
 * numbers could only be trusted, not checked. Worse, the middle card counts the
 * courses VTOP has not posted a percentage for, so at the default 75% bar a
 * "Warning" could mean "short of target" and "no data yet" at the same time —
 * and at 75% it can only mean the second one.
 *
 * Each band therefore ships the sentence that describes how it is counted,
 * generated from the same thresholds the counting uses. Move the slider and the
 * cards say what they now mean; leave it at 75% and the middle card says what it
 * is actually holding.
 *
 * The exported PNG/PDF use a different pair of lines on purpose (see
 * `attendanceColour.ts`): a shared file cannot know the recipient's bar, so it
 * quotes VTOP's own. Inside the app the student's bar is the authority.
 */

/** VTOP's own requirement, below which attendance credit is withheld. */
export const VTOP_ATTENDANCE_FLOOR = 75;

/**
 * An attendance percentage that had to be added up before it could be divided,
 * written in tenths of a percent — truncated, never rounded up.
 *
 * VTOP's own number is always the authority; this runs only where the app has to
 * produce a percentage itself: a course whose lab is two VTOP rows, a theory and
 * lab total, and the attendance page when VTOP sends the counts but no usable
 * percentage cell. All three used to round — which put 2/3 on record as 66.7
 * while VTOP's own cell for the same course read 66.66, so the stored figure, the
 * card and the debar filter all quoted a number VTOP never wrote. Truncating to
 * the tenth is the same rule `attendancePercentLabel` prints with, so a value and
 * its label round-trip to one figure and an aggregate cannot climb onto a line it
 * has not actually reached: 74.96% is not 75%.
 *
 * Returns null when there is nothing to divide. No classes held is not 0% and it
 * is not 100% either — it is unmeasurable, and the surfaces say so.
 */
export function attendancePercentFromCounts(attended: number, conducted: number): number | null {
  if (!Number.isFinite(attended) || !Number.isFinite(conducted) || conducted <= 0) return null;
  return Math.floor((attended / conducted) * 1000 + 1e-6) / 10;
}

/**
 * An attendance figure as the student reads it: VTOP's own number at one
 * decimal, with no ".0" on a round one.
 *
 * The same figure used to be re-shaped at every print site — `83.33%` verbatim
 * in a course row, `83.3%` on the summary card, `83%` in the dashboard meter and
 * in both exported reports — so one course was three numbers depending on which
 * screen a student was looking at, and the one they sent to a friend was the
 * roughest of them.
 *
 * It truncates rather than rounds, on purpose: 74.96% is short of VTOP's line,
 * and a label that rounds it to "75%" would print a number that contradicts the
 * red it sits in.
 */
export function attendancePercentLabel(percentage: number): string {
  const floored = Math.floor(percentage * 10 + 1e-6) / 10;
  return Number.isInteger(floored) ? `${floored}` : floored.toFixed(1);
}

export type AttendanceTone = 'safe' | 'warning' | 'critical' | 'unknown';

/**
 * Which band a percentage falls in. `null` means VTOP has held no class for
 * that component yet: an unknown is never painted as a verdict.
 */
export function attendanceTone(percentage: number | null, target: number): AttendanceTone {
  if (percentage === null) return 'unknown';
  if (percentage >= target) return 'safe';
  return percentage >= VTOP_ATTENDANCE_FLOOR ? 'warning' : 'critical';
}

/** A summary card: the word on it, and the line beneath that earns the count. */
export interface AttendanceBandCopy {
  tone: Exclude<AttendanceTone, 'unknown'>;
  label: string;
  rule: string;
}

/**
 * The three summary cards, in the order they render. `target` is the student's
 * own bar, so the copy moves with the slider instead of describing a threshold
 * nobody chose.
 */
export function attendanceBandCopy(target: number): AttendanceBandCopy[] {
  const gap = target - VTOP_ATTENDANCE_FLOOR;
  return [
    {
      tone: 'safe',
      label: 'Safe',
      rule: `at or above your ${target}%`,
    },
    {
      tone: 'warning',
      label: 'Warning',
      // With the bar on VTOP's line there is no room between the two, so the
      // only thing this card can be holding is a course with no percentage yet.
      // The sentences stay short: three of these cards share one row on a phone.
      rule: gap > 0
        ? `${VTOP_ATTENDANCE_FLOOR}–${target - 1}% · or nothing recorded`
        : 'nothing recorded by VTOP yet',
    },
    {
      tone: 'critical',
      label: 'At Risk',
      rule: `under VTOP’s ${VTOP_ATTENDANCE_FLOOR}% line`,
    },
  ];
}

/**
 * How far under VTOP's line a component has to fall before an alert stops being
 * a nudge and becomes something to act on today.
 *
 * This number used to live inside the notification engine as a bare `percentage
 * < 70`, which meant two things nobody could check: the step between "warning"
 * and "critical" had no relationship to any line the student can see, and a
 * second surface could not raise an alert at the same loudness without copying
 * the magic number by hand.
 */
export const ATTENDANCE_ALERT_CRITICAL_MARGIN = 5;

/**
 * Urgency for an attendance alert, from the same floor the cards name. Every
 * component this fires for is already under VTOP's line — the callers filter on
 * that first — so the only question left is how far below it they are.
 */
export function attendanceAlertUrgency(percentage: number): 'critical' | 'warning' {
  return percentage < VTOP_ATTENDANCE_FLOOR - ATTENDANCE_ALERT_CRITICAL_MARGIN ? 'critical' : 'warning';
}
