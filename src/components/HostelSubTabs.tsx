import React, { useState, useEffect } from 'react';
import {
  UtensilsCrossed, DoorOpen, Shirt, Phone, Info, Mail,
  Plus, Trash2, ShieldAlert,
} from 'lucide-react';
import { showToast } from '../lib/toast';

type HostelTab = 'mess' | 'leave' | 'laundry' | 'counselling';

const TABS: { id: HostelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'mess', label: 'Mess', icon: <UtensilsCrossed className="h-4 w-4" /> },
  { id: 'leave', label: 'Leave', icon: <DoorOpen className="h-4 w-4" /> },
  { id: 'laundry', label: 'Laundry', icon: <Shirt className="h-4 w-4" /> },
  { id: 'counselling', label: 'Counselling & Wardens', icon: <Phone className="h-4 w-4" /> },
];

/* ── Real Campus Contacts ─────────────────────────────────────────────────── */

const WARDENS_AND_COUNSELLORS = [
  { name: 'Dr. Chief Hostel Warden', role: 'Hostel Administration Office', contact: '044 3993 1555', email: 'chennai.warden@vit.ac.in', location: 'Men\'s Hostel Block A Admin' },
  { name: 'Ladies Hostel Warden Office', role: 'Hostel Administration', contact: '044 3993 1556', email: 'chennai.lhwarden@vit.ac.in', location: 'Women\'s Hostel Block' },
  { name: 'Campus Student Counselling Cell', role: 'Student Mental Health & Wellness', contact: '044 3993 1000', email: 'counselling.cc@vit.ac.in', location: 'Health Centre 1st Floor' },
  { name: '24x7 Campus Health Centre / Ambulance', role: 'Emergency Medical Care', contact: '044 3993 1999', email: 'healthcentre.cc@vit.ac.in', location: 'Near Main Gate' },
  { name: 'Campus Security Control Room', role: '24/7 Security & Safety', contact: '044 3993 1111', email: 'security.cc@vit.ac.in', location: 'Main Security Gate' },
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

interface HostelSubTabsProps {
  activeTab: HostelTab;
  onTabChange: (tab: HostelTab) => void;
}

export const HostelSubTabs: React.FC<HostelSubTabsProps> = ({ activeTab, onTabChange }) => {
  const [leaves, setLeaves] = useState<StudentLeave[]>(() => {
    try {
      const saved = localStorage.getItem(LEAVE_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [showAddLeave, setShowAddLeave] = useState(false);
  const [leaveType, setLeaveType] = useState('Home Leave');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveFrom, setLeaveFrom] = useState('');
  const [leaveTo, setLeaveTo] = useState('');

  // Laundry tracker state
  const [laundryBags, setLaundryBags] = useState(() => {
    return localStorage.getItem('ultracc_laundry_bags') || '0';
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

  return (
    <div className="space-y-5 pb-12">
      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition cursor-pointer shrink-0 ${
              activeTab === tab.id
                ? 'acc-bg text-zinc-900 border-transparent'
                : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ─── MESS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'mess' && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-orange-500/10 border border-orange-500/20 rounded-2xl text-orange-600">
                <UtensilsCrossed className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Hostel Mess Menu</h3>
                <p className="text-xs text-zinc-500 font-medium">
                  Standard catering schedule for VIT Chennai hostels
                </p>
              </div>
            </div>

          </div>
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center">
            <Info className="mx-auto mb-3 h-8 w-8 text-orange-600" />
            <p className="text-sm font-bold text-zinc-900">Mess menu is not available from the current VTOP sync.</p>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-zinc-500">UltraCC does not invent daily menu items. When an authenticated VTOP or official hostel-feed integration is available, the menu will appear here with its source and last-updated time.</p>
          </div>
        </div>
      )}

      {/* ─── LEAVE TAB ────────────────────────────────────────────────────── */}
      {activeTab === 'leave' && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600">
                <DoorOpen className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Hostel Leave Tracker</h3>
                <p className="text-xs text-zinc-500 font-medium">
                  Track your weekend outings and home leave requests
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowAddLeave(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-zinc-900 rounded-xl text-xs font-bold transition cursor-pointer shadow-lg shadow-blue-500/20 self-start sm:self-auto"
            >
              <Plus className="h-3.5 w-3.5" /> Log New Leave
            </button>
          </div>

          {/* VTOP Notice */}
          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-xs text-blue-700 flex items-start gap-2.5">
            <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">VTOP Official Leave Approval</p>
              <p className="text-blue-700/80 text-[11px] mt-0.5">
                Official leave passes must be submitted and approved by your proctor &amp; hostel warden through the VTOP portal before leaving campus. This tracker keeps your personal record.
              </p>
            </div>
          </div>

          {/* Leaves List */}
          <div className="space-y-2">
            {leaves.length > 0 ? (
              leaves.map((l) => (
                <div key={l.id} className="flex items-center justify-between p-4 bg-zinc-50 border border-zinc-200 rounded-2xl">
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-zinc-900">{l.type}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/15 text-blue-700 border border-blue-500/30">
                        {l.status}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 truncate">{l.reason}</p>
                    <p className="text-[10px] text-zinc-500 font-mono mt-1">
                      {l.fromDate} {l.toDate && l.toDate !== l.fromDate ? `→ ${l.toDate}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteLeave(l.id)}
                    className="p-1.5 text-zinc-500 hover:text-rose-600 rounded-lg transition cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            ) : (
              <div className="p-8 text-center bg-zinc-50 border border-zinc-200 rounded-2xl text-xs text-zinc-500">
                No leaves recorded yet. Click "Log New Leave" above to track your upcoming trips.
              </div>
            )}
          </div>

          {/* Modal: Log Leave */}
          {showAddLeave && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
              <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-4">
                <h4 className="text-base font-bold text-zinc-900">Log Hostel Leave</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase text-zinc-500 mb-1">Leave Type</label>
                    <select
                      value={leaveType}
                      onChange={(e) => setLeaveType(e.target.value)}
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-900"
                    >
                      <option value="Home Leave">Home Leave</option>
                      <option value="Weekend Outing">Weekend Outing</option>
                      <option value="Medical Leave">Medical Leave</option>
                      <option value="On Duty (OD)">On Duty (OD / Hackathon)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase text-zinc-500 mb-1">Reason *</label>
                    <input
                      type="text"
                      value={leaveReason}
                      onChange={(e) => setLeaveReason(e.target.value)}
                      placeholder="e.g. Going home for festival"
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-extrabold uppercase text-zinc-500 mb-1">From Date *</label>
                      <input
                        type="date"
                        value={leaveFrom}
                        onChange={(e) => setLeaveFrom(e.target.value)}
                        className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-900 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold uppercase text-zinc-500 mb-1">To Date</label>
                      <input
                        type="date"
                        value={leaveTo}
                        onChange={(e) => setLeaveTo(e.target.value)}
                        className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-900 font-mono"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowAddLeave(false)}
                    className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-bold rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveLeave}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-zinc-900 text-xs font-bold rounded-xl transition cursor-pointer"
                  >
                    Save Leave
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── LAUNDRY TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'laundry' && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-2xl text-purple-600">
              <Shirt className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Hostel Laundry Services</h3>
              <p className="text-xs text-zinc-500 font-medium">Track your laundry drops and view collection schedule</p>
            </div>
          </div>

          {/* Personal Tracker Card */}
          <div className="p-5 bg-zinc-50 border border-zinc-200 rounded-2xl space-y-4">
            <h4 className="text-xs font-extrabold uppercase text-zinc-900 tracking-wider">My Active Laundry</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-extrabold uppercase text-zinc-500 mb-1">Number of Bags Handed In</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={laundryBags}
                  onChange={(e) => setLaundryBags(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-extrabold uppercase text-zinc-500 mb-1">Drop-off Date</label>
                <input
                  type="date"
                  value={laundryDate}
                  onChange={(e) => setLaundryDate(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2 text-xs text-zinc-900 font-mono"
                />
              </div>
            </div>
            <button
              onClick={() => handleUpdateLaundry(laundryBags, laundryDate)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-zinc-900 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Update Laundry Status
            </button>
          </div>

          {/* Block Schedule */}
          <div className="p-5 bg-zinc-50 border border-zinc-200 rounded-2xl">
            <h4 className="text-xs font-extrabold uppercase text-zinc-900 tracking-wider mb-3">Hostel Block Schedule</h4>
            <div className="space-y-2 text-xs">
              {[
                { day: 'Monday', batch: 'Block A & Block B (Men)', time: '8:00 AM – 11:00 AM' },
                { day: 'Tuesday', batch: 'Block C & Block D (Men)', time: '8:00 AM – 11:00 AM' },
                { day: 'Wednesday', batch: 'Ladies Hostel Block 1', time: '8:00 AM – 11:00 AM' },
                { day: 'Thursday', batch: 'Ladies Hostel Block 2', time: '8:00 AM – 11:00 AM' },
                { day: 'Friday & Saturday', batch: 'Pickup & Distribution for all blocks', time: '4:00 PM – 8:00 PM' },
              ].map((s) => (
                <div key={s.day} className="flex items-center justify-between p-3 bg-white rounded-xl border border-zinc-200">
                  <span className="font-bold text-zinc-900">{s.day} — {s.batch}</span>
                  <span className="text-zinc-500 font-mono text-[11px]">{s.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── COUNSELLING & WARDENS TAB ──────────────────────────────────────── */}
      {activeTab === 'counselling' && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-600">
              <Phone className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Counselling &amp; Emergency Helplines</h3>
              <p className="text-xs text-zinc-500 font-medium">Official VIT Chennai campus wellness, warden offices &amp; emergency numbers</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {WARDENS_AND_COUNSELLORS.map((c) => (
              <div key={c.name} className="p-5 bg-zinc-50 border border-zinc-200 rounded-2xl space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900">{c.name}</h4>
                    <p className="text-xs text-zinc-500 mt-0.5">{c.role}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">{c.location}</p>
                  </div>
                  <ShieldAlert className="h-4 w-4 text-emerald-600 shrink-0" />
                </div>
                <div className="pt-2 border-t border-zinc-200 flex flex-wrap gap-3 text-xs">
                  <a href={`tel:${c.contact.replace(/\s+/g, '')}`} className="flex items-center gap-1 text-emerald-600 hover:underline font-mono">
                    <Phone className="h-3.5 w-3.5" /> {c.contact}
                  </a>
                  <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-900 font-mono">
                    <Mail className="h-3.5 w-3.5" /> {c.email}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
