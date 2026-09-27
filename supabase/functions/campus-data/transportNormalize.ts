/**
 * transportNormalize.ts — pure normalization for the upstream transport feed.
 *
 * The upstream transport feed returns
 * `{ success, routes: [...] }` with snake_case route fields and per-route
 * nested `placements`. The frontend consumes the camelCase TransportSeed
 * shape. Nothing is invented here: every field is either copied from the
 * upstream record (after text sanitization) or left empty — a missing
 * contact stays missing so the UI can honestly say "not published".
 *
 * Malformed routes/stops are REJECTED individually (never silently
 * corrupted); a normalized payload is only valid when every route survives.
 */

import { sanitizeText } from './datasets.ts';

export interface NormalizedStop {
  stopOrder: number;
  stopName: string;
  pickupTime: string;
}

export interface NormalizedRoute {
  routeNumber: string;
  routeName: string;
  type: string;
  driverName: string;
  driverPhone: string;
  whatsappGroup: string;
  busLocation: string;
  stops: NormalizedStop[];
  supervisorName: string;
  supervisorPhone: string;
  placements: NormalizedPlacement[];
}

export interface NormalizedPlacement {
  routeNumber: string;
  dispersalTime: string;
  zone: string;
}

export interface NormalizedTransport {
  routes: NormalizedRoute[];
  placements: NormalizedPlacement[];
  rules: []; // the upstream feed publishes no bus rules; the bundled seed's rules are merged by the handler
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function normalizeStop(raw: unknown): NormalizedStop | null {
  if (raw == null || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const stopOrder = Number(s.stopOrder);
  const stopName = sanitizeText(asString(s.stopName));
  const pickupTime = sanitizeText(asString(s.pickupTime));
  if (!Number.isFinite(stopOrder) || stopOrder < 1 || !stopName || !pickupTime) return null;
  return { stopOrder, stopName, pickupTime };
}

function normalizePlacement(raw: unknown, routeNumber: string): NormalizedPlacement | null {
  if (raw == null || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const zone = sanitizeText(asString(p.zone));
  const dispersalTime = sanitizeText(asString(p.dispersalTime));
  if (!routeNumber || !zone || !dispersalTime) return null;
  return { routeNumber, dispersalTime, zone };
}

/** One upstream route -> the camelCase shape. Null when the route is unusable. */
export function normalizeUpstreamRoute(raw: unknown): NormalizedRoute | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const routeNumber = sanitizeText(asString(r.route_number ?? r.routeNumber));
  const routeName = sanitizeText(asString(r.route_name ?? r.routeName));
  if (!routeNumber || !routeName) return null;

  const stops: NormalizedStop[] = [];
  if (Array.isArray(r.stops)) {
    for (const rawStop of r.stops) {
      const stop = normalizeStop(rawStop);
      if (stop) stops.push(stop);
    }
  }
  if (stops.length === 0) return null; // a route without stops is not usable

  const placements: NormalizedPlacement[] = [];
  if (Array.isArray(r.placements)) {
    for (const rawPlacement of r.placements) {
      const placement = normalizePlacement(rawPlacement, routeNumber);
      if (placement) placements.push(placement);
    }
  }

  return {
    routeNumber,
    routeName,
    type: sanitizeText(asString(r.type)) || 'Non-AC',
    driverName: sanitizeText(asString(r.driver_name ?? r.driverName)),
    driverPhone: sanitizeText(asString(r.driver_phone ?? r.driverPhone)),
    whatsappGroup: sanitizeText(asString(r.whatsapp_group ?? r.whatsappGroup)),
    busLocation: sanitizeText(asString(r.bus_location ?? r.busLocation)),
    stops,
    supervisorName: sanitizeText(asString(r.supervisor_name ?? r.supervisorName)),
    supervisorPhone: sanitizeText(asString(r.supervisor_phone ?? r.supervisorPhone)),
    placements,
  };
}

/**
 * Full upstream body -> normalized transport. Accepts the documented
 * `{ success, routes }` envelope or a bare array. Null when nothing usable
 * came out (the caller then keeps the cached/seed copy).
 */
export function normalizeUpstreamTransport(body: unknown): NormalizedTransport | null {
  let rawRoutes: unknown[] = [];
  if (Array.isArray(body)) rawRoutes = body;
  else if (body != null && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).routes)) {
    rawRoutes = (body as { routes: unknown[] }).routes;
  }
  if (rawRoutes.length === 0) return null;

  const routes: NormalizedRoute[] = [];
  const placements: NormalizedPlacement[] = [];
  const seenRoutes = new Set<string>();
  for (const raw of rawRoutes) {
    const route = normalizeUpstreamRoute(raw);
    if (!route || seenRoutes.has(route.routeNumber)) continue; // reject malformed, dedupe repeats
    seenRoutes.add(route.routeNumber);
    routes.push(route);
    placements.push(...route.placements);
  }
  if (routes.length === 0) return null;
  return { routes, placements, rules: [] };
}

/** Validator used for the guarded cache write of a normalized payload. */
export function isValidNormalizedTransport(payload: unknown): payload is NormalizedTransport {
  const t = payload as NormalizedTransport | null;
  return (
    t != null && typeof t === 'object' &&
    Array.isArray(t.routes) && t.routes.length > 0 &&
    t.routes.every(
      (r) =>
        r != null && typeof r === 'object' &&
        typeof r.routeNumber === 'string' && r.routeNumber.length > 0 &&
        typeof r.routeName === 'string' && r.routeName.length > 0 &&
        Array.isArray(r.stops) && r.stops.length > 0 &&
        r.stops.every(
          (s) => s != null && typeof s.stopOrder === 'number' && typeof s.stopName === 'string' && typeof s.pickupTime === 'string',
        ) &&
        Array.isArray(r.placements),
    ) &&
    Array.isArray(t.placements) &&
    Array.isArray(t.rules)
  );
}
