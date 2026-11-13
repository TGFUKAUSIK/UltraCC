import React, { useEffect, useMemo, useState } from 'react';
import { Info, Users, Search, Loader2, ExternalLink, Mail, Instagram, Clock, Phone } from 'lucide-react';
import { fetchCampus, type Club } from '../lib/campusClient';
import { formatSyncStamp } from '../utils/timestamp';

/**
 * ClubHub — the student communities directory, set as a directory: a mast you
 * search, then one row per community. Each row is the same object as a book or
 * a bus route elsewhere in the app — a tile, a name, one honest line, and the
 * contact links beside it — so the three read as one library rather than three
 * card walls.
 */
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
    ? `Directory synced ${formatSyncStamp(syncedAt)}${stale ? ' · showing last synced copy' : ''}`
    : '';

  return (
    <div className="uc-dir-view">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">Student communities</span>
            <h2 className="uc-dir-name">Clubs &amp; Chapters</h2>
            <p className="uc-note">Clubs, chapters, special teams and student communities across VIT Chennai.</p>
          </div>
        </div>
        <div className="uc-dir-tools">
          <div className="uc-dir-search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search communities, clubs, chapters or interests"
              aria-label="Search student communities"
            />
          </div>
          {!loading && !error && <span className="uc-dir-count">{visible.length} {visible.length === 1 ? 'community' : 'communities'}</span>}
        </div>
        {syncedLabel && !loading && <p className="uc-dir-stamp"><Clock />{syncedLabel}</p>}
      </section>

      {loading && (
        <section className="uc-plate">
          <div className="uc-dir-loading"><Loader2 className="h-5 w-5 animate-spin" /> Loading the communities directory…</div>
        </section>
      )}

      {!loading && error && (
        <section className="uc-plate">
          <div className="uc-dir-alert"><Info /><span>{error}</span></div>
        </section>
      )}

      {!loading && !error && (
        <section className="uc-plate uc-dir-ledger">
          {visible.length === 0 ? (
            <div className="uc-dir-blank">
              <b>No community matches “{query.trim()}”.</b> Try a shorter word, or the club&rsquo;s acronym.
            </div>
          ) : (
            visible.map((club) => (
              <article key={club.club_id} className="uc-dir-row">
                <span className="uc-dir-tile uc-dir-tile--lg">
                  {club.logo_url ? <img src={club.logo_url} alt="" /> : <Users className="h-4 w-4" />}
                </span>
                <div className="uc-dir-main">
                  <span className="uc-dir-title">{club.club_name}</span>
                  {(club.mission || club.description) && (
                    <p className="uc-dir-meta uc-dir-meta--clip">{club.mission || club.description}</p>
                  )}
                  {(club.poc || club.poc_phone || club.email || club.instagram || club.website || club.recruitment_link) && (
                    <div className="uc-dir-tags">
                      {club.poc && <span className="uc-dir-tag">POC: {club.poc}</span>}
                      {club.poc_phone && <a className="uc-dir-tag" href={`tel:${club.poc_phone.replace(/[^0-9+]/g, '')}`}><Phone /> {club.poc_phone}</a>}
                      {club.email && <a className="uc-dir-tag" href={`mailto:${club.email}`}><Mail /> Email</a>}
                      {club.instagram && <a className="uc-dir-tag" href={club.instagram} target="_blank" rel="noreferrer"><Instagram /> Instagram</a>}
                      {club.website && <a className="uc-dir-tag is-live" href={club.website} target="_blank" rel="noreferrer">Website <ExternalLink /></a>}
                      {club.recruitment_link && <a className="uc-dir-tag is-good" href={club.recruitment_link} target="_blank" rel="noreferrer">Recruitment</a>}
                    </div>
                  )}
                  {club.hiring_process && (
                    <details className="uc-dir-hiring">
                      <summary>Recruitment details</summary>
                      <p>{club.hiring_process}</p>
                    </details>
                  )}
                </div>
              </article>
            ))
          )}
          {visible.length > 0 && (
            <div className="uc-plate-foot">
              <span>Directory</span>
              <span className="uc-num">{visible.length}</span>
            </div>
          )}
        </section>
      )}

      <section className="uc-plate uc-plate--quiet">
        <div className="uc-note-row">
          <Info />
          <span>The directory above reflects the official VIT Chennai communities directory — live when reachable, otherwise the last synced copy. UltraCC does not maintain a fabricated list or invented event counts.</span>
        </div>
      </section>
    </div>
  );
};
