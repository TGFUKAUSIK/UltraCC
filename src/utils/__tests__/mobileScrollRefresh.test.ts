/**
 * Mobile scroll must never trigger a refresh (production bug).
 *
 * What happened: a touchmove handler on <main> measured downward drags from the
 * top of the page and, once the resisted distance passed 72px, called the same
 * `handleRefresh` the header button calls. With no live VTOP session in the tab
 * that path opens the login modal and toasts "VTOP session expired" — so an
 * ordinary fast flick down a long list looked like "the app refreshed itself and
 * signed me out". The pull gesture has been deleted rather than tuned: the brief
 * is explicit that normal scrolling must NEVER refresh, and timing/threshold
 * hacks are exactly what failed here.
 *
 * These guards keep it dead: no scroll-ish listener may exist in src/, refresh
 * may only be reachable from explicit controls, the CSS must still pin native
 * browser overscroll refresh off, and no pull-indicator markup may return.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../..');
const CSS = resolve(SRC, 'index.css');
const APP = join(SRC, 'App.tsx');

/** Scroll gestures that can be hijacked into a refresh. */
const GESTURE_PATTERNS: [RegExp, string][] = [
  [/addEventListener\(\s*['"]touchmove['"]/i, 'touchmove listener'],
  [/addEventListener\(\s*['"]wheel['"]/i, 'wheel listener'],
  [/onTouchMove\s*=/i, 'onTouchMove handler'],
  [/onScroll\s*=\s*\{\s*\(?[^}]*refresh/i, 'onScroll wired to a refresh'],
  [/useMobilePullToRefresh/i, 'the deleted pull-to-refresh hook'],
  [/pullDistance|pullReady/i, 'pull-to-refresh state'],
];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('no scroll gesture can trigger a refresh', () => {
  const files = sourceFiles(SRC);

  it('src/ registers no touchmove/wheel listener or pull-to-refresh state', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      for (const [pattern, label] of GESTURE_PATTERNS) {
        expect(pattern.test(text), `${label} found in ${file.replace(SRC, 'src')}`).toBe(false);
      }
    }
  });

  it('handleRefresh is only reachable from explicit controls', () => {
    const app = readFileSync(APP, 'utf-8');
    const lines = app.split('\n').filter((line) => /handleRefresh/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const allowed =
        /const handleRefresh = useCallback/.test(line) ||
        /onManualRefresh=\{[^}]*handleRefresh/.test(line) ||
        /onRefresh[^\]]*handleRefresh/.test(line) ||
        /handleRefresh[,:]\s*handleRefresh/.test(line) ||
        /refresh: handleRefresh/.test(line) ||
        /^\s*(\/\/|\*)/.test(line);
      expect(allowed, line.trim()).toBe(true);
    }
  });

  it('the pull-to-refresh module is gone for good', () => {
    expect(() => readFileSync(join(SRC, 'hooks/useMobilePullToRefresh.ts'), 'utf-8')).toThrow();
    expect(() => readFileSync(join(SRC, 'utils/mobileRefresh.ts'), 'utf-8')).toThrow();
  });
});

describe('native overscroll refresh stays pinned off', () => {
  const css = readFileSync(CSS, 'utf-8');

  it('the mobile document rules set overscroll-behavior-y:none', () => {
    const block = css.match(/@media \(max-width:768px\)\{[^}]*overscroll-behavior-y:none[^}]*\}/);
    expect(block, 'no overscroll-behavior-y:none document rule found').toBeTruthy();
    expect(block![0]).toMatch(/html,body/);
  });

  it('no pull-indicator styling survives to imply the gesture exists', () => {
    expect(css).not.toMatch(/mobile-pull-indicator/);
  });

  it('the scrollable main area still allows natural vertical panning', () => {
    // overscroll-behavior only kills the chained overscroll gesture; touch-action
    // must stay pan-y so two-finger/one-finger scrolling is untouched.
    expect(css).toMatch(/\.ultracc-main\{[^}]*touch-action:pan-y/);
  });
});
