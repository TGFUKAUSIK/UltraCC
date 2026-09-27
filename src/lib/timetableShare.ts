/**
 * timetableShare.ts — privacy-safe read-only timetable sharing.
 *
 * Follows the FFCS share-code convention (ffcsShare.ts): a self-contained
 * text code the recipient can paste into their own UltraCC to view the
 * schedule. NO server round-trip, NO credentials, NO session tokens, NO
 * registration number — only what the user explicitly includes.
 *
 * Expiry/revocation model: the code embeds an expiry timestamp. Viewers'
 * devices refuse to render codes past their expiry (revocation = let it
 * lapse; there is no server to revoke from, so expiry is the honest
 * privacy mechanism). A short default (7 days) bounds exposure.
 */

import type { TimetableSlot } from '../lib/vtop/types';

export const SHARE_PREFIX = 'ULTRA-TT:v1';

/** Default share window: 7 days. */
export const DEFAULT_SHARE_DAYS = 7;

/** Upper bound — anything longer is refused at generation time. */
export const MAX_SHARE_DAYS = 90;

export interface ShareOptions {
  /** Include venues in the shared code. */
  includeVenue?: boolean;
  /** Include faculty names in the shared code. */
  includeFaculty?: boolean;
  /** Share window in days (1–90). */
  expiresInDays?: number;
  /** Override "now" (ms) — for deterministic tests. */
  now?: number;
}

export interface SharePayload {
  /** ISO date the code stops being viewable (ms since epoch). */
  expiresAt: number;
  includeVenue: boolean;
  includeFaculty: boolean;
  slots: Array<{
    day: string;
    startTime: string;
    endTime: string;
    code: string;
    title: string;
    slot: string;
    venue?: string;
    faculty?: string;
  }>;
}

/** Base64url encode UTF-8 text without Node polyfills. */
function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url decode to UTF-8 text. */
function b64urlDecode(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Build a shareable code from the user's timetable.
 * Returns null when there is nothing to share or the options are invalid.
 */
export function encodeTimetableShare(
  slots: TimetableSlot[],
  options: ShareOptions = {},
): string | null {
  if (!slots.length) return null;
  const days = Math.min(Math.max(options.expiresInDays ?? DEFAULT_SHARE_DAYS, 1), MAX_SHARE_DAYS);
  const now = options.now ?? Date.now();
  const payload: SharePayload = {
    expiresAt: now + days * 24 * 60 * 60 * 1000,
    includeVenue: options.includeVenue ?? false,
    includeFaculty: options.includeFaculty ?? false,
    slots: slots.map((s) => ({
      day: s.day,
      startTime: s.startTime,
      endTime: s.endTime,
      code: s.courseCode,
      title: s.courseTitle || '',
      slot: s.slot || '',
      ...(options.includeVenue ? { venue: s.venue || '' } : {}),
      ...(options.includeFaculty ? { faculty: s.facultyName || '' } : {}),
    })),
  };
  return `${SHARE_PREFIX}:${b64urlEncode(JSON.stringify(payload))}`;
}

export interface TimetableShareResult {
  slots: Array<{ day: string; startTime: string; endTime: string; code: string; title: string; slot: string; venue?: string; faculty?: string }>;
  /** Epoch ms when the code expires. */
  expiresAt: number;
  includeVenue: boolean;
  includeFaculty: boolean;
}

/** Why a share code cannot be viewed. */
export type ShareRejectReason = 'not-a-share-code' | 'corrupted' | 'expired';

export interface TimetableShareOutcome {
  ok: boolean;
  reason?: ShareRejectReason;
  data?: TimetableShareResult;
}

/**
 * Decode a share code. Expired codes are REFUSED (not served stale) —
 * expiry is the revocation mechanism, so it must be honored.
 */
export function decodeTimetableShare(text: string, now: number = Date.now()): TimetableShareOutcome {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith(`${SHARE_PREFIX}:`)) return { ok: false, reason: 'not-a-share-code' };
  let payload: SharePayload;
  try {
    payload = JSON.parse(b64urlDecode(trimmed.slice(SHARE_PREFIX.length + 1))) as SharePayload;
  } catch {
    return { ok: false, reason: 'corrupted' };
  }
  if (!payload || !Array.isArray(payload.slots) || typeof payload.expiresAt !== 'number') {
    return { ok: false, reason: 'corrupted' };
  }
  if (now >= payload.expiresAt) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    data: {
      expiresAt: payload.expiresAt,
      includeVenue: Boolean(payload.includeVenue),
      includeFaculty: Boolean(payload.includeFaculty),
      slots: payload.slots.map((s) => ({
        day: s.day, startTime: s.startTime, endTime: s.endTime,
        code: s.code, title: s.title || '', slot: s.slot || '',
        ...(payload.includeVenue ? { venue: s.venue || '' } : {}),
        ...(payload.includeFaculty ? { faculty: s.faculty || '' } : {}),
      })),
    },
  };
}

/** Human-readable expiry label for the UI. */
export function describeExpiry(expiresAt: number, now: number = Date.now()): string {
  const remaining = expiresAt - now;
  if (remaining <= 0) return 'expired';
  const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  if (days <= 1) return 'expires within a day';
  return `expires in ${days} days`;
}

/** Privacy summary of what a code carries — shown before the user shares. */
export function describeShareContents(options: ShareOptions): string[] {
  const items = ['Course codes, titles, days, times and slots'];
  if (options.includeVenue) items.push('Venues');
  if (options.includeFaculty) items.push('Faculty names');
  items.push('No registration number, credentials or session data');
  return items;
}
