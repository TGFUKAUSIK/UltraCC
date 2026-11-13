/**
 * How far away something is, and how big a file is, are each computed once.
 *
 * Both of these looked like cosmetics until they were counted: four files
 * converted milliseconds to days with three different roundings, and two more
 * divided bytes by 1024 in their own voice.
 *
 *   - `smartNotifications` and `adapters` each had their own days-until rule,
 *     both cutting the day at the *device's* midnight while every exam instant
 *     in the app is built from India's. On a phone set to another zone the
 *     dashboard said one day and the notification said another about the same
 *     submission.
 *   - `academicHealth` had a third rule that rounded *up*, so an exam tomorrow
 *     read as two days away — in code nothing currently renders, which is how
 *     it stayed unnoticed.
 *   - `DeadlinesView` wrote its own "2d 4h" countdown beside the model's
 *     countdown for the same exam.
 *   - `syllabus.ts` and `LmsMaterialsView` each formatted a file size.
 *
 * `examUtils.ts` owns time-until-now now; `fileSize.ts` owns byte sizes. The
 * patterns below are proven against the code that used to exist, quoted in
 * `DELETED_COPIES`, so no rule is allowed to match nothing.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** The one file allowed to turn milliseconds into days. */
const TIME_HOME = 'src/utils/examUtils.ts';
/** The one file allowed to turn bytes into a printed size. */
const SIZE_HOME = 'src/utils/fileSize.ts';

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

/** Comments stripped: this guard is about code, not prose about code. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every spelling of "one day, in milliseconds" the tree has used. */
const DAY_MS_SPELLING =
  '(?:86400000|86_400_000|DAY_MS|MILLISECONDS_IN_A_DAY|1000\\s*\\*\\s*60\\s*\\*\\s*60\\s*\\*\\s*24|24\\s*\\*\\s*60\\s*\\*\\s*60\\s*\\*\\s*1000)';

const RULES = {
  // `/ 86400000`, `/ DAY_MS` and `/ (1000 * 60 * 60 * 24)` are all the same act.
  dayMath: new RegExp(`/\\s*\\(?\\s*(?:${DAY_MS_SPELLING})\\b`),
  // A second *implementation*, not a second call: `const daysUntil = …` is how
  // the shared rule gets used.
  dayRule:
    /\bfunction\s+(?:daysUntil\w*|calendarDaysUntil|vtopDateDayStartMs|parseVtopDate)\b|\b(?:const|let)\s+(?:daysUntil\w*|calendarDaysUntil|vtopDateDayStartMs|parseVtopDate)\s*=\s*(?:\(|async\s*\(|function)/,
  byteMath: /\/\s*1024\b/,
} as const;

const RULE_NAMES: Record<keyof typeof RULES, string> = {
  dayMath: 'turns milliseconds into days by hand',
  dayRule: 'defines a second days-until rule',
  byteMath: 'divides bytes by 1024 to print a size',
};

function ruleViolations(rel: string, code: string): string[] {
  const found: string[] = [];
  if (RULES.dayMath.test(code) && rel !== TIME_HOME) found.push(RULE_NAMES.dayMath);
  if (RULES.dayRule.test(code) && rel !== TIME_HOME) found.push(RULE_NAMES.dayRule);
  if (RULES.byteMath.test(code) && rel !== SIZE_HOME) found.push(RULE_NAMES.byteMath);
  return found;
}

/**
 * The private rules this batch deleted, quoted from the files as they were
 * before it, and the one shape that never shipped but is exactly what the rule
 * is for.
 */
const DELETED_COPIES: Record<string, { code: string; trips: string[] }> = {
  'the notification engine\'s own days-until': {
    trips: [RULE_NAMES.dayMath, RULE_NAMES.dayRule],
    code: `
export function calendarDaysUntil(raw: string, now: number): number | null {
  const due = parseVtopDate(raw);
  if (due === null) return null;
  const dueMid = new Date(dueDay.getFullYear(), dueDay.getMonth(), dueDay.getDate()).getTime();
  const nowMid = new Date(nowDay.getFullYear(), nowDay.getMonth(), nowDay.getDate()).getTime();
  return Math.round((dueMid - nowMid) / DAY_MS);
}
`,
  },
  'the exam adapter\'s own days-until': {
    trips: [RULE_NAMES.dayMath, RULE_NAMES.dayRule],
    code: `
function daysUntilDate(dateStr: string, from: Date): number | null {
  const date = new Date(\`\${dateStr}T00:00:00\`);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((date.getTime() - start.getTime()) / 86400000);
}
`,
  },
  'the academic-health model\'s round-up': {
    trips: [RULE_NAMES.dayMath],
    code: `
      const diffDays = Math.ceil((exTime - today) / (1000 * 60 * 60 * 24));
`,
  },
  'the deadlines panel\'s own countdown': {
    trips: [RULE_NAMES.dayMath],
    code: `
function remaining(ms: number): string {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return \`\${days}d \${hours}h\`;
}
`,
  },
  'the syllabus sheet\'s own byte size': {
    trips: [RULE_NAMES.byteMath],
    code: `
export function formatSyllabusSize(bytes: number): string {
  const kb = bytes / 1024;
  return \`\${(kb / 1024).toFixed(1)} MB\`;
}
`,
  },
  'the LMS cache\'s own byte size': {
    trips: [RULE_NAMES.byteMath],
    code: `
function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return \`\${(bytes / (1024 * 1024)).toFixed(1)} MB\`;
  if (bytes >= 1024) return \`\${(bytes / 1024).toFixed(0)} KB\`;
  return \`\${bytes} B\`;
}
`,
  },
};

const TREE = sourceFiles('src');

describe('one rule for how far away, one rule for how big', () => {
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
    const time = codeOnly(readFileSync(join(ROOT, TIME_HOME), 'utf8'));
    for (const owned of [
      'export function calendarDaysUntil',
      'export function vtopDateDayStartMs',
      'export function istDayDiff',
      'export function formatRemaining',
      'export function countdownLabel',
    ]) {
      expect(time, `${TIME_HOME} must export ${owned}`).toContain(owned);
    }
    const size = codeOnly(readFileSync(join(ROOT, SIZE_HOME), 'utf8'));
    expect(size).toContain('export function formatFileSize');
  });

  it('leaves the dead round-up copy out of the health model', () => {
    const health = codeOnly(readFileSync(join(ROOT, 'src/utils/academicHealth.ts'), 'utf8'));
    expect(health).not.toContain('calculateExamPressure');
    expect(health).not.toContain('daysToNextExam');
  });
});

describe('the surfaces that count days or bytes ask the home', () => {
  const read = (rel: string) => codeOnly(readFileSync(join(ROOT, rel), 'utf8'));

  it('sends every deadline through the shared day rule', () => {
    expect(read('src/lib/smartNotifications.ts')).toContain("calendarDaysUntil } from '../utils/examUtils'");
    expect(read('src/lib/vtop/adapters.ts')).toContain('calendarDaysUntil(e.date, now)');
    expect(read('src/components/MeridianDashboard.tsx')).toContain('vtopDateDayStartMs');
    expect(read('src/components/DeadlinesView.tsx')).toContain('istDayDiff(c.dayStartMs, now)');
    expect(read('src/components/DeadlinesView.tsx')).toContain('formatRemaining(leftMs)');
  });

  it('prints every file size from one formatter', () => {
    expect(read('src/components/LmsMaterialsView.tsx')).toContain("formatFileSize } from '../utils/fileSize'");
    expect(read('src/components/SyllabusView.tsx')).toContain('formatFileSize(doc.bytes)');
    expect(read('src/lib/syllabus.ts')).not.toContain('formatSyllabusSize');
  });
});
