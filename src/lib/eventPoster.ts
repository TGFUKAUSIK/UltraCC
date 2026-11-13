/**
 * eventPoster.ts — the addresses an Event Hub poster can be loaded from.
 *
 * A poster lives on VIT's own Event Hub host, which answers TLS with only its
 * leaf certificate. Desktop Chrome fetches the missing intermediate itself;
 * iPhone, Android and the installed PWA do not, and simply fail to load the
 * image. The `event-hub` edge function therefore offers the same poster a
 * second time from its own URL, which sits behind a complete certificate chain.
 *
 * So a card tries the cheap direct address first — that is what already works
 * on a laptop — and only then the mirrored one, and only then shows the
 * placeholder. `posterSources` also rebuilds the direct address from the event
 * id when the function did not send one, which keeps posters working across the
 * gap between deploying this client and redeploying the function.
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
  // The id is scraped out of Event Hub's HTML. Only the small integer it
  // actually is may be interpolated into an upstream address.
  const derived = /^\d{1,12}$/.test(id) ? `${EVENT_HUB_ORIGIN}/EventHub/image/?id=${id}` : '';
  const candidates = [
    (event.posterUrl ?? '').trim() || derived,
    (event.posterProxy ?? '').trim(),
  ];
  return candidates.filter((url, index) => !!url && candidates.indexOf(url) === index);
}
