import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import {BUILD_ID} from './lib/buildInfo';
import {trackVisibleViewportHeight} from './utils/visibleViewport';
// The app's own two faces, self-hosted so the PWA is typographically itself
// with no network: a variable grotesque for everything that is read, one
// variable mono for everything that is counted. Loading them from a CDN would
// leave an installed app on the campus wifi wearing the phone's system font.
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
// Versioned import so installed PWA shells pick up new stylesheet changes.
import './index.css?ultracc-portal-v32';

const ENV = (import.meta as unknown as { env?: { DEV?: boolean } }).env;

// Per-build version query: each deploy gets a new script URL, so an open tab or
// installed PWA installs the new worker on its next load.
//
// Production only. In dev, Vite serves the app's source modules and stylesheet
// on the fly, and a cache-first worker would pin the first copy it saw — every
// edit invisible until the cache was cleared by hand. The worker also refuses
// those dev paths in its fetch handler, so an already-installed worker cannot do
// it either.
if (!ENV?.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${BUILD_ID}`, { updateViaCache: 'none' }).catch(() => {});
  });
}

// Dev-only: log which build this tab is running.
if (ENV?.DEV) {
  console.info(`[build] ${BUILD_ID} · service worker not registered in dev`);
}

/**
 * A deploy deletes the hashed chunks the running bundle was built against, so a
 * stale PWA shell can request a chunk that no longer exists. Reload once; the
 * per-tab flag prevents a network outage from becoming a reload loop.
 */
const PRELOAD_RELOAD_KEY = 'ultracc:preload-reloaded';
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    if (window.sessionStorage.getItem(PRELOAD_RELOAD_KEY)) return;
    window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
  } catch { /* storage-less web views: fall through to the boundary */ }
  window.location.reload();
});

// Publish the visible viewport height before the first paint. The phone shell
// sizes itself from it and the tab bar is that shell's last row, so the bar's
// bottom edge is the bottom edge the student actually sees — in Safari, in the
// installed home-screen app, and with the keyboard open.
trackVisibleViewportHeight(document.documentElement);

/**
 * `react` is installed here without type declarations, so tsc infers the base
 * class from React's JS and does not see the prototype members a class component
 * inherits. That makes the bare class look like an invalid JSX element type even
 * though it is a plain boundary; naming it through this alias is the one-line
 * cast the inference needs, and it changes nothing at runtime.
 */
const Boundary = ErrorBoundary as unknown as (props: { children?: React.ReactNode }) => React.ReactElement | null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Catch anything that throws outside a route boundary. */}
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
