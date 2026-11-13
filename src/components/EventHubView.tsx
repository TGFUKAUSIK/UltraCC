import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ArrowLeft, Bookmark, Building2, CalendarDays, CalendarPlus, ExternalLink, IndianRupee,
  Loader2, MapPin, RefreshCw, Search, Ticket, WifiOff,
} from 'lucide-react';
import { edgeFetch, HubEvent } from '../lib/edgeFetch';
import { posterSources } from '../lib/eventPoster';
import { getSavedEvents, subscribeSavedEvents, toggleSavedEvent } from '../lib/savedEvents';
import { exportEventToIcs, isEventCalendarReady, downloadIcs } from '../utils/icalExport';
import { localTodayIso } from '../utils/localDate';
import { formatSyncStamp } from '../utils/timestamp';
import {
  EVENT_TABS, eventDateLabel, eventWeekday, isEventDate, isFreePrice, sortEventsIntoTabs, type EventTab,
} from '../utils/eventSchedule';

interface EventHubResponse {
  success: boolean;
  error?: string;
  events?: HubEvent[];
  syncedAt?: number;
}

type Tab = EventTab;
type PriceFilter = 'all' | 'free' | 'paid';

const MONTH_UP = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Poster image with a placeholder for missing/broken images (never a broken
 *  <img>). Lazy-loads, and works down the list of addresses before giving up:
 *  a phone cannot load the Event Hub host itself (it sends an incomplete TLS
 *  chain), so the mirrored address is what makes the poster appear there.
 *  See `src/lib/eventPoster.ts`.
 *
 *  Failures are remembered by URL rather than by index, so the same component
 *  showing another event's poster starts from that poster's own first address. */
function Poster({ sources, alt, className }: { sources: string[]; alt: string; className?: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find((url) => url && !failed.includes(url)) ?? '';
  if (!src) {
    return (
      <span className={`${className ?? ''} uc-ev-ph`} aria-hidden="true">
        <Ticket className="h-8 w-8" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed((list) => (list.includes(src) ? list : [...list, src]))}
      className={`${className ?? ''} uc-ev-shot`}
    />
  );
}

/**
 * The day and month a listing's poster is stamped with, or null when the cell
 * Event Hub wrote is not a day that ever existed. No instant is built here —
 * `isEventDate` owns that judgement and this only slices its answer, so the
 * view keeps no second date rule.
 */
function eventDayMark(date?: string | null): { day: string; mon: string } | null {
  const iso = isEventDate(date);
  if (!iso) return null;
  const [, m, d] = iso.split('-').map(Number);
  return { day: iso.slice(8, 10), mon: MONTH_UP[m - 1] ?? '' };
}

/**
 * EventHubView — upcoming events from VIT Chennai's official Event Hub
 * (eventhubcc.vit.ac.in), served through the `event-hub` edge function.
 *
 * The public listing gives title, date, venue, fee, eligibility, team size and
 * a poster per event. The organizer ("Conducted By"), start time, status and
 * full description live behind the Event Hub sign-in, so they are never
 * invented here — the detail view points at the exact event's page instead.
 *
 * An event is the one thing in this app that arrives as a poster, so this is
 * the one route built around an image: the period's soonest listing leads as a
 * split editorial card, the rest fall into a poster wall, and a listing's day
 * is stamped on its poster the way a flyer carries it. The actions stay a
 * single compact rail beneath the facts, because the poster is the content.
 */
export const EventHubView: React.FC = () => {
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [tab, setTab] = useState<EventTab>('upcoming');
  const [query, setQuery] = useState('');
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('all');
  const [selectedEid, setSelectedEid] = useState<string | null>(null);

  const savedEvents = useSyncExternalStore(subscribeSavedEvents, getSavedEvents);
  const savedIds = useMemo(() => new Set(savedEvents.map((e) => e.eid)), [savedEvents]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await edgeFetch<EventHubResponse>('event-hub');
      if (!data.success) {
        setError('The Event Hub is temporarily unavailable. Please try again later.');
        setEvents([]);
      } else {
        // Normalise against the pre-dedup edge-function shape: if `options` is
        // missing (a not-yet-deployed edge function), fall back to a single
        // option built from the primary fields so the UI never reads undefined.
        setEvents((data.events || []).map((ev) => ({
          ...ev,
          options: ev.options && ev.options.length ? ev.options : [{ type: ev.type, price: ev.price, eligibility: ev.eligibility }],
        })));
        setSyncedAt(data.syncedAt ?? null);
      }
    } catch {
      setError('Could not reach the Event Hub. Check your connection and try again.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const todayIso = localTodayIso();

  /** Events per tab, chronological (soonest first), undated listings last. */
  const byTab = useMemo(() => sortEventsIntoTabs(events, todayIso), [events, todayIso]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return byTab[tab].filter((ev) => {
      if (priceFilter === 'free' && !ev.options.some((o) => isFreePrice(o.price))) return false;
      if (priceFilter === 'paid' && !ev.options.some((o) => !isFreePrice(o.price))) return false;
      if (!q) return true;
      const hay = [
        ev.title, ev.location, ev.type, ev.eligibility, ev.teamSize,
        ...ev.options.flatMap((o) => [o.type, o.price, o.eligibility]),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [byTab, tab, query, priceFilter]);

  const selected = selectedEid ? events.find((e) => e.eid === selectedEid) ?? null : null;

  /* ── Detail: the flyer the wall's poster leads to ───────────────────────── */
  if (selected) {
    const saved = savedIds.has(selected.eid);
    const calendarReady = isEventCalendarReady(selected.date);
    // One call each, so the card cannot print a date and a weekday that disagree
    // about whether this listing has a real day at all.
    const dateLabel = eventDateLabel(selected.date);
    const weekday = eventWeekday(selected.date);
    const stamp = eventDayMark(selected.date);
    const onAddToCalendar = () => {
      if (!calendarReady) return;
      const ics = exportEventToIcs({ eid: selected.eid, title: selected.title, date: selected.date, location: selected.location });
      if (ics) downloadIcs(ics, `${selected.title.replace(/[^A-Za-z0-9 _-]/g, '')}.ics`);
    };

    return (
      <div className="uc-ev-view">
        <button type="button" className="uc-ev-back" onClick={() => setSelectedEid(null)}>
          <ArrowLeft size={14} aria-hidden="true" /> All events
        </button>

        <article className="uc-plate uc-ev-page">
          <div className="uc-ev-hero">
            <Poster sources={posterSources(selected)} alt={`${selected.title} poster`} />
            {stamp && (
              <span className="uc-ev-stamp uc-ev-stamp--lg" aria-hidden="true">
                <b>{stamp.day}</b><i>{stamp.mon}</i>
              </span>
            )}
          </div>

          <div className="uc-ev-page-body">
            <div className="uc-ev-page-top">
              <div className="uc-ev-page-id">
                {selected.type && <span className="uc-ev-type">{selected.type}</span>}
                <h2 className="uc-ev-page-name">{selected.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => toggleSavedEvent({ eid: selected.eid, title: selected.title, date: selected.date })}
                aria-label={saved ? `Remove ${selected.title} from saved events` : `Save ${selected.title}`}
                aria-pressed={saved}
                className={`uc-ev-save min-h-[44px] min-w-[44px]${saved ? ' is-on' : ''}`}
              >
                <Bookmark size={16} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
            </div>

            <dl className="uc-facts uc-ev-facts">
              {selected.date && (
                <div>
                  <dt>Date</dt>
                  <dd>{dateLabel}{weekday && ` · ${weekday}`}</dd>
                </div>
              )}
              {selected.location && (
                <div>
                  <dt>Venue</dt>
                  <dd>{selected.location}</dd>
                </div>
              )}
              {selected.teamSize && (
                <div>
                  <dt>Team size</dt>
                  <dd>{selected.teamSize}</dd>
                </div>
              )}
            </dl>

            {/* Fee / eligibility options — one ruled line per category the
                listing carries, the fee set on the mono face. */}
            {selected.options.length > 0 && (
              <div className="uc-ev-opts">
                {selected.options.map((o, i) => (
                  <div key={`${o.type}-${o.price}-${i}`} className="uc-ev-opt">
                    <span className="uc-ev-opt-id">
                      <b>{o.type || 'Entry'}</b>
                      {o.eligibility && <i>{o.eligibility}</i>}
                    </span>
                    <span className="uc-ev-opt-fee uc-num">
                      {isFreePrice(o.price) ? 'Free' : <><IndianRupee size={12} aria-hidden="true" />{o.price}</>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Organizer / timing / full details are behind Event Hub's sign-in —
                say so honestly instead of inventing a club or a start time. */}
            <p className="uc-ev-source">
              <Building2 size={14} aria-hidden="true" />
              Organizer, start time, status and full details are on the Event Hub page (sign-in required).
            </p>

            <div className="uc-ev-acts">
              <a
                href={selected.registerUrl || 'https://eventhubcc.vit.ac.in/EventHub/'}
                target="_blank"
                rel="noreferrer"
                className="uc-ev-act is-primary"
              >
                <ExternalLink size={14} aria-hidden="true" /> Register
              </a>
              <button
                type="button"
                onClick={onAddToCalendar}
                disabled={!calendarReady}
                title={calendarReady ? 'Add to Calendar' : 'No confirmed date to add yet'}
                className="uc-ev-act"
              >
                <CalendarPlus size={14} aria-hidden="true" /> Add to calendar
              </button>
            </div>
          </div>
        </article>
      </div>
    );
  }

  /* ── List: the poster wall ───────────────────────────────────────────────── */
  const hasEvents = !loading && !error && events.length > 0;

  return (
    <div className="uc-ev-view">
      <section className="uc-plate uc-ev-mast">
        <div className="uc-plate-head">
          <div className="uc-ev-id">
            <p className="uc-cap">Campus events</p>
            <h2 className="uc-ev-title">Event Hub</h2>
            <p className="uc-note">
              Official VIT Chennai listings from eventhubcc.vit.ac.in
              {syncedAt ? ` · synced ${formatSyncStamp(syncedAt)}` : ''}
            </p>
          </div>
          <button type="button" className="uc-ev-refresh" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
            Refresh
          </button>
        </div>

        {hasEvents && (
          <>
            <div className="uc-seg uc-ev-tabs" role="group" aria-label="Event periods">
              {EVENT_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tab === t.id}
                  className={tab === t.id ? 'is-on' : ''}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  <span className="uc-ev-n">{byTab[t.id].length}</span>
                </button>
              ))}
            </div>

            <div className="uc-ev-tools">
              <div className="uc-ev-search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search events, venues, categories"
                  aria-label="Search events"
                />
              </div>
              <div className="uc-ev-price" role="group" aria-label="Price">
                {(['all', 'free', 'paid'] as PriceFilter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={priceFilter === f}
                    className={priceFilter === f ? 'is-on' : ''}
                    onClick={() => setPriceFilter(f)}
                  >
                    {f === 'all' ? 'All' : f === 'free' ? 'Free' : 'Paid'}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {loading && (
        <div className="uc-ev-loading" role="status">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          <span>Loading events…</span>
        </div>
      )}

      {!loading && error && (
        <div className="uc-note-row uc-note-row--stack uc-ev-error" role="status">
          <p className="uc-note-row-head"><WifiOff size={14} aria-hidden="true" /> Event Hub unavailable</p>
          <p className="uc-note-row-line">{error}</p>
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <section className="uc-plate uc-ev-blank">
          <div className="uc-empty">
            <span>No events listed right now. Check back later — listings are pulled live from the official VIT Chennai Event Hub.</span>
            <Ticket size={18} aria-hidden="true" />
          </div>
        </section>
      )}

      {hasEvents && (
        filtered.length === 0 ? (
          <section className="uc-plate uc-ev-blank">
            <div className="uc-empty">
              <span>No events match this search or filter.</span>
              <Ticket size={18} aria-hidden="true" />
            </div>
          </section>
        ) : (
          <div className="uc-ev-wall">
            {filtered.map((ev, i) => {
              const saved = savedIds.has(ev.eid);
              const free = isFreePrice(ev.price);
              const weekday = eventWeekday(ev.date);
              const stamp = eventDayMark(ev.date);
              return (
                <button
                  key={ev.eid}
                  type="button"
                  onClick={() => setSelectedEid(ev.eid)}
                  aria-label={`Open ${ev.title}`}
                  className={`uc-ev-card${i === 0 ? ' is-lead' : ''}`}
                >
                  <span className="uc-ev-poster">
                    <Poster sources={posterSources(ev)} alt={`${ev.title} poster`} />
                    {stamp && (
                      <span className="uc-ev-stamp" aria-hidden="true">
                        <b>{stamp.day}</b><i>{stamp.mon}</i>
                      </span>
                    )}
                    {saved && (
                      <span className="uc-ev-flag" aria-hidden="true"><Bookmark size={13} fill="currentColor" /></span>
                    )}
                  </span>
                  <span className="uc-ev-body">
                    {ev.type && <span className="uc-ev-type">{ev.type}</span>}
                    <h3 className="uc-ev-name">{ev.title}</h3>
                    <span className="uc-ev-lines">
                      {ev.location && (
                        <span className="uc-ev-meta"><MapPin size={13} aria-hidden="true" />{ev.location}</span>
                      )}
                      <span className="uc-ev-meta">
                        <CalendarDays size={13} aria-hidden="true" />
                        {eventDateLabel(ev.date)}{weekday && ` · ${weekday}`}
                      </span>
                      <span className="uc-ev-meta">
                        <IndianRupee size={13} aria-hidden="true" />
                        {free ? 'Free' : ev.price || '—'}
                        {ev.options.length > 1 && <em>· {ev.options.length} categories</em>}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )
      )}
    </div>
  );
};
