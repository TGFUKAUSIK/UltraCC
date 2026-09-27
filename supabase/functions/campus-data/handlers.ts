/**
 * handlers.ts — pure (Deno-free) request handlers for campus-data.
 *
 * All dependencies (cache store, upstream fetchers, transport seed) are
 * injected, so tests can exercise every path — upstream success, upstream
 * failure with cache, upstream failure without cache — with no network and
 * no Supabase.
 *
 * Flow per dataset: read-through with a freshness window. A read serves the
 * cached copy while it is fresh; otherwise it re-ingests upstream, validates
 * + sanitizes, writes the cache GUARDED (a failed/partial/shrunken ingest
 * never replaces a known-good row), and serves fresh upstream data on
 * success or the last-known-good copy marked stale on failure. Nothing is
 * ever fabricated: an unavailable dataset with no cache is an honest
 * success:false envelope.
 */

import { readCache, upsertGuarded, swapTransportCache, type CacheRow, type StoreDeps } from './store.ts';
import { type PaginatedResult } from './upstream.ts';
import {
  isValidClubs,
  isValidBooks,
  sanitizeBooks,
  sanitizeBookDetail,
  sanitizeClubs,
  normalizeQuery,
  isValidBiblionumber,
  type Club,
  type Book,
  type BookDetail,
} from './datasets.ts';
import { isValidNormalizedTransport, normalizeUpstreamTransport, type NormalizedTransport } from './transportNormalize.ts';

export interface TransportSeedShape {
  routes: unknown[];
  placements: unknown[];
  rules: unknown[];
}

export function isValidTransportSeed(seed: unknown): seed is TransportSeedShape {
  const s = seed as TransportSeedShape | null;
  return (
    s != null && typeof s === 'object' &&
    Array.isArray(s.routes) && s.routes.length > 0 &&
    Array.isArray(s.placements) &&
    Array.isArray(s.rules) &&
    s.routes.every((r) => {
      const route = r as { routeNumber?: unknown; stops?: unknown };
      return (
        route != null && typeof route === 'object' &&
        typeof route.routeNumber === 'string' && route.routeNumber.length > 0 &&
        Array.isArray(route.stops)
      );
    })
  );
}

export interface CampusEnvelope<T> {
  success: boolean;
  data: T;
  source?: 'upstream' | 'cache';
  syncedAt?: string;
  stale?: boolean;
  error?: string;
  pagesFetched?: number;
  /** True when the bundled seed was served because upstream ingest failed. */
  bootstrap?: boolean;
}

/** Injected upstream fetcher for clubs (paginated ingest). */
export type ClubsIngest = () => Promise<PaginatedResult<Club>>;
/** Injected upstream fetcher for library search/detail. */
export type LibraryFetch = (url: string) => Promise<Response>;
/** Injected transport seed provider. */
export type TransportSeedProvider = () => TransportSeedShape;
/** Injected transport upstream fetcher (returns the parsed JSON body). */
export type TransportFetch = () => Promise<unknown>;

export interface HandlerDeps {
  store: StoreDeps;
  ingestClubs: ClubsIngest;
  fetchLibrary: LibraryFetch;
  transportSeed: TransportSeedShape;
  /** Upstream transport feed; null/undefined = upstream not wired (seed-only mode). */
  fetchTransport?: TransportFetch;
}

const OK_BOOK = (b: BookDetail) => b != null && Boolean(b.biblionumber && b.title);

/** A cached row younger than this is served without hitting upstream again. */
const FRESH_WINDOW_MS = 10 * 60 * 1000;

function cacheAgeMs(syncedAt: string | undefined): number {
  if (!syncedAt) return Number.POSITIVE_INFINITY;
  const t = Date.parse(syncedAt);
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY;
}

function isFresh(syncedAt: string | undefined): boolean {
  return cacheAgeMs(syncedAt) < FRESH_WINDOW_MS;
}

function staleEnvelope<T>(cached: CacheRow<T>, error: string): CampusEnvelope<T> {
  return {
    success: true,
    data: cached.payload,
    source: 'cache',
    syncedAt: cached.syncedAt,
    stale: true,
    error,
  };
}

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------
export async function getClubs(deps: HandlerDeps, opts: { force?: boolean } = {}): Promise<CampusEnvelope<Club[]>> {
  let cached: CacheRow<Club[]> | null = null;
  try {
    cached = await readCache<Club[]>(deps.store, 'clubs', 'all');
  } catch {
    // Cache read failure must not fail the whole request.
  }

  // Fresh cache: serve immediately without re-ingesting (rate-limit friendly).
  if (!opts.force && cached && isFresh(cached.syncedAt)) {
    return { success: true, data: cached.payload, source: 'cache', syncedAt: cached.syncedAt };
  }

  let result: PaginatedResult<Club>;
  try {
    result = await deps.ingestClubs();
  } catch (err) {
    result = { items: [], exhausted: false, lastError: err instanceof Error ? err.message : String(err), pagesFetched: 0 };
  }

  // A partial ingest (upstream broke mid-pagination) is never written over a
  // complete copy, and never served as complete while a full copy exists —
  // the cached copy wins below.
  const completeIngest = result.exhausted && isValidClubs(result.items);
  const partialIngest = !result.exhausted && result.items.length > 0;

  if (completeIngest) {
    const sanitized = sanitizeClubs(result.items);
    if (isValidClubs(sanitized)) {
      // Shrink guard: a "complete" ingest that lost most clubs vs the cached
      // copy is treated as suspect — keep the larger last-known-good copy.
      const cachedCount = cached?.payload.length ?? 0;
      const suspectShrink = cachedCount >= 25 && sanitized.length < cachedCount * 0.5;
      if (!suspectShrink) {
        const syncedAt = new Date().toISOString();
        try {
          await upsertGuarded(deps.store, 'clubs', 'all', sanitized, isValidClubs, {
            syncedAt,
            recordCount: sanitized.length,
          });
        } catch {
          // Cache write failure is non-fatal — fresh data still returned.
        }
        return {
          success: true,
          data: sanitized,
          source: 'upstream',
          syncedAt,
          pagesFetched: result.pagesFetched,
        };
      }
      // Suspect shrink: fall through to the stale-cache path below.
      result.lastError = `upstream returned only ${sanitized.length} clubs (cached copy has ${cachedCount})`;
    } else {
      result.lastError = result.lastError || 'upstream payload failed validation after sanitization';
    }
  }

  if (cached && cached.payload.length > 0) {
    return staleEnvelope(
      cached,
      partialIngest
        ? `upstream pagination incomplete (${result.lastError || 'unknown'}); serving the last complete copy`
        : (result.lastError || 'upstream unavailable'),
    );
  }

  return {
    success: false,
    data: [],
    error: `The clubs directory is temporarily unavailable. No cached copy exists yet. (${result.lastError || 'upstream unavailable'})`,
  };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
/**
 * Transport is ingest-first: the upstream feed is the source of truth
 * (110 routes, supervisor contacts on every route). The bundled seed is the
 * bootstrap copy when the upstream has never been reachable. Bus rules exist
 * only in the bundled seed — they are merged into every cached row and never
 * dropped by a routes refresh.
 */
export async function getTransport(deps: HandlerDeps, opts: { force?: boolean } = {}): Promise<CampusEnvelope<TransportSeedShape>> {
  let cached: CacheRow<TransportSeedShape> | null = null;
  try {
    cached = await readCache<TransportSeedShape>(deps.store, 'transport', 'all');
  } catch {
    // Ignore cache read failures — the bundled seed always works.
  }

  // Fresh cache: serve immediately without re-ingesting (rate-limit friendly).
  if (!opts.force && cached && isFresh(cached.syncedAt)) {
    return { success: true, data: cached.payload, source: 'cache', syncedAt: cached.syncedAt };
  }

  // Ingest the upstream feed when wired. Failure here is expected (offline
  // upstream, cold cache) and never fatal — the seed/cached copy takes over.
  // lastError is hoisted so the seed bootstrap can be reported honestly (a
  // seed serving is NOT a successful upstream sync).
  let lastError = '';
  if (deps.fetchTransport) {
    try {
      const body = await deps.fetchTransport();
      const normalized = normalizeUpstreamTransport(body);
      if (normalized) {
        const merged = mergeTransportRules(normalized, cached?.payload, deps.transportSeed);
        const syncedAt = new Date().toISOString();
        const swap = await swapTransportCache(deps.store, merged, isValidNormalizedTransport, syncedAt);
        if (swap.written) {
          return {
            success: true,
            data: merged as unknown as TransportSeedShape,
            source: 'upstream',
            syncedAt,
          };
        }
        if (swap.reason === 'conflict') {
          lastError = 'transport cache changed concurrently; retrying on the next request';
        }
      } else {
        lastError = 'upstream transport payload failed validation';
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (lastError) {
      if (cached && isValidTransportSeed(cached.payload)) {
        return staleEnvelope(cached, `upstream transport unavailable (${lastError}); serving the last synced copy`);
      }
      // Fall through to the seed path — first-run bootstrap.
    }
  }

  if (cached && isValidTransportSeed(cached.payload)) {
    return { success: true, data: cached.payload, source: 'cache', syncedAt: cached.syncedAt };
  }

  if (!isValidTransportSeed(deps.transportSeed)) {
    return { success: false, data: null as unknown as TransportSeedShape, error: 'Transport dataset invalid.' };
  }

  const syncedAt = new Date().toISOString();
  try {
    await upsertGuarded(deps.store, 'transport', 'all', deps.transportSeed, isValidTransportSeed, {
      syncedAt,
      recordCount: deps.transportSeed.routes.length,
    });
  } catch {
    // Cache unavailable — still serve the verified bundled seed.
  }
  return {
    success: true,
    data: deps.transportSeed,
    source: 'upstream',
    syncedAt,
    // Honest reporting: the bundled seed is a bootstrap, not an upstream sync.
    ...(lastError
      ? { bootstrap: true as const, error: `upstream transport unavailable (${lastError}); served the bundled seed` }
      : {}),
  };
}

/**
 * Merge the bundled seed's bus rules into a normalized upstream payload —
 * the upstream feed publishes no rules, so they must survive every refresh.
 * The cached row's rules win (they may have been merged earlier); the seed
 * provides them on first sync.
 */
function mergeTransportRules(
  normalized: NormalizedTransport,
  cached: TransportSeedShape | undefined,
  seed: TransportSeedShape,
): NormalizedTransport {
  const cachedRules = Array.isArray(cached?.rules) ? cached!.rules : [];
  const seedRules = Array.isArray(seed?.rules) ? seed.rules : [];
  const rules = cachedRules.length > 0 ? cachedRules : seedRules;
  return { ...normalized, rules } as unknown as NormalizedTransport;
}

// ---------------------------------------------------------------------------
// Library search
// ---------------------------------------------------------------------------
export async function searchLibrary(deps: HandlerDeps, query: string): Promise<CampusEnvelope<Book[]>> {
  const q = query.trim();
  if (!q) return { success: false, data: [], error: 'Empty search query.' };

  const cacheKey = `search:${normalizeQuery(q)}`;
  let cached: CacheRow<Book[]> | null = null;
  try {
    cached = await readCache<Book[]>(deps.store, 'library', cacheKey);
  } catch {
    // Ignore.
  }

  let books: Book[] = [];
  let lastError = '';
  let upstreamSuccess = false;
  try {
    const url = `https://library-upstream.invalid/search?q=${encodeURIComponent(q)}`;
    const res = await deps.fetchLibrary(url);
    if (!res.ok) {
      lastError = `catalogue responded ${res.status}`;
    } else {
      const payload = (await res.json()) as { success?: boolean; error?: string; books?: Book[] };
      // An upstream 200 with { success:false } is a FAILURE, not an empty
      // database — it must never be cached as a zero-result success.
      if (payload.success === false) {
        lastError = payload.error ? `catalogue error: ${payload.error}` : 'catalogue reported failure';
      } else {
        const raw = Array.isArray(payload.books) ? payload.books : [];
        books = sanitizeBooks(raw);
        upstreamSuccess = true;
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  if (upstreamSuccess) {
    // Genuine upstream success (including a legitimate zero-result query).
    const syncedAt = new Date().toISOString();
    try {
      await upsertGuarded(deps.store, 'library', cacheKey, books, isValidBooks, { syncedAt, recordCount: books.length });
    } catch {
      // Non-fatal.
    }
    return { success: true, data: books, source: 'upstream', syncedAt };
  }

  if (cached) {
    return staleEnvelope(cached, lastError);
  }

  return {
    success: false,
    data: [],
    error: `The library catalogue is temporarily unavailable. No cached copy exists yet for this search. (${lastError || 'upstream unavailable'})`,
  };
}

// ---------------------------------------------------------------------------
// Library detail
// ---------------------------------------------------------------------------
export async function bookDetail(deps: HandlerDeps, biblionumber: string): Promise<CampusEnvelope<BookDetail>> {
  const id = biblionumber.trim();
  if (!isValidBiblionumber(id)) {
    return { success: false, data: null as unknown as BookDetail, error: 'Invalid biblionumber.' };
  }

  const cacheKey = `detail:${id}`;
  let cached: CacheRow<BookDetail> | null = null;
  try {
    cached = await readCache<BookDetail>(deps.store, 'library', cacheKey);
  } catch {
    // Ignore.
  }

  let book: BookDetail | null = null;
  let lastError = '';
  let upstreamSuccess = false;
  try {
    const url = `https://library-upstream.invalid/detail?biblionumber=${encodeURIComponent(id)}`;
    const res = await deps.fetchLibrary(url);
    if (!res.ok) {
      lastError = `catalogue responded ${res.status}`;
    } else {
      const payload = (await res.json()) as { success?: boolean; error?: string; book?: BookDetail };
      if (payload.success === false) {
        lastError = payload.error ? `catalogue error: ${payload.error}` : 'catalogue reported failure';
      } else if (payload.book && payload.book.biblionumber && payload.book.title) {
        book = sanitizeBookDetail(payload.book);
        upstreamSuccess = true;
      } else {
        lastError = 'catalogue returned no detail for this record';
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  if (upstreamSuccess && book) {
    const syncedAt = new Date().toISOString();
    try {
      await upsertGuarded(deps.store, 'library', cacheKey, book, OK_BOOK, { syncedAt });
    } catch {
      // Non-fatal.
    }
    return { success: true, data: book, source: 'upstream', syncedAt };
  }

  if (cached) {
    return staleEnvelope(cached, lastError);
  }

  return {
    success: false,
    data: null as unknown as BookDetail,
    error: 'Detailed holdings are temporarily unavailable. No cached copy exists yet for this record.',
  };
}

// ---------------------------------------------------------------------------
// Sync-all (initial population / manual full sync)
// ---------------------------------------------------------------------------
export interface SyncAllResult {
  clubs: { ok: boolean; count: number; error?: string };
  transport: { ok: boolean; count: number; error?: string };
  library: { ok: boolean; count: number; error?: string };
}

/**
 * Explicit full synchronization of every dataset. Server-side only, run via
 * the campus-data function's sync trigger. Idempotent: re-running with no
 * upstream change re-writes identical payloads (same guarded upserts).
 * Library search/detail caches are per-query and are NOT pre-populated here —
 * they populate on demand; this reports library health via a probe query.
 */
export async function syncAll(deps: HandlerDeps, opts: { force?: boolean } = {}): Promise<{ results: SyncAllResult }> {
  // An explicit sync-all is by definition a re-ingest: bypass the freshness
  // window so a repeated sync actually re-reads upstream (and stays honest
  // about upstream health) instead of reporting its own fresh cache.
  const force = opts.force ?? true;
  const results: SyncAllResult = {
    clubs: { ok: false, count: 0 },
    transport: { ok: false, count: 0 },
    library: { ok: false, count: 0 },
  };

  // Clubs: a stale-cache fallback is NOT a successful upstream sync.
  try {
    const clubsEnv = await getClubs(deps, { force });
    const upstreamSynced = clubsEnv.source === 'upstream' && !clubsEnv.stale;
    results.clubs = clubsEnv.success && upstreamSynced
      ? { ok: true, count: clubsEnv.data.length }
      : {
        ok: false,
        count: clubsEnv.success ? clubsEnv.data.length : 0,
        error: clubsEnv.error || 'upstream sync failed; cache preserved',
      };
  } catch (err) {
    results.clubs = { ok: false, count: 0, error: err instanceof Error ? err.message : String(err) };
  }

  // Transport (rules are merged from the bundled seed on first sync)
  try {
    const transportEnv = await getTransport(deps, { force });
    // The bundled seed keeps the dataset alive when upstream fails, but the
    // sync report must still say the UPSTREAM sync failed (ok:false) so an
    // operator can tell bootstrap-copy success from a real refresh. A seed
    // bootstrap also reports source:'upstream', so the bootstrap flag is
    // what distinguishes it.
    const upstreamSynced = transportEnv.source === 'upstream' && !transportEnv.bootstrap && !transportEnv.stale;
    results.transport = transportEnv.success && upstreamSynced
      ? { ok: true, count: transportEnv.data.routes.length }
      : {
        ok: false,
        count: transportEnv.success ? transportEnv.data.routes.length : 0,
        error: transportEnv.error || (upstreamSynced ? undefined : 'upstream transport unavailable; serving the bundled seed/cached copy'),
      };
  } catch (err) {
    results.transport = { ok: false, count: 0, error: err instanceof Error ? err.message : String(err) };
  }

  // Library: a stale-cache fallback is NOT a successful upstream sync. The
  // probe query seeds the search cache when the catalogue is healthy.
  try {
    const probe = await searchLibrary(deps, 'the');
    const upstreamSynced = probe.source === 'upstream' && !probe.stale;
    results.library = probe.success && upstreamSynced
      ? { ok: true, count: probe.data.length }
      : {
        ok: false,
        count: probe.success ? probe.data.length : 0,
        error: probe.error || 'catalogue unavailable; no new data cached',
      };
  } catch (err) {
    results.library = { ok: false, count: 0, error: err instanceof Error ? err.message : String(err) };
  }

  return { results };
}


