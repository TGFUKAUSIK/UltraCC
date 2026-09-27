import { describe, it, expect, beforeEach } from 'vitest';
import { vtopDb } from '../../db/vtopDatabase';
import { StudentProfile, AttendanceRecord } from '../types';

const profile: StudentProfile = {
  registrationNo: '23BCE1082',
  name: 'Kausik',
  program: 'B.Tech',
  branch: 'CSE',
  school: 'SCOPE',
  semester: 'Semester 4',
  cgpa: 8.92,
  proctorName: 'Dr. R',
  proctorEmail: 'r@vit.ac.in',
  proctorMobile: '',
};

const attendance: AttendanceRecord[] = [
  {
    courseCode: 'CSE2001',
    courseTitle: 'DSA',
    courseType: 'ETH',
    slot: 'A1',
    facultyName: 'Dr. V',
    attended: 28,
    totalHeld: 32,
    percentage: 87.5,
    category: 'Theory',
    lastUpdated: '2026-08-10',
  },
];

describe('vtopDatabase (IndexedDB persistence)', () => {
  beforeEach(async () => {
    await vtopDb.clear();
  });

  it('round-trips saved data with LIVE_VTOP metadata', async () => {
    await vtopDb.saveAllData(
      { profile, attendance, timetable: [], marks: [], exams: [], assignments: [], semesters: [] },
      'LIVE_VTOP',
      'CH2025261',
      '23BCE1082'
    );

    const cached = await vtopDb.getAllData();
    expect(cached).not.toBeNull();
    expect(cached!.profile).toMatchObject({ registrationNo: '23BCE1082', name: 'Kausik' });
    expect(cached!.attendance).toHaveLength(1);
    expect(cached!.metadata.syncSource).toBe('LIVE_VTOP');
    expect(cached!.metadata.selectedSemesterId).toBe('CH2025261');
    expect(cached!.metadata.registrationNo).toBe('23BCE1082');
    expect(cached!.metadata.lastSyncedAt).toBeGreaterThan(0);
  });

  it('distinguishes demo saves', async () => {
    await vtopDb.saveAllData({ profile, attendance }, 'DEMO_MODE');
    const cached = await vtopDb.getAllData();
    expect(cached!.metadata.syncSource).toBe('DEMO_MODE');
  });

  it('returns null when nothing was ever saved', async () => {
    await vtopDb.clear();
    const cached = await vtopDb.getAllData();
    expect(cached).toBeNull();
  });

  it('clears all stores', async () => {
    await vtopDb.saveAllData({ profile, attendance }, 'LIVE_VTOP');
    await vtopDb.clear();
    const cached = await vtopDb.getAllData();
    expect(cached).toBeNull();
  });
});
