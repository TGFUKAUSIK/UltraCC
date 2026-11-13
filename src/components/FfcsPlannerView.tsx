import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Copy, Download, Info, Layers, Pencil, Plus, Search, Share2, Trash2, Users, X } from 'lucide-react';
import {
  FFCS_DATA_SEMESTER, clashingSectionIds, expandSlotString, ffcsSectionsFor, planCredits,
  searchFfcsCourses, type FfcsSection, type PlanSection,
} from '../lib/ffcsPlanner';
import { PLAN_PREFIX, decodePlan, encodePlan, nextPlanId, planCodeVersion, type PlanEntry } from '../lib/ffcsShare';
import { showToast } from '../lib/toast';
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

  /**
   * Renaming happens in the chip itself. It used to be a `window.prompt`,
   * which iOS answers with null in a home-screen PWA — so on an iPhone the ✎
   * did nothing at all, and the plan name stayed "Plan 3" forever.
   */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const startRename = (id: string) => {
    setRenamingId(id);
    setRenameDraft(tables.find((t) => t.id === id)?.name || '');
  };

  const commitRename = () => {
    const name = renameDraft.trim().slice(0, 40);
    if (name && renamingId) setTables((ts) => ts.map((t) => (t.id === renamingId ? { ...t, name } : t)));
    setRenamingId(null);
  };
  const deleteTable = (id: string) => {
    const name = tables.find((t) => t.id === id)?.name || 'Plan';
    setTables((ts) => {
      const next = ts.filter((t) => t.id !== id);
      if (activeId === id) setActiveId(next[0]?.id || '');
      return next;
    });
    if (renamingId === id) setRenamingId(null);
    showToast({ title: 'Plan deleted', message: `“${name}” is gone. Re-syncing does not bring it back.`, type: 'info' });
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
      showToast({
        title: 'Time clash',
        message: `${candidate.code} (${candidate.slot}) runs at the same time as ${conflicts[0]}. Remove that one, or pick a different section.`,
        type: 'warning',
        duration: 7000,
      });
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
    <div className="uc-ffcs pb-12 min-w-0">
      {/* Masthead: what this is, the three controls, and the four counters. */}
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">FFCS Planner</span>
            <h2 className="uc-dir-name">Build your semester</h2>
            <p className="uc-note">Search the course inventory, pick a section, and clashes light up as you go.</p>
          </div>
        </div>

        <div className="uc-ffcs-bar">
          <button
            type="button"
            onClick={() => setShowShare((s) => !s)}
            aria-expanded={showShare}
            className={`uc-ffcs-act ${showShare ? 'is-on' : ''}`}
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden="true" /> Share
          </button>
          <button
            type="button"
            onClick={() => setShowCompare((s) => !s)}
            aria-expanded={showCompare}
            className={`uc-ffcs-act ${showCompare ? 'is-on' : ''}`}
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" /> Compare with a friend
          </button>
          <button type="button" onClick={exportPlan} disabled={!plan.length} className="uc-ffcs-act">
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export PNG
          </button>
        </div>

        <div className="uc-ffcs-metrics">
          <div className="uc-ffcs-metric"><span>Registered</span><b>{real.length}</b></div>
          <div className="uc-ffcs-metric"><span>Planned</span><b>{plan.length}</b></div>
          <div className="uc-ffcs-metric"><span>Credits</span><b>{plannedCredits || '—'}</b></div>
          <div className={`uc-ffcs-metric ${planClashIds.size ? 'is-risk' : ''}`}><span>Clashes</span><b>{planClashIds.size || 0}</b></div>
        </div>
      </section>

      <p className="uc-note-row">
        <Info className="h-4 w-4" aria-hidden="true" />
        <span>
          <b>Course inventory.</b> {FFCS_DATA_SEMESTER} Chennai catalogue snapshot — sections, faculty and
          venues come from that snapshot rather than a live VTOP feed, so seat availability is unknown.
          Your registered timetable (synced from VTOP) stays authoritative.
        </span>
      </p>

      {/* Saved plan tables */}
      {tables.length > 0 && (
        <section className="uc-plate">
          <div className="uc-plate-head">
            <span className="uc-cap">Your plans</span>
            <button type="button" onClick={createTable} className="uc-ffcs-add">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New plan
            </button>
          </div>
          <div className="uc-ffcs-chips">
            {tables.map((t) => (
              <div key={t.id} className={`uc-ffcs-chip ${t.id === activeId ? 'is-on' : ''}`}>
                {renamingId === t.id ? (
                  <input
                    autoFocus
                    className="uc-ffcs-chip-input"
                    value={renameDraft}
                    maxLength={40}
                    aria-label={`New name for ${t.name}`}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <button type="button" className="uc-ffcs-chip-name" onClick={() => setActiveId(t.id)} title="Switch to this plan">{t.name}</button>
                )}
                <span className="uc-ffcs-chip-count uc-num">{t.sections.length}</span>
                <button type="button" className="uc-ffcs-chip-act uc-ffcs-chip-act--edit" onClick={() => startRename(t.id)} aria-label={`Rename ${t.name}`}>
                  <Pencil className="h-3 w-3" aria-hidden="true" />
                </button>
                <button type="button" className="uc-ffcs-chip-act uc-ffcs-chip-act--del" onClick={() => deleteTable(t.id)} aria-label={`Delete ${t.name}`}>
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Share */}
      {showShare && (
        <section className="uc-plate">
          <div className="uc-plate-head">
            <div>
              <span className="uc-cap">Share</span>
              <h3 className="uc-ffcs-h3">Send this plan</h3>
              <p className="uc-note">Copy the code and send it to a friend — they paste it under “Compare with a friend”.</p>
            </div>
          </div>
          <div className="uc-ffcs-pick">
            <div className="uc-ffcs-copy">
              <textarea readOnly aria-label="Your FFCS plan share code" value={shareText} rows={6} className="uc-dir-input uc-dir-input--area" />
              <button type="button" onClick={() => void copyShare()} className="uc-dir-go acc-bg">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copied ? 'Copied' : 'Copy code'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Compare */}
      {showCompare && (
        <section className="uc-plate">
          <div className="uc-plate-head">
            <div>
              <span className="uc-cap">Compare</span>
              <h3 className="uc-ffcs-h3">Compare with a friend</h3>
              <p className="uc-note">Paste their plan code to see which of their sections clash with your schedule.</p>
            </div>
          </div>
          <div className="uc-ffcs-pick">
            <textarea
              aria-label="Friend's FFCS plan code"
              value={friendText}
              onChange={(e) => { setFriendText(e.target.value); setCompareError(null); }}
              rows={5}
              placeholder={`Paste their plan code here (starts with ${PLAN_PREFIX})…`}
              className="uc-dir-input uc-dir-input--area"
            />
            <div className="uc-ffcs-ends">
              <button type="button" onClick={runCompare} className="uc-dir-go acc-bg">Compare</button>
              {compareError && <span className="uc-ffcs-error" role="status">{compareError}</span>}
            </div>
            {comparison.length > 0 && (
              <div className="uc-ffcs-cmpwrap">
                <span className="uc-cap">
                  {comparison.length} section{comparison.length > 1 ? 's' : ''} in their plan
                </span>
                <div className="uc-ffcs-cmps">
                  {comparison.map((c) => (
                    <div key={c.entry.id} className="uc-ffcs-cmp">
                      <span className="uc-ffcs-cmp-code uc-num">{c.entry.code}</span>
                      <span className="uc-ffcs-cmp-title">{c.entry.title}</span>
                      <span className="uc-ffcs-cmp-slot uc-num">{c.entry.slot}</span>
                      {c.sameAsPlan ? (
                        <span className="uc-ffcs-cmp-state is-same"><Layers className="h-3 w-3" aria-hidden="true" /> Also in your plan</span>
                      ) : c.hitsMine ? (
                        <span className="uc-ffcs-cmp-state is-bad"><AlertTriangle className="h-3 w-3" aria-hidden="true" /> Clashes with your schedule</span>
                      ) : (
                        <span className="uc-ffcs-cmp-state is-ok"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> No clash</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Course picker */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <div>
            <span className="uc-cap">Course inventory</span>
            <h3 className="uc-ffcs-h3">Add a course</h3>
            <p className="uc-note">Search the snapshot, then pick one of its offered sections — slot, faculty and venue.</p>
          </div>
        </div>

        <div className="uc-ffcs-pick">
          <div className="uc-dir-search">
            <Search className="h-4 w-4" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPickedCode(null); }}
              placeholder="Course code or title — e.g. BEEE or Analog Electronics"
              aria-label="Search courses"
            />
          </div>
        </div>

        {query.trim() && !pickedCode && (
          <div className="uc-ffcs-suggest">
            {suggestions.length === 0 && (
              <p className="uc-ffcs-sug-none">No course in the inventory matches “{query.trim()}”.</p>
            )}
            {suggestions.map((o) => (
              <button
                type="button"
                key={o.code}
                onClick={() => { setPickedCode(o.code); setQuery(`${o.code} — ${o.title}`); }}
                className="uc-ffcs-sug"
              >
                <span className="uc-ffcs-sug-code uc-num">{o.code}</span>
                <span className="uc-ffcs-sug-title">{o.title}</span>
                <span className="uc-ffcs-sug-n">{o.sectionCount} section{o.sectionCount > 1 ? 's' : ''}</span>
              </button>
            ))}
          </div>
        )}

        {pickedCode && (
          <>
            <div className="uc-ffcs-secthead">
              <span className="uc-cap">Offered sections for {pickedCode}</span>
              <button type="button" onClick={() => { setPickedCode(null); setQuery(''); }} className="uc-ffcs-clear">clear</button>
            </div>
            {pickedSections.length === 0 && (
              <p className="uc-ffcs-none">No sections of this course are in the snapshot.</p>
            )}
            <div className="uc-ffcs-tiles">
              {pickedSections.map((s, i) => {
                const candidate = toPlanSection(s);
                const blocked = candidateConflicts(candidate).length > 0;
                const meetings = expandSlotString(s.slot);
                return (
                  <button
                    type="button"
                    key={`${s.code}-${s.slot}-${i}`}
                    onClick={() => addSection(s)}
                    className={`uc-ffcs-tile ${blocked ? 'is-blocked' : ''}`}
                    title={blocked ? 'Overlaps your registered timetable or plan' : 'Add to plan'}
                  >
                    <span className="uc-ffcs-tile-head">
                      <span className="uc-ffcs-tile-slot uc-num">{s.slot}</span>
                      <span className="uc-ffcs-tile-type">{s.type}</span>
                    </span>
                    <span className="uc-ffcs-tile-line">{s.faculty || 'Faculty not in snapshot'}</span>
                    <span className="uc-ffcs-tile-meta">{s.venue || 'Venue not in snapshot'} · {s.credits} cr</span>
                    <span className="uc-ffcs-tile-when">
                      <Clock3 className="h-3 w-3" aria-hidden="true" />
                      {meetings.map((m) => `${DAY_SHORT[m.day] || m.day} ${m.start}`).join(', ') || 'Times not in slot grid'}
                    </span>
                    {blocked && (
                      <span className="uc-ffcs-tile-bad">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" /> time conflict
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Week grid */}
      <section className="uc-plate">
        <div className="uc-plate-head uc-ffcs-head">
          <div>
            <span className="uc-cap">Week grid</span>
            <h3 className="uc-ffcs-h3">{activeTable ? activeTable.name : 'No plan selected'}</h3>
          </div>
          <span className="uc-ffcs-legend">
            <span><i className="is-reg" aria-hidden="true" /> registered</span>
            <span><i className="is-plan" aria-hidden="true" /> planned</span>
            <span><i className="is-clash" aria-hidden="true" /> clash</span>
          </span>
        </div>

        {!plan.length && !real.length ? (
          <p className="uc-ffcs-blank">Nothing to show yet — search a course above, or sync your VTOP timetable to see your registered sessions.</p>
        ) : (
          <div className="uc-ffcs-gridwrap">
            <table className="uc-ffcs-grid" role="grid" aria-label="Planned week grid">
              <thead>
                <tr>
                  <th scope="col" className="uc-ffcs-t">Time</th>
                  {DAY_ORDER.map((d) => <th scope="col" key={d}>{DAY_SHORT[d]}</th>)}
                </tr>
              </thead>
              <tbody>
                {gridTimes.map((start) => {
                  const rowHasClash = DAY_ORDER.some((d) => cellAt(d, start).length > 1);
                  return (
                    <tr key={start} className={rowHasClash ? 'uc-ffcs-row-clash' : ''}>
                      <td className="uc-ffcs-t">{start}</td>
                      {DAY_ORDER.map((d) => {
                        const items = cellAt(d, start);
                        const meeting = items[0];
                        const isClash = items.length > 1 || items.some((it) => it.kind === 'plan' && planClashIds.has(it.sectionId));
                        const kind = isClash ? 'is-clash' : meeting ? (meeting.kind === 'registered' ? 'is-reg' : 'is-plan') : '';
                        return (
                          <td key={d} className={`uc-ffcs-cell ${kind}`}>
                            {items.slice(0, 2).map((it, idx) => (
                              <span key={`${it.sectionId}-${idx}`} className="uc-ffcs-entry" title={it.slotToken || undefined}>
                                <span className="uc-ffcs-code uc-num">{it.code}</span>
                                {it.venue && <span className="uc-ffcs-venue">{it.venue}</span>}
                              </span>
                            ))}
                            {items.length > 2 && <span className="uc-ffcs-more">+{items.length - 2} more</span>}
                            {items.length === 1 && meeting && <span className="uc-ffcs-end">till {meeting.end}</span>}
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
      </section>

      {/* Planned sections */}
      {plan.length > 0 && (
        <section className="uc-plate">
          <div className="uc-plate-head">
            <span className="uc-cap">Planned sections — {activeTable?.name || 'Plan'}</span>
            <span className="uc-num uc-ffcs-count">{plan.length}</span>
          </div>
          <div className="uc-ffcs-plans">
            {plan.map((p) => (
              <article key={p.id} className={`uc-ffcs-plan ${planClashIds.has(p.id) ? 'is-clash' : ''}`}>
                <div className="uc-ffcs-plan-main">
                  <b className="uc-ffcs-plan-code uc-num">{p.code}</b>
                  <span className="uc-ffcs-plan-title">{p.title}</span>
                  <span className="uc-ffcs-plan-slot uc-num">{p.slot}</span>
                  {planClashIds.has(p.id) && (
                    <span className="uc-ffcs-plan-clash"><AlertTriangle className="h-3 w-3" aria-hidden="true" /> clash</span>
                  )}
                  <span className="uc-ffcs-plan-meta">{p.type}{p.credits ? ` · ${p.credits} cr` : ''}{p.venue ? ` · ${p.venue}` : ''}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeSection(p.id)}
                  className="uc-ffcs-remove"
                  aria-label={`Remove ${p.code} ${p.slot}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
