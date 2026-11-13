/**
 * The grade rules live in exactly one place.
 *
 * `gradeModel.ts` owns VIT's bands, the points a letter is worth, the score each
 * target letter starts at and the 40%-of-FAT minimum. For as long as each screen
 * also kept its own copy of those four things, the app could show one student
 * two answers to one question — and it did:
 *
 *   - `WhatIfMarksSimulator` had its own `GRADE_BANDS`, its own letter lookup and
 *     a FAT solver that ignored VIT's minimum entirely.
 *   - `CgpaSimulator` kept its own `GRADE_POINTS` and printed the bands as prose
 *     in its footer, where they could outlive a change to the real rule.
 *   - `GradesView` kept `targetThresholds = { S: 90, A: 80, B: 70, C: 60 }` next
 *     to the model's identical `TARGET_SCORES`.
 *   - `courseIntel` kept a fourth copy of the seven bands.
 *   - `AiAdvisorView` told the AI the scheme was "CAT1 (50 marks scaled to 15) …
 *     FAT scaled to 40 or 50", a regulation default several VTOP courses do not
 *     use, in a chat that also receives VTOP's real weightage.
 *   - `academicHealth` turned a course's internals into a percentage by dividing
 *     them by 50 — a scheme of its own. A lab course's internals weigh 60, and
 *     a course whose weights VTOP never published has no percentage to show, so
 *     the honest answer there is "not measurable".
 *   - `academicHealth` turned a course's internals into a percentage by dividing
 *     by 50, a scheme it invented: a lab course's internals are worth 60, and a
 *     course whose weights VTOP never published has no percentage to show.
 *
 * This guard is what keeps them from coming back. Each pattern is proven
 * against the code it was written to forbid — quoted verbatim from those files
 * before the de-duplication — because a guard whose patterns match nothing
 * would pass forever.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MODEL = 'src/utils/gradeModel.ts';

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

/** Comments stripped: the guard is about code and rendered copy, not prose. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Every way a file can claim to own a grade rule.
 *
 * Each pattern is checked against the text with comments removed, and each
 * returns a human-readable name so a failure says which rule broke.
 */
function ruleViolations(code: string): string[] {
  const found: string[] = [];

  // A letter → number table: band floors (S: 90) or grade points (S: 10). Four
  // distinct positive values in S/A/B/C order is a grade table; a counter
  // record ({ S: 0, A: 0, … }) or a colour map (strings) is not.
  const table = code.match(/\bS:\s*([\d.]+)\s*,\s*A:\s*([\d.]+)\s*,\s*B:\s*([\d.]+)\s*,\s*C:\s*([\d.]+)/);
  if (table) {
    const values = table.slice(1).map(Number);
    if (values.every((v) => Number.isFinite(v) && v > 0) && new Set(values).size === 4) {
      found.push('declares its own grade-letter → number table (bands or points)');
    }
  }
  if (/\bgrade:\s*'S',\s*min:\s*\d+/.test(code)) found.push('declares its own GRADE_BANDS rows');
  if (/\btargetThresholds\b/.test(code)) found.push('declares its own targetThresholds');
  // Walking a band table to find the letter a percent earns. A function that
  // delegates to `gradeFromVitPercent` is allowed; the loop is where a local
  // copy of the bands gets edited instead of the model's.
  if (/for\s*\(\s*const\s+\w+\s+of\s+(?:GRADE_BANDS|VIT_BANDS|bands)\b/.test(code)) {
    found.push('walks a grade band table by hand');
  }
  if (/\['S',\s*'A',\s*'B',\s*'C',\s*'D',\s*'E',\s*'F'\]/.test(code)) found.push('relists the seven grade letters');

  // The bands written out as copy instead of read from the model.
  if (/[SABCDE]\s*(?:≥|>=)\s*(?:90|80|70|60|50|40)\b/.test(code)) found.push('restates a grade band with literal digits');
  if (/scaled to (?:15|40 or 50)/.test(code)) found.push('asserts a fixed CAT/DA/Quiz/FAT marks scheme');

  // VIT's FAT minimum solved privately, one screen at a time.
  if (/0\.4\s*\*[^;\n]*[Ff]at|[^;\n]*[Ff]at[^;\n]*\*\s*0\.4/.test(code)) found.push('re-derives the 40%-of-FAT minimum');

  // Internals read as a percentage by assuming they are worth 50 marks. VTOP's
  // own weightage says what they are worth — a lab course's are 60, a course
  // with one CAT is not 50 either — and where the weight genuinely is not
  // published the honest answer is "not measurable", not a printed guess.
  if (/\/\s*50\b\s*\)?\s*\*\s*100\b/.test(code)) found.push('normalises a course over an assumed 50-mark internal');

  // A weighted mark recomputed locally, rather than through the model's
  // `earnedOf` (which prefers VTOP's own published Weightage Mark).
  if (/\(?\s*[\w.]+\.scored\s*\/\s*[\w.]+\.max\s*\)?\s*\*\s*[\w.]+\.weightage/.test(code)) {
    found.push('multiplies scored/max by weightage instead of calling earnedOf()');
  }

  return found;
}

/** Every rule `ruleViolations` can report, spelled once so none can go unproven. */
const ALL_RULES = [
  'declares its own grade-letter → number table (bands or points)',
  'declares its own GRADE_BANDS rows',
  'declares its own targetThresholds',
  'walks a grade band table by hand',
  'relists the seven grade letters',
  'restates a grade band with literal digits',
  'asserts a fixed CAT/DA/Quiz/FAT marks scheme',
  're-derives the 40%-of-FAT minimum',
  'normalises a course over an assumed 50-mark internal',
  'multiplies scored/max by weightage instead of calling earnedOf()',
] as const;

/**
 * The copies this batch deleted, quoted verbatim from the files as they were
 * before commit `e998b09`, plus the shape that rule exists to prevent.
 *
 * `trips` is the minimum each excerpt must match; a fixture that stops
 * matching means the pattern was softened or deleted, and the union check in
 * the test below means no pattern was ever allowed to match nothing.
 */
const DELETED_COPIES: Record<string, { code: string; trips: string[] }> = {
  'WhatIfMarksSimulator.tsx, the bands it kept beside the model': {
    trips: ['declares its own GRADE_BANDS rows', 'walks a grade band table by hand'],
    code: `
const GRADE_BANDS = [
  { grade: 'S', min: 90, color: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  { grade: 'A', min: 80, color: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
];

function gradeFromTotal(total: number): string {
  for (const b of GRADE_BANDS) {
    if (total >= b.min) return b.grade;
  }
  return 'F';
}
`,
  },

  'CgpaSimulator.tsx, the points table and the footer prose': {
    trips: [
      'declares its own grade-letter → number table (bands or points)',
      'restates a grade band with literal digits',
      'relists the seven grade letters',
    ],
    code: `
const GRADE_POINTS: Record<string, number> = {
  S: 10,
  A: 9,
  B: 8,
  C: 7,
  D: 6,
  E: 5,
  F: 0,
};
const GRADE_LIST = ['S', 'A', 'B', 'C', 'D', 'E', 'F'] as const;
Grade bands: S≥90, A≥80, B≥70, C≥60, D≥50, E≥40. VIT uses relative grading — treat this as a planning aid.
`,
  },

  'GradesView.tsx, targetThresholds next to the model\'s TARGET_SCORES': {
    trips: [
      'declares its own targetThresholds',
      'declares its own grade-letter → number table (bands or points)',
      'multiplies scored/max by weightage instead of calling earnedOf()',
    ],
    code: `
const targetThresholds = { S: 90, A: 80, B: 70, C: 60 } as const;
const targetPercent = targetThresholds[targetGrade];
<span className="text-zinc-600"> · {((c.scored / c.max) * c.weightage).toFixed(1)}/{c.weightage} wt</span>
`,
  },

  'courseIntel.ts, the fourth copy of the seven bands': {
    trips: ['declares its own GRADE_BANDS rows', 'walks a grade band table by hand'],
    code: `
export const GRADE_BANDS: GradeBand[] = [
  { grade: 'S', min: 90 },
  { grade: 'A', min: 80 },
];

export function gradeForTotal(total: number): string {
  for (const band of GRADE_BANDS) {
    if (total >= band.min) return band.grade;
  }
  return 'F';
}
`,
  },

  'AiAdvisorView.tsx, the regulation default it told the AI was VTOP\'s scheme': {
    trips: ['asserts a fixed CAT/DA/Quiz/FAT marks scheme'],
    code: `
You understand the FFCS credit system, A1+TA1/B1+TB1 slot structures, CAT1 (50 marks scaled to 15), CAT2 (50 marks scaled to 15), Digital Assignments (10 marks), Quiz/Surprise Test (10 marks), FAT (100 marks scaled to 40 or 50), and the strict 75% attendance rule.
`,
  },

  'the FAT floor no screen solved for yet, kept so the rule is not decoration': {
    trips: ['re-derives the 40%-of-FAT minimum'],
    code: `
const passFloor = 0.4 * course.fat.max;
`,
  },

  'the health index dividing internals by an assumed 50': {
    trips: ['normalises a course over an assumed 50-mark internal'],
    code: `
      if (scheme.isFallback) {
        // Unknown curriculum — legacy normalization only (never a new rule).
        normalized.push(Math.min(100, (m.totalScoredSoFar / 50) * 100));
        continue;
      }
`,
  },
};

const TREE = sourceFiles('src');
describe('the grade rules are stated once, in gradeModel', () => {
  it('finds no second copy of the bands, points, targets or FAT floor in src', () => {
    const offenders: string[] = [];
    for (const file of TREE) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      if (rel === MODEL) continue;
      for (const violation of ruleViolations(codeOnly(readFileSync(file, 'utf8')))) {
        offenders.push(`${rel}: ${violation}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still has the model itself own every one of them', () => {
    const model = readFileSync(join(ROOT, 'src/utils/gradeModel.ts'), 'utf8');
    for (const owned of [
      'export const VIT_BANDS',
      'export const GRADE_POINTS',
      'export const TARGET_SCORES',
      'export const VIT_FAT_MINIMUM_RATIO',
      'export function gradeFromVitPercent',
      'export function earnedOf',
    ]) {
      expect(model, `gradeModel must export ${owned}`).toContain(owned);
    }
  });

  it('proves every pattern fires on the copy it forbids', () => {
    // A guard whose patterns match nothing would pass forever, so each rule is
    // checked against the code it was written for. The excerpts are verbatim
    // from the files before commit e998b09 deleted them — kept here rather
    // than read out of git, because a control that asks HEAD for the bug
    // breaks the moment the fix is committed, and because CI checkouts have no
    // history to ask.
    for (const [where, { code, trips }] of Object.entries(DELETED_COPIES)) {
      const violations = ruleViolations(codeOnly(code));
      for (const rule of trips) {
        expect(violations, `${where} should trip "${rule}"`).toContain(rule);
      }
    }

    // And no rule is decoration: every string the checker can return has to be
    // tripped by at least one of the excerpts above.
    const tripped = new Set(
      Object.values(DELETED_COPIES).flatMap(({ code }) => ruleViolations(codeOnly(code))),
    );
    expect([...tripped].sort()).toEqual([...ALL_RULES].sort());
  });
});

describe('the screens that quote a grade quote the model', () => {
  const read = (rel: string) => codeOnly(readFileSync(join(ROOT, rel), 'utf8'));

  it('routes every simulator, predictor and card through gradeModel', () => {
    for (const rel of [
      'src/components/WhatIfMarksSimulator.tsx',
      'src/components/CgpaSimulator.tsx',
      'src/components/GradePredictor.tsx',
      'src/components/GradesView.tsx',
      'src/components/AiAdvisorView.tsx',
      'src/utils/courseIntel.ts',
    ]) {
      expect(read(rel), `${rel} must import the shared model`).toMatch(
        /from '\.\.?\/(utils\/)?gradeModel'/,
      );
    }
  });

  it('drives the marks simulator off projections and the shared solver', () => {
    const sim = read('src/components/WhatIfMarksSimulator.tsx');
    expect(sim).toContain('buildCourseModel');
    expect(sim).toContain('projectCoursePercent(model, { rowPercents })');
    expect(sim).toContain('solveTargetFAT(model, TARGET_SCORES[targetGrade]');
    expect(sim).toContain('gradeFromVitPercent');
    expect(sim).toContain('target.vitFatMinimumRaw');
    // The two arithmetic shortcuts this batch removed.
    expect(sim).not.toMatch(/pendingPercent:\s*0/);
    expect(sim).not.toContain('Math.ceil((neededFromFat');
  });

  it('takes the CGPA simulator\'s points and footer bands from the model', () => {
    const sim = read('src/components/CgpaSimulator.tsx');
    expect(sim).toContain('gradePointsOf(grade)');
    expect(sim).toContain('GRADE_ORDER.map');
    expect(sim).toContain('VIT_BANDS');
    expect(sim).not.toMatch(/GRADE_POINTS:\s*Record/);
  });

  it('aim the advisor at VTOP\'s weightage instead of a regulation default', () => {
    const advisor = read('src/components/AiAdvisorView.tsx');
    expect(advisor).toContain('VIT_BANDS');
    expect(advisor).toContain('VIT_FAT_MINIMUM_RATIO');
    expect(advisor).toContain('VTOP_ATTENDANCE_FLOOR');
    expect(advisor).toContain('Never assume a fixed CAT/DA/Quiz/FAT split');
  });
});
