/**
 * roomAvailability tests — the free-classrooms engine.
 *
 * Contract: periods and slot→time mappings come ONLY from the authoritative
 * Chennai FFCS grid; labs (L1..L60) count exactly like theory slots; junk
 * venues never become rooms. AmazeCC parity: a room is busy when ANY class
 * (theory or lab) occupies it in the selected period.
 */

import { describe, it, expect } from 'vitest';
import {
  periodsForDay,
  currentPeriodIndex,
  PERIOD_START_GRACE_MINUTES,
  allKnownRooms,
  dayIsScheduled,
  normalizeRoom,
  roomBlock,
  isLabRoom,
  occupiedRoomsForPeriod,
  catalogueOccupiedRooms,
  ROOM_DAYS,
} from '../roomAvailability';

describe('periodsForDay — grid-derived periods', () => {
  it('derives 12 periods per weekday from the authoritative grid (no lunch period)', () => {
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) {
      const periods = periodsForDay(day);
      expect(periods).toHaveLength(12);
      for (const p of periods) {
        expect(p.lunch).toBe(false);
        expect(p.endMin).toBeGreaterThan(p.startMin);
      }
    }
  });

  it('starts at 08:00 and ends at 19:25 on Monday (theory grid)', () => {
    const periods = periodsForDay('mon');
    expect(periods[0].start).toBe('08:00');
    expect(periods[0].end).toBe('08:50');
    expect(periods[11].end).toBe('19:25');
  });

  it('widens a period to whichever class starts first and ends last', () => {
    const mon = periodsForDay('mon');
    // VTOP's own grid puts theory period 2 at 08:55–09:45 and the lab numbered
    // with it at 08:50–09:40. Printing only the theory clock left 08:50–08:55
    // looking like free time in a room whose lab had already begun, so the
    // period is the union of the two rows: 08:50 to 09:45.
    expect(mon[1].theorySlots).toEqual(['F1']);
    expect(mon[1].labSlots).toEqual(['L2']);
    expect(mon[1].start).toBe('08:50');
    expect(mon[1].end).toBe('09:45');
    // The last period keeps the theory bell, which is the later of the two.
    expect(mon[11].start).toBe('18:30');
    expect(mon[11].end).toBe('19:25');
  });

  it('maps Monday period 0 to theory A1 and lab L1', () => {
    const periods = periodsForDay('mon');
    expect(periods[0].theorySlots).toContain('A1');
    expect(periods[0].labSlots).toContain('L1');
  });

  it('maps Monday afternoon period to theory A2 and lab L31 (the real grid, not the old invented table)', () => {
    const periods = periodsForDay('mon');
    // 14:00–14:50 on Monday: theory A2, lab L31.
    const p = periods.find((x) => x.start === '14:00');
    expect(p).toBeDefined();
    expect(p!.theorySlots).toContain('A2');
    expect(p!.labSlots).toContain('L31');
  });

  it('maps the 08:50 period to theory F1 (old table wrongly said B1)', () => {
    // Named by the period it starts, which the lab row now decides: theory F1
    // itself rings at 08:55.
    const p = periodsForDay('mon').find((x) => x.start === '08:50');
    expect(p!.theorySlots).toContain('F1');
    expect(p!.theorySlots).not.toContain('B1');
  });

  it('skips the lunch interval — no period overlaps 13:25–14:00', () => {
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) {
      for (const p of periodsForDay(day)) {
        const overlapsLunch = p.startMin < 14 * 60 && p.endMin > 13 * 60 + 25;
        expect(overlapsLunch).toBe(false);
      }
    }
  });

  it('exposes Saturday with an honest empty schedule (grid publishes no Sat rows)', () => {
    expect(periodsForDay('sat')).toEqual([]);
    expect(ROOM_DAYS.some((d) => d.id === 'sat')).toBe(true);
  });

  it('names Saturday unscheduled so the view cannot call every room free', () => {
    // An empty occupancy set on an unscheduled day means "no data", not
    // "empty campus". dayIsScheduled is the guard the view checks first.
    expect(dayIsScheduled('sat')).toBe(false);
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) {
      expect(dayIsScheduled(day)).toBe(true);
    }
  });

  it('indexes periods contiguously per day', () => {
    const periods = periodsForDay('tue');
    periods.forEach((p, i) => expect(p.idx).toBe(i));
  });
});

describe('currentPeriodIndex — now detection', () => {
  it('finds the period containing now, from its walk-up to its bell', () => {
    // Monday 08:05 → period 0; 07:52 → the walk-up half of period 0, because a
    // student hunting for a room before class wants the room they are about to
    // sit in, not the one they have already left.
    expect(currentPeriodIndex('mon', 8 * 60 + 5)).toBe(0);
    expect(currentPeriodIndex('mon', 8 * 60 - 8)).toBe(0);
  });

  it('opens a period exactly PERIOD_START_GRACE_MINUTES early, and no earlier', () => {
    // One rule, one number: the list's selection and its "current period"
    // marker both come from here, so the grace is stated once and read by both.
    const first = periodsForDay('mon')[0];
    expect(currentPeriodIndex('mon', first.startMin - PERIOD_START_GRACE_MINUTES)).toBe(0);
    expect(currentPeriodIndex('mon', first.startMin - PERIOD_START_GRACE_MINUTES - 1)).toBe(-1);
  });

  it('returns -1 outside class hours and during lunch (13:25–14:00)', () => {
    expect(currentPeriodIndex('mon', 13 * 60 + 35)).toBe(-1); // lunch
    expect(currentPeriodIndex('mon', 20 * 60)).toBe(-1);
    expect(currentPeriodIndex('sat', 10 * 60)).toBe(-1);
  });

  it('never leaves a minute inside teaching hours without exactly one period', () => {
    // Every minute of a period must answer "current period?" once, or the
    // screen can show two markers, or none.
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) {
      const periods = periodsForDay(day);
      for (const p of periods) {
        expect(currentPeriodIndex(day, p.startMin), `${day} period ${p.idx} at its start`).toBe(p.idx);
        expect(currentPeriodIndex(day, p.endMin - 1), `${day} period ${p.idx} before its bell`).toBe(p.idx);
      }
    }
  });

  it('hands the bell minute to the period that starts on it', () => {
    // Theory period 1 rings out at 08:50 and the lab numbered with it rings in
    // at 08:50, so somebody is inside that room at that minute either way.
    // Answering with the earlier period would list the room as free while its
    // next class was already under way.
    const mon = periodsForDay('mon');
    expect(mon[0].endMin).toBe(mon[1].startMin);
    expect(currentPeriodIndex('mon', mon[0].endMin)).toBe(1);
  });
});

describe('normalizeRoom / roomBlock / isLabRoom', () => {
  it('uppercases and strips whitespace', () => {
    expect(normalizeRoom(' ab1 203 ')).toBe('AB1203');
    expect(normalizeRoom('ab1-203')).toBe('AB1-203');
  });

  it('drops junk venues that are not rooms', () => {
    for (const junk of ['', 'NIL', 'N/A', 'NA', 'TBA', '-', '001', 'AB3', 'ADB']) {
      expect(normalizeRoom(junk)).toBe('');
    }
  });

  it('keeps suffixed rooms like AB1-505A', () => {
    expect(normalizeRoom('AB1-505A')).toBe('AB1-505A');
  });

  it('extracts the block prefix', () => {
    expect(roomBlock('AB1-203')).toBe('AB1');
    expect(roomBlock('AB1-505A')).toBe('AB1');
    expect(roomBlock('SOMETHING')).toBe('Other');
  });

  it('detects lab rooms', () => {
    expect(isLabRoom('SJT-COMPLAB1')).toBe(true);
    expect(isLabRoom('AB1-203')).toBe(false);
  });
});

describe('allKnownRooms — catalogue + timetable union', () => {
  it('includes catalogue venues and filters junk', () => {
    const rooms = allKnownRooms([]);
    expect(rooms.length).toBeGreaterThan(200); // real campus rooms
    expect(rooms).toContain('AB3-103');
    expect(rooms).not.toContain('NIL');
    expect(rooms).not.toContain('001');
  });

  it('adds timetable-only venues the student attends', () => {
    const rooms = allKnownRooms(['SJT-COMPLAB3', 'ab2-105', 'NIL']);
    expect(rooms).toContain('SJT-COMPLAB3');
    expect(rooms).toContain('AB2-105');
    expect(rooms).not.toContain('NIL');
  });

  it('returns a sorted, deduplicated list', () => {
    const rooms = allKnownRooms(['AB1-203', 'AB1-203']);
    const sorted = [...rooms].sort();
    expect(rooms).toEqual(sorted);
    expect(new Set(rooms).size).toBe(rooms.length);
  });
});

describe('occupiedRoomsForPeriod — AmazeCC-style occupancy', () => {
  const rows = [
    // Theory class Monday 08:00 (A1) in AB1-203.
    { slot: 'A1', venue: 'AB1-203' },
    // Lab course L31+L32 Monday 14:00–15:40 in a lab room.
    { slot: 'L31+L32', venue: 'SJT-COMPLAB3' },
    // Day-prefixed slot string (legacy shape "MON/A1").
    { slot: 'MON/A1', venue: 'AB2-301' },
    // Tuesday-only class must NOT occupy Monday periods.
    { slot: 'B1', venue: 'AB3-103' },
    // No venue → ignored.
    { slot: 'A1', venue: 'NIL' },
  ];

  it('marks a room occupied when its theory slot matches the period', () => {
    const occupied = occupiedRoomsForPeriod(rows, 'mon', 0); // 08:00–08:50
    expect(occupied.has('AB1-203')).toBe(true);
    expect(occupied.has('AB2-301')).toBe(true); // day-prefixed A1
    expect(occupied.has('SJT-COMPLAB3')).toBe(false);
    expect(occupied.has('AB3-103')).toBe(false);
  });

  it('marks lab rooms occupied during lab slots (the old view never did)', () => {
    const afternoonIdx = periodsForDay('mon').findIndex((p) => p.start === '14:00');
    const occupied = occupiedRoomsForPeriod(rows, 'mon', afternoonIdx);
    expect(occupied.has('SJT-COMPLAB3')).toBe(true); // L31 active
    expect(occupied.has('AB1-203')).toBe(false);
  });

  it('keeps the lab room occupied across the FULL 2-period block (L31 then L32)', () => {
    const l31 = periodsForDay('mon').findIndex((p) => p.start === '14:00');
    // L32's lab row starts at 14:50, five minutes before the theory period it
    // shares a number with, and the period is now widened to meet it.
    const l32 = periodsForDay('mon').findIndex((p) => p.start === '14:50');
    expect(l32).toBe(l31 + 1);
    expect(occupiedRoomsForPeriod(rows, 'mon', l31).has('SJT-COMPLAB3')).toBe(true);
    expect(occupiedRoomsForPeriod(rows, 'mon', l32).has('SJT-COMPLAB3')).toBe(true);
  });

  it('returns an empty set for an unknown period index', () => {
    expect(occupiedRoomsForPeriod(rows, 'mon', 99).size).toBe(0);
    expect(occupiedRoomsForPeriod(rows, 'sat', 0).size).toBe(0);
  });

  it('treats a room as free when the only match is on another day', () => {
    const occupied = occupiedRoomsForPeriod([rows[3]], 'mon', 0);
    expect(occupied.size).toBe(0);
  });
});

describe('catalogueOccupiedRooms — campus-wide FFCS catalogue occupancy', () => {
  it('marks real rooms occupied across campus, not just the student’s own classes', () => {
    const occupied = catalogueOccupiedRooms('mon', 0); // Monday 08:00
    // Hundreds of sections run at 08:00 Monday; the set must be substantial.
    expect(occupied.size).toBeGreaterThan(50);
    expect(occupied.has('AB3-103')).toBe(true);
  });

  it('expands a theory slot to every day it meets (AB3-103 runs F1+TF1)', () => {
    // BASTS101 runs in AB3-103 at F1 (Wed 09:50) + TF1 (Fri 10:45); both cells
    // must show the room busy, proving multi-cell theory-slot expansion.
    expect(catalogueOccupiedRooms('wed', 2).has('AB3-103')).toBe(true);
    expect(catalogueOccupiedRooms('fri', 3).has('AB3-103')).toBe(true);
  });

  it('occupies rooms from catalogue lab slots (L5+L6 chemistry lab)', () => {
    // BACHY102 runs in AB1-102L at L5+L6 — Monday 11:40 and 12:35. Lab slots
    // map through the grid just like theory slots, so the room is busy across
    // the whole block.
    expect(catalogueOccupiedRooms('mon', 4).has('AB1-102L')).toBe(true);
    expect(catalogueOccupiedRooms('mon', 5).has('AB1-102L')).toBe(true);
  });

  it('returns an empty set for Saturday (grid publishes no Sat rows)', () => {
    expect(catalogueOccupiedRooms('sat', 0).size).toBe(0);
  });

  it('only ever reports rooms that are real catalogue venues', () => {
    const known = new Set(allKnownRooms([]));
    for (const room of catalogueOccupiedRooms('mon', 0)) {
      expect(known.has(room)).toBe(true);
    }
  });
});
