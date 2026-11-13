import React, { useEffect, useMemo, useState } from 'react';
import { Bus, Search, MapPin, Phone, Mail, ShieldCheck, Info, X, Navigation, UserRound, ChevronRight, RefreshCw } from 'lucide-react';
import { TransportInfo } from '../lib/vtop/types';
import transportSeed from '../data/transport.json';
import { fetchCampus, type TransportSeed } from '../lib/campusClient';
import { formatSyncStamp } from '../utils/timestamp';
import { useDialog } from '../hooks/useDialog';

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
 *
 * Set as a route directory: the student's own registration leads as a record,
 * then every route is one row (number, name, type, stops) that opens its own
 * detail — stops, contacts and dispersal — on the timetable's rail. VIT Chennai
 * transport dataset: 110 routes with stops & pickup times, supervisor/driver
 * contacts, dispersal placements and bus rules.
 */
export const TransportView: React.FC<TransportViewProps> = ({ transport }) => {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | 'AC' | 'Non-AC'>('all');
  const [selected, setSelected] = useState<BusRouteFull | null>(null);
  const routeRef = useDialog<HTMLDivElement>({ isOpen: Boolean(selected), onClose: () => setSelected(null) });
  const [refreshed, setRefreshed] = useState(false);
  const [seed, setSeed] = useState<TransportSeed>(bundledSeed);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  /** True when the live directory did not answer, so the routes on screen came
   *  from this device or from the copy shipped with the app. */
  const [stale, setStale] = useState(false);
  const [attempted, setAttempted] = useState(false);

  // Sync the route directory through the UltraCC campus-data API (server-side
  // dataset; falls back to the bundled copy when unreachable).
  const syncRoutes = async () => {
    const result = await fetchCampus<TransportSeed>('transport', 'all', { dataset: 'transport' });
    if (result.data) {
      setSeed(result.data);
      setSyncedAt(result.syncedAt);
    }
    setStale(Boolean(result.stale) || !result.data);
    setAttempted(true);
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
    <div className="uc-dir-view">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">VIT Chennai transport</span>
            <h2 className="uc-dir-name">Bus routes &amp; boarding</h2>
            <p className="uc-note">Routes, boarding points, pickup times and contacts.</p>
          </div>
          <div className="uc-dir-rail">
            <button onClick={() => void refresh()} className="uc-dir-go acc-bg">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshed ? 'animate-spin' : ''}`} />
              {refreshed ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </section>

      {/* The student's own registration, from VTOP. */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <div className="uc-dir-id">
            <span className="uc-cap">My registration</span>
            <p className="uc-note">From VTOP — day-scholar transport registration.</p>
          </div>
        </div>

        {!transport ? (
          <div className="uc-dir-alert"><Info /><span>This is your own transport record, so it needs a VTOP sign-in. Sign in and refresh your data, and the bus you are registered for appears here.</span></div>
        ) : transport.hasRegistration ? (
          <>
            <dl className="uc-facts">
              {([
                ['Register No.', transport.registerNumber],
                ['Name', transport.name],
                ['Branch', transport.branch],
                ['Route', transport.routeSelected],
                ['Payment', transport.paymentStatus],
                ['FP Ref', transport.fpReference],
                ['Bus Route ID', transport.busRouteId],
              ] as [string, string | undefined][]).map(([label, value]) =>
                value ? <div key={label}><dt>{label}</dt><dd>{value}</dd></div> : null
              )}
            </dl>

            {transport.qrCode && (
              <div className="uc-dir-detail">
                <span className="uc-dir-subhead">Daily attendance QR from VTOP</span>
                <img src={transport.qrCode} alt="VTOP transport attendance QR" className="uc-dir-qr" />
                <p className="uc-dir-sub">Show this live QR at the bus when required.</p>
              </div>
            )}
            {!transport.qrCode && (
              <div className="uc-dir-alert"><Info /><span>VTOP did not return a daily attendance QR in this sync. Re-login and sync again; the app will show it here when VTOP provides it.</span></div>
            )}

            {registeredRoute && (
              <div className="uc-dir-detail">
                <span className="uc-dir-subhead">Registered route details</span>
                <p className="uc-dir-sub is-ink"><b className="uc-num">#{registeredRoute.routeNumber}</b> · {registeredRoute.routeName}</p>
                <div className="uc-dir-ledger">
                  {([['Supervisor', registeredRoute.supervisorName, registeredRoute.supervisorPhone], ['Driver', registeredRoute.driverName, registeredRoute.driverPhone]] as [string, string, string][]).map(([label, name, phone]) => (
                    <div key={label} className="uc-dir-row uc-dir-row--acts">
                      <span className="uc-dir-tile"><UserRound className="h-4 w-4" /></span>
                      <div className="uc-dir-main">
                        <span className="uc-dir-title">{name || 'Not published'}</span>
                        <span className="uc-dir-meta">{label}</span>
                      </div>
                      {phone
                        ? <a className="uc-dir-go" href={`tel:${tel(phone)}`}><Phone className="h-3.5 w-3.5" /> Call</a>
                        : <span className="uc-dir-tag">No number</span>}
                    </div>
                  ))}
                </div>
                {registeredRoute.stops.length > 0 && (
                  <p className="uc-dir-sub uc-dir-sub--block"><MapPin className="uc-dir-inline" />{registeredRoute.stops.map((stop) => `${stop.stopName} (${stop.pickupTime})`).join(' · ')}</p>
                )}
              </div>
            )}
            {transport.hasRegistration && !registeredRoute && (
              <div className="uc-dir-alert"><Info /><span>VTOP lists a registration for you, but its route number doesn&rsquo;t match any route in the published directory. Everything VTOP itself states is in the details above.</span></div>
            )}

            {visibleRegistrationRows.length > 0 && (
              <details className="uc-dir-hiring uc-dir-hiring--pad">
                <summary>View all VTOP registration details</summary>
                <dl className="uc-facts">
                  {visibleRegistrationRows.map((row, index) => (
                    <div key={`${row.label}-${index}`}><dt>{row.label}</dt><dd>{row.value || '—'}</dd></div>
                  ))}
                </dl>
              </details>
            )}
          </>
        ) : (
          <div className="uc-dir-alert"><Info /><span>No day-scholar transport registration found on VTOP for your account.{transport.message ? ` ${transport.message}` : ''}</span></div>
        )}
      </section>

      {/* Official transport help contact from the VIT transport rules. */}
      <section className="uc-plate uc-plate--quiet">
        <div className="uc-note-row">
          <Mail />
          <span><b>Transport helpdesk.</b> For route timings, breakdowns, fees or cleanliness issues — <a className="uc-dir-inline-link" href="mailto:transport.cc@vit.ac.in">transport.cc@vit.ac.in</a></span>
        </div>
      </section>

      {/* Search + filter */}
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-tools">
          <div className="uc-dir-search">
            <Search />
            <input
              aria-label="Search bus routes, stops and drivers"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search route, stop, driver…"
            />
          </div>
          <label className="sr-only" htmlFor="transport-type">Filter bus type</label>
          <select
            id="transport-type"
            aria-label="Filter by bus type"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="uc-dir-select"
          >
            <option value="all">All buses</option>
            <option value="AC">AC</option>
            <option value="Non-AC">Non-AC</option>
          </select>
          <span className="uc-dir-count">{filtered.length} of {seed.routes.length}</span>
        </div>
        {/* Where these routes came from: the live directory, the last copy this
            device received, or the set that shipped with the app. A student
            comparing a pickup time against a notice board needs to know which. */}
        {attempted && (
          <p className="uc-dir-stamp">
            <Info />
            {syncedAt
              ? `Route directory synced ${formatSyncStamp(syncedAt)}${stale ? ' · from the last copy on this device' : ''}`
              : 'These are the routes that came with the app — the live directory did not answer.'}
          </p>
        )}
      </section>

      {filtered.length === 0 ? (
        <section className="uc-plate">
          <div className="uc-dir-blank">
            <b>No routes match.</b> Try a different route, stop or driver name.
          </div>
        </section>
      ) : (
        <section className="uc-plate uc-dir-ledger">
          {filtered.map((r) => (
            <button key={r.routeNumber} onClick={() => setSelected(r)} className="uc-dir-row uc-dir-row--acts">
              <span className="uc-dir-tile uc-dir-tile--num uc-dir-tile--lg">#{r.routeNumber}</span>
              <div className="uc-dir-main">
                <span className="uc-dir-title">{r.routeName}</span>
                <span className="uc-dir-meta">{r.type} · {r.stops.length} {r.stops.length === 1 ? 'stop' : 'stops'}{r.stops[0]?.pickupTime ? ` · first pickup ${r.stops[0].pickupTime}` : ''}</span>
                <div className="uc-dir-tags">
                  {r.stops.slice(0, 3).map((s) => (
                    <span key={s.stopOrder} className="uc-dir-tag"><MapPin /> {s.stopName}</span>
                  ))}
                  {r.stops.length > 3 && <span className="uc-dir-tag">+{r.stops.length - 3} more</span>}
                </div>
              </div>
              <span className="uc-dir-acts"><ChevronRight className="h-4 w-4" /></span>
            </button>
          ))}
          <div className="uc-plate-foot">
            <span>Route directory</span>
            <span className="uc-num">{filtered.length}</span>
          </div>
        </section>
      )}

      {/* Bus rules */}
      {seed.rules.length > 0 && (
        <section className="uc-plate">
          <div className="uc-plate-head">
            <div className="uc-dir-id">
              <span className="uc-cap">Bus rules</span>
              <p className="uc-note">The rules that come with the VIT Chennai transport dataset.</p>
            </div>
          </div>
          <div className="uc-dir-ledger">
            {seed.rules.map((rule) => (
              <div key={rule.ruleNumber} className="uc-dir-row">
                <span className="uc-dir-tile uc-dir-tile--num">{rule.ruleNumber}</span>
                <div className="uc-dir-main"><p className="uc-dir-sub">{rule.content}</p></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Route detail modal */}
      {selected && (
        <div
          className="uc-overlay fixed inset-0 z-[70]"
          onClick={() => setSelected(null)}
        >
          <div ref={routeRef} role="dialog" aria-modal="true" aria-label={"Route " + selected.routeNumber + " details"}
            className="uc-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="uc-plate-head uc-sheet-head">
              <div className="uc-dir-id">
                <span className="uc-cap">{selected.type} bus</span>
                <h3 className="uc-dir-detail-title"><span className="uc-num">#{selected.routeNumber}</span> · {selected.routeName}</h3>
              </div>
              <button onClick={() => setSelected(null)} className="uc-dir-ico" aria-label="Close route details">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="uc-sheet-body">
              {(selected.supervisorName || selected.supervisorPhone) && (
                <ContactRow
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Supervisor"
                  name={selected.supervisorName || '—'}
                  phone={selected.supervisorPhone}
                />
              )}
              {(selected.driverName || selected.driverPhone) && (
                <ContactRow
                  icon={<Phone className="h-4 w-4" />}
                  label="Driver in charge"
                  name={selected.driverName || '—'}
                  phone={selected.driverPhone}
                />
              )}
              {!selected.driverName && !selected.driverPhone && !selected.supervisorName && !selected.supervisorPhone && (
                <div className="uc-dir-alert"><Info /><span>There is no driver or supervisor number on file for this route. Contact the VIT Transport Helpdesk at <a className="uc-dir-inline-link" href="mailto:transport.cc@vit.ac.in">transport.cc@vit.ac.in</a> and ask for it.</span></div>
              )}

              <span className="uc-dir-subhead">Stops &amp; pickup times</span>
              <div className="uc-rail">
                {selected.stops.map((s, i) => (
                  <div key={s.stopOrder} className={`uc-rail-row${i === 0 ? ' is-now' : ''}`}>
                    <span className="uc-rail-time">{s.pickupTime}</span>
                    <span className="uc-rail-spine" />
                    <div className="uc-rail-main"><strong>{s.stopName}</strong></div>
                  </div>
                ))}
              </div>
              {selected.busLocation && (
                <p className="uc-dir-sub uc-dir-sub--block"><Navigation className="uc-dir-inline" /> Live location: {selected.busLocation}</p>
              )}
              {selected.whatsappGroup && (
                <p className="uc-dir-sub">WhatsApp group: {selected.whatsappGroup}</p>
              )}

              {(() => {
                const p = placementFor(selected.routeNumber);
                if (!p) return null;
                return (
                  <>
                    <span className="uc-dir-subhead">Dispersal</span>
                    <div className="uc-dir-ledger">
                      <div className="uc-dir-row uc-dir-row--acts">
                        <span className="uc-dir-tile uc-dir-tile--num">{p.dispersalTime}</span>
                        <div className="uc-dir-main">
                          <span className="uc-dir-title">{p.zone}</span>
                          <span className="uc-dir-meta">Dispersal zone for this route</span>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function ContactRow({ icon, label, name, phone }: { icon: React.ReactNode; label: string; name: string; phone?: string }) {
  const tel = phone ? phone.replace(/[^0-9+]/g, '') : '';
  return (
    <div className="uc-dir-row uc-dir-row--acts">
      <span className="uc-dir-tile">{icon}</span>
      <div className="uc-dir-main">
        <span className="uc-dir-title">{name}</span>
        <span className="uc-dir-meta">{label}</span>
      </div>
      {phone
        ? <a className="uc-dir-go" href={`tel:${tel}`}><Phone className="h-3.5 w-3.5" /> Call</a>
        : <span className="uc-dir-tag">No number</span>}
    </div>
  );
}
