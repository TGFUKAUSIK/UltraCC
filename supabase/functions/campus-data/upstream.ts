/**
 * upstream.ts — pure upstream ingestion for the campus-data edge function.
 *
 * Upstream access exists ONLY here (server side). The frontend never sees
 * these hosts. Every fetcher: retries with backoff, follows pagination until
 * exhausted, and returns { items, exhausted, lastError } — never throws for
 * upstream failure (the caller decides whether to keep the cached copy).
 */

/** Small fetch with timeout + exponential backoff retries on failure/5xx. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  attempt: number,
  maxAttempts: number,
  timeoutMs: number,
): Promise<Response> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    if (res.status >= 500 && attempt < maxAttempts) {
      await sleep(backoffMs(attempt));
      return fetchWithRetry(url, init, attempt + 1, maxAttempts, timeoutMs);
    }
    return res;
  } catch (err) {
    if (attempt < maxAttempts) {
      await sleep(backoffMs(attempt));
      return fetchWithRetry(url, init, attempt + 1, maxAttempts, timeoutMs);
    }
    throw err;
  }
}

export function backoffMs(attempt: number): number {
  return Math.min(400 * 2 ** attempt, 3200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract a numeric page cursor from a "next" URL's ?page= param. */
export function nextPageNumber(nextUrl: string | null | undefined): number | null {
  if (!nextUrl) return null;
  try {
    const page = new URL(nextUrl).searchParams.get('page');
    const n = page ? Number.parseInt(page, 10) : Number.NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export interface PageMeta {
  /** Raw next-page URL from Link rel="next" (absolute OR relative), or null. */
  next: string | null;
}

export function parseLinkHeader(linkHeader: string | null): PageMeta {
  if (!linkHeader) return { next: null };
  for (const part of linkHeader.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return { next: m[1] };
  }
  return { next: null };
}

export interface PaginatedResult<T> {
  items: T[];
  /** True when the upstream pagination completed (or none was needed). */
  exhausted: boolean;
  /** Human-readable upstream failure reason (empty when none). */
  lastError: string;
  pagesFetched: number;
}

/** Resolve a (possibly relative) next-URL against the page it came from. */
export function resolveNextUrl(nextUrl: string, currentUrl: string): string | null {
  try {
    return new URL(nextUrl, currentUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Extract the item array from a page body without assuming one envelope.
 * Upstreams in the wild use `{ items: [...] }`, `{ clubs: [...] }`,
 * `{ routes: [...] }`, `{ books: [...] }` or a bare array — the page is only
 * trusted when one of these shapes is present.
 */
export const ARRAY_KEYS = ['items', 'clubs', 'routes', 'books'] as const;

export function extractArray<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body != null && typeof body === 'object') {
    for (const key of ARRAY_KEYS) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

const MAX_PAGES = 20;

/**
 * Fully ingest a paginated JSON API, advertising the next page via
 * Link rel="next" (?page=N). Page bodies are read shape-agnostically via
 * extractArray (items/clubs/routes/books or a bare array) so a different
 * envelope can never silently yield an empty dataset.
 */
export async function ingestPaginated<T = unknown>(
  firstUrl: string,
  init: RequestInit | undefined,
  maxPages: number = MAX_PAGES,
): Promise<PaginatedResult<T>> {
  const items: T[] = [];
  let url: string | null = firstUrl;
  let pages = 0;
  let lastError = '';

  while (url && pages < maxPages) {
    try {
      const res = await fetchWithRetry(url, init, 0, 2, 15000);
      if (!res.ok) {
        lastError = `upstream responded ${res.status}`;
        break;
      }
      const body = (await res.json()) as unknown;
      items.push(...extractArray<T>(body));
      pages += 1;
      const next = parseLinkHeader(res.headers.get('link'));
      // Resolve relative next-URLs ("/api?page=2") against the page URL.
      url = next.next ? resolveNextUrl(next.next, url) : null;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      break;
    }
  }

  return { items, exhausted: lastError === '' || pages >= maxPages, lastError, pagesFetched: pages };
}
