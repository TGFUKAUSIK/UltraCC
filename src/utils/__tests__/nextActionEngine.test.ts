import { describe, it, expect } from 'vitest';
import { calculateBunkStats } from '../nextActionEngine';
import { VTOP_ATTENDANCE_FLOOR } from '../attendanceBands';
import { AttendanceRecord } from '../../types';

describe('calculateBunkStats', () => {
  it('computes safe bunks above the threshold', () => {
    const stats = calculateBunkStats({ attended: 28, totalHeld: 32, percentage: 87.5 } as AttendanceRecord, 75);
    expect(stats.safeToBunk).toBe(true);
    expect(stats.canBunk).toBeGreaterThan(0);
    // attended / (total + x) >= 0.75 -> x <= (28/0.75 - 32) = 5.33 -> 5
    expect(stats.canBunk).toBe(5);
  });

  it('computes classes that must be attended below the threshold', () => {
    const stats = calculateBunkStats({ attended: 20, totalHeld: 28, percentage: 71.4 } as AttendanceRecord, 75);
    expect(stats.state).toBe('debar-risk');
    expect(stats.safeToBunk).toBe(false);
    // (20 + x) / (28 + x) = 0.75 -> x = 4
    expect(stats.mustAttend).toBe(4);
  });

  it('reports no safe bunks left with a sentence, not a shout', () => {
    const stats = calculateBunkStats({ attended: 24, totalHeld: 32, percentage: 75 } as AttendanceRecord, 75);
    expect(stats.canBunk).toBe(0);
    expect(stats.message).toContain('one absence drops you below 75%');
  });
});

describe('bunk counts are classes, not VTOP periods', () => {
  // VTOP counts 50-minute periods; a lab session is a two-period block. The
  // calculator used to print the period budget as a class count, so a lab at
  // 18/18 promised six skips when only three lab sessions existed.
  it('converts a lab period budget into lab sessions', () => {
    const stats = calculateBunkStats({
      attended: 18, totalHeld: 18, percentage: 100, type: 'ELA', slot: 'L31+L32',
    } as AttendanceRecord, 75);
    // floor((100*18 - 75*18) / 75) = 6 spare periods = 3 two-period labs.
    expect(stats.canBunk).toBe(3);
    expect(stats.unit).toBe('lab session');
    expect(stats.message).toContain('3 more lab sessions');
  });

  it('rounds the classes needed to recover up, not the periods', () => {
    const stats = calculateBunkStats({
      attended: 8, totalHeld: 12, percentage: 66.7, type: 'ELA', slot: 'L31+L32',
    } as AttendanceRecord, 75);
    // ceil((75*12 - 100*8) / 25) = 4 periods = 2 lab sessions.
    expect(stats.mustAttend).toBe(2);
    expect(stats.message).toContain('next 2 lab sessions');
  });

  it('will not call a lab safe to bunk when only one spare period is left', () => {
    const stats = calculateBunkStats({
      attended: 7, totalHeld: 8, percentage: 87.5, type: 'ELA', slot: 'L31+L32',
    } as AttendanceRecord, 75);
    // One spare period, but the next lab absence costs two.
    expect(stats.canBunk).toBe(0);
    expect(stats.safeToBunk).toBe(false);
  });

  it('still reports theory rows one class at a time', () => {
    const stats = calculateBunkStats({
      attended: 28, totalHeld: 32, percentage: 87.5, type: 'ETH', slot: 'A1',
    } as AttendanceRecord, 75);
    expect(stats.canBunk).toBe(5);
    expect(stats.unit).toBe('class');
  });

  it('keeps a blended aggregate honest by counting periods', () => {
    const stats = calculateBunkStats({
      attended: 28, totalHeld: 32, percentage: 87.5, type: 'TH', slot: '',
    } as AttendanceRecord, 75, { periods: true });
    expect(stats.canBunk).toBe(5);
    expect(stats.unit).toBe('period');
    expect(stats.message).toContain('5 more periods');
    expect(stats.message).toContain('lab session counts as two');
  });
});

describe('the bunk heading names the line actually crossed', () => {
  it('calls a course under VTOP’s floor a debarment risk', () => {
    const stats = calculateBunkStats({ attended: 20, totalHeld: 28, percentage: 71.4 } as AttendanceRecord, 85);
    expect(stats.state).toBe('debar-risk');
    expect(stats.status).toBe('Debarred risk');
  });

  it('will not call a 78% course a debarment risk because the bar is 85%', () => {
    // The old copy put both situations under one heading, so a student clear of
    // VTOP's line was told they were headed for debarment — by a bar they set
    // themselves, in a sentence about a rule that had not been broken.
    const stats = calculateBunkStats({ attended: 31, totalHeld: 40, percentage: 77.5 } as AttendanceRecord, 85);
    expect(stats.state).toBe('below-target');
    expect(stats.status).toBe('Below your target');
    expect(stats.status).not.toMatch(/debar/i);
  });

  it('says "on target" once the bar is met, at any bar', () => {
    const stats = calculateBunkStats({ attended: 34, totalHeld: 40, percentage: 85 } as AttendanceRecord, 85);
    expect(stats.state).toBe('on-target');
    expect(stats.status).toBe('On target');
    expect(stats.message).toContain('85%');
  });

  it('speaks to the student, not the log', () => {
    for (const [attended, totalHeld, target] of [[20, 28, 85], [31, 40, 85], [34, 40, 85]] as const) {
      const stats = calculateBunkStats({ attended, totalHeld } as AttendanceRecord, target);
      expect(stats.message).not.toMatch(/^(CRITICAL|SAFE|BORDERLINE):/);
      expect(stats.message).not.toMatch(/\b[A-Z]{4,}\b/);
    }
  });

  it('quotes the bar it was given in the sentence it writes', () => {
    const low = calculateBunkStats({ attended: 20, totalHeld: 28, percentage: 71.4 } as AttendanceRecord, 75);
    const high = calculateBunkStats({ attended: 20, totalHeld: 28, percentage: 71.4 } as AttendanceRecord, 90);
    expect(low.message).toContain('75%');
    expect(high.message).toContain('90%');
    expect(high.mustAttend).toBeGreaterThan(low.mustAttend);
  });

  it('falls back to VTOP’s floor when no bar is passed', () => {
    const stats = calculateBunkStats({ attended: 20, totalHeld: 28, percentage: 71.4 } as AttendanceRecord);
    expect(stats.message).toContain(`${VTOP_ATTENDANCE_FLOOR}%`);
    expect(stats.state).toBe('debar-risk');
  });
});
