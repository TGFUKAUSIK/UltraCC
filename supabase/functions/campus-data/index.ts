/**
 * campus-data — Supabase Edge Function (Deno)
 *
 * The public application API for UltraCC campus datasets: clubs directory,
 * VIT Chennai transport routes, and KOHA library catalogue search/detail.
 *
 * Architecture (matches event-hub / faculty-directory conventions):
 *   upstream (server-side only, inside this function)
 *     -> validated + normalized -> campus_data_cache (service role)
 *     -> this function -> frontend
 *
 * The frontend NEVER talks to upstream hosts. Upstream URLs exist only here,
 * server-side. No upstream or Supabase credentials reach the client: the
 * embedded anon key is the public key and grants NO access to
 * campus_data_cache (RLS denies it); this function uses the service role.
 *
 * Datasets (?dataset=):
 *   clubs     — paginated directory ingest -> cache row ('clubs', 'all')
 *   transport — upstream feed ingest (routes + supervisor contacts),
 *               bus rules merged from the bundled verified seed
 *   library   — search (q=) / detail (biblionumber=) with per-key cache;
 *               upstream failure serves the last cached copy for the SAME
 *               key, marked stale. Nothing is ever fabricated.
 *   all       — sync-all: explicit full re-ingest of clubs + transport
 *               (idempotent, per-dataset result report). Library caches are
 *               per-query and populate on demand.
 *
 * Reads serve the cached copy while it is fresh (10-minute window) without
 * re-ingesting; pass force=1 to bypass the freshness window and re-ingest.
 *
 * Response envelope: { success, data, source: 'upstream'|'cache', syncedAt,
 * stale?, error? } — 200 even on upstream failure (honest error strings the
 * UI can render), 500 only for local misconfiguration.
 */

import { type StoreDeps } from './store.ts';
import { ingestPaginated } from './upstream.ts';
import transportJson from './transport.json' with { type: 'json' };
import {
  getClubs,
  getTransport,
  searchLibrary,
  bookDetail,
  syncAll,
  isValidTransportSeed,
  type HandlerDeps,
  type SyncAllResult,
} from './handlers.ts';
import type { Club } from './datasets.ts';

// ---------------------------------------------------------------------------
// Upstream endpoints — server-side ONLY. The frontend never sees these.
// ---------------------------------------------------------------------------
const CLUBS_UPSTREAM = 'https://api.amazecc.com/api/clubs/details';
const TRANSPORT_UPSTREAM = 'https://api.amazecc.com/api/transport/routes';
const KOHA_SEARCH_UPSTREAM = 'https://api.amazecc.com/api/koha/search';
const KOHA_DETAIL_UPSTREAM = 'https://api.amazecc.com/api/koha/detail';

const UPSTREAM_INIT: RequestInit = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    Accept: 'application/json',
  },
};

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function depsFromEnv(): StoreDeps {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase env not configured');
  }
  return { supabaseUrl, serviceKey };
}

function buildHandlers(deps: StoreDeps): HandlerDeps {
  return {
    store: deps,
    ingestClubs: () => ingestPaginated<Club>(CLUBS_UPSTREAM, UPSTREAM_INIT),
    fetchTransport: async () => {
      const res = await fetch(TRANSPORT_UPSTREAM, { ...UPSTREAM_INIT, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`upstream responded ${res.status}`);
      return res.json();
    },
    fetchLibrary: (url: string) => {
      const target = url
        .replace('https://library-upstream.invalid/search', KOHA_SEARCH_UPSTREAM)
        .replace('https://library-upstream.invalid/detail', KOHA_DETAIL_UPSTREAM);
      return fetch(target, { ...UPSTREAM_INIT, signal: AbortSignal.timeout(15000) });
    },
    transportSeed: transportJson,
  };
}

// ---------------------------------------------------------------------------
// Sync-trigger rate limit — the sync path re-ingests upstream; a naive loop
// could hammer it. Small in-memory window per instance (functions are
// multi-instance, but this still blunts accidental loops; the freshness
// window already makes normal reads cheap).
// ---------------------------------------------------------------------------
const SYNC_WINDOW_MS = 60_000;
const SYNC_MAX_PER_WINDOW = 6;
const syncTimestamps: number[] = [];

function syncRateLimited(): boolean {
  const now = Date.now();
  while (syncTimestamps.length > 0 && now - syncTimestamps[0] > SYNC_WINDOW_MS) {
    syncTimestamps.shift();
  }
  if (syncTimestamps.length >= SYNC_MAX_PER_WINDOW) return true;
  syncTimestamps.push(now);
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'GET') return json({ success: false, error: 'Method not allowed.' }, 405);

  let deps: StoreDeps;
  try {
    deps = depsFromEnv();
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : 'Edge function not configured.' }, 500);
  }

  const url = new URL(req.url);
  const dataset = url.searchParams.get('dataset') || '';
  const force = url.searchParams.get('force') === '1';
  const handlers = buildHandlers(deps);

  try {
    switch (dataset) {
      case 'clubs':
        return json(await getClubs(handlers, { force }));
      case 'transport':
        return json(await getTransport(handlers, { force }));
      case 'library': {
        const biblionumber = url.searchParams.get('biblionumber') || '';
        if (biblionumber) return json(await bookDetail(handlers, biblionumber));
        return json(await searchLibrary(handlers, url.searchParams.get('q') || ''));
      }
      case 'all': {
        // Explicit sync-all trigger: re-ingest clubs + transport upstream,
        // write guarded caches, report per-dataset results. Safe to re-run.
        if (syncRateLimited()) {
          return json({ success: false, error: 'Sync rate limit reached; try again in a minute.' }, 429);
        }
        const { results } = await syncAll(handlers, { force: true });
        const ok = results.clubs.ok || results.transport.ok;
        return json({
          success: ok,
          syncedAt: new Date().toISOString(),
          results: results as Record<string, SyncAllResult[string]>,
          error: ok ? undefined : 'No dataset could be synchronized; upstreams unavailable.',
        });
      }
      default:
        return json({ success: false, error: 'Unknown dataset. Use dataset=clubs|transport|library|all.' }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never log request payloads — message only, truncated.
    console.error('[campus-data] error:', message.substring(0, 200));
    return json({ success: false, error: 'The campus data service encountered an error.' }, 500);
  }
});

// The bundled transport seed is validated once at module load so an invalid
// seed fails loudly at deploy time rather than silently serving nothing.
if (!isValidTransportSeed(transportJson)) {
  throw new Error('campus-data: bundled transport seed failed validation');
}
