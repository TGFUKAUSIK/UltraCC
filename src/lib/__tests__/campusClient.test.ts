/**
 * campusClient tests — last-known-good caching behavior.
 *
 * The client must:
 *   - write a successful envelope to localStorage with its syncedAt
 *   - serve the cached copy (marked stale) when the edge function fails
 *   - surface honest errors when no cache exists
 *   - never call any host other than our own Supabase edge functions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchCampus, searchLibraryCatalogue, fetchBookDetail, clearCampusCaches } from '../campusClient';
import { SUPABASE_URL } from '../edgeFetch';

const EDGE_BASE = `${SUPABASE_URL}/functions/v1/campus-data`;

function okEnvelope(data: unknown, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ success: true, data, syncedAt: '2026-09-06T12:00:00Z', ...extra }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('campusClient.fetchCampus', () => {
  it('caches a successful envelope with its syncedAt timestamp', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okEnvelope([{ club_id: 'c1', club_name: 'Robotics' }])));

    const result = await fetchCampus<unknown[]>('clubs', 'all', { dataset: 'clubs' });
    expect(result.data).toEqual([{ club_id: 'c1', club_name: 'Robotics' }]);
    expect(result.stale).toBe(false);
    expect(result.syncedAt).toBe('2026-09-06T12:00:00Z');

    const raw = localStorage.getItem('ultracc:campus-cache:clubs:all');
    expect(raw).not.toBeNull();
    expect(localStorage.getItem('ultracc:campus-synced:clubs:all')).toBe('2026-09-06T12:00:00Z');
  });

  it('falls back to the last-known-good copy (stale) when the edge function fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okEnvelope([{ club_id: 'c1' }])));
    await fetchCampus<unknown[]>('clubs', 'all', { dataset: 'clubs' });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const second = await fetchCampus<unknown[]>('clubs', 'all', { dataset: 'clubs' });
    expect(second.data).toEqual([{ club_id: 'c1' }]);
    expect(second.stale).toBe(true);
    expect(second.syncedAt).toBe('2026-09-06T12:00:00Z');
  });

  it('returns an honest error when there is neither fresh data nor cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const result = await fetchCampus<unknown>('clubs', 'all', { dataset: 'clubs' });
    expect(result.data).toBeNull();
    expect(result.stale).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('falls back to cache when the edge answers success:false (no upstream cache either)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okEnvelope([{ club_id: 'c1' }])));
    await fetchCampus<unknown[]>('clubs', 'all', { dataset: 'clubs' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, data: [], error: 'upstream down' }), { status: 200 })));
    const second = await fetchCampus<unknown[]>('clubs', 'all', { dataset: 'clubs' });
    expect(second.data).toEqual([{ club_id: 'c1' }]);
    expect(second.stale).toBe(true);
  });

  it('propagates the stale flag from the server-side cache fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okEnvelope([{ club_id: 'x' }], { source: 'cache', stale: true, error: 'upstream responded 500' })));
    const result = await fetchCampus<unknown[]>('clubs', 'all', { dataset: 'clubs' });
    expect(result.stale).toBe(true);
    // The data is on screen, so this is a note — but the edge function's raw
    // "upstream responded 500" is developer detail and never reaches the screen.
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/500|upstream/i);
  });

  it('keeps an edge function’s own curated sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okEnvelope([{ club_id: 'x' }], {
      source: 'cache', stale: true, error: 'No fresh clubs data yet — showing the last synced copy.',
    })));
    const result = await fetchCampus<unknown[]>('clubs', 'all', { dataset: 'clubs' });
    expect(result.error).toBe('No fresh clubs data yet — showing the last synced copy.');
  });

  it('names no edge function and no HTTP status when the service is down', async () => {
    // 5xx from the edge: the old client printed "Could not reach the
    // campus-data service (502).", which named a function and quoted a status.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 502 })));
    const result = await fetchCampus<unknown>('transport', 'all', { dataset: 'transport' });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/campus-data|502|Bad Gateway|edge function/i);
  });

  it('replaces a transport failure with human copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const result = await fetchCampus<unknown>('library', 'search:x', { dataset: 'library' });
    expect(result.error).toBe('The library catalogue is temporarily unavailable.');
  });

  it('only ever contacts the UltraCC campus-data edge function (no upstream hosts)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return okEnvelope([]);
    }));

    await fetchCampus('clubs', 'all', { dataset: 'clubs' });
    await searchLibraryCatalogue('kafka');
    await fetchBookDetail('42');

    expect(calls.length).toBe(3);
    for (const url of calls) {
      expect(url.startsWith(EDGE_BASE)).toBe(true);
    }
  });

  it('encodes library queries and biblionumbers into the edge URL', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return okEnvelope([]);
    }));

    await searchLibraryCatalogue('machine learning');
    await fetchBookDetail('ABC_42');

    expect(calls[0]).toContain('dataset=library');
    expect(calls[0]).toContain('q=machine%20learning');
    expect(calls[1]).toContain('biblionumber=ABC_42');
  });

  it('clearCampusCaches drops every cached dataset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okEnvelope([1, 2, 3])));
    await fetchCampus<unknown[]>('clubs', 'all', { dataset: 'clubs' });
    expect(localStorage.getItem('ultracc:campus-cache:clubs:all')).not.toBeNull();

    clearCampusCaches();
    expect(localStorage.getItem('ultracc:campus-cache:clubs:all')).toBeNull();
    expect(localStorage.getItem('ultracc:campus-synced:clubs:all')).toBeNull();
  });
});
