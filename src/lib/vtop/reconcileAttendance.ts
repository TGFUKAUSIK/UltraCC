/**
 * reconcileAttendance.ts — one attendance figure per course, from VTOP's own
 * rawest record.
 *
 * VTOP answers attendance twice for the same semester, and the two answers can
 * disagree. The summary page (`processViewStudentAttendance`) is an aggregate
 * VTOP recomputes on its own schedule; the per-class detail
 * (`processViewAttendanceDetail`) is the live record of every class actually
 * held, with the date and the clock each one ran. On 2026-10-12 the aggregate
 * still read 99.4% while the class-by-class list on the SAME screen — fed by the
 * detail — already showed that day's classes and the absence in them, so a
 * student looking at one screen saw a headline that contradicted the list under
 * it.
 *
 * This reconciles the two. Where the detail accounts for MORE class time than
 * the summary counted, the summary's own identity (course, title, slot, type,
 * faculty) is kept and its counts are taken from the detail; where the detail
 * covers a class the summary carried no row for at all, that class is added from
 * the detail's own figures. Class time the detail does not cover — a course VTOP
 * lists only in the summary — is returned exactly as VTOP published it. Nothing
 * is ever reduced and no class is ever invented: every count here comes from a
 * date and a status VTOP itself printed.
 *
 * Matching a summary row to its detail is the whole game, and VTOP spells the
 * same slot two ways: the summary's Slot COLUMN reads "A1+TA1" while the row's
 * own View link — the handle the gateway follows — carries "A1", and a lab's
 * column may read "L31+L32" against a link of "L31". On 2026-10-12 the first cut
 * of this module compared the two slots for an exact set match, so neither the
 * summary row nor the detail ever found each other: the headline stayed at the
 * stale 99.4% while the list beneath it, which joins on course code alone,
 * showed the absence. The join is therefore by base course code, and a row meets
 * its detail when the two share a slot token (so "A1+TA1" finds "A1", and
 * "L31+L32" finds "L31"); a row and a detail that share no token are different
 * classes. The class-by-class list on the same screen joins by course code alone
 * and is the reason a stale headline was visible under a correct list.
 *
 * Units: the summary counts 50-minute PERIODS, the detail lists SESSIONS, and a
 * two-period lab is one session but two periods. Held class time is therefore
 * the sum of each session's clock span — the rule the gateway already applies
 * when it tallies OD hours. That parser cannot be imported from here (the
 * gateway is a Deno function deployed on its own), so the span rule is repeated;
 * `reconcileAttendance.test.ts` pins this copy to the clock strings VTOP serves
 * so the two cannot drift apart without a red test.
 */

import type { AttendanceDateRow, AttendanceRecord, OdEntry, OdSummary } from './types';
import { baseCourseCode } from '../../utils/attendanceComponents';
import { attendancePercentFromCounts } from '../../utils/attendanceBands';

/** Slot keys are compared ignoring case, spaces and separators — VTOP's own
 *  slot text ("L55+L56") is the identity here, never a re-derived one. */
function slotKey(slot: string | undefined): string {
  return (slot || '').toUpperCase().replace(/[^A-Z0-9+]/g, '');
}

/** The slot's tokens as a set, so "L55+L56" and "L56+L55" are the same class. */
function slotTokenKey(slot: string | undefined): string {
  return slotKey(slot)
    .split('+')
    .filter(Boolean)
    .sort()
    .join('+');
}

/** The slot's individual tokens, for the overlap join. */
function slotTokens(slot: string | undefined): string[] {
  return slotTokenKey(slot).split('+').filter(Boolean);
}

/**
 * How many ~50-minute class periods a "Day And Timing" cell spans. A cell with
 * no readable clock is one period — the conservative reading, which keeps a
 * lab's own detail from ever halving a summary count it cannot corroborate.
 */
function periodsFromTiming(timing: string): number {
  const tokens = timing.match(/\d{1,2}:\d{2}\s*(?:AM|PM)?/gi);
  if (!tokens || tokens.length < 2) return 1;
  const toMinutes = (token: string): number | null => {
    const m = token.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    else if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  };
  const start = toMinutes(tokens[0]);
  const end = toMinutes(tokens[tokens.length - 1]);
  if (start == null || end == null) return 1;
  let dur = end - start;
  if (dur < 0) dur += 12 * 60; // 11:00-01:40 PM crosses noon without PM on the end
  return dur <= 0 ? 1 : Math.max(1, Math.round(dur / 50));
}

/** Which of VTOP's three per-class words a status cell holds. */
function isAttended(status: string | undefined): boolean {
  const s = (status || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return s === 'present' || s === 'on duty' || s === 'onduty' || s === 'od';
}

/** Periods held, and periods the student earned, across VTOP's dated rows. */
function periodsFromDates(dates: AttendanceDateRow[]): { held: number; attended: number } {
  let held = 0;
  let attended = 0;
  for (const row of dates) {
    const span = periodsFromTiming(row.timing || '');
    held += span;
    if (isAttended(row.status)) attended += span;
  }
  return { held, attended };
}

/**
 * The class time one detail entry accounts for.
 *
 * The dated rows are VTOP's live record and are preferred. A cache written
 * before the gateway captured them still carries the detail's OWN tallies, so
 * those stand in — the count of classes it listed and the present + on-duty rows
 * — rather than reporting the summary as fresh when it is not. The tallies are
 * counted in the detail's own unit (sessions), which is why the up-only guard
 * below matters: a two-period lab's session tally is half its period count, and
 * that half is not allowed to shrink a summary figure.
 */
function periodsForEntry(entry: OdEntry): { held: number; attended: number } {
  if (Array.isArray(entry.dates) && entry.dates.length > 0) {
    return periodsFromDates(entry.dates);
  }
  const held = Number(entry.total) || 0;
  const attended = (Number(entry.present) || 0) + (Number(entry.onDutyCount) || 0);
  return { held, attended: Math.max(0, Math.min(attended, held)) };
}

function push(map: Map<string, OdEntry[]>, key: string, entry: OdEntry): void {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

/**
 * The detail entries that belong to one summary row: the exact slot first (so
 * "L31+L32" never steals the "L31" row's detail), and failing that any entry
 * sharing a slot token — VTOP's own shortening of the slot, "A1+TA1" → "A1".
 */
function entriesForRow(rowSlot: string | undefined, candidates: OdEntry[]): OdEntry[] {
  const want = slotTokenKey(rowSlot);
  if (!want) return [];
  const exact = candidates.filter((e) => slotTokenKey(e.slot) === want);
  if (exact.length) return exact;
  const tokens = new Set(want.split('+').filter(Boolean));
  return candidates.filter((e) => slotTokens(e.slot).some((t) => tokens.has(t)));
}

/**
 * The summary rows VTOP served, with each row's counts brought up to the
 * per-class detail where the detail accounts for more.
 *
 * A row is only ever moved UPWARD and only to a figure the detail's own record
 * adds up to, so a summary that is already current (or ahead) is returned
 * untouched, and an old cache with no per-class rows is a no-op.
 */
export function reconcileAttendanceWithDetail(
  rows: AttendanceRecord[],
  od: OdSummary | null | undefined,
): AttendanceRecord[] {
  if (!rows?.length || !od?.available || !od.perCourse?.length) return rows;

  const byBase = new Map<string, OdEntry[]>();
  for (const entry of od.perCourse) {
    const base = baseCourseCode(entry.courseCode);
    if (!base) continue;
    push(byBase, base, entry);
  }

  const matched = new Set<OdEntry>();
  const reconciled = rows.map((row) => {
    const base = baseCourseCode(row.courseCode);
    const candidates = byBase.get(base);
    if (!candidates?.length) return row;
    const entries = entriesForRow(row.slot, candidates);
    if (!entries.length) return row;

    let held = 0;
    let attended = 0;
    for (const entry of entries) {
      matched.add(entry);
      const detail = periodsForEntry(entry);
      held += detail.held;
      attended += detail.attended;
    }
    // No usable figures to corroborate the summary — leave VTOP's own alone.
    if (held === 0) return row;
    const ahead = held > row.totalHeld || attended > row.attended;
    if (!ahead || held < row.totalHeld || attended < row.attended) return row;

    return {
      ...row,
      attended,
      totalHeld: held,
      percentage: attendancePercentFromCounts(attended, held) ?? row.percentage,
    };
  });

  // A class the summary listed no row for at all — VTOP published it only in the
  // detail. It is a real component of a course, so it is added from the detail's
  // own dated rows rather than dropped from the total the student is judged on.
  //
  // A class whose slot shares a token with one the summary did carry is NOT
  // added: that is the same class under a differently-spelled slot ("A1+TA1"
  // against a summary's "A1"), and adding it would count the same periods twice.
  // A summary row with no readable slot covers its whole course the same way —
  // nothing can be proven to be a second component, so nothing is added.
  const summaryTokens = new Map<string, Set<string>>();
  const coveredWholeBase = new Set<string>();
  for (const row of rows) {
    const base = baseCourseCode(row.courseCode);
    if (!base) continue;
    const tokens = slotTokens(row.slot);
    if (!tokens.length) {
      coveredWholeBase.add(base);
      continue;
    }
    const set = summaryTokens.get(base) ?? new Set<string>();
    for (const token of tokens) set.add(token);
    summaryTokens.set(base, set);
  }

  const added: AttendanceRecord[] = [];
  for (const entry of od.perCourse) {
    if (matched.has(entry)) continue;
    const base = baseCourseCode(entry.courseCode);
    if (!base || coveredWholeBase.has(base)) continue;
    // Only a dated class can be added: its periods are its session spans, and a
    // lab's bare session tally would otherwise enter as half its class time.
    if (!Array.isArray(entry.dates) || entry.dates.length === 0) continue;
    const covered = summaryTokens.get(base);
    if (covered && slotTokens(entry.slot).some((token) => covered.has(token))) continue;
    const detail = periodsFromDates(entry.dates);
    if (detail.held === 0) continue;
    const isLab = /^L\d{1,2}/.test((entry.slot || '').trim().toUpperCase());
    added.push({
      courseCode: entry.courseCode || base,
      courseTitle: entry.courseName || entry.courseCode || base,
      courseType: isLab ? 'ELA' : 'ETH',
      slot: entry.slot || '',
      // VTOP names no faculty on the detail page — empty, never a placeholder.
      facultyName: '',
      attended: detail.attended,
      totalHeld: detail.held,
      percentage: attendancePercentFromCounts(detail.attended, detail.held) ?? 0,
      category: isLab ? 'Lab' : 'Theory',
      lastUpdated: '',
    });
  }

  return added.length ? [...reconciled, ...added] : reconciled;
}
