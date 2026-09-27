import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import {BUILD_ID} from './lib/buildInfo';
// Versioned import so installed PWA shells pick up new stylesheet changes.
import './index.css?ultracc-portal-v5';

// Per-build version query: each deploy gets a new script URL, so an open tab or
// installed PWA installs the new worker on its next load.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${BUILD_ID}`, { updateViaCache: 'none' }).catch(() => {});
  });
}

// Dev-only: log which build this tab is running.
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  console.info(`[build] ${BUILD_ID} · service worker /sw.js?v=${BUILD_ID}`);
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Catch anything that throws outside a route boundary. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
