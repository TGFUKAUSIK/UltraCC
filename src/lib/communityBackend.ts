/**
 * communityBackend.ts — the one place that knows the shared community backend
 * (Cab Share, question bank, background push).
 *
 * Only public, anonymous-access resources live here: no student identity, no
 * VTOP data and no credentials are ever sent to this project. Each feature
 * keeps its own capability-token model (a per-browser device code) and its own
 * SECURITY DEFINER RPCs server-side.
 */

// Deploy-time configuration. The public build ships placeholders — set
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example) to your own
// Supabase project. Values that still read as placeholders are treated as unset.
function envValue(key: string, fallback: string): string {
  const value = typeof import.meta !== 'undefined' ? (import.meta as any).env?.[key] : undefined;
  if (!value) return fallback;
  const v = value.trim();
  if (!v || /your[_-]/i.test(v) || /^<.*>$/.test(v) || /example\.com|your-project\.supabase\.co/i.test(v)) return fallback;
  return v;
}

export const SUPABASE_URL = envValue('VITE_SUPABASE_URL', 'https://your-project.supabase.co');

/** Public anon key — every table behind it is RLS deny-all. */
export const SUPABASE_ANON_KEY = envValue('VITE_SUPABASE_ANON_KEY', 'your_supabase_anon_key');

/** Standard headers for REST/RPC calls with the anon key. */
export function backendHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra,
  };
}

/** POST a SECURITY DEFINER RPC and return its JSON result. */
export async function callBackendRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: backendHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new BackendError(response.status, text);
  }
  return (await response.json()) as T;
}

export class BackendError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`backend ${status}`);
    this.status = status;
    this.body = body;
  }
}
