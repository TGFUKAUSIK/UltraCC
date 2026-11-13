/**
 * The one colour rule for exported attendance artefacts.
 *
 * A PNG or a PDF leaves this app and lands in a group chat, where nobody can
 * ask it what a red number means. The share card used to answer with colour
 * alone — a scale of 75 and 85 that appears nowhere else in the product — while
 * every screen inside the app measures attendance against the student's own bar
 * from the Academics slider. Both readers of the same export got a different
 * story from the same percentage, and neither was told which bar was used.
 *
 * These artefacts stay on VTOP's own requirement (75%) plus the 85% band above
 * it, because a personal target is meaningless to whoever receives the file.
 * What they now also carry is the legend, so the colour is a claim the reader
 * can check instead of a mood.
 */

/** Below `debar` VTOP withholds attendance credit; `comfortable` is the band above it. */
export const ATTENDANCE_BANDS = { debar: 75, comfortable: 85 } as const;

export type AttendanceBand = 'risk' | 'warn' | 'ok';

/** Which band a percentage falls in — the single place the thresholds live. */
export function attendanceBand(percentage: number): AttendanceBand {
  if (percentage < ATTENDANCE_BANDS.debar) return 'risk';
  if (percentage < ATTENDANCE_BANDS.comfortable) return 'warn';
  return 'ok';
}

const BAND_HEX: Record<AttendanceBand, string> = {
  risk: '#b91c1c',
  warn: '#b45309',
  ok: '#15803d',
};

/** The colours, exported so a print stylesheet cannot pick its own set. */
export const ATTENDANCE_BAND_COLORS = BAND_HEX;

/** The canvas fill for a percentage. */
export function attendanceBandColor(percentage: number): string {
  return BAND_HEX[attendanceBand(percentage)];
}

/** The CSS class for a percentage, for the print/PDF window. */
export function attendanceBandClass(percentage: number): AttendanceBand {
  return attendanceBand(percentage);
}

/**
 * The three print rules, generated from the same table the PNG fills with. A
 * stylesheet written by hand next to a shared rule is how two artefacts start
 * meaning two different things by the same red.
 */
export function attendanceBandCssRules(): string {
  return [
    `.risk { color: ${BAND_HEX.risk}; font-weight: 700; }`,
    `.warn { color: ${BAND_HEX.warn}; font-weight: 600; }`,
    `.ok { color: ${BAND_HEX.ok}; }`,
  ].join('\n  ');
}

/**
 * The sentence that makes the colour readable by itself. One function, because
 * a PNG legend and a PDF legend that disagree would be the same defect the
 * bands were.
 */
export function attendanceColourKey(): string {
  const { debar, comfortable } = ATTENDANCE_BANDS;
  return `Colour key: red below ${debar}% (VTOP’s minimum attendance) · amber ${debar}-${comfortable - 1}% · green ${comfortable}% and above`;
}
