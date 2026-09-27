/**
 * humanErrorCopy — the single gate between a thrown value and user-visible
 * error text (brief §8: production UI explains what happened, never dumps
 * internals).
 *
 * Rules:
 *  - Short, sentence-shaped messages written by OUR code (curated copy from
 *    supabaseCommunity / VtopError / the gateway, e.g. "Could not post your
 *    ride") pass through untouched — hiding those would hide genuine,
 *    actionable failures.
 *  - Anything that looks machine-authored — stack frames, JSON blobs,
 *    PostgREST/HTTP payloads, "TypeError: Failed to fetch", TLS chatter,
 *    long debug strings — is replaced with a fixed human sentence.
 *  - In development the raw value is ALSO console.warned, so debugging never
 *    loses information; in production nothing is logged or rendered.
 */

/** Patterns that mark a string as technical rather than human-authored. */
const TECHNICAL_PATTERNS: RegExp[] = [
  /\bpostgres?(t)?error\b|no content type|http status/i, // PostgREST/supabase blobs
  /\breference error\b|syntaxerror|typeerror|rangeerror|internalerror/i,
  /\bhttp\/?[\d.]*\s*[45]\d\d\b|\bstatus(?: code)?\s*[45]\d\d\b/i,
  // "upstream responded 500" — an edge function relaying a bare HTTP status is
  // developer detail even when it is short enough to look like a sentence.
  /\b(?:upstream|origin|server|edge|gateway)\b[^.]{0,40}\b[45]\d\d\b/i,
  /\b(?:responded|returned)\s+(?:with\s+|status\s+)?[45]\d\d\b/i,
  /\binvalid peer certificate\b|\bcertificate\b|unknown issuer|tls|\bssl\b/i,
  /\bfailed to fetch\b|networkerror when|load failed|\benx\b|\beconn/i,
  /\{\s*"|psqlstate|constraint|violates row level security/i,
  /<\s*\/?[a-z!][^>]*>|&nbsp;|&amp;|&lt;|&#\d+;/i, // raw markup from an upstream page
  /\bat\s+\S+\s+\(|\.tsx?[:]\d+|\.js[:]\d+/,           // stack frames
  /https?:\/\//i,                                        // raw URLs
  /not authenticated|callgateway|fetchdata|sessiontoken|rpc/i, // internals
  /indexeddb|domexception|quoted oversized|transaction has expired/i, // storage internals
  /unhandled|promise rejection|deprecationwarning/i,
];

/** Comfortable upper length for a human-facing error sentence. */
const MAX_HUMAN_LENGTH = 180;

function isDevelopment(): boolean {
  return typeof import.meta !== 'undefined'
    && Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
}

/** True when a string reads as developer-facing noise rather than copy. */
export function looksTechnical(message: string): boolean {
  if (!message || message.length > MAX_HUMAN_LENGTH) return true;
  return TECHNICAL_PATTERNS.some((re) => re.test(message));
}

/**
 * Map any thrown value (or sync-pipeline error string) to safe user copy.
 * `fallback` lets each call site keep its domain-specific sentence
 * ("Could not load the question-paper bank.") for unknown failures.
 */
export function humanErrorCopy(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = err instanceof Error
    ? err.message
    : typeof err === 'string' ? err : err == null ? '' : String(err);
  const isDev = isDevelopment();
  if (isDev && raw && looksTechnical(raw)) {
    // Dev-only debug channel: the exact string stays in the console.
    console.warn('[error-copy] technical error hidden from UI:', raw);
  }
  if (!raw) return fallback;
  return looksTechnical(raw) ? fallback : raw;
}

/**
 * Developer-only detail channel, for the moments where a call site knows
 * something the UI must not show (an HTTP status, a response body, a deploy
 * command) but a debugging student or a maintainer still needs it. In
 * development it lands in the console prefixed with `scope`; in production it
 * is a no-op, so nothing internal is logged at all.
 *
 * Pair it with a curated `humanErrorCopy`-safe message on the thrown error —
 * this is the raw half, never the rendered half.
 */
export function debugErrorDetail(scope: string, detail: unknown): void {
  if (!isDevelopment()) return;
  const raw = detail instanceof Error
    ? `${detail.name}: ${detail.message}`
    : typeof detail === 'string' ? detail : String(detail);
  // Cap it: a gateway error body can be a whole HTML page.
  console.warn(`[error-copy] ${scope}:`, raw.slice(0, 500));
}
