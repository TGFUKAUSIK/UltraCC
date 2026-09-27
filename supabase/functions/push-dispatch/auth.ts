/**
 * auth.ts — who may run the dispatcher.
 *
 * Pure decision logic, unit-tested separately from the Deno runtime: the
 * function must never be callable by a stranger (that would let anyone burn the
 * deployment's function quota), and it must never *fail open*.
 *
 * Three ways in, in order of trust:
 *   1. The platform service-role key — dashboard/manual runs, always accepted.
 *   2. CRON_SECRET in the function's environment — for operators who prefer a
 *      plain shared secret (also accepted when the request carries it).
 *   3. No CRON_SECRET configured: the database is the authority. A generated
 *      secret lives in public.push_cron_config and is never committed, never
 *      printed and never stored in the function's environment; the caller's
 *      value is checked against it over an RPC.
 */

export type AuthDecision =
  | { kind: 'authorized'; via: 'service-key' | 'cron-secret' }
  | { kind: 'denied'; reason: string }
  /** The database holds the secret; ask it before accepting the caller. */
  | { kind: 'ask-database'; secret: string };

export interface AuthInput {
  /** CRON_SECRET from the environment, when the operator set one. */
  cronSecret: string | null;
  /** The x-cron-secret header as sent, if any. */
  provided: string | null;
  /** The Authorization: Bearer value as sent, if any. */
  bearer: string | null;
  /** SUPABASE_SERVICE_ROLE_KEY from the environment. */
  serviceKey: string;
}

/** Length check + full mismatch scan, so a compare cannot leak by timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function decideCallerAuth(input: AuthInput): AuthDecision {
  const { cronSecret, provided, bearer, serviceKey } = input;

  // 1. Platform trust: the service-role key can always trigger a run.
  if (bearer && serviceKey && safeEqual(bearer, serviceKey)) {
    return { kind: 'authorized', via: 'service-key' };
  }

  // 2. Operator-configured shared secret.
  if (cronSecret) {
    if (provided && safeEqual(provided, cronSecret)) return { kind: 'authorized', via: 'cron-secret' };
    return { kind: 'denied', reason: 'Invalid or missing x-cron-secret.' };
  }

  // 3. Database-held secret (the default deployment shape). No secret at all
  //    means no way in: an unauthenticated caller is rejected, never trusted.
  if (!provided) return { kind: 'denied', reason: 'Missing x-cron-secret header.' };
  return { kind: 'ask-database', secret: provided };
}
