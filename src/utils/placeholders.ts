/**
 * One answer to "did VTOP actually put something here?".
 *
 * VTOP fills a field it has no value for with a stub: a bare "-", an em dash,
 * "R -" for a room it could not read, "Seat -", the word "None", or the literal
 * string "SELECT" — which is the School of Electrical Engineering's acronym, not
 * a value a student's own record should print (the display layer spells the
 * acronym out before asking this). Shown verbatim, any of them reads as a real
 * fact on a screen a student trusts, so every view asks this one helper instead
 * of carrying its own private list.
 */

/**
 * The strings VTOP uses to mean "nothing". A real value always carries a letter
 * or a digit, so this list only has to catch whole-field sentinels; the bare
 * letter forms ("R", "Seat") are caught by the trailing-dash rule below.
 */
const NOT_DATA = new Set([
  '—', '–', '--', '-', 'n/a', 'na', 'nil', 'none', 'null', 'tba', 'not available', 'select',
]);

/**
 * True when a field holds something worth printing. The value must carry a
 * letter or a digit, must not trail off in punctuation, and must not be one of
 * VTOP's words for "nothing".
 */
export function isReal(value: unknown): value is string {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!/[A-Za-z0-9]/.test(text)) return false;
  if (/[-–—]\s*$/.test(text)) return false;
  return !NOT_DATA.has(text.toLowerCase());
}

/**
 * The one readable location for a class. VTOP's venue usually carries the room
 * number already ("SJT 402"), so the derived room is joined only when the venue
 * does not contain it — otherwise a row would read "R - 401 · 401". A stub venue
 * or room is dropped, and the two are joined only when both are real.
 */
export function placeOf(venue: unknown, roomNo: unknown): string {
  const where = isReal(venue) ? String(venue).trim() : '';
  const room = isReal(roomNo) ? String(roomNo).trim() : '';
  if (where && room && !where.includes(room)) return `${where} · ${room}`;
  return where || room;
}
