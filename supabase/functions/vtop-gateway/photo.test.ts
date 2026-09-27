/**
 * photo.test.ts — the authenticated VTOP profile-photo retrieval core
 * (photo.ts). Covers: full URL, relative URL, data-URI passthrough, missing
 * photo, invalid/blocked source, cookie flow on redirects, non-image and
 * oversized responses, and diagnostics hygiene (safe metadata only).
 */

import { describe, it, expect } from 'vitest';
import {
  fetchProfilePhotoDataUrl,
  summarizePhotoDiag,
  MAX_PROFILE_PHOTO_BYTES,
} from './photo.ts';

/** Minimal fake Response exposing exactly what photo.ts consumes. */
function fakeResponse(init: {
  status?: number;
  contentType?: string | null;
  location?: string;
  setCookie?: string[];
  body?: ArrayBuffer | string;
}): Response {
  const headers = new Map<string, string>();
  if (init.contentType !== undefined) headers.set('content-type', init.contentType);
  if (init.location) headers.set('location', init.location);
  const cookies = init.setCookie ?? [];
  return {
    status: init.status ?? 200,
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    headers: {
      get: (k: string) => headers.get(k.toLowerCase()) ?? null,
      getSetCookie: () => cookies,
    },
    arrayBuffer: async () =>
      typeof init.body === 'string'
        ? new TextEncoder().encode(init.body).buffer
        : init.body ?? new ArrayBuffer(0),
  } as unknown as Response;
}

const PNG_1PX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
  0, 0, 0, 13, 73, 72, 68, 82, // IHDR
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
  0, 0, 0, 10, 73, 68, 65, 84, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0, 0, 0, 0, 49, 201, 0x2f, 0xaf, 0x27, // IEND-ish tail
]);

function b64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const ORIGIN = 'https://vtopcc.vit.ac.in';

describe('fetchProfilePhotoDataUrl', () => {
  it('returns undefined for a missing photo source', async () => {
    const result = await fetchProfilePhotoDataUrl(undefined, 'JSESSIONID=x', ORIGIN, async () => fakeResponse({}));
    expect(result.dataUrl).toBeUndefined();
    expect(result.diag.steps[0].step).toBe('no-source');
    expect(result.diag.success).toBe(false);
  });

  it('passes through an inline data URI (VTOP embedding the photo in HTML)', async () => {
    // PNG bytes with the CORRECT label pass through untouched.
    const dataUri = `data:image/png;base64,${b64(PNG_1PX)}`;
    let fetchCalls = 0;
    const result = await fetchProfilePhotoDataUrl(dataUri, 'JSESSIONID=x', ORIGIN, async () => {
      fetchCalls++;
      return fakeResponse({});
    });
    expect(fetchCalls).toBe(0); // no network needed
    expect(result.dataUrl).toBe(dataUri);
    expect(result.diag.success).toBe(true);
  });

  it('normalizes VTOP\'s mislabeled "data:null;base64" MIME from the payload magic bytes', async () => {
    // VTOP's real shape: PNG bytes declared as data:null. The browser cannot
    // render that — normalization must rewrite the MIME before returning.
    const mislabeled = `data:null;base64,${b64(PNG_1PX)}`;
    const result = await fetchProfilePhotoDataUrl(mislabeled, 'JSESSIONID=x', ORIGIN, async () => fakeResponse({}));
    expect(result.dataUrl).toBe(`data:image/png;base64,${b64(PNG_1PX)}`);
    expect(result.diag.success).toBe(true);
  });

  it('rejects an oversized inline data URI', async () => {
    const big = `data:image/png;base64,${'A'.repeat(MAX_PROFILE_PHOTO_BYTES + 1)}`;
    const result = await fetchProfilePhotoDataUrl(big, '', ORIGIN, async () => fakeResponse({}));
    expect(result.dataUrl).toBeUndefined();
    expect(result.diag.steps[0].step).toBe('too-large');
  });

  it('resolves a RELATIVE source against the VTOP origin with the session cookie (cases B+D)', async () => {
    let requestedUrl = '';
    let sentCookie = '';
    const result = await fetchProfilePhotoDataUrl('/vtop/assets/profile/photo.jpg', 'JSESSIONID=abc', ORIGIN, async (url, init) => {
      requestedUrl = url;
      sentCookie = (init.headers as Record<string, string>).Cookie ?? '';
      return fakeResponse({ contentType: 'image/jpeg', body: PNG_1PX.buffer });
    });
    expect(requestedUrl).toBe(`${ORIGIN}/vtop/assets/profile/photo.jpg`);
    expect(sentCookie).toBe('JSESSIONID=abc'); // authenticated retrieval
    expect(result.dataUrl).toBe(`data:image/jpeg;base64,${b64(PNG_1PX)}`);
    expect(result.diag.success).toBe(true);
    expect(result.diag.steps.at(-1)).toMatchObject({ step: 'fetched', contentType: 'image/jpeg' });
  });

  it('preserves an ABSOLUTE same-origin URL and strips token-like query strings (case A)', async () => {
    let requestedUrl = '';
    const result = await fetchProfilePhotoDataUrl(`${ORIGIN}/vtop/photo.jsp?id=SECRET_TOKEN`, '', ORIGIN, async (url) => {
      requestedUrl = url;
      return fakeResponse({ contentType: 'image/png', body: PNG_1PX.buffer });
    });
    expect(requestedUrl).toBe(`${ORIGIN}/vtop/photo.jsp`); // token-like query stripped
    expect(result.dataUrl).toContain('data:image/png;base64,');
    expect(result.diag.success).toBe(true);
  });

  it('blocks cross-origin sources before fetching (no SSRF)', async () => {
    let fetchCalls = 0;
    const result = await fetchProfilePhotoDataUrl('https://evil.example/photo.jpg', 'JSESSIONID=x', ORIGIN, async () => {
      fetchCalls++;
      return fakeResponse({});
    });
    expect(fetchCalls).toBe(0);
    expect(result.dataUrl).toBeUndefined();
    expect(result.diag.steps[0].step).toBe('blocked-origin');
  });

  it('reports http-error and never fabricates a photo on a 404', async () => {
    const result = await fetchProfilePhotoDataUrl('/vtop/photo.jpg', 'JSESSIONID=x', ORIGIN, async () =>
      fakeResponse({ status: 404, contentType: 'text/html' }),
    );
    expect(result.dataUrl).toBeUndefined();
    expect(result.diag.steps[0]).toMatchObject({ step: 'http-error', status: 404 });
    expect(summarizePhotoDiag(result.diag)).toContain('404');
  });

  it('treats an HTML (login page) response as a failed photo fetch, not an image', async () => {
    const result = await fetchProfilePhotoDataUrl('/vtop/photo.jpg', 'JSESSIONID=x', ORIGIN, async () =>
      fakeResponse({ contentType: 'text/html', body: '<html><form id="vtopLoginForm">login</form></html>' }),
    );
    expect(result.dataUrl).toBeUndefined();
    expect(result.diag.steps[0].step).toBe('bad-content-type');
    // The failure is diagnosable without logging any HTML.
    expect(summarizePhotoDiag(result.diag)).toContain('bad-content-type');
  });

  it('keeps the session cookie across redirect hops and stays same-origin', async () => {
    const cookiesSeen: string[] = [];
    let hops = 0;
    const result = await fetchProfilePhotoDataUrl('/vtop/a', 'JSESSIONID=abc', ORIGIN, async (_url, init) => {
      hops++;
      cookiesSeen.push((init.headers as Record<string, string>).Cookie ?? '');
      if (hops === 1) return fakeResponse({ status: 302, location: '/vtop/b' });
      return fakeResponse({ contentType: 'image/jpeg', body: PNG_1PX.buffer });
    });
    expect(hops).toBe(2);
    expect(cookiesSeen).toEqual(['JSESSIONID=abc', 'JSESSIONID=abc']);
    expect(result.dataUrl).toBe(`data:image/jpeg;base64,${b64(PNG_1PX)}`);
    expect(result.diag.steps[0]).toMatchObject({ step: 'redirect', hops: 0 });
  });

  it('blocks a redirect that leaves the VTOP origin', async () => {
    const result = await fetchProfilePhotoDataUrl('/vtop/a', 'JSESSIONID=abc', ORIGIN, async () =>
      fakeResponse({ status: 302, location: 'https://evil.example/x' }),
    );
    expect(result.dataUrl).toBeUndefined();
    expect(result.diag.steps[0]).toMatchObject({ step: 'blocked-origin', status: 302 });
  });

  it('rejects non-image content types', async () => {
    const result = await fetchProfilePhotoDataUrl('/vtop/photo', '', ORIGIN, async () =>
      fakeResponse({ contentType: 'text/html', body: '<html>not an image</html>' }),
    );
    expect(result.dataUrl).toBeUndefined();
    expect(result.diag.steps[0].step).toBe('bad-content-type');
  });

  it('rejects an image response larger than the byte cap', async () => {
    const big = new Uint8Array(MAX_PROFILE_PHOTO_BYTES + 10).fill(0x41);
    const result = await fetchProfilePhotoDataUrl('/vtop/photo.jpg', '', ORIGIN, async () =>
      fakeResponse({ contentType: 'image/jpeg', body: big.buffer }),
    );
    expect(result.dataUrl).toBeUndefined();
    expect(result.diag.steps[0]).toMatchObject({ step: 'too-large', bytes: MAX_PROFILE_PHOTO_BYTES + 10 });
  });

  it('never includes cookies or photo bytes in diagnostics metadata', async () => {
    const result = await fetchProfilePhotoDataUrl('/vtop/photo.jpg', 'JSESSIONID=SECRET', ORIGIN, async () =>
      fakeResponse({ contentType: 'image/jpeg', body: PNG_1PX.buffer }),
    );
    const serialized = JSON.stringify(result.diag);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('JSESSIONID');
    expect(serialized.length).toBeLessThan(600);
  });
});

describe('summarizePhotoDiag', () => {
  it('summarizes success without leaking bytes', () => {
    const summary = summarizePhotoDiag({
      steps: [{ step: 'fetched', ok: true, contentType: 'image/jpeg', bytes: 1234, hops: 1 }],
      success: true,
    });
    expect(summary).toContain('image/jpeg');
    expect(summary).toContain('1234B');
    expect(summary).toContain('1 hop(s)');
  });

  it('summarizes failure by step and status', () => {
    const summary = summarizePhotoDiag({
      steps: [{ step: 'http-error', ok: false, status: 404 }],
      success: false,
    });
    expect(summary).toBe('photo unavailable: http-error (HTTP 404)');
  });
});
