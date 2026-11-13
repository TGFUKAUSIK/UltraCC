/**
 * The attendance forecast the mobile "Attendance predictor" screen is built on.
 * It decides what a student is told about skipping real classes, so the two
 * formulas are pinned here against hand-checked numbers rather than trusted.
 *
 * The module lives in the app (mobile/src/utils/attendanceForecast.ts) and is
 * imported directly, the same way the other mobile helpers are tested.
 */

import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_THRESHOLD,
  forecastAttendance,
  forecastCourse,
  forecastSentence,
} from '../../../mobile/src/utils/attendanceForecast';

describe('classes a student can still skip', () => {
  it('counts the largest k that keeps attended/(held+k) at or above 75%', () => {
    const f = forecastAttendance(58, 72);
    expect(f.percentage).toBe(80.6);
    expect(f.canSkip).toBe(5);
    // 58/77 is still clear of the bar; the sixth absence is not.
    expect(58 / 77).toBeGreaterThanOrEqual(0.75);
    expect(58 / 78).toBeLessThan(0.75);
  });

  it('says zero when the student is sitting exactly on the threshold', () => {
    const f = forecastAttendance(6, 8);
    expect(f.percentage).toBe(75);
    expect(f.meetsThreshold).toBe(true);
    expect(f.canSkip).toBe(0);
    expect(f.neededToReach).toBe(0);
  });

  it('never offers a skip budget to someone already below the bar', () => {
    expect(forecastAttendance(50, 72).canSkip).toBe(0);
  });
});

describe('classes a student must attend to recover', () => {
  it('rounds up to the first count that actually reaches 75%', () => {
    const f = forecastAttendance(50, 72);
    expect(f.meetsThreshold).toBe(false);
    expect(f.neededToReach).toBe(16);
    expect((50 + 16) / (72 + 16)).toBeCloseTo(0.75, 10);
    expect((50 + 15) / (72 + 15)).toBeLessThan(0.75);
  });

  it('handles a student who has attended nothing at all', () => {
    const f = forecastAttendance(0, 10);
    expect(f.neededToReach).toBe(30);
    expect((0 + 30) / (10 + 30)).toBeCloseTo(0.75, 10);
  });

  it('reports nothing to recover once the bar is met', () => {
    expect(forecastAttendance(70, 72).neededToReach).toBe(0);
  });
});

describe('input that VTOP should never produce is still handled', () => {
  it('has no forecast before any class is held', () => {
    const f = forecastAttendance(0, 0);
    expect(f.percentage).toBeNull();
    expect(f.canSkip).toBe(0);
    expect(f.neededToReach).toBe(0);
    expect(f.meetsThreshold).toBe(false);
  });

  it('clamps an attended count above the classes held', () => {
    const f = forecastAttendance(10, 5);
    expect(f.attended).toBe(5);
    expect(f.percentage).toBe(100);
    expect(f.canSkip).toBe(1);
  });

  it('accepts a different threshold', () => {
    expect(forecastAttendance(50, 72, 65).meetsThreshold).toBe(true);
    expect(forecastAttendance(50, 72, 90).neededToReach).toBeGreaterThan(forecastAttendance(50, 72, 75).neededToReach);
  });

  it('defaults to VIT\'s mandatory percentage', () => {
    expect(ATTENDANCE_THRESHOLD).toBe(75);
    expect(forecastAttendance(50, 72).threshold).toBe(ATTENDANCE_THRESHOLD);
  });
});

describe('course-level totals', () => {
  it('adds the components a course is reported in', () => {
    const f = forecastCourse([{ attended: 20, totalHeld: 24 }, { attended: 10, totalHeld: 16 }]);
    expect(f.attended).toBe(30);
    expect(f.totalHeld).toBe(40);
    expect(f.percentage).toBe(75);
  });

  it('treats a course with no rows as having no forecast', () => {
    expect(forecastCourse([]).totalHeld).toBe(0);
    expect(forecastCourse([]).percentage).toBeNull();
  });
});

describe('the sentence a student reads', () => {
  it('states the recovery plan when below the bar', () => {
    expect(forecastSentence(forecastAttendance(50, 72))).toBe('Attend the next 16 classes to reach 75%.');
    expect(forecastSentence(forecastAttendance(5, 7))).toBe('Attend the next 1 class to reach 75%.');
  });

  it('states the skip budget when above it', () => {
    expect(forecastSentence(forecastAttendance(58, 72))).toBe('You can skip 5 more classes and stay at or above 75%.');
    expect(forecastSentence(forecastAttendance(52, 68))).toBe('You can skip 1 more class and stay at or above 75%.');
  });

  it('says "skip none" at exactly the threshold and before any class', () => {
    expect(forecastSentence(forecastAttendance(6, 8))).toBe('At exactly 75% — skip nothing from here.');
    expect(forecastSentence(forecastAttendance(0, 0))).toBe('No classes held yet.');
  });
});
