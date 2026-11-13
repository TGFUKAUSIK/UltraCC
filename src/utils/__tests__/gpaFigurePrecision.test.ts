/**
 * One grade point average, one way of writing it.
 *
 * A CGPA of 8.925 used to appear as `8.925` on the dashboard and in the Grades
 * hero, `8.93` in My Info, and `8.9` for the placement benchmark — the same
 * student, the same VTOP record, three numbers, and the roughest one was the one
 * a recruiter was shown. The empty case was worse: VTOP stores no CGPA as 0, so
 * the dashboard printed "0" where My Info printed "Not available from VTOP".
 *
 * `gpaLabel` is now the only place a grade point average becomes text: two
 * decimals, truncated. It truncates for the reason the attendance label does —
 * a 7.996 CGPA has not crossed 8.0, and the bars a GPA is read against (placement
 * cut-offs, the 9-pointer relaxation line) must be decided by the digits the
 * student actually has. A GPA the student still *owes* goes through
 * `requiredGpaLabel`, which rounds up: telling someone "you need 7.12" when the
 * maths says 7.123 sends them 0.003 short of their own target.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gpaLabel, publishedGpaLabel, requiredGpaLabel } from '../gradeModel';

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === '__tests__') continue;
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(`${dir}/${entry}`));
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Source with comments removed — the guard is about what actually runs. */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const two = (hundredths: number) =>
  `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;

describe('gpaLabel', () => {
  it('always writes two decimals', () => {
    // A CGPA is quoted to a placement counsellor; "9" and "9.00" read as
    // different claims even though they are the same number.
    expect(gpaLabel(9)).toBe('9.00');
    expect(gpaLabel(8.9)).toBe('8.90');
    expect(gpaLabel(8.925)).toBe('8.92');
    expect(gpaLabel(0)).toBe('0.00');
  });

  it('truncates instead of rounding, so a GPA cannot climb onto a bar', () => {
    expect(gpaLabel(7.996)).toBe('7.99');
    expect(gpaLabel(8.999)).toBe('8.99');
    expect(gpaLabel(8.995)).toBe('8.99');
    expect(gpaLabel(7.996)).not.toBe('8.00');
  });

  it('survives binary float noise at every hundredth from 0.00 to 10.00', () => {
    // 8.91 is really 8.9099999999999997…, and a naive floor would print 8.90 —
    // a hundredth lower than the figure VTOP itself shows.
    for (let hundredths = 0; hundredths <= 1000; hundredths += 1) {
      const value = hundredths / 100;
      expect(gpaLabel(value), `gpaLabel(${value})`).toBe(two(hundredths));
    }
  });
});

describe('requiredGpaLabel', () => {
  it('rounds a target up, never down', () => {
    expect(requiredGpaLabel(7.123)).toBe('7.13');
    expect(requiredGpaLabel(7.101)).toBe('7.11');
    expect(requiredGpaLabel(0)).toBe('0.00');
  });

  it('leaves an exact hundredth exactly where it is', () => {
    // The 1e-6 is what makes this true: ceil(7.12 * 100) is really
    // ceil(711.9999999999999), which would ask for 7.12 → 7.13 out of nowhere.
    for (let hundredths = 0; hundredths <= 1000; hundredths += 1) {
      const value = hundredths / 100;
      expect(requiredGpaLabel(value), `requiredGpaLabel(${value})`).toBe(two(hundredths));
    }
  });

  it('never asks for less than the measurement it replaces', () => {
    for (let hundredths = 0; hundredths <= 1000; hundredths += 3) {
      const value = hundredths / 100;
      for (const digits of [3, 4, 5, 7]) {
        const exact = value + digits / 10000;
        expect(Number(requiredGpaLabel(exact)), `required(${exact})`).toBeGreaterThanOrEqual(
          Number(gpaLabel(exact)),
        );
      }
    }
  });
});

describe('publishedGpaLabel', () => {
  it('writes a real figure through the shared label', () => {
    expect(publishedGpaLabel(8.925)).toBe('8.92');
    expect(publishedGpaLabel(9)).toBe('9.00');
  });

  it('treats VTOP’s empty CGPA as absent, not as zero', () => {
    // The profile parser stores 0 when the page carries no CGPA at all, so 0 is
    // not a grade — it is a gap. Every screen used to guess this differently.
    expect(publishedGpaLabel(0)).toBe('Not available');
    expect(publishedGpaLabel(null)).toBe('Not available');
    expect(publishedGpaLabel(undefined)).toBe('Not available');
    expect(publishedGpaLabel(Number.NaN)).toBe('Not available');
    expect(publishedGpaLabel(-1)).toBe('Not available');
    expect(publishedGpaLabel(0, '—')).toBe('—');
    expect(publishedGpaLabel(null, 'Not available from VTOP')).toBe('Not available from VTOP');
  });
});

describe('no surface reshapes a grade point average on the way to the screen', () => {
  const files = sourceFiles('src')
    .filter((f) => !f.endsWith(join('src', 'utils', 'gradeModel.ts')))
    .filter((f) => !f.includes(`${join('src', 'lib', 'vtop')}`))
    .map((f) => ({ path: f.slice(ROOT.length + 1).replace(/\\/g, '/'), code: codeOnly(f) }))
    .filter((f) => /(cgpa|sgpa|gpa)/i.test(f.code));

  /**
   * The health index’s own grade component: a 0–100 score derived from the CGPA
   * (`cgpa / 10 * 100`), integer by definition and by test, and never shown as a
   * GPA. Not the figure this guard is about.
   */
  const EXEMPT = /cgpaScore\b/;

  it('finds the GPA surfaces it is guarding', () => {
    const guarded = files.map((f) => f.path);
    for (const expected of [
      'src/components/AiAdvisorView.tsx',
      'src/components/CgpaSimulator.tsx',
      'src/components/GradesView.tsx',
      'src/components/MeridianDashboard.tsx',
      'src/components/MyInfoView.tsx',
      'src/components/PlacementPortalView.tsx',
    ]) {
      expect(guarded, `${expected} is guarded`).toContain(expected);
    }
  });

  it('never rounds or truncates a GPA figure locally', () => {
    // Catches both directions: shaping a figure that is about to be printed, and
    // a one-decimal CGPA beside a two-decimal one on the next card.
    for (const f of files) {
      for (const line of f.code.split('\n')) {
        if (EXEMPT.test(line)) continue;
        const shaped =
          /(cgpa|sgpa|gpa)[\w$]*[^;\n]{0,40}\.(?:toFixed|round)\s*\(/i.test(line) ||
          /Math\.round\([^;\n]{0,40}(?:cgpa|sgpa|gpa)/i.test(line) ||
          /\.(?:toFixed|round)\([^;\n]{0,20}\)?[^;\n]{0,40}(?:cgpa|sgpa|gpa)/i.test(line);
        if (!shaped) continue;
        expect(line, `${f.path} shapes a GPA locally: ${line.trim()}`).toMatch(
          /gpaLabel|requiredGpaLabel|publishedGpaLabel/,
        );
      }
    }
  });

  it('never paints a raw GPA number straight into the page', () => {
    // A bare `{cgpa}` prints whatever precision VTOP happened to send, which is
    // how 8.925 and 8.93 ended up on two cards. JSX attributes are exempt: a
    // slider’s `value={simulatedCgpa}` is a number to control, not a figure to read.
    const offenders: string[] = [];
    for (const f of files) {
      for (const match of f.code.matchAll(/\{\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\}/g)) {
        const before = f.code.slice(0, match.index);
        if (/[A-Za-z_$-]=\s*$/u.test(before)) continue;
        const inner = match[0].slice(1, -1).trim();
        if (!/(cgpa|sgpa|gpa)$/i.test(inner)) continue;
        offenders.push(`${f.path} paints ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('routes every GPA it prints through the shared rule', () => {
    const users = files.filter((f) => /gpaLabel|requiredGpaLabel|publishedGpaLabel/.test(f.code));
    expect(users.length).toBeGreaterThanOrEqual(6);
    for (const f of users) {
      expect(f.code, `${f.path} imports the rule`).toMatch(/from '[^']*gradeModel'/);
    }
  });

  it('formats the simulator’s derived figures through the labels', () => {
    // This is the one surface that computes a GPA rather than reading VTOP’s, and
    // it printed SGPA, CGPA and the required target from three private roundings.
    const sim = files.find((f) => f.path === 'src/components/CgpaSimulator.tsx');
    expect(sim, 'CgpaSimulator is guarded').toBeDefined();
    for (const name of ['predictedSgpa', 'predictedCgpa', 'requiredSgpa']) {
      expect(sim!.code, `${name} is no longer shaped by the card`).not.toMatch(
        new RegExp(`${name}\\.toFixed\\(`),
      );
    }
    expect(sim!.code).toMatch(/gpaLabel\(predictedSgpa\)/);
    expect(sim!.code).toMatch(/gpaLabel\(predictedCgpa\)/);
    expect(sim!.code).toMatch(/requiredGpaLabel\(requiredSgpa\)/);
  });

  it('writes the CGPA a student reads from VTOP through one rule', () => {
    // Every screen that answers "what is my CGPA" has to use publishedGpaLabel,
    // so the empty record reads as absent everywhere instead of as a zero here
    // and a dash there.
    for (const path of ['src/components/MyInfoView.tsx', 'src/components/MeridianDashboard.tsx']) {
      const f = files.find((x) => x.path === path);
      expect(f, `${path} is guarded`).toBeDefined();
      expect(f!.code, `${path} uses the published rule`).toMatch(/publishedGpaLabel\(/);
    }
  });
});
