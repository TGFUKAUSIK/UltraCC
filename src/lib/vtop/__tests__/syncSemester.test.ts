import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickSemesterId, syncSemesterData } from '../syncSemester';
import { vtopDb } from '../../db/vtopDatabase';
import type { SemesterInfo } from '../types';

const SEMESTERS: SemesterInfo[] = [
  { id: 'WS202526', name: 'Winter Semester 2025-26', isCurrent: true },
  { id: 'FS202526', name: 'Fall Semester 2025-26', isCurrent: false },
  { id: 'WS202425', name: 'Winter Semester 2024-25', isCurrent: false },
];

describe('pickSemesterId', () => {
  it('prefers the saved selection when it still exists in VTOP list', () => {
    expect(pickSemesterId('FS202526', SEMESTERS)).toBe('FS202526');
  });

  it('never silently overwrites a saved selection with the active semester', () => {
    expect(pickSemesterId('WS202425', SEMESTERS)).toBe('WS202425');
  });

  it('falls back to the active semester when no saved selection', () => {
    expect(pickSemesterId('', SEMESTERS)).toBe('WS202526');
  });

  it('falls back to the first option when the saved id is stale', () => {
    expect(pickSemesterId('OLD000000', SEMESTERS)).toBe('WS202526');
  });

  it('returns empty for an empty list', () => {
    expect(pickSemesterId('anything', [])).toBe('');
  });
});

/** The genuine cache writer, captured before the spy below replaces it. */
const realSave = vtopDb.saveAllData.bind(vtopDb);
// One spy for the whole file: a second vi.spyOn would shadow the first and
// both describe blocks would then disagree about what was recorded.
const saveSpy = vi.spyOn(vtopDb, 'saveAllData').mockResolvedValue(undefined);

describe('syncSemesterData', () => {
  const makeClient = () => ({
    getProfile: vi.fn().mockResolvedValue({ name: 'Test', registrationNo: '23BCE0000' }),
    getAttendance: vi.fn().mockResolvedValue([{ courseCode: 'CSE2001', attended: 20, totalHeld: 25, percentage: 80 }]),
    getTimetable: vi.fn().mockResolvedValue([
      { id: 'Mon-A1-CSE2001-0', slot: 'A1', courseCode: 'CSE2001', courseTitle: 'Data Structures', facultyName: 'Dr. X', venue: 'SJT 102', startTime: '08:00', endTime: '08:50', day: 'Monday' },
    ]),
    getMarks: vi.fn().mockResolvedValue([]),
    getExams: vi.fn().mockResolvedValue([
      { id: 'e1', slot: 'A1', examType: 'CAT 2', date: '2026-08-18', time: '10:00', venue: 'SJT 402', seatNo: 'R3D12' },
    ]),
    getAssignments: vi.fn().mockResolvedValue([]),
    getGrades: vi.fn().mockResolvedValue({ available: true, cgpa: 8.9, creditsRegistered: 86, creditsEarned: 78 }),
    getGradeHistory: vi.fn().mockResolvedValue({
      available: true,
      cgpa: 8.9,
      creditsRegistered: 86,
      creditsEarned: 78,
      gradeCounts: { S: 3, A: 2, B: 0, C: 0, D: 0, E: 0, F: 0, N: 0 },
      effectiveGrades: [],
    }),
    getSemesterGrades: vi.fn().mockResolvedValue({
      available: true,
      gpa: 8.9,
      grades: [{ courseCode: 'CSE2001', courseTitle: 'Data Structures', courseType: 'ETH', grandTotal: 88, grade: 'A' }],
    }),
    getOd: vi.fn().mockResolvedValue({ available: true, limitHours: 40, totalOdHours: 6, perCourse: [] }),
    getCalendar: vi.fn().mockResolvedValue({
      available: true,
      months: [{ token: '01-AUG-2026', monthKey: '2026-08' }],
      days: [{ date: '2026-08-15', instructional: false, dayOrder: null, label: 'Independence Day' }],
    }),
    getArrears: vi.fn().mockResolvedValue([]),
    getCirculars: vi.fn().mockResolvedValue([]),
    getCurriculum: vi.fn().mockResolvedValue({
      available: true,
      totals: { creditsRequired: 160, creditsEarned: 78, creditsRegistered: 86, cgpa: 8.9 },
      distributionTypes: [],
      baskets: [],
      gradeCounts: { S: 3, A: 2, B: 0, C: 0, D: 0, E: 0, F: 0, N: 0 },
    }),
    getMakeupExams: vi.fn().mockResolvedValue([]),
    getRefat: vi.fn().mockResolvedValue({ available: false, status: '', message: '', semesters: [] }),
    getCompre: vi.fn().mockResolvedValue({ available: false, status: '', message: '' }),
    getPayments: vi.fn().mockResolvedValue({ title: 'Payments', hasDues: false, rows: [], message: 'No dues', registerNumber: '', studentName: '', programme: '', campus: '' }),
    getCredentials: vi.fn().mockResolvedValue({ title: 'My Accounts', credentials: [] }),
    getTransport: vi.fn().mockResolvedValue({ hasRegistration: false, registerNumber: '', name: '', programme: '', branch: '', routeSelected: '', fpReference: '', paymentStatus: '', busRouteId: '', qrCode: '', rows: [] }),
    getSapInfo: vi.fn().mockResolvedValue({ title: '', rows: [], message: '', available: false }),
    getPaymentReceipts: vi.fn().mockResolvedValue({ title: '', receipts: [], available: false }),
    searchEmployee: vi.fn().mockResolvedValue({ title: '', fields: [], message: '', found: false }),
    getBankInfo: vi.fn().mockResolvedValue({ title: '', rows: [], message: '', available: false }),
    getBiometricInfo: vi.fn().mockResolvedValue({ title: '', rows: [], message: '', available: false }),
    getProctorMessages: vi.fn().mockResolvedValue([]),
    getLoginHistory: vi.fn().mockResolvedValue([]),
    getClassMessages: vi.fn().mockResolvedValue([]),
    getHodDean: vi.fn().mockResolvedValue({ title: '', rows: [], available: false }),
    getWallet: vi.fn().mockResolvedValue({ title: '', rows: [], message: '', available: false }),
    getExtraCurricular: vi.fn().mockResolvedValue({ title: '', rows: [], available: false }),
  });

  beforeEach(() => {
    saveSpy.mockClear();
  });

  it('fetches every dataset for the given semester and persists it atomically', async () => {
    const client = makeClient();
    await syncSemesterData(client as any, 'WS202526', SEMESTERS);

    expect(client.getAttendance).toHaveBeenCalledWith('WS202526');
    expect(client.getTimetable).toHaveBeenCalledWith('WS202526');
    expect(client.getMarks).toHaveBeenCalledWith('WS202526');
    expect(client.getExams).toHaveBeenCalledWith('WS202526');
    expect(client.getOd).toHaveBeenCalledWith('WS202526');

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [payload, source, semId, regNo] = saveSpy.mock.calls[0] as any[];
    expect(source).toBe('LIVE_VTOP');
    expect(semId).toBe('WS202526');
    expect(regNo).toBe('23BCE0000');
    expect(payload.semesters).toBe(SEMESTERS);
    expect(payload.grades.cgpa).toBe(8.9);
    expect(payload.gradeHistory.cgpa).toBe(8.9);
    expect(payload.semesterGrades.gpa).toBe(8.9);
    expect(client.getGradeHistory).toHaveBeenCalled();
    expect(client.getSemesterGrades).toHaveBeenCalledWith('WS202526');
    expect(client.getCalendar).toHaveBeenCalled();
    expect(client.getArrears).toHaveBeenCalled();
    expect(client.getCirculars).toHaveBeenCalled();
    expect(client.getCurriculum).toHaveBeenCalled();
    expect(client.getMakeupExams).toHaveBeenCalled();
    expect(client.getRefat).toHaveBeenCalled();
    expect(client.getCompre).toHaveBeenCalled();
    expect(payload.calendar.available).toBe(true);
    expect(payload.curriculum.totals.creditsRequired).toBe(160);
  });

  it('joins exam course codes from the SAME semester timetable (never another semester)', async () => {
    const client = makeClient();
    await syncSemesterData(client as any, 'WS202526', SEMESTERS);

    const payload = saveSpy.mock.calls[0]![0] as any;
    expect(payload.exams[0].courseCode).toBe('CSE2001');
    expect(payload.exams[0].courseTitle).toBe('Data Structures');
  });

  it('propagates a failed dataset as an empty value instead of aborting the whole sync', async () => {
    const client = makeClient();
    client.getAttendance = vi.fn().mockRejectedValue(new Error('boom'));
    await syncSemesterData(client as any, 'WS202526', SEMESTERS);
    const payload = saveSpy.mock.calls[0]![0] as any;
    expect(payload.attendance).toEqual([]);
    expect(payload.timetable.length).toBe(1);
  });

  it('reports an unwritable local cache as a failed dataset instead of failing the login', async () => {
    const client = makeClient();
    saveSpy.mockRejectedValueOnce(new Error('QuotaExceededError: storage is full'));

    const results = await syncSemesterData(client as any, 'WS202526', SEMESTERS);

    const cache = results.find((r) => r.key === 'cache');
    expect(cache?.ok).toBe(false);
    expect(cache?.error).toContain('could not be saved on this device');
    // Everything VTOP answered is still reported as synced — the student is
    // signed in, only persistence broke.
    expect(results.find((r) => r.key === 'timetable')?.ok).toBe(true);
  });

  it('does not relabel the previous semester’s rows as the new semester’s when a fetch fails', async () => {
    const client = makeClient();
    client.getAttendance = vi.fn().mockRejectedValue(new Error('VTOP timed out'));
    const cacheSpy = vi.spyOn(vtopDb, 'getAllData').mockResolvedValue({
      metadata: { registrationNo: '23BCE0000', selectedSemesterId: 'WS202425' },
      attendance: [{ courseCode: 'OLD1001', attended: 5, totalHeld: 6, percentage: 83 }],
    } as any);

    const results = await syncSemesterData(client as any, 'WS202526', SEMESTERS);
    cacheSpy.mockRestore();

    const payload = saveSpy.mock.calls[0]![0] as any;
    // Winter 2024-25's attendance must never be stored under Winter 2025-26.
    expect(payload.attendance).toEqual([]);
    // …and the failure stays visible instead of passing as synced data.
    expect(results.find((r) => r.key === 'attendance')?.ok).toBe(false);
  });

  it('keeps the previous cache for the SAME semester when a fetch fails', async () => {
    const client = makeClient();
    client.getAttendance = vi.fn().mockRejectedValue(new Error('VTOP timed out'));
    const cacheSpy = vi.spyOn(vtopDb, 'getAllData').mockResolvedValue({
      metadata: { registrationNo: '23BCE0000', selectedSemesterId: 'WS202526' },
      attendance: [{ courseCode: 'CSE2001', attended: 20, totalHeld: 25, percentage: 80 }],
    } as any);

    await syncSemesterData(client as any, 'WS202526', SEMESTERS);
    cacheSpy.mockRestore();

    const payload = saveSpy.mock.calls[0]![0] as any;
    // Same term, same student: an outage shows stale-but-true rows, not an empty term.
    expect(payload.attendance).toEqual([{ courseCode: 'CSE2001', attended: 20, totalHeld: 25, percentage: 80 }]);
  });
});

describe('account isolation across a shared device', () => {
  const makeClient = (registrationNo: string) => ({
    getProfile: vi.fn().mockResolvedValue({ name: 'B', registrationNo }),
    getAttendance: vi.fn().mockResolvedValue([]),
    getTimetable: vi.fn().mockResolvedValue([]),
    getMarks: vi.fn().mockResolvedValue([]),
    getExams: vi.fn().mockResolvedValue([]),
    getAssignments: vi.fn().mockResolvedValue([]),
    getGrades: vi.fn().mockResolvedValue({ available: false, cgpa: null, creditsRegistered: 0, creditsEarned: 0 }),
    getGradeHistory: vi.fn().mockResolvedValue({ available: false, cgpa: null, creditsRegistered: 0, creditsEarned: 0, gradeCounts: {}, effectiveGrades: [] }),
    getSemesterGrades: vi.fn().mockResolvedValue({ available: false, gpa: null, grades: [] }),
    getOd: vi.fn().mockResolvedValue({ available: false, limitHours: 0, totalOdHours: 0, perCourse: [] }),
    getCalendar: vi.fn().mockResolvedValue({ available: false, months: [], days: [] }),
    getArrears: vi.fn().mockResolvedValue([]),
    getCirculars: vi.fn().mockResolvedValue([]),
    getCurriculum: vi.fn().mockResolvedValue({ available: false, subjects: [], totals: { creditsRequired: 0 } }),
    getMakeupExams: vi.fn().mockResolvedValue({ available: false, rows: [] }),
    getRefat: vi.fn().mockResolvedValue({ available: false, status: '', message: '', semesters: [] }),
    getCompre: vi.fn().mockResolvedValue({ available: false, status: '', message: '' }),
    getPayments: vi.fn().mockResolvedValue({ title: '', hasDues: false, rows: [], message: '', registerNumber: '', studentName: '', programme: '', campus: '' }),
    getCredentials: vi.fn().mockResolvedValue({ title: '', credentials: [] }),
    getTransport: vi.fn().mockResolvedValue({ hasRegistration: false, registerNumber: '', name: '', programme: '', branch: '', routeSelected: '', fpReference: '', paymentStatus: '', busRouteId: '', qrCode: '', rows: [] }),
    getSapInfo: vi.fn().mockResolvedValue({ title: '', rows: [], message: '', available: false }),
    getPaymentReceipts: vi.fn().mockResolvedValue({ title: '', receipts: [], available: false }),
    searchEmployee: vi.fn().mockResolvedValue({ title: '', fields: [], message: '', found: false }),
    getBankInfo: vi.fn().mockResolvedValue({ title: '', rows: [], message: '', available: false }),
    getBiometricInfo: vi.fn().mockResolvedValue({ title: '', rows: [], message: '', available: false }),
    getProctorMessages: vi.fn().mockResolvedValue([]),
    getLoginHistory: vi.fn().mockResolvedValue([]),
    getClassMessages: vi.fn().mockResolvedValue([]),
    getHodDean: vi.fn().mockResolvedValue({ title: '', rows: [], available: false }),
    getWallet: vi.fn().mockResolvedValue({ title: '', rows: [], message: '', available: false }),
    getExtraCurricular: vi.fn().mockResolvedValue({ title: '', rows: [], available: false }),
  });

  beforeEach(async () => {
    saveSpy.mockClear();
    await vtopDb.clearVtopStores();
    // Student A signs in on this device and their private records are cached.
    await realSave({
      profile: { registrationNo: '23BCE9999', name: 'Alpha' } as any,
      bankInfo: { title: 'Bank', rows: [{ label: 'A/C', value: '9999-SECRET' }], message: '', available: true } as any,
      wallet: { title: 'Wallet', rows: [{ label: 'Balance', value: 'Rs. 4,000' }], message: '', available: true } as any,
      proctorMessages: [{ subject: 'About Alpha', body: 'private note', sender: 'Proctor', date: '2026-09-01' }] as any,
    } as any, 'LIVE_VTOP', 'WS202526', '23BCE9999');
  });

  it('drops the previous student’s private datasets when a different reg no syncs', async () => {
    const client = makeClient('23BCE0000');
    await syncSemesterData(client as any, 'WS202526', SEMESTERS);

    const payload = saveSpy.mock.calls[0]![0] as any;
    expect(payload.bankInfo?.rows ?? []).toEqual([]);
    expect(payload.wallet?.rows ?? []).toEqual([]);
    expect(payload.proctorMessages ?? []).toEqual([]);
    expect(payload.metadata?.registrationNo ?? '23BCE0000').toBe('23BCE0000');
  });

  it('clears A’s cached rows from IndexedDB instead of leaving them readable', async () => {
    await syncSemesterData(makeClient('23BCE0000') as any, 'WS202526', SEMESTERS);
    const cached = await vtopDb.getAllData();
    const rows = JSON.stringify(cached?.bankInfo ?? {});
    expect(rows).not.toContain('9999-SECRET');
    expect(JSON.stringify(cached?.proctorMessages ?? [])).not.toContain('private note');
  });

  it('keeps the stale-cache fallback for the SAME student when a dataset fails', async () => {
    const client = makeClient('23BCE9999');
    client.getBankInfo = vi.fn().mockRejectedValue(new Error('VTOP timed out'));
    await syncSemesterData(client as any, 'WS202526', SEMESTERS);
    const payload = saveSpy.mock.calls[0]![0] as any;
    // Same account: a failed request must not wipe A's own intact cache.
    expect(payload.bankInfo.rows[0].value).toBe('9999-SECRET');
  });
});
