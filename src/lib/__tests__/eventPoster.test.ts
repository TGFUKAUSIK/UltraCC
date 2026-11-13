/**
 * Event posters have to be loaded from two addresses, because the Event Hub
 * host serves TLS with only its leaf certificate: desktop Chrome goes and
 * fetches the missing intermediate, iPhone and Android refuse the connection,
 * and the student just sees an empty card.
 *
 * The `event-hub` function now hands back both the direct poster and a mirror
 * of it behind a complete chain, and the card walks the list before falling
 * back to the placeholder. What must not regress:
 *
 * 1. the direct address stays first — that is the one that already works on a
 *    laptop, and swapping the order would route every desktop view through an
 *    extra hop;
 * 2. a poster address is rebuilt from the event id when the function did not
 *    send one, so the client keeps working across the window between its own
 *    deploy and the function's;
 * 3. an event with no usable id and no URL yields no sources at all, so the
 *    card shows the placeholder instead of requesting a broken path.
 */

import { describe, it, expect } from 'vitest';
import { posterSources } from '../eventPoster';
import { posterSources as mobilePosterSources } from '../../../mobile/src/lib/eventPoster';

describe('posterSources', () => {
  it('tries the direct poster first and the mirrored one second', () => {
    const sources = posterSources({
      eid: '1201',
      posterUrl: 'https://eventhubcc.vit.ac.in/EventHub/image/?id=1201',
      posterProxy: 'https://example.supabase.co/functions/v1/event-hub?poster=1201',
    });
    expect(sources).toEqual([
      'https://eventhubcc.vit.ac.in/EventHub/image/?id=1201',
      'https://example.supabase.co/functions/v1/event-hub?poster=1201',
    ]);
  });

  it('rebuilds the poster address from the id when the function sent none', () => {
    // A function deployed before the poster work answers posterUrl: "".
    expect(posterSources({ eid: '1242', posterUrl: '' })).toEqual([
      'https://eventhubcc.vit.ac.in/EventHub/image/?id=1242',
    ]);
  });

  it('lists an address once when the mirror repeats the direct URL', () => {
    const direct = 'https://eventhubcc.vit.ac.in/EventHub/image/?id=1201';
    expect(posterSources({ eid: '1201', posterUrl: direct, posterProxy: direct })).toEqual([direct]);
  });

  it('yields nothing for an event with no id and no poster', () => {
    expect(posterSources({ eid: '', posterUrl: '', posterProxy: '' })).toEqual([]);
    expect(posterSources({})).toEqual([]);
  });

  it('never invents a path for a non-numeric id', () => {
    // The id comes from scraped HTML; anything else must not be interpolated
    // into an upstream URL.
    expect(posterSources({ eid: '../../etc/passwd' })).toEqual([]);
  });
});

describe('the mobile client reads the same contract', () => {
  // mobile/ has no test runner of its own, so the phone's copy of this rule is
  // pinned here: both apps must hand the card the same two addresses in the
  // same order, or a poster that appears on one platform is missing on the
  // other and neither is wrong in a way anyone can spot from a screenshot.
  const cases: Array<Parameters<typeof posterSources>[0]> = [
    { eid: '1201' },
    { eid: '1201', posterUrl: 'https://eventhubcc.vit.ac.in/EventHub/image/?id=1201', posterProxy: 'https://x.supabase.co/functions/v1/event-hub?poster=1201' },
    { eid: '', posterUrl: '', posterProxy: '' },
    { eid: 'not-a-number' },
  ];

  it('produces identical sources for every case', () => {
    for (const event of cases) {
      expect(mobilePosterSources(event), JSON.stringify(event)).toEqual(posterSources(event));
    }
  });
});
