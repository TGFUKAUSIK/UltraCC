/**
 * campusClient.ts — frontend access to the campus-data UltraCC API.
 *
 * All campus datasets (clubs, transport, library) flow through the
 * campus-data edge function; the frontend holds NO direct upstream URLs.
 * Adds last-known-good caching in localStorage so an edge/upstream failure
 * serves the previous valid copy (marked stale) instead of wiping data.
 */

import { CAMPUS_SERVICE_MESSAGE, edgeFetch } from './edgeFetch';
import { humanErrorCopy } from './errorCopy';

export interface CampusEnvelope<T> {
  success: boolean;
  data: T;
  source?: 'upstream' | 'cache';
  syncedAt?: string;
  stale?: boolean;
  error?: string;
}

export interface Club {
  club_id: string;
  club_name: string;
  mission?: string;
  description?: string;
  hiring_process?: string;
  website?: string;
  recruitment_link?: string;
  instagram?: string;
  whatsapp?: string;
  poc?: string;
  poc_phone?: string;
  email?: string;
  updated_at?: string;
  logo_url?: string | null;
}

export interface BusStop {
  stopOrder: number;
  stopName: string;
  pickupTime: string;
}

export interface BusRouteFull {
  routeNumber: string;
  routeName: string;
  type: string;
  driverName: string;
  driverPhone: string;
  whatsappGroup: string;
  busLocation: string;
  stops: BusStop[];
  supervisorName: string;
  supervisorPhone: string;
}

export interface BusPlacement {
  routeNumber: string;
  dispersalTime: string;
  zone: string;
}

export interface BusRule {
  ruleNumber: number;
  content: string;
}

export interface TransportSeed {
  routes: BusRouteFull[];
  placements: BusPlacement[];
  rules: BusRule[];
}

export interface Book {
  biblionumber: string;
  title: string;
  author?: string;
  publisher?: string;
  isbn?: string;
  coverUrl?: string;
}

export interface Holding {
  itemId?: string;
  barcode?: string;
  shelvingLocation?: string;
  callNumber?: string;
  status?: string;
  currentLibrary?: string;
  dateDue?: string | null;
}

export interface BookDetail extends Book {
  edition?: string;
  description?: string;
  subjects?: string[];
  ddc?: string;
  summary?: string;
  holdings?: Holding[];
}

export interface CampusResult<T> {
  data: T | null;
  stale: boolean;
  syncedAt: string | null;
  error: string | null;
}

const CACHE_PREFIX = 'ultracc:campus-cache:';
const SYNCED_PREFIX = 'ultracc:campus-synced:';

function readCache<T>(dataset: string, key: string): CampusResult<T> | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + dataset + ':' + key);
    if (!raw) return null;
    const payload = JSON.parse(raw) as T;
    const syncedAt = localStorage.getItem(SYNCED_PREFIX + dataset + ':' + key);
    return { data: payload, stale: true, syncedAt, error: 'Serving last synced copy.' };
  } catch {
    return null;
  }
}

function writeCache<T>(dataset: string, key: string, data: T, syncedAt: string): void {
  try {
    localStorage.setItem(CACHE_PREFIX + dataset + ':' + key, JSON.stringify(data));
    localStorage.setItem(SYNCED_PREFIX + dataset + ':' + key, syncedAt);
  } catch {
    // Storage full / unavailable — caching is best-effort only.
  }
}

function clearCacheEntry(dataset: string, key: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + dataset + ':' + key);
    localStorage.removeItem(SYNCED_PREFIX + dataset + ':' + key);
  } catch {
    // Ignore.
  }
}

/**
 * Per-dataset failure sentences. `dataset` is a machine name (`clubs`,
 * `transport`, `library`) that must not reach the screen as `the clubs service`,
 * so each one gets the words its own screen would use.
 */
const CAMPUS_FAILURE_COPY: Record<'clubs' | 'transport' | 'library', string> = {
  clubs: 'The student communities directory is temporarily unavailable.',
  transport: 'Campus transport information is temporarily unavailable.',
  library: 'The library catalogue is temporarily unavailable.',
};

/**
 * Fetch a campus dataset. On network/edge failure, falls back to the
 * last-known-good localStorage copy (marked stale) instead of surfacing a
 * hard error when a previous good copy exists.
 *
 * Whatever ends up in `error` is student-facing copy: the edge function's own
 * curated sentence passes through, and transport noise (`TypeError: Failed to
 * fetch`, an HTTP status, a function name) is replaced — see `humanErrorCopy`.
 */
export async function fetchCampus<T>(
  dataset: 'clubs' | 'transport' | 'library',
  key: string,
  query?: Record<string, string>,
): Promise<CampusResult<T>> {
  const search = query
    ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
  try {
    const envelope = await edgeFetch<CampusEnvelope<T>>(`campus-data${search}`);
    if (envelope.success && envelope.data != null) {
      const syncedAt = envelope.syncedAt || new Date().toISOString();
      writeCache(dataset, key, envelope.data, syncedAt);
      return {
        data: envelope.data,
        stale: Boolean(envelope.stale),
        syncedAt,
        error: envelope.error ? humanErrorCopy(envelope.error, CAMPUS_FAILURE_COPY[dataset]) : null,
      };
    }
    // Edge reached us but had no data (and no cache on its side).
    const cached = readCache<T>(dataset, key);
    if (cached) return cached;
    return {
      data: null,
      stale: false,
      syncedAt: null,
      error: humanErrorCopy(envelope.error, CAMPUS_FAILURE_COPY[dataset]),
    };
  } catch (err) {
    const cached = readCache<T>(dataset, key);
    if (cached) return cached;
    return {
      data: null,
      stale: false,
      syncedAt: null,
      // `edgeFetch` already words a non-2xx answer for a generic "campus
      // service"; this client knows WHICH dataset failed, so it says so.
      error: err instanceof Error && err.message === CAMPUS_SERVICE_MESSAGE
        ? CAMPUS_FAILURE_COPY[dataset]
        : humanErrorCopy(err, CAMPUS_FAILURE_COPY[dataset]),
    };
  }
}

/** Library search through the UltraCC API (per-query cache fallback). */
export async function searchLibraryCatalogue(query: string): Promise<CampusResult<Book[]>> {
  const q = query.trim();
  if (!q) return { data: [], stale: false, syncedAt: null, error: null };
  return fetchCampus<Book[]>('library', `search:${q.toLowerCase()}`, { dataset: 'library', q });
}

/** Book detail through the UltraCC API (per-record cache fallback). */
export async function fetchBookDetail(biblionumber: string): Promise<CampusResult<BookDetail>> {
  return fetchCampus<BookDetail>('library', `detail:${biblionumber}`, { dataset: 'library', biblionumber });
}

/** Test/teardown helper: drop all campus caches. */
export function clearCampusCaches(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(CACHE_PREFIX) || k.startsWith(SYNCED_PREFIX))) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore.
  }
}
