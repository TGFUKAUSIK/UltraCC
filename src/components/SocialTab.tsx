import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, TrendingUp, Search,
  ChevronRight, Share2, X, Copy, Check, Trash2,
  Sparkles, BookOpen, UserPlus, UserCheck,
} from 'lucide-react';
import { TimetableSlot } from '../types';
import { encodePlan, decodePlan, PlanEntry } from '../lib/ffcsShare';
import { showToast } from '../lib/toast';

export interface FriendSchedule {
  id: string;
  name: string;
  regNo: string;
  branch: string;
  slots: { code: string; title: string; day: string; slot: string; startTime?: string; endTime?: string; venue?: string }[];
  addedAt: number;
}

const STORAGE_KEY = 'ultracc_saved_friends_schedules';

const STANDARD_HOURS = [
  { start: '08:00', end: '08:50', label: '8:00 – 8:50 AM' },
  { start: '09:00', end: '09:50', label: '9:00 – 9:50 AM' },
  { start: '10:00', end: '10:50', label: '10:00 – 10:50 AM' },
  { start: '11:00', end: '11:50', label: '11:00 – 11:50 AM' },
  { start: '12:00', end: '12:50', label: '12:00 – 12:50 PM' },
  { start: '14:00', end: '14:50', label: '2:00 – 2:50 PM' },
  { start: '15:00', end: '15:50', label: '3:00 – 3:50 PM' },
  { start: '16:00', end: '16:50', label: '4:00 – 4:50 PM' },
  { start: '17:00', end: '17:50', label: '5:00 – 5:50 PM' },
  { start: '18:00', end: '18:50', label: '6:00 – 6:50 PM' },
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

interface SocialTabProps {
  myTimetable?: TimetableSlot[];
}

export const SocialTab: React.FC<SocialTabProps> = ({ myTimetable = [] }) => {
  const [friends, setFriends] = useState<FriendSchedule[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const displayFriends = friends;

  const [selectedFriend, setSelectedFriend] = useState<FriendSchedule | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [newFriendName, setNewFriendName] = useState('');
  const [newFriendRegNo, setNewFriendRegNo] = useState('');
  const [newFriendBranch, setNewFriendBranch] = useState('');
  const [newFriendCode, setNewFriendCode] = useState('');
  const [copiedShare, setCopiedShare] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(friends));
    } catch (e) {
      console.error('Failed to save friends to storage', e);
    }
  }, [friends]);

  // Generate my share code
  const myShareCode = useMemo(() => {
    if (!myTimetable.length) return '';
    const entries: Omit<PlanEntry, 'id'>[] = myTimetable.map((t) => ({
      code: t.courseCode,
      title: t.courseTitle,
      day: t.day,
      slot: t.slot || '',
      venue: t.roomNo || '',
      faculty: t.facultyName || '',
    }));
    return encodePlan(entries);
  }, [myTimetable]);

  const handleCopyMyCode = () => {
    if (!myShareCode) {
      showToast({ title: 'Timetable Empty', message: 'Sync your VTOP timetable first to share.', type: 'warning' });
      return;
    }
    navigator.clipboard.writeText(myShareCode);
    setCopiedShare(true);
    showToast({ title: 'Share Code Copied', message: 'Share this code with your classmates.', type: 'success' });
    setTimeout(() => setCopiedShare(false), 2000);
  };

  const handleAddFriend = () => {
    if (!newFriendName.trim()) {
      showToast({ title: 'Name Required', message: 'Please enter your friend\'s name.', type: 'warning' });
      return;
    }
    if (!newFriendCode.trim()) {
      showToast({ title: 'Share Code Required', message: 'Please paste the timetable share code.', type: 'warning' });
      return;
    }

    const decoded = decodePlan(newFriendCode);
    if (!decoded.length) {
      showToast({ title: 'Invalid Code', message: 'The timetable share code could not be parsed.', type: 'error' });
      return;
    }

    const newFriend: FriendSchedule = {
      id: `f-${Date.now()}`,
      name: newFriendName.trim(),
      regNo: newFriendRegNo.trim() || '—',
      branch: newFriendBranch.trim() || 'VIT Student',
      slots: decoded.map((d) => ({
        code: d.code,
        title: d.title,
        day: d.day,
        slot: d.slot,
        venue: d.venue,
      })),
      addedAt: Date.now(),
    };

    setFriends((prev) => [newFriend, ...prev]);
    setSelectedFriend(newFriend);
    setShowAddModal(false);
    setNewFriendName('');
    setNewFriendRegNo('');
    setNewFriendBranch('');
    setNewFriendCode('');
    showToast({ title: 'Friend Added!', message: `Added ${newFriend.name}'s timetable.`, type: 'success' });
  };

  const handleDeleteFriend = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFriends((prev) => prev.filter((f) => f.id !== id));
    if (selectedFriend?.id === id) setSelectedFriend(null);
    showToast({ title: 'Friend Removed', message: 'Friend removed from your social list.', type: 'info' });
  };

  const filteredFriends = displayFriends.filter(
    (f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.regNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.branch.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Common free slots calculation
  const commonFreeSlots = useMemo(() => {
    if (!selectedFriend) return [];
    const results: { day: string; freeHours: string[] }[] = [];

    for (const day of DAYS) {
      const myDaySlots = myTimetable.filter((s) => s.day.toLowerCase() === day.toLowerCase());
      const friendDaySlots = selectedFriend.slots.filter((s) => s.day.toLowerCase() === day.toLowerCase());

      const freeInDay: string[] = [];

      for (const hr of STANDARD_HOURS) {
        const myBusy = myDaySlots.some((s) => {
          if (s.startTime && s.startTime.startsWith(hr.start.slice(0, 2))) return true;
          return false;
        });
        const friendBusy = friendDaySlots.some((s) => {
          if (s.startTime && s.startTime.startsWith(hr.start.slice(0, 2))) return true;
          return false;
        });

        if (!myBusy && !friendBusy) {
          freeInDay.push(hr.label);
        }
      }

      if (freeInDay.length > 0) {
        results.push({ day, freeHours: freeInDay });
      }
    }

    return results;
  }, [selectedFriend, myTimetable]);

  // Shared courses (same course code enrolled by both)
  const sharedCourses = useMemo(() => {
    if (!selectedFriend) return [];
    const myCodes = new Set(myTimetable.map((s) => s.courseCode.toUpperCase()));
    const matching: string[] = [];
    selectedFriend.slots.forEach((s) => {
      if (myCodes.has(s.code.toUpperCase()) && !matching.includes(s.code.toUpperCase())) {
        matching.push(s.code.toUpperCase());
      }
    });
    return matching;
  }, [selectedFriend, myTimetable]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Social &amp; Timetable Compare</h3>
              <p className="text-xs text-zinc-500 font-medium">Compare schedules, find common free slots &amp; study together</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowShareModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-zinc-900 rounded-xl text-xs font-bold transition cursor-pointer shadow-lg shadow-blue-500/20"
            >
              <Share2 className="h-3.5 w-3.5" /> Share Timetable
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded-xl text-xs font-bold border border-zinc-200 transition cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" /> Add Friend
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-6">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            aria-label="Search saved friends by name, registration number or branch"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search saved friends by name, reg no, or branch..."
            className="w-full bg-white border border-zinc-200 rounded-2xl pl-10 pr-4 py-3 text-xs text-zinc-900 placeholder-zinc-500 focus:border-blue-500 focus:outline-none font-medium"
          />
        </div>

        {/* Friend Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
          {filteredFriends.map((f) => {
            const isSelected = selectedFriend?.id === f.id;
            return (
              <div
                key={f.id}
                onClick={() => setSelectedFriend(f)}
                className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-blue-500/10 border-blue-500/40 shadow-lg shadow-blue-500/5'
                    : 'bg-zinc-50 border-zinc-200 hover:border-zinc-200'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center font-bold text-violet-700 text-xs">
                        {f.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-zinc-900 truncate">{f.name}</p>
                        <p className="text-[10px] text-zinc-500 font-mono">{f.regNo} · {f.branch}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteFriend(f.id, e)}
                      title="Remove friend"
                      className="p-1 text-zinc-500 hover:text-rose-600 rounded transition cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-zinc-200 flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500 font-mono">{f.slots.length} slots loaded</span>
                  <span className={`font-bold flex items-center gap-1 ${isSelected ? 'text-blue-600' : 'text-zinc-500'}`}>
                    {isSelected ? 'Comparing' : 'Compare'} <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {filteredFriends.length === 0 && (
          <div className="ultracc-empty-panel mt-4">
            <div className="ultracc-empty-panel-icon"><Users className="h-5 w-5" /></div>
            <div>
              <p className="ultracc-empty-panel-title">No saved timetables yet</p>
              <p className="ultracc-empty-panel-copy">Share your own timetable or add a classmate’s share code to compare common study windows.</p>
            </div>
            <button onClick={() => setShowAddModal(true)} className="acc-bg text-zinc-900 rounded-xl px-3 py-2 text-xs font-bold">Add a timetable</button>
          </div>
        )}
      </div>

      {/* Comparison View */}
      {selectedFriend && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-zinc-200">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-600">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-zinc-900">Comparing Timetables</h4>
                <p className="text-xs text-zinc-500 font-medium">
                  You vs. <strong className="text-zinc-900">{selectedFriend.name}</strong> ({selectedFriend.regNo})
                </p>
              </div>
            </div>
            <button
              onClick={() => setSelectedFriend(null)}
              className="p-2 text-zinc-500 hover:text-zinc-900 rounded-xl hover:bg-zinc-100 transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Shared Courses Badge */}
          {sharedCourses.length > 0 && (
            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center gap-3">
              <BookOpen className="h-5 w-5 text-blue-600 shrink-0" />
              <div>
                <p className="text-xs font-bold text-blue-700">Shared Enrolled Courses ({sharedCourses.length})</p>
                <p className="text-[11px] text-blue-700/80 mt-0.5 font-mono">
                  {sharedCourses.join(', ')}
                </p>
              </div>
            </div>
          )}

          {/* Common Free Hours */}
          <div className="p-5 bg-zinc-50 border border-zinc-200 rounded-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              <h5 className="text-xs font-extrabold uppercase tracking-wider text-emerald-600">
                Common Free Study Windows
              </h5>
            </div>
            {commonFreeSlots.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {commonFreeSlots.map((item) => (
                  <div key={item.day} className="p-3 bg-white rounded-xl border border-zinc-200">
                    <p className="text-xs font-bold text-zinc-900 mb-1.5">{item.day}</p>
                    <div className="space-y-1">
                      {item.freeHours.slice(0, 4).map((hr, idx) => (
                        <span
                          key={idx}
                          className="inline-block px-2 py-0.5 mr-1 mb-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-[10px] font-mono"
                        >
                          {hr}
                        </span>
                      ))}
                      {item.freeHours.length > 4 && (
                        <span className="text-[10px] text-zinc-500 font-mono">+{item.freeHours.length - 4} more</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">No overlapping free hours found across standard schedule slots.</p>
            )}
          </div>

          {/* Daily Schedule Comparison Grid */}
          <div className="space-y-4">
            <h5 className="text-xs font-extrabold uppercase tracking-wider text-zinc-500">Day-By-Day Schedule</h5>
            <div className="space-y-3">
              {DAYS.map((day) => {
                const myDay = myTimetable.filter((s) => s.day.toLowerCase() === day.toLowerCase());
                const friendDay = selectedFriend.slots.filter((s) => s.day.toLowerCase() === day.toLowerCase());

                return (
                  <div key={day} className="border border-zinc-200 rounded-2xl overflow-hidden bg-zinc-50">
                    <div className="bg-white px-4 py-2.5 flex items-center justify-between border-b border-zinc-200">
                      <span className="text-xs font-extrabold uppercase text-zinc-900 tracking-wider">{day}</span>
                      <div className="flex items-center gap-4 text-[10px] text-zinc-500 font-mono">
                        <span>You: {myDay.length} classes</span>
                        <span>{selectedFriend.name.split(' ')[0]}: {friendDay.length} classes</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-200">
                      {/* You */}
                      <div className="p-3">
                        <p className="text-[10px] font-extrabold uppercase text-zinc-500 mb-2">Your Classes</p>
                        {myDay.length === 0 ? (
                          <p className="text-xs text-zinc-600 italic py-2">No classes scheduled</p>
                        ) : (
                          <div className="space-y-1.5">
                            {myDay.map((s, idx) => (
                              <div key={idx} className="p-2 rounded-xl bg-white border border-zinc-200 flex items-center justify-between text-xs">
                                <div className="min-w-0 pr-2">
                                  <span className="font-mono font-bold text-blue-600">{s.courseCode}</span>
                                  <p className="text-[10px] text-zinc-500 truncate">{s.courseTitle}</p>
                                </div>
                                <div className="text-right shrink-0 font-mono text-[10px] text-zinc-500">
                                  <span>{s.slot || ''}</span>
                                  <span className="block text-zinc-600">{s.startTime ? `${s.startTime}-${s.endTime}` : ''}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Friend */}
                      <div className="p-3">
                        <p className="text-[10px] font-extrabold uppercase text-zinc-500 mb-2">{selectedFriend.name}'s Classes</p>
                        {friendDay.length === 0 ? (
                          <p className="text-xs text-zinc-600 italic py-2">No classes scheduled</p>
                        ) : (
                          <div className="space-y-1.5">
                            {friendDay.map((s, idx) => (
                              <div key={idx} className="p-2 rounded-xl bg-white border border-zinc-200 flex items-center justify-between text-xs">
                                <div className="min-w-0 pr-2">
                                  <span className="font-mono font-bold text-emerald-600">{s.code}</span>
                                  <p className="text-[10px] text-zinc-500 truncate">{s.title}</p>
                                </div>
                                <div className="text-right shrink-0 font-mono text-[10px] text-zinc-500">
                                  <span>{s.slot || ''}</span>
                                  <span className="block text-zinc-600">{s.startTime ? `${s.startTime}-${s.endTime}` : ''}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Share My Timetable */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-600">
                  <Share2 className="h-5 w-5" />
                </div>
                <h4 className="text-base font-bold text-zinc-900">Share Your Timetable</h4>
              </div>
              <button onClick={() => setShowShareModal(false)} className="text-zinc-500 hover:text-zinc-900 p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              This code contains only your course codes, days, and slots — no grades or personal data. Your friends can paste this in UltraCC to compare schedules with you.
            </p>
            <div className="relative">
              <textarea
                readOnly
                aria-label="Your FFCS share code"
                rows={5}
                value={myShareCode || 'No timetable synced yet from VTOP.'}
                className="w-full bg-white border border-zinc-200 rounded-2xl p-3 text-[11px] font-mono text-zinc-900 focus:outline-none select-all"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowShareModal(false)}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={handleCopyMyCode}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-zinc-900 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                {copiedShare ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedShare ? 'Copied!' : 'Copy Code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Friend */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600">
                  <UserPlus className="h-5 w-5" />
                </div>
                <h4 className="text-base font-bold text-zinc-900">Add Friend's Timetable</h4>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-zinc-500 hover:text-zinc-900 p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-extrabold uppercase text-zinc-500 mb-1">Friend Name *</label>
                <input
                  type="text"
                  value={newFriendName}
                  onChange={(e) => setNewFriendName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-medium"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-zinc-500 mb-1">Reg Number (Optional)</label>
                  <input
                    type="text"
                    value={newFriendRegNo}
                    onChange={(e) => setNewFriendRegNo(e.target.value)}
                    placeholder="e.g. 23BCE1234"
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-zinc-500 mb-1">Branch (Optional)</label>
                  <input
                    type="text"
                    value={newFriendBranch}
                    onChange={(e) => setNewFriendBranch(e.target.value)}
                    placeholder="e.g. CSE / ECE"
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-medium"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-extrabold uppercase text-zinc-500 mb-1">Paste Share Code *</label>
                <textarea
                  rows={4}
                  value={newFriendCode}
                  onChange={(e) => setNewFriendCode(e.target.value)}
                  placeholder="Paste ULTRA-FFCS:v1 share code here..."
                  className="w-full bg-white border border-zinc-200 rounded-xl p-3 text-[11px] font-mono text-zinc-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleAddFriend}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-zinc-900 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                <UserCheck className="h-3.5 w-3.5" /> Save Friend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
