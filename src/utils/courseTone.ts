/**
 * courseTone.ts — the one course colour.
 *
 * A student scanning a timetable, an attendance list, a marks table and a
 * deadline feed is looking at the same courses in all four. If CSE2001 is teal
 * on one screen and amber on the next, the colour stops being a shortcut and
 * becomes noise, so the mapping lives here and every surface asks this module.
 *
 * The six hues are a single set: mid-tone, similar lightness, none of them the
 * accent. The accent is reserved for the live row, so a course must never take
 * it — otherwise "what is happening now" and "which course is this" would be
 * drawn in the same colour.
 *
 * The value is derived from the code, not from position, so a course keeps its
 * colour when a filter reorders the list or a semester adds a row above it.
 */

export const COURSE_TONES = ['blue', 'teal', 'violet', 'amber', 'rose', 'slate'] as const;

export type CourseTone = (typeof COURSE_TONES)[number];

/** Stable, order-independent colour for a course code. */
export function courseTone(code: string): CourseTone {
  if (!code) return 'slate';
  let sum = 0;
  for (let i = 0; i < code.length; i += 1) sum += code.charCodeAt(i);
  return COURSE_TONES[sum % COURSE_TONES.length];
}
