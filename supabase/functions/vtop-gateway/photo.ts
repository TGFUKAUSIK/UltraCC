/**
 * photo.ts — authenticated VTOP profile-photo retrieval (testable core).
 *
 * VTOP serves the student photo only to an authenticated session. The
 * extraction (which <img> is the photo) lives in parsers.ts
 * (extractProfilePhotoSource); THIS module resolves that source against the
 * VTOP origin and fetches the bytes with the session cookie, producing a
 * browser-renderable data URI. No credentials, cookies, or raw HTML ever
 * reach the browser or the logs — only a data URI ≤ MAX_PROFILE_PHOTO_BYTES.
 *
 * Diagnostics are intentionally LIMITED to safe metadata: which step
 * failed, redirect hops, byte size, MIME type. Never: cookies, session
 * state, raw HTML, or the full photo bytes.
 */

import { extractSetCookies, mergeCookieJar, type FetchImpl } from './session.ts';

export const MAX_PROFILE_PHOTO_BYTES = 2_500_000;

export interface PhotoFetchStep {
  step:
    | 'no-source'
    | 'resolve-failed'
    | 'blocked-origin'
    | 'redirect'
    | 'http-error'
    | 'bad-content-type'
    | 'too-large'
    | 'empty'
    | 'encode-failed'
    | 'fetched';
  ok: boolean;
  status?: number;
  contentType?: string;
  bytes?: number;
  hops?: number;
}

export interface PhotoFetchResult {
  dataUrl?: string;
  /** Safe metadata only — safe to log in development. */
  diag: { steps: PhotoFetchStep[]; success: boolean };
}

const IMAGE_MIME = /^image\/(?:jpeg|jpg|png|webp)$/i;

/** Any base64 data URI regardless of the declared MIME (VTOP uses data:null). */
const DATA_URI_RE = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/i;

function isDataUri(source: string): boolean {
  return DATA_URI_RE.test(source);
}

/**
 * Rewrite a base64 data URI's MIME from the payload's magic bytes. VTOP
 * serves "data:null;base64,..." — the bytes are a real image, the label is
 * not. Sniffed: JPEG (\u00ffd8\u00ff), PNG, WEBP; defaults to JPEG.
 */
function normalizeDataUri(source: string): string {
  const m = source.match(DATA_URI_RE);
  if (!m) return source;
  const payload = m[1];
  const head = payload.slice(0, 6);
  const mime = head.startsWith('/9j/') ? 'image/jpeg'
    : head.startsWith('iVBORw') ? 'image/png'
    : head.startsWith('UklGR') ? 'image/webp'
    : 'image/jpeg';
  return `data:${mime};base64,${payload}`;
}

function bytesToBase64(bytes: Uint8Array): string | null {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  try {
    return btoa(binary);
  } catch {
    return null;
  }
}

/**
 * Fetch VTOP's actual profile image through the authenticated session.
 * `vtopOriginUrl` is the campus origin (e.g. https://vtopcc.vit.ac.in);
 * `fetchImpl` is injected so tests can simulate every path.
 */
export async function fetchProfilePhotoDataUrl(
  source: string | undefined,
  cookie: string,
  vtopOriginUrl: string,
  fetchImpl: FetchImpl,
): Promise<PhotoFetchResult> {
  const steps: PhotoFetchStep[] = [];
  if (!source) {
    steps.push({ step: 'no-source', ok: false });
    return { diag: { steps, success: false } };
  }

  // Case C: VTOP embedded the photo as a data URI in the profile HTML
  // (its real-world MIME is "data:null" — normalized from the magic bytes).
  if (isDataUri(source)) {
    if (source.length > MAX_PROFILE_PHOTO_BYTES) {
      steps.push({ step: 'too-large', ok: false, bytes: source.length });
      return { diag: { steps, success: false } };
    }
    const dataUrl = normalizeDataUri(source);
    steps.push({ step: 'fetched', ok: true, bytes: source.length, contentType: 'inline' });
    return { dataUrl, diag: { steps, success: true } };
  }

  // Cases A/B/D: HTTP(S) URL (absolute or relative) — resolved against the
  // VTOP origin and fetched with the authenticated session.
  let url: URL;
  try {
    const origin = new URL(vtopOriginUrl).origin;
    url = new URL(source, `${origin}/vtop/`);
    // Never carry arbitrary query parameters from an HTML image source into
    // the browser. This prevents token-like values from becoming image URLs.
    url.search = '';
    url.hash = '';
    if (url.origin !== origin || !/^\/(?:vtop\/)?/i.test(url.pathname)) {
      steps.push({ step: 'blocked-origin', ok: false, status: 0 });
      return { diag: { steps, success: false } };
    }
  } catch {
    steps.push({ step: 'resolve-failed', ok: false });
    return { diag: { steps, success: false } };
  }

  let current = url.href;
  let currentCookie = cookie;
  for (let hop = 0; hop < 3; hop++) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: 'GET',
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          ...(currentCookie ? { Cookie: currentCookie } : {}),
        },
        redirect: 'manual',
      });
    } catch {
      steps.push({ step: 'http-error', ok: false, hops: hop });
      return { diag: { steps, success: false } };
    }
    currentCookie = mergeCookieJar(currentCookie, extractSetCookies(response.headers));
    const location = response.headers.get('location');
    if (response.status >= 301 && response.status <= 308 && location) {
      try {
        const next = new URL(location, current);
        if (next.origin !== new URL(vtopOriginUrl).origin) {
          steps.push({ step: 'blocked-origin', ok: false, hops: hop, status: response.status });
          return { diag: { steps, success: false } };
        }
        next.search = '';
        next.hash = '';
        current = next.href;
        steps.push({ step: 'redirect', ok: true, hops: hop, status: response.status });
        continue;
      } catch {
        steps.push({ step: 'resolve-failed', ok: false, hops: hop });
        return { diag: { steps, success: false } };
      }
    }
    if (!response.ok) {
      steps.push({ step: 'http-error', ok: false, status: response.status, hops: hop });
      return { diag: { steps, success: false } };
    }
    const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!IMAGE_MIME.test(contentType)) {
      steps.push({ step: 'bad-content-type', ok: false, status: response.status, contentType, hops: hop });
      return { diag: { steps, success: false } };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) {
      steps.push({ step: 'empty', ok: false, status: response.status, hops: hop });
      return { diag: { steps, success: false } };
    }
    if (bytes.length > MAX_PROFILE_PHOTO_BYTES) {
      steps.push({ step: 'too-large', ok: false, bytes: bytes.length, hops: hop });
      return { diag: { steps, success: false } };
    }
    const b64 = bytesToBase64(bytes);
    if (!b64) {
      steps.push({ step: 'encode-failed', ok: false, bytes: bytes.length, hops: hop });
      return { diag: { steps, success: false } };
    }
    steps.push({ step: 'fetched', ok: true, status: response.status, contentType, bytes: bytes.length, hops: hop });
    return { dataUrl: `data:${contentType};base64,${b64}`, diag: { steps, success: true } };
  }
  steps.push({ step: 'http-error', ok: false, hops: 3 });
  return { diag: { steps, success: false } };
}

/**
 * One-line safe diagnostic for development logs. Contains NO cookies, NO
 * session data, NO raw HTML, NO photo bytes — only step metadata.
 */
export function summarizePhotoDiag(diag: PhotoFetchResult['diag']): string {
  if (diag.success) {
    const last = diag.steps[diag.steps.length - 1];
    return `photo fetched (${last?.contentType ?? 'unknown'}, ${last?.bytes ?? 0}B, ${last?.hops ?? 0} hop(s))`;
  }
  const failed = diag.steps.find((s) => !s.ok);
  return `photo unavailable: ${failed?.step ?? 'unknown'}${failed?.status ? ` (HTTP ${failed.status})` : ''}`;
}
