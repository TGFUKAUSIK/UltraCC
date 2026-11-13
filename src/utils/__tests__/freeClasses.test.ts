import { describe, it, expect } from 'vitest';
import { computeFreeClasses } from '../freeClasses';
import { getTimetableGap, MIN_FREE_GAP_MINUTES } from '../timetableGrid';
import type { TimetableSlot } from '../../types';

/** A VTOP-ish slot; only the day and times matter to these tests. */
const slot = (overrides: Partial<TimetableSlot>): TimetableSlot => ({
  id: 'slot', courseCode: 'CSE1001', courseTitle: 'Networks', slot: 'A1', facultyName: 'Dr. X',
  venue: 'AB2-101', building: 'AB2', roomNo: '101', day: 'Monday', startTime: '08:00', endTime: '08:50', isLab: false,
  ...overrides,
});

/** Minutes past midnight back into the "HH:MM" VTOP writes. */
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

describe('computeFreeClasses', () => {
  it('counts free periods on a day with partial classes', () => {
    const summary = computeFreeClasses('Monday', [
      { day: 'Monday', startTime: '08:00', endTime: '08:50' },  // A1 covered
      { day: 'Monday', startTime: '14:00', endTime: '14:50' },  // A2 covered
    ]);
    expect(summary.totalPeriods).toBe(12);
    expect(summary.freeCount).toBe(10);
    // The Monday grid runs 08:00–19:25, so both free stretches count: the
    // morning-to-afternoon hole and everything after the last class.
    expect(summary.gaps).toEqual([
      { start: '08:50', end: '14:00', minutes: 310 },
      { start: '14:50', end: '19:25', minutes: 275 },
    ]);
    expect(summary.freeMinutes).toBe(585);
  });

  it('calls a fully-free teaching day free', () => {
    // Measuring only *between* classes used to report "no gap" for a day with
    // nothing scheduled, beside a headline that said all twelve periods were
    // free. A Saturday with no classes is a day of free time.
    const full = computeFreeClasses('Saturday', []);
    expect(full.freeCount).toBe(full.totalPeriods);
    expect(full.totalPeriods).toBe(12);
    expect(full.gaps).toEqual([{ start: '08:00', end: '19:25', minutes: 685 }]);
    expect(full.freeMinutes).toBe(685);
  });

  it('reports no period count for a day with no standard FFCS grid', () => {
    // Sunday classes are real, but VTOP publishes no Sunday period table, and
    // "0 / 0 free periods" read as a fully-booked day. Null means "cannot
    // count", and the UI leaves the line out instead.
    const unknown = computeFreeClasses('Sunday', [
      { day: 'Sunday', startTime: '09:00', endTime: '09:50' },
      { day: 'Sunday', startTime: '11:00', endTime: '11:50' },
    ]);
    expect(unknown.totalPeriods).toBeNull();
    expect(unknown.freeCount).toBeNull();
    expect(unknown.periods).toEqual([]);
    // What the day does give — a break between two of its own classes — is
    // still measured, bounded by the classes rather than a borrowed grid.
    expect(unknown.gaps).toEqual([{ start: '09:50', end: '11:00', minutes: 70 }]);
    expect(unknown.freeMinutes).toBe(70);
  });

  it('claims no free time on an unmapped day with a single class', () => {
    const oneClass = computeFreeClasses('Sunday', [
      { day: 'Sunday', startTime: '09:00', endTime: '09:50' },
    ]);
    expect(oneClass.gaps).toEqual([]);
    expect(oneClass.freeMinutes).toBe(0);
  });

  it('treats a lab starting slightly off-grid as covering its period', () => {
    const summary = computeFreeClasses('Monday', [
      { day: 'Monday', startTime: '14:05', endTime: '14:55' }, // within 12 min of A2 14:00
    ]);
    expect(summary.periods.find((p) => p.slot === 'A2')?.covered).toBe(true);
  });

  it('covers EVERY period a multi-slot lab spans, not just its first', () => {
    // VTOP reports an L31+L32 lab as one 14:00–15:45 block. Only looking at
    // the start time used to call the second period free, so the app told a
    // student they had nothing to do while they were sitting in the lab.
    const summary = computeFreeClasses('Monday', [
      { day: 'Monday', startTime: '14:00', endTime: '15:45' },
    ]);
    expect(summary.periods.find((p) => p.slot === 'A2')?.covered).toBe(true);
    expect(summary.periods.find((p) => p.slot === 'F2')?.covered).toBe(true);
    expect(summary.freeCount).toBe(10);
  });

  it('does not let a class cover a period it ends before', () => {
    const summary = computeFreeClasses('Monday', [
      { day: 'Monday', startTime: '14:00', endTime: '14:30' },
    ]);
    expect(summary.periods.find((p) => p.slot === 'A2')?.covered).toBe(true);
    expect(summary.periods.find((p) => p.slot === 'F2')?.covered).toBe(false);
  });

  it('counts two classes at the same hour as one block of busy time', () => {
    // VTOP files a lab and the theory it overlaps as separate rows. Measuring
    // the next gap from the row that started LAST, instead of the class that
    // ends LAST, handed back 100 free minutes for a 50-minute break — and a
    // student who left for those 50 minutes missed half a lab.
    const summary = computeFreeClasses('Monday', [
      { day: 'Monday', startTime: '14:00', endTime: '15:40' }, // lab block
      { day: 'Monday', startTime: '14:00', endTime: '14:50' }, // tutorial in the same hour
      { day: 'Monday', startTime: '16:30', endTime: '17:20' },
    ]);
    expect(summary.gaps).toEqual([
      { start: '08:00', end: '14:00', minutes: 360 },
      { start: '15:40', end: '16:30', minutes: 50 },
      { start: '17:20', end: '19:25', minutes: 125 },
    ]);
    expect(summary.freeMinutes).toBe(535);
  });

  it('quotes the same free time in the headline as in the gap list', () => {
    const summary = computeFreeClasses('Monday', [
      { day: 'Monday', startTime: '08:00', endTime: '08:50' },
      { day: 'Monday', startTime: '08:55', endTime: '09:45' }, // 5-minute changeover, not usable
      { day: 'Monday', startTime: '11:00', endTime: '11:50' },
      { day: 'Monday', startTime: '14:00', endTime: '14:50' },
    ]);
    expect(summary.gaps.map((gap) => gap.minutes)).toEqual([75, 130, 275]);
    expect(summary.freeMinutes).toBe(summary.gaps.reduce((sum, gap) => sum + gap.minutes, 0));
    expect(summary.freeMinutes).toBe(480);
  });

  it('ignores a row VTOP gave no times to instead of inventing an all-day gap', () => {
    const summary = computeFreeClasses('Monday', [
      { day: 'Monday', startTime: '', endTime: '' },
      { day: 'Monday', startTime: '08:00', endTime: '08:50' },
      { day: 'Monday', startTime: '14:00', endTime: '14:50' },
    ]);
    expect(summary.gaps).toEqual([
      { start: '08:50', end: '14:00', minutes: 310 },
      { start: '14:50', end: '19:25', minutes: 275 },
    ]);
    expect(summary.freeMinutes).toBe(585);
  });

  it('never lets a class outside the grid shorten the day it measures', () => {
    // A counselling or camp session VTOP files after teaching hours must not
    // turn the free tail of the day into a gap that runs into the night.
    const summary = computeFreeClasses('Monday', [
      { day: 'Monday', startTime: '08:00', endTime: '08:50' },
      { day: 'Monday', startTime: '19:30', endTime: '21:00' },
    ]);
    expect(summary.gaps).toEqual([{ start: '08:50', end: '19:25', minutes: 635 }]);
  });

  it('starts measuring a day at its first class when that is after grid time', () => {
    const summary = computeFreeClasses('Friday', [
      { day: 'Friday', startTime: '09:00', endTime: '09:50' },
    ]);
    // Friday's grid opens 08:00, so the hour before the first class is free.
    expect(summary.gaps[0]).toEqual({ start: '08:00', end: '09:00', minutes: 60 });
  });
});

describe('one gap rule for both timetable surfaces', () => {
  /**
   * The week grid used to print a Break row only from 45 minutes up while the
   * day card below it listed gaps from 40, so one 42-minute hole in a schedule
   * was simultaneously usable and not. Both now ask `isUsableGap`, and this is
   * the check that keeps them telling the same story.
   */
  it('lists exactly the same break lengths on the grid and on the card', () => {
    for (const minutes of [5, 35, 39, MIN_FREE_GAP_MINUTES - 1, MIN_FREE_GAP_MINUTES, 44, 45, 50, 60]) {
      const timetable = [
        slot({ id: 'first', startTime: '08:00', endTime: '08:50' }),
        slot({ id: 'second', startTime: clock(530 + minutes), endTime: clock(580 + minutes) }),
      ];
      const summary = computeFreeClasses('Monday', timetable);
      const cardListsIt = summary.gaps.some((gap) => gap.minutes === minutes);
      const gridListsIt = getTimetableGap(
        timetable,
        { startTime: '08:00', endTime: '08:50' },
        { startTime: timetable[1].startTime, endTime: timetable[1].endTime },
      ) !== null;
      expect(cardListsIt, `${minutes}-minute break on the day card`).toBe(minutes >= MIN_FREE_GAP_MINUTES);
      expect(gridListsIt, `${minutes}-minute break on the week grid`).toBe(minutes >= MIN_FREE_GAP_MINUTES);
    }
  });
});
