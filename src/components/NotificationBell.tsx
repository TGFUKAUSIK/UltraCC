/**
 * NotificationBell.tsx — smart notifications UI for the header bell.
 *
 * Generates candidates from the already-synced datasets passed in via props,
 * evaluates them through the smartNotifications pipeline (prefs, dedup,
 * cap), and shows the result in a popover with per-category preferences.
 * The browser Notification API is used only when permission was granted;
 * the bell itself always works in-app.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellRing, Settings2, X, AlertTriangle, CalendarDays, BookOpen, ClipboardList, PartyPopper, Clock } from 'lucide-react';
import type { AssignmentRecord, AttendanceRecord, ExamRecord, CourseMarksRecord, TimetableSlot } from '../lib/vtop/types';
import type { BackgroundPushController } from '../hooks/useBackgroundPush';
import {
  generateNotificationCandidates, deliverNotifications, loadNotificationPrefs, saveNotificationPrefs,
  markAllSeen, recordMarksSeen, ALL_CATEGORIES, NotificationCategory, NotificationCandidate, NotificationPrefs,
} from '../lib/smartNotifications';
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
  /** Event Hub events (already fetched by the calendar view or app). */
  campusEvents: Array<{ eid: string; title: string; date: string }>;
  /** Background push controller (enables reminders while UltraCC is closed). */
  backgroundPush?: BackgroundPushController;
}

export const NotificationBell: React.FC<Props> = ({ assignments, attendance, exams, marks, timetable, campusEvents, backgroundPush }) => {
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
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-rose-50 text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div id="ultracc-notification-panel" className="absolute right-0 top-10 z-50 w-80 max-w-[calc(100vw-2rem)] bg-white border border-zinc-200 rounded-2xl shadow-2xl overflow-hidden" role="region" aria-label="Notifications">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
            {showPrefs ? (
              <>
                <span className="text-xs font-extrabold text-zinc-900">Notification preferences</span>
                <button onClick={() => setShowPrefs(false)} className="p-1 rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700" aria-label="Back to notifications"><X size={14} /></button>
              </>
            ) : (
              <>
                <span className="text-xs font-extrabold text-zinc-900">Notifications</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowPrefs(true)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700" aria-label="Notification preferences" title="Preferences"><Settings2 size={14} /></button>
                  <button onClick={onMarkRead} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 text-[10px] font-bold" title="Mark all as read">Mark read</button>
                </div>
              </>
            )}
          </div>

          {showPrefs ? (
            <div className="p-3 space-y-1">
              {permission === 'default' && (
                <div className="mb-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <p className="text-[11px] font-bold text-blue-700">Get reminders outside the app</p>
                  <p className="text-[10px] text-blue-700/80 mt-0.5">Allow system notifications to receive class reminders (~10 min before) and LMS quiz alerts even when this tab is in the background.</p>
                  <button onClick={() => void enableOsNotifications()} className="mt-2 px-3 py-1.5 rounded-lg acc-bg text-zinc-900 text-[10px] font-extrabold cursor-pointer">Enable notifications</button>
                </div>
              )}
              <label className="flex items-center justify-between px-2 py-2 rounded-xl hover:bg-zinc-50 cursor-pointer">
                <span className="text-xs font-bold text-zinc-800">All notifications</span>
                <input type="checkbox" checked={prefs.enabled} onChange={() => {
                  const next = { ...prefs, enabled: !prefs.enabled };
                  setPrefs(next); saveNotificationPrefs(next);
                }} className="accent-blue-600" />
              </label>
              <div className="pt-1 border-t border-zinc-100">
                {ALL_CATEGORIES.map((cat) => {
                  const meta = CATEGORY_META[cat];
                  return (
                    <label key={cat} className="flex items-center justify-between px-2 py-2 rounded-xl hover:bg-zinc-50 cursor-pointer">
                      <span className="text-[11px] text-zinc-600 flex items-center gap-2"><meta.icon size={13} className="text-zinc-500" /> {meta.label}</span>
                      <input type="checkbox" checked={prefs.categories[cat] !== false} onChange={() => toggleCategory(cat)} className="accent-blue-600" />
                    </label>
                  );
                })}
              </div>
              {backgroundPush && (
                <div className="pt-1 border-t border-zinc-100">
                  <label className="flex items-center justify-between px-2 py-2 rounded-xl hover:bg-zinc-50 cursor-pointer">
                    <span className="text-[11px] text-zinc-600 flex items-center gap-2">
                      <BellRing size={13} className="text-zinc-500" /> Even when UltraCC is closed
                    </span>
                    <input
                      type="checkbox"
                      aria-label="Background notifications (works when the app is closed)"
                      checked={backgroundPush.enabled}
                      disabled={backgroundPush.busy || !backgroundPush.supported || !backgroundPush.configured || backgroundPush.permission === 'denied'}
                      onChange={() => void backgroundPush.toggle()}
                      className="accent-blue-600"
                    />
                  </label>
                  <p className="text-[10px] text-zinc-500 px-2 pb-1 leading-relaxed">
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
                      <span className="block mt-0.5 acc-text font-semibold">{backgroundPush.healthNote}</span>
                    )}
                  </p>
                </div>
              )}
              <p className="text-[10px] text-zinc-500 px-2 pt-2">Each notice fires once per device. Only the reminder times above are uploaded — never marks, attendance or credentials.</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {visible.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell size={22} className="mx-auto text-zinc-900 mb-2" />
                  <p className="text-xs text-zinc-600">You're all caught up.</p>
                  <p className="text-[10px] text-zinc-500 mt-1">Due assignments, attendance risks, exams and new marks will appear here.</p>
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {visible.map((c) => {
                    const meta = CATEGORY_META[c.category];
                    const tone = c.urgency === 'critical' ? 'text-rose-600' : c.urgency === 'warning' ? 'text-amber-600' : 'text-zinc-500';
                    return (
                      <li key={c.id} className="px-4 py-3 flex gap-3">
                        <meta.icon size={15} className={`shrink-0 mt-0.5 ${tone}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-zinc-900 truncate">{c.title}</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5">{c.body}</p>
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
