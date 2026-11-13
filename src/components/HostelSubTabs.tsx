import React, { useState, useEffect } from 'react';
import {
  UtensilsCrossed, DoorOpen, Shirt, Phone, Info, Mail,
  Plus, Trash2, CalendarDays, X,
} from 'lucide-react';
import { showToast } from '../lib/toast';
import { useDialog } from '../hooks/useDialog';

type HostelTab = 'mess' | 'leave' | 'laundry' | 'counselling';

const TABS: { id: HostelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'leave', label: 'Leave', icon: <DoorOpen className="h-4 w-4" aria-hidden="true" /> },
  { id: 'laundry', label: 'Laundry', icon: <Shirt className="h-4 w-4" aria-hidden="true" /> },
  { id: 'mess', label: 'Mess', icon: <UtensilsCrossed className="h-4 w-4" aria-hidden="true" /> },
  { id: 'counselling', label: 'Counselling & Wardens', icon: <Phone className="h-4 w-4" aria-hidden="true" /> },
];

/**
 * Which screen this page opens on. `?subtab=` is written here the way Academics
 * and Grades write theirs, so a shared link or a refresh keeps the student on
 * the tracker they were actually using. Leave is the default and stays out of
 * the URL — it is the one panel that works without any feed behind it. A value
 * that is not one of these four is ignored: an unknown chip is no chip.
 */
const HOSTEL_TABS: HostelTab[] = TABS.map((t) => t.id);

function initialHostelTab(): HostelTab {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('subtab');
    if (fromUrl && HOSTEL_TABS.includes(fromUrl as HostelTab)) return fromUrl as HostelTab;
  } catch { /* a page the browser will not give a URL for */ }
  return 'leave';
}

/* ── Real Campus Contacts ─────────────────────────────────────────────────── */

const WARDENS_AND_COUNSELLORS = [
  { name: 'Dr. Chief Hostel Warden', role: 'Hostel Administration Office', contact: '044 3993 1555', email: 'chennai.warden@vit.ac.in', location: 'Men\'s Hostel Block A Admin' },
  { name: 'Ladies Hostel Warden Office', role: 'Hostel Administration', contact: '044 3993 1556', email: 'chennai.lhwarden@vit.ac.in', location: 'Women\'s Hostel Block' },
  { name: 'Campus Student Counselling Cell', role: 'Student Mental Health & Wellness', contact: '044 3993 1000', email: 'counselling.cc@vit.ac.in', location: 'Health Centre 1st Floor' },
  { name: '24x7 Campus Health Centre / Ambulance', role: 'Emergency Medical Care', contact: '044 3993 1999', email: 'healthcentre.cc@vit.ac.in', location: 'Near Main Gate' },
  { name: 'Campus Security Control Room', role: '24/7 Security & Safety', contact: '044 3993 1111', email: 'security.cc@vit.ac.in', location: 'Main Security Gate' },
];

const LAUNDRY_TIMINGS = [
  { day: 'Monday', batch: 'Block A & Block B (Men)', time: '8:00 AM – 11:00 AM' },
  { day: 'Tuesday', batch: 'Block C & Block D (Men)', time: '8:00 AM – 11:00 AM' },
  { day: 'Wednesday', batch: 'Ladies Hostel Block 1', time: '8:00 AM – 11:00 AM' },
  { day: 'Thursday', batch: 'Ladies Hostel Block 2', time: '8:00 AM – 11:00 AM' },
  { day: 'Friday & Saturday', batch: 'Pickup & Distribution for all blocks', time: '4:00 PM – 8:00 PM' },
];

export interface StudentLeave {
  id: string;
  type: string;
  reason: string;
  fromDate: string;
  toDate: string;
  status: 'applied' | 'approved' | 'completed';
}

const LEAVE_STORAGE_KEY = 'ultracc_student_logged_leaves';

export const HostelSubTabs: React.FC = () => {
  const [activeTab, setActiveTab] = useState<HostelTab>(initialHostelTab);

  // The chip is the page, so it belongs in the address bar like a tab does. The
  // default chip is dropped rather than written, which also cleans a ?subtab=
  // left over from another page out of the link the student is looking at.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (activeTab === 'leave') url.searchParams.delete('subtab');
      else url.searchParams.set('subtab', activeTab);
      // replaceState, not pushState: Back should leave the hostel page, not walk
      // through every chip on it.
      if (url.toString() !== window.location.href) window.history.replaceState({}, '', url.toString());
    } catch { /* web views with no URL to offer */ }
  }, [activeTab]);

  /** Kept as a named action because the mess panel's empty state offers it. */
  function selectTab(tab: HostelTab) {
    setActiveTab(tab);
  }

  const [leaves, setLeaves] = useState<StudentLeave[]>(() => {
    try {
      const saved = localStorage.getItem(LEAVE_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [showAddLeave, setShowAddLeave] = useState(false);
  // Escape closes, Tab stays in the form, focus returns to "Log New Leave".
  const leaveRef = useDialog<HTMLDivElement>({ isOpen: showAddLeave, onClose: () => setShowAddLeave(false) });
  const [leaveType, setLeaveType] = useState('Home Leave');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveFrom, setLeaveFrom] = useState('');
  const [leaveTo, setLeaveTo] = useState('');

  // Laundry tracker state. An empty field reads as "nothing handed in"; a
  // prefilled 0 reads as a number the app measured.
  const [laundryBags, setLaundryBags] = useState(() => {
    return localStorage.getItem('ultracc_laundry_bags') || '';
  });
  const [laundryDate, setLaundryDate] = useState(() => {
    return localStorage.getItem('ultracc_laundry_date') || '';
  });

  useEffect(() => {
    try {
      localStorage.setItem(LEAVE_STORAGE_KEY, JSON.stringify(leaves));
    } catch (e) {
      console.error(e);
    }
  }, [leaves]);


  const handleSaveLeave = () => {
    if (!leaveReason.trim() || !leaveFrom) {
      showToast({ title: 'Incomplete Details', message: 'Please provide a reason and start date.', type: 'warning' });
      return;
    }
    const newL: StudentLeave = {
      id: `l-${Date.now()}`,
      type: leaveType,
      reason: leaveReason.trim(),
      fromDate: leaveFrom,
      toDate: leaveTo || leaveFrom,
      status: 'applied',
    };
    setLeaves((prev) => [newL, ...prev]);
    setShowAddLeave(false);
    setLeaveReason('');
    setLeaveFrom('');
    setLeaveTo('');
    showToast({ title: 'Leave Logged', message: 'Recorded in your personal leave tracker.', type: 'success' });
  };

  const handleDeleteLeave = (id: string) => {
    setLeaves((prev) => prev.filter((l) => l.id !== id));
    showToast({ title: 'Leave Removed', message: 'Removed from tracker.', type: 'info' });
  };

  const handleUpdateLaundry = (bags: string, date: string) => {
    setLaundryBags(bags);
    setLaundryDate(date);
    localStorage.setItem('ultracc_laundry_bags', bags);
    localStorage.setItem('ultracc_laundry_date', date);
    showToast({ title: 'Laundry Updated', message: 'Personal laundry tracker saved.', type: 'success' });
  };

  const leaveTag = (status: StudentLeave['status']) =>
    status === 'approved' ? 'uc-dir-tag is-good' : status === 'completed' ? 'uc-dir-tag is-live' : 'uc-dir-tag';

  return (
    <div className="uc-index pb-12">
      {/* One chip row, one vocabulary: a segmented container, tab semantics so a
          screen reader says which screen is on, and a thumb-height target. The
          two trackers come before the panel with no feed behind it, so the page
          does not open on a gap. */}
      <div role="tablist" aria-label="Hostel screen" className="uc-seg uc-hostel-seg">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => selectTab(tab.id)}
            className={activeTab === tab.id ? 'is-on' : undefined}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ─── MESS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'mess' && (
        <section className="uc-plate">
          <div className="uc-plate-head"><span className="uc-cap">Hostel mess menu</span></div>
          {/* Named as a gap rather than left as an empty table: a student who
              cannot tell "not published" from "broken" stops trusting the page. */}
          <div className="uc-dir-blank">
            <b>There is no menu for UltraCC to read.</b> The hostel office puts today&rsquo;s menu on the block notice board and the mess group. UltraCC will not fill this in with a guess — the leave tracker, laundry record and campus numbers all work without a feed.
            <button className="uc-dir-go" onClick={() => selectTab('leave')}>Open the leave tracker</button>
          </div>
        </section>
      )}

      {/* ─── LEAVE TAB ────────────────────────────────────────────────────── */}
      {activeTab === 'leave' && (
        <>
          <section className="uc-plate">
            <div className="uc-plate-head">
              <span className="uc-cap">Hostel Leave Tracker</span>
              <button onClick={() => setShowAddLeave(true)} className="uc-dir-go acc-bg"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Log new leave</button>
            </div>
            {/* VTOP Notice */}
            <div className="uc-dir-detail">
              <div className="uc-note-row">
                <Info className="h-4 w-4" aria-hidden="true" />
                <span><b>VTOP official leave approval.</b> Official leave passes must be submitted and approved by your proctor &amp; hostel warden through the VTOP portal before leaving campus. This tracker keeps your personal record.</span>
              </div>
            </div>
          </section>

          <section className="uc-plate uc-dir-ledger">
            <div className="uc-plate-head"><span className="uc-cap">Your leave record</span><span className="uc-dir-count"><span className="uc-num">{leaves.length}</span> logged</span></div>
            {leaves.length > 0 ? (
              leaves.map((l) => (
                <article key={l.id} className="uc-dir-row uc-dir-row--acts">
                  <span className="uc-dir-tile"><DoorOpen className="h-4 w-4" aria-hidden="true" /></span>
                  <div className="uc-dir-main">
                    <h3 className="uc-dir-title">{l.type}</h3>
                    <p className="uc-dir-meta uc-num">{l.fromDate} {l.toDate && l.toDate !== l.fromDate ? `→ ${l.toDate}` : ''}</p>
                    <p className="uc-dir-sub">{l.reason}</p>
                  </div>
                  <div className="uc-dir-acts">
                    <span className={leaveTag(l.status)}>{l.status}</span>
                    <button onClick={() => handleDeleteLeave(l.id)} className="uc-dir-ico" aria-label="Delete this leave request"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                </article>
              ))
            ) : (
              <div className="uc-dir-blank">
                <b>No leaves logged yet.</b> Keep a record of your weekend outings and home leaves here, including the dates you told your proctor. The pass itself is still approved on VTOP.
                <button className="uc-dir-go" onClick={() => setShowAddLeave(true)}>Log a leave</button>
              </div>
            )}
          </section>
        </>
      )}

      {/* ─── LAUNDRY TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'laundry' && (
        <>
          <section className="uc-plate">
            <div className="uc-plate-head"><span className="uc-cap">Hostel laundry services</span></div>
            <div className="uc-dir-detail">
              <h4 className="uc-dir-subhead">My Active Laundry</h4>
              <div className="uc-dir-form">
                <label className="uc-dir-field">
                  <span>Number of bags handed in</span>
                  <input type="number" min="0" max="10" placeholder="e.g. 2" value={laundryBags} onChange={(e) => setLaundryBags(e.target.value)} className="uc-dir-input" />
                </label>
                <label className="uc-dir-field">
                  <span>Drop-off date</span>
                  <input type="date" value={laundryDate} onChange={(e) => setLaundryDate(e.target.value)} className="uc-dir-input uc-num" />
                </label>
              </div>
              <div className="uc-dir-form-foot">
                <button onClick={() => handleUpdateLaundry(laundryBags, laundryDate)} className="uc-dir-go acc-bg">Update laundry status</button>
              </div>
            </div>
          </section>

          {/* Block Schedule — carried over from what students report, not from a
              feed UltraCC can read. The collection day is the kind of thing a
              wrong answer costs a bag of clothes in, so the source is named and
              the check is asked for. */}
          <section className="uc-plate uc-dir-ledger">
            <div className="uc-plate-head"><span className="uc-cap">Laundry timings as reported by students</span></div>
            {LAUNDRY_TIMINGS.map((s) => (
              <div key={s.day} className="uc-dir-row uc-dir-row--acts">
                <span className="uc-dir-tile"><CalendarDays className="h-4 w-4" aria-hidden="true" /></span>
                <div className="uc-dir-main"><h3 className="uc-dir-title">{s.day}</h3><p className="uc-dir-meta">{s.batch}</p></div>
                <span className="uc-dir-count uc-num">{s.time}</span>
              </div>
            ))}
            <div className="uc-dir-detail">
              <div className="uc-note-row">
                <Info className="h-4 w-4" aria-hidden="true" />
                <span>The hostel office changes these with notice, and blocks differ. Check your own block notice board before you leave a bag out — this list is a reminder, not the authority.</span>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ─── COUNSELLING & WARDENS TAB ──────────────────────────────────────── */}
      {activeTab === 'counselling' && (
        <section className="uc-plate">
          <div className="uc-plate-head"><span className="uc-cap">Counselling &amp; emergency helplines</span></div>
          {/* A number someone might call in a panic is not decoration. These are
              the listings this page was written against; switchboards move, so
              the national emergency line is stated next to them. */}
          <div className="uc-dir-detail">
            <div className="uc-note-row">
              <Info className="h-4 w-4" aria-hidden="true" />
              <span>These are the campus office numbers as listed for VIT Chennai; a switchboard can change without this page knowing. <b>For any emergency, call 112</b> (India&rsquo;s emergency number) or go to the Health Centre building — that line does not depend on a listing being current.</span>
            </div>
          </div>
          <div className="uc-dir-cards">
            {WARDENS_AND_COUNSELLORS.map((c) => (
              <article key={c.name} className="uc-dir-card">
                <div className="uc-dir-card-top">
                  <div className="uc-dir-main">
                    <h3 className="uc-dir-title">{c.name}</h3>
                    <p className="uc-dir-meta">{c.role}</p>
                    <p className="uc-dir-sub uc-num">{c.location}</p>
                  </div>
                </div>
                <div className="uc-dir-card-foot">
                  <a href={`tel:${c.contact.replace(/\s+/g, '')}`} className="uc-link uc-num"><Phone className="h-3.5 w-3.5" aria-hidden="true" /> {c.contact}</a>
                  <a href={`mailto:${c.email}`} className="uc-link uc-num"><Mail className="h-3.5 w-3.5" aria-hidden="true" /> {c.email}</a>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Leave sheet. The form fields already spoke the `uc-dir-*` language;
          only the shell was bespoke — a fixed black scrim and a hand-rolled
          card — so it is now the shared overlay and the shared `.uc-sheet`,
          which hands a phone the full-width bottom sheet for free. */}
      {showAddLeave && (
        <div className="uc-overlay fixed inset-0 z-[70]" onClick={() => setShowAddLeave(false)}>
          <div ref={leaveRef} role="dialog" aria-modal="true" aria-labelledby="hostel-leave-title" onClick={(e) => e.stopPropagation()} className="uc-sheet">
            <header className="uc-plate-head uc-sheet-head">
              <div className="uc-dir-id">
                <span className="uc-cap">Hostel</span>
                <h3 id="hostel-leave-title" className="uc-dir-name">Log hostel leave</h3>
              </div>
              <div className="uc-dir-rail">
                <button type="button" onClick={() => setShowAddLeave(false)} className="uc-dir-ico" aria-label="Close leave form"><X aria-hidden="true" /></button>
              </div>
            </header>
            <div className="uc-sheet-body">
              <div className="uc-dir-form">
                <label className="uc-dir-field">
                  <span>Leave type</span>
                  <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="uc-dir-select">
                    <option value="Home Leave">Home Leave</option>
                    <option value="Weekend Outing">Weekend Outing</option>
                    <option value="Medical Leave">Medical Leave</option>
                    <option value="On Duty (OD)">On Duty (OD / Hackathon)</option>
                  </select>
                </label>
                <label className="uc-dir-field">
                  <span>Reason *</span>
                  <input type="text" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="e.g. Going home for festival" className="uc-dir-input" />
                </label>
                <label className="uc-dir-field">
                  <span>From date *</span>
                  <input type="date" value={leaveFrom} onChange={(e) => setLeaveFrom(e.target.value)} className="uc-dir-input uc-num" />
                </label>
                <label className="uc-dir-field">
                  <span>To date</span>
                  <input type="date" value={leaveTo} onChange={(e) => setLeaveTo(e.target.value)} className="uc-dir-input uc-num" />
                </label>
              </div>
            </div>
            <footer className="uc-plate-foot uc-sheet-foot">
              <div className="uc-dir-form-foot">
                <button onClick={() => setShowAddLeave(false)} className="uc-dir-go">Cancel</button>
                <button onClick={handleSaveLeave} className="uc-dir-go acc-bg">Save leave</button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
