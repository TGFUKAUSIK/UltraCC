/**
 * useBackgroundPush — one owner for the background-notification lifecycle.
 *
 * Mounted once (App) so the plan is built and uploaded from a single place:
 *   - recompute the reminder plan from synced data (cheap, pure)
 *   - keep the server's copy fresh after every sync, debounced
 *   - expose the toggle state for the bell and Settings
 *
 * Nothing here fires notifications itself: while the app is open the existing
 * in-app pipeline handles delivery, and the server handles the closed-browser
 * case. That split is why the same reminder is never shown twice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TimetableSlot } from '../types';
import type { LmsQuizWindow } from '../lib/lms/types';
import {
  backgroundPushState, buildPushPlan, countUpcoming, disableBackgroundPush,
  describePushHealth, enableBackgroundPush, fetchPushHealth, refreshBackgroundPush,
  type BackgroundPushState, type PushHealth, type PushReminder,
} from '../lib/push';

export interface BackgroundPushController extends BackgroundPushState {
  /** Reminders currently scheduled ahead of now. */
  upcoming: number;
  /** True while a toggle/subscribe round trip is in flight. */
  busy: boolean;
  /** Last honest outcome ("Blocked in browser settings", "On · 12 reminders"…). */
  message: string | null;
  /** Server-side truth: is the dispatcher actually running? */
  health: PushHealth | null;
  /** One-line delivery-health summary, or null when it cannot be determined. */
  healthNote: string | null;
  toggle: () => Promise<void>;
}

export function useBackgroundPush(input: {
  timetable: TimetableSlot[];
  quizzes: LmsQuizWindow[];
}): BackgroundPushController {
  const { timetable, quizzes } = input;
  const [state, setState] = useState<BackgroundPushState>({
    supported: false, configured: false, permission: 'unsupported', enabled: false, subscribed: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [health, setHealth] = useState<PushHealth | null>(null);
  // Re-plan periodically so the horizon keeps sliding even if data is static.
  const [tick, setTick] = useState(() => Date.now());

  const plan = useMemo<PushReminder[]>(
    () => buildPushPlan({ timetable, quizzes, now: tick > 0 ? tick : undefined }),
    [timetable, quizzes, tick],
  );
  const upcoming = useMemo(() => countUpcoming(plan, tick), [plan, tick]);

  const syncState = useCallback(async () => {
    const next = await backgroundPushState();
    setState(next);
    return next;
  }, []);

  // Server truth travels with local state: a toggle can be "on" while the
  // scheduler is dead, and the UI must be able to say so.
  const syncHealth = useCallback(async () => {
    setHealth(await fetchPushHealth());
  }, []);

  useEffect(() => { void syncState(); void syncHealth(); }, [syncState, syncHealth]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Health ages quickly (a dead scheduler must show as dead), so poll it on a
  // shorter cadence than the plan horizon.
  useEffect(() => {
    const timer = window.setInterval(() => void syncHealth(), 2 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [syncHealth]);

  // Any data change refreshes the server's plan while the toggle is on. The
  // debounce keeps a burst of syncs from uploading repeatedly.
  const firstRun = useRef(true);
  useEffect(() => {
    if (!state.enabled) return undefined;
    if (firstRun.current) { firstRun.current = false; return undefined; }
    const timer = window.setTimeout(() => { void refreshBackgroundPush(plan); }, 3000);
    return () => window.clearTimeout(timer);
  }, [plan, state.enabled]);

  // The browser can rotate a subscription behind our back; re-register when it
  // says so instead of going quiet.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGE') {
        void (async () => {
          if (!state.enabled) { await syncState(); return; }
          const result = await enableBackgroundPush(plan);
          setMessage(result.reason ?? 'Background notifications re-registered.');
          await syncState();
        })();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [plan, state.enabled, syncState]);

  const toggle = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (state.enabled) {
        await disableBackgroundPush();
        setMessage('Background notifications are off — reminders only arrive while UltraCC is open.');
      } else {
        const result = await enableBackgroundPush(plan);
        setMessage(result.reason ?? `Background notifications are on · ${countUpcoming(plan)} reminders scheduled.`);
      }
      await syncState();
      await syncHealth();
    } finally {
      setBusy(false);
    }
  }, [plan, state.enabled, syncState, syncHealth]);

  return { ...state, upcoming, busy, message, health, healthNote: describePushHealth(health), toggle };
}
