/**
 * NotificationBell.tsx — smart notifications UI for the header bell.
 *
 * Generates candidates from the already-synced datasets passed in via props,
 * evaluates them through the smartNotifications pipeline (prefs, dedup,
 * cap), and shows the result in a popover with per-category preferences.
 * The browser Notification API is used only when permission was granted;
 * the bell itself always works in-app.
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, BellRing, Settings2, X, AlertTriangle, CalendarDays, BookOpen, ClipboardList, PartyPopper, Clock } from 'lucide-react';
import type { AssignmentRecord, AttendanceRecord, ExamRecord, CourseMarksRecord, TimetableSlot } from '../lib/vtop/types';
import type { BackgroundPushController } from '../hooks/useBackgroundPush';
import {
  generateNotificationCandidates, deliverNotifications, loadNotificationPrefs, saveNotificationPrefs,
  markAllSeen, recordMarksSeen, ALL_CATEGORIES, NotificationCategory, NotificationCandidate, NotificationPrefs,
} from '../lib/smartNotifications';
import { getSavedEvents, subscribeSavedEvents } from '../lib/savedEvents';
import { useEscapeKey } from '../hooks/useDialog';

const CATEGORY_META: Record<NotificationCategory, { label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  assignments: { label: 'Assignments due soon', icon: ClipboardList },
  attendance: { label: 'Attendance risk', icon: AlertTriangle },
  exams: { label: 'Exams approaching', icon: CalendarDays },
  marks: { label: 'New marks published', icon: BookOpen },
  campusEvents: { label: 'Campus events', icon: PartyPopper },
  timetable: { label: 'Class reminders (~10 min before)', icon: Clock },
};

interface Props {
  assignments: AssignmentRecord[];
  attendance: AttendanceRecord[];
  exams: ExamRecord[];
  marks: CourseMarksRecord[];
  timetable: TimetableSlot[];
  /** Background push controller (enables reminders while UltraCC is closed). */
  backgroundPush?: BackgroundPushController;
}

export const NotificationBell: React.FC<Props> = ({ assignments, attendance, exams, marks, timetable, backgroundPush }) => {
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => loadNotificationPrefs());
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set());
  // 30s ticker: class reminders are time-windowed (last 10 min before a
  // class), so candidates must re-evaluate while the app sits open.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
  );
  // Force a delivery re-run after the user grants permission.
  const [runToken, setRunToken] = useState(0);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest('.notification-bell-root')) return;
      setOpen(false);
      setShowPrefs(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEscapeKey(open, () => {
    setOpen(false);
    setShowPrefs(false);
  });

  // Campus-event notices fire only for events the student explicitly saved —
  // never for the whole Event Hub feed. `savedEvents` is the reactive store.
  const campusEvents = useSyncExternalStore(subscribeSavedEvents, getSavedEvents);

  const candidates = useMemo(
    () => generateNotificationCandidates({
      assignments: assignments.map((a) => ({ id: a.id, courseCode: a.courseCode, courseTitle: a.courseTitle, title: a.title, dueDate: a.dueDate, weightage: '', status: a.status === 'Pending' ? 'Pending' : 'Submitted' })),
      attendance,
      exams: exams.map((e) => ({ id: e.id, courseCode: e.courseCode, courseTitle: e.courseTitle, examType: e.examType, date: e.date, time: e.time, venue: e.venue, seatNo: e.seatNo, syllabusTopics: [] })),
      marksByCourse: Object.fromEntries(marks.map((m) => [m.courseCode, { totalScoredSoFar: m.totalInternalWeightScored, estimatedGrade: m.currentEstimatedGrade }])),
      campusEvents,
      timetable: timetable.map((t) => ({ day: t.day, startTime: t.startTime, endTime: t.endTime, venue: t.venue, courseCode: t.courseCode })),
      now: nowTick,
    }),
    [assignments, attendance, exams, marks, timetable, campusEvents, nowTick],
  );

  // Every id ever fired this visit accumulates here so a notice stays in the
  // bell across ticker re-evaluations instead of vanishing on the next tick.
  const firedIdsRef = useRef<Set<string>>(new Set());

  // Deliver once per candidates change: persist ledger, fire OS notifications
  // when permitted, and record the marks snapshot as seen for the next diff.
  const [delivered, setDelivered] = useState<NotificationCandidate[]>([]);
  useEffect(() => {
    if (!prefs.enabled) { setDelivered([]); return; }
    const res = deliverNotifications(candidates, prefs);
    res.fired.forEach((c) => firedIdsRef.current.add(c.id));
    setDelivered(res.fired);
    recordMarksSeen(Object.fromEntries(marks.map((m) => [m.courseCode, { totalScoredSoFar: m.totalInternalWeightScored }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, prefs, runToken]);

  const visible = useMemo(() => {
    const deliveredIds = new Set(delivered.map((c) => c.id));
    return candidates.filter((c) => deliveredIds.has(c.id) || firedIdsRef.current.has(c.id) || (seenIds.has(c.id) && !deliveredIds.has(c.id)));
  }, [candidates, delivered, seenIds]);

  const unread = visible.length;

  const enableOsNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      setRunToken((t) => t + 1);
    } catch { /* permission prompt unavailable */ }
  };

  const toggleCategory = (cat: NotificationCategory) => {
    const next = { ...prefs, categories: { ...prefs.categories, [cat]: !prefs.categories[cat] } };
    setPrefs(next);
    saveNotificationPrefs(next);
  };

  const onMarkRead = () => {
    markAllSeen(candidates);
    setSeenIds(new Set(candidates.map((c) => c.id)));
    setDelivered([]);
    firedIdsRef.current = new Set();
  };

  return (
    <div className="notification-bell-root relative">
      <button
        type="button"
        className="icon-button relative"
        title="Notifications"
        aria-label={`Notifications${unread ? ` (${unread} new)` : ''}`}
        aria-expanded={open}
        aria-controls="ultracc-notification-panel"
        onClick={() => { setOpen((o) => !o); setShowPrefs(false); }}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="uc-bell-badge">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div id="ultracc-notification-panel" className="uc-bell" role="region" aria-label="Notifications">
          <header className="uc-bell-head">
            {showPrefs ? (
              <>
                <span className="uc-bell-title">Notification preferences</span>
                <button type="button" onClick={() => setShowPrefs(false)} className="uc-dir-ico" aria-label="Back to notifications" title="Back"><X size={14} aria-hidden="true" /></button>
              </>
            ) : (
              <>
                <span className="uc-bell-title">Notifications</span>
                <div className="uc-bell-tools">
                  <button type="button" onClick={() => setShowPrefs(true)} className="uc-dir-ico" aria-label="Notification preferences" title="Preferences"><Settings2 size={14} aria-hidden="true" /></button>
                  <button type="button" onClick={onMarkRead} className="uc-bell-mark" title="Mark all as read">Mark read</button>
                </div>
              </>
            )}
          </header>

          {showPrefs ? (
            <div className="uc-bell-prefs">
              {permission === 'default' && (
                <div className="uc-bell-callout">
                  <p className="uc-bell-callout-title">Get reminders outside the app</p>
                  <p className="uc-bell-callout-note">Allow system notifications to receive class reminders (~10 min before) and LMS quiz alerts even when this tab is in the background.</p>
                  <button type="button" onClick={() => void enableOsNotifications()} className="uc-dir-go acc-bg uc-bell-callout-act">Enable notifications</button>
                </div>
              )}
              <label className="uc-bell-pref">
                <span>All notifications</span>
                <input type="checkbox" checked={prefs.enabled} onChange={() => {
                  const next = { ...prefs, enabled: !prefs.enabled };
                  setPrefs(next); saveNotificationPrefs(next);
                }} />
              </label>
              <div className="uc-bell-div">
                {ALL_CATEGORIES.map((cat) => {
                  const meta = CATEGORY_META[cat];
                  return (
                    <label key={cat} className="uc-bell-pref">
                      <span><meta.icon size={13} /> {meta.label}</span>
                      <input type="checkbox" checked={prefs.categories[cat] !== false} onChange={() => toggleCategory(cat)} />
                    </label>
                  );
                })}
              </div>
              {backgroundPush && (
                <div className="uc-bell-div">
                  <label className="uc-bell-pref">
                    <span>
                      <BellRing size={13} aria-hidden="true" /> Even when UltraCC is closed
                    </span>
                    <input
                      type="checkbox"
                      aria-label="Background notifications (works when the app is closed)"
                      checked={backgroundPush.enabled}
                      disabled={backgroundPush.busy || !backgroundPush.supported || !backgroundPush.configured || backgroundPush.permission === 'denied'}
                      onChange={() => void backgroundPush.toggle()}
                    />
                  </label>
                  <p className="uc-bell-tip">
                    {backgroundPush.message
                      ?? (!backgroundPush.supported
                        ? 'This browser cannot receive background notifications.'
                        : !backgroundPush.configured
                          ? 'Background reminders aren\'t available yet.'
                          : backgroundPush.permission === 'denied'
                            ? 'Blocked in your browser settings — allow notifications for this site, then flip this on.'
                            : backgroundPush.enabled
                              ? `On · ${backgroundPush.upcoming} reminders scheduled on the server.`
                              : 'Off — class and quiz reminders only arrive while UltraCC is open.')}
                    {backgroundPush.enabled && backgroundPush.healthNote && (
                      <span className="uc-bell-health acc-text">{backgroundPush.healthNote}</span>
                    )}
                  </p>
                </div>
              )}
              <p className="uc-bell-tip">Each notice fires once per device. Only the reminder times above are uploaded — never marks, attendance or credentials.</p>
            </div>
          ) : (
            <div className="uc-bell-log">
              {visible.length === 0 ? (
                <div className="uc-bell-empty">
                  <Bell size={20} aria-hidden="true" />
                  <b>You're all caught up.</b>
                  <p>Due assignments, attendance risks, exams and new marks will appear here.</p>
                </div>
              ) : (
                <ul className="uc-bell-list">
                  {visible.map((c) => {
                    const meta = CATEGORY_META[c.category];
                    const tone = c.urgency === 'critical' ? ' is-critical' : c.urgency === 'warning' ? ' is-warn' : '';
                    return (
                      <li key={c.id} className="uc-bell-row">
                        <meta.icon size={15} className={`uc-bell-ico${tone}`} />
                        <div className="uc-bell-row-text">
                          <p className="uc-bell-row-title">{c.title}</p>
                          <p className="uc-bell-row-body">{c.body}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
