import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Clock3, Filter, MapPin, Network, Plus, Printer, Search, Share2, Users, X } from 'lucide-react';
import { createStudyGroup, fetchStudyGroups, hashCampusCapabilityToken, joinStudyGroup, leaveStudyGroup, newCampusCapabilityToken, StudyGroup } from '../lib/supabaseCampus';
import { humanErrorCopy } from '../lib/errorCopy';

// "Labs & spaces" was removed: it derived a room list from the student's own
// timetable, which can never prove a room is free for anyone else. Rooms & Labs
// (the free-classroom engine over the FFCS grid) is the honest source for that.
// "Wi-Fi spots" was removed too: UltraCC has no authoritative campus Wi-Fi
// data, and the UI must never imply a hotspot exists when it cannot be proven.
type UtilityKind = 'printing' | 'groups';

/** The Facilities tabs, in display order. Exported for tests: this list is what
 *  the screen offers, and it must never offer a source UltraCC cannot back. */
export const campusUtilityTabs: { id: UtilityKind; label: string }[] = [
  { id: 'printing', label: 'Print & scan' },
  { id: 'groups', label: 'Study groups' },
];

const UTILITY_ICONS: Record<UtilityKind, React.ComponentType<{ className?: string }>> = { printing: Printer, groups: Users };

const VERIFIED_PRINTING: { name: string; service: string; building: string; floor: string; hours?: string; source: string }[] = [
  { name: 'Print / photocopy point', service: 'Print, photocopy and scan services reported by students', building: 'AB1', floor: 'Ground floor', source: 'USER-PROVIDED REFERENCE' },
  { name: 'Print / photocopy point', service: 'Print, photocopy and scan services reported by students', building: 'AB1', floor: '6th floor', source: 'USER-PROVIDED REFERENCE' },
  { name: 'Print / photocopy point', service: 'Print, photocopy and scan services reported by students', building: 'AB2', floor: 'Basement', source: 'USER-PROVIDED REFERENCE' },
];

function sourceBadge(label: string) {
  return <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</span>;
}

export const CampusUtilitiesView: React.FC<{ onOpenMap: (query?: string) => void; onOpenRooms?: () => void }> = ({ onOpenMap, onOpenRooms }) => {
  const [kind, setKind] = useState<UtilityKind>('printing');
  const [query, setQuery] = useState('');
  const [building, setBuilding] = useState('All');
  const [floor, setFloor] = useState('All');
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupError, setGroupError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const [memberName, setMemberName] = useState('');
  const [groupForm, setGroupForm] = useState({ course: '', assessment: '', topic: '', meeting_time: '', location: '', group_size: '4', display_name: '' });

  const loadGroups = async () => {
    setLoadingGroups(true); setGroupError('');
    try { setGroups(await fetchStudyGroups()); } catch (error) { setGroupError(humanErrorCopy(error, 'Study groups are unavailable')); }
    finally { setLoadingGroups(false); }
  };
  useEffect(() => { if (kind === 'groups') void loadGroups(); }, [kind]);

  const staticRows = VERIFIED_PRINTING;
  const buildings = useMemo(() => ['All', ...Array.from(new Set(staticRows.map((row) => row.building).filter(Boolean))).sort()], [staticRows]);
  const floors = useMemo(() => ['All', ...Array.from(new Set(staticRows.map((row) => row.floor).filter(Boolean))).sort()], [staticRows]);
  const filteredRows = useMemo(() => staticRows.filter((row) => {
    const text = JSON.stringify(row).toLowerCase();
    return (!query.trim() || text.includes(query.toLowerCase())) && (building === 'All' || row.building === building) && (floor === 'All' || row.floor === floor);
  }), [staticRows, query, building, floor]);
  const filteredGroups = useMemo(() => groups.filter((group) => !query.trim() || JSON.stringify(group).toLowerCase().includes(query.toLowerCase())), [groups, query]);

  const updateForm = (key: keyof typeof groupForm, value: string) => setGroupForm((current) => ({ ...current, [key]: value }));
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setNotice('');
    try {
      const token = newCampusCapabilityToken();
      localStorage.setItem('ultracc:study-group-owner-token', token);
      await createStudyGroup({ ...groupForm, group_size: Math.max(1, Math.min(50, Number(groupForm.group_size) || 1)), display_name: groupForm.display_name.trim() || 'Anonymous', owner_token_hash: await hashCampusCapabilityToken(token) });
      setShowCreate(false); setGroupForm({ course: '', assessment: '', topic: '', meeting_time: '', location: '', group_size: '4', display_name: '' }); setNotice('Study group created.'); await loadGroups();
    } catch (error) { setGroupError(humanErrorCopy(error, 'Could not create the study group')); }
  };
  const join = async (group: StudyGroup) => {
    const token = localStorage.getItem('ultracc:study-group-member-token') || newCampusCapabilityToken();
    localStorage.setItem('ultracc:study-group-member-token', token);
    try { if (await joinStudyGroup(group.id, memberName.trim() || 'Anonymous', token)) { setNotice(`Joined ${group.course}.`); setMemberName(''); await loadGroups(); } else setNotice('That group is full or you are already a member.'); }
    catch (error) { setGroupError(humanErrorCopy(error, 'Could not join the study group')); }
  };
  const leave = async (group: StudyGroup) => { const token = localStorage.getItem('ultracc:study-group-member-token'); if (!token) return; try { await leaveStudyGroup(group.id, token); setNotice(`Left ${group.course}.`); await loadGroups(); } catch (error) { setGroupError(humanErrorCopy(error, 'Could not leave the study group')); } };
  const share = async (group: StudyGroup) => { const text = `${group.course}${group.assessment ? ` · ${group.assessment}` : ''} study group${group.topic ? ` — ${group.topic}` : ''}`; try { await navigator.clipboard.writeText(text); setNotice('Group details copied to clipboard.'); } catch { setNotice(text); } };

  return <div className="campus-utilities-view space-y-5 pb-12">
    <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-xl sm:p-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-[10px] font-extrabold uppercase tracking-widest text-amber-600">Campus facilities</p><h2 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">Campus services you can rely on</h2><p className="mt-1 max-w-2xl text-sm text-zinc-500">Verified print references, plus opt-in student study groups. Details are only shown when a source backs them.</p></div>
        <div className="flex flex-wrap gap-2">{onOpenRooms && <button onClick={onOpenRooms} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 px-4 py-2.5 text-xs font-extrabold text-amber-700 hover:bg-amber-500/10"><Clock3 className="h-4 w-4" /> Find a free room or lab</button>}<button onClick={() => onOpenMap(query)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-extrabold text-zinc-950 hover:bg-amber-400"><MapPin className="h-4 w-4" /> Open official campus map</button></div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {campusUtilityTabs.map(({ id, label }) => { const Icon = UTILITY_ICONS[id]; return <button key={id} onClick={() => { setKind(id); setQuery(''); setBuilding('All'); setFloor('All'); }} className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-xs font-bold ${kind === id ? 'border-amber-400 bg-amber-500/15 text-amber-700' : 'border-zinc-200 bg-zinc-50 text-zinc-500 hover:text-zinc-900'}`}><Icon className="h-4 w-4" />{label}</button>; })}
      </div>
    </div>

    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" /><input aria-label={kind === 'groups' ? 'Search study groups' : 'Search campus facilities'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === 'groups' ? 'Search course, CAT/FAT, topic or location' : 'Search by name, building or service'} className="w-full rounded-xl border border-zinc-200 bg-white py-3 pl-9 pr-3 text-sm text-zinc-900 outline-none focus:border-amber-500" /></div>
      {kind !== 'groups' && <><div className="relative"><Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" /><select aria-label="Filter by building" value={building} onChange={(event) => setBuilding(event.target.value)} className="w-full appearance-none rounded-xl border border-zinc-200 bg-white py-3 pl-9 pr-8 text-sm text-zinc-900 outline-none sm:w-48"><option value="All">All buildings</option>{buildings.slice(1).map((value) => <option key={value}>{value}</option>)}</select></div><select aria-label="Filter by floor" value={floor} onChange={(event) => setFloor(event.target.value)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none sm:w-36"><option value="All">All floors</option>{floors.slice(1).map((value) => <option key={value}>{value}</option>)}</select></>}
      {kind === 'groups' && <button onClick={() => setShowCreate(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-extrabold text-zinc-900 hover:bg-emerald-500"><Plus className="h-4 w-4" /> Create group</button>}
    </div>

    {notice && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-700">{notice}</div>}
    {kind !== 'groups' ? <>
      <div className="flex items-center justify-between gap-3">{sourceBadge('STATIC / VERIFIED ONLY')}<span className="text-xs text-zinc-500">{filteredRows.length} entries</span></div>
      {filteredRows.length === 0 ? <EmptyUtility onOpenMap={onOpenMap} /> : <div className="grid gap-3 md:grid-cols-2">{filteredRows.map((row) => <div key={JSON.stringify(row)} className="rounded-2xl border border-zinc-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-zinc-900">{row.name}</h3><p className="mt-1 text-xs text-zinc-500">{row.building} · {row.floor}</p></div></div><p className="mt-3 text-xs text-zinc-500">{('service' in row && row.service) || 'Campus reference details unavailable'}</p>{'source' in row && <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-zinc-600">{row.source}</p>}<button onClick={() => onOpenMap(`${row.building} ${row.floor}`)} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:underline"><MapPin className="h-3.5 w-3.5" /> Find on map</button></div>)}</div>}
    </> : <>
      <div className="flex items-center justify-between gap-3">{sourceBadge('USER-GENERATED · OPT-IN')}<span className="text-xs text-zinc-500">{loadingGroups ? 'Loading…' : `${filteredGroups.length} groups`}</span></div>
      {groupError && <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-700">{groupError}</div>}
      {filteredGroups.length === 0 && !loadingGroups ? <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center"><Users className="mx-auto h-9 w-9 text-zinc-600" /><p className="mt-3 text-sm font-bold text-zinc-900">No study groups found</p><p className="mt-1 text-xs text-zinc-500">Create one with only the details you choose to share.</p></div> : <div className="grid gap-3 md:grid-cols-2">{filteredGroups.map((group) => <div key={group.id} className="rounded-2xl border border-zinc-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-extrabold text-zinc-900">{group.course}</h3><p className="mt-1 text-xs text-zinc-500">{group.assessment || 'General study'}{group.topic ? ` · ${group.topic}` : ''}</p></div><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-700">{group.member_count}/{group.group_size}</span></div><div className="mt-3 grid gap-2 text-xs text-zinc-500"><span><Clock3 className="mr-1 inline h-3.5 w-3.5" />{group.meeting_time || 'Time not specified'}</span><span><MapPin className="mr-1 inline h-3.5 w-3.5" />{group.location || 'Location not specified'}</span><span><Users className="mr-1 inline h-3.5 w-3.5" />Organized by {group.display_name || 'Anonymous'}</span></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => void join(group)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-zinc-900 hover:bg-emerald-500">Join</button><button onClick={() => void leave(group)} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-900 hover:text-zinc-900">Leave</button><button onClick={() => void share(group)} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-900 hover:text-zinc-900"><Share2 className="h-3.5 w-3.5" /> Share</button></div></div>)}</div>}
      <div className="flex items-center gap-2 text-[11px] text-zinc-500"><Network className="h-3.5 w-3.5" />Only voluntarily entered group details are stored; VTOP data is never used.</div>
    </>}

    {showCreate && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6" onClick={() => setShowCreate(false)}><form onSubmit={(event) => void create(event)} onClick={(event) => event.stopPropagation()} className="w-full max-w-lg space-y-3 rounded-t-3xl border border-zinc-200 bg-white p-5 sm:rounded-3xl"><div className="flex items-center justify-between"><h3 className="text-lg font-extrabold text-zinc-900">Create study group</h3><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg p-2 text-zinc-500 hover:text-zinc-900"><X className="h-4 w-4" /></button></div>{[['course','Course'],['assessment','CAT / FAT'],['topic','Module / topic'],['meeting_time','Time'],['location','Location'],['display_name','Display name']].map(([key, label]) => <input key={key} aria-label={label} required={key === 'course'} value={groupForm[key as keyof typeof groupForm]} onChange={(event) => updateForm(key as keyof typeof groupForm, event.target.value)} placeholder={label} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-amber-500" />)}<input type="number" aria-label="Group size" min="1" max="50" value={groupForm.group_size} onChange={(event) => updateForm('group_size', event.target.value)} placeholder="Group size" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-amber-500" /><p className="text-[11px] text-zinc-500">Do not enter registration numbers, grades, phone numbers, or VTOP credentials.</p><button className="w-full rounded-xl bg-amber-500 py-3 text-sm font-extrabold text-zinc-950 hover:bg-amber-400">Publish group</button></form></div>}
  </div>;
};

function EmptyUtility({ onOpenMap }: { onOpenMap: () => void }) {
  return <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center"><BookOpen className="mx-auto h-9 w-9 text-zinc-600" /><p className="mt-3 text-sm font-bold text-zinc-900">No verified print or scan locations yet</p><p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500">UltraCC does not currently have an authoritative campus feed for this category. Results will appear here after a verified source is connected.</p><button onClick={onOpenMap} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-amber-500/30 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-500/10"><MapPin className="h-3.5 w-3.5" /> Use official campus map</button></div>;
}
