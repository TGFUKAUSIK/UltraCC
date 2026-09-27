import React, { useEffect, useMemo, useState } from 'react';
import { Bus, Search, MapPin, Phone, ShieldCheck, Info, X, Clock, Navigation, UserRound, ChevronRight, RefreshCw } from 'lucide-react';
import { TransportInfo } from '../lib/vtop/types';
import transportSeed from '../data/transport.json';
import { fetchCampus, type TransportSeed } from '../lib/campusClient';

interface BusStop {
  stopOrder: number;
  stopName: string;
  pickupTime: string;
}

interface BusRouteFull {
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

interface BusPlacement {
  routeNumber: string;
  dispersalTime: string;
  zone: string;
}

interface BusRule {
  ruleNumber: number;
  content: string;
}

interface TransportViewProps {
  /** VTOP day-scholar transport registration (undefined = not synced). */
  transport?: TransportInfo | null;
}

// Instant first paint from the bundled verified dataset; the UltraCC
// campus-data API is the source of truth and re-syncs on mount/refresh.
const bundledSeed = transportSeed as unknown as TransportSeed;

/**
 * TransportView — VIT Chennai day-scholar transport.
 * VIT Chennai transport route dataset: 110 routes with stops & pickup times,
 * supervisor/driver contacts, dispersal placements and bus rules — plus the
 * student's own VTOP registration when synced.
 */
export const TransportView: React.FC<TransportViewProps> = ({ transport }) => {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | 'AC' | 'Non-AC'>('all');
  const [selected, setSelected] = useState<BusRouteFull | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const [seed, setSeed] = useState<TransportSeed>(bundledSeed);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  // Sync the route directory through the UltraCC campus-data API (server-side
  // dataset; falls back to the bundled copy when unreachable).
  const syncRoutes = async () => {
    const result = await fetchCampus<TransportSeed>('transport', 'all', { dataset: 'transport' });
    if (result.data) {
      setSeed(result.data);
      setSyncedAt(result.syncedAt);
    }
    return result;
  };

  useEffect(() => {
    let alive = true;
    (async () => { const r = await syncRoutes(); if (!alive) return; void r; })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return seed.routes.filter((r) => {
      if (type !== 'all' && r.type !== type) return false;
      if (!q) return true;
      return (
        r.routeName.toLowerCase().includes(q) ||
        r.routeNumber.toLowerCase() === q ||
        r.stops.some((s) => s.stopName.toLowerCase().includes(q)) ||
        (r.driverName || '').toLowerCase().includes(q) ||
        (r.supervisorName || '').toLowerCase().includes(q)
      );
    });
  }, [seed, query, type]);

  const placementFor = (routeNumber: string) => seed.placements.find((p) => p.routeNumber === routeNumber);

  const registeredRoute = useMemo(() => {
    if (!transport?.hasRegistration) return null;
    const routeName = (transport.routeSelected || '').trim().toLowerCase();
    const routeId = (transport.busRouteId || '').trim().toLowerCase();
    return seed.routes.find((route) =>
      (routeName && route.routeName.trim().toLowerCase() === routeName) ||
      (routeId && route.routeNumber.trim().toLowerCase() === routeId) ||
      (routeId && route.routeNumber.trim().toLowerCase().replace(/^0+/, '') === routeId.replace(/^0+/, ''))
    ) || null;
  }, [seed, transport]);

  // VTOP may include the QR source URL in its raw registration table. The
  // user-facing transport view should expose the QR image only; the session-
  // bound source/link is not useful and must not be rendered as text.
  const visibleRegistrationRows = useMemo(
    () => (transport?.rows || []).filter((row) => {
      const label = row.label.trim().toLowerCase();
      const value = row.value.trim();
      return !/(qr|barcode|attendance code)/i.test(label)
        && !/^(?:data:image\/|https?:\/\/)/i.test(value);
    }),
    [transport?.rows],
  );

  const refresh = async () => {
    setRefreshed(true);
    try { await syncRoutes(); } finally { setTimeout(() => setRefreshed(false), 900); }
  };

  const tel = (phone: string) => (phone ? phone.replace(/[^0-9+]/g, '') : '');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">Transport</h2>
          <p className="text-sm text-zinc-500 font-medium mt-1">
            Bus routes, boarding points, pickup times &amp; contacts — VIT Chennai
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl acc-bg text-zinc-900 text-xs font-bold acc-glow hover:opacity-90 transition cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshed ? 'animate-spin' : ''}`} />
          {refreshed ? 'Refreshing…' : 'Refresh Bus Data'}
        </button>
      </div>

      {/* VTOP registration card */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-900 tracking-tight">My Transport Registration</h3>
            <p className="text-xs text-zinc-500 font-medium">From VTOP — day-scholar transport registration</p>
          </div>
        </div>

        {!transport ? (
          <p className="text-sm text-zinc-500">
            Not synced yet — log in and sync to see your registered bus route here.
          </p>
        ) : transport.hasRegistration ? (
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Register No.', transport.registerNumber],
              ['Name', transport.name],
              ['Branch', transport.branch],
              ['Route', transport.routeSelected],
              ['Payment', transport.paymentStatus],
              ['FP Ref', transport.fpReference],
              ['Bus Route ID', transport.busRouteId],
            ].map(([label, value]) =>
              value ? (
                <div key={label} className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wide text-zinc-500 font-bold">{label}</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5 break-words">{value}</p>
                </div>
              ) : null
            )}
          </div>
          {transport.qrCode && (
            <div className="mt-4 flex flex-col items-center rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="mb-3 flex w-full items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-zinc-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Daily attendance QR from VTOP</div>
              <img src={transport.qrCode} alt="VTOP transport attendance QR" className="h-48 w-48 rounded-xl bg-white p-2" />
              <p className="mt-2 text-center text-[11px] text-zinc-500">Show this live QR at the bus when required.</p>
            </div>
          )}
          {!transport.qrCode && (
            <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-700">
              VTOP did not return a daily attendance QR in this sync. Re-login and sync again; the app will show it here when VTOP provides it.
            </div>
          )}
          {visibleRegistrationRows.length > 0 && <details className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3"><summary className="cursor-pointer text-xs font-bold text-zinc-900">View all VTOP registration details</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{visibleRegistrationRows.map((row, index) => <div key={`${row.label}-${index}`} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-wide text-zinc-500">{row.label}</p><p className="mt-0.5 break-words text-xs text-zinc-900">{row.value || '—'}</p></div>)}</div></details>}

          {registeredRoute && (
            <div className="mt-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-blue-700">Registered route details</p>
                  <p className="mt-1 text-sm font-extrabold text-zinc-900">#{registeredRoute.routeNumber} · {registeredRoute.routeName}</p>
                </div>
                <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-1 text-[10px] font-bold text-blue-700">From route directory</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {[['Supervisor', registeredRoute.supervisorName, registeredRoute.supervisorPhone], ['Driver', registeredRoute.driverName, registeredRoute.driverPhone]].map(([label, name, phone]) => (
                  <div key={label} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-zinc-500">{label}</p>
                    <p className="mt-0.5 text-xs font-semibold text-zinc-900">{name || 'Not published'}</p>
                    {phone ? <a className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline" href={`tel:${tel(phone)}`}><Phone className="h-3 w-3" /> {phone}</a> : <p className="mt-1 text-[10px] text-zinc-500">Official contact not available</p>}
                  </div>
                ))}
              </div>
              {registeredRoute.stops.length > 0 && (
                <p className="mt-3 text-[11px] text-zinc-500"><MapPin className="mr-1 inline h-3 w-3 text-blue-700" />{registeredRoute.stops.map((stop) => `${stop.stopName} (${stop.pickupTime})`).join(' · ')}</p>
              )}
            </div>
          )}
          {transport.hasRegistration && !registeredRoute && (
            <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-500">
              VTOP lists a registration for you, but its route number doesn't match any route in the published directory. Everything VTOP itself states is in the details above.
            </div>
          )}
          </>
        ) : (
          <div className="flex items-start gap-3 p-4 bg-zinc-50 border border-zinc-200 rounded-2xl">
            <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-zinc-500">
              No day-scholar transport registration found on VTOP for your account.
              {transport.message ? ` ${transport.message}` : ''}
            </p>
          </div>
        )}
      </div>

      {/* Official transport help contact from the VIT transport rules. */}
      <div className="bg-white border border-blue-500/20 rounded-3xl p-5 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-zinc-900">Transport Helpdesk</p>
          <p className="text-xs text-zinc-500 mt-1">For route timings, breakdowns, fees or cleanliness issues</p>
        </div>
        <a href="mailto:transport.cc@vit.ac.in" className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-zinc-900 text-xs font-extrabold transition">
          <Phone className="h-3.5 w-3.5" /> transport.cc@vit.ac.in
        </a>
      </div>

      {/* Search */}
      {syncedAt && (
        <p className="-mt-4 text-[10px] font-medium text-zinc-500">
          Route directory synced {new Date(syncedAt).toLocaleString()} · served through the UltraCC campus-data service
        </p>
      )}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
        <input
          aria-label="Search bus routes, stops and drivers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search route, stop, driver…"
          className="w-full pl-10 pr-3 py-3 bg-white border border-zinc-200 rounded-2xl text-sm text-zinc-900 placeholder-zinc-500 outline-none focus:border-blue-500/60 transition"
        />
        <select
          aria-label="Filter by bus type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs text-zinc-900 outline-none cursor-pointer"
          title="Filter bus type"
        >
          <option value="all">All</option>
          <option value="AC">AC</option>
          <option value="Non-AC">Non-AC</option>
        </select>
      </div>

      {/* Route grid */}
      {filtered.length === 0 ? (
        <div className="p-10 bg-white border border-zinc-200 rounded-3xl text-center">
          <Bus className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
          <p className="text-sm font-bold text-zinc-900">No routes match</p>
          <p className="text-[11px] text-zinc-500 mt-1">Try a different route, stop or driver name.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((r) => (
            <button
              key={r.routeNumber}
              onClick={() => setSelected(r)}
              className="group bg-white border border-zinc-200 rounded-2xl p-4 text-left hover:border-blue-500/40 hover:bg-white transition cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-lg bg-blue-500/15 text-blue-600 text-[10px] font-extrabold">
                    #{r.routeNumber}
                  </span>
                  <p className="font-bold text-zinc-900 text-sm truncate">{r.routeName}</p>
                </div>
                {r.type === 'AC' ? (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 border border-sky-500/20 shrink-0">AC</span>
                ) : (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 shrink-0">Non-AC</span>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {r.stops.slice(0, 4).map((s) => (
                  <span key={s.stopOrder} className="inline-flex items-center gap-1 text-[10px] text-zinc-500 bg-white border border-zinc-200 rounded-full px-2 py-0.5">
                    <MapPin className="h-2.5 w-2.5 text-zinc-500" /> {s.stopName}
                  </span>
                ))}
                {r.stops.length > 4 && (
                  <span className="text-[10px] text-zinc-600">+{r.stops.length - 4} more</span>
                )}
              </div>
              <div className="mt-2.5 flex items-center justify-between text-[10px] text-zinc-500">
                <span>{r.stops.length} {r.stops.length === 1 ? 'stop' : 'stops'} · {r.stops[0]?.pickupTime || ''}</span>
                <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition" />
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-500">
                <UserRound className="h-3 w-3" />
                {r.driverPhone ? `${r.driverName || 'Driver'} · ${r.driverPhone}` : 'Driver contact not published'}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Bus rules */}
      {seed.rules.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
          <h3 className="text-sm font-bold text-zinc-900 mb-3">Bus Rules</h3>
          <ul className="space-y-2">
            {seed.rules.map((rule) => (
              <li key={rule.ruleNumber} className="flex items-start gap-2.5 text-xs text-zinc-500">
                <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-md bg-white border border-zinc-200 text-zinc-500 text-[9px] font-bold mt-0.5">
                  {rule.ruleNumber}
                </span>
                {rule.content}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Route detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-white border border-zinc-200 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-blue-500/10"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-zinc-200 px-5 py-4 flex items-center gap-3">
              <span className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-blue-500/15 text-blue-600 text-sm font-extrabold">
                #{selected.routeNumber}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-zinc-900 tracking-tight truncate">{selected.routeName}</p>
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">{selected.type} BUS</p>
              </div>
              <button onClick={() => setSelected(null)} className="p-2 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-500 transition cursor-pointer" title="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Supervisor */}
              {(selected.supervisorName || selected.supervisorPhone) && (
                <ContactCard
                  icon={<ShieldCheck className="h-4 w-4" />}
                  iconBg="bg-violet-500/10 text-violet-600 border-violet-500/20"
                  label="SUPERVISOR"
                  name={selected.supervisorName || '—'}
                  phone={selected.supervisorPhone}
                />
              )}

              {/* Driver */}
              {(selected.driverName || selected.driverPhone) && (
                <ContactCard
                  icon={<Phone className="h-4 w-4" />}
                  iconBg="bg-orange-500/10 text-orange-600 border-orange-500/20"
                  label="DRIVER INCHARGE"
                  name={selected.driverName || '—'}
                  phone={selected.driverPhone}
                />
              )}
              {!selected.driverName && !selected.driverPhone && !selected.supervisorName && !selected.supervisorPhone && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-700">
                  Driver and supervisor contacts are not published in the verified route data for this bus. Contact the VIT Transport Helpdesk at <a className="font-bold underline" href="mailto:transport.cc@vit.ac.in">transport.cc@vit.ac.in</a> for an official contact.
                </div>
              )}

              {/* Stops & pickup times */}
              <div className="bg-white border border-zinc-200 rounded-2xl p-4">
                <p className="flex items-center gap-2 text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-3">
                  <Clock className="h-3.5 w-3.5" /> Stops &amp; Pickup Times
                </p>
                <div className="space-y-0">
                  {selected.stops.map((s, i) => (
                    <div key={s.stopOrder} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${i === 0 ? 'bg-emerald-400' : 'bg-emerald-400/40'} shrink-0`} />
                        {i < selected.stops.length - 1 && <span className="w-px flex-1 bg-emerald-400/20" />}
                      </div>
                      <div className={`pb-3 ${i === selected.stops.length - 1 ? 'pb-0' : ''} flex-1 flex items-center justify-between gap-2`}>
                        <span className="text-sm text-zinc-900 font-medium">{s.stopName}</span>
                        <span className="text-[11px] font-mono text-blue-600 shrink-0">{s.pickupTime}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {selected.busLocation && (
                  <p className="mt-3 pt-3 border-t border-zinc-200 text-[11px] text-zinc-500 flex items-center gap-1.5">
                    <Navigation className="h-3.5 w-3.5" /> Live location: {selected.busLocation}
                  </p>
                )}
                {selected.whatsappGroup && (
                  <p className="mt-2 text-[11px] text-emerald-600">WhatsApp group: {selected.whatsappGroup}</p>
                )}
              </div>

              {/* Dispersal */}
              {(() => {
                const p = placementFor(selected.routeNumber);
                if (!p) return null;
                return (
                  <div className="bg-white border border-zinc-200 rounded-2xl p-4 flex items-center gap-4">
                    <div className="flex flex-col items-center shrink-0">
                      <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-xl bg-blue-500/15 text-blue-600 text-sm font-extrabold">
                        {p.dispersalTime}
                      </span>
                      <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold mt-1.5">Dispersal</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-zinc-900">{p.zone}</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5 flex items-center gap-1">
                        <UserRound className="h-3 w-3" /> Dispersal zone for this route
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function ContactCard({
  icon, iconBg, label, name, phone,
}: {
  icon: React.ReactNode; iconBg: string; label: string; name: string; phone?: string;
}) {
  const tel = phone ? phone.replace(/[^0-9+]/g, '') : '';
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4 flex items-center gap-3">
      <div className={`p-2.5 rounded-xl border ${iconBg}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold">{label}</p>
        <p className="text-sm font-bold text-zinc-900 mt-0.5 truncate">{name}</p>
      </div>
      {phone && (
        <a
          href={`tel:${tel}`}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-zinc-200 text-[11px] font-bold text-zinc-900 hover:border-blue-500/50 hover:text-blue-600 transition cursor-pointer shrink-0"
        >
          <Phone className="h-3.5 w-3.5" /> Call
        </a>
      )}
    </div>
  );
}
