/**
 * A database created by an older build can already be at the current version
 * while missing stores that were added later — `onupgradeneeded` never runs
 * when the version matches. Passing those missing names to `db.transaction()`
 * threw NotFoundError, which made the whole cache read as "never synced" and
 * made every sync fail at the save step, so signing in looked broken.
 */
import { describe, expect, it } from 'vitest';

const DB_NAME = 'VitUniCCDatabase';
/**
 * A stale database: one already at the version this build opens at, holding
 * only the first build's stores. Kept in step with DB_VERSION on purpose — if
 * they drift, this test's premise ("the upgrade never ran") is false and the
 * missing-store behaviour it pins is no longer what a real browser hits.
 */
const CURRENT_VERSION = 13;

function openStaleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, CURRENT_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Only what the very first build had.
      db.createObjectStore('profile', { keyPath: 'registrationNo' });
      db.createObjectStore('attendance', { keyPath: 'courseCode' });
      db.createObjectStore('metadata', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function openAndCloseStaleSchema(): Promise<void> {
  const db = await openStaleDatabase();
  db.close();
}

describe('cache on a database with an old schema', () => {
  it('fails on the missing store unless the transaction is limited to real stores', async () => {
    const db = await openStaleDatabase();
    try {
      // The premise of the fix: naming a store the database never gained
      // throws synchronously and takes the whole transaction — every dataset
      // in the sync — down with it.
      expect(() => db.transaction(['profile', 'wallet'], 'readwrite')).toThrow();
      expect(() => db.transaction(['profile', 'attendance'], 'readwrite')).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('saves and reads without throwing when stores the code knows about are missing', async () => {
    await openAndCloseStaleSchema();
    // Imported only after the stale database exists: the singleton opens its
    // connection at import time and never closes it.
    const { vtopDb } = await import('../vtopDatabase');

    await expect(
      vtopDb.saveAllData(
        {
          profile: { registrationNo: '21BCE9999', name: 'Student' } as never,
          attendance: [{ courseCode: 'CHEL1001', facultyName: 'F', attendancePercentage: 90 } as never],
        },
        'LIVE_VTOP',
        'SEM-1',
        '21BCE9999'
      )
    ).resolves.toBeUndefined();

    const cached = await vtopDb.getAllData();
    expect(cached).not.toBeNull();
    expect(cached!.profile?.name).toBe('Student');
    expect(cached!.attendance.map((a) => a.courseCode)).toEqual(['CHEL1001']);
    // Datasets whose store does not exist are absent, not fatal.
    expect(cached!.timetable).toEqual([]);
    expect(cached!.metadata.selectedSemesterId).toBe('SEM-1');

    await expect(vtopDb.clearVtopStores()).resolves.toBeUndefined();
    expect(await vtopDb.getAllData()).toBeNull();
  });
});
