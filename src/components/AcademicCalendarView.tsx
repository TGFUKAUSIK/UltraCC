import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Calendar, Download, Info, X } from 'lucide-react';
import { AcademicCalendar, CalendarDay, TimetableSlot, ExamRecord, AssignmentRecord } from '../lib/vtop/types';
import { exportCalendarToIcs, downloadIcs } from '../utils/icalExport';
import { localDateIso, localTodayIso } from '../utils/localDate';
import { edgeFetch, HubEvent } from '../lib/edgeFetch';
import { buildEventOverlay, categoryMatches, CalendarCategoryFilter, OverlayEntry, presentCategories } from '../utils/calendarOverlay';
import { useDialog } from '../hooks/useDialog';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface AcademicCalendarViewProps {
  calendar: AcademicCalendar | null;
  timetable?: TimetableSlot[];
  exams?: ExamRecord[];
  assignments?: AssignmentRecord[];
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
/** Timetable slots carry the full weekday name ('Monday'), so the badge below
 *  has to compare full names — with 'Mon' it never matched and every calendar
 *  day silently reported zero classes. */
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];type EventType = 'class' | 'exam' | 'assignment' | 'od' | 'holiday' | 'campus' | 'club';

const EVENT_COLORS: Record<EventType, { dot: string; bg: string; text: string; border: string; label: string }> = {
  class:      { dot: 'bg-emerald-400',  bg: 'bg-emerald-500/10', text: 'text-emerald-700', border: 'border-emerald-500/30', label: 'Class' },
  exam:       { dot: 'bg-orange-400',   bg: 'bg-orange-500/10',  text: 'text-orange-700',  border: 'border-orange-500/30',  label: 'Exam' },
  assignment: { dot: 'bg-purple-400',   bg: 'bg-purple-500/10',  text: 'text-purple-700',  border: 'border-purple-500/30',  label: 'Assignment' },
  od:         { dot: 'bg-blue-400',     bg: 'bg-blue-500/10',    text: 'text-blue-700',    border: 'border-blue-500/30',    label: 'OD' },
  holiday:    { dot: 'bg-rose-400',     bg: 'bg-rose-500/10',    text: 'text-rose-700',    border: 'border-rose-500/30',    label: 'Holiday' },
  campus:     { dot: 'bg-sky-400',      bg: 'bg-sky-500/10',     text: 'text-sky-700',     border: 'border-sky-500/30',     label: 'Campus event' },
  club:       { dot: 'bg-fuchsia-400',  bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-700', border: 'border-fuchsia-500/30', label: 'Club event' },
};

/** Count classes for a given day based on the timetable. */
function countClasses(dateStr: string, timetable: TimetableSlot[]): number {
  if (!timetable.length) return 0;
  const dayOfWeek = new Date(dateStr + 'T00:00:00').getDay();
  const dayName = WEEKDAY_LONG[dayOfWeek];
  return timetable.filter((s) => s.day === dayName).length;
}

/** Build events for each day from all data sources. */
function buildDayEvents(
  days: CalendarDay[],
  timetable: TimetableSlot[],
  exams: ExamRecord[],
  assignments: AssignmentRecord[]
): Map<string, { types: EventType[]; details: { type: EventType; label: string }[]; classCount: number }> {
  const map = new Map<string, { types: EventType[]; details: { type: EventType; label: string }[]; classCount: number }>();

  // Calendar days (holidays, CATs, etc.)
  for (const d of days) {
    const existing = map.get(d.date) || { types: [], details: [], classCount: 0 };
    if (!d.instructional) {
      existing.types.push('holiday');
      existing.details.push({ type: 'holiday', label: d.label || 'Holiday' });
    } else {
      const label = (d.label || '').toLowerCase();
      if (/\bcat\b|fat\b|exam/i.test(label)) {
        existing.types.push('exam');
        existing.details.push({ type: 'exam', label: d.label || 'Exam' });
      }
    }
    map.set(d.date, existing);
  }

  // Timetable — add class counts for weekdays
  for (const [dateStr, entry] of map) {
    entry.classCount = countClasses(dateStr, timetable);
    if (entry.classCount > 0 && !entry.types.includes('holiday')) {
      if (!entry.types.includes('class')) {
        entry.types.unshift('class');
        entry.details.unshift({ type: 'class', label: `Classes +${entry.classCount}` });
      }
    }
  }

  // For dates not in the calendar, still add class counts from timetable
  // (fill in missing weekdays based on semester range)
  if (days.length > 0) {
    const firstDate = new Date(days[0].date + 'T00:00:00');
    const lastDate = new Date(days[days.length - 1].date + 'T00:00:00');
    const cur = new Date(firstDate);
    while (cur <= lastDate) {
      const dateStr = localDateIso(cur);
      if (!map.has(dateStr)) {
        const cc = countClasses(dateStr, timetable);
        if (cc > 0) {
          map.set(dateStr, { types: ['class'], details: [{ type: 'class', label: `Classes +${cc}` }], classCount: cc });
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Exams
  for (const exam of exams) {
    if (exam.date) {
      const dateStr = exam.date.slice(0, 10);
      const existing = map.get(dateStr) || { types: [], details: [], classCount: 0 };
      if (!existing.types.includes('exam')) {
        existing.types.push('exam');
        existing.details.push({ type: 'exam', label: `${exam.courseCode} — ${exam.examType || 'Exam'}` });
        map.set(dateStr, existing);
      }
    }
  }

  // Assignments (due dates)
  for (const a of assignments) {
    if (a.dueDate) {
      const dateStr = a.dueDate.slice(0, 10);
      if (dateStr && dateStr !== 'null') {
        const existing = map.get(dateStr) || { types: [], details: [], classCount: 0 };
        if (!existing.types.includes('assignment')) {
          existing.types.push('assignment');
          existing.details.push({ type: 'assignment', label: `${a.courseCode} — ${a.title}` });
          map.set(dateStr, existing);
        }
      }
    }
  }

  return map;
}

/** Compact day cell — fixed row height, no aspect-square stretch on wide screens. */
function DayCell({
  day, events, isToday, isCurrentMonth, onClick
}: {
  key?: React.Key;
  day: number; events: { types: EventType[]; details: { type: EventType; label: string }[]; classCount: number } | undefined;
  isToday: boolean; isCurrentMonth: boolean; onClick: () => void;
}) {
  if (!isCurrentMonth) {
    return <div className="calendar-day-cell calendar-day-cell--empty" aria-hidden />;
  }

  const isHoliday = events?.types.includes('holiday');
  const hasExam = events?.types.includes('exam');
  const hasOD = events?.types.includes('od');
  const hasAssignment = events?.types.includes('assignment');
  const classCount = events?.classCount || 0;

  const primaryColor = isHoliday
    ? 'bg-rose-400'
    : hasExam
      ? 'bg-orange-400'
      : hasOD
        ? 'bg-blue-400'
        : hasAssignment
          ? 'bg-purple-400'
          : classCount > 0
            ? 'bg-emerald-400'
            : 'bg-zinc-200';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`calendar-day-cell flex flex-col items-start justify-start gap-0.5 p-1 sm:p-1.5 text-left transition-all cursor-pointer hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
        isToday
          ? 'ring-2 ring-blue-500/70 bg-zinc-100 border-blue-500/40'
          : isHoliday
            ? 'bg-rose-500/5 border-rose-800/30'
            : 'bg-zinc-50 border-zinc-200'
      }`}
    >
      <div className="flex items-center gap-1 w-full min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${primaryColor}`} />
        <span className={`text-[11px] sm:text-xs font-bold font-mono leading-none ${isToday ? 'text-zinc-900' : 'text-zinc-900'}`}>
          {day}
        </span>
      </div>
      {events && events.details.length > 0 && (
        <div className="mt-0.5 w-full min-w-0 overflow-hidden space-y-px" title={events.details.map((d) => d.label).join(' • ')}>
          {events.details.slice(0, 2).map((detail, index) => {
            const colors = EVENT_COLORS[detail.type];
            return (
              <span key={`${detail.type}-${index}`} className={`calendar-day-badge flex items-center gap-1 text-[7px] sm:text-[8px] font-bold uppercase tracking-wide px-1 py-px rounded border truncate max-w-full ${colors.bg} ${colors.text} ${colors.border}`}>
                <span className={`w-1 h-1 rounded-full shrink-0 ${colors.dot}`} />
                <span className="truncate">{detail.label}</span>
              </span>
            );
          })}
          {events.details.length > 2 && <span className="block text-[7px] sm:text-[8px] text-zinc-500 truncate px-1">+{events.details.length - 2} more</span>}
        </div>
      )}
    </button>
  );
}

/**
 * Day detail sheet — the app's shared modal contract, not a bare fixed div.
 *
 * WHY: this popover was `fixed inset-0 z-50 flex items-center justify-center`
 * with an unsized panel. On a phone the global sheet skin pinned it to the
 * bottom edge at `max-height:92dvh` with NO internal scroll, and z-50 sits
 * under the fixed app bar (z-60) and the tab bar (z-59) — so the bottom rows of
 * an ordinary day measured as covered by the tab bar
 * (`document.elementFromPoint` returned `NAV.mobile-tab-bar`).
 *
 * The first repair (z-80, real dialog, inner scroll) still left the sheet
 * mostly hidden on a real phone, for two reasons that only show up in the CSS:
 * the scrim carried `touch-action: none`, which touch-action inherits by
 * intersection and so cancelled the list's own `pan-y` — the header answered a
 * finger, the events did not; and the panel was bottom-aligned inside a scrim
 * sized by `inset: 0`, i.e. to the LAYOUT viewport that mobile browsers keep
 * taller than the visible area while their toolbar is up, with the tab-bar
 * clearance subtracted from `max-height` (which never moves a flex-end item's
 * bottom edge). `src/index.css` owns all three fixes and
 * `__tests__/academicCalendarSheet.test.tsx` pins them.
 *
 * Behaviour stays the shared one: centred dialog on desktop, bottom sheet on
 * phones, header pinned while the list scrolls inside the sheet, Escape/focus
 * handling from `useDialog`, document scroll lock, 44px close target.
 */
function DayPopover({
  dateStr, events, onClose
}: {
  dateStr: string; events: { types: EventType[]; details: { type: EventType; label: string }[]; classCount: number } | undefined;
  onClose: () => void;
}) {
  const open = !!events && events.details.length > 0;
  useBodyScrollLock(open);
  const panelRef = useDialog<HTMLDivElement>({ isOpen: open, onClose });
  if (!open) return null;
  const formatted = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });

  return (
    <div className="calendar-day-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="calendar-day-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-day-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="calendar-day-sheet-head">
          <h3 id="calendar-day-title" className="text-sm font-extrabold text-zinc-900">{formatted}</h3>
          <button type="button" onClick={onClose} className="calendar-day-sheet-close" aria-label={`Close ${formatted} details`}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="calendar-day-sheet-body">
          {events.details.map((d, i) => {
            const colors = EVENT_COLORS[d.type];
            return (
              <div key={i} className={`calendar-day-row flex items-center gap-2 px-3 py-2 rounded-xl ${colors.bg} border ${colors.border}`}>
                <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>{colors.label}</span>
                <span className="text-xs text-zinc-900 truncate flex-1">{d.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const AcademicCalendarView: React.FC<AcademicCalendarViewProps> = ({
  calendar, timetable = [], exams = [], assignments = []
}) => {
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [categoryFilter, setCategoryFilter] = useState<CalendarCategoryFilter>('all');
  // Campus-event overlay (Event Hub). Kept separate from the authoritative
  // VTOP calendar data and merged only at render time.
  const [campusEvents, setCampusEvents] = useState<HubEvent[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await edgeFetch<{ success: boolean; events?: HubEvent[] }>('event-hub');
        if (alive && data.success) setCampusEvents(data.events || []);
      } catch {
        // Overlay stays empty — the academic calendar is unaffected.
      }
    })();
    return () => { alive = false; };
  }, []);

  // All month keys from calendar data
  const allMonthKeys = useMemo(() => {
    if (!calendar?.days.length) return [];
    const keys = new Set<string>();
    for (const d of calendar.days) keys.add(d.date.slice(0, 7));
    return [...keys].sort();
  }, [calendar]);

  const dayEvents = useMemo(
    () => buildDayEvents(calendar?.days || [], timetable, exams, assignments),
    [calendar, timetable, exams, assignments]
  );

  const eventOverlay = useMemo(() => buildEventOverlay(campusEvents), [campusEvents]);
  const overlayCategories = useMemo(() => presentCategories(eventOverlay), [eventOverlay]);

  // Merge the overlay into the day-event map without touching VTOP rows.
  const mergedDayEvents = useMemo(() => {
    if (eventOverlay.size === 0) return dayEvents;
    const merged = new Map<string, { types: EventType[]; details: { type: EventType; label: string }[]; classCount: number }>([...dayEvents]);
    for (const [dateStr, entries] of eventOverlay) {
      const existing = merged.get(dateStr) || { types: [] as EventType[], details: [] as { type: EventType; label: string }[], classCount: 0 };
      for (const entry of entries) {
        existing.types.push(entry.category);
        existing.details.push({ type: entry.category, label: entry.label });
      }
      merged.set(dateStr, existing);
    }
    return merged;
  }, [dayEvents, eventOverlay]);

  const visibleDayEvents = useMemo(() => {
    if (categoryFilter === 'all') return mergedDayEvents;
    const filtered = new Map<string, { types: EventType[]; details: { type: EventType; label: string }[]; classCount: number }>();
    for (const [dateStr, entry] of mergedDayEvents) {
      const details = entry.details.filter((d) => categoryMatches(d.type, categoryFilter));
      if (details.length === 0) continue;
      filtered.set(dateStr, { ...entry, details, types: details.map((d) => d.type) });
    }
    return filtered;
  }, [mergedDayEvents, categoryFilter]);

  const currentMonthKey = allMonthKeys[Math.min(monthOffset, allMonthKeys.length - 1)] || allMonthKeys[0];
  const [year, month] = currentMonthKey ? currentMonthKey.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0=Sun
  // Convert to Monday-based (0=Mon)
  const firstMondayOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  const today = localTodayIso();

  const monthStats = useMemo(() => {
    let classes = 0, holidays = 0, examDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${currentMonthKey}-${String(d).padStart(2, '0')}`;
      const ev = visibleDayEvents.get(iso);
      if (ev) {
        if (ev.types.includes('holiday')) holidays++;
        else if (ev.classCount > 0) classes++;
        if (ev.types.includes('exam')) examDays++;
      }
    }
    return { classes, holidays, examDays };
  }, [currentMonthKey, daysInMonth, visibleDayEvents]);

  if (!calendar || !calendar.available || allMonthKeys.length === 0) {
    return (
      <div className="space-y-6 pb-12">
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600">
              <Calendar className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight">Academic Calendar</h2>
              <p className="text-xs text-zinc-500 font-medium">Instructional days, day orders and holidays from VTOP</p>
            </div>
          </div>
          <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-2xl text-xs text-zinc-500 flex items-start gap-2">
            <Info className="h-4 w-4 text-zinc-500 shrink-0 mt-0.5" />
            <span>
              Calendar not synced yet — re-sync from <strong className="text-zinc-900">Login</strong> to load the VIT academic calendar.
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12">
      {/* Month tabs */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-4 sm:p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-zinc-900 tracking-tight">Academic Calendar</h2>
              <p className="text-[10px] text-zinc-500 font-medium">
                {monthStats.classes} class days · {monthStats.holidays} holidays · {monthStats.examDays} exam days this month
              </p>
            </div>
          </div>
          <button
            onClick={() => { const ics = exportCalendarToIcs(calendar!); downloadIcs(ics, 'ultracc-academic-calendar.ics'); }}
            className="p-2 rounded-xl bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 transition cursor-pointer"
            title="Export calendar to .ics"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>

        {/* Month tab pills */}
        <div ref={scrollRef} className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
          {allMonthKeys.map((mk) => {
            const [y, m] = mk.split('-').map(Number);
            const label = `${MONTH_LABELS[m - 1].slice(0, 3).toUpperCase()} ${y}`;
            const isActive = mk === currentMonthKey;
            return (
              <button
                key={mk}
                onClick={() => setMonthOffset(allMonthKeys.indexOf(mk))}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                  isActive
                    ? 'bg-blue-600 text-zinc-900 shadow-lg shadow-blue-500/20'
                    : 'bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 hover:border-zinc-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Category filter — official academic vs campus/club overlay */}
        <div className="flex flex-wrap gap-2 mt-3">
          {([
            ['all', 'All'],
            ['academic', 'Academic (VTOP)'],
            ...(overlayCategories.includes('campus') ? [['campus', 'Campus events'] as const] : []),
            ...(overlayCategories.includes('club') ? [['club', 'Club events'] as const] : []),
          ] as [CalendarCategoryFilter, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setCategoryFilter(key)}
              aria-pressed={categoryFilter === key}
              className={`px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider border transition cursor-pointer ${
                categoryFilter === key
                  ? 'bg-blue-600 text-zinc-900 border-blue-500'
                  : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900 hover:border-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] text-zinc-500">
          {(Object.entries(EVENT_COLORS) as [EventType, typeof EVENT_COLORS[EventType]][]).map(([key, c]) => (
            <span key={key} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} /> {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* Month grid */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-4 sm:p-6 shadow-xl">
        {/* Weekday headers */}
        <div className="calendar-grid mb-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-center text-[9px] sm:text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 py-1">
              {w}
            </div>
          ))}
        </div>

        {/* Day cells — equal-height rows, compact cells */}
        <div className="calendar-grid">
          {Array.from({ length: firstMondayOffset }).map((_, i) => (
            <div key={`empty-${i}`} className="calendar-day-cell calendar-day-cell--empty" aria-hidden />
          ))}

          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const iso = `${currentMonthKey}-${String(day).padStart(2, '0')}`;
            const events = visibleDayEvents.get(iso);
            return (
              <DayCell
                key={iso}
                day={day}
                events={events}
                isToday={iso === today}
                isCurrentMonth={true}
                onClick={() => setSelectedDay(iso)}
              />
            );
          })}
        </div>
      </div>

      {/* Day detail popover */}
      {selectedDay && (
        <DayPopover
          dateStr={selectedDay}
          events={selectedDay ? visibleDayEvents.get(selectedDay) : undefined}
          onClose={() => setSelectedDay(null)}
        />
      )}

    </div>
  );
};
