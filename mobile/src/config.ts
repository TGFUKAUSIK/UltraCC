/**
 * config.ts — the mobile app's single source of truth for the shared backend.
 *
 * Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see
 * .env.example) to your own Supabase project; the fallbacks below are
 * placeholders so a fresh clone builds without naming anyone's deployment.
 * The anon key is the anonymous client key: every table behind it is RLS
 * deny-all, and no student credential, service role or session secret is here.
 * The session token (an AES-GCM blob) is created and held in memory only by
 * src/lib/gateway.ts and never touches storage.
 */

// Expo inlines only literal `process.env.EXPO_PUBLIC_*` reads at bundle time,
// so each variable is read once, by name. This declaration is a type shim; the
// expression itself is replaced by the build.
declare const process: { env: Record<string, string | undefined> };

function usable(value: string | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  if (!v || /your[_-]/i.test(v) || /^<.*>$/.test(v) || /example\.com|your-project\.supabase\.co/i.test(v)) return fallback;
  return v;
}

export const SUPABASE_URL = usable(process.env.EXPO_PUBLIC_SUPABASE_URL, 'https://your-project.supabase.co');

export const ANON_KEY = usable(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'your_supabase_anon_key');

/** The VTOP gateway edge function (all VTOP HTTP stays server-side here). */
export const VTOP_GATEWAY_URL = `${SUPABASE_URL}/functions/v1/vtop-gateway`;

/** Standard headers for anonymous Supabase REST / RPC / edge calls. */
export function anonHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    ...extra,
  };
}

/** Campus identifier threaded through to the gateway (default chennai). */
export type Campus = 'chennai' | 'vellore' | 'ap' | 'bhopal';

export interface CampusOption {
  id: Campus;
  /** Shown in Settings and on the sign-in screen. */
  label: string;
  /**
   * UltraCC is built and tested against VIT Chennai's VTOP only. The other
   * campuses are listed so a student sees that plainly instead of signing in
   * and getting empty screens.
   */
  available: boolean;
}

export const CAMPUSES: CampusOption[] = [
  { id: 'chennai', label: 'VIT Chennai', available: true },
  { id: 'vellore', label: 'VIT Vellore', available: false },
  { id: 'ap', label: 'VIT AP', available: false },
  { id: 'bhopal', label: 'VIT Bhopal', available: false },
];

/** The one campus this app can sign in to today. */
export const AVAILABLE_CAMPUS: Campus = 'chennai';
