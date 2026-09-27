import { describe, expect, it } from 'vitest';
import type { AttendanceRecord, TimetableSlot } from '../../types';
import { matchAttendanceRecord, projectAttendance } from '../attendancePredictor';

const slot = (overrides: Partial<TimetableSlot> = {}): TimetableSlot => ({
  id: 'class-1', courseCode: 'CSE2001', courseTitle: 'Networks', slot: 'A1', facultyName: 'Faculty', venue: 'AB1-101', building: 'AB1', roomNo: '101', day: 'Monday', startTime: '08:00', endTime: '08:50', isLab: false, ...overrides,
});

const record = (overrides: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  courseCode: 'CSE2001', courseTitle: 'Networks', type: 'TH', slot: 'A1', facultyName: 'Faculty', attended: 8, totalHeld: 10, percentage: 80, category: 'Safe', lastUpdated: '', venue: '', ...overrides,
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
});
