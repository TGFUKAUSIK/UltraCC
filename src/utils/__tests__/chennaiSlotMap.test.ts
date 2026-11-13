/**
 * What the Chennai slot map knows — the hours of a teaching week, asked in one
 * place.
 *
 * The map is what turns VTOP's course list ("CSE1001, slots A1+TA1, no clock")
 * into a timetable a student can look at, and it is what the free-period card
 * counts a day against. Both used to keep their own tables, and the tables
 * drifted: the same 6th-hour lab ran 12:30–13:20 on Monday, Tuesday and Friday
 * and 12:35–13:25 on Wednesday and Thursday. A student with the Wednesday lab
 * was told class ended five minutes late, and the day the free-period card
 * counted was not the day the timetable was timed on.
 */

import { describe, expect, it } from 'vitest';
import {
  CHENNAI_DAY_CODES,
  CHENNAI_SLOT_TIMES,
  LAB_SLOT_TOKEN,
  slotMeetings,
  slotTimeOn,
  theoryPeriodsForDay,
} from '../chennaiSlotMap';
import { computeFreeClasses } from '../freeClasses';
import { timetableTimeToMinutes } from '../timetableGrid';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** VTOP's "HH:MM" as minutes past midnight; a time the map cannot read is a
 *  failure of the map, so this throws rather than answering zero. */
const minutes = (value: string): number => {
  const parsed = timetableTimeToMinutes(value);
  if (parsed === null) throw new Error(`the slot map wrote an unreadable time: ${value}`);
  return parsed;
};

describe('the slot map answers for the day it is asked about', () => {
  it('knows a theory slot meets on more than one day, at different hours', () => {
    expect(slotMeetings('A1')).toEqual([
      { day: 'Monday', start: '08:00', end: '08:50' },
      { day: 'Wednesday', start: '08:55', end: '09:45' },
    ]);
    expect(slotTimeOn('Monday', 'A1')).toEqual({ start: '08:00', end: '08:50' });
    expect(slotTimeOn('Wednesday', 'A1')).toEqual({ start: '08:55', end: '09:45' });
    expect(slotTimeOn('Thursday', 'A1')).toBeNull();
  });

  it('times a row that names its slot pair by the slot being met', () => {
    expect(slotTimeOn('Monday', 'A1+TA1')).toEqual({ start: '08:00', end: '08:50' });
    expect(slotTimeOn('Monday', ' a1 + f1 ')).toEqual({ start: '08:00', end: '08:50' });
  });

  it('leaves a lab number on a day it is not scheduled, instead of borrowing an hour', () => {
    // L18 is Wednesday's 6th-hour batch. Asking for it on Friday used to fall
    // through to a day-agnostic lab table and print Wednesday's hour under a
    // Friday class.
    expect(slotTimeOn('Wednesday', 'L18')).toEqual({ start: '12:30', end: '13:20' });
    expect(slotTimeOn('Friday', 'L18')).toBeNull();
    expect(LAB_SLOT_TOKEN.test('L18')).toBe(true);
    expect(LAB_SLOT_TOKEN.test('S8B')).toBe(false);
  });

  it('says nothing about a day it has no meetings for', () => {
    expect(slotMeetings('Z99')).toEqual([]);
    expect(slotMeetings('')).toEqual([]);
    // A row that names both slots at once gets every meeting of both, which is
    // what a course carrying theory and lab in one cell needs.
    expect(slotMeetings('A1+TA1')).toEqual([
      { day: 'Monday', start: '08:00', end: '08:50' },
      { day: 'Wednesday', start: '08:55', end: '09:45' },
      { day: 'Friday', start: '09:50', end: '10:40' },
    ]);
    expect(slotTimeOn('Sunday', 'A1')).toBeNull();
    expect(slotTimeOn('', 'A1')).toBeNull();
  });
});

describe('one lab hour, on every day it falls', () => {
  it('runs the same twelve lab batches on every weekday it publishes', () => {
    // The rule L18 and L24 broke: lab numbers name a position in the day, so
    // the twelve batches have to keep the same wall-clock hours all week.
    const labHoursByDay = CHENNAI_DAY_CODES.map((code) =>
      Object.entries(CHENNAI_SLOT_TIMES[code])
        .filter(([slot]) => LAB_SLOT_TOKEN.test(slot))
        .map(([, hours]) => hours)
        .sort((a, b) => a.localeCompare(b))
    );
    for (let i = 1; i < labHoursByDay.length; i++) {
      expect(labHoursByDay[i], `${CHENNAI_DAY_CODES[i]} labs match Monday's`).toEqual(labHoursByDay[0]);
    }
    expect(labHoursByDay[0]).toHaveLength(12);
  });

  it('runs the 6th-hour lab at 12:30–13:20 wherever it appears', () => {
    // L18 and L24 used to be written 12:35–13:25, five minutes out of step with
    // every other day and with the FFCS grid the section tools read.
    let seen = 0;
    for (const [code, slots] of Object.entries(CHENNAI_SLOT_TIMES)) {
      for (const [slot, hours] of Object.entries(slots)) {
        if (!/^L(6|12|18|24|30|76)$/.test(slot)) continue;
        seen += 1;
        expect(hours, `${code} ${slot} is the 6th lab hour`).toBe('12:30-13:20');
      }
    }
    expect(seen, 'every day publishes a 6th-hour lab').toBe(6);
  });
});

describe('the teaching day the free-period card counts', () => {
  it('counts the theory hours of each weekday, in the order the day runs', () => {
    const counts: Record<string, number> = {};
    for (const day of DAYS) counts[day] = theoryPeriodsForDay(day).length;
    expect(counts).toEqual({
      Monday: 12, Tuesday: 11, Wednesday: 11, Thursday: 11, Friday: 11, Saturday: 12,
    });

    const monday = theoryPeriodsForDay('Monday');
    expect(monday[0]).toEqual({ slot: 'A1', start: '08:00', end: '08:50' });
    expect(monday[monday.length - 1]).toEqual({ slot: 'S3', start: '18:35', end: '19:25' });

    // A period is inside the teaching day, and the day never folds over itself.
    for (const day of DAYS) {
      const periods = theoryPeriodsForDay(day);
      expect(periods.every((p) => minutes(p.start) >= 8 * 60 && minutes(p.end) <= 19 * 60 + 30), `${day} inside the day`).toBe(true);
      for (let i = 1; i < periods.length; i++) {
        expect(minutes(periods[i].start) >= minutes(periods[i - 1].end), `${day} period ${i} follows the last`).toBe(true);
      }
    }
  });

  it('does not count a lab batch as an extra period of the day', () => {
    // Tuesday's grid used to carry an `L12` row of its own, written at 12:35
    // while the table that times the lab says 12:30 — so the card counted a
    // period the timetable did not have, at an hour the timetable did not run.
    expect(theoryPeriodsForDay('Tuesday').some((p) => p.slot === 'L12')).toBe(false);
    expect(theoryPeriodsForDay('Monday').some((p) => p.slot === 'S11')).toBe(true);
  });

  it('gives a day the map does not place no periods at all', () => {
    expect(theoryPeriodsForDay('Sunday')).toEqual([]);
    expect(computeFreeClasses('Sunday', []).totalPeriods).toBeNull();
  });

  it('keeps a lab hour out of the free time it offers back', () => {
    // Tuesday's grid has no theory period at 12:30 — that hour belongs to the
    // lab batches. The count still speaks about the periods VTOP publishes a
    // table for, but the gap list has to respect a student sitting in that lab
    // and not offer the hour back as free time.
    const summary = computeFreeClasses('Tuesday', [
      { day: 'Tuesday', startTime: '12:30', endTime: '13:20' },
    ]);
    expect(summary.totalPeriods).toBe(11);
    expect(summary.gaps).toEqual([
      { start: '08:00', end: '12:30', minutes: 270 },
      { start: '13:20', end: '19:25', minutes: 365 },
    ]);
    expect(summary.freeMinutes).toBe(635);
    expect(
      summary.gaps.some((gap) => minutes(gap.start) < minutes('12:30') && minutes(gap.end) > minutes('13:20')),
      'no gap runs through the lab'
    ).toBe(false);
  });

  it('is asked by the card that counts it, and by nothing else', () => {
    // Non-vacuity: the grid this replaced is quoted here, and the scan in
    // chennaiSlotMapLiveOnce.test.ts rejects a file that writes it out again.
    const DELETED_DAY_GRID =
      "const DAY_GRID: Record<string, { slot: string; start: string; end: string }[]> = {\n  Monday: [\n    { slot: 'A1', start: '08:00', end: '08:50' },\n    { slot: 'F1', start: '08:55', end: '09:45' },\n  ],\n};";
    expect(DELETED_DAY_GRID).toMatch(/const DAY_GRID/);
    expect(DELETED_DAY_GRID).toContain("'08:55'");
  });
});
