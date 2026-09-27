/**
 * campus-data edge-function tests — run under vitest like the vtop-gateway
 * parser suite (the pure modules import no Deno APIs).
 *
 * Covers the acceptance criteria:
 *   - pagination fully ingested (Link-header walking)
 *   - retries on upstream failure
 *   - cached data survives upstream failure (stale fallback)
 *   - sync failures never overwrite/wipe previously valid data
 *   - datasets are validated + sanitized before caching
 */

import { describe, it, expect, vi } from 'vitest';
import { readCache, upsertGuarded } from './store';
import { fetchWithRetry, backoffMs, nextPageNumber, parseLinkHeader, ingestPaginated, extractArray } from './upstream';
import {
  isValidClubs,
  isValidBooks,
  sanitizeBooks,
  sanitizeBookDetail,
  sanitizeClubs,
  isValidHttpUrl,
  normalizeQuery,
  isValidBiblionumber,
} from './datasets';
import {
  normalizeUpstreamTransport,
  isValidNormalizedTransport,
} from './transportNormalize';
import { getClubs, getTransport, searchLibrary, bookDetail, syncAll, isValidTransportSeed, type HandlerDeps, type TransportSeedShape } from './handlers';

// ---------------------------------------------------------------------------
// store.ts — guarded upsert (last-known-good preservation)
// ---------------------------------------------------------------------------
function storeDepsWith(rows: Record<string, unknown>, writes: unknown[] = []) {
  return {
    supabaseUrl: 'https://supabase.test',
    serviceKey: 'service-role-key',
    fetchImpl: async (url: string, init?: RequestInit) => {
      writes.push({ url, init });
      const params = new URL(url).searchParams;
      const strip = (name: string) => (params.get(name) || '').replace(/^eq\./, '');
      const key = `${strip('dataset')}|${strip('cache_key')}`;
      if (init?.method === 'POST') {
        // Persist the upsert so subsequent reads observe it (mirrors PostgREST,
        // which stores exactly the columns it was sent — including synced_at).
        try {
          const body = JSON.parse(String(init.body)) as {
            dataset: string;
            cache_key: string;
            payload: unknown;
            synced_at?: string;
          };
          rows[`${body.dataset}|${body.cache_key}`] = {
            payload: body.payload,
            synced_at: body.synced_at ?? new Date().toISOString(),
          };
        } catch {
          // Malformed body — treat as a failed write.
          return new Response('', { status: 400 });
        }
        return new Response('', { status: 201 });
      }
      if (rows[key]) {
        return new Response(JSON.stringify([rows[key]]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    },
  };
}

describe('campus-data store', () => {
  it('reads a cached row with payload + syncedAt', async () => {
    const deps = storeDepsWith({
      'clubs|all': { payload: [{ club_id: 'c1', club_name: 'Robotics Club' }], synced_at: '2026-09-06T00:00:00Z' },
    });
    const row = await readCache<{ club_id: string }[]>(deps, 'clubs', 'all');
    expect(row).not.toBeNull();
    expect(row!.payload[0].club_id).toBe('c1');
    expect(row!.syncedAt).toBe('2026-09-06T00:00:00Z');
  });

  it('returns null when no cached row exists', async () => {
    const deps = storeDepsWith({});
    expect(await readCache(deps, 'clubs', 'all')).toBeNull();
  });

  it('upsertGuarded refuses to write an invalid (e.g. empty) payload — failures never wipe good data', async () => {
    const writes: unknown[] = [];
    const deps = storeDepsWith({}, writes);
    const result = await upsertGuarded(deps, 'clubs', 'all', [], () => false);
    expect(result.written).toBe(false);
    expect(writes.filter((w) => (w as { init?: RequestInit }).init?.method === 'POST')).toHaveLength(0);
  });

  it('upsertGuarded writes valid payloads with merge-duplicates preference', async () => {
    const writes: unknown[] = [];
    const deps = storeDepsWith({}, writes);
    const result = await upsertGuarded(deps, 'clubs', 'all', [{ club_id: 'c1', club_name: 'X' }], (c) => c.length > 0);
    expect(result.written).toBe(true);
    const post = writes.find((w) => (w as { init?: RequestInit }).init?.method === 'POST') as { init: RequestInit } | undefined;
    expect(post).toBeDefined();
    expect((post!.init.headers as Record<string, string>).Prefer).toContain('merge-duplicates');
    expect(post!.init.body).toContain('"dataset":"clubs"');
  });
});

// ---------------------------------------------------------------------------
// upstream.ts — pagination + retries
// ---------------------------------------------------------------------------
function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

describe('campus-data upstream pagination', () => {
  it('extracts the raw next URL from Link rel=next (absolute or relative)', () => {
    expect(parseLinkHeader('<https://up.test/api/clubs/details?page=3>; rel="next"').next).toBe('https://up.test/api/clubs/details?page=3');
    expect(parseLinkHeader('</api/clubs/details?page=7>; rel="next"').next).toBe('/api/clubs/details?page=7');
    expect(parseLinkHeader('<https://up.test/api/clubs/details?page=2>; rel="prev"').next).toBeNull();
    expect(parseLinkHeader(null).next).toBeNull();
  });

  it('nextPageNumber tolerates malformed URLs', () => {
    expect(nextPageNumber('not a url')).toBeNull();
    expect(nextPageNumber('https://up.test/x?page=abc')).toBeNull();
    expect(nextPageNumber('https://up.test/x?page=0')).toBeNull();
  });

  it('ingests ALL pages until pagination is exhausted (relative next URLs)', async () => {
    const pages: Record<number, string[]> = { 1: ['a', 'b'], 2: ['c'], 3: ['d', 'e', 'f'] };
    const fetchMock = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page') || '1');
      const next = pages[page + 1] ? page + 1 : null;
      const headers: Record<string, string> = {};
      // Relative Link headers (the common real-world shape) must resolve.
      if (next) headers.Link = `</api?page=${next}>; rel="next"`;
      return jsonResponse({ items: pages[page] }, headers);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ingestPaginated<string>('https://up.test/api', undefined);
    expect(result.exhausted).toBe(true);
    expect(result.lastError).toBe('');
    expect(result.pagesFetched).toBe(3);
    expect(result.items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    // Every request must have hit the same origin (relative URL resolution).
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toMatch(/^https:\/\/up\.test\/api/);
    }
    vi.unstubAllGlobals();
  });

  it('reports a partial ingest when upstream breaks mid-pagination', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page') || '1');
      if (page === 1) {
        return jsonResponse({ items: ['a'] }, { Link: '<https://up.test/api?page=2>; rel="next"' });
      }
      return new Response('boom', { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ingestPaginated<string>('https://up.test/api', undefined);
    expect(result.items).toEqual(['a']);
    expect(result.exhausted).toBe(false);
    expect(result.lastError).toContain('503');
    vi.unstubAllGlobals();
  });

  it('stops at maxPages (runaway pagination guard)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: ['x'] }, { Link: '<https://up.test/api?page=99>; rel="next"' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await ingestPaginated<string>('https://up.test/api', undefined, 3);
    expect(result.pagesFetched).toBe(3);
    expect(result.items).toHaveLength(3);
    vi.unstubAllGlobals();
  });
});

describe('campus-data upstream retries', () => {
  it('backs off exponentially but caps the delay', () => {
    expect(backoffMs(0)).toBe(400);
    expect(backoffMs(1)).toBe(800);
    expect(backoffMs(2)).toBe(1600);
    expect(backoffMs(3)).toBe(3200);
    expect(backoffMs(10)).toBe(3200); // capped
  });

  it('retries a 5xx and returns the eventual success', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls < 3) return new Response('flaky', { status: 502 });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithRetry('https://up.test/x', undefined, 0, 2, 1000);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toBe(3);
    vi.unstubAllGlobals();
  });

  it('retries network errors and throws after exhausting attempts', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('https://up.test/x', undefined, 0, 1, 1000)).rejects.toThrow('offline');
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// datasets.ts — validation + sanitization
// ---------------------------------------------------------------------------
describe('campus-data dataset validation', () => {
  it('isValidClubs requires non-empty club_id + club_name on every entry', () => {
    expect(isValidClubs([{ club_id: 'c1', club_name: 'Club' }])).toBe(true);
    expect(isValidClubs([{ club_id: '', club_name: 'Club' }])).toBe(false);
    expect(isValidClubs([{ club_id: 'c1' }])).toBe(false);
    expect(isValidClubs([])).toBe(false);
    expect(isValidClubs('nope')).toBe(false);
  });

  it('isValidBooks requires biblionumber + title on every entry', () => {
    expect(isValidBooks([{ biblionumber: '1', title: 'Book' }])).toBe(true);
    expect(isValidBooks([{ biblionumber: '1' }])).toBe(false);
    expect(isValidBooks([])).toBe(true); // a legit zero-result query
  });

  it('sanitizeBooks strips markup and drops non-http cover URLs', () => {
    const [book] = sanitizeBooks([
      { biblionumber: '1', title: '  Distributed <b>Systems</b>  ', author: '  A. Author ', coverUrl: 'javascript:alert(1)' },
    ]);
    expect(book.title).toBe('Distributed Systems');
    expect(book.author).toBe('A. Author');
    expect(book.coverUrl).toBeUndefined();
  });

  it('sanitizeBooks keeps well-formed https cover URLs', () => {
    const [book] = sanitizeBooks([{ biblionumber: '2', title: 'Clean', coverUrl: 'https://covers.example/2.jpg' }]);
    expect(book.coverUrl).toBe('https://covers.example/2.jpg');
  });

  it('sanitizeBookDetail cleans subjects and summary without touching holdings', () => {
    const detail = sanitizeBookDetail({
      biblionumber: '3', title: 'T',
      summary: 'A  <i>summary</i>.',
      subjects: [' Computer ', ''],
      holdings: [{ barcode: 'B1', status: 'Available' }],
    });
    expect(detail.summary).toBe('A summary.');
    expect(detail.subjects).toEqual(['Computer']);
    expect(detail.holdings).toHaveLength(1);
  });

  it('normalizeQuery collapses whitespace + case for cache keys', () => {
    expect(normalizeQuery('  Machine   Learning ')).toBe('machine learning');
    expect(normalizeQuery('Machine Learning')).toBe(normalizeQuery('machine    learning'));
  });

  it('isValidBiblionumber rejects injection-shaped ids', () => {
    expect(isValidBiblionumber('12345')).toBe(true);
    expect(isValidBiblionumber('AB-cd_9')).toBe(true);
    expect(isValidBiblionumber('12; DROP TABLE x')).toBe(false);
    expect(isValidBiblionumber('../etc/passwd')).toBe(false);
    expect(isValidBiblionumber('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handlers.ts — cache survival + failure preservation
// ---------------------------------------------------------------------------
function makeDeps(overrides: Partial<HandlerDeps> & { rows?: Record<string, unknown>; writes?: unknown[] }): HandlerDeps {
  const rows = overrides.rows ?? {};
  const writes = overrides.writes ?? [];
  return {
    store: storeDepsWith(rows, writes),
    ingestClubs: async () => ({ items: [], exhausted: true, lastError: '', pagesFetched: 1 }),
    fetchLibrary: async () => jsonResponse({ books: [] }),
    transportSeed: { routes: [], placements: [], rules: [] },
    ...overrides,
  };
}

/** A minimal valid transport seed (routes with a stop each). */
function seedWithRoutes(...numbers: string[]): TransportSeedShape {
  return {
    routes: numbers.map((routeNumber) => ({
      routeNumber,
      routeName: `Route ${routeNumber}`,
      type: 'AC',
      driverName: '',
      driverPhone: '',
      whatsappGroup: '',
      busLocation: '',
      stops: [{ stopOrder: 1, stopName: 'Stop', pickupTime: '6.05 AM' }],
      supervisorName: '',
      supervisorPhone: '',
    })),
    placements: [],
    rules: [{ ruleNumber: 1, content: 'Rule' }],
  };
}

const goodClubs = [
  { club_id: 'c1', club_name: 'Robotics Club', mission: 'Bots' },
  { club_id: 'c2', club_name: 'Coding Club' },
];

describe('campus-data handlers — clubs', () => {
  it('serves fresh upstream data and caches it (paginated ingest)', async () => {
    const writes: unknown[] = [];
    const deps = makeDeps({ writes, ingestClubs: async () => ({ items: goodClubs, exhausted: true, lastError: '', pagesFetched: 2 }) });
    const env = await getClubs(deps);
    expect(env.success).toBe(true);
    expect(env.source).toBe('upstream');
    expect(env.data).toEqual(goodClubs);
    expect(env.pagesFetched).toBe(2);
    const post = writes.find((w) => (w as { init?: RequestInit }).init?.method === 'POST');
    expect(post).toBeDefined();
  });

  it('falls back to cached clubs marked stale when upstream fails', async () => {
    const deps = makeDeps({
      rows: { 'clubs|all': { payload: goodClubs, synced_at: '2026-09-05T10:00:00Z' } },
      ingestClubs: async () => ({ items: [], exhausted: false, lastError: 'upstream responded 500', pagesFetched: 0 }),
    });
    const env = await getClubs(deps);
    expect(env.success).toBe(true);
    expect(env.source).toBe('cache');
    expect(env.stale).toBe(true);
    expect(env.syncedAt).toBe('2026-09-05T10:00:00Z');
    expect(env.error).toContain('500');
    expect(env.data).toEqual(goodClubs);
  });

  it('marks a cached fallback stale whenever upstream is degraded (even if data matched)', async () => {
    const deps = makeDeps({
      rows: { 'clubs|all': { payload: goodClubs, synced_at: '2026-09-05T10:00:00Z' } },
      ingestClubs: async () => ({ items: goodClubs, exhausted: false, lastError: 'pagination broke', pagesFetched: 1 }),
    });
    const env = await getClubs(deps);
    expect(env.source).toBe('cache');
    expect(env.stale).toBe(true);
    expect(env.error).toContain('incomplete');
  });

  it('returns success:false when upstream fails AND no cache exists (honest unavailable state)', async () => {
    const deps = makeDeps({
      ingestClubs: async () => ({ items: [], exhausted: false, lastError: 'DNS failure', pagesFetched: 0 }),
    });
    const env = await getClubs(deps);
    expect(env.success).toBe(false);
    expect(env.error).toContain('unavailable');
  });

  it('does NOT cache a partial ingest that broke mid-pagination over existing valid data', async () => {
    const writes: unknown[] = [];
    const deps = makeDeps({
      writes,
      rows: { 'clubs|all': { payload: goodClubs, synced_at: '2026-09-05T10:00:00Z' } },
      ingestClubs: async () => ({ items: [{ club_id: 'partial', club_name: 'Only page 1' }], exhausted: false, lastError: 'pagination broke', pagesFetched: 1 }),
    });
    const env = await getClubs(deps);
    // Partial data is NOT written (page-2 never arrived), so the cache keeps
    // the last complete copy and serves it stale.
    expect(env.source).toBe('cache');
    expect(env.syncedAt).toBe('2026-09-05T10:00:00Z');
    expect(writes.filter((w) => (w as { init?: RequestInit }).init?.method === 'POST')).toHaveLength(0);
  });

  it('sanitizes club fields and preserves whatsapp/poc_phone/updated_at', async () => {
    const deps = makeDeps({
      ingestClubs: async () => ({
        items: [
          {
            club_id: 'c1',
            club_name: '  Script <b>Club</b> ',
            website: 'javascript:alert(1)',
            instagram: 'https://instagram.com/x',
            whatsapp: 'https://chat.whatsapp.com/abc',
            poc: ' POC Name ',
            poc_phone: '+91 9876543210',
            email: 'club@vit.ac.in',
            updated_at: '2026-08-25T16:40:25.603Z',
          },
        ] as never,
        exhausted: true,
        lastError: '',
        pagesFetched: 1,
      }),
    });
    const env = await getClubs(deps);
    expect(env.success).toBe(true);
    const club = env.data[0];
    expect(club.club_name).toBe('Script Club');
    expect(club.website).toBeUndefined(); // javascript: URL stripped
    expect(club.instagram).toBe('https://instagram.com/x');
    expect(club.whatsapp).toBe('https://chat.whatsapp.com/abc');
    expect(club.poc).toBe('POC Name');
    expect(club.poc_phone).toBe('+91 9876543210');
    expect(club.email).toBe('club@vit.ac.in');
    expect(club.updated_at).toBe('2026-08-25T16:40:25.603Z');
  });

  it('shrink guard: a suspiciously small complete ingest keeps the larger cached copy', async () => {
    const bigCache = Array.from({ length: 40 }, (_, i) => ({ club_id: `c${i}`, club_name: `Club ${i}` }));
    const deps = makeDeps({
      rows: { 'clubs|all': { payload: bigCache, synced_at: '2026-09-05T10:00:00Z' } },
      ingestClubs: async () => ({ items: [{ club_id: 'c1', club_name: 'One Club' }], exhausted: true, lastError: '', pagesFetched: 1 }),
    });
    const env = await getClubs(deps);
    expect(env.source).toBe('cache');
    expect(env.stale).toBe(true);
    expect(env.data).toHaveLength(40);
    expect(env.error).toContain('only 1 clubs');
  });

  it('fresh cache is served without re-ingesting; force bypasses the freshness window', async () => {
    const ingest = vi.fn(async () => ({ items: goodClubs, exhausted: true, lastError: '', pagesFetched: 1 }));
    const deps = makeDeps({
      rows: { 'clubs|all': { payload: goodClubs, synced_at: new Date().toISOString() } },
      ingestClubs: ingest as unknown as HandlerDeps['ingestClubs'],
    });
    const env = await getClubs(deps);
    expect(env.source).toBe('cache');
    expect(env.stale).toBeUndefined();
    expect(ingest).not.toHaveBeenCalled();

    const forced = await getClubs(deps, { force: true });
    expect(forced.source).toBe('upstream');
    expect(ingest).toHaveBeenCalledTimes(1);
  });
});

describe('campus-data handlers — transport', () => {
  it('seeds the cache from the bundled verified dataset when uncached', async () => {
    const writes: unknown[] = [];
    const seed = { routes: [{ routeNumber: '1', routeName: 'A', stops: [{ stopOrder: 1, stopName: 'S', pickupTime: '6.05 AM' }] }], placements: [], rules: [] };
    const deps = makeDeps({ writes, transportSeed: seed });
    const env = await getTransport(deps);
    expect(env.success).toBe(true);
    expect(env.source).toBe('upstream');
    expect(env.data).toEqual(seed);
    const post = writes.find((w) => (w as { init?: RequestInit }).init?.method === 'POST');
    expect((post as unknown as { init: RequestInit })?.init.body).toContain('"dataset":"transport"');
  });

  it('serves the cached copy when present', async () => {
    const deps = makeDeps({
      rows: { 'transport|all': { payload: { routes: [{ routeNumber: '9', routeName: 'R', stops: [] }], placements: [], rules: [] }, synced_at: '2026-09-01T00:00:00Z' } },
    });
    const env = await getTransport(deps);
    expect(env.source).toBe('cache');
    expect(env.syncedAt).toBe('2026-09-01T00:00:00Z');
  });

  it('isValidTransportSeed rejects empty/invalid seeds', () => {
    expect(isValidTransportSeed({ routes: [], placements: [], rules: [] })).toBe(false);
    expect(isValidTransportSeed({ routes: [{}], placements: [], rules: [] })).toBe(false);
    expect(isValidTransportSeed(null)).toBe(false);
  });

  it('ingests the upstream feed, normalizes contacts, and merges seed rules', async () => {
    const upstreamBody = {
      success: true,
      routes: [
        {
          id: 1,
          route_number: '1',
          route_name: 'THIRUVOTTIYUR',
          type: 'AC',
          driver_name: '',
          driver_phone: '',
          whatsapp_group: '',
          bus_location: '',
          supervisor_name: 'Mr.Kumar',
          supervisor_phone: '9445141276',
          stops: [{ stopName: 'THIRUVOTTIYUR', stopOrder: 1, pickupTime: '6.05 AM' }],
          placements: [{ zone: 'GATE 2', dispersalTime: '5PM' }],
        },
      ],
    };
    const writes: unknown[] = [];
    const deps = makeDeps({
      writes,
      fetchTransport: async () => upstreamBody,
      transportSeed: seedWithRoutes('1'),
    });
    const env = await getTransport(deps);
    expect(env.success).toBe(true);
    expect(env.source).toBe('upstream');
    expect(env.data.routes).toHaveLength(1);
    const route = env.data.routes[0] as Record<string, unknown>;
    expect(route.supervisorName).toBe('Mr.Kumar');
    expect(route.supervisorPhone).toBe('9445141276');
    expect(route.placements).toEqual([{ routeNumber: '1', zone: 'GATE 2', dispersalTime: '5PM' }]);
    // Bus rules survive the routes refresh (they only exist in the seed).
    expect(env.data.rules).toHaveLength(1);
    // Cache was written.
    expect(writes.some((w) => (w as { init?: RequestInit }).init?.method === 'POST')).toBe(true);
  });

  it('falls back to the bundled seed when the upstream feed fails on first run', async () => {
    const deps = makeDeps({
      fetchTransport: async () => {
        throw new Error('upstream responded 503');
      },
      transportSeed: seedWithRoutes('7'),
    });
    const env = await getTransport(deps);
    expect(env.success).toBe(true);
    expect(env.data.routes[0]).toMatchObject({ routeNumber: '7' });
  });

  it('serves stale cached transport when upstream fails after a successful sync', async () => {
    const deps = makeDeps({
      rows: { 'transport|all': { payload: seedWithRoutes('9'), synced_at: '2026-09-01T00:00:00Z' } },
      fetchTransport: async () => {
        throw new Error('upstream responded 503');
      },
      transportSeed: seedWithRoutes('1'),
    });
    const env = await getTransport(deps);
    expect(env.source).toBe('cache');
    expect(env.stale).toBe(true);
    expect(env.syncedAt).toBe('2026-09-01T00:00:00Z');
    expect(env.data.routes[0]).toMatchObject({ routeNumber: '9' });
  });

  it('fresh cached transport is served without re-ingesting; force re-ingests', async () => {
    const fetchTransport = vi.fn(async () => ({ success: true, routes: [] })); // invalid body -> no write
    const deps = makeDeps({
      rows: { 'transport|all': { payload: seedWithRoutes('9'), synced_at: new Date().toISOString() } },
      fetchTransport: fetchTransport as unknown as HandlerDeps['fetchTransport'],
      transportSeed: seedWithRoutes('1'),
    });
    const env = await getTransport(deps);
    expect(env.source).toBe('cache');
    expect(fetchTransport).not.toHaveBeenCalled();

    const forced = await getTransport(deps, { force: true });
    expect(fetchTransport).toHaveBeenCalledTimes(1);
    // The invalid upstream body leaves the cached copy intact.
    expect(forced.data.routes[0]).toMatchObject({ routeNumber: '9' });
  });

  it('preserves every contact field through normalization (driver, whatsapp, supervisor)', () => {
    const normalized = normalizeUpstreamTransport({
      routes: [
        {
          route_number: '5',
          route_name: 'STERLING ROAD',
          type: 'AC',
          driver_name: 'Driver D',
          driver_phone: '9999911111',
          whatsapp_group: 'https://chat.whatsapp.com/route5',
          bus_location: 'Near Guindy',
          supervisor_name: 'Sup S',
          supervisor_phone: '8888822222',
          stops: [{ stopName: 'S', stopOrder: 1, pickupTime: '6.15 AM' }],
          placements: [],
        },
      ],
    });
    expect(normalized).not.toBeNull();
    const route = normalized!.routes[0];
    expect(route.driverName).toBe('Driver D');
    expect(route.driverPhone).toBe('9999911111');
    expect(route.whatsappGroup).toBe('https://chat.whatsapp.com/route5');
    expect(route.busLocation).toBe('Near Guindy');
    expect(route.supervisorName).toBe('Sup S');
    expect(route.supervisorPhone).toBe('8888822222');
  });

  it('rejects malformed upstream routes instead of silently corrupting the dataset', () => {
    const normalized = normalizeUpstreamTransport({
      routes: [
        { route_number: '', route_name: 'X', stops: [] },
        { route_number: '2', route_name: 'OK', stops: [{ stopName: 'S', stopOrder: 1, pickupTime: '6.00 AM' }] },
        null,
        { route_number: '3', route_name: 'No stops', stops: [] },
      ],
    });
    expect(normalized).not.toBeNull();
    expect(normalized!.routes).toHaveLength(1);
    expect(normalized!.routes[0].routeNumber).toBe('2');
    expect(isValidNormalizedTransport(normalized)).toBe(true);
  });
});

describe('campus-data sync-all', () => {
  it('syncs every dataset and reports per-dataset results', async () => {
    const writes: unknown[] = [];
    const deps = makeDeps({
      writes,
      ingestClubs: async () => ({ items: goodClubs, exhausted: true, lastError: '', pagesFetched: 1 }),
      fetchTransport: async () => ({ success: true, routes: [{ route_number: '1', route_name: 'A', stops: [{ stopName: 'S', stopOrder: 1, pickupTime: '6.05 AM' }], placements: [] }] }),
      transportSeed: seedWithRoutes('1'),
      fetchLibrary: async () => jsonResponse({ success: true, books: [{ biblionumber: '1', title: 'Book' }] }),
    });
    const { results } = await syncAll(deps);
    expect(results.clubs.ok).toBe(true);
    expect(results.clubs.count).toBe(2);
    expect(results.transport.ok).toBe(true);
    expect(results.transport.count).toBe(1);
    expect(results.library.ok).toBe(true);
    expect(results.library.count).toBe(1);
  });

  it('is idempotent: a repeated sync rewrites identical data without failure', async () => {
    const deps = makeDeps({
      ingestClubs: async () => ({ items: goodClubs, exhausted: true, lastError: '', pagesFetched: 1 }),
      fetchTransport: async () => ({ success: true, routes: [{ route_number: '1', route_name: 'A', stops: [{ stopName: 'S', stopOrder: 1, pickupTime: '6.05 AM' }], placements: [] }] }),
      transportSeed: seedWithRoutes('1'),
      fetchLibrary: async () => jsonResponse({ success: true, books: [] }),
    });
    const first = await syncAll(deps);
    const second = await syncAll(deps);
    expect(first.results.clubs.ok).toBe(true);
    expect(second.results.clubs.ok).toBe(true);
    expect(second.results.clubs.count).toBe(first.results.clubs.count);
    expect(second.results.transport.ok).toBe(true);
  });

  it('reports upstream failures per dataset without throwing', async () => {
    const deps = makeDeps({
      ingestClubs: async () => ({ items: [], exhausted: false, lastError: 'upstream 500', pagesFetched: 0 }),
      fetchTransport: async () => {
        throw new Error('upstream 503');
      },
      transportSeed: seedWithRoutes('1'),
      fetchLibrary: async () => jsonResponse({ success: false, error: 'Koha returned 500' }),
    });
    const { results } = await syncAll(deps);
    expect(results.clubs.ok).toBe(false);
    expect(results.clubs.error).toContain('upstream 500');
    expect(results.transport.ok).toBe(false);
    expect(results.transport.error).toContain('503');
    expect(results.library.ok).toBe(false);
    expect(results.library.error).toContain('Koha returned 500');
  });
});

describe('campus-data handlers — library', () => {
  it('caches a successful search and serves it back on failure for the same query', async () => {
    const book = { biblionumber: '42', title: 'Distributed Systems' };
    // 1st call: success -> cached. 2nd call: upstream dead -> stale cache.
    let healthy = true;
    const deps = makeDeps({
      fetchLibrary: async () => {
        if (!healthy) throw new Error('upstream down');
        return jsonResponse({ books: [book] });
      },
    });
    const first = await searchLibrary(deps, 'Distributed Systems');
    expect(first.success).toBe(true);
    expect(first.source).toBe('upstream');

    healthy = false;
    const second = await searchLibrary(deps, 'distributed   systems'); // same normalized key
    expect(second.success).toBe(true);
    expect(second.source).toBe('cache');
    expect(second.stale).toBe(true);
    expect(second.syncedAt).toBe(first.syncedAt);
    expect(second.data).toEqual([book]);
  });

  it('caches detail records and falls back when the catalogue is down', async () => {
    let healthy = true;
    const deps = makeDeps({
      fetchLibrary: async () => {
        if (!healthy) throw new Error('upstream down');
        return jsonResponse({ book: { biblionumber: '42', title: 'Distributed Systems', holdings: [{ barcode: 'B1', status: 'Available' }] } });
      },
    });
    const first = await bookDetail(deps, '42');
    expect(first.success).toBe(true);
    healthy = false;
    const second = await bookDetail(deps, '42');
    expect(second.source).toBe('cache');
    expect(second.stale).toBe(true);
    expect(second.syncedAt).toBe(first.syncedAt);
    expect(second.data.holdings).toHaveLength(1);
  });

  it('rejects invalid biblionumbers without any upstream call', async () => {
    const fetchMock = vi.fn();
    const deps = makeDeps({ fetchLibrary: fetchMock as unknown as HandlerDeps['fetchLibrary'] });
    const env = await bookDetail(deps, '12; DROP TABLE x');
    expect(env.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('empty-query search is rejected without upstream access', async () => {
    const fetchMock = vi.fn();
    const deps = makeDeps({ fetchLibrary: fetchMock as unknown as HandlerDeps['fetchLibrary'] });
    const env = await searchLibrary(deps, '   ');
    expect(env.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an honest zero-result search succeeds and is cached (not treated as failure)', async () => {
    const deps = makeDeps({ fetchLibrary: returnsZeroResults() });
    const env = await searchLibrary(deps, 'nothing matches this');
    expect(env.success).toBe(true);
    expect(env.source).toBe('upstream');
    expect(env.data).toEqual([]);
  });

  it('a 200 body with success:false is a failure — never cached as an empty success', async () => {
    const writes: unknown[] = [];
    const deps = makeDeps({
      writes,
      fetchLibrary: async () => jsonResponse({ success: false, error: 'Koha returned 500' }),
    });
    const env = await searchLibrary(deps, 'database');
    expect(env.success).toBe(false);
    expect(env.error).toContain('Koha returned 500');
    expect(writes.filter((w) => (w as { init?: RequestInit }).init?.method === 'POST')).toHaveLength(0);
  });

  it('a 200 body with success:false serves the stale cache when one exists', async () => {
    const deps = makeDeps({
      rows: { 'library|search:database': { payload: [{ biblionumber: '9', title: 'Cached DB Book' }], synced_at: '2026-09-01T00:00:00Z' } },
      fetchLibrary: async () => jsonResponse({ success: false, error: 'Koha returned 500' }),
    });
    const env = await searchLibrary(deps, 'Database');
    expect(env.success).toBe(true);
    expect(env.source).toBe('cache');
    expect(env.stale).toBe(true);
    expect(env.data[0].title).toBe('Cached DB Book');
  });
});

function returnsZeroResults(): HandlerDeps['fetchLibrary'] {
  return async () => jsonResponse({ books: [] });
}

// ---------------------------------------------------------------------------
// upstream.ts — shape-agnostic page extraction
// ---------------------------------------------------------------------------
describe('extractArray', () => {
  it('extracts items/clubs/routes/books envelopes and bare arrays', () => {
    expect(extractArray({ items: [1, 2] })).toEqual([1, 2]);
    expect(extractArray({ clubs: [{ club_id: 'x' }] })).toEqual([{ club_id: 'x' }]);
    expect(extractArray({ routes: [1] })).toEqual([1]);
    expect(extractArray({ books: [] })).toEqual([]);
    expect(extractArray([1, 2])).toEqual([1, 2]);
    expect(extractArray({ success: true })).toEqual([]);
    expect(extractArray(null)).toEqual([]);
  });
});
