import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, ChevronRight, Share2, X, Copy, Check, Trash2,
  UserPlus, UserCheck,
} from 'lucide-react';
import { TimetableSlot } from '../types';
import { encodePlan, decodePlan, PlanEntry } from '../lib/ffcsShare';
import { showToast } from '../lib/toast';
import { useDialog } from '../hooks/useDialog';

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

/**
 * SocialTab — compare your timetable with a classmate's.
 * Saved friends stay on this device; a share code carries course codes, days
 * and slots only. Set as the same searchable directory the clubs, library and
 * transport screens use: a mast, a search row, and one ledger of records with a
 * compact action rail — not a wall of equal cards.
 */
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
  // Both sheets get the shared dialog behaviour: Escape out, Tab trapped,
  // focus handed back to the button that opened them.
  const shareRef = useDialog<HTMLDivElement>({ isOpen: showShareModal, onClose: () => setShowShareModal(false) });
  const addRef = useDialog<HTMLDivElement>({ isOpen: showAddModal, onClose: () => setShowAddModal(false) });
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

  const firstName = selectedFriend ? selectedFriend.name.split(' ')[0] : '';

  return (
    <div className="uc-dir-view pb-12">
      {/* Mast — the screen's identity and its two actions */}
      <div className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">Social</span>
            <h2 className="uc-dir-name">Compare timetables</h2>
            <p className="uc-note">Put your week beside a classmate's and find the hours you are both free. Saved friends stay on this device.</p>
          </div>
          <div className="uc-dir-rail">
            <button onClick={() => setShowShareModal(true)} className="uc-dir-go acc-bg">
              <Share2 className="h-3.5 w-3.5" /> Share
            </button>
            <button onClick={() => setShowAddModal(true)} className="uc-dir-go">
              <UserPlus className="h-3.5 w-3.5" /> Add friend
            </button>
          </div>
        </div>
        <div className="uc-dir-tools">
          <div className="uc-dir-search">
            <Search />
            <input
              type="text"
              aria-label="Search saved friends by name, registration number or branch"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search saved friends by name, reg no, or branch…"
            />
          </div>
          <span className="uc-dir-count">{displayFriends.length} saved</span>
        </div>
      </div>

      {/* Friend ledger */}
      <div className="uc-plate uc-dir-ledger">
        <div className="uc-plate-head">
          <span className="uc-cap">Saved timetables</span>
          <span className="uc-dir-count">{filteredFriends.length} shown</span>
        </div>
        {displayFriends.length === 0 ? (
          <div className="uc-dir-blank">
            <b>No timetables saved yet.</b> Share your own code, or paste a classmate's, to see your weeks side by side.
            <br />
            <button onClick={() => setShowAddModal(true)} className="uc-dir-go acc-bg">Add a timetable</button>
          </div>
        ) : filteredFriends.length === 0 ? (
          <div className="uc-dir-blank">Nothing matches “{searchQuery.trim()}”. Try a name, a registration number or a branch.</div>
        ) : (
          <div className="uc-dir-cards">
            {filteredFriends.map((f, index) => {
              const isSelected = selectedFriend?.id === f.id;
              return (
                <article
                  key={f.id}
                  onClick={() => setSelectedFriend(f)}
                  className="uc-dir-card cursor-pointer"
                  style={index === 0 ? { borderTop: 'none' } : undefined}
                >
                  <div className="uc-dir-card-top">
                    <div className="uc-dir-avatar">
                      {f.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                    </div>
                    <div className="uc-dir-main">
                      <span className="uc-dir-title">{f.name}</span>
                      <span className="uc-dir-meta">{f.regNo} · {f.branch}</span>
                    </div>
                  </div>
                  <div className="uc-dir-card-foot">
                    <small>{f.slots.length} slots loaded</small>
                    <div className="uc-dir-acts">
                      <button
                        type="button"
                        onClick={(e) => handleDeleteFriend(f.id, e)}
                        aria-label={`Remove ${f.name}`}
                        className="uc-dir-ico"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedFriend(f)}
                        aria-label={`Compare timetables with ${f.name}`}
                        aria-pressed={isSelected}
                        className={`uc-dir-go${isSelected ? ' is-on' : ''}`}
                      >
                        {isSelected ? 'Comparing' : 'Compare'} <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Comparison */}
      {selectedFriend && (
        <div className="uc-plate uc-dir-mast">
          <div className="uc-plate-head">
            <div className="uc-dir-id">
              <span className="uc-cap">Comparing</span>
              <h3 className="uc-dir-detail-title">You vs {selectedFriend.name}</h3>
            </div>
            <button
              onClick={() => setSelectedFriend(null)}
              aria-label="Close this comparison"
              className="uc-dir-ico"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="uc-dir-detail">
            {sharedCourses.length > 0 && (
              <>
                <span className="uc-dir-subhead">Shared enrolled courses ({sharedCourses.length})</span>
                <div className="uc-dir-tags">
                  {sharedCourses.map((code) => (
                    <span key={code} className="uc-dir-tag is-good">{code}</span>
                  ))}
                </div>
              </>
            )}

            <span className="uc-dir-subhead">Common free windows</span>
            {commonFreeSlots.length > 0 ? (
              <div className="uc-dir-days">
                {commonFreeSlots.map((item) => (
                  <div key={item.day} className="uc-dir-day">
                    <div className="uc-dir-day-head">
                      <span>{item.day}</span>
                      <small>{item.freeHours.length} free</small>
                    </div>
                    <div className="uc-dir-day-col">
                      <div className="uc-dir-tags">
                        {item.freeHours.slice(0, 4).map((hr) => (
                          <span key={hr} className="uc-dir-tag">{hr}</span>
                        ))}
                        {item.freeHours.length > 4 && (
                          <span className="uc-dir-tag">+{item.freeHours.length - 4} more</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="uc-dir-sub">No overlapping free hours across the standard schedule slots.</p>
            )}

            <span className="uc-dir-subhead">Day by day</span>
            <div className="uc-dir-days">
              {DAYS.map((day) => {
                const myDay = myTimetable.filter((s) => s.day.toLowerCase() === day.toLowerCase());
                const friendDay = selectedFriend.slots.filter((s) => s.day.toLowerCase() === day.toLowerCase());

                return (
                  <div key={day} className="uc-dir-day">
                    <div className="uc-dir-day-head">
                      <span>{day}</span>
                      <small>You {myDay.length} · {firstName} {friendDay.length}</small>
                    </div>
                    <div className="uc-dir-day-cols">
                      <div className="uc-dir-day-col">
                        <h6>Your classes</h6>
                        {myDay.length === 0 ? (
                          <p>No classes scheduled</p>
                        ) : (
                          myDay.map((s, idx) => (
                            <div key={idx} className="uc-dir-slot">
                              <div>
                                <b>{s.courseCode}</b>
                                <span>{s.courseTitle}</span>
                              </div>
                              <time>{s.startTime ? `${s.startTime}–${s.endTime}` : (s.slot || '')}</time>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="uc-dir-day-col">
                        <h6>{firstName}'s classes</h6>
                        {friendDay.length === 0 ? (
                          <p>No classes scheduled</p>
                        ) : (
                          friendDay.map((s, idx) => (
                            <div key={idx} className="uc-dir-slot">
                              <div>
                                <b>{s.code}</b>
                                <span>{s.title}</span>
                              </div>
                              <time>{s.startTime ? `${s.startTime}–${s.endTime}` : (s.slot || '')}</time>
                            </div>
                          ))
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

      <div className="uc-plate uc-plate--quiet">
        <div className="uc-note-row">
          <span>A share code carries course codes, days and slots only — no grades, no personal data. Friends you add are stored on this device and are never uploaded.</span>
        </div>
      </div>

      {/* Modal: Share My Timetable */}
      {showShareModal && (
        <div className="uc-overlay fixed inset-0 z-[70]" onClick={() => setShowShareModal(false)}>
          <div ref={shareRef} role="dialog" aria-modal="true" aria-labelledby="share-timetable-title" onClick={(e) => e.stopPropagation()} className="uc-sheet">
            <div className="uc-sheet-head">
              <div className="uc-dir-id">
                <span className="uc-cap">Share</span>
                <h3 id="share-timetable-title">Your timetable code</h3>
              </div>
              <button onClick={() => setShowShareModal(false)} aria-label="Close timetable share" className="uc-sheet-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="uc-sheet-body">
              <p className="uc-sheet-note">
                <Share2 className="h-3.5 w-3.5" />
                This code contains only your course codes, days and slots — no grades or personal data.
              </p>
              <textarea
                readOnly
                aria-label="Your FFCS share code"
                rows={5}
                value={myShareCode || 'No timetable synced yet from VTOP.'}
                className="uc-sheet-code"
              />
              <div className="uc-dir-form-foot">
                <button onClick={() => setShowShareModal(false)} className="uc-dir-go">Close</button>
                <button onClick={handleCopyMyCode} className="uc-dir-go acc-bg">
                  {copiedShare ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedShare ? 'Copied' : 'Copy code'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Friend */}
      {showAddModal && (
        <div className="uc-overlay fixed inset-0 z-[70]" onClick={() => setShowAddModal(false)}>
          <div ref={addRef} role="dialog" aria-modal="true" aria-labelledby="add-friend-title" onClick={(e) => e.stopPropagation()} className="uc-sheet">
            <div className="uc-sheet-head">
              <div className="uc-dir-id">
                <span className="uc-cap">Add a classmate</span>
                <h3 id="add-friend-title">Paste their share code</h3>
              </div>
              <button onClick={() => setShowAddModal(false)} aria-label="Close add friend" className="uc-sheet-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="uc-sheet-body">
              <div className="uc-dir-form">
                <label className="uc-dir-field">
                  <span>Friend name</span>
                  <input
                    type="text"
                    value={newFriendName}
                    onChange={(e) => setNewFriendName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="uc-dir-input"
                  />
                </label>
                <label className="uc-dir-field">
                  <span>Registration number (optional)</span>
                  <input
                    type="text"
                    value={newFriendRegNo}
                    onChange={(e) => setNewFriendRegNo(e.target.value)}
                    placeholder="e.g. 23BCE1234"
                    className="uc-dir-input font-mono"
                  />
                </label>
                <label className="uc-dir-field">
                  <span>Branch (optional)</span>
                  <input
                    type="text"
                    value={newFriendBranch}
                    onChange={(e) => setNewFriendBranch(e.target.value)}
                    placeholder="e.g. CSE / ECE"
                    className="uc-dir-input"
                  />
                </label>
                <label className="uc-dir-field">
                  <span>Share code</span>
                  <textarea
                    rows={4}
                    value={newFriendCode}
                    onChange={(e) => setNewFriendCode(e.target.value)}
                    placeholder="Paste ULTRA-FFCS:v1 share code here…"
                    className="uc-dir-input uc-dir-input--area"
                  />
                </label>
              </div>
              <div className="uc-dir-form-foot">
                <button onClick={() => setShowAddModal(false)} className="uc-dir-go">Cancel</button>
                <button onClick={handleAddFriend} className="uc-dir-go acc-bg">
                  <UserCheck className="h-3.5 w-3.5" /> Save friend
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
