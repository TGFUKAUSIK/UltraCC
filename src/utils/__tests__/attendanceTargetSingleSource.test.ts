/**
 * The attendance bar has one live home — regression guard.
 *
 * A student's target is not VTOP's 75%: it is the number the Academics slider
 * shows, and every bunk count on screen is measured against it. That was not
 * true for long stretches of this app's life. The slider kept the choice in one
 * component's `useState` while `courseIntel.ts` asked
 * `calculateBunkStats(attendance, 75)`, so a course at 83% with the bar on 85%
 * read "2 safe bunks" on the card the slider drove and "attend 3 in a row" on
 * the course-intelligence card under it — two answers to one question, on one
 * screen, both of them plausible.
 *
 * These assertions are about the source, not the maths: a future surface is
 * allowed to render attendance risk, it is not allowed to invent its own bar or
 * keep its own private copy of it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** POSIX-style path relative to the repo, so assertions read the same on Windows. */
const repoPath = (file: string) => relative(ROOT, file).replace(/\\/g, '/');

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

const CALL_SITES = sourceFiles('src')
  .map((file) => ({ file: repoPath(file), code: codeOnly(file) }))
  .filter((entry) => entry.file !== 'src/utils/nextActionEngine.ts')
  .filter((entry) => entry.code.includes('calculateBunkStats('));

/** The argument text inside a call, by walking to the matching close paren. */
function argumentsOf(code: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(openIndex + 1, i);
    }
  }
  return '';
}

describe('every bunk count is measured against an explicit bar', () => {
  it('finds the surfaces that compute attendance headroom', () => {
    // Academics rows (the verdict readout and the predictor), the
    // course-intelligence rows, and the Home board's headline bunk count. If a
    // screen stops calling this, update the guard deliberately rather than
    // losing the check silently — and if a screen starts, add it here so its
    // argument is checked too.
    expect(CALL_SITES.map((c) => c.file).sort()).toEqual([
      'src/components/AcademicsView.tsx',
      'src/components/MeridianDashboard.tsx',
      'src/utils/courseIntel.ts',
    ]);
  });

  it('passes the student target to calculateBunkStats instead of taking the 75 default', () => {
    for (const site of CALL_SITES) {
      const code = site.code;
      let at = code.indexOf('calculateBunkStats(');
      while (at !== -1) {
        const args = argumentsOf(code, at + 'calculateBunkStats'.length);
        expect(`${site.file}: calculateBunkStats(${args})`).toMatch(/,/);
        expect(`${site.file}: calculateBunkStats(${args})`).not.toMatch(/,\s*75\s*\)/);
        at = code.indexOf('calculateBunkStats(', at + 1);
      }
    }
  });
});

describe('the bar is read from the store, never re-declared', () => {
  const academics = codeOnly(join(ROOT, 'src/components/AcademicsView.tsx'));
  const intel = codeOnly(join(ROOT, 'src/components/CourseIntelView.tsx'));

  it('has both Academics surfaces subscribing to the same saved target', () => {
    expect(academics).toMatch(/useTargetAttendance\(\)/);
    expect(intel).toMatch(/useTargetAttendance\(\)/);
  });

  it('keeps the Academics slider from holding a private copy of the number', () => {
    // `useState(getTargetAttendance)` was the original bug: writes stayed inside
    // one component and every other surface kept its own guess.
    expect(academics).not.toMatch(/useState[^;]*getTargetAttendance/);
    expect(academics).toMatch(/setSafetyThreshold\(Number\(e\.target\.value\)\)/);
  });

  it('threads the target into the course-intelligence rows', () => {
    // The fifth argument is the register number the grade model needs for the
    // theory/lab rule; the guard still pins the slider's target to position 4.
    expect(intel).toMatch(/buildCourseIntelRows\(\s*attendance,\s*marks,\s*targets,\s*targetPercent\s*,\s*regNo\s*\)/);
  });
});

/**
 * A second, quieter copy of the bar: a verdict word stored with the record.
 *
 * `AttendanceRecord.category` ('Safe' | 'Warning' | 'Critical') was stamped at
 * sync time from bands of 80 and 75 that nothing else in the app used. The ⌘K
 * list printed it straight after the percentage, so a course at 83% was "Safe"
 * in the palette and "attend 3 in a row" on the Academics card below it — and
 * moving the slider could not touch a word already written to IndexedDB. The
 * field is gone from the model; this block keeps it gone.
 */
describe('no surface stores its own verdict word', () => {
  const UI_MODEL = codeOnly(join(ROOT, 'src/types/index.ts'));
  const ADAPTERS = codeOnly(join(ROOT, 'src/lib/vtop/adapters.ts'));
  const PALETTE = codeOnly(join(ROOT, 'src/lib/commandPalette.ts'));

  it('keeps a Safe/Warning/Critical field out of the attendance model', () => {
    expect(UI_MODEL).not.toMatch(/category\??:\s*'Safe'/);
    const record = UI_MODEL.slice(UI_MODEL.indexOf('interface AttendanceRecord'), UI_MODEL.indexOf('interface AttendanceRecord') + 900);
    expect(record).not.toMatch(/\bcategory\b/);
  });

  it('has deleted the band function that invented it', () => {
    expect(ADAPTERS).not.toMatch(/categoryFromPercentage/);
  });

  it('judges the palette against the live target, not the record', () => {
    expect(PALETTE).toMatch(/getTargetAttendance\(\)/);
    expect(PALETTE).not.toMatch(/record\.category/);
  });

  it('has ⌘K rebuild when the bar moves, not only when the data does', () => {
    // The modal mounts once for the session, so a memo that reads the store but
    // does not depend on it freezes the bar at whatever it was on first paint.
    const modal = codeOnly(join(ROOT, 'src/components/CommandCenterModal.tsx'));
    expect(modal).toMatch(/useTargetAttendance\(\)/);
    const at = modal.indexOf('buildPaletteIndex(');
    expect(at).toBeGreaterThan(-1);
    const call = modal.slice(at, modal.indexOf(');', at));
    expect((call.match(/targetAttendance/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('leaves no writer of the field anywhere in src', () => {
    const writers = sourceFiles('src')
      .map((file) => ({ file: repoPath(file), code: codeOnly(file) }))
      .filter((entry) => /category:\s*'(Safe|Warning|Critical)'/.test(entry.code))
      .map((entry) => entry.file);
    expect(writers).toEqual([]);
  });
});
