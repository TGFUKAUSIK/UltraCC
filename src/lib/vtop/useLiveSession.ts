/**
 * useLiveSessionActive — the VTOP session as React state.
 *
 * One line over the shared in-memory session holder: `liveSession.ts` owns the
 * single `RealVTOPClient` and pushes its transitions, and this hook mirrors
 * them into a render. There is no second session, no copy of a token and
 * nothing persisted — the value is read from the same private class field
 * `isLiveSessionActive()` has always read, just at the right moments now.
 *
 * WHY IT EXISTS: the Syllabus tab decided "Sign in to fetch from VTOP" by
 * calling that function during render. A login that succeeded while the tab was
 * open therefore left the message standing until something else happened to
 * re-render the page, which read to the student as UltraCC refusing to notice
 * that they had just signed in.
 */

import { useSyncExternalStore } from 'react';
import { getLiveSessionSnapshot, subscribeLiveSession } from './liveSession';

/** True while a signed-in VTOP session exists in this tab — and re-renders on change. */
export function useLiveSessionActive(): boolean {
  return useSyncExternalStore(subscribeLiveSession, getLiveSessionSnapshot, getLiveSessionSnapshot);
}
