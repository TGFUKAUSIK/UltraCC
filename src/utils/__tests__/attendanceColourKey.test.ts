/**
 * An exported attendance report explains its own colours.
 *
 * A PNG or a PDF leaves the app and lands somewhere with no slider, no legend
 * and no way to ask what a red number means. The share card coloured the
 * percentage column on bands of 75 and 85 that appear nowhere else in the
 * product — every screen inside the app measures the student's own bar — so the
 * artefact made a claim and did not say what it was measured against.
 *
 * The bands themselves stay on VTOP's requirement (75%) plus the 85% band above
 * it, because a personal target means nothing to whoever receives the file.
 * What had to change is that both renderers now answer the same question with
 * the same sentence, generated from the same rule.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_BANDS, attendanceBand, attendanceBandClass, attendanceBandColor, attendanceColourKey,
} from '../attendanceColour';
import { buildAttendanceImageDoc } from '../imageExport';
import type { PrintableAttendanceRow } from '../printExport';

const ROOT = process.cwd();

/** Source with comments removed — the guard is about what actually runs. */
function codeOnly(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const row = (over: Partial<PrintableAttendanceRow> = {}): PrintableAttendanceRow => ({
  courseCode: 'CSE1001', courseTitle: 'Problem Solving', attended: 30, total: 40,
  percentage: 75, faculty: 'Dr. A', ...over,
});

describe('the band rule', () => {
  it('sits on VTOP’s requirement, not on a private threshold', () => {
    expect(ATTENDANCE_BANDS.debar).toBe(75);
    expect(attendanceBand(74.9)).toBe('risk');
    expect(attendanceBand(75)).toBe('warn');
    expect(attendanceBand(84.9)).toBe('warn');
    expect(attendanceBand(85)).toBe('ok');
  });

  it('gives the canvas and the printer the same band for the same number', () => {
    expect(attendanceBandClass(64)).toBe(attendanceBand(64));
    expect(attendanceBandColor(91)).not.toBe(attendanceBandColor(64));
  });
});

describe('the legend', () => {
  it('names every band and the line each one sits under', () => {
    const key = attendanceColourKey();
    expect(key).toMatch(/red below 75%/);
    expect(key).toMatch(/amber 75-84%/);
    expect(key).toMatch(/green 85% and above/);
    expect(key).toMatch(/VTOP/);
  });

  it('cannot drift from the rule it describes', () => {
    // The sentence is generated from ATTENDANCE_BANDS, so changing a threshold
    // changes the legend in the same edit — a stale key would be the original
    // bug wearing better typography.
    const key = attendanceColourKey();
    expect(key).toContain(String(ATTENDANCE_BANDS.debar));
    expect(key).toContain(String(ATTENDANCE_BANDS.comfortable));
    expect(key).toContain(String(ATTENDANCE_BANDS.comfortable - 1));
  });

  it('is drawn into the PNG next to the coloured column', () => {
    const doc = buildAttendanceImageDoc([row({ percentage: 64 }), row({ courseCode: 'MAT2001', percentage: 91 })]);
    const spoken = doc.commands.filter((c) => c.kind === 'text').map((c) => (c as { text: string }).text);
    expect(spoken).toContain(attendanceColourKey());
  });

  it('sits under the table and above the footer, not on top of either', () => {
    const doc = buildAttendanceImageDoc([row()]);
    const key = doc.commands.find((c) => c.kind === 'text' && (c as { text: string }).text === attendanceColourKey()) as { y: number };
    // The header draws a rule too, so the footer's is the last line in the doc —
    // the legend has to clear it and still fit the canvas the PNG gets cut to.
    const rules = doc.commands.filter((c) => c.kind === 'line') as { y1: number }[];
    const footerRule = rules[rules.length - 1];
    expect(key.y).toBeLessThan(footerRule.y1);
    expect(doc.height).toBeGreaterThan(footerRule.y1);
  });
});

describe('no renderer keeps its own copy of the scale', () => {
  const png = codeOnly('src/utils/imageExport.ts');
  const pdf = codeOnly('src/utils/printExport.ts');

  it('has both artefacts import the shared rule', () => {
    expect(png).toMatch(/from '\.\/attendanceColour'/);
    expect(pdf).toMatch(/from '\.\/attendanceColour'/);
    expect(png).toMatch(/attendanceBandColor\(/);
    expect(pdf).toMatch(/attendanceBandClass\(/);
  });

  it('has deleted the inline bands from both files', () => {
    // Only the attendance report is under discussion: the FFCS planner draws its
    // own red for a timetable clash, which is a different claim entirely.
    const png = codeOnly('src/utils/imageExport.ts');
    const start = png.indexOf('function buildAttendanceImageDoc');
    const attendanceDoc = png.slice(start, png.indexOf('export function', start + 1));
    expect(attendanceDoc.length).toBeGreaterThan(200);
    expect(attendanceDoc).not.toMatch(/<\s*(75|85)\s*\?/);
    expect(attendanceDoc).not.toMatch(/#b91c1c/);
    expect(attendanceDoc).toMatch(/attendanceBandColor\(/);

    const pdf = codeOnly('src/utils/printExport.ts');
    const attendanceFn = pdf.slice(pdf.indexOf('function exportAttendanceToPdf'));
    expect(attendanceFn).not.toMatch(/<\s*(75|85)\s*\?/);
    expect(pdf).not.toMatch(/\.risk\s*\{\s*color:\s*#/);
  });

  it('prints its stylesheet from the same colour table', () => {
    expect(pdf).toMatch(/attendanceBandCssRules\(\)/);
  });

  it('writes the legend into the print window, not only into the PNG', () => {
    expect(pdf).toMatch(/attendanceColourKey\(\)/);
  });
});
