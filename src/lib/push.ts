/**
 * push.ts — background notifications (Web Push) for UltraCC.
 *
 * The problem this solves: local notifications only fire while UltraCC is open,
 * so a class reminder at 08:50 or a quiz closing in 5 minutes is useless if the
 * browser is closed. Background notifications need a server, and the server
 * needs to know when to speak.
 *
 * Design — the device plans, the server only delivers:
 *   1. THIS module computes an absolute reminder plan from already-synced data
 *      (`buildPushPlan`): epoch seconds, a title, a body, and where to open.
 *   2. It uploads the plan together with the browser's own PushSubscription
 *      (via `upsert_push_subscription`), keyed by a per-device capability code.
 *   3. A scheduled edge function claims whatever is due and pushes it. No
 *      timetable, marks, attendance or credentials ever leave the device
 *      beyond that minimal plan, and turning the toggle off deletes the row.
 *
 * Everything in `buildPushPlan` is pure and unit-tested; the network half is
 * deliberately thin.
 */

import type { TimetableSlot } from '../types';
import { computeQuizTriggers } from './lms/notifications';
import type { LmsQuizWindow } from './lms/types';
import { makeDeviceCode } from './phoneIdentity';
import { callBackendRpc, BackendError } from './communityBackend';
import { debugErrorDetail, humanErrorCopy } from './errorCopy';

export interface PushReminder {
  id: string;
  /** Epoch SECONDS, UTC — timezone-proof once it leaves the device. */
  at: number;
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushPlanInput {
  /** Timetable rows are already combined sessions (a lab is ONE row). */
  timetable: Pick<TimetableSlot, 'day' | 'startTime' | 'endTime' | 'courseCode' | 'venue' | 'isLab' | 'slot'>[];
  quizzes?: LmsQuizWindow[];
  now?: number;
  /** Lead time for a class reminder. Matches the in-app pipeline (10 min). */
  leadMinutes?: number;
  /** How far ahead to plan. Reminders are refreshed on every app open/sync. */
  horizonDays?: number;
  /** Hard cap so one device can never upload an unbounded plan. */
  maxReminders?: number;
}

export const PUSH_LEAD_MINUTES = 10;
export const PUSH_HORIZON_DAYS = 7;
export const PUSH_MAX_REMINDERS = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function isoDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clockLabel(value: string): string {
  const match = (value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value || '';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function toMinutes(value: string): number | null {
  const match = (value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Build the reminder plan for the next few days.
 *
 * Class reminders mirror the in-app ones exactly (10 minutes before the start,
 * one per session, so a 2-period lab never fires twice) but with absolute
 * timestamps, which is what a closed browser needs. Quiz reminders reuse the
 * LMS trigger definitions (15 min before open, 15/5 min before close) so the
 * device and the server always agree on the wording.
 */
export function buildPushPlan(input: PushPlanInput): PushReminder[] {
  const now = input.now ?? Date.now();
  const leadMinutes = input.leadMinutes ?? PUSH_LEAD_MINUTES;
  const horizonDays = input.horizonDays ?? PUSH_HORIZON_DAYS;
  const maxReminders = input.maxReminders ?? PUSH_MAX_REMINDERS;

  const out: PushReminder[] = [];
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // --- Classes -------------------------------------------------------------
  const byDay = new Map<string, PushPlanInput['timetable']>();
  for (const slot of input.timetable) {
    if (!slot.day) continue;
    const list = byDay.get(slot.day) ?? [];
    list.push(slot);
    byDay.set(slot.day, list);
  }

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const dayStart = new Date(startOfToday.getTime() + offset * DAY_MS);
    const weekday = WEEKDAYS[dayStart.getDay()];
    const slots = byDay.get(weekday);
    if (!slots) continue;

    for (const slot of slots) {
      const minutes = toMinutes(slot.startTime);
      if (minutes === null) continue;
      const classStart = new Date(dayStart.getTime() + minutes * 60 * 1000);
      const at = classStart.getTime() - leadMinutes * 60 * 1000;
      if (at <= now) continue; // already started, or the reminder window passed
      out.push({
        // Same identity shape as the in-app candidate, so both pipelines are
        // diagnosable side by side. Push ids live in their own ledger.
        id: `class:${isoDay(classStart.getTime())}:${slot.courseCode}:${slot.startTime}`,
        at: Math.floor(at / 1000),
        title: `Class soon: ${slot.courseCode}`,
        body: `Starts in ${leadMinutes} min${slot.slot ? ` · slot ${slot.slot}` : ''}${slot.venue ? ` at ${slot.venue}` : ''}${slot.endTime ? ` · runs until ${clockLabel(slot.endTime)}` : ''}.`,
        url: '/?tab=timetable',
        tag: `class:${slot.courseCode}`,
      });
    }
  }

  // --- LMS quiz windows ----------------------------------------------------
  for (const quiz of input.quizzes ?? []) {
    for (const trigger of computeQuizTriggers(quiz, now)) {
      if (trigger.at <= now) continue;
      out.push({
        id: `quiz:${trigger.id}`,
        at: Math.floor(trigger.at / 1000),
        title: trigger.title,
        body: trigger.body,
        url: '/?tab=lms',
        tag: `quiz:${trigger.quizId}`,
      });
    }
  }

  // Dedupe by id, keep chronological order, then bound the payload.
  const unique = new Map<string, PushReminder>();
  for (const reminder of out.sort((a, b) => a.at - b.at)) {
    if (!unique.has(reminder.id)) unique.set(reminder.id, reminder);
  }
  return [...unique.values()].slice(0, maxReminders);
}

/** Count of reminders still ahead of `now` (for the settings summary). */
export function countUpcoming(plan: PushReminder[], now = Date.now()): number {
  return plan.filter((reminder) => reminder.at * 1000 > now).length;
}

// ---------------------------------------------------------------------------
// Device code (capability token, same model as Cab Share)
// ---------------------------------------------------------------------------

const DEVICE_KEY = 'ultracc.push.deviceCode';

export function getPushDeviceCode(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length >= 16) return existing;
    const code = makeDeviceCode();
    localStorage.setItem(DEVICE_KEY, code);
    return code;
  } catch {
    // Private mode: a session-only code still works, it just cannot persist.
    return makeDeviceCode();
  }
}

// ---------------------------------------------------------------------------
// Capability / preference state
// ---------------------------------------------------------------------------

const ENABLED_KEY = 'ultracc.push.enabled';

/**
 * The deployment's VAPID public key.
 *
 * A VAPID public key is *designed* to be public — every browser sends it back
 * in its own PushSubscription — so it is safe to keep as a code default. That
 * makes background notifications work on a fresh deployment without any build
 * environment setup; the matching PRIVATE key stays a server-side secret
 * (edge function secret VAPID_PRIVATE_KEY, never in this repo).
 *
 * Rotate both values together (`npm run vapid`) and set VITE_VAPID_PUBLIC_KEY
 * if you prefer to inject it at build time instead.
 */
export const DEFAULT_VAPID_PUBLIC_KEY =
  'BNp3bQ5AGtRuQqc3RzB5MBICVievsPT8g0WFkKYFWrtjm0PMT9sbyQVuyrfl4_8wLZAdnm3AjTHozI96tFITcZ4';

export function pushPublicKey(): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const value = env?.VITE_VAPID_PUBLIC_KEY;
  return value && value.trim() ? value.trim() : DEFAULT_VAPID_PUBLIC_KEY;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

export function isPushEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function setPushEnabledFlag(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, 'true');
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* storage unavailable */
  }
}

export interface BackgroundPushState {
  supported: boolean;
  configured: boolean;
  permission: NotificationPermission | 'unsupported';
  enabled: boolean;
  subscribed: boolean;
}

export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    return await (await registration()).pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function backgroundPushState(): Promise<BackgroundPushState> {
  const subscription = await getPushSubscription();
  return {
    supported: pushSupported(),
    configured: pushPublicKey() !== null,
    permission: notificationPermission(),
    enabled: isPushEnabled(),
    subscribed: subscription !== null,
  };
}

// ---------------------------------------------------------------------------
// Server sync
// ---------------------------------------------------------------------------

function subscriptionKeys(subscription: PushSubscription) {
  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return {
    endpoint: subscription.endpoint || json.endpoint || '',
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
  };
}

async function uploadPlan(subscription: PushSubscription, plan: PushReminder[]): Promise<void> {
  const keys = subscriptionKeys(subscription);
  await callBackendRpc<boolean>('upsert_push_subscription', {
    p_device_code: getPushDeviceCode(),
    p_endpoint: keys.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_reminders: plan,
    p_locale: typeof navigator !== 'undefined' ? navigator.language : null,
    p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
  });
}

/**
 * Turn a backend failure into something a student can act on.
 *
 * The common real-world case is a deployment whose database has not had the
 * push migration applied yet: PostgREST answers 404 with "schema cache", which
 * would otherwise reach the user as an opaque "backend 404". The student only
 * needs to know the feature is not available yet and what still works; the
 * migration pointer is operator detail and goes to the dev console. Returns
 * null when there is no more useful wording than the underlying message.
 */
export function classifyPushBackendError(status: number, body: string): string | null {
  const missing = status === 404 || /PGRST202|PGRST20[0-9]|does not exist|Could not find the function/i.test(body);
  if (missing) {
    debugErrorDetail('push-backend', 'reminders are unavailable because the push_notifications migration has not been applied on this deployment (see README → Background notifications)');
    return 'Background reminders aren\'t available yet, so UltraCC can only notify you while it is open.';
  }
  if (status >= 500) return 'The notification service is temporarily unavailable. Try again in a moment.';
  return null;
}

export interface EnablePushResult {
  ok: boolean;
  /** Why it could not be enabled — shown verbatim to the user. */
  reason?: string;
  state: BackgroundPushState;
}

/**
 * Turn background notifications on: permission → subscription → plan upload.
 * Each failure returns an honest reason rather than leaving a half-on switch.
 */
export async function enableBackgroundPush(plan: PushReminder[]): Promise<EnablePushResult> {
  if (!pushSupported()) {
    return { ok: false, reason: 'This browser does not support background notifications.', state: await backgroundPushState() };
  }
  const publicKey = pushPublicKey();
  if (!publicKey) {
    debugErrorDetail('push-backend', 'VITE_PUSH_PUBLIC_KEY (the server VAPID public key) is not configured for this deployment');
    return {
      ok: false,
      reason: 'Background reminders aren\'t available yet, so UltraCC can only notify you while it is open.',
      state: await backgroundPushState(),
    };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = 'denied';
    }
  }
  if (permission !== 'granted') {
    return {
      ok: false,
      reason: permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in your browser settings, then try again.'
        : 'Notification permission is required for background notifications.',
      state: await backgroundPushState(),
    };
  }

  try {
    const reg = await registration();
    const existing = await reg.pushManager.getSubscription();
    const subscription = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await uploadPlan(subscription, plan);
    setPushEnabledFlag(true);
    return { ok: true, state: await backgroundPushState() };
  } catch (error) {
    const classified = error instanceof BackendError
      ? classifyPushBackendError(error.status, error.body)
      : null;
    // A failed `pushManager.subscribe` throws a DOMException whose message is
    // browser internals ("The operation was aborted.", "NetworkError"). The
    // reason below renders in Settings, so only a curated sentence goes there.
    return {
      ok: false,
      reason: classified ?? humanErrorCopy(error, 'Background notifications could not be turned on. Try again.'),
      state: await backgroundPushState(),
    };
  }
}

/**
 * Refresh the plan after a sync. Silent by design: a failure here must never
 * interrupt the app, and the next sync retries.
 */
export async function refreshBackgroundPush(plan: PushReminder[]): Promise<boolean> {
  if (!isPushEnabled() || !pushSupported()) return false;
  try {
    const subscription = await getPushSubscription();
    if (!subscription) return false;
    await uploadPlan(subscription, plan);
    return true;
  } catch {
    return false;
  }
}

/** Turn it off: forget the row server-side, unsubscribe locally, clear the flag. */
export async function disableBackgroundPush(): Promise<void> {
  setPushEnabledFlag(false);
  try {
    await callBackendRpc<boolean>('delete_push_subscription', { p_device_code: getPushDeviceCode() });
  } catch {
    // The local subscription is dropped regardless; a stale row is inert once
    // the endpoint is unsubscribed, and the next enable replaces it.
  }
  if (!pushSupported()) return;
  try {
    const subscription = await getPushSubscription();
    await subscription?.unsubscribe();
  } catch {
    /* already gone */
  }
}

/** What the server actually holds for this device (masked: counts only). */
export async function fetchServerPushState(): Promise<{ registered: boolean; reminders?: number } | null> {
  try {
    return await callBackendRpc<{ registered: boolean; reminders?: number }>('get_push_subscription', {
      p_device_code: getPushDeviceCode(),
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Delivery health (is the dispatcher actually running?)
// ---------------------------------------------------------------------------

export interface PushHealth {
  /** True when an authorized dispatcher run happened in the last 10 minutes. */
  deliveryActive: boolean;
  /** When the dispatcher last ran at all (ISO string), or null. */
  lastRunAt: string | null;
  runs24h?: number;
  claimed24h?: number;
  sent24h?: number;
  failed24h?: number;
  /** Last run that actually had reminders to deliver — proof of the full path. */
  lastDeliveryAt?: string | null;
}

/**
 * Ask the deployment whether background delivery is alive.
 *
 * This is deliberately a server-truth check: a toggle can be "on" while the
 * scheduler is broken, and the student deserves to know the difference. Returns
 * null when the backend cannot answer (offline, migration missing).
 */
export async function fetchPushHealth(): Promise<PushHealth | null> {
  try {
    return await callBackendRpc<PushHealth>('push_dispatch_health', {});
  } catch {
    return null;
  }
}

/** Human summary of delivery health for the settings UI. */
export function describePushHealth(health: PushHealth | null, now = Date.now()): string | null {
  if (!health) return null;
  if (!health.lastRunAt) return 'The scheduler has not checked in yet — background delivery is not running.';
  if (!health.deliveryActive) return 'The scheduler has stopped checking in — background reminders may not arrive.';

  const delivered = health.sent24h ?? 0;
  const parts = [
    health.lastRunAt ? `checked ${relativeMinutes(health.lastRunAt, now)}` : null,
    delivered > 0 ? `${delivered} delivered in 24h` : null,
    health.lastDeliveryAt ? `last sent ${relativeMinutes(health.lastDeliveryAt, now)}` : null,
  ].filter((part): part is string => Boolean(part));
  return `Server delivery active — ${parts.join(' · ')}.`;
}

function relativeMinutes(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}
