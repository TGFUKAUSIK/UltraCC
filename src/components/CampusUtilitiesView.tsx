import React, { useEffect, useMemo, useState } from 'react';
import { Clock3, MapPin, Plus, Printer, Search, Share2, Users, X } from 'lucide-react';
import { createStudyGroup, fetchStudyGroups, hashCampusCapabilityToken, joinStudyGroup, leaveStudyGroup, newCampusCapabilityToken, StudyGroup } from '../lib/supabaseCampus';
import { humanErrorCopy } from '../lib/errorCopy';
import { useDialog } from '../hooks/useDialog';

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

const STUDENT_REPORTED_PRINTING: { name: string; service: string; building: string; floor: string; hours?: string }[] = [
  { name: 'Print / photocopy point', service: 'Print, photocopy and scan services reported by students', building: 'AB1', floor: 'Ground floor' },
  { name: 'Print / photocopy point', service: 'Print, photocopy and scan services reported by students', building: 'AB1', floor: '6th floor' },
  { name: 'Print / photocopy point', service: 'Print, photocopy and scan services reported by students', building: 'AB2', floor: 'Basement' },
];

/**
 * Where a listing came from, said the way a student would say it. The old
 * labels ('STATIC / VERIFIED ONLY', 'USER-GENERATED / OPT-IN') described how
 * the app stores a row, not whether the row is worth trusting.
 */
function sourceBadge(label: string) {
  return <span className="uc-dir-tag">{label}</span>;
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
  const createRef = useDialog<HTMLFormElement>({ isOpen: showCreate, onClose: () => setShowCreate(false) });
  const [notice, setNotice] = useState('');
  const [memberName, setMemberName] = useState('');
  const [groupForm, setGroupForm] = useState({ course: '', assessment: '', topic: '', meeting_time: '', location: '', group_size: '4', display_name: '' });

  const loadGroups = async () => {
    setLoadingGroups(true); setGroupError('');
    try { setGroups(await fetchStudyGroups()); } catch (error) { setGroupError(humanErrorCopy(error, 'Study groups are unavailable')); }
    finally { setLoadingGroups(false); }
  };
  useEffect(() => { if (kind === 'groups') void loadGroups(); }, [kind]);

  const printRows = STUDENT_REPORTED_PRINTING;
  const buildings = useMemo(() => ['All', ...Array.from(new Set(printRows.map((row) => row.building).filter(Boolean))).sort()], [printRows]);
  const floors = useMemo(() => ['All', ...Array.from(new Set(printRows.map((row) => row.floor).filter(Boolean))).sort()], [printRows]);
  const filteredRows = useMemo(() => printRows.filter((row) => {
    const text = JSON.stringify(row).toLowerCase();
    return (!query.trim() || text.includes(query.toLowerCase())) && (building === 'All' || row.building === building) && (floor === 'All' || row.floor === floor);
  }), [printRows, query, building, floor]);
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
    try { if (await joinStudyGroup(group.id, memberName.trim() || 'Anonymous', token)) { setNotice(`Joined ${group.course}.`); await loadGroups(); } else setNotice('That group is full or you are already a member.'); }
    catch (error) { setGroupError(humanErrorCopy(error, 'Could not join the study group')); }
  };
  const leave = async (group: StudyGroup) => { const token = localStorage.getItem('ultracc:study-group-member-token'); if (!token) return; try { await leaveStudyGroup(group.id, token); setNotice(`Left ${group.course}.`); await loadGroups(); } catch (error) { setGroupError(humanErrorCopy(error, 'Could not leave the study group')); } };
  const share = async (group: StudyGroup) => { const text = `${group.course}${group.assessment ? ` · ${group.assessment}` : ''} study group${group.topic ? ` — ${group.topic}` : ''}`; try { await navigator.clipboard.writeText(text); setNotice('Group details copied to clipboard.'); } catch { setNotice(text); } };

  const pickKind = (id: UtilityKind) => { setKind(id); setQuery(''); setBuilding('All'); setFloor('All'); };

  return <div className="uc-index pb-12">
    <section className="uc-plate uc-dir-mast">
      <div className="uc-dir-head">
        <div className="uc-dir-id">
          <span className="uc-cap">Campus facilities</span>
          <h2 className="uc-dir-name">Campus services you can rely on</h2>
          <p className="uc-note">Print and scan points that students have reported, plus study groups your batchmates post themselves. Nothing here comes from your VTOP record.</p>
        </div>
        <div className="uc-dir-rail">
          {onOpenRooms && <button onClick={onOpenRooms} className="uc-dir-go"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Find a free room or lab</button>}
          <button onClick={() => onOpenMap(query)} className="uc-dir-go acc-bg"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />Open official campus map</button>
        </div>
      </div>
    </section>

    <div className="uc-dir-body">
      <section className="uc-plate uc-dir-facets">
        <div className="uc-dir-detail">
          <div className="uc-seg" role="tablist" aria-label="Facility kind">
            {campusUtilityTabs.map(({ id, label }) => { const Icon = UTILITY_ICONS[id]; return <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? 'is-on' : ''} onClick={() => pickKind(id)}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</button>; })}
          </div>
        </div>
        <div className="uc-dir-tools">
          <div className="uc-dir-search">
            <Search aria-hidden="true" />
            <input aria-label={kind === 'groups' ? 'Search study groups' : 'Search campus facilities'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === 'groups' ? 'Search course or topic' : 'Search name or building'} />
          </div>
          {kind !== 'groups' && <div className="uc-camp-filters">
            <select aria-label="Filter by building" value={building} onChange={(event) => setBuilding(event.target.value)} className="uc-dir-select"><option value="All">All buildings</option>{buildings.slice(1).map((value) => <option key={value}>{value}</option>)}</select>
            <select aria-label="Filter by floor" value={floor} onChange={(event) => setFloor(event.target.value)} className="uc-dir-select"><option value="All">All floors</option>{floors.slice(1).map((value) => <option key={value}>{value}</option>)}</select>
          </div>}
          {kind === 'groups' && <div className="uc-camp-filters">
            <input aria-label="Your name when joining a group" value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="Your name (optional)" className="uc-dir-input" />
            <button onClick={() => setShowCreate(true)} className="uc-dir-go acc-bg"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Create group</button>
          </div>}
        </div>
      </section>

      {kind !== 'groups' ? <>
        <section className="uc-plate uc-dir-ledger">
          <div className="uc-plate-head">{sourceBadge('Reported by students')}<span className="uc-dir-count">{filteredRows.length} entries</span></div>
          {filteredRows.length === 0
            ? <div className="uc-dir-blank"><b>Nothing matches these filters.</b> The print points listed here are the ones students reported: AB1 ground floor, AB1 sixth floor and AB2 basement. Try a building name, or clear the filters to see all three.<button className="uc-dir-go" onClick={() => { setQuery(''); setBuilding('All'); setFloor('All'); }}>Clear filters</button></div>
            : filteredRows.map((row) => <article key={JSON.stringify(row)} className="uc-dir-row uc-dir-row--acts">
              <span className="uc-dir-tile"><Printer className="h-4 w-4" aria-hidden="true" /></span>
              <div className="uc-dir-main">
                <h3 className="uc-dir-title">{row.name}</h3>
                <p className="uc-dir-meta">{row.building} · {row.floor}</p>
                <p className="uc-dir-sub">{('service' in row && row.service) || 'Campus reference details unavailable'}</p>
              </div>
              <div className="uc-dir-acts"><button onClick={() => onOpenMap(`${row.building} ${row.floor}`)} className="uc-dir-go"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />Find on map</button></div>
            </article>)}
        </section>
      </> : <>
        <section className="uc-plate uc-dir-ledger">
          <div className="uc-plate-head">{sourceBadge('From other students')}<span className="uc-dir-count">{loadingGroups ? 'Loading…' : `${filteredGroups.length} groups`}</span></div>
          {filteredGroups.length === 0 && !loadingGroups
            ? <div className="uc-dir-blank"><b>{query.trim() ? `Nothing matches “${query.trim()}”` : 'No study groups up right now'}.</b> {query.trim() ? 'Groups are only what batchmates choose to post. Clear the search to see every one.' : 'Put the first one up with only the details you want to share — course, assessment, time and place.'}<button className="uc-dir-go" onClick={() => { if (query.trim()) setQuery(''); else setShowCreate(true); }}>{query.trim() ? 'Clear search' : 'Create a group'}</button></div>
            : filteredGroups.map((group) => <article key={group.id} className="uc-dir-row uc-dir-row--acts">
              <span className="uc-dir-tile"><Users className="h-4 w-4" aria-hidden="true" /></span>
              <div className="uc-dir-main">
                <h3 className="uc-dir-title">{group.course}</h3>
                <p className="uc-dir-meta">{group.assessment || 'General study'}{group.topic ? ` · ${group.topic}` : ''}</p>
                <div className="uc-dir-tags">
                  <span className="uc-dir-tag"><Clock3 className="h-3 w-3" aria-hidden="true" />{group.meeting_time || 'Time not specified'}</span>
                  <span className="uc-dir-tag"><MapPin className="h-3 w-3" aria-hidden="true" />{group.location || 'Location not specified'}</span>
                  <span className="uc-dir-tag"><Users className="h-3 w-3" aria-hidden="true" />{group.display_name || 'Anonymous'}</span>
                  <span className="uc-dir-tag is-good"><span className="uc-num">{group.member_count}/{group.group_size}</span></span>
                </div>
              </div>
              <div className="uc-dir-acts">
                <button onClick={() => void join(group)} className="uc-dir-go acc-bg">Join</button>
                <button onClick={() => void leave(group)} className="uc-dir-go">Leave</button>
                <button onClick={() => void share(group)} className="uc-dir-go"><Share2 className="h-3.5 w-3.5" aria-hidden="true" />Share</button>
              </div>
            </article>)}
        </section>
        <p className="uc-note-row"><span>A group shows only what whoever posted it chose to write here — nothing from your VTOP record is shared.</span></p>
      </>}
    </div>

    {notice && <div className="uc-note-row"><span>{notice}</span></div>}
    {groupError && <div className="uc-note-row uc-note-row--warn"><span>{groupError}</span></div>}

    {showCreate && <div className="uc-overlay fixed inset-0 z-[70]" onClick={() => setShowCreate(false)}><form ref={createRef} role="dialog" aria-modal="true" aria-labelledby="study-group-create-title" onSubmit={(event) => void create(event)} onClick={(event) => event.stopPropagation()} className="uc-sheet"><div className="uc-plate-head uc-sheet-head"><h3 id="study-group-create-title" className="uc-dir-detail-title">Create study group</h3><button type="button" onClick={() => setShowCreate(false)} aria-label="Cancel study group creation" className="uc-dir-ico"><X className="h-4 w-4" aria-hidden="true" /></button></div><div className="uc-sheet-body"><div className="uc-dir-form">{[['course','Course'],['assessment','CAT / FAT'],['topic','Module / topic'],['meeting_time','Time'],['location','Location'],['display_name','Display name']].map(([key, label]) => <label key={key} className="uc-dir-field"><span>{label}</span><input aria-label={label} required={key === 'course'} value={groupForm[key as keyof typeof groupForm]} onChange={(event) => updateForm(key as keyof typeof groupForm, event.target.value)} placeholder={label} className="uc-dir-input" /></label>)}<label className="uc-dir-field"><span>Group size</span><input type="number" aria-label="Group size" min="1" max="50" value={groupForm.group_size} onChange={(event) => updateForm('group_size', event.target.value)} placeholder="Group size" className="uc-dir-input" /></label></div><p className="uc-dir-note">Do not enter registration numbers, grades, phone numbers, or VTOP credentials.</p></div><div className="uc-plate-foot uc-sheet-foot"><div className="uc-dir-form-foot"><button className="uc-dir-go acc-bg">Publish group</button></div></div></form></div>}
  </div>;
};
