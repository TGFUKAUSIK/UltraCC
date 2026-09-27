/**
 * phoneIdentity.ts — Cab Share contact number (plain model, no OTP).
 *
 * UltraCC does NOT verify phone ownership. A Cab Share contact number is
 * self-declared: the user saves one E.164 number per browser device, the
 * server stores it (cabshare_identities, RLS deny-all, SECURITY DEFINER
 * RPCs only), and the privacy model handles the rest:
 *
 *   - The full number is NEVER returned to any browser — not even the
 *     user's own. The UI shows only the server-issued last-4 fragment.
 *   - Numbers stay off the public board; contact exchange opens only after
 *     mutual ride confirmation, and only when the owner has not hidden it.
 *
 * Honest terminology: "mobile number", "contact sharing" — never "verified".
 */

import { SUPABASE_URL, backendHeaders } from './communityBackend';

const DEVICE_KEY = 'ultracc.cabshare.deviceCode';

// ---------------------------------------------------------------------------
// E.164 normalization (pure)
// ---------------------------------------------------------------------------

export interface E164Result {
  ok: boolean;
  e164: string;
  /** Human explanation when ok is false. */
  reason?: string;
}

const INdiaTrunkPrefix = /^0+/;

/**
 * Normalize a user-typed phone number to E.164. Defaults to India (+91)
 * because this is a VIT Chennai product; international numbers must include
 * their own + country code. Pure — no network, no state.
 */
export function normalizeToE164(rawInput: string, defaultCountryCode = '+91'): E164Result {
  const raw = (rawInput ?? '').trim();
  if (!raw) return { ok: false, e164: '', reason: 'Enter your mobile number.' };

  // Explicit international form (E.164: no leading zero after the +).
  if (raw.startsWith('+')) {
    const digits = raw.slice(1).replace(/[\s()-]/g, '');
    if (!/^[1-9]\d{7,14}$/.test(digits)) {
      return { ok: false, e164: '', reason: 'Use the full number with country code, e.g. +91 98765 43210.' };
    }
    return { ok: true, e164: `+${digits}` };
  }

  const digits = raw.replace(/[\s()-]/g, '').replace(INdiaTrunkPrefix, '');
  if (defaultCountryCode === '+91') {
    // Indian mobiles: exactly 10 digits starting 6-9 after stripping the
    // trunk prefix and any typed 91 country code.
    const withoutCc = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
    if (/^[6-9]\d{9}$/.test(withoutCc)) return { ok: true, e164: `+91${withoutCc}` };
    return { ok: false, e164: '', reason: 'Enter a 10-digit Indian mobile number, e.g. 98765 43210.' };
  }
  if (/^\d{8,15}$/.test(digits)) return { ok: true, e164: `${defaultCountryCode}${digits}` };
  return { ok: false, e164: '', reason: 'Enter a valid mobile number.' };
}

/** Masked display fragment from the server-issued last4 (never the number). */
export function maskedPhone(last4: string | null | undefined): string {
  const tail = (last4 ?? '').replace(/\D/g, '').slice(-4);
  return `•••••• ${tail.padStart(4, '•')}`;
}

// ---------------------------------------------------------------------------
// Saved-number state machine (pure)
// ---------------------------------------------------------------------------

export type PhoneIdentityState =
  | { phase: 'none' }
  | { phase: 'saved'; last4: string; hideNumber: boolean };

export type PhoneIdentityEvent =
  | { type: 'SAVED'; last4: string; hideNumber: boolean }
  | { type: 'REVOKED' }
  | { type: 'HIDE_TOGGLED'; hideNumber: boolean };

export const initialPhoneIdentityState: PhoneIdentityState = { phase: 'none' };

export function phoneIdentityReducer(state: PhoneIdentityState, event: PhoneIdentityEvent): PhoneIdentityState {
  switch (event.type) {
    case 'SAVED':
      return { phase: 'saved', last4: event.last4, hideNumber: event.hideNumber };
    case 'REVOKED':
      return { phase: 'none' };
    case 'HIDE_TOGGLED':
      return state.phase === 'saved' ? { ...state, hideNumber: event.hideNumber } : state;
    default:
      return state;
  }
}

/** Whether the current state allows posting or joining rides. */
export function canParticipate(state: PhoneIdentityState): boolean {
  return state.phase === 'saved';
}

// ---------------------------------------------------------------------------
// Device capability token
// ---------------------------------------------------------------------------

const DEVICE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeDeviceCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => DEVICE_ALPHABET[b % DEVICE_ALPHABET.length]).join('');
}

/** Stable per-browser capability token (localStorage). */
export function getDeviceCode(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length >= 16) return existing;
    const code = makeDeviceCode();
    localStorage.setItem(DEVICE_KEY, code);
    return code;
  } catch {
    // Private mode: session-only device code (identity won't persist).
    return makeDeviceCode();
  }
}

// ---------------------------------------------------------------------------
// Server calls (SECURITY DEFINER RPCs — no verification, no OTP)
// ---------------------------------------------------------------------------

function rpcHeaders(): Record<string, string> {
  return backendHeaders();
}

/**
 * Student-facing wording for the one backend state that makes Cab Share
 * partially unusable: the deployed Supabase project still runs the retired
 * OTP-era schema, so the OTP-free contact-number RPCs are missing / the ride
 * trigger still demands a verified poster. Nothing is fabricated — the board
 * honestly says it is read-only instead of pretending the save worked.
 */
export const RIDE_BOARD_BACKEND_MESSAGE =
  'The ride board is read-only right now: existing rides still show, but new rides and contact numbers can\'t be saved yet.';

/**
 * Operator-only remedy, kept out of the rendered page (a student cannot run a
 * SQL migration). CabShareView sends it to the dev console through
 * debugErrorDetail so it is still actionable from a running app.
 */
export const RIDE_BOARD_BACKEND_FIX =
  'Apply the latest Cab Share migration in Supabase → SQL editor (supabase/migrations/20260915000001_cabshare_backend_repair.sql), then reload — existing rides stay readable meanwhile.';

export type PhoneErrorCode = 'RPC_FAILED' | 'INVALID_NUMBER' | 'NETWORK' | 'BACKEND_OUTDATED';

/**
 * Classify a PostgREST failure without any network access (pure).
 *
 * Distinguishes the three very different things a failed call can mean:
 * the number is invalid, the deployment's schema is behind the app, or a
 * transient server/transport problem. "Behind the app" is its own outcome
 * because telling a student "the service is not available" while the board
 * itself is fine hides the real, fixable cause.
 */
export function classifyPhoneBackendFailure(status: number, body: string): PhoneErrorCode {
  const text = (body || '').toUpperCase();
  if (text.includes('PHONE_INVALID_NUMBER')) return 'INVALID_NUMBER';
  if (text.includes('PHONE_INVALID_DEVICE') || text.includes('PHONE_REQUIRED')) return 'INVALID_NUMBER';
  // Missing RPC (PostgREST schema cache), a function that does not exist, the
  // retired OTP gate, or no EXECUTE grant — all mean the backend is behind.
  if (text.includes('PGRST202') || text.includes('PGRST205')) return 'BACKEND_OUTDATED';
  if (text.includes('COULD NOT FIND THE FUNCTION') || text.includes('DOES NOT EXIST')) return 'BACKEND_OUTDATED';
  if (text.includes('PHONE_VERIFICATION_REQUIRED') || text.includes('OTP_')) return 'BACKEND_OUTDATED';
  if (status === 404 || status === 401 || status === 403) return 'BACKEND_OUTDATED';
  return 'RPC_FAILED';
}

/** True when a payload has the retired OTP-era identity shape. */
export function isLegacyIdentityShape(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const record = payload as Record<string, unknown>;
  return 'verified' in record && !('saved' in record);
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: rpcHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    throw new PhoneError('NETWORK', 'Could not reach the ride board. Check your connection.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const code = classifyPhoneBackendFailure(res.status, text);
    if (code === 'INVALID_NUMBER') {
      throw new PhoneError(
        'INVALID_NUMBER',
        text.toUpperCase().includes('PHONE_INVALID_NUMBER')
          ? 'Enter a valid mobile number, e.g. 98765 43210.'
          : 'Save your mobile number before posting or joining a ride.',
      );
    }
    if (code === 'BACKEND_OUTDATED') throw new PhoneError('BACKEND_OUTDATED', RIDE_BOARD_BACKEND_MESSAGE);
    throw new PhoneError('RPC_FAILED', 'Could not reach the ride board right now. Try again in a moment.');
  }
  return (await res.json()) as T;
}

export class PhoneError extends Error {
  code: PhoneErrorCode;
  constructor(code: PhoneErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface PhoneIdentity {
  /** True when a contact number is saved for this device (NOT "verified" —
   *  UltraCC does not verify phone ownership). */
  saved: boolean;
  last4?: string | null;
  hideNumber?: boolean;
}

/** Fetch this device's saved contact status (server-side source of truth). */
export async function fetchPhoneIdentity(deviceCode: string): Promise<PhoneIdentity> {
  const payload = await rpc<unknown>('get_phone_identity', { p_device_code: deviceCode });
  // The retired OTP-era function answers 200 with { verified } — a shape the
  // app no longer understands. Treat it as a stale backend, not "no number".
  if (isLegacyIdentityShape(payload)) throw new PhoneError('BACKEND_OUTDATED', RIDE_BOARD_BACKEND_MESSAGE);
  return payload as PhoneIdentity;
}

/** Save this device's contact number (self-declared, no verification). */
export async function savePhoneIdentity(deviceCode: string, e164: string): Promise<PhoneIdentity> {
  await rpc('set_phone_identity', { p_device_code: deviceCode, p_phone_e164: e164 });
  const identity = await fetchPhoneIdentity(deviceCode);
  if (!identity.saved) throw new PhoneError('RPC_FAILED', 'The number could not be saved. Try again.');
  return identity;
}

/** "Hide my number" preference. */
export async function setPhoneVisibility(deviceCode: string, hide: boolean): Promise<boolean> {
  return rpc<boolean>('set_phone_visibility', { p_device_code: deviceCode, p_hide: hide });
}

/** Remove the saved number (identity + hide preference are kept). */
export async function revokePhone(deviceCode: string): Promise<boolean> {
  return rpc<boolean>('revoke_phone', { p_device_code: deviceCode });
}
