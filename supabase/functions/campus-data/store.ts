/**
 * store.ts — pure (Deno-free) cache layer for the campus-data edge function.
 *
 * All Supabase access goes through PostgREST with the SERVICE ROLE (bypasses
 * RLS). The anon role has no policies on campus_data_cache, so the table is
 * unreachable from the client — the edge function is the only access path.
 *
 * Data-integrity rule: ingest functions MUST NOT write empty/failed results
 * over previously valid rows (see upsertGuarded below).
 */

export interface CacheRow<T> {
  dataset: string;
  cacheKey: string;
  payload: T;
  syncedAt: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface StoreDeps {
  supabaseUrl: string;
  serviceKey: string;
  fetchImpl?: FetchLike;
}

function headers(serviceKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
  };
}

async function postgrest(
  deps: StoreDeps,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const impl = deps.fetchImpl ?? fetch;
  return impl(`${deps.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers(deps.serviceKey), ...(init?.headers ?? {}) },
  });
}

/** Read one cached row (null when absent). */
export async function readCache<T>(
  deps: StoreDeps,
  dataset: string,
  cacheKey: string,
): Promise<CacheRow<T> | null> {
  const url =
    `campus_data_cache?dataset=eq.${encodeURIComponent(dataset)}` +
    `&cache_key=eq.${encodeURIComponent(cacheKey)}` +
    `&select=payload,synced_at&limit=1`;
  const res = await postgrest(deps, url);
  if (!res.ok) {
    throw new Error(`campus cache read failed (${res.status})`);
  }
  const rows = (await res.json()) as { payload: T; synced_at: string }[];
  if (!rows.length) return null;
  return {
    dataset,
    cacheKey,
    payload: rows[0].payload,
    syncedAt: rows[0].synced_at,
  };
}

/**
 * Guarded upsert: writes ONLY when `isValid` passes. Never writes empty or
 * malformed payloads over existing data — the caller decides validity, and a
 * failed ingest simply leaves the previous row (and its synced_at) intact.
 *
 * synced_at is written EXPLICITLY so the value served to the client is
 * exactly the value stored (the default now() would stamp a second clock
 * reading that drifts from the handler's response timestamp).
 */
export async function upsertGuarded<T>(
  deps: StoreDeps,
  dataset: string,
  cacheKey: string,
  payload: T,
  isValid: (payload: T) => boolean,
  options?: { syncedAt?: string; recordCount?: number; syncStatus?: 'complete' | 'partial' },
): Promise<{ written: boolean }> {
  if (!isValid(payload)) {
    return { written: false };
  }
  const syncedAt = options?.syncedAt ?? new Date().toISOString();
  const body: Record<string, unknown> = {
    dataset,
    cache_key: cacheKey,
    payload,
    synced_at: syncedAt,
    record_count: options?.recordCount ?? null,
    sync_status: options?.syncStatus ?? 'complete',
  };
  const res = await postgrest(deps, `campus_data_cache`, {
    method: 'POST',
    // upsert on (dataset, cache_key); overwrite synced_at on conflict
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`campus cache write failed (${res.status} ${res.statusText})`);
  }
  return { written: true };
}

/**
 * Read the whole transport row (payload + metadata) — used by the sync-all
 * merge, which must see the CURRENT rules of record before swapping.
 */
export async function readTransportCacheRow(deps: StoreDeps): Promise<CacheRow<unknown> | null> {
  const url =
    `campus_data_cache?dataset=eq.${encodeURIComponent('transport')}` +
    `&cache_key=eq.${encodeURIComponent('all')}` +
    `&select=payload,synced_at&limit=1`;
  const res = await postgrest(deps, url);
  if (!res.ok) {
    throw new Error(`campus cache read failed (${res.status})`);
  }
  const rows = (await res.json()) as { payload: unknown; synced_at: string; record_count?: number | null; sync_status?: string | null }[];
  if (!rows.length) return null;
  return {
    dataset: 'transport',
    cacheKey: 'all',
    payload: rows[0].payload,
    syncedAt: rows[0].synced_at,
  };
}

/**
 * Atomic transport swap: rules must NEVER be lost when routes are refreshed
 * (they only exist in the bundled seed, not in the upstream feed). This
 * re-reads the CURRENT cached row inside the same PostgREST request that
 * overwrites it, using a computed column filter — if a concurrent writer
 * changed the row between our read and write, the update matches 0 rows and
 * we retry (bounded), instead of clobbering a fresh rules update.
 */
export async function swapTransportCache(
  deps: StoreDeps,
  payload: unknown,
  isValid: (payload: unknown) => boolean,
  syncedAt: string,
): Promise<{ written: boolean; reason?: 'invalid-payload' | 'conflict' }>
{
  if (!isValid(payload)) return { written: false, reason: 'invalid-payload' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readTransportCacheRow(deps);
    const currentPayload = current?.payload as { rules?: unknown[] } | null;
    const rules = Array.isArray(currentPayload?.rules) ? currentPayload!.rules : [];
    const next: { routes: unknown[]; placements: unknown[]; rules: unknown[] } = {
      routes: (payload as { routes: unknown[] }).routes,
      placements: (payload as { placements: unknown[] }).placements,
      rules,
    };
    if (!isValid(next)) return { written: false, reason: 'invalid-payload' };
    const res = await postgrest(
      deps,
      // Conditional filter: only overwrite when synced_at is unchanged since our read.
      `campus_data_cache?dataset=eq.transport&cache_key=eq.all` +
        (current ? `&synced_at=eq.${encodeURIComponent(current.syncedAt)}` : ''),
      {
        method: current ? 'PATCH' : 'POST',
        headers: current
          ? { Prefer: 'return=representation', 'Content-Type': 'application/json' }
          : { Prefer: 'resolution=merge-duplicates,return=minimal', 'Content-Type': 'application/json' },
        body: JSON.stringify(
          current
            ? { payload: next, synced_at: syncedAt, record_count: (next.routes as unknown[]).length, sync_status: 'complete' }
            : { dataset: 'transport', cache_key: 'all', payload: next, synced_at: syncedAt, record_count: (next.routes as unknown[]).length, sync_status: 'complete' },
        ),
      },
    );
    if (res.ok) {
      if (!current) return { written: true };
      // PostgREST returns the matched rows for return=representation; an
      // EMPTY array means a concurrent writer changed synced_at between our
      // read and write — retry with a fresh read instead of clobbering it.
      const rows = (await res.json()) as unknown[];
      if (Array.isArray(rows) && rows.length > 0) return { written: true };
      continue;
    }
    if (res.status === 404) {
      // Row vanished between read and write — fall back to an upsert.
      return upsertGuarded(deps, 'transport', 'all', next, isValid, { syncedAt, recordCount: (next.routes as unknown[]).length });
    }
    // Other write errors are real failures.
    throw new Error(`campus cache write failed (${res.status} ${res.statusText})`);
  }
  return { written: false, reason: 'conflict' };
}
