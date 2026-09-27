/**
 * Sync coordinator — the single source of truth for VTOP refresh state.
 *
 * Owns: freshness/staleness policy, duplicate-sync prevention, background
 * auto-refresh (startup / focus / reconnect / manual), and a subscribable
 * status the UI shell renders as a global "Refreshing VTOP… / Updated X ago"
 * indicator.
 *
 * Security: this NEVER touches credentials. It only drives refreshes through
 * an already-established in-memory VTOP session (getLiveClient). If no live
 * session exists, refresh requests are refused — the UI then prompts the user
 * to sign in again instead of silently doing nothing.
 */

import { vtopDb } from '../db/vtopDatabase';
import { getLiveClient, isLiveSessionActive } from './liveSession';
import { pickSemesterId, syncSemesterData, type SyncDatasetResult } from './syncSemester';
import { toastSync, toastError } from '../toast';
import { humanErrorCopy } from '../errorCopy';

export type SyncCoordinatorStatus =
  | 'idle' // never synced / nothing to show yet
  | 'refreshing' // a refresh is running right now
  | 'synced' // last refresh completed cleanly
  | 'partial' // last refresh completed with some dataset failures
  | 'error' // last refresh failed outright
  | 'offline'; // refresh refused because the device is offline

export interface SyncCoordinatorState {
  status: SyncCoordinatorStatus;
  /** When the last successful VTOP sync finished (ms epoch). */
  lastSyncedAt: number | null;
  /** When the current/last refresh started (ms epoch). */
  startedAt: number | null;
  /** When the current/last refresh finished (ms epoch). */
  finishedAt: number | null;
  /** Human-readable reason the last refresh ran (startup / focus / reconnect / manual). */
  reason: string | null;
  error: string | null;
  results: SyncDatasetResult[] | null;
}

export const DEFAULT_TTL_HOURS = 6;
/** Background attempts are deliberately sparse; manual refresh remains immediate. */
export const AUTO_REFRESH_COOLDOWN_MS = DEFAULT_TTL_HOURS * 60 * 60 * 1000;
const TTL_KEY = 'ultracc:syncTtlHours';

type Listener = (s: SyncCoordinatorState) => void;

let state: SyncCoordinatorState = {
  status: 'idle',
  lastSyncedAt: null,
  startedAt: null,
  finishedAt: null,
  reason: null,
  error: null,
  results: null,
};

const listeners = new Set<Listener>();
let inFlight = false;
let lastAutoRefreshAt = 0;

export function getSyncCoordinatorState(): SyncCoordinatorState {
  return state;
}

export function subscribeSyncCoordinator(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setState(patch: Partial<SyncCoordinatorState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      // a subscriber must never break the coordinator
    }
  });
}

/** True while a refresh (manual or automatic) is running. */
export function isSyncInFlight(): boolean {
  return inFlight;
}

export function getFreshnessTtlMs(): number {
  try {
    const raw = localStorage.getItem(TTL_KEY);
    const hours = raw ? Number(raw) : NaN;
    if (Number.isFinite(hours) && hours > 0 && hours <= 168) return hours * 60 * 60 * 1000;
  } catch {
    // localStorage unavailable — fall back to default
  }
  return DEFAULT_TTL_HOURS * 60 * 60 * 1000;
}

export function setFreshnessTtlHours(hours: number): void {
  try {
    localStorage.setItem(TTL_KEY, String(hours));
  } catch {
    // ignore
  }
}

/** True when the last sync is older than the configured freshness TTL. */
export function isDataStale(lastSyncedAt: number | null, now = Date.now()): boolean {
  if (!lastSyncedAt) return true;
  return now - lastSyncedAt > getFreshnessTtlMs();
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export interface RefreshOptions {
  reason: string;
  /** Force a refresh even when data is fresh (manual refresh). */
  force?: boolean;
  /** Sync this semester instead of the saved/current one. */
  semesterId?: string;
  /**
   * Called after the sync saves to IndexedDB so the caller can reload UI
   * state from cache. Receives the per-dataset results.
   */
  onData?: (results: SyncDatasetResult[], semId: string) => Promise<void> | void;
}

/**
 * Refresh the selected semester from VTOP using the in-memory session.
 * Refuses (returns false, no-op) when:
 *   - a refresh is already running (duplicate-sync prevention), or
 *   - the device is offline, or
 *   - no live VTOP session exists (session must be established by login first).
 */
export async function refreshVtopData(opts: RefreshOptions): Promise<boolean> {
  if (inFlight) return false;
  if (isOffline()) {
    setState({ status: 'offline', reason: opts.reason, error: 'Offline — showing your last synced data.' });
    toastError('Offline — showing your last synced data', { duration: 3000 });
    return false;
  }
  if (!isLiveSessionActive()) {
    // Not an error state per se: there is simply no session to refresh with.
    setState({ status: 'idle', reason: opts.reason, error: 'No live VTOP session.' });
    return false;
  }

  inFlight = true;
  // The cooldown starts when a run actually begins. Consuming it before the
  // guards above spent a 6-hour window on attempts that never ran.
  lastAutoRefreshAt = Date.now();
  setState({
    status: 'refreshing',
    startedAt: Date.now(),
    finishedAt: null,
    reason: opts.reason,
    error: null,
    results: null,
  });

  // Show sync start toast
  if (opts.reason !== 'startup') {
    toastSync('vtop-sync', 'Refreshing VTOP data…');
  }

  try {
    const client = getLiveClient();
    const cached = await vtopDb.getAllData();
    const savedSemId = cached?.metadata?.selectedSemesterId || '';
    const clientSemesters = await client.getSemesters();
    const semId = opts.semesterId || pickSemesterId(savedSemId, clientSemesters);
    const results = await syncSemesterData(client, semId, clientSemesters);
    const failed = results.filter((r) => !r.ok);
    const succeeded = results.filter((r) => r.ok);
    // VTOP can take the session back while a sync is running. A run that ended
    // signed out is never "all data up to date", because the datasets after the
    // death were never fetched — and every screen that asks VTOP next will say
    // "sign in". Say the same thing here, or the toast and the tab disagree.
    const sessionGone = !isLiveSessionActive();
    const now = Date.now();
    const lastKnownGoodSync = state.lastSyncedAt ?? cached?.metadata?.lastSyncedAt ?? null;
    setState({
      // A run with no successful dataset is an error, not a successful sync.
      // Keep the previous timestamp so the UI never describes stale cache as
      // freshly synced after an outage.
      status: sessionGone
        ? (succeeded.length ? 'partial' : 'error')
        : failed.length === 0 ? 'synced' : succeeded.length === 0 ? 'error' : 'partial',
      lastSyncedAt: succeeded.length > 0 ? now : lastKnownGoodSync,
      finishedAt: now,
      error: sessionGone
        ? 'VTOP signed this tab out during the sync — sign in again to finish it.'
        : failed.length ? `${failed.length} section${failed.length === 1 ? '' : 's'} didn't update — your previously saved data is still shown where possible.` : null,
      results,
    });
    // Show completion toast
    if (sessionGone) {
      toastSync('vtop-sync', 'VTOP signed out during the sync', {
        error: true,
        detail: 'Sign in again and the rest of the data will refresh.',
      });
    } else if (failed.length === 0) {
      toastSync('vtop-sync', 'All data up to date ✓', { complete: true });
    } else if (succeeded.length > 0) {
      const failedNames = failed.map((r) => r.label).slice(0, 3).join(', ');
      toastSync('vtop-sync', `${failed.length} dataset${failed.length === 1 ? '' : 's'} couldn't refresh`, {
        error: true,
        detail: failedNames + (failed.length > 3 ? ` +${failed.length - 3} more` : ''),
      });
    } else {
      toastSync('vtop-sync', 'VTOP data could not be refreshed', {
        error: true,
        detail: 'Your previous cached data is still being shown.',
      });
      
    }
    if (opts.onData) await opts.onData(results, semId);
    return true;
  } catch (err) {
    // The panel/toast show human copy (brief §8); VTOP's own curated
    // VtopError messages pass through, transport noise is replaced.
    const copy = humanErrorCopy(err, 'VTOP could not be reached. Check your connection and try again.');
    setState({
      status: 'error',
      finishedAt: Date.now(),
      error: copy,
    });
    toastError('VTOP refresh failed', {
      detail: copy,
    });
    return false;
  } finally {
    inFlight = false;
  }
}

/**
 * Background auto-refresh: runs only when a live session exists, the cached
 * data is stale (or force), and the cooldown since the last automatic attempt
 * has passed — never hammering VTOP on every focus event.
 */
export async function maybeAutoRefresh(opts: Omit<RefreshOptions, 'force'>): Promise<boolean> {
  if (inFlight) return false;
  if (!isLiveSessionActive()) return false;
  const now = Date.now();
  if (now - lastAutoRefreshAt < AUTO_REFRESH_COOLDOWN_MS) return false;

  const cached = await vtopDb.getAllData();
  const lastSyncedAt = cached?.metadata?.lastSyncedAt ?? state.lastSyncedAt ?? null;
  if (!isDataStale(lastSyncedAt, now)) return false;

  return refreshVtopData(opts);
}

/** Reset in-memory state (used on logout). */
export function resetSyncCoordinator(): void {
  inFlight = false;
  lastAutoRefreshAt = 0;
  setState({
    status: 'idle',
    lastSyncedAt: null,
    startedAt: null,
    finishedAt: null,
    reason: null,
    error: null,
    results: null,
  });
}

/** Update the known last-sync timestamp after a sync outside the coordinator. */
export function markSyncedAt(t: number, results: SyncDatasetResult[] | null): void {
  setState({ lastSyncedAt: t, status: 'synced', results });
}

/** Seed the coordinator with the timestamp loaded from cache on startup. */
export function seedSyncCoordinator(lastSyncedAt: number | null): void {
  setState({ lastSyncedAt, status: lastSyncedAt ? 'synced' : 'idle' });
}

/** Used by tests to inspect the in-memory state. */
export function _resetCoordinatorForTests(): void {
  inFlight = false;
  lastAutoRefreshAt = 0;
  state = {
    status: 'idle',
    lastSyncedAt: null,
    startedAt: null,
    finishedAt: null,
    reason: null,
    error: null,
    results: null,
  };
}
