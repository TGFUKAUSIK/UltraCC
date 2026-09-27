import React, { useEffect, useMemo, useState } from 'react';
import { Info, Users, Search, Loader2, ExternalLink, Mail, Instagram, Clock, Phone } from 'lucide-react';
import { fetchCampus, type Club } from '../lib/campusClient';

export const ClubHub: React.FC = () => {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const result = await fetchCampus<Club[]>('clubs', 'all', { dataset: 'clubs' });
      if (!alive) return;
      if (result.data) {
        setClubs(result.data);
        setStale(result.stale);
        setSyncedAt(result.syncedAt);
        if (result.error) setError(result.error);
      } else {
        setError(result.error || 'The student communities directory is temporarily unavailable.');
      }
      setLoading(false);
    })().catch(() => {
      // §9: a failed request must never leave a permanent loading state.
      if (!alive) return;
      setError('The student communities directory is temporarily unavailable.');
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const visible = useMemo(() => { const q = query.trim().toLowerCase(); return q ? clubs.filter((c) => `${c.club_name} ${c.mission || ''} ${c.description || ''}`.toLowerCase().includes(q)) : clubs; }, [clubs, query]);

  const syncedLabel = syncedAt
    ? `Directory synced ${new Date(syncedAt).toLocaleString()}${stale ? ' · showing last synced copy' : ''}`
    : '';

  return (
  <div className="space-y-4 pb-12">
    <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
      <div className="flex items-center gap-3 mb-5"><div className="p-2.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600"><Users className="h-6 w-6" /></div><div><h2 className="text-lg font-extrabold text-zinc-900 tracking-tight">Student Communities</h2><p className="text-xs text-zinc-500 font-medium">Clubs, chapters, special teams and student communities</p></div></div>
      <div className="relative mt-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search communities, clubs, chapters or interests" aria-label="Search student communities" className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-xs text-zinc-900 outline-none focus:border-blue-500" /></div>
      {syncedLabel && !loading && <p className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-zinc-500"><Clock className="h-3 w-3" />{syncedLabel}</p>}
      {loading && <div className="flex justify-center py-16 text-blue-600"><Loader2 className="h-6 w-6 animate-spin" /></div>}
      {!loading && error && <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5 text-sm text-rose-700">{error}</div>}
      {!loading && !error && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map((club) => <article key={club.club_id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"><div className="flex items-start gap-3">{club.logo_url ? <img src={club.logo_url} alt="" className="h-10 w-10 rounded-xl object-contain" /> : <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600"><Users className="h-5 w-5" /></div>}<h3 className="pt-1 text-sm font-bold text-zinc-900">{club.club_name}</h3></div>{(club.mission || club.description) && <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-zinc-500">{club.mission || club.description}</p>}{club.hiring_process && <details className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"><summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-zinc-900">Recruitment details</summary><p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{club.hiring_process}</p></details>}<div className="mt-3 flex flex-wrap gap-2">{club.poc && <span className="rounded-lg bg-white px-2 py-1 text-[10px] text-zinc-900">POC: {club.poc}</span>}{club.poc_phone && <a href={`tel:${club.poc_phone.replace(/[^0-9+]/g, '')}`} className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] text-zinc-900"><Phone className="h-3 w-3" /> {club.poc_phone}</a>}{club.email && <a href={`mailto:${club.email}`} className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] text-zinc-900"><Mail className="h-3 w-3" /> Email</a>}{club.instagram && <a href={club.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] text-zinc-900"><Instagram className="h-3 w-3" /> Instagram</a>}{club.website && <a href={club.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-blue-500/10 px-2 py-1 text-[10px] text-blue-700">Website <ExternalLink className="h-3 w-3" /></a>}{club.recruitment_link && <a href={club.recruitment_link} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-700">Recruitment</a>}</div></article>)}</div>}
      {!loading && !error && visible.length === 0 && <div className="mt-4 rounded-2xl border border-zinc-200 p-8 text-center text-sm text-zinc-500">No matching communities found.</div>}
    </div>
    <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-xl"><div className="flex items-start gap-2 text-xs text-zinc-500 leading-relaxed"><Info className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" /><span>The directory above is served through the UltraCC campus-data service and reflects the official VIT Chennai communities directory — live when reachable, otherwise the last synced copy. UltraCC does not maintain a fabricated list or invented event counts.</span></div></div>
  </div>
  );
};
