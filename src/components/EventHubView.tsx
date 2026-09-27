import React, { useEffect, useState } from 'react';
import { CalendarDays, MapPin, IndianRupee, Users, Loader2, WifiOff, ExternalLink, Ticket } from 'lucide-react';
import { edgeFetch, HubEvent } from '../lib/edgeFetch';

interface EventHubResponse {
  success: boolean;
  error?: string;
  events?: HubEvent[];
  syncedAt?: number;
}

/**
 * EventHubView — upcoming events from VIT Chennai's official Event Hub
 * (eventhubcc.vit.ac.in), served through the `event-hub` edge function.
 * Public data, no login required.
 */
export const EventHubView: React.FC = () => {
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await edgeFetch<EventHubResponse>('event-hub');
      if (!data.success) {
        // Never render raw server/transport strings: the edge function sends a
        // sanitized message, and we keep fixed copy here regardless.
        setError('The Event Hub is temporarily unavailable. Please try again later.');
        setEvents([]);
      } else {
        setEvents(data.events || []);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">Event Hub</h2>
          <p className="text-sm text-zinc-500 font-medium mt-1">
            Official VIT Chennai events — from eventhubcc.vit.ac.in
          </p>
        </div>
        <div className="flex items-center gap-2">
          {syncedAt && (
            <span className="text-[10px] text-zinc-500 font-medium">Synced {new Date(syncedAt).toLocaleString()}</span>
          )}
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 rounded-full bg-white hover:bg-zinc-100 border border-zinc-200 text-xs font-medium text-zinc-900 transition cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin mr-3" />
          <span className="text-sm font-medium">Loading events…</span>
        </div>
      )}

      {!loading && error && (
        <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-700 text-sm flex items-center gap-3">
          <WifiOff className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Event Hub unavailable</p>
            <p className="text-xs mt-1 text-rose-700/80">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="p-10 bg-white border border-zinc-200 rounded-3xl text-center">
          <Ticket className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
          <p className="text-sm font-bold text-zinc-900">No events listed right now</p>
          <p className="text-[11px] text-zinc-500 mt-1">Check back later — events are pulled live from the official VIT Chennai Event Hub.</p>
        </div>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((ev) => (
            <div key={ev.eid} className="bg-white border border-zinc-200 rounded-3xl overflow-hidden hover:border-zinc-200 transition flex flex-col">
              {ev.posterUrl && (
                <div className="h-40 w-full overflow-hidden bg-white">
                  <img src={ev.posterUrl} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                </div>
              )}
              <div className="p-5 flex flex-col gap-2 flex-1">
                <h3 className="font-bold text-zinc-900 text-sm leading-snug">{ev.title}</h3>
                <div className="space-y-1.5 text-[11px] text-zinc-500">
                  {ev.type && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full acc-soft acc-text border acc-border text-[10px] font-bold uppercase tracking-wide">
                      {ev.type}
                    </span>
                  )}
                  {ev.date && (
                    <p className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 text-zinc-500" /> {ev.date}
                    </p>
                  )}
                  {ev.location && (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-zinc-500" /> {ev.location}
                    </p>
                  )}
                  {ev.price && (
                    <p className="flex items-center gap-1.5">
                      <IndianRupee className="h-3.5 w-3.5 text-zinc-500" /> {ev.price}
                    </p>
                  )}
                  {ev.eligibility && (
                    <p className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-zinc-500" /> {ev.eligibility}
                    </p>
                  )}
                </div>
                <a
                  href={ev.registerUrl || 'https://eventhubcc.vit.ac.in/EventHub/'}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl acc-bg text-zinc-900 text-xs font-bold acc-glow hover:opacity-90 transition cursor-pointer"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> View / Register
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
