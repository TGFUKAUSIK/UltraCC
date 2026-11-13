import React, { useEffect, useMemo, useState } from 'react';
import { Download, Info, X } from 'lucide-react';
import { AcademicCalendar, CalendarDay, TimetableSlot, ExamRecord, AssignmentRecord } from '../lib/vtop/types';
import { exportCalendarToIcs, downloadIcs } from '../utils/icalExport';
import { localDateIso, localTodayIso } from '../utils/localDate';
import { edgeFetch, HubEvent } from '../lib/edgeFetch';
import { buildEventOverlay, categoryMatches, CalendarCategoryFilter, presentCategories } from '../utils/calendarOverlay';
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
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type EventType = 'class' | 'exam' | 'assignment' | 'od' | 'holiday' | 'campus' | 'club';

/**
 * One dot per event kind, and nothing else. The colour lives on an 8px pip and
 * the label stays in ink, so a day cell reads the same in light, dark and
 * midnight — a filled chip would have painted the same hue in all three themes
 * and taken its label colour down with it.
 */
const EVENT_COLORS: Record<EventType, { dot: string; label: string }> = {
  class:      { dot: 'bg-emerald-400', label: 'Class' },
  exam:       { dot: 'bg-orange-400',  label: 'Exam' },
  assignment: { dot: 'bg-purple-400',  label: 'Assignment' },
  od:         { dot: 'bg-blue-400',    label: 'OD' },
  holiday:    { dot: 'bg-rose-400',    label: 'Holiday' },
  campus:     { dot: 'bg-sky-400',     label: 'Campus event' },
  club:       { dot: 'bg-fuchsia-400', label: 'Club event' },
};

type DayEvents = { types: EventType[]; details: { type: EventType; label: string }[]; classCount: number };

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
): Map<string, DayEvents> {
  const map = new Map<string, DayEvents>();

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

/**
 * One day of the term. The number leads the cell — that is what the grid is a
 * grid of — and the first two event kinds follow as a dot and a truncated label,
 * because a month view has to be readable at a glance but the day still has to
 * say what is on it without being tapped. The third event onward is a count.
 * Row height is fixed by `.calendar-grid`, so a long label truncates instead of
 * stretching its whole week taller.
 */
function DayCell({
  day, monthLabel, events, isToday, isCurrentMonth, onClick
}: {
  key?: React.Key;
  day: number; monthLabel: string; events: DayEvents | undefined;
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

  const primaryDot = isHoliday
    ? EVENT_COLORS.holiday.dot
    : hasExam
      ? EVENT_COLORS.exam.dot
      : hasOD
        ? EVENT_COLORS.od.dot
        : hasAssignment
          ? EVENT_COLORS.assignment.dot
          : classCount > 0
            ? EVENT_COLORS.class.dot
            : 'uc-cal-pip--none';

  const details = events?.details ?? [];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${day} ${monthLabel} — ${details.length ? `${details.length} ${details.length === 1 ? 'event' : 'events'}` : 'no events'}`}
      className={`calendar-day-cell uc-cal-cell${isToday ? ' is-today' : ''}${isHoliday ? ' is-off' : ''}`}
    >
      <span className="uc-cal-daylock">
        <b>{day}</b>
        <i className={`uc-cal-pip ${primaryDot}`} aria-hidden="true" />
        {classCount > 0 && !isHoliday && <small>{classCount}c</small>}
      </span>
      {details.length > 0 && (
        <span className="uc-cal-badges">
          {details.slice(0, 2).map((detail, index) => (
            <span key={`${detail.type}-${index}`} className="uc-cal-badge">
              <i className={EVENT_COLORS[detail.type].dot} aria-hidden="true" />
              <span>{detail.label}</span>
            </span>
          ))}
          {details.length > 2 && <span className="uc-cal-more">+{details.length - 2} more</span>}
        </span>
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
  dateStr: string; events: DayEvents | undefined;
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
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="calendar-day-sheet-body">
          {events.details.map((d, i) => (
            <div key={i} className="calendar-day-row uc-cal-entry">
              <i className={`uc-cal-pip ${EVENT_COLORS[d.type].dot}`} aria-hidden="true" />
              <span className="uc-cal-entry-kind">{EVENT_COLORS[d.type].label}</span>
              <span className="uc-cal-entry-text">{d.label}</span>
            </div>
          ))}
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
    const merged = new Map<string, DayEvents>([...dayEvents]);
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
    const filtered = new Map<string, DayEvents>();
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
      <div className="uc-cal-view pb-12">
        <section className="uc-plate uc-dir-mast">
          <div className="uc-dir-head">
            <div className="uc-dir-id">
              <span className="uc-cap">Academic calendar</span>
              <h2 className="uc-dir-name">Term at a glance</h2>
              <p className="uc-note">Instructional days, day orders and holidays from VTOP.</p>
            </div>
          </div>
        </section>
        <section className="uc-plate">
          <div className="uc-dir-detail">
            <div className="uc-note-row">
              <Info aria-hidden="true" />
              <span>
                Not loaded yet. Re-sync from <b>Login</b> and the VIT academic calendar appears here — every
                instructional day, day order and holiday VTOP publishes.
              </span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const monthLabel = `${MONTH_LABELS[month - 1]} ${year}`;
  const layers: [CalendarCategoryFilter, string][] = [['all', 'All'], ['academic', 'Academic (VTOP)']];
  if (overlayCategories.includes('campus')) layers.push(['campus', 'Campus events']);
  if (overlayCategories.includes('club')) layers.push(['club', 'Club events']);

  return (
    <div className="uc-cal-view pb-12">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">Academic calendar</span>
            <h2 className="uc-dir-name">Term at a glance</h2>
            <p className="uc-note">
              Instructional days, day orders and holidays from VTOP, with campus and club events layered on top.
            </p>
          </div>
          <div className="uc-dir-rail">
            {/* A minor action, so it stays one compact control beside the
                content — the term itself is the screen. */}
            <button
              type="button"
              onClick={() => { const ics = exportCalendarToIcs(calendar!); downloadIcs(ics, 'ultracc-academic-calendar.ics'); }}
              className="uc-cal-ico"
              title="Export calendar to .ics"
              aria-label="Export calendar to .ics"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="uc-cal-tools">
          <div className="uc-cal-scroll" role="group" aria-label="Month">
            {allMonthKeys.map((mk) => {
              const [y, m] = mk.split('-').map(Number);
              const isActive = mk === currentMonthKey;
              return (
                <button
                  key={mk}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setMonthOffset(allMonthKeys.indexOf(mk))}
                  className={`uc-cal-chip${isActive ? ' acc-bg' : ''}`}
                >
                  {MONTH_LABELS[m - 1].slice(0, 3)} {y}
                </button>
              );
            })}
          </div>

          <div className="uc-cal-scroll" role="group" aria-label="Event layers">
            {layers.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={categoryFilter === key}
                onClick={() => setCategoryFilter(key)}
                className={`uc-cal-chip uc-cal-chip--layer${categoryFilter === key ? ' acc-bg' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="uc-cal-legend">
            {(Object.entries(EVENT_COLORS) as [EventType, (typeof EVENT_COLORS)[EventType]][]).map(([key, c]) => (
              <span key={key}>
                <i className={`uc-cal-dot ${c.dot}`} aria-hidden="true" /> {c.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="uc-plate" aria-label={`${monthLabel} calendar`}>
        <div className="uc-plate-head">
          <span className="uc-cap">{monthLabel}</span>
          <span className="uc-dir-count">
            <b className="uc-num">{monthStats.classes}</b> class ·{' '}
            <b className="uc-num">{monthStats.holidays}</b> off ·{' '}
            <b className="uc-num">{monthStats.examDays}</b> exam
          </span>
        </div>

        <div className="uc-cal-board">
          <div className="calendar-grid uc-cal-weekdays" aria-hidden="true">
            {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
          </div>

          <div className="calendar-grid">
            {Array.from({ length: firstMondayOffset }).map((_, i) => (
              <div key={`empty-${i}`} className="calendar-day-cell calendar-day-cell--empty" aria-hidden />
            ))}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const iso = `${currentMonthKey}-${String(day).padStart(2, '0')}`;
              return (
                <DayCell
                  key={iso}
                  day={day}
                  monthLabel={monthLabel}
                  events={visibleDayEvents.get(iso)}
                  isToday={iso === today}
                  isCurrentMonth={true}
                  onClick={() => setSelectedDay(iso)}
                />
              );
            })}
          </div>
        </div>
      </section>

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
