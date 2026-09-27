/**
 * Live VTOP session holder.
 *
 * The RealVTOPClient keeps its encrypted session token in a private class
 * field (browser memory only). This module makes ONE such client instance
 * shared across the sync modal and the dashboard's semester switcher, so a
 * semester change can re-sync without forcing a re-login while the page is
 * open.
 *
 * SECURITY: this is memory-only. The token is never written to
 * localStorage / sessionStorage / IndexedDB, is gone on page reload or
 * logout, and every re-sync still goes through the stateless gateway with
 * the encrypted session token passed per request.
 */

import { RealVTOPClient } from './realClient';

let liveClient: RealVTOPClient | null = null;

/**
 * Session-state subscribers.
 *
 * `isLiveSessionActive()` has always been the truth, but reading a truth at
 * render time is not the same as being told when it changes. This is the one
 * place that turns the client's transitions into a notification, so a screen
 * open while the student signs in updates the moment VTOP answers — no polling,
 * no second session, no cached copy of the answer that could drift.
 */
const sessionListeners = new Set<() => void>();

/**
 * What subscribers were last told, so this announces transitions rather than
 * method calls. A subscriber only ever reads `isLiveSessionActive()`, so a
 * notification carrying the same answer would be a re-render for no reason.
 */
let lastAnnounced: boolean | null = null;

/**
 * Whether THIS tab ever held a signed-in VTOP session.
 *
 * The token lives in memory, so an ordinary page reload and a session VTOP
 * actually ended look identical from the outside — and they are different
 * sentences. Saying "your session expired" after a reload reports an event that
 * never happened (brief §5: a normal reload must not falsely report an expired
 * session), and it sends the student looking for an account problem when the
 * only fact is that this tab has not signed in yet.
 *
 * Nothing is persisted: a reload resets this to false, which is exactly the
 * truth being tracked.
 */
let heldSessionThisTab = false;

function notifySessionListeners(): void {
  const now = isLiveSessionActive();
  if (now) heldSessionThisTab = true;
  if (now === lastAnnounced) return;
  lastAnnounced = now;
  sessionListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // A broken subscriber must never break the VTOP call that changed state.
    }
  });
}

/**
 * True from the moment VTOP accepts credentials in this tab, for as long as the
 * page lives. See `heldSessionThisTab` for why this is not the same question as
 * `isLiveSessionActive()`.
 */
export function hadLiveSessionThisTab(): boolean {
  return heldSessionThisTab;
}

/** A client whose session transitions this module hears about. */
function watchedClient(): RealVTOPClient {
  const client = new RealVTOPClient();
  client.setSessionWatcher(() => notifySessionListeners());
  return client;
}

/** Returns the shared live client, creating it on first use. */
export function getLiveClient(): RealVTOPClient {
  if (!liveClient) liveClient = watchedClient();
  return liveClient;
}

/** Discards the current in-memory session (refresh CAPTCHA / logout). */
export function resetLiveClient(): RealVTOPClient {
  // Assign before the watcher goes on. Installing a watcher makes the client
  // push the state that is true right now, so a watcher installed while the
  // field still named the old client pushed the discarded session as a false
  // "signed in" flash on every screen holding the banner.
  liveClient = new RealVTOPClient();
  liveClient.setSessionWatcher(() => notifySessionListeners());
  // Whatever was signed in before is not any more — subscribers must hear it,
  // or a screen would keep showing "signed in" for a session that is gone. When
  // nothing changed, `lastAnnounced` keeps this quiet.
  notifySessionListeners();
  return liveClient;
}

/**
 * Subscribe to VTOP session changes. Returns the unsubscribe function, which
 * `useSyncExternalStore` calls for you.
 */
export function subscribeLiveSession(onChange: () => void): () => void {
  sessionListeners.add(onChange);
  return () => {
    sessionListeners.delete(onChange);
  };
}

/** The subscribed value. Stable reference — safe as an external-store getter. */
export function getLiveSessionSnapshot(): boolean {
  return isLiveSessionActive();
}

/**
 * True while a signed-in VTOP session exists in memory.
 *
 * Prefer `useLiveSessionActive()` in a component: it is the same answer, and it
 * re-renders when the answer changes. This function is for code that only wants
 * the value once (a request guard, a sync decision).
 *
 * Deliberately NOT `hasSessionToken()`: a token appears as soon as the login
 * modal arms a CAPTCHA, long before VTOP has accepted any credentials. Treating
 * that as an active session made the background refresher fire FETCH_DATA
 * against an unauthenticated session — a gateway HTTP 500 ("Not authenticated
 * — call DO_LOGIN first") toast on top of the very login screen the student
 * was still filling in.
 */
export function isLiveSessionActive(): boolean {
  return !!liveClient?.isAuthenticated();
}
