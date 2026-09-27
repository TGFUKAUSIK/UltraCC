import { describe, expect, it } from 'vitest';
import type { TimetableSlot } from '../../types';
import { currentTimetableDay, getNextTimetableSlot, getOngoingTimetableSlot, getTimetableCellSlots, getTimetableContinuationSlots, getTimetableDays, getTimetableDaySlots, getTimetableGap, getTimetableTimeRows, isTimetableSlotOngoing, timetableSessionDuration } from '../timetableGrid';

const slot = (overrides: Partial<TimetableSlot>): TimetableSlot => ({
  id: 'slot', courseCode: 'CSE1001', courseTitle: 'Networks', slot: 'A1', facultyName: 'Dr. X',
  venue: 'AB2-101', building: 'AB2', roomNo: '101', day: 'Monday', startTime: '08:00', endTime: '08:50', isLab: false,
  ...overrides,
});

describe('timetable grid helpers', () => {
  it('selects the requested day and keeps its real multi-slot duration', () => {
    const timetable = [slot({ id: 'mon', day: 'Monday', courseCode: 'MON1001' }), slot({ id: 'tue', day: 'Tuesday', courseCode: 'TUE1001' }), slot({ id: 'lab', day: 'Monday', startTime: '14:00', endTime: '16:40', isLab: true })];
    expect(getTimetableDaySlots(timetable, 'Monday').map((item) => item.courseCode)).toEqual(['MON1001', 'CSE1001']);
    expect(getTimetableCellSlots(timetable, 'Monday', '14:00')[0]).toMatchObject({ startTime: '14:00', endTime: '16:40', isLab: true });
  });

  it('builds aligned time rows from actual VTOP records only', () => {
    const rows = getTimetableTimeRows([slot({ startTime: '09:50', endTime: '10:40' }), slot({ startTime: '08:00', endTime: '08:50' }), slot({ startTime: '', endTime: '' })]);
    expect(rows).toEqual([{ startTime: '08:00', endTime: '08:50' }, { startTime: '09:50', endTime: '10:40' }]);
  });

  it('marks an ongoing class and finds the next class from current time', () => {
    const now = new Date(2026, 8, 7, 8, 25);
    const timetable = [slot({ id: 'now', startTime: '08:00', endTime: '08:50' }), slot({ id: 'next', startTime: '09:50', endTime: '10:40' })];
    expect(isTimetableSlotOngoing(timetable[0], now)).toBe(true);
    expect(getNextTimetableSlot(timetable, now)?.id).toBe('next');
  });

  it('keeps a 2-period lab session rendered as ONE row with its full duration', () => {
    const timetable = [
      slot({ id: 'theory', day: 'Monday', startTime: '08:00', endTime: '08:50' }),
      slot({ id: 'lab', day: 'Monday', slot: 'L31+L32', startTime: '14:00', endTime: '15:40', isLab: true }),
    ];
    const rows = getTimetableTimeRows(timetable);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ startTime: '14:00', endTime: '15:40' });
    expect(timetableSessionDuration(timetable[1])).toBe(100);
    expect(timetableSessionDuration(timetable[0])).toBe(50);
  });

  it('reports the lab session as ongoing through its SECOND hour', () => {
    const now = new Date(2026, 8, 7, 15, 10);
    const timetable = [
      slot({ id: 'lab', day: 'Monday', slot: 'L31+L32', startTime: '14:00', endTime: '15:40', isLab: true }),
    ];
    expect(isTimetableSlotOngoing(timetable[0], now)).toBe(true);
    expect(getOngoingTimetableSlot(timetable, now)?.id).toBe('lab');
  });

  it('never treats the first class of the day as the current class outside its window', () => {
    const timetable = [slot({ id: 'first', startTime: '08:00', endTime: '08:50' }), slot({ id: 'second', startTime: '09:50', endTime: '10:40' })];
    // 22:30 on the same Monday: the teaching day is over — nothing is current.
    const evening = new Date(2026, 8, 7, 22, 30);
    expect(isTimetableSlotOngoing(timetable[0], evening)).toBe(false);
    expect(getOngoingTimetableSlot(timetable, evening)).toBeNull();
    // Before the first class starts it is "next", never "current".
    const earlyMorning = new Date(2026, 8, 7, 7, 30);
    expect(getOngoingTimetableSlot(timetable, earlyMorning)).toBeNull();
    expect(getNextTimetableSlot(timetable, earlyMorning)?.id).toBe('first');
  });

  it('next-class skips a lab session whose second hour is already running', () => {
    const now = new Date(2026, 8, 7, 15, 0);
    const timetable = [
      slot({ id: 'lab', day: 'Monday', slot: 'L31+L32', startTime: '14:00', endTime: '15:40', isLab: true }),
      slot({ id: 'after', day: 'Monday', startTime: '15:50', endTime: '16:40' }),
    ];
    expect(getNextTimetableSlot(timetable, now)?.id).toBe('after');
  });
});


describe('timetable week days and gaps', () => {
  const timeRow = (startTime: string, endTime: string) => ({ startTime, endTime });

  it('renders Sunday only when the synced timetable actually has Sunday classes', () => {
    expect(getTimetableDays([slot({ day: 'Monday' })])).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
    ]);
    expect(getTimetableDays([slot({ day: 'Sunday' })])).toContain('Sunday');
  });

  it('resolves a Sunday date to a timetable day instead of dropping it', () => {
    expect(currentTimetableDay(new Date(2026, 8, 6, 10, 0))).toBe('Sunday');
    expect(currentTimetableDay(new Date(2026, 8, 7, 10, 0))).toBe('Monday');
  });

  it('reports a real free window between two time rows', () => {
    const gap = getTimetableGap([slot({ startTime: '08:00', endTime: '08:50' })], timeRow('08:00', '08:50'), timeRow('09:50', '10:40'));
    expect(gap).toEqual({ start: '08:50', end: '09:50', minutes: 60, isLunch: false });
  });

  it('flags the mid-day break as lunch', () => {
    const gap = getTimetableGap([], timeRow('11:50', '12:40'), timeRow('13:30', '14:20'));
    expect(gap?.isLunch).toBe(true);
  });

  it('hides a gap that a synced class actually runs through', () => {
    // The grid used to hardcode "Lunch 12:35–2:00, no scheduled classes" while
    // a 12:30–13:20 lab was printed directly beside it.
    const timetable = [slot({ id: 'lab', startTime: '12:30', endTime: '13:20', isLab: true })];
    expect(getTimetableGap(timetable, timeRow('11:50', '12:40'), timeRow('13:30', '14:20'))).toBeNull();
  });

  it('ignores breaks shorter than 45 minutes and the final row', () => {
    expect(getTimetableGap([], timeRow('08:00', '08:50'), timeRow('09:00', '09:50'))).toBeNull();
    expect(getTimetableGap([], timeRow('08:00', '08:50'), undefined)).toBeNull();
  });
});

describe('getTimetableContinuationSlots', () => {
  const lab = (overrides: Partial<TimetableSlot>): TimetableSlot => ({
    ...slot(overrides),
    id: 'Mon-L41-L42-BCSE302L-0',
    day: 'Monday',
    slot: 'L41+L42',
    courseCode: 'BCSE302L',
    isLab: true,
    startTime: '09:45',
    endTime: '11:10',
  });

  it('marks the row a two-period lab runs through as covered, not free', () => {
    const timetable = [lab({})];
    // The lab starts in the 09:45 row…
    expect(getTimetableContinuationSlots(timetable, 'Monday', '09:45')).toHaveLength(0);
    // …and is still running when the 10:35 row begins.
    expect(getTimetableContinuationSlots(timetable, 'Monday', '10:35')).toMatchObject([{ courseCode: 'BCSE302L' }]);
  });

  it('ignores other days, finished sessions and unparseable times', () => {
    const timetable = [lab({})];
    expect(getTimetableContinuationSlots(timetable, 'Tuesday', '10:35')).toEqual([]);
    expect(getTimetableContinuationSlots(timetable, 'Monday', '11:10')).toEqual([]);
    expect(getTimetableContinuationSlots(timetable, 'Monday', '1pm')).toEqual([]);
  });
});
