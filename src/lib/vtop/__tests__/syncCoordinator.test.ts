import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependencies of the coordinator so tests never touch the network
// or IndexedDB.
vi.mock('../../db/vtopDatabase', () => ({
  vtopDb: { getAllData: vi.fn() },
}));

const mockSyncSemesterData = vi.fn();
vi.mock('../syncSemester', () => ({
  pickSemesterId: vi.fn((savedId: string, semesters: { id: string }[]) => {
    if (!semesters.length) return '';
    if (savedId && semesters.some((s) => s.id === savedId)) return savedId;
    return semesters.find((s) => (s as { isCurrent?: boolean }).isCurrent)?.id || semesters[0]!.id;
  }),
  syncSemesterData: (...args: unknown[]) => mockSyncSemesterData(...args),
}));

const mockIsLiveSessionActive = vi.fn();
const mockGetLiveClient = vi.fn();
vi.mock('../liveSession', () => ({
  isLiveSessionActive: () => mockIsLiveSessionActive(),
  getLiveClient: () => mockGetLiveClient(),
}));

import { vtopDb } from '../../db/vtopDatabase';
import {
  DEFAULT_TTL_HOURS,
  getFreshnessTtlMs,
  setFreshnessTtlHours,
  isDataStale,
  isSyncInFlight,
  refreshVtopData,
  _resetCoordinatorForTests,
} from '../syncCoordinator';

const mockedGetAllData = vi.mocked(vtopDb.getAllData);

beforeEach(() => {
  _resetCoordinatorForTests();
  vi.clearAllMocks();
  localStorage.clear();
  mockIsLiveSessionActive.mockReturnValue(true);
  mockGetLiveClient.mockReturnValue({ getSemesters: vi.fn().mockResolvedValue([]) });
  mockedGetAllData.mockResolvedValue({ metadata: { selectedSemesterId: '' } } as never);
  mockSyncSemesterData.mockResolvedValue([]);
});

describe('freshness policy', () => {
  it('defaults to the 6-hour TTL', () => {
    expect(getFreshnessTtlMs()).toBe(DEFAULT_TTL_HOURS * 60 * 60 * 1000);
  });

  it('persists a configured TTL', () => {
    setFreshnessTtlHours(2);
    expect(getFreshnessTtlMs()).toBe(2 * 60 * 60 * 1000);
  });

  it('rejects an impossible TTL and falls back to the default', () => {
    localStorage.setItem('ultracc:syncTtlHours', '9999');
    expect(getFreshnessTtlMs()).toBe(DEFAULT_TTL_HOURS * 60 * 60 * 1000);
    localStorage.setItem('ultracc:syncTtlHours', 'junk');
    expect(getFreshnessTtlMs()).toBe(DEFAULT_TTL_HOURS * 60 * 60 * 1000);
  });
});

describe('isDataStale', () => {
  const HOUR = 3_600_000;

  it('treats a missing sync timestamp as stale', () => {
    expect(isDataStale(null)).toBe(true);
  });

  it('treats a recent sync as fresh', () => {
    expect(isDataStale(Date.now() - 5 * 60 * 1000)).toBe(false);
  });

  it('treats data older than the TTL as stale', () => {
    expect(isDataStale(Date.now() - DEFAULT_TTL_HOURS * HOUR - 1)).toBe(true);
  });
});

describe('refreshVtopData', () => {
  it('refuses to refresh without a live session', async () => {
    mockIsLiveSessionActive.mockReturnValue(false);
    const ok = await refreshVtopData({ reason: 'manual', force: true });
    expect(ok).toBe(false);
    expect(mockSyncSemesterData).not.toHaveBeenCalled();
  });

  it('prevents concurrent duplicate syncs (single flight)', async () => {
    let resolveFirst!: (value?: unknown) => void;
    mockSyncSemesterData.mockImplementation(
      () =>
        new Promise((res) => {
          resolveFirst = res;
        }),
    );

    const first = refreshVtopData({ reason: 'manual', force: true });
    // The coordinator marks itself in-flight synchronously.
    expect(isSyncInFlight()).toBe(true);
    // Let the first call get past the cache read and into the sync itself.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSyncSemesterData).toHaveBeenCalledTimes(1);

    // While the first refresh is still pending, a second call must be refused.
    const second = await refreshVtopData({ reason: 'focus' });
    expect(second).toBe(false);
    expect(mockSyncSemesterData).toHaveBeenCalledTimes(1);

    resolveFirst();
    await first;
    expect(isSyncInFlight()).toBe(false);
  });

  it('runs a sync and reports synced status on success', async () => {
    const ok = await refreshVtopData({ reason: 'manual', force: true });
    expect(ok).toBe(true);
    expect(mockSyncSemesterData).toHaveBeenCalledTimes(1);
  });

  it('does not mark an all-failed refresh as synced or advance the timestamp', async () => {
    const previous = Date.now() - 10 * 60 * 1000;
    mockedGetAllData.mockResolvedValue({ metadata: { selectedSemesterId: '', lastSyncedAt: previous } } as never);
    mockSyncSemesterData.mockResolvedValue([
      { key: 'attendance', label: 'Attendance', ok: false, error: 'gateway down' },
      { key: 'marks', label: 'Marks', ok: false, error: 'gateway down' },
    ]);

    const ok = await refreshVtopData({ reason: 'manual', force: true });
    expect(ok).toBe(true);
    const { getSyncCoordinatorState } = await import('../syncCoordinator');
    expect(getSyncCoordinatorState().status).toBe('error');
    expect(getSyncCoordinatorState().lastSyncedAt).toBe(previous);
  });

  it('marks a mixed refresh as partial and advances only when something succeeded', async () => {
    mockSyncSemesterData.mockResolvedValue([
      { key: 'attendance', label: 'Attendance', ok: true },
      { key: 'marks', label: 'Marks', ok: false, error: 'unavailable' },
    ]);

    await refreshVtopData({ reason: 'manual', force: true });
    const { getSyncCoordinatorState } = await import('../syncCoordinator');
    expect(getSyncCoordinatorState().status).toBe('partial');
    expect(getSyncCoordinatorState().lastSyncedAt).toEqual(expect.any(Number));
  });

  it('reports error status when the sync throws', async () => {
    mockSyncSemesterData.mockRejectedValue(new Error('gateway down'));
    const ok = await refreshVtopData({ reason: 'manual', force: true });
    expect(ok).toBe(false);
  });
});
