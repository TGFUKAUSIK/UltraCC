import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, WifiOff, Mail, ExternalLink, GraduationCap, ShieldCheck } from 'lucide-react';
import { edgeFetch, FacultyMember } from '../lib/edgeFetch';
import { isLiveSessionActive, getLiveClient } from '../lib/vtop/liveSession';
import { humanErrorCopy } from '../lib/errorCopy';
import { formatSyncStamp } from '../utils/timestamp';
import { EmployeeSearchResult } from '../lib/vtop/types';

interface FacultyDirectoryResponse {
  success: boolean;
  error?: string;
  faculties?: FacultyMember[];
  school?: { id: string; name: string };
  syncedAt?: number;
}

/** School filter options, kept in the order VIT lists them. */
const SCHOOLS: { id: string; label: string }[] = [
  { id: 'all', label: 'All schools (aggregated)' },
  { id: 'scope', label: 'SCOPE — CSE' },
  { id: 'select', label: 'SELECT — Electrical' },
  { id: 'sense', label: 'SENSE — Electronics' },
  { id: 'smec', label: 'SMEC — Mechanical' },
  { id: 'sas-physics', label: 'SAS — Physics' },
  { id: 'sas-maths', label: 'SAS — Mathematics' },
  { id: 'sas-chem', label: 'SAS — Chemistry' },
  { id: 'sbst', label: 'SBST — Bio Sciences' },
  { id: 'ssl', label: 'SSL — Social Sciences' },
  { id: 'sce', label: 'SCE — Civil' },
  { id: 'vfit', label: 'V-FIT — Fashion' },
  { id: 'vitsol', label: 'VITSOL — Law' },
  { id: 'vsmart', label: 'V-SMART — Media' },
  { id: 'hrob', label: 'HR & OB' },
];

/**
 * FacultyDirectoryView — inbuilt, searchable directory of VIT Chennai faculty
 * (public data via chennai.vit.ac.in/faculty, served through the
 * `faculty-directory` edge function). No login required, plus an optional VTOP
 * employee search when the student is signed in.
 */
export const FacultyDirectoryView: React.FC = () => {
  const [faculty, setFaculty] = useState<FacultyMember[]>([]);
  const [query, setQuery] = useState('');
  const [school, setSchool] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [vtopQuery, setVtopQuery] = useState('');
  const [vtopResult, setVtopResult] = useState<EmployeeSearchResult | null>(null);
  const [vtopSearching, setVtopSearching] = useState(false);
  const [vtopError, setVtopError] = useState<string | null>(null);
  const liveReady = isLiveSessionActive();

  const load = async (schoolId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await edgeFetch<FacultyDirectoryResponse>(`faculty-directory?school=${encodeURIComponent(schoolId)}`);
      if (!data.success) {
        setError(data.error || 'The faculty directory could not be loaded.');
        setFaculty([]);
      } else {
        setFaculty(data.faculties || []);
        setSyncedAt(data.syncedAt ?? null);
      }
    } catch (err) {
      setError(humanErrorCopy(err, 'Could not reach the faculty directory.'));
      setFaculty([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(school);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school]);

  const runVtopSearch = async () => {
    const q = vtopQuery.trim();
    if (!q || !isLiveSessionActive()) return;
    setVtopSearching(true);
    setVtopError(null);
    try {
      const client = getLiveClient();
      const result = await client.searchEmployee(q);
      setVtopResult(result);
    } catch (err) {
      setVtopError(humanErrorCopy(err, 'The VTOP staff search could not be reached.'));
      setVtopResult(null);
    } finally {
      setVtopSearching(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return faculty;
    return faculty.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.designation.toLowerCase().includes(q) ||
        f.schoolName.toLowerCase().includes(q) ||
        f.employeeId.toLowerCase().includes(q) ||
        f.email.toLowerCase().includes(q)
    );
  }, [faculty, query]);

  const schoolLabel = SCHOOLS.find((s) => s.id === school)?.label ?? 'All schools';

  return (
    <div className="uc-dir-view pb-12">
      {/* Mast */}
      <div className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">VIT Chennai</span>
            <h2 className="uc-dir-name">Faculty directory</h2>
            <p className="uc-note">
              Faculty, school by school — public data from chennai.vit.ac.in, with the official VTOP employee search when you are signed in.
            </p>
          </div>
        </div>
      </div>

      {/* Official VTOP employee search (needs a live login) */}
      <div className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap">Official VTOP search</span>
          <span className="uc-dir-tag">Needs login</span>
        </div>
        {liveReady ? (
          <div className="uc-dir-tools">
            <div className="uc-dir-search">
              <Search />
              <input
                aria-label="Search VTOP faculty by employee ID or name"
                value={vtopQuery}
                onChange={(e) => setVtopQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runVtopSearch(); }}
                placeholder="Employee ID or name (e.g. 50300 or Viswanathan)"
              />
            </div>
            <button
              onClick={() => void runVtopSearch()}
              disabled={vtopSearching || !vtopQuery.trim()}
              className="uc-dir-go acc-bg disabled:opacity-40"
            >
              {vtopSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Search
            </button>
          </div>
        ) : (
          <div className="uc-dir-detail">
            <div className="uc-note-row">
              <ShieldCheck />
              <span>Sign in to VTOP to search the official employee directory — or browse the public school lists below.</span>
            </div>
          </div>
        )}
        {vtopError && (
          <div className="uc-dir-alert">
            <WifiOff />
            <span>{vtopError}</span>
          </div>
        )}
        {vtopResult && vtopResult.found && (
          <dl className="uc-facts">
            {vtopResult.fields.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value || '—'}</dd>
              </div>
            ))}
          </dl>
        )}
        {vtopResult && !vtopResult.found && (
          <div className="uc-dir-detail">
            <p className="uc-dir-sub">{vtopResult.message || 'No matching employee found on VTOP.'}</p>
          </div>
        )}
      </div>

      {/* Directory ledger */}
      <div className="uc-plate uc-dir-ledger">
        <div className="uc-plate-head">
          <span className="uc-cap">Faculty</span>
          <span className="uc-dir-count">{loading ? 'Loading…' : `${filtered.length} shown`}</span>
        </div>
        <div className="uc-dir-tools">
          <div className="uc-dir-search">
            <Search />
            <input
              aria-label="Search the faculty directory by name, designation, school or employee ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, designation, school, employee ID…"
            />
          </div>
          <select
            aria-label="Filter by school"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            className="uc-dir-select"
          >
            {SCHOOLS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="uc-dir-loading">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading faculty directory…
          </div>
        ) : error ? (
          <div className="uc-dir-alert">
            <WifiOff />
            <span>{error} The directory loads from the public VIT Chennai site — check your connection, or open the school page directly.</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="uc-dir-blank">
            {query
              ? <>No faculty match “{query.trim()}” in {schoolLabel}. Try a different name, or widen the school filter.</>
              : <>No faculty listed for {schoolLabel} yet.</>}
          </div>
        ) : (
          filtered.map((f) => {
            const key = `${f.schoolId}-${f.employeeId}-${f.name}`;
            return (
              <div key={key} className="uc-dir-row uc-dir-row--media uc-dir-row--acts">
                <span className="uc-dir-tile uc-dir-tile--lg uc-dir-tile--face">
                  {f.imageUrl ? (
                    <img
                      src={f.imageUrl}
                      alt=""
                      loading="lazy"
                      onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                    />
                  ) : (
                    <GraduationCap className="h-5 w-5" />
                  )}
                </span>
                <div className="uc-dir-main">
                  <span className="uc-dir-title">{f.name}</span>
                  <span className="uc-dir-meta">{f.designation} · {f.schoolName}</span>
                </div>
                <div className="uc-dir-acts">
                  {f.employeeId && <span className="uc-dir-tag uc-num">ID {f.employeeId}</span>}
                  {f.email && (
                    <a href={`mailto:${f.email}`} aria-label={`Email ${f.name}`} className="uc-dir-tag">
                      <Mail /> Email
                    </a>
                  )}
                  {f.profileUrl && (
                    <a href={f.profileUrl} target="_blank" rel="noreferrer" aria-label={`Open ${f.name}'s profile`} className="uc-dir-go">
                      <ExternalLink className="h-3.5 w-3.5" /> Profile
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}

        {!loading && !error && (
          <div className="uc-plate-foot">
            <span>{syncedAt ? `Directory synced ${formatSyncStamp(syncedAt)}` : 'Public VIT Chennai directory'}</span>
          </div>
        )}
      </div>
    </div>
  );
};
