/**
 * One attendance figure, one way of writing it — and one way of working it out.
 *
 * The same percentage used to be re-shaped at every print site: VTOP's `83.33`
 * appeared verbatim in a course row, `83.3` on the summary card and the course
 * intelligence card, `83` in the dashboard meter — and both exported reports were
 * handed `Math.round(percentage)` before the renderer even saw it, so the PDF a
 * student emails a friend quoted a rougher number than the screen they took it
 * from. Three printings of one fact is how a student learns to ignore all of them.
 *
 * `attendancePercentLabel` is now the only place an attendance figure becomes
 * text. It truncates at one decimal, because rounding a 74.96% sheet up to "75%"
 * would print a number that contradicts the red it is painted in.
 *
 * The other half of the promise is where a figure comes FROM. Theory + lab and
 * the attendance page's missing percentage cell both have to divide counts, and
 * they divided them two different ways — `Math.floor` in one, `Math.round` in the
 * other — so 2/3 was 66.6 on one screen and 66.7 on the card beside it. That
 * maths now lives in `attendancePercentFromCounts`, next to the label that prints
 * its result, and the scan below reads `src/lib/vtop` too: the parser is a
 * surface that writes the number every screen reads, so it was never outside the
 * rule's reach.
 *
 * The scanner's first blind spot was the gateway. `supabase/functions/vtop-gateway`
 * parses VTOP's HTML server-side and sends the client the percentage it worked
 * out — so it, not the in-app parser, was the loudest writer of the rounded
 * figure, and a guard that read only `src` watched it stay wrong. The gateway runs
 * in Deno and cannot import from `src/`, so it mirrors the expression verbatim and
 * this file fails if either side drifts.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attendancePercentFromCounts, attendancePercentLabel } from '../attendanceBands';

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

describe('attendancePercentLabel', () => {
  it('keeps one decimal and drops a trailing .0', () => {
    expect(attendancePercentLabel(83.33)).toBe('83.3');
    expect(attendancePercentLabel(66.7)).toBe('66.7');
    expect(attendancePercentLabel(80)).toBe('80');
    expect(attendancePercentLabel(100)).toBe('100');
    expect(attendancePercentLabel(0)).toBe('0');
  });

  it('truncates instead of rounding, so a figure cannot climb onto the line', () => {
    // 74.96% is short of VTOP's 75% and is painted as such. Rounded it would
    // read "75%", and the number would argue with its own colour.
    expect(attendancePercentLabel(74.96)).toBe('74.9');
    expect(attendancePercentLabel(74.999)).toBe('74.9');
    expect(attendancePercentLabel(99.99)).toBe('99.9');
    expect(attendancePercentLabel(74.96)).not.toBe('75');
  });

  it('survives binary float noise at every tenth of a percent', () => {
    // 83.3 is really 83.299999999999997…, and a naive floor would print 83.2 —
    // a tenth lower than the figure VTOP itself shows.
    for (let tenths = 0; tenths <= 1000; tenths += 1) {
      const pct = tenths / 10;
      const whole = Math.floor(tenths / 10);
      const digit = tenths % 10;
      const expected = digit === 0 ? `${whole}` : `${whole}.${digit}`;
      expect(attendancePercentLabel(pct), `label(${pct})`).toBe(expected);
    }
  });
});

describe('attendancePercentFromCounts', () => {
  it('writes the tenth the label prints, for the counts a course actually has', () => {
    expect(attendancePercentFromCounts(25, 30)).toBe(83.3);
    expect(attendancePercentFromCounts(2, 3)).toBe(66.6);
    expect(attendancePercentFromCounts(28, 32)).toBe(87.5);
    expect(attendancePercentFromCounts(30, 40)).toBe(75);
  });

  it('round-trips with the label, so a stored figure and its printing agree', () => {
    // The point of one shared rule: whatever the app derives, the sentence under
    // it says the same number.
    for (const [attended, conducted] of [[2, 3], [25, 30], [74, 99], [1, 6], [41, 55]] as const) {
      const derived = attendancePercentFromCounts(attended, conducted)!;
      expect(attendancePercentLabel(derived)).toBe(attendancePercentLabel((attended / conducted) * 100));
    }
  });

  it('truncates instead of rounding, so a derived figure cannot reach a line it has not', () => {
    // 74.955% is not 75%: rounding it would hand the student a "clears VTOP's
    // line" verdict the counts do not support.
    expect(attendancePercentFromCounts(74.955, 100)).toBe(74.9);
    expect(attendancePercentFromCounts(14991, 20000)).toBe(74.9);
    expect(attendancePercentFromCounts(666, 889)).toBe(74.9);
  });

  it('says nothing when there is nothing to divide', () => {
    // No classes held is neither 0% nor 100% — the surfaces print "—".
    expect(attendancePercentFromCounts(0, 0)).toBeNull();
    expect(attendancePercentFromCounts(5, 0)).toBeNull();
    expect(attendancePercentFromCounts(Number.NaN, 30)).toBeNull();
  });
});

describe('no surface reshapes an attendance figure on the way to the screen', () => {
  const files = sourceFiles('src')
    .filter((f) => !f.endsWith(join('src', 'utils', 'attendanceBands.ts')))
    .filter((f) => !f.includes(`${join('src', 'lib', 'vtop')}`))
    .map((f) => ({ path: f.slice(ROOT.length + 1).replace(/\\/g, '/'), code: codeOnly(f) }))
    .filter((f) => /attendance|percentage/i.test(f.code));

  /** A figure the student is being shown, as opposed to the line it is measured against. */
  // `pct` is on the list because that is how a print site hides: the day planner
  // copied `attendance.percentage` into a local named `pct` and printed it raw, so
  // a scan that only knows the word "percentage" watched the rule fail on screen.
  const MEASURED = /attendance|attended|percentage|bunk|currentPct|\bpct\b/i;
  /**
   * Written by the shared rule, a bar width rather than a number to read, or one
   * of the two lines. There are two lines, not one: VTOP's floor and the
   * student's own bar (`targetAttendance`, the slider's value). Both are lines a
   * figure is measured against, and both are exempt for the same reason.
   */
  const ALLOWED = /attendancePercentLabel|percentageLabel|Math\.min\(100,|VTOP_ATTENDANCE_FLOOR|targetAttendance/;

  it('finds the attendance surfaces it is guarding', () => {
    // The guard is only worth something if it actually covers the screens.
    const guarded = files.map((f) => f.path);
    for (const expected of [
      'src/components/AcademicsView.tsx',
      'src/components/AttendancePredictorSheet.tsx',
      'src/components/CourseIntelView.tsx',
      'src/components/MeridianDashboard.tsx',
      'src/lib/commandPalette.ts',
      'src/lib/smartNotifications.ts',
      'src/utils/academicHealth.ts',
      'src/utils/attendanceComponents.ts',
      'src/utils/imageExport.ts',
      'src/utils/nextActionEngine.ts',
      'src/utils/printExport.ts',
    ]) {
      expect(guarded, `${expected} is guarded`).toContain(expected);
    }
  });

  it('prints every attendance figure through the shared label', () => {
    // Bar widths may use the raw number; a figure a student reads may not. The
    // two lines themselves are exempt because they are integers by definition —
    // VTOP's floor and the slider's target never arrive with a decimal.
    //
    // Two shapes are scanned, because the rule used to cover only the first:
    // a template literal in a sentence, and a JSX expression a student reads as
    // a headline. `{pct}%` is the second shape and it went unwatched for as long
    // as the scan looked only at `${…}%`.
    for (const f of files) {
      for (const match of f.code.matchAll(/\$\{[^{}]*\}%/g)) {
        if (!MEASURED.test(match[0])) continue;
        expect(match[0], `${f.path} prints ${match[0]}`).toMatch(ALLOWED);
      }
      for (const match of f.code.matchAll(/\{[^{}]{1,80}\}%/g)) {
        if (!MEASURED.test(match[0])) continue;
        expect(match[0], `${f.path} prints ${match[0]}`).toMatch(ALLOWED);
      }
    }
  });

  it('never rounds a figure it is about to print', () => {
    // The mistake this catches is the honest-looking one: a surface computing a
    // percentage for its own needs (`((attended / total) * 100).toFixed(1)`) and
    // then printing that string, so the number on the card is shaped by the card.
    for (const f of files) {
      for (const line of f.code.split('\n')) {
        const shaped =
          /(percentage|attended|currentPct|bunk)[^;\n]*\.toFixed\(/i.test(line) ||
          /\.(?:toFixed|round)\(\s*[^;\n]{0,60}?(?:percentage|attended|currentPct)/i.test(line);
        if (!shaped) continue;
        expect(line, `${f.path} shapes a figure locally: ${line.trim()}`).toMatch(/attendancePercentLabel/);
      }
    }
  });

  it('derives a stored percentage with the one truncating rule', () => {
    // The maths lives beside the label that prints its result, and every writer
    // of a stored percentage calls it. This asserts the shape at both ends: the
    // home has the division, the two callers have delegations and no maths of
    // their own.
    const expression = /Math\.floor\(\(attended \/ conducted\) \* 1000 \+ 1e-6\) \/ 10/;
    const home = codeOnly(join(ROOT, 'src', 'utils', 'attendanceBands.ts'));
    expect(home).toMatch(expression);

    for (const path of ['src/utils/attendanceComponents.ts', 'src/lib/vtop/parsers/attendance.ts']) {
      const code = codeOnly(join(ROOT, ...path.split('/')));
      expect(code, `${path} calls the shared rule`).toMatch(/attendancePercentFromCounts\(/);
      expect(code, `${path} imports the shared rule`).toMatch(/from '[^']*attendanceBands'/);
    }

    // The vtop-gateway parser is the copy that actually writes the numbers this
    // app shows: it runs in Deno, cannot import from src/, and mirrors the rule.
    // Requiring the *identical expression* is what makes a deliberate copy safe —
    // a drift in either file fails here instead of on a student's card.
    const gateway = codeOnly(join(ROOT, 'supabase', 'functions', 'vtop-gateway', 'parsers.ts'));
    expect(gateway, 'the gateway mirrors the truncating division').toMatch(expression);
    expect(gateway, 'the gateway divides only through its mirror').toMatch(/percentageFromCounts\(attended, total\)/);
  });

  it('leaves no second place in the web app that rounds attendance counts into a percentage', () => {
    // The mistake this catches is the one that looks like a rounding preference:
    // a surface with counts and no VTOP figure deciding, for itself, to round up.
    // It scans the client AND the gateway that feeds it — `src` alone is how the
    // gateway copy survived the first version of this guard.
    const rounded = /Math\.round\(\s*\(?\s*(?:attended|present|attendedClasses)\s*\/\s*/;
    const floored = /Math\.floor\(\s*\(?\s*(?:attended|present)\s*\/\s*(?:total|held|conducted)/;
    const webTree = (dir: string) =>
      sourceFiles(dir).filter((f) => !f.endsWith('.test.ts') && !f.endsWith(join('src', 'utils', 'attendanceBands.ts')));
    const offenders = [...webTree('src'), ...webTree('supabase/functions')]
      .map((f) => ({ path: f.slice(ROOT.length + 1).replace(/\\/g, '/'), code: codeOnly(f) }))
      // The gateway mirror is checked verbatim above; here only its rounding half
      // is banned, so the guard cannot reject the copy it just demanded.
      .filter((f) => rounded.test(f.code) || (f.path.startsWith('src/') && floored.test(f.code)))
      .map((f) => f.path);
    expect(offenders, `re-derived a percentage: ${offenders.join(', ')}`).toEqual([]);

    // Non-vacuity: the copies this replaced, verbatim. A scan that matches
    // nothing is a scan that guards nothing.
    const DELETED_COPIES: Record<string, string> = {
      'the attendance parser rounding a missing cell': 'pct = Math.round((attended / total) * 1000) / 10;',
      'the component total rounding theory and lab': 'return Math.round((attended / conducted) * 1000) / 10;',
      'the gateway parser rounding a missing cell': 'if (!Number.isFinite(pct) || pct < 0 || pct > 100) pct = Math.round((attended / total) * 1000) / 10;',
      'the combined lab rounding on the way to a bar': 'const p = Math.round(attended / held * 100);',
    };
    const tripped = new Set<string>();
    for (const [name, code] of Object.entries(DELETED_COPIES)) {
      if (rounded.test(code) || floored.test(code)) tripped.add(name);
    }
    expect([...tripped].sort()).toEqual(Object.keys(DELETED_COPIES).sort());
  });

  it('formats through the shared label wherever it prints one', () => {
    const users = files.filter((f) => f.code.includes('attendancePercentLabel'));
    expect(users.length).toBeGreaterThanOrEqual(9);
    for (const f of users) {
      expect(f.code, `${f.path} imports the rule`).toMatch(/from '[^']*attendanceBands'/);
    }
  });
});
