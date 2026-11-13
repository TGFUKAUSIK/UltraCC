import { describe, expect, it } from 'vitest';
import type { AttendanceRecord, TimetableSlot } from '../../types';
import { matchAttendanceRecord, projectAttendance } from '../attendancePredictor';

const slot = (overrides: Partial<TimetableSlot> = {}): TimetableSlot => ({
  id: 'class-1', courseCode: 'CSE2001', courseTitle: 'Networks', slot: 'A1', facultyName: 'Faculty', venue: 'AB1-101', building: 'AB1', roomNo: '101', day: 'Monday', startTime: '08:00', endTime: '08:50', isLab: false, ...overrides,
});

const record = (overrides: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  courseCode: 'CSE2001', courseTitle: 'Networks', type: 'TH', slot: 'A1', facultyName: 'Faculty', attended: 8, totalHeld: 10, percentage: 80, lastUpdated: '', venue: '', ...overrides,
});

describe('attendance predictor', () => {
  it('projects present, absent and ignore without mutating VTOP records', () => {
    const classes = [slot({ id: 'present' }), slot({ id: 'absent', startTime: '09:00' }), slot({ id: 'ignore', startTime: '10:00' })];
    const records = [record()];
    const projection = projectAttendance(classes, records, { present: 'present', absent: 'absent', ignore: 'ignore' });

    expect(projection.courses[0]).toMatchObject({ currentAttended: 8, currentTotal: 10, projectedAttended: 9, projectedTotal: 12, currentPercentage: 80, projectedPercentage: 75 });
    expect(records[0]).toMatchObject({ attended: 8, totalHeld: 10, percentage: 80 });
  });

  it('does not guess when duplicate course rows cannot be disambiguated', () => {
    const records = [record({ slot: 'A1' }), record({ slot: 'B1' })];
    expect(matchAttendanceRecord(slot({ slot: '' }), records)).toBeNull();
    expect(matchAttendanceRecord(slot({ slot: 'B1' }), records)).toBe(1);
  });

  it('keeps unmatched classes explicitly unavailable', () => {
    const projection = projectAttendance([slot({ courseCode: 'UNKNOWN' })], [record()]);
    expect(projection.classes[0].mapping).toBe('unavailable');
    expect(projection.classes[0].attendanceIndex).toBeNull();
  });

  it('marks a two-period lab as two VTOP periods, not one', () => {
    // VTOP stores periods: the lab attendance row has 18 held for nine
    // sessions. One absence therefore removes two periods, not one.
    const lab = slot({
      id: 'lab', courseCode: 'CSE2001L', slot: 'L31+L32',
      startTime: '14:00', endTime: '15:40', isLab: true,
    });
    const labRecord = record({
      courseCode: 'CSE2001L', type: 'ELA', slot: 'L31+L32',
      attended: 16, totalHeld: 18, percentage: 88.9,
    });
    const projection = projectAttendance([lab], [labRecord], { lab: 'absent' });
    expect(projection.courses[0]).toMatchObject({
      projectedAttended: 16, projectedTotal: 20, projectedPercentage: 80,
    });
  });

  it('combines the raw L31 / L32 pair before counting it', () => {
    const raw = [
      slot({ id: 'l1', courseCode: 'CSE2001L', slot: 'L31', startTime: '14:00', endTime: '14:50', isLab: true }),
      slot({ id: 'l2', courseCode: 'CSE2001L', slot: 'L32', startTime: '14:50', endTime: '15:40', isLab: true }),
    ];
    const labRecord = record({
      courseCode: 'CSE2001L', type: 'ELA', slot: 'L31+L32',
      attended: 16, totalHeld: 18, percentage: 88.9,
    });
    const projection = projectAttendance(raw, [labRecord], { l1: 'present' });
    // One session, one mark, two periods — never four.
    expect(projection.classes).toHaveLength(1);
    expect(projection.courses[0]).toMatchObject({ projectedAttended: 18, projectedTotal: 20 });
  });
});
