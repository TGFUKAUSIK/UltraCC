/**
 * One rule for how long a break has to be before the app calls it usable.
 *
 * The timetable screen measures the same day twice. The weekly grid prints a
 * Break/Lunch row between two time rows; the card under it prints "free periods"
 * and the gaps you can use. They were written apart, and they had drifted:
 *
 *   - `timetableGrid.getTimetableGap` hid a break below 45 minutes.
 *   - `freeClasses.computeFreeClasses` counted a gap from 40.
 *   - `TimetableView` printed the 40 as copy ("usable gaps of 40+ between
 *     classes"), where it could outlive whichever constant was edited.
 *
 * So a 42-minute hole in a schedule was free time on one half of the screen and
 * nothing on the other. The threshold now lives once, as `MIN_FREE_GAP_MINUTES`
 * in `timetableGrid.ts`, with `isUsableGap` as the only way to ask it, and the
 * card reads the number from the constant instead of restating it.
 *
 * The same card also had a second, quieter problem: `freeMinutes` measured only
 * the time *between* classes, so a completely free Saturday — twelve of twelve
 * periods empty on the headline right above it — reported no usable free time at
 * all. Gaps are now bounded by the day, and a day with no published period
 * table (Sunday) says its free periods cannot be counted instead of printing
 * "0 / 0". Those two are behavioural, covered in `freeClasses.test.ts`; this
 * file keeps the threshold from being written a second time.
 *
 * Each pattern below is proven against the code it was written to forbid,
 * quoted verbatim from those files before the de-duplication — a guard whose
 * patterns match nothing would pass forever.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** The one file allowed to say how long a usable break is. */
const HOME = 'src/utils/timetableGrid.ts';

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
  // A minute difference compared against a hand-typed threshold, however the
  // two endpoints are named. `isUsableGap(end - start)` is the shared call.
  gapDiff: /\b(?:end|e|finish|to)\s*-\s*(?:start|s|from)\b[^;\n]{0,8}(?:>=|<=|>|<)\s*\d{2,3}\b/,
  // A second *implementation*, not a second call: importing `isUsableGap` or
  // `MIN_FREE_GAP_MINUTES` is how the shared rule gets used.
  gapRule: /\b(?:function|const)\s+(?:isUsableGap|usableGap|MIN_[A-Z_]*GAP[A-Z_]*|GAP_[A-Z_]*MIN\w*|minGap\w*)\s*(?:[=(])/s,
  // The threshold written out as copy instead of read from the constant.
  gapCopy: /\bgaps? of \d+\+|\b\d{2,3}\+\s*min(?:ute)?\b/,
} as const;

const RULE_NAMES: Record<keyof typeof RULES, string> = {
  gapDiff: 'measures a break against its own minute threshold',
  gapRule: 'defines a second usable-gap rule',
  gapCopy: 'prints a free-gap threshold instead of the shared constant',
};

function ruleViolations(rel: string, code: string): string[] {
  if (rel === HOME) return [];
  const found: string[] = [];
  if (RULES.gapDiff.test(code)) found.push(RULE_NAMES.gapDiff);
  if (RULES.gapRule.test(code)) found.push(RULE_NAMES.gapRule);
  if (RULES.gapCopy.test(code)) found.push(RULE_NAMES.gapCopy);
  return found;
}

/**
 * The private rules this batch deleted, quoted from the files as they were
 * before it. Each excerpt lists the rules it must trip; the union check at the
 * bottom means none of them was ever allowed to match nothing.
 */
const DELETED_COPIES: Record<string, { code: string; trips: string[] }> = {
  'freeClasses.ts, the day card\'s own 40-minute cut': {
    trips: [RULE_NAMES.gapDiff, RULE_NAMES.gapRule],
    code: `
const MIN_FREE_GAP = 40;
for (let i = 0; i < busy.length - 1; i++) {
  const start = busy[i].e;
  const end = busy[i + 1].s;
  if (end - start >= 40) gaps.push({ start: toClock(start), end: toClock(end), minutes: end - start });
}
`,
  },
  'timetableGrid.ts, the week grid\'s own 45-minute cut': {
    trips: [RULE_NAMES.gapDiff],
    code: `
  if (start === null || end === null || end - start < 45) return null;
`,
  },
  'TimetableView.tsx, the threshold printed as copy': {
    trips: [RULE_NAMES.gapCopy],
    code: `
  ? \`\${freeClassSummary.freeMinutes} minutes in usable gaps of 40+ between classes\`
  : 'No gap of 40+ minutes between classes'
`,
  },
};

const TREE = sourceFiles('src');

describe('one usable-gap rule for the timetable', () => {
  it('finds no second copy of the threshold in src', () => {
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

  it('keeps the home actually owning the rule', () => {
    const home = codeOnly(readFileSync(join(ROOT, HOME), 'utf8'));
    for (const owned of [
      'export const MIN_FREE_GAP_MINUTES',
      'export function isUsableGap',
      'return minutes >= MIN_FREE_GAP_MINUTES',
      '!isUsableGap(end - start)',
    ]) {
      expect(home, `${HOME} must contain ${owned}`).toContain(owned);
    }
  });
});

describe('both timetable surfaces ask the shared rule', () => {
  const read = (rel: string) => codeOnly(readFileSync(join(ROOT, rel), 'utf8'));

  it('measures free-class gaps through it', () => {
    const free = read('src/utils/freeClasses.ts');
    expect(free).toContain("isUsableGap, timetableTimeToMinutes } from './timetableGrid'");
    expect(free).toContain('if (isUsableGap(end - cursor))');
    // The day with no published period table reports "cannot count", not 0.
    expect(free).toContain('totalPeriods: measurable ? periods.length : null');
    expect(free).toContain('freeCount: measurable ? periods.filter((p) => !p.covered).length : null');
  });

  it('prints the threshold from the constant, and the uncountable day honestly', () => {
    const view = read('src/components/TimetableView.tsx');
    expect(view).toContain('MIN_FREE_GAP_MINUTES } from');
    expect(view).toContain('${MIN_FREE_GAP_MINUTES}+ min');
    expect(view).toContain('freeClassSummary.freeCount === null');
    expect(view).toContain('has no FFCS period table');
    // The week row is a week-wide claim, so it says so.
    expect(view).toContain('No classes scheduled on any day');
  });
});
