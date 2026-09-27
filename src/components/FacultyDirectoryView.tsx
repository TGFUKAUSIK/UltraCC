import React, { useEffect, useMemo, useState } from 'react';
import { Search, Users, UserRound, Loader2, WifiOff, Mail, ExternalLink, GraduationCap, IdCard, ShieldCheck } from 'lucide-react';
import { edgeFetch, FacultyMember } from '../lib/edgeFetch';
import { isLiveSessionActive, getLiveClient } from '../lib/vtop/liveSession';
import { humanErrorCopy } from '../lib/errorCopy';
import { EmployeeSearchResult } from '../lib/vtop/types';

interface FacultyDirectoryResponse {
  success: boolean;
  error?: string;
  faculties?: FacultyMember[];
  school?: { id: string; name: string };
  syncedAt?: number;
}

/**
 * FacultyDirectoryView — inbuilt, searchable directory of VIT Chennai faculty
 * (public data via chennai.vit.ac.in/faculty, served through the
 * `faculty-directory` edge function). No login required.
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">Faculty Directory</h2>
          <p className="text-sm text-zinc-500 font-medium mt-1">
            VIT Chennai faculty, school by school — public data from chennai.vit.ac.in
          </p>
        </div>
        {syncedAt && (
          <span className="text-[10px] text-zinc-500 font-medium">Synced {new Date(syncedAt).toLocaleString()}</span>
        )}
      </div>

      {/* VTOP employee search (requires a live login) */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-3">
          <IdCard className="h-4 w-4 text-blue-600" />
          <p className="text-xs font-bold text-zinc-900">Search VTOP directory</p>
          <span className="text-[9px] uppercase tracking-wide px-2 py-0.5 rounded-full acc-soft acc-text border acc-border font-bold">needs login</span>
        </div>
        {liveReady ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              aria-label="Search VTOP faculty by employee ID or name"
              value={vtopQuery}
              onChange={(e) => setVtopQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runVtopSearch(); }}
              placeholder="Employee ID or name (e.g. 50300 or Viswanathan)"
              className="flex-1 px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder-zinc-500 outline-none focus:border-blue-500/60 transition"
            />
            <button
              onClick={() => void runVtopSearch()}
              disabled={vtopSearching || !vtopQuery.trim()}
              className="px-4 py-2.5 rounded-xl acc-bg text-zinc-900 text-xs font-bold acc-glow hover:opacity-90 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
            >
              {vtopSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Search
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-zinc-600" />
            Log in via VTOP to search the official VIT employee directory — or use the public school lists below.
          </p>
        )}
        {vtopError && <p className="mt-2 text-[11px] text-rose-600">{vtopError}</p>}
        {vtopResult && vtopResult.found && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {vtopResult.fields.map((f) => (
              <div key={f.label} className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                <p className="text-[9px] uppercase tracking-wide text-zinc-500 font-bold">{f.label}</p>
                <p className="text-xs font-semibold text-zinc-900 mt-0.5 break-words">{f.value || '—'}</p>
              </div>
            ))}
          </div>
        )}
        {vtopResult && !vtopResult.found && (
          <p className="mt-2 text-[11px] text-amber-600">
            {vtopResult.message || 'No matching employee found on VTOP.'}
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            aria-label="Search the faculty directory by name, designation, school or employee ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, designation, school, employee ID…"
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder-zinc-500 outline-none focus:border-blue-500/60 transition"
          />
        </div>
        <select
          aria-label="Filter by school"
          value={school}
          onChange={(e) => setSchool(e.target.value)}
          className="px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 outline-none focus:border-blue-500/60 cursor-pointer"
        >
          <option value="all">All Schools (aggregated)</option>
          <option value="scope">SCOPE — CSE</option>
          <option value="select">SELECT — Electrical</option>
          <option value="sense">SENSE — Electronics</option>
          <option value="smec">SMEC — Mechanical</option>
          <option value="sas-physics">SAS — Physics</option>
          <option value="sas-maths">SAS — Mathematics</option>
          <option value="sas-chem">SAS — Chemistry</option>
          <option value="sbst">SBST — Bio Sciences</option>
          <option value="ssl">SSL — Social Sciences</option>
          <option value="sce">SCE — Civil</option>
          <option value="vfit">V-FIT — Fashion</option>
          <option value="vitsol">VITSOL — Law</option>
          <option value="vsmart">V-SMART — Media</option>
          <option value="hrob">HR & OB</option>
        </select>
      </div>

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin mr-3" />
          <span className="text-sm font-medium">Loading faculty directory…</span>
        </div>
      )}

      {!loading && error && (
        <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-700 text-sm flex items-center gap-3">
          <WifiOff className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Faculty directory unavailable</p>
            <p className="text-xs mt-1 text-rose-700/80">{error} The directory loads from the public VIT Chennai site — check your connection or try again.</p>
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium">
            <Users className="h-4 w-4" />
            {filtered.length} {filtered.length === 1 ? 'faculty member' : 'faculty members'}
            {query && ' matching your search'}
          </div>

          {filtered.length === 0 ? (
            <div className="p-10 bg-white border border-zinc-200 rounded-3xl text-center">
              <UserRound className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
              <p className="text-sm font-bold text-zinc-900">No faculty found</p>
              <p className="text-[11px] text-zinc-500 mt-1">Try a different name or school.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((f) => (
                <div key={`${f.schoolId}-${f.employeeId}-${f.name}`} className="bg-white border border-zinc-200 rounded-3xl p-5 hover:border-zinc-200 transition">
                  <div className="flex items-start gap-3">
                    {f.imageUrl ? (
                      <img
                        src={f.imageUrl}
                        alt=""
                        loading="lazy"
                        className="h-12 w-12 rounded-2xl object-cover bg-zinc-100 shrink-0"
                        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-2xl bg-zinc-100 flex items-center justify-center shrink-0">
                        <GraduationCap className="h-5 w-5 text-zinc-500" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-zinc-900 text-sm leading-snug">{f.name}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">{f.designation}</p>
                      <p className="text-[10px] text-zinc-500 mt-1 font-medium uppercase tracking-wide">{f.schoolName}</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {f.employeeId && (
                      <p className="text-[10px] font-mono text-zinc-500">ID: {f.employeeId}</p>
                    )}
                    {f.email && (
                      <a href={`mailto:${f.email}`} className="flex items-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-700 transition">
                        <Mail className="h-3 w-3" /> {f.email}
                      </a>
                    )}
                    {f.profileUrl && (
                      <a href={f.profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-900 transition">
                        <ExternalLink className="h-3 w-3" /> View profile
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
