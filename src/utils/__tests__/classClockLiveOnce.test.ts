/**
 * What time it is, and which period that is, are each decided once.
 *
 * Both of these feed the same answer — "what is happening right now?" — and
 * both were written several times over:
 *
 *   - Five files converted a `Date` into minutes past midnight in their own
 *     words (`AcademicsView`, `FreeClassroomsView`, `smartNotifications`, and
 *     two places inside `timetableGrid` itself). The unit is VTOP's class-time
 *     axis, produced by `timetableTimeToMinutes`; a clock read by hand has to
 *     land on that axis by luck.
 *   - The Free Classrooms screen asked "which period is now?" twice and got two
 *     answers. The period the list opens on comes from `currentPeriodIndex`,
 *     which counts a period as current from ten minutes before its bell, so a
 *     student at 07:52 sees the 08:00 rooms. The green marker beside it demanded
 *     the clock fall strictly inside the period, so at that same 07:52 the
 *     screen showed a selected period with no marker on it at all.
 *   - That ten-minute walk-up was a bare `10` inside the lookup, where a second
 *     copy could be written without anyone noticing the first.
 *
 * `timetableGrid.minutesOfDay` owns the clock; `roomAvailability` owns the
 * period, through `currentPeriodIndex` and `PERIOD_START_GRACE_MINUTES`. The
 * patterns below are proven against the code this batch deleted, quoted in
 * `DELETED_COPIES`, so no rule is allowed to match nothing.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** The one file allowed to turn a `Date` into minutes past midnight. */
const CLOCK_HOME = 'src/utils/timetableGrid.ts';
/** The one file allowed to decide which period is running. */
const PERIOD_HOME = 'src/utils/roomAvailability.ts';

/** A path that is neither home, used to test the patterns against old code. */
const OUTSIDE = 'src/features/Outside.tsx';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(`${dir}/${entry}`));
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments stripped: this guard is about code and rendered copy, not prose. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const RULES = {
  // Hours times sixty is the conversion itself, whatever multiplies or adds
  // afterwards. `minutesOfDay(now)` is how the shared rule gets used.
  clockMath: /getHours\(\)\s*\*\s*60/,
  // A second *implementation*, not a second call.
  periodRule: /\b(?:function|const)\s+currentPeriodIndex\b/,
  // A walk-up written as a digit instead of read from the constant.
  graceDigit: /\.startMin\s*-\s*\d+\b/,
  // Deciding "is this period running" from the raw fields, which is how the
  // marker came to disagree with the selection beside it.
  periodAsk: /\.startMin\s*<=/,
} as const;

const RULE_NAMES: Record<keyof typeof RULES, string> = {
  clockMath: 'turns a clock into minutes past midnight by hand',
  periodRule: 'defines a second current-period rule',
  graceDigit: 'gives a period its own walk-up grace',
  periodAsk: 'decides which period is running without asking the rule',
};

function ruleViolations(rel: string, code: string): string[] {
  const found: string[] = [];
  if (RULES.clockMath.test(code) && rel !== CLOCK_HOME) found.push(RULE_NAMES.clockMath);
  if (RULES.periodRule.test(code) && rel !== PERIOD_HOME) found.push(RULE_NAMES.periodRule);
  if (RULES.graceDigit.test(code) && rel !== PERIOD_HOME) found.push(RULE_NAMES.graceDigit);
  if (RULES.periodAsk.test(code) && rel !== PERIOD_HOME) found.push(RULE_NAMES.periodAsk);
  return found;
}

/**
 * The private copies this batch deleted, quoted from the files as they were
 * before it, plus the one shape that never shipped but is exactly what the
 * rule is for.
 */
const DELETED_COPIES: Record<string, { code: string; trips: string[] }> = {
  'the five hand-rolled clocks, one axis each': {
    trips: [RULE_NAMES.clockMath],
    code: `
  const minutesNow = clock.getHours() * 60 + clock.getMinutes();
  return { day: dayNames[now.getDay()], nowMin: now.getHours() * 60 + now.getMinutes() };
`,
  },
  'the free-classroom marker, asking its own question': {
    trips: [RULE_NAMES.periodAsk],
    code: `
  const isNow = selectedDay === todayId && p.startMin <= now.nowMin && now.nowMin <= p.endMin;
`,
  },
  'the walk-up, as a bare digit inside the lookup': {
    trips: [RULE_NAMES.graceDigit],
    code: `
  return periods.findIndex((p) => !p.lunch && nowMin >= p.startMin - 10 && nowMin <= p.endMin);
`,
  },
  'a second current-period rule, kept so the pattern is not decoration': {
    trips: [RULE_NAMES.periodRule],
    code: `
export function currentPeriodIndex(day: RoomDay, nowMin: number): number {
  return periodsForDay(day).findIndex((p) => nowMin >= p.startMin && nowMin < p.endMin);
}
`,
  },
};

const TREE = sourceFiles('src');

describe('one clock, one current-period rule', () => {
  it('finds no second copy of either rule in src', () => {
    const offenders: string[] = [];
    for (const file of TREE) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      for (const violation of ruleViolations(rel, codeOnly(readFileSync(file, 'utf8')))) {
        offenders.push(`${rel}: ${violation}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('proves every pattern fires on the copy it forbids', () => {
    for (const [where, { code, trips }] of Object.entries(DELETED_COPIES)) {
      const violations = ruleViolations(OUTSIDE, codeOnly(code));
      for (const rule of trips) {
        expect(violations, `${where} should trip "${rule}"`).toContain(rule);
      }
    }

    const tripped = new Set(
      Object.values(DELETED_COPIES).flatMap(({ code }) => ruleViolations(OUTSIDE, codeOnly(code))),
    );
    expect([...tripped].sort()).toEqual(Object.values(RULE_NAMES).sort());
  });

  it('keeps both homes actually owning their rule', () => {
    const clock = codeOnly(readFileSync(join(ROOT, CLOCK_HOME), 'utf8'));
    expect(clock).toContain('export function minutesOfDay');
    expect(clock).toContain('return date.getHours() * 60 + date.getMinutes()');
    expect(clock).toContain('const current = minutesOfDay(now)');

    const period = codeOnly(readFileSync(join(ROOT, PERIOD_HOME), 'utf8'));
    expect(period).toContain('export const PERIOD_START_GRACE_MINUTES');
    expect(period).toContain('nowMin >= p.startMin - PERIOD_START_GRACE_MINUTES');
  });
});

describe('the surfaces that read a clock ask the home', () => {
  const read = (rel: string) => codeOnly(readFileSync(join(ROOT, rel), 'utf8'));

  it('reads every device clock through minutesOfDay', () => {
    for (const rel of [
      'src/components/AcademicsView.tsx',
      'src/components/FreeClassroomsView.tsx',
      'src/lib/smartNotifications.ts',
    ]) {
      expect(read(rel), `${rel} must import the shared clock`).toMatch(
        /minutesOfDay[^}]*\} from '\.\.\/utils\/timetableGrid'/,
      );
      expect(read(rel), `${rel} must not convert the clock again`).not.toMatch(/getHours\(\)/);
    }
  });

  it('marks the current period with the rule that selects it', () => {
    const view = read('src/components/FreeClassroomsView.tsx');
    expect(view).toContain('currentPeriodIndex(selectedDay, now.nowMin) === i');
    expect(view).toContain('currentPeriodIndex(cur.day as RoomDay, cur.nowMin)');
    // The marker covers the walk-up, so it says which period, not what is happening.
    expect(view).toContain('Current period');
  });
});
