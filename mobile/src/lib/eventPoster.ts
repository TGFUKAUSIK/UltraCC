/**
 * eventPoster.ts — the addresses an Event Hub poster can be loaded from.
 *
 * Posters live on VIT's Event Hub host, which answers TLS with only its leaf
 * certificate. Android and iOS refuse such a chain (neither goes and fetches
 * the missing intermediate the way desktop Chrome does), so the same URL that
 * shows a poster on a laptop leaves the phone card blank. The `event-hub`
 * function mirrors each poster behind its own complete chain, and a card walks
 * the direct address first, then the mirror, then falls back to the icon.
 *
 * The direct address is also rebuilt from the event id when the function did
 * not send one, so posters survive the gap between shipping this app and
 * redeploying the function.
 */

const EVENT_HUB_ORIGIN = 'https://eventhubcc.vit.ac.in';

export interface PosterFields {
  eid?: string;
  posterUrl?: string;
  /** The same poster mirrored by the event-hub function. */
  posterProxy?: string;
}

/** Ordered, de-duplicated poster addresses to try for one event. */
export function posterSources(event: PosterFields): string[] {
  const id = (event.eid ?? '').trim();
  // The id comes from scraped HTML; only the small integer it really is may be
  // interpolated into an upstream address.
  const derived = /^\d{1,12}$/.test(id) ? `${EVENT_HUB_ORIGIN}/EventHub/image/?id=${id}` : '';
  const candidates = [
    (event.posterUrl ?? '').trim() || derived,
    (event.posterProxy ?? '').trim(),
  ];
  return candidates.filter((url, index) => !!url && candidates.indexOf(url) === index);
}
