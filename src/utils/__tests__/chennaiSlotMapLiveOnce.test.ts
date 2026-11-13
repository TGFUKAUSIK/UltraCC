/**
 * One Chennai teaching week, written down twice — and never a third time.
 *
 * A VTOP timetable row says "CSE3001, slots A1+TA1, AB2-406" and gives no
 * clock. The day and the hours of every class this app prints therefore come
 * from a slot → weekday → hours table, and until this batch that table existed
 * four times: in the deployed gateway parser, in the client's VTOP parser (as a
 * three-table trio — theory slots, lab slots and a copy of the gateway's), in
 * the free-period grid the timetable card counted, and in the FFCS planner's
 * section grid. Four hand-typed tables is four chances to typo one day.
 *
 * They had. The gateway's own table ran the 6th-hour lab at 12:30–13:20 on
 * Monday, Tuesday and Friday and at 12:35–13:25 on **Wednesday and Thursday**
 * (L18, L24), so a student with the Wednesday lab was told, from VTOP's own
 * course list, that class ended five minutes late — and the planner grid that
 * the section tools read, written independently, says 12:30–1:20 for all five
 * weekdays. The card meanwhile counted Tuesday's `L12` as a 12:35 *period*,
 * a slot the timing table put at 12:30, so the same lunch hour was a different
 * length depending on which surface was asked. The client's trio went the other
 * way: it had no S11/S3/S1/S4/S2/S15 rows at all, so a Monday open-elective
 * period was either unknown or answered from a day-agnostic lab table.
 *
 * The rule now: `src/utils/chennaiSlotMap.ts` and its gateway mirror are the
 * only places the week is written out; a period grid is derived from the theory
 * rows of that same table (`theoryPeriodsForDay`), so the card counts the day
 * the timetable is timed on. The two mirrors cannot share code — Supabase
 * functions deploy standalone and cannot import from `src/` — so the copies are
 * allowed and this file proves they agree, with each other and with the planner
 * grid, and rejects any third file that starts typing hours again.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as clientMap from '../chennaiSlotMap';
import * as gatewayMap from '../../../supabase/functions/vtop-gateway/chennaiSlotMap';

const ROOT = process.cwd();

const CLIENT_MIRROR = 'src/utils/chennaiSlotMap.ts';
const GATEWAY_MIRROR = 'supabase/functions/vtop-gateway/chennaiSlotMap.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(`${dir}/${entry}`));
    else if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/** Source with comments removed — the guard is about what actually runs. */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const rel = (path: string) => path.slice(ROOT.length + 1).replace(/\\/g, '/');

const files = ['src', 'supabase/functions']
  .flatMap((tree) => sourceFiles(tree))
  .map((f) => ({ path: rel(f), code: codeOnly(f) }));

/**
 * A slot code written next to the hours it runs: `A1: '08:00-08:50'` (a mirror)
 * or `L6: { start: '12:30', end: '13:20' }` (the parser trio this batch deleted).
 * The opening quote is required so an ISO timestamp (`"2026-01-01T00:00:00"`,
 * whose `T00` is shaped like a slot) does not read as a timetable table.
 */
const KEYED_HOURS = String.raw`\b[A-Z]{1,3}\d{1,2}[A-Z]?:\s*(?:\{\s*start:\s*)?'\d{1,2}:\d{2}`;
/** The other shape the same week was typed in: a period row of a day grid. */
const PERIOD_ROW = String.raw`slot:\s*'[A-Z][A-Z0-9]*',\s*start:\s*'\d{1,2}:\d{2}`;
const WRITES_THE_WEEK = new RegExp(`${KEYED_HOURS}|${PERIOD_ROW}`);

/** VTOP's grid JSON speaks 12-hour ("1:25 PM"); the maps speak 24-hour. */
function to24(value: string): string {
  const m = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) throw new Error(`the FFCS grid wrote a time nobody can read: ${value}`);
  const hour = parseInt(m[1], 10) % 12 + (/^pm$/i.test(m[3]) ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

interface GridRow {
  start?: string;
  end?: string;
  days?: Record<string, string>;
}

const plannerGrid = JSON.parse(
  readFileSync(join(ROOT, 'src', 'data', 'ffcs-slot-grid-chennai.json'), 'utf8')
) as { theory: GridRow[]; lab: GridRow[] };

/** The planner grid's own (weekday, slot) → hours, for the days it publishes. */
function plannerHours(): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of [...plannerGrid.theory, ...plannerGrid.lab]) {
    if (!row.start || !row.end || !row.days) continue;
    const hours = `${to24(row.start)}-${to24(row.end)}`;
    for (const [code, slot] of Object.entries(row.days)) out.set(`${code.toUpperCase()} ${slot}`, hours);
  }
  return out;
}

describe('the Chennai week is written out exactly twice, and both times the same', () => {
  it('keeps the deployed gateway table and the client table identical', () => {
    expect(clientMap.CHENNAI_DAY_CODES).toEqual(gatewayMap.CHENNAI_DAY_CODES);
    expect(clientMap.CHENNAI_SLOT_TIMES).toEqual(gatewayMap.CHENNAI_SLOT_TIMES);

    // Every slot the week contains, asked of both mirrors, answers the same.
    const tokens = new Set<string>();
    for (const day of Object.values(clientMap.CHENNAI_SLOT_TIMES)) {
      for (const slot of Object.keys(day)) tokens.add(slot);
    }
    expect(tokens.size).toBeGreaterThan(80);
    for (const token of tokens) {
      expect(gatewayMap.slotMeetings(token), `${token} timed the same in both mirrors`).toEqual(
        clientMap.slotMeetings(token)
      );
    }
    // …including a pair written together, and a code VTOP has never issued.
    expect(gatewayMap.slotMeetings('A1+TA1')).toEqual(clientMap.slotMeetings('A1+TA1'));
    expect(gatewayMap.slotMeetings('Z99')).toEqual([]);
    expect(clientMap.slotMeetings('Z99')).toEqual([]);
  });

  it('calls the six teaching days the same names in both mirrors', () => {
    for (const code of clientMap.CHENNAI_DAY_CODES) {
      expect(gatewayMap.DAY_LABEL[code]).toBe(clientMap.CHENNAI_DAY_LABEL[code]);
    }
    // The gateway row grid can carry a Sunday row; the slot map places no
    // Sunday class in either mirror, which is why the free-period card has no
    // Sunday count to print.
    expect(gatewayMap.DAY_LABEL.SUN).toBe('Sunday');
    expect(clientMap.CHENNAI_DAY_LABEL).not.toHaveProperty('SUN');
    expect(clientMap.slotMeetings('A1').some((m) => m.day === 'Sunday')).toBe(false);
  });

  it('agrees with the FFCS grid the section tools read, on every day both publish', () => {
    const planner = plannerHours();
    expect(planner.size).toBeGreaterThan(0);

    // The planner grid stops at Friday, so those five days are checked both
    // ways: the same slots on the same hours, and neither side quietly holding
    // a slot the other no longer prints.
    const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
    const mapKeys = new Set<string>();
    const mismatched: string[] = [];
    for (const code of weekdays) {
      for (const [slot, hours] of Object.entries(clientMap.CHENNAI_SLOT_TIMES[code])) {
        mapKeys.add(`${code} ${slot}`);
        const fromGrid = planner.get(`${code} ${slot}`);
        if (fromGrid !== hours) mismatched.push(`${code} ${slot}: map ${hours}, grid ${fromGrid}`);
      }
    }
    expect(mismatched, 'the slot map and the FFCS grid describe different weeks').toEqual([]);
    expect([...planner.keys()].sort()).toEqual([...mapKeys].sort());
  });

  it('runs the 6th-hour lab at 12:30 on the two days that had it wrong', () => {
    // L18 (Wednesday) and L24 (Thursday) are the two cells that disagreed with
    // every other day and with the FFCS grid. This is the student-visible fix.
    for (const [code, slot] of [['WED', 'L18'], ['THU', 'L24']] as const) {
      expect(clientMap.CHENNAI_SLOT_TIMES[code][slot]).toBe('12:30-13:20');
      expect(gatewayMap.CHENNAI_SLOT_TIMES[code][slot]).toBe('12:30-13:20');
    }
    const wedLabRow = plannerGrid.lab.find((row) => row.days?.wed === 'L18');
    expect(`${to24(wedLabRow!.start!)}-${to24(wedLabRow!.end!)}`).toBe('12:30-13:20');
    // …and the gateway's own course-list path prints that hour for a Wednesday lab.
    expect(clientMap.slotMeetings('L18')).toEqual([{ day: 'Wednesday', start: '12:30', end: '13:20' }]);
  });

  it('leaves the two mirrors as the only files that write the week out', () => {
    const offenders = files.filter((f) => WRITES_THE_WEEK.test(f.code)).map((f) => f.path).sort();
    expect(offenders, `a third copy of the slot hours: ${offenders.join(', ')}`).toEqual([
      CLIENT_MIRROR,
      GATEWAY_MIRROR,
    ].sort());
  });

  it('makes every surface that needs the week ask the map', () => {
    const surfaces: [string, RegExp][] = [
      ['src/utils/freeClasses.ts', /import\s*\{\s*theoryPeriodsForDay\s*\}\s*from\s*'\.\/chennaiSlotMap'/],
      ['src/lib/vtop/parsers/timetable.ts', /import\s*\{[^}]*slotMeetings[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/utils\/chennaiSlotMap'/],
      ['supabase/functions/vtop-gateway/parsers.ts', /import\s*\{[^}]*slotMeetings[^}]*\}\s*from\s*'\.\/chennaiSlotMap\.ts'/],
    ];
    for (const [path, asked] of surfaces) {
      const code = codeOnly(join(ROOT, ...path.split('/')));
      expect(code, `${path} asks the slot map`).toMatch(asked);
    }

    // …and gets nothing back from a private table of its own.
    const free = codeOnly(join(ROOT, 'src', 'utils', 'freeClasses.ts'));
    expect(free, 'the day grid is derived, not restated').toMatch(/theoryPeriodsForDay\(day\)/);
    expect(free).not.toMatch(/DAY_GRID/);

    for (const path of ['src/lib/vtop/parsers/timetable.ts', 'supabase/functions/vtop-gateway/parsers.ts']) {
      const code = codeOnly(join(ROOT, ...path.split('/')));
      expect(code, `${path} no longer keeps slot hours`).not.toMatch(
        /FFCS_SLOT_TIMES|LAB_SLOT_TIMES|CHENNAI_SLOT_TIMES|slotDayTimes|to24hSlotTime/
      );
    }
  });

  it('is watching code that actually existed', () => {
    // Non-vacuity: the four deleted tables, quoted from the code that shipped.
    // Each one writes the week out, which is exactly what the scan above bans.
    const DELETED_COPIES: Record<string, string> = {
      'the gateway table with the 12-hour typos':
        "  MON: { A1: '8:00-8:50', F1: '8:55-9:45', D1: '9:50-10:40', TB1: '10:45-11:35', TG1: '11:40-12:30', S11: '12:35-1:25', A2: '2:00-2:50' },\n  WED: { TBB1: '11:40-12:30', L18: '12:35-1:25', C2: '2:00-2:50' },",
      'the client parser copy of the same table':
        "const CHENNAI_SLOT_TIMES: Record<string, Record<string, string>> = {\n  MON: { A1: '8:00-8:50', F1: '8:55-9:45', L6: '12:30-1:20', L31: '2:00-2:50' },\n};",
      "the client parser's theory table, with no open-elective rows at all":
        "export const FFCS_SLOT_TIMES: Record<string, Record<string, { start: string; end: string }>> = {\n  Monday: {\n    A1: { start: '08:00', end: '08:50' }, F1: { start: '08:55', end: '09:45' }, D1: { start: '09:50', end: '10:40' },\n  },\n};",
      "the client parser's day-agnostic lab table":
        "const LAB_SLOT_TIMES: Record<string, { start: string; end: string }> = {\n  L1: { start: '08:00', end: '08:50' }, L6: { start: '12:30', end: '13:20' },\n};",
      'the free-period grid that counted a lab batch as a Tuesday period':
        "const DAY_GRID: Record<string, { slot: string; start: string; end: string }[]> = {\n  Tuesday: [\n    { slot: 'TAA1', start: '11:40', end: '12:30' },\n    { slot: 'L12', start: '12:35', end: '13:25' },\n    { slot: 'B2', start: '14:00', end: '14:50' },\n  ],\n};",
    };
    const tripped: string[] = [];
    for (const [name, code] of Object.entries(DELETED_COPIES)) {
      if (WRITES_THE_WEEK.test(code)) tripped.push(name);
    }
    expect(tripped.sort()).toEqual(Object.keys(DELETED_COPIES).sort());
  });
});
