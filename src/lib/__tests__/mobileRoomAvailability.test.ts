/**
 * Free-classrooms parity — the phone must answer exactly what the web answers.
 *
 * The app carries its own copy of the FFCS slot grid and a VENUE/SLOT-reduced
 * copy of the FFCS course catalogue. Both clients build occupancy the same way,
 * so this compares the two engines directly over every day, every period and
 * every room they know about. If a data file is regenerated, trimmed
 * differently, or a port drifts, one of these comparisons fails — which is the
 * point: a student tapping "Free classrooms" on the phone and a classmate
 * opening it on the site must see the same room list.
 */

import { describe, expect, it } from 'vitest';
import * as web from '../../utils/roomAvailability';
import * as app from '../../../mobile/src/utils/roomAvailability';
import appCatalogue from '../../../mobile/src/data/ffcs-catalogue-chennai.json';
import webCatalogue from '../../data/ffcs-catalogue-chennai.json';

const DAYS: web.RoomDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

describe('the two engines expose the same day and period grid', () => {
  it('lists the same weekdays', () => {
    expect(app.ROOM_DAYS).toEqual(web.ROOM_DAYS);
  });

  it('derives identical periods for every weekday', () => {
    for (const day of DAYS) {
      const webPeriods = web.periodsForDay(day);
      const appPeriods = app.periodsForDay(day);
      expect(appPeriods.length).toBe(webPeriods.length);
      expect(appPeriods).toEqual(webPeriods);
    }
  });

  it('agrees on which period is happening now, including the grace window', () => {
    for (const day of DAYS) {
      for (const minutes of [7 * 60, 8 * 60 - 8, 8 * 60 + 5, 13 * 60 + 35, 14 * 60, 19 * 60 + 30, 20 * 60]) {
        expect(app.currentPeriodIndex(day, minutes)).toBe(web.currentPeriodIndex(day, minutes));
      }
    }
  });
});

describe('the trimmed catalogue still knows every room', () => {
  it('covers the same room universe', () => {
    expect(app.allKnownRooms([])).toEqual(web.allKnownRooms([]));
    expect(app.allKnownRooms([]).length).toBeGreaterThan(200);
  });

  it('has one row per venue + slot pair and keeps the multi-slot tokens intact', () => {
    const keys = (appCatalogue as { VENUE: string; SLOT: string }[]).map((e) => `${e.VENUE}|${e.SLOT}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.some((k) => /\+\S+\+/.test(k))).toBe(true);
  });

  it('drops no (venue, slot) pair the web catalogue schedules', () => {
    const norm = web.normalizeRoom;
    // Whitespace inside a slot string ("L31 + L32") is collapsed the same way
    // the generator that produced the mobile file collapsed it.
    const slot = (s: string | undefined) => (s || '').trim().toUpperCase().replace(/\s+/g, '');
    const appPairs = new Set(
      (appCatalogue as { VENUE: string; SLOT: string }[]).map((e) => `${norm(e.VENUE)}|${slot(e.SLOT)}`),
    );
    for (const entry of webCatalogue as { VENUE?: string; SLOT?: string }[]) {
      const room = norm(entry.VENUE || '');
      const pair = slot(entry.SLOT);
      if (!room || !pair) continue;
      // A pair missing here would mean a real class was dropped from the app's
      // occupancy map.
      expect(appPairs.has(`${room}|${pair}`)).toBe(true);
    }
  });
});

describe('campus-wide occupancy matches period by period', () => {
  it('marks exactly the same rooms busy in every cell of the week', () => {
    for (const day of DAYS) {
      const periodCount = web.periodsForDay(day).length;
      for (let idx = 0; idx < periodCount; idx++) {
        const webRooms = [...web.catalogueOccupiedRooms(day, idx)].sort();
        const appRooms = [...app.catalogueOccupiedRooms(day, idx)].sort();
        expect(appRooms).toEqual(webRooms);
      }
    }
  });

  it('has real rooms busy at the start of the day, not an empty campus', () => {
    const occupied = app.catalogueOccupiedRooms('mon', 0);
    expect(occupied.size).toBeGreaterThan(50);
    expect(occupied.has('AB3-103')).toBe(true);
  });
});

describe('a student’s own classes show busy on both clients', () => {
  const rows = [
    { slot: 'A1', venue: 'AB1-203' },
    { slot: 'L31+L32', venue: 'SJT-COMPLAB3' },
    { slot: 'MON/A1', venue: 'AB2-301' },
    { slot: 'B1', venue: 'AB3-103' },
    { slot: 'A1', venue: 'NIL' },
  ];

  it('agrees room-by-room across the whole grid', () => {
    for (const day of DAYS) {
      for (let idx = 0; idx < web.periodsForDay(day).length; idx++) {
        expect([...app.occupiedRoomsForPeriod(rows, day, idx)].sort())
          .toEqual([...web.occupiedRoomsForPeriod(rows, day, idx)].sort());
      }
    }
  });

  it('keeps a two-period lab block busy in both cells', () => {
    const l31 = app.periodsForDay('mon').findIndex((p) => p.start === '14:00');
    // L32's lab bell is 14:50, five minutes before the theory period it shares
    // a number with, and both engines widen the period to meet it.
    const l32 = app.periodsForDay('mon').findIndex((p) => p.start === '14:50');
    expect(l31).toBeGreaterThanOrEqual(0);
    expect(l32).toBe(l31 + 1);
    expect(app.occupiedRoomsForPeriod(rows, 'mon', l31).has('SJT-COMPLAB3')).toBe(true);
    expect(app.occupiedRoomsForPeriod(rows, 'mon', l32).has('SJT-COMPLAB3')).toBe(true);
  });
});

describe('room naming rules are identical', () => {
  const samples = [
    ...[' ab1 203 ', 'ab1-203', 'AB1-505A', 'NIL', 'N/A', 'NA', 'TBA', '-', '001', 'AB3', 'ADB', 'SJT-COMPLAB1', ''],
    ...(webCatalogue as { VENUE?: string }[]).slice(0, 400).map((e) => e.VENUE || ''),
  ];

  it('normalizes, blocks and lab-detects the same way', () => {
    for (const raw of samples) {
      expect(app.normalizeRoom(raw)).toBe(web.normalizeRoom(raw));
      const room = web.normalizeRoom(raw);
      if (room) {
        expect(app.roomBlock(room)).toBe(web.roomBlock(room));
        expect(app.isLabRoom(room)).toBe(web.isLabRoom(room));
      }
    }
  });
});
