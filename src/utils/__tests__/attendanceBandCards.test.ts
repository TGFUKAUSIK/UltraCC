/**
 * The Academics attendance bands — the rule, and the sentence that explains it.
 *
 * Three cards count the student's courses and used to print only the counts. A
 * "Warning 2" with no line named asks the student to remember which bar they
 * dragged, and the middle card also holds the courses VTOP has not posted a
 * percentage for — so at the default 75% bar it can hold nothing else, while the
 * word "Warning" describes a course in trouble.
 *
 * The bands now come from one module, and each card quotes the thresholds the
 * counting uses. These tests check the copy cannot drift from the maths, and
 * that no screen keeps a private version of either.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attendanceBandCopy, attendanceTone, VTOP_ATTENDANCE_FLOOR,
} from '../attendanceBands';

/** Source with comments removed — a doc comment is not an implementation. */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const ACADEMICS = codeOnly(join(process.cwd(), 'src/components/AcademicsView.tsx'));

describe('attendanceTone', () => {
  it('puts the student’s bar in charge of "safe"', () => {
    expect(attendanceTone(83, 75)).toBe('safe');
    expect(attendanceTone(83, 85)).toBe('warning');
    expect(attendanceTone(90, 95)).toBe('warning');
  });

  it('keeps VTOP’s line in charge of "critical"', () => {
    expect(attendanceTone(74.9, 75)).toBe('critical');
    expect(attendanceTone(60, 95)).toBe('critical');
    expect(attendanceTone(VTOP_ATTENDANCE_FLOOR, 95)).toBe('warning');
  });

  it('refuses to paint a number VTOP has not posted', () => {
    expect(attendanceTone(null, 75)).toBe('unknown');
    // An unknown is not a verdict, at any bar.
    expect(attendanceTone(null, 95)).toBe('unknown');
  });

  it('sits on the line exactly once, not twice', () => {
    expect(attendanceTone(VTOP_ATTENDANCE_FLOOR, VTOP_ATTENDANCE_FLOOR)).toBe('safe');
    expect(attendanceTone(VTOP_ATTENDANCE_FLOOR - 0.1, VTOP_ATTENDANCE_FLOOR)).toBe('critical');
  });
});

describe('the card copy that goes with the bands', () => {
  it('names the student’s bar on the safe card', () => {
    const [safe] = attendanceBandCopy(85);
    expect(safe.tone).toBe('safe');
    expect(safe.rule).toContain('85%');
  });

  it('names both lines on the middle card when the bar is above VTOP’s', () => {
    const [, warning] = attendanceBandCopy(85);
    expect(warning.rule).toContain(`${VTOP_ATTENDANCE_FLOOR}–84%`);
    // The card also counts courses VTOP has not posted a figure for, and says so.
    expect(warning.rule).toMatch(/nothing recorded/);
  });

  it('stops promising a range that is empty when the bar sits on 75%', () => {
    const [, warning] = attendanceBandCopy(VTOP_ATTENDANCE_FLOOR);
    // "75–74%" would be the literal interpolation — and the card cannot hold a
    // course in that band, only one with no percentage yet.
    expect(warning.rule).not.toMatch(/75–74/);
    expect(warning.rule).toMatch(/nothing recorded/i);
  });

  it('names VTOP’s line on the risk card', () => {
    const [, , critical] = attendanceBandCopy(90);
    expect(critical.tone).toBe('critical');
    expect(critical.rule).toContain(`${VTOP_ATTENDANCE_FLOOR}%`);
    expect(critical.rule).toMatch(/VTOP/);
  });

  it('covers exactly the three tones the cards count', () => {
    expect(attendanceBandCopy(80).map((band) => band.tone)).toEqual(['safe', 'warning', 'critical']);
  });

  it('moves when the bar moves, because it is generated from it', () => {
    expect(attendanceBandCopy(75)[0].rule).not.toBe(attendanceBandCopy(95)[0].rule);
    expect(attendanceBandCopy(95)[0].rule).toContain('95%');
  });

  it('keeps every sentence short enough for three cards across a phone', () => {
    // The cards sit in `grid-cols-3`, so at 390px each column is about 80px of
    // text. A rule that reads well on a desktop and needs five lines on the
    // phone a student actually uses is not a rule they will read.
    for (const target of [75, 76, 85, 94, 95]) {
      for (const band of attendanceBandCopy(target)) {
        expect(band.rule.length).toBeLessThanOrEqual(30);
      }
    }
  });
});

describe('the Academics screen borrows the bands instead of redrawing them', () => {
  it('counts and colours with the one rule', () => {
    expect(ACADEMICS).toMatch(/const toneOf = attendanceTone/);
    expect(ACADEMICS).toMatch(/attendanceBandCopy\(safetyThreshold\)/);
    expect(ACADEMICS).toMatch(/VTOP_ATTENDANCE_FLOOR/);
  });

  it('keeps no private copy of the floor in a colour ternary', () => {
    // The bug these lines replace was four `>= target ? green : >= 75 ? amber : red`
    // chains: same rule as toneOf, but free to drift, and with no neutral band for
    // a component VTOP has not posted — the same red/rose split the eye reads as
    // two different verdicts.
    expect(ACADEMICS).not.toMatch(/>=\s*VTOP_ATTENDANCE_FLOOR\s*\?/);
    expect(ACADEMICS).not.toMatch(/percentage\s*>=\s*75\s*\?/);
    expect(ACADEMICS).not.toMatch(/pct\s*>=\s*75\s*\?/);
    expect(ACADEMICS).not.toMatch(/newPct\)\s*>=\s*75\s*\?/);
  });

  it('never writes the floor as a bare number in the copy it shows', () => {
    // The chip label, its hint and the empty-state sentence all quote the line
    // the filter actually uses.
    expect(ACADEMICS).not.toMatch(/label: 'Below 75%'/);
    expect(ACADEMICS).not.toMatch(/'Nothing is below 75%/);
    expect(ACADEMICS).not.toMatch(/>75% min</);
  });

  it('gives the four band classes one home, fill included', () => {
    expect(ACADEMICS).toMatch(/const TONE_FILL: Record</);
    expect(ACADEMICS).toMatch(/TONE_FILL\[componentTone\]/);
    expect(ACADEMICS).toMatch(/TONE_FILL\[toneOf\(b\.percentage, safetyThreshold\)\]/);
    expect(ACADEMICS).toMatch(/TONE_TEXT\[toneOf\(newPct, safetyThreshold\)\]/);
    // The skip simulator's projected figure is an attendance number like any
    // other, so it is printed by the shared label, not by a local toFixed that
    // rounds onto the line the colour just said is unmet.
    expect(ACADEMICS).toMatch(/attendancePercentLabel\(newPct\)/);
    expect(ACADEMICS).not.toMatch(/\* 100\)\.toFixed\(1\)/);
  });

  it('answers the tick icon with the same verdict the sentence gives', () => {
    // A course at 78% with an 85% bar is short of the student's own bar. The
    // panel used to ask VTOP's floor that question and paint a green tick next
    // to "Below your target" — a checkmark arguing with the words beside it.
    expect(ACADEMICS).toMatch(/bunk\.state === 'on-target' \? <CheckCircle2/);
    expect(ACADEMICS).not.toMatch(/< 75 \? <AlertTriangle/);
  });
});
