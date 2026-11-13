/**
 * The service worker's release contract.
 *
 * - The shell cache is versioned, and its version moves in step with the
 *   stylesheet's own cache-bust query in main.tsx. If they drift, an installed
 *   PWA keeps its old CSS while claiming to be up to date.
 * - On activate, every cache that is not the current one is deleted — that is
 *   what actually evicts the old stylesheet, so it must not be relaxed.
 * - The new worker never activates itself: install does not skipWaiting, and
 *   only the client's SKIP_WAITING message does. A silent swap mid-task is
 *   exactly the interruption the update prompt exists to avoid.
 * - In dev, Vite serves /src/* modules and the stylesheet on the fly. The worker
 *   refuses those paths, and main.tsx does not register it at all — otherwise the
 *   cache-first branch would pin the first copy of a module and make every edit
 *   invisible until the cache was cleared by hand.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SW = readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src', 'main.tsx'), 'utf8');

/** A slice of sw.js between two markers, so a pattern cannot match the wrong one. */
function between(startMarker: string, endMarker: string): string {
  const start = SW.indexOf(startMarker);
  expect(start, startMarker).toBeGreaterThan(-1);
  const end = SW.indexOf(endMarker, start);
  expect(end, endMarker).toBeGreaterThan(start);
  return SW.slice(start, end);
}

/** Comments are prose — the "No automatic skipWaiting" note must not read as a call. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the shell cache is versioned and evicted', () => {
  it('names the cache with a numeric version', () => {
    const match = SW.match(/const CACHE_NAME = '(ultracc-shell-v(\d+))'/);
    expect(match).toBeTruthy();
    expect(Number.isInteger(Number(match![2]))).toBe(true);
    // The redesign bumped the shell; a name that fell back below the live one
    // would leave installed apps serving the pre-redesign stylesheet.
    expect(Number(match![2])).toBeGreaterThanOrEqual(6);
  });

  it('moves the shell version and the stylesheet cache-bust together', () => {
    const shell = SW.match(/const CACHE_NAME = 'ultracc-shell-v(\d+)'/)![1];
    const portal = MAIN.match(/index\.css\?ultracc-portal-v(\d+)/);
    expect(portal, 'main.tsx stylesheet cache-bust query').toBeTruthy();
    // If these two numbers drift, an installed PWA can keep an old stylesheet
    // while the worker reports itself current — the exact failure this guards.
    expect(portal![1]).toBe(shell);
  });

  it('deletes every other cache on activate, then claims the clients', () => {
    const activate = SW.slice(SW.indexOf("addEventListener('activate'"));
    expect(activate).toMatch(/keys\.filter\(\(k\) => k !== CACHE_NAME\)\.map\(\(k\) => caches\.delete\(k\)\)/);
    expect(activate).toContain('await self.clients.claim()');
  });
});

describe('the update is client-driven', () => {
  it('never activates itself from install', () => {
    const install = code(between("addEventListener('install'", "addEventListener('message'"));
    expect(install).toContain('caches.open(CACHE_NAME)');
    expect(install).not.toContain('skipWaiting');
  });

  it('activates only when the client asks', () => {
    expect(SW).toMatch(/event\.data\?\.type === 'SKIP_WAITING'[\s\S]{0,40}self\.skipWaiting\(\)/);
  });

  it('asks the browser for a fresh worker on every registration', () => {
    expect(MAIN).toMatch(/register\(`\/sw\.js\?v=\$\{BUILD_ID\}`, \{ updateViaCache: 'none' \}\)/);
  });
});

describe('dev never runs through the cache', () => {
  it('refuses Vite dev paths before the cache-first asset branch', () => {
    expect(SW).toMatch(/url\.pathname\.startsWith\('\/src\/'\)/);
    expect(SW).toMatch(/url\.pathname\.startsWith\('\/@'\)/);
    expect(SW).toMatch(/url\.pathname\.startsWith\('\/node_modules\/'\)/);
    // The bypass has to sit above the `.css`/`.js` cache-first test, or a dev
    // stylesheet edit would still be served from the cache.
    expect(SW.indexOf("startsWith('/src/')")).toBeLessThan(SW.indexOf("endsWith('.css')"));
  });

  it('registers the worker in production only', () => {
    expect(MAIN).toMatch(/if \(!ENV\?\.DEV && 'serviceWorker' in navigator\)/);
  });
});
