/**
 * The attendance alert is one rule that three surfaces quote.
 *
 * An alert has to answer two questions — which line is being crossed, and how
 * hard to shout about it. Both used to be written out by hand wherever they
 * appeared: the notification engine filtered on its own `>= 75`, promised a
 * "75% requirement" in its own sentence, and picked "critical" below a private
 * 70 that names no line the student can see; the academic-health index filtered
 * `< 75` again and printed "under 75% mandatory threshold"; the dashboard tinted
 * its attendance card amber below a fourth `75` that came with no explanation at
 * all. Change VTOP's floor — or the student's bar — and those four places drift
 * apart silently, which is exactly the kind of number a student stops believing.
 *
 * The floor and the urgency step now live in `attendanceBands.ts`, next to the
 * bands the Academics cards already draw from, and every alert surface imports
 * them. The guards below read the shipped source, because the failure mode is a
 * future edit re-introducing a literal in one file.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_ALERT_CRITICAL_MARGIN,
  VTOP_ATTENDANCE_FLOOR,
  attendanceAlertUrgency,
} from '../attendanceBands';

/** Source with comments removed — the guard is about what actually runs. */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const NOTIFICATIONS = codeOnly('src/lib/smartNotifications.ts');
const HEALTH = codeOnly('src/utils/academicHealth.ts');
const DASHBOARD = codeOnly('src/components/MeridianDashboard.tsx');

describe('the urgency step is a named rule, not a magic number', () => {
  it('warns for a small miss and screams for a big one', () => {
    // The step is measured down from VTOP's line, so it moves with the line.
    const criticalLine = VTOP_ATTENDANCE_FLOOR - ATTENDANCE_ALERT_CRITICAL_MARGIN;
    expect(attendanceAlertUrgency(criticalLine)).toBe('warning');
    expect(attendanceAlertUrgency(criticalLine - 0.1)).toBe('critical');
    expect(attendanceAlertUrgency(VTOP_ATTENDANCE_FLOOR - 0.1)).toBe('warning');
  });

  it('keeps the margin a sane distance below the line', () => {
    expect(ATTENDANCE_ALERT_CRITICAL_MARGIN).toBeGreaterThan(0);
    expect(ATTENDANCE_ALERT_CRITICAL_MARGIN).toBeLessThan(VTOP_ATTENDANCE_FLOOR);
  });
});

describe('every attendance alert surface borrows the rule', () => {
  it('imports the shared floor instead of re-typing it', () => {
    for (const [name, code] of [['smartNotifications.ts', NOTIFICATIONS], ['academicHealth.ts', HEALTH]] as const) {
      expect(code, `${name} imports the bands`).toMatch(/from '[^']*attendanceBands'/);
      expect(code, `${name} quotes the floor`).toContain('VTOP_ATTENDANCE_FLOOR');
    }
    // The dashboard does not name the floor, because it does not need to: the
    // ring's colour comes from the shared band rule, which is where the floor
    // lives. It still borrows that rule rather than deciding for itself.
    expect(DASHBOARD, 'MeridianDashboard.tsx imports the bands').toMatch(/from '[^']*attendanceBands'/);
    expect(DASHBOARD, 'MeridianDashboard.tsx borrows the band rule').toMatch(/attendanceTone\(/);
  });

  it('leaves no private copy of the floor in the notification engine', () => {
    expect(NOTIFICATIONS).toMatch(/a\.percentage >= VTOP_ATTENDANCE_FLOOR/);
    expect(NOTIFICATIONS).toMatch(/urgency: attendanceAlertUrgency\(a\.percentage\)/);
    expect(NOTIFICATIONS).not.toMatch(/percentage >= 75/);
    expect(NOTIFICATIONS).not.toMatch(/percentage < 70/);
    // The sentence the student reads is generated from the number that filtered
    // it, so a notification cannot promise a line it did not measure against.
    expect(NOTIFICATIONS).toMatch(/under VTOP’s \$\{VTOP_ATTENDANCE_FLOOR\}% line/);
    expect(NOTIFICATIONS).not.toMatch(/75% requirement/);
  });

  it('leaves the health index counting on the same line it names', () => {
    expect(HEALTH).toMatch(/a\.percentage < VTOP_ATTENDANCE_FLOOR/);
    expect(HEALTH).not.toMatch(/percentage < 75/);
    expect(HEALTH).toMatch(/under VTOP’s \$\{VTOP_ATTENDANCE_FLOOR\}% line/);
    // Institutional phrasing, and a label that collided with the health score's
    // own "At Risk" / "Critical" verdicts.
    expect(HEALTH).not.toMatch(/mandatory threshold/i);
    expect(HEALTH).not.toMatch(/Attendance Alert/);
  });

  it('explains the dashboard ring instead of just tinting it', () => {
    // The ring's colour is decided by the shared band rule, which knows the
    // floor; the dashboard must not carry a comparison of its own.
    expect(DASHBOARD).toMatch(/attendanceTone\(/);
    expect(DASHBOARD).not.toMatch(/(?:percentage|attendance|avgAttendance)\s*[<>]=?\s*\d/);
    // The colour is worthless unless the figure says which line earned it — and
    // it quotes the student's own bar, the one the slider sets.
    expect(DASHBOARD).toMatch(/under your \$\{targetAttendance\}% bar/);
  });
});
