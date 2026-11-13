/**
 * poster.ts — where an Event Hub poster actually comes from.
 *
 * Every event card on eventhubcc.vit.ac.in links a poster at
 * `<ORIGIN>/EventHub/image/?id=<eid>`. That route is public and serves a real
 * JPEG, but the host answers TLS with ONLY its leaf certificate — the
 * intermediate it was issued under is never sent. Desktop Chrome patches that
 * gap by fetching the missing intermediate from the CA (AIA chasing); iOS and
 * Android do not, and neither does any other server-side HTTP client. So the
 * same URL that renders on a laptop fails to load on a phone, in Safari and in
 * the installed app, and looks like a broken image rather than a network
 * problem.
 *
 * The fix is to offer both addresses and let the client fall back:
 *
 *   - `directPosterUrl`  — the origin itself. Cheapest, cache-friendly, and it
 *     works wherever the browser repairs the chain.
 *   - `proxyPosterUrl`   — this function re-fetching the same bytes over its
 *     verified CA client (see index.ts) and serving them from Supabase's own
 *     complete certificate chain. Strict clients can always load this one.
 *
 * Order matters: the direct URL first, so nothing about today's working
 * desktop behaviour changes, with the proxy as the recovery path for phones.
 */

export const ORIGIN = 'https://eventhubcc.vit.ac.in';

/** An event id is a small integer from the card's `value="…"`. Anything else
 *  must never reach the upstream URL — it is the only thing standing between a
 *  caller and a request to an arbitrary path on this one host. */
export function isPosterId(eid: string | null | undefined): eid is string {
  return typeof eid === 'string' && /^\d{1,12}$/.test(eid);
}

export function directPosterUrl(eid: string): string {
  return `${ORIGIN}/EventHub/image/?id=${eid}`;
}

/** Absolute URL for this function's own poster route, derived from the request
 *  so it stays correct on any project ref or local dev port. */
export function proxyPosterUrl(functionUrl: string, eid: string): string {
  const base = functionUrl.split('?')[0];
  return `${base}?poster=${eid}`;
}

/** The address a browser can actually load this function's poster route from.
 *
 *  The platform invokes the function on its INTERNAL request URL —
 *  `http://<ref>.supabase.co/<slug>`, no `/functions/v1`, plain http — so a
 *  mirror built straight from `req.url` points at a path nothing answers (404)
 *  and over a scheme a page would block as mixed content. Rebuild the public
 *  form from the platform's own origin (`SUPABASE_URL`, injected into every
 *  function, the same value the other functions here read) plus the slug the
 *  request came in on. Empty when either half is missing, so the caller falls
 *  back to the direct address rather than handing the client a dead one. */
export function publicFunctionUrl(supabaseUrl: string | null | undefined, requestUrl: string): string {
  const slug = new URL(requestUrl).pathname.split('/').filter(Boolean).pop() ?? '';
  const origin = (supabaseUrl ?? '').trim().replace(/\/+$/, '').replace(/^http:\/\//, 'https://');
  if (!slug || !origin) return '';
  return `${origin}/functions/v1/${slug}`;
}

/** The upstream address a poster URL points at, or null when the URL is not a
 *  poster we can serve. Accepts the direct URL, a bare id, or a URL this
 *  function handed out, so a client that cached an older shape still works. */
export function posterIdFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (isPosterId(trimmed)) return trimmed;
  const query = trimmed.match(/[?&]poster=(\d{1,12})(?:&|$)/);
  if (query) return query[1];
  const direct = trimmed.match(/^https?:\/\/eventhubcc\.vit\.ac\.in\/EventHub\/image\/?\?id=(\d{1,12})/i);
  return direct ? direct[1] : null;
}
