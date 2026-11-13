/**
 * An installed app must be able to tell the student it is out of date.
 *
 * Reported from a phone: the More sheet still did not appear after the sheet had
 * been measured correct in a browser. The reason a fix can miss a phone is here,
 * not in the stylesheet: `public/sw.js` never calls `skipWaiting()` (guarded by
 * `serviceWorkerCache.test.ts`, because a silent swap mid-task is worse than a
 * late one), so an installed shell keeps serving the copy it cached until the
 * student taps "Refresh". And `PwaStatusBar` answered "already installed → nothing
 * to offer" by hiding *every* chip, including that one. The notice that unlocks a
 * cached build was reachable only from the browser tab the app had replaced.
 *
 * Discovery is the other half: a registered worker re-fetches `/sw.js` when the
 * browser feels like it, which on iOS can mean many openings. So the hook has to
 * ask — on mount and whenever the app comes back to the foreground.
 *
 * What may not change: the worker still never activates on its own, and installing
 * is still noise once the app is installed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PwaStatusBar } from '../PwaStatusBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement | undefined;
let root: Root | undefined;
const cleanups: Array<() => void> = [];

interface WorkerShape {
  /** A build is installed and waiting for the student’s tap. */
  hasWaiting?: boolean;
  /** Older WebKit has no `registration.update()`. */
  hasUpdate?: boolean;
}

/** The registration object as a real browser reports it, with spies on everything. */
function installFakeWorker({ hasWaiting = true, hasUpdate = true }: WorkerShape = {}) {
  const waiting = hasWaiting ? { state: 'installed', postMessage: vi.fn() } : null;
  const registration: Record<string, unknown> = {
    waiting,
    installing: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const update = hasUpdate ? vi.fn(() => Promise.resolve(registration)) : undefined;
  if (hasUpdate) registration.update = update;
  const host = {
    controller: hasWaiting ? { scriptURL: '/sw.js' } : null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getRegistration: vi.fn(() => Promise.resolve(registration)),
  };
  Object.defineProperty(window.navigator, 'serviceWorker', { value: host, configurable: true });
  cleanups.push(() => {
    Object.defineProperty(window.navigator, 'serviceWorker', { value: undefined, configurable: true });
  });
  return { waiting, registration, update };
}

/** `navigator.standalone` is how an iOS home-screen app says it is installed. */
function markStandalone(on: boolean) {
  Object.defineProperty(window.navigator, 'standalone', { value: on, configurable: true });
  cleanups.push(() => {
    Object.defineProperty(window.navigator, 'standalone', { value: undefined, configurable: true });
  });
}

/** iOS is the platform with no install prompt, so it gets the manual hint. */
function markIOS(on: boolean) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: on
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    configurable: true,
  });
  cleanups.push(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      configurable: true,
    });
  });
}

async function renderChip() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(PwaStatusBar));
  });
  // `getRegistration()` resolves on a microtask and `update()` after it; both must
  // land before a chip can exist.
  await act(async () => {});
  await act(async () => {});
}

const refreshButton = () =>
  [...(container?.querySelectorAll<HTMLButtonElement>('.uc-install-act') ?? [])][0] ?? null;

/** `applyUpdate` reloads on a 1200ms timer; faking the clock drops it with the test. */
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  for (const off of cleanups.splice(0)) off();
  vi.useRealTimers();
});

describe('the update notice in an installed app', () => {
  it('offers the refresh to the home-screen build that is serving a cached shell', async () => {
    // `applyUpdate` reloads on a 1200ms timer; a real one would tear down this window.
    vi.useFakeTimers();
    markStandalone(true);
    const { waiting } = installFakeWorker();
    await renderChip();

    const chip = container!.querySelector('.uc-install');
    expect(chip, 'an installed app with a waiting build must say so').toBeTruthy();
    expect(chip!.textContent).toMatch(/updated/i);

    const action = refreshButton();
    expect(action).toBeTruthy();
    await act(async () => {
      action!.click();
    });
    // Only the student’s tap may activate the new worker.
    expect(waiting!.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('says nothing about installing to an app that is already installed', async () => {
    markStandalone(true);
    installFakeWorker({ hasWaiting: false });
    await renderChip();
    expect(container!.querySelector('.uc-install')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Add to Home Screen/i);
  });

  it('keeps the manual hint for the browser tab that has installed nothing', async () => {
    markStandalone(false);
    markIOS(true);
    installFakeWorker({ hasWaiting: false });
    await renderChip();
    expect(document.body.textContent).toMatch(/Add to Home Screen/i);
  });

  it('asks the browser for a new worker rather than waiting to be told', async () => {
    const { update } = installFakeWorker();
    await renderChip();
    expect(update, 'discovery cannot be left to the browser’s own schedule').toHaveBeenCalled();

    const before = update!.mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(update!.mock.calls.length).toBeGreaterThan(before);
  });

  it('still reports the waiting build when `update()` does not exist', async () => {
    vi.useFakeTimers();
    markStandalone(true);
    installFakeWorker({ hasUpdate: false });
    await renderChip();
    expect(container!.querySelector('.uc-install'), 'no update() may not mean no notice').toBeTruthy();
    // The fallback reload is a timer; let it run so nothing outlives this test.
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
  });
});
