/**
 * transportSeed.ts — VIT Chennai transport route dataset (server-side copy).
 *
 * This is the SAME dataset the frontend previously imported from
 * src/data/transport.json, relocated server-side so that transport is served
 * through the campus-data UltraCC API like every other campus dataset. It is
 * factual published VIT Chennai transport information (route numbers/names,
 * stop names, pickup times, dispersal placements, bus rules), ingested from
 * public VIT transport documentation — not fabricated, not a live API.
 *
 * Kept verbatim (same shape/semantics as the frontend seed) so the edge
 * function can seed campus_data_cache['transport'] deterministically.
 */

export interface BusStop {
  stopOrder: number;
  stopName: string;
  pickupTime: string;
}

export interface BusRouteFull {
  routeNumber: string;
  routeName: string;
  type: string;
  driverName: string;
  driverPhone: string;
  whatsappGroup: string;
  busLocation: string;
  stops: BusStop[];
  supervisorName: string;
  supervisorPhone: string;
}

export interface BusPlacement {
  routeNumber: string;
  dispersalTime: string;
  zone: string;
}

export interface BusRule {
  ruleNumber: number;
  content: string;
}

export interface TransportSeed {
  routes: BusRouteFull[];
  placements: BusPlacement[];
  rules: BusRule[];
}

// ---------------------------------------------------------------------------
// The seed is imported as a JSON module (Deno + esbuild both support JSON
// imports with `assert { type: 'json' }`). The file lives next to this module.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-import-assertions
import transportJson from './transport.json' with { type: 'json' };

export const transportSeed = transportJson as TransportSeed;

export function isValidTransportSeed(seed: TransportSeed): boolean {
  return (
    Array.isArray(seed.routes) &&
    seed.routes.length > 0 &&
    seed.routes.every(
      (r) =>
        typeof r.routeNumber === 'string' && r.routeNumber.length > 0 &&
        Array.isArray(r.stops) &&
        r.stops.every(
          (s) => typeof s.stopOrder === 'number' && typeof s.stopName === 'string' && typeof s.pickupTime === 'string',
        ),
    ) &&
    Array.isArray(seed.placements) &&
    Array.isArray(seed.rules)
  );
}
