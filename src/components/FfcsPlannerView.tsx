import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Plus, Trash2, Copy, Users, CheckCircle2, AlertTriangle, Share2, Info, Search, Download, Table2, Layers, Clock3 } from 'lucide-react';
import '../styles/ffcs-planner.css';
import {
  FFCS_DATA_SEMESTER, clashingSectionIds, expandSlotString, ffcsSectionsFor, planCredits,
  searchFfcsCourses, type FfcsSection, type PlanSection,
} from '../lib/ffcsPlanner';
import { PLAN_PREFIX, decodePlan, encodePlan, nextPlanId, planCodeVersion, type PlanEntry } from '../lib/ffcsShare';
import { exportFfcsPlanImage } from '../utils/imageExport';

interface FfcsPlannerViewProps {
  timetable?: TimetableRow[] | null;
}
/** Minimal structural type — the real TimetableSlot adds fields we don't use. */
interface TimetableRow {
  day: string;
  slot: string;
  courseCode: string;
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT: Record<string, string> = { Monday: 'MON', Tuesday: 'TUE', Wednesday: 'WED', Thursday: 'THU', Friday: 'FRI', Saturday: 'SAT' };

/** Normalize a timetable time to HH:MM (rows store "08:00" or "8:00"). */
function normTime(t: string): string {
  const m = (t || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** Persisted plan tables (FFCSonTheGo's "multiple timetables" model). */
interface SavedTable {
  id: string;
  name: string;
  sections: PlanSection[];
}

const STORAGE_KEY = 'ultracc-ffcs-tables-v1';

function loadTables(): SavedTable[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedTable[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t) => t && typeof t.id === 'string' && Array.isArray(t.sections));
  } catch {
    return [];
  }
}

function persistTables(tables: SavedTable[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tables));
  } catch {
    // Storage full/blocked — plans stay in memory for this session.
  }
}

/** PlanSection from a catalogue section (id minted here). */
function toPlanSection(s: FfcsSection): PlanSection {
  return { id: nextPlanId(), code: s.code, title: s.title, slot: s.slot, type: s.type, credits: s.credits, venue: s.venue, faculty: s.faculty };
}

/** Adapt a legacy share-code entry (day+slot) into a PlanSection (slot string). */
function fromShareEntry(e: Omit<PlanEntry, 'id'>): PlanSection {
  return {
    id: nextPlanId(), code: e.code, title: e.title, slot: e.slot,
    type: e.courseType || '', credits: e.credits ?? 0, venue: e.venue, faculty: e.faculty,
  };
}

/**
 * FfcsPlannerView — FFCS course-registration planning (model adapted from
 * FFCSonTheGo). Search the real course inventory, pick a section (slot
 * buttons like the reference tool), and drop it on a visual week grid;
 * clashes highlight instantly across all its meetings.
 *
 * HONESTY: the catalogue is the FFCSonTheGo Fall 2026-27 Chennai snapshot,
 * not a live VTOP feed — provenance is surfaced in the UI. The synced
 * registered timetable (when present) is treated as unmovable: planned
 * sections that overlap it are flagged.
 */
export const FfcsPlannerView: React.FC<FfcsPlannerViewProps> = ({ timetable }) => {
  const real = useMemo(() => timetable || [], [timetable]);

  // --- Saved tables ---------------------------------------------------------
  const [tables, setTables] = useState<SavedTable[]>(() => loadTables());
  const [activeId, setActiveId] = useState<string>(() => loadTables()[0]?.id || '');
  const activeTable = tables.find((t) => t.id === activeId);

  useEffect(() => { persistTables(tables); }, [tables]);

  const ensureTable = (): SavedTable => {
    if (activeTable) return activeTable;
    const fresh: SavedTable = { id: nextPlanId(), name: 'Plan 1', sections: [] };
    setTables((ts) => [...ts, fresh]);
    setActiveId(fresh.id);
    return fresh;
  };
  const plan: PlanSection[] = activeTable?.sections || [];

  const mutatePlan = (fn: (sections: PlanSection[]) => PlanSection[]) => {
    setTables((ts) => {
      if (activeTable) return ts.map((t) => (t.id === activeTable.id ? { ...t, sections: fn(t.sections) } : t));
      return ts;
    });
  };

  const createTable = () => {
    const n = tables.length + 1;
    const fresh: SavedTable = { id: nextPlanId(), name: `Plan ${n}`, sections: [] };
    setTables((ts) => [...ts, fresh]);
    setActiveId(fresh.id);
  };
  const renameTable = (id: string) => {
    const name = window.prompt('Rename plan', tables.find((t) => t.id === id)?.name || '');
    if (name && name.trim()) setTables((ts) => ts.map((t) => (t.id === id ? { ...t, name: name.trim().slice(0, 40) } : t)));
  };
  const deleteTable = (id: string) => {
    setTables((ts) => {
      const next = ts.filter((t) => t.id !== id);
      if (activeId === id) setActiveId(next[0]?.id || '');
      return next;
    });
  };

  // --- Course picker --------------------------------------------------------
  const [query, setQuery] = useState('');
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const suggestions = useMemo(() => searchFfcsCourses(query), [query]);
  const pickedSections = useMemo(() => (pickedCode ? ffcsSectionsFor(pickedCode) : []), [pickedCode]);

  // --- Share / compare (kept from the previous planner) ---------------------
  const [showShare, setShowShare] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [friendText, setFriendText] = useState('');
  const [friendPlan, setFriendPlan] = useState<PlanSection[]>([]);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // --- Clash model ----------------------------------------------------------
  // Registered (synced) timetable rows are ALREADY concrete day+time meetings
  // (VTOP stores one row per meeting: slot A1 appears as Mon AND Wed rows).
  // They must NOT be re-expanded through the slot grid — that would make each
  // row cover every meeting of its slot letter and "overlap" itself. Plan
  // sections, in contrast, hold a slot STRING and must be expanded.
  const registeredMeetings = useMemo(
    () => real.map((r, i) => ({ id: `reg-${i}`, code: r.courseCode, day: r.day, start: normTime(r.startTime), end: normTime(r.endTime) })),
    [real],
  );
  const planClashIds = useMemo(() => clashingSectionIds(plan), [plan]);

  const candidateConflicts = (candidate: PlanSection): string[] => {
    const conflicts: string[] = [];
    for (const m of expandSlotString(candidate.slot)) {
      for (const r of registeredMeetings) {
        if (r.day === m.day && r.start < m.end && m.start < r.end) {
          conflicts.push(`${r.code} (${r.day} ${r.start})`);
          break;
        }
      }
    }
    // plan-plan conflicts via the engine
    for (const id of clashingSectionIds([...plan, candidate])) if (id === candidate.id) {
      // the candidate itself clashes with some planned section — name it
      const other = plan.find((p) => {
        const pair = [candidate, p];
        return clashingSectionIds(pair).has(candidate.id);
      });
      if (other) conflicts.push(`${other.code} (${other.slot})`);
    }
    return conflicts;
  };

  const addSection = (s: FfcsSection) => {
    if (!activeTable) ensureTable();
    const candidate = toPlanSection(s);
    const conflicts = candidateConflicts(candidate);
    if (conflicts.length) {
      window.alert(`"${candidate.code} (${candidate.slot})" overlaps ${conflicts[0]}. Drop the conflicting one first.`);
      return;
    }
    mutatePlan((secs) => [...secs, candidate]);
  };

  const removeSection = (id: string) => mutatePlan((secs) => secs.filter((s) => s.id !== id));

  // --- Week grid (slot-grid layout like the reference tool) -----------------
  interface CellMeeting { code: string; venue: string; sectionId: string; kind: 'plan' | 'registered'; slotToken: string; end: string }
  const grid = useMemo(() => {
    const cells = new Map<string, CellMeeting[]>();
    const push = (day: string, start: string, m: CellMeeting) => {
      const key = `${day}|${start}`;
      const list = cells.get(key) || [];
      list.push(m);
      cells.set(key, list);
    };
    // Registered rows are concrete meetings — place directly, no expansion.
    for (const r of registeredMeetings) {
      push(r.day, r.start, { code: r.code, venue: '', sectionId: r.id, kind: 'registered', slotToken: '', end: r.end });
    }
    for (const s of plan) {
      for (const m of expandSlotString(s.slot)) {
        push(m.day, m.start, { code: s.code, venue: s.venue, sectionId: s.id, kind: 'plan', slotToken: s.slot, end: m.end });
      }
    }
    return cells;
  }, [registeredMeetings, plan]);

  /** All distinct meeting start-times per day, sorted — the grid's rows. */
  const gridTimes = useMemo(() => {
    const byDay = new Map<string, string[]>();
    for (const [key] of grid) {
      const [day, start] = key.split('|');
      const list = byDay.get(day) || [];
      if (!list.includes(start)) list.push(start);
      byDay.set(day, list);
    }
    const all = [...new Set([...byDay.values()].flat())].sort();
    return all;
  }, [grid]);

  const cellAt = (day: string, start: string): CellMeeting[] => grid.get(`${day}|${start}`) || [];

  // --- Share ---------------------------------------------------------------
  const shareText = useMemo(() => encodePlan(plan.map((p) => ({ ...p, day: '', venue: p.venue, faculty: p.faculty, courseType: p.type || undefined }))), [plan]);
  const plannedCredits = planCredits(plan);

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = shareText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /**
   * Decode the pasted friend code. Fails gracefully and tells the user why:
   * wrong text, an unreadable/newer version, or no decodable sections.
   * Never fabricates friend data — only sections actually in the code appear.
   */
  const runCompare = () => {
    const text = friendText.trim();
    if (!text) {
      setFriendPlan([]);
      setCompareError(null);
      return;
    }
    const version = planCodeVersion(text);
    if (version === null) {
      setFriendPlan([]);
      setCompareError(`That doesn't look like an UltraCC plan code. Copy the whole code — it should start with “${PLAN_PREFIX}”.`);
      return;
    }
    if (version !== 'v1') {
      setFriendPlan([]);
      setCompareError('That plan code is from a different version of UltraCC and can\'t be read here. Ask your friend to share it again.');
      return;
    }
    let entries: PlanEntry[];
    try {
      entries = decodePlan(text);
    } catch {
      setFriendPlan([]);
      setCompareError('Couldn\'t read that plan code. Please try again.');
      return;
    }
    if (entries.length === 0) {
      setFriendPlan([]);
      setCompareError('That code contains no readable sections. Ask your friend to share their plan again.');
      return;
    }
    setCompareError(null);
    setFriendPlan(entries.map((e) => fromShareEntry(e)));
  };

  const comparison = useMemo(() => {
    return friendPlan.map((f) => {
      // Overlap the friend's section against (a) my plan sections via the engine and (b) my registered meetings directly.
      const planHit = clashingSectionIds([...plan, f]).has(f.id);
      let regHit = false;
      for (const m of expandSlotString(f.slot)) {
        if (registeredMeetings.some((r) => r.day === m.day && r.start < m.end && m.start < r.end)) { regHit = true; break; }
      }
      const sameAsPlan = plan.some((p) => p.code === f.code && p.slot === f.slot);
      return { entry: f, hitsMine: planHit || regHit, sameAsPlan };
    });
  }, [friendPlan, plan, registeredMeetings]);

  const exportPlan = () => {
    exportFfcsPlanImage(
      plan.map((p) => ({ code: p.code, title: p.title, slot: p.slot, type: p.type, venue: p.venue, faculty: p.faculty, credits: p.credits || null, clashes: planClashIds.has(p.id) })),
      { creditsTotal: plannedCredits, context: FFCS_DATA_SEMESTER },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">FFCS Planner</h2>
          <p className="text-sm text-zinc-500 font-medium mt-1">
            Build registration plans from the course inventory — clashes highlight as you pick
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowShare((s) => !s)} className="ffcs-tool-btn"><Share2 className="h-4 w-4" /> Share</button>
          <button onClick={() => setShowCompare((s) => !s)} className="ffcs-tool-btn"><Users className="h-4 w-4" /> Compare with Friend</button>
          <button onClick={exportPlan} disabled={!plan.length} className="ffcs-tool-btn disabled:opacity-40 disabled:cursor-not-allowed"><Download className="h-4 w-4" /> Export PNG</button>
        </div>
      </div>

      <div className="ffcs-data-note">
        <Info className="h-4 w-4" />
        <span>
          <strong>Course inventory:</strong> {FFCS_DATA_SEMESTER} Chennai course catalogue snapshot. Not a live VTOP feed: sections, faculty and venues reflect that snapshot, and seat availability is not known. Your registered timetable (synced from VTOP) stays authoritative.
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Registered sessions" value={String(real.length)} icon={Table2} color="text-blue-600" />
        <Stat label="Planned sections" value={String(plan.length)} icon={Calendar} color="text-violet-600" />
        <Stat label="Planned credits" value={plannedCredits ? String(plannedCredits) : '—'} icon={CheckCircle2} color="text-emerald-600" />
        <Stat label="Clashes" value={planClashIds.size ? String(planClashIds.size) : '0'} icon={AlertTriangle} color={planClashIds.size ? 'text-rose-600' : 'text-emerald-600'} />
      </div>

      {/* Saved tables */}
      {tables.length > 0 && (
        <div className="ffcs-panel">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-zinc-500" />
            <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Your plans</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tables.map((t) => (
              <div key={t.id} className={`ffcs-table-chip ${t.id === activeId ? 'active' : ''}`}>
                <button className="ffcs-table-chip-name" onClick={() => setActiveId(t.id)} title="Switch to this plan">{t.name}</button>
                <span className="ffcs-table-chip-count">{t.sections.length}</span>
                <button className="ffcs-table-chip-action" onClick={() => renameTable(t.id)} aria-label={`Rename ${t.name}`}>✎</button>
                <button className="ffcs-table-chip-action" onClick={() => deleteTable(t.id)} aria-label={`Delete ${t.name}`}>✕</button>
              </div>
            ))}
            <button onClick={createTable} className="ffcs-table-add"><Plus className="h-3.5 w-3.5" /> New plan</button>
          </div>
        </div>
      )}

      {/* Share / compare panels */}
      {showShare && (
        <div className="ffcs-panel">
          <h3 className="text-sm font-bold text-zinc-900 mb-3">Share this plan</h3>
          <p className="text-[11px] text-zinc-500 mb-3">Copy this code and send it to a friend — they can paste it under “Compare with Friend”.</p>
          <div className="flex items-start gap-3">
            <textarea readOnly aria-label="Your FFCS plan share code" value={shareText} rows={6} className="flex-1 px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-[11px] font-mono text-zinc-900 outline-none resize-y" />
            <button onClick={() => void copyShare()} className="px-4 py-2 rounded-xl acc-bg text-zinc-900 text-xs font-bold acc-glow hover:opacity-90 transition cursor-pointer flex items-center gap-1.5">
              <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {showCompare && (
        <div className="ffcs-panel">
          <h3 className="text-sm font-bold text-zinc-900 mb-3">Compare with a friend</h3>
          <textarea
            aria-label="Friend's FFCS plan code"
            value={friendText}
            onChange={(e) => { setFriendText(e.target.value); setCompareError(null); }}
            rows={5}
            placeholder={`Paste their plan code here (starts with ${PLAN_PREFIX})…`}
            className="w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-[11px] font-mono text-zinc-900 outline-none focus:border-blue-500/60 transition resize-y"
          />
          <div className="mt-3 flex items-center gap-3">
            <button onClick={runCompare} className="px-4 py-2 rounded-xl acc-bg text-zinc-900 text-xs font-bold acc-glow hover:opacity-90 transition cursor-pointer">Compare</button>
            {compareError && (
              <span className="text-[11px] text-rose-600">{compareError}</span>
            )}
          </div>
          {comparison.length > 0 && (
            <div className="mt-5 space-y-2">
              <p className="text-[11px] text-zinc-500">{comparison.length} section{comparison.length > 1 ? 's' : ''} in your friend's plan:</p>
              {comparison.map((c) => (
                <div key={c.entry.id} className="flex items-center gap-3 p-3 bg-zinc-50 border border-zinc-200 rounded-xl text-xs">
                  <span className="font-mono font-bold text-zinc-900 shrink-0">{c.entry.code}</span>
                  <span className="text-zinc-500 truncate flex-1">{c.entry.title}</span>
                  <span className="text-zinc-500 shrink-0 font-mono">{c.entry.slot}</span>
                  {c.sameAsPlan ? (
                    <span className="inline-flex items-center gap-1 text-zinc-600 shrink-0"><Layers className="h-3.5 w-3.5" /> Also in your plan</span>
                  ) : c.hitsMine ? (
                    <span className="inline-flex items-center gap-1 text-rose-600 shrink-0"><AlertTriangle className="h-3.5 w-3.5" /> Clashes with your schedule</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-emerald-600 shrink-0"><CheckCircle2 className="h-3.5 w-3.5" /> No clash</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Course picker */}
      <div className="ffcs-panel">
        <h3 className="text-base font-bold text-zinc-900 mb-1">Add a course</h3>
        <p className="text-[11px] text-zinc-500 mb-4">Search the inventory, then pick one of its offered sections (slot + faculty + venue).</p>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPickedCode(null); }}
            placeholder="Course code or title — e.g. BEEE or Analog Electronics"
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder-zinc-500 outline-none focus:border-blue-500/60 transition"
            aria-label="Search courses"
          />
        </div>

        {query.trim() && !pickedCode && (
          <div className="mt-2 border border-zinc-200 rounded-xl divide-y divide-zinc-100 max-h-64 overflow-y-auto">
            {suggestions.length === 0 && <p className="px-3 py-3 text-xs text-zinc-500">No course in the inventory matches “{query.trim()}”.</p>}
            {suggestions.map((o) => (
              <button key={o.code} onClick={() => { setPickedCode(o.code); setQuery(`${o.code} — ${o.title}`); }} className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 transition cursor-pointer flex items-center gap-3">
                <span className="font-mono font-bold text-xs text-zinc-900 shrink-0">{o.code}</span>
                <span className="text-xs text-zinc-900 truncate flex-1">{o.title}</span>
                <span className="text-[10px] text-zinc-500 shrink-0">{o.sectionCount} section{o.sectionCount > 1 ? 's' : ''}</span>
              </button>
            ))}
          </div>
        )}

        {pickedCode && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Offered sections for {pickedCode}</p>
              <button onClick={() => { setPickedCode(null); setQuery(''); }} className="text-[11px] text-zinc-500 hover:text-zinc-900 cursor-pointer">clear</button>
            </div>
            {pickedSections.length === 0 && <p className="text-xs text-zinc-500 py-2">No sections of this course are in the snapshot.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {pickedSections.map((s, i) => {
                const candidate = toPlanSection(s);
                const blocked = candidateConflicts(candidate).length > 0;
                const meetings = expandSlotString(s.slot);
                return (
                  <button
                    key={`${s.code}-${s.slot}-${i}`}
                    onClick={() => addSection(s)}
                    className={`text-left p-3 rounded-xl border transition cursor-pointer ${blocked ? 'ffcs-section-tile blocked' : 'ffcs-section-tile'}`}
                    title={blocked ? 'Overlaps your registered timetable or plan' : 'Add to plan'}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-sm text-zinc-900">{s.slot}</span>
                      <span className="text-[10px] font-bold text-zinc-500">{s.type}</span>
                    </div>
                    <p className="text-[11px] text-zinc-900 mt-1 truncate">{s.faculty || 'Faculty not in snapshot'}</p>
                    <p className="text-[10px] text-zinc-500 truncate">{s.venue || 'Venue not in snapshot'} · {s.credits} cr</p>
                    <p className="text-[10px] text-zinc-500 mt-1 flex items-center gap-1"><Clock3 className="h-3 w-3" /> {meetings.map((m) => `${DAY_SHORT[m.day] || m.day} ${m.start}`).join(', ') || 'Times not in slot grid'}</p>
                    {blocked && <p className="text-[10px] text-rose-600 font-bold mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> time conflict</p>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Week grid */}
      <div className="ffcs-panel">
        <div className="flex items-center space-x-3 mb-5">
          <div className="p-2 bg-violet-500/10 border border-violet-500/20 rounded-xl text-violet-600"><Calendar className="h-5 w-5" /></div>
          <div>
            <h3 className="text-base font-bold text-zinc-900">Week grid{activeTable ? ` — ${activeTable.name}` : ''}</h3>
            <p className="text-[11px] text-zinc-500">
              <span className="text-blue-600">■</span> registered &nbsp;·&nbsp; <span className="text-violet-600">■</span> planned &nbsp;·&nbsp; <span className="text-rose-600">■</span> clash
            </p>
          </div>
        </div>

        {!plan.length && !real.length ? (
          <p className="text-sm text-zinc-500 py-6 text-center">Nothing to show yet — search a course above, or sync your VTOP timetable to see your registered sessions.</p>
        ) : (
          <div className="overflow-x-auto pb-2">
            <table className="ffcs-grid" role="grid" aria-label="Planned week grid">
              <thead>
                <tr>
                  <th scope="col" className="ffcs-grid-time">Time</th>
                  {DAY_ORDER.map((d) => <th scope="col" key={d} className="ffcs-grid-day">{DAY_SHORT[d]}</th>)}
                </tr>
              </thead>
              <tbody>
                {gridTimes.map((start) => {
                  const rowHasClash = DAY_ORDER.some((d) => cellAt(d, start).length > 1);
                  return (
                    <tr key={start} className={rowHasClash ? 'ffcs-row-clash' : ''}>
                      <td className="ffcs-grid-time">{start}</td>
                      {DAY_ORDER.map((d) => {
                        const items = cellAt(d, start);
                        const meeting = items[0];
                        const isClash = items.length > 1 || items.some((it) => it.kind === 'plan' && planClashIds.has(it.sectionId));
                        return (
                          <td key={d} className={`ffcs-grid-cell ${isClash ? 'clash' : meeting ? (meeting.kind === 'registered' ? 'registered' : 'planned') : ''}`}>
                            {items.slice(0, 2).map((it, idx) => (
                              <div key={`${it.sectionId}-${idx}`} className="ffcs-grid-entry" title={it.slotToken || undefined}>
                                <span className="ffcs-grid-code">{it.code}</span>
                                {it.venue && <span className="ffcs-grid-venue">{it.venue}</span>}
                              </div>
                            ))}
                            {items.length > 2 && <div className="ffcs-grid-more">+{items.length - 2} more</div>}
                            {items.length === 1 && meeting && <div className="ffcs-grid-end">till {meeting.end}</div>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Plan list */}
      {plan.length > 0 && (
        <div className="ffcs-panel">
          <p className="text-[11px] text-zinc-500 font-bold uppercase tracking-wide mb-3">Planned sections — {activeTable?.name || 'Plan'}</p>
          <div className="space-y-2">
            {plan.map((p) => (
              <div key={p.id} className={`flex items-center gap-3 p-2.5 border rounded-xl text-xs ${planClashIds.has(p.id) ? 'bg-rose-500/5 border-rose-500/30' : 'bg-zinc-50 border-zinc-200'}`}>
                <span className="font-mono font-bold text-zinc-900">{p.code}</span>
                <span className="text-zinc-900 truncate flex-1">{p.title}</span>
                <span className="font-mono text-zinc-600">{p.slot}</span>
                <span className="text-zinc-500 hidden sm:inline">{p.type}{p.credits ? ` · ${p.credits} cr` : ''}{p.venue ? ` · ${p.venue}` : ''}</span>
                {planClashIds.has(p.id) && <span className="inline-flex items-center gap-1 text-rose-600 font-bold shrink-0"><AlertTriangle className="h-3.5 w-3.5" /> clash</span>}
                <button onClick={() => removeSection(p.id)} className="p-1.5 rounded-lg text-zinc-600 hover:text-rose-600 hover:bg-rose-500/10 transition cursor-pointer" aria-label={`Remove ${p.code} ${p.slot}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function Stat({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4 flex items-center gap-3">
      <div className={`p-2 rounded-xl bg-white border border-zinc-200 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xl font-extrabold text-zinc-900 leading-none">{value}</p>
        <p className="text-[10px] text-zinc-500 font-medium mt-1">{label}</p>
      </div>
    </div>
  );
}
