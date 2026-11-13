/**
 * The Academics screen has always had a "target attendance" slider, and it has
 * always been decorative: it read a `settings` key nothing ever wrote and its
 * onChange updated only React state, so the bar VTOP-independent predictions are
 * made against silently snapped back to 75 on the next visit. These pin that a
 * chosen target now survives a reload, and that a hand-edited value in storage
 * cannot push it outside the range the control offers.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  ATTENDANCE_TARGET_DEFAULT, ATTENDANCE_TARGET_MAX, ATTENDANCE_TARGET_MIN, ATTENDANCE_TARGET_TICKS,
  getTargetAttendance, saveTargetAttendance, subscribeTargetAttendance,
} from '../settings';

const KEY = 'ultracc.targetAttendance';

describe('target attendance', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
  });

  it('defaults to 75 with nothing stored', () => {
    expect(getTargetAttendance()).toBe(75);
  });

  it('remembers the target across a reload', () => {
    saveTargetAttendance(82);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(getTargetAttendance()).toBe(82);
  });

  it('rounds a fractional drag to a whole percent', () => {
    saveTargetAttendance(88.6);
    expect(getTargetAttendance()).toBe(89);
  });

  it('keeps a corrupted or hand-edited value inside the slider range', () => {
    for (const [raw, expected] of [
      ['120', ATTENDANCE_TARGET_MAX],
      ['10', ATTENDANCE_TARGET_MIN],
      ['"lots"', 75],
      ['null', 75],
      ['"78"', 78],
    ] as const) {
      localStorage.setItem(KEY, raw);
      expect(getTargetAttendance()).toBe(expected);
    }
  });

  it('ignores a nonsense write instead of wiping the working target', () => {
    saveTargetAttendance(80);
    saveTargetAttendance(Number.NaN);
    expect(getTargetAttendance()).toBe(80);
  });

  it('labels the whole range under the slider, at its ends', () => {
    expect(ATTENDANCE_TARGET_TICKS[0]).toBe(ATTENDANCE_TARGET_MIN);
    expect(ATTENDANCE_TARGET_TICKS[ATTENDANCE_TARGET_TICKS.length - 1]).toBe(ATTENDANCE_TARGET_MAX);
    expect(ATTENDANCE_TARGET_TICKS).toEqual([75, 80, 85, 90, 95]);
  });

  // The Academics slider and the course-intelligence cards are different
  // components on one screen. A write that stayed private to the slider's own
  // state left the cards quoting 75% while the slider read 85%, so the save has
  // to broadcast — and a subscriber that unsubscribed must not be called.
  it('broadcasts a saved target to every surface quoting it', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeTargetAttendance(() => seen.push(getTargetAttendance()));
    saveTargetAttendance(85);
    expect(seen).toEqual([85]);
    unsubscribe();
    saveTargetAttendance(90);
    expect(seen).toEqual([85]);
  });

  it('does not broadcast a write it refused', () => {
    saveTargetAttendance(80);
    let called = 0;
    const unsubscribe = subscribeTargetAttendance(() => { called += 1; });
    saveTargetAttendance(Number.NaN);
    expect(called).toBe(0);
    expect(getTargetAttendance()).toBe(80);
    unsubscribe();
  });

  it('broadcasts a target changed in another tab of the same browser', () => {
    let seen = 0;
    const unsubscribe = subscribeTargetAttendance(() => { seen = getTargetAttendance(); });
    // A 'storage' event is how one tab tells the next one the key changed.
    localStorage.setItem(KEY, '88');
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '88' }));
    expect(seen).toBe(88);
    localStorage.setItem(KEY, '"76"');
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '"76"' }));
    expect(seen).toBe(76);
    unsubscribe();
  });

  it('falls back to the same constant the intel uses when nothing is stored', () => {
    expect(ATTENDANCE_TARGET_DEFAULT).toBe(75);
    expect(getTargetAttendance()).toBe(ATTENDANCE_TARGET_DEFAULT);
  });
});
