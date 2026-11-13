import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building, Calculator, ChevronRight, Clock, Coffee, Image as ImageIcon, MapPin, Printer, Share2, ShieldCheck, X } from 'lucide-react';
import type { AttendanceRecord, TimetableSlot } from '../types';
import { encodeTimetableShare, describeShareContents, describeExpiry, decodeTimetableShare, ShareOptions } from '../lib/timetableShare';
import { computeFreeClasses } from '../utils/freeClasses';
import { AttendancePredictorSheet } from './AttendancePredictorSheet';
import { useDialog } from '../hooks/useDialog';
import { exportTimetableToPdf } from '../utils/printExport';
import { exportTimetableImage } from '../utils/imageExport';
import { currentTimetableDay, formatClassTime, getNextTimetableSlot, getOngoingTimetableSlot, getTimetableCellSlots, getTimetableContinuationSlots, getTimetableDaySlots, getTimetableDays, getTimetableGap, getTimetableTimeRows, isTimetableSlotOngoing, minutesOfDay, timetableTimeToMinutes, MIN_FREE_GAP_MINUTES } from '../utils/timetableGrid';
import { courseTone } from '../utils/courseTone';
import { isReal } from '../utils/placeholders';

interface TimetableViewProps {
  timetable: TimetableSlot[];
  attendance: AttendanceRecord[];
  onNavigateMap: (building: string) => void;
  /**
   * Open one course's class-by-class attendance record. A class on the board is
   * the natural way into its own record, so this travels up to the app rather
   * than teaching this view about the URL or the Academics drill-down.
   */
  onOpenCourse?: (courseCode: string) => void;
}

const formatDay = (day: TimetableSlot['day']) => day.slice(0, 3).toUpperCase();

/** The two import shapes the export helpers take, built from a slot once. */
const exportRow = (slot: TimetableSlot) => ({
  day: slot.day,
  startTime: slot.startTime,
  endTime: slot.endTime,
  courseCode: slot.courseCode,
  courseTitle: slot.courseTitle || '',
  slot: slot.slot || '',
  venue: slot.venue || '',
  faculty: slot.facultyName || '',
  isLab: slot.isLab,
});

function formatTime(value: string): string {
  return formatClassTime(value, value || 'Time unavailable');
}

/** A course code, or the least-committal true label available. */
function courseLabel(slot: TimetableSlot): string {
  return slot.courseCode || slot.slot || 'Class';
}

/** Minutes from the clock to a VTOP time today, or null when it is unreadable. */
function minutesUntil(value: string, now: Date): number | null {
  const at = timetableTimeToMinutes(value);
  return at === null ? null : at - minutesOfDay(now);
}

/** "12m" / "1h 05m" — the walk-between-classes unit, never seconds. */
function shortAway(minutes: number): string {
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${hours}h`;
}

/** The device clock as "2:05 PM", for the NOW marker's own label. */
function clockNow(date: Date): string {
  return formatClassTime(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
}

// courseTone moved to utils/courseTone.ts: the dashboard prints the same course
// in the same colour, and two copies of the mapping would drift.

/** One class in the week board: colour rule, code, room, time. */
const WeekClass: React.FC<{ slot: TimetableSlot; isToday: boolean; nextSlotId?: string; now: Date; onOpenCourse?: (courseCode: string) => void }> = ({ slot, isToday, nextSlotId, now, onOpenCourse }) => {
  const ongoing = isTimetableSlotOngoing(slot, now);
  const upcoming = slot.id === nextSlotId;
  const endMin = timetableTimeToMinutes(slot.endTime);
  // Only classes in today's column can be "finished"; another day's 08:00 is
  // not in the past just because this morning's clock ran past eight.
  const past = isToday && !ongoing && endMin !== null && minutesOfDay(now) > endMin;
  // The whole cell is the way into the course's class-by-class record. VTOP
  // codes every scheduled class, so it is openable whenever there is a code to
  // look up — and the room here is a plain label, not a control, so nothing sits
  // inside the target to steal the click or break the keyboard.
  const openable = !!onOpenCourse && !!slot.courseCode;
  const open = openable ? () => onOpenCourse?.(slot.courseCode) : undefined;
  return (
    <article
      className={`uc-wk-cell tone-${courseTone(slot.courseCode)}${ongoing ? ' is-now' : ''}${upcoming ? ' is-next' : ''}${past ? ' is-past' : ''}${openable ? ' is-openable' : ''}`}
      {...(openable ? {
        role: 'button',
        tabIndex: 0,
        onClick: open,
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open?.(); }
        },
      } : {})}
    >
      <div className="uc-wk-top">
        <span className="uc-wk-code">{courseLabel(slot)}</span>
        <span className="uc-wk-tail">
          {/* VTOP's own slot label for this session ("A1", "L31+L32"), kept
              secondary to the code and omitted cleanly when VTOP sent none. */}
          {slot.slot && slot.courseCode && <span className="uc-wk-slotcode">{slot.slot}</span>}
          {ongoing && <span className="uc-wk-flag is-now">Now</span>}
          {!ongoing && upcoming && <span className="uc-wk-flag is-next">Next</span>}
        </span>
      </div>
      <strong className="uc-wk-title">{slot.courseTitle || 'Course name unavailable'}</strong>
      <span className="uc-wk-meta">{slot.isLab ? 'Lab' : 'Theory'}{isReal(slot.facultyName) ? ` · ${slot.facultyName.trim()}` : ''}</span>
      {isReal(slot.venue) && <span className="uc-wk-venue"><MapPin size={10} />{slot.venue}</span>}
      <span className="uc-wk-time uc-num">{formatTime(slot.startTime)}–{formatTime(slot.endTime)}</span>
    </article>
  );
};

/** One class in the day rail: time on the spine, the rest beside it. */
const RailClass: React.FC<{ slot: TimetableSlot; isToday: boolean; nextSlotId?: string; now: Date; onNavigateMap: (building: string) => void; onOpenCourse?: (courseCode: string) => void }> = ({ slot, isToday, nextSlotId, now, onNavigateMap, onOpenCourse }) => {
  const ongoing = isTimetableSlotOngoing(slot, now);
  const upcoming = slot.id === nextSlotId;
  const endMin = timetableTimeToMinutes(slot.endTime);
  const past = isToday && !ongoing && endMin !== null && minutesOfDay(now) > endMin;
  const away = upcoming ? minutesUntil(slot.startTime, now) : null;
  // Tapping anywhere on the row opens the course's class-by-class record, the
  // same record the Academics weekly list offers. A venue chip already lives in
  // the row and a button cannot nest in a button, so the row stays an <article>
  // with a plain click and the keyboard gets its own explicit control below.
  const openable = !!onOpenCourse && !!slot.courseCode;
  return (
    <article
      className={`uc-tt-slot tone-${courseTone(slot.courseCode)}${ongoing ? ' is-now' : ''}${past ? ' is-past' : ''}${openable ? ' is-openable' : ''}`}
      onClick={openable ? () => onOpenCourse?.(slot.courseCode) : undefined}
    >
      <div className="uc-tt-slot-time">
        <b>{formatTime(slot.startTime)}</b>
        <small>{formatTime(slot.endTime)}</small>
      </div>
      <div className="uc-tt-slot-main">
        <div className="uc-tt-slot-top">
          <span className="uc-tt-code">{courseLabel(slot)}</span>
          <span className="uc-tt-slot-tail">
            {slot.slot && slot.courseCode && <span className="uc-tt-slotcode">{slot.slot}</span>}
            {ongoing && <span className="uc-tt-flag is-now"><span className="timetable-live-dot" aria-hidden="true" />Now</span>}
            {!ongoing && upcoming && <span className="uc-tt-flag is-next">Next{away !== null ? ` · ${shortAway(away)}` : ''}</span>}
          </span>
        </div>
        <strong className="uc-tt-slot-title">{slot.courseTitle || 'Course name unavailable'}</strong>
        <span className="uc-tt-slot-meta">{slot.isLab ? 'Lab' : 'Theory'}{isReal(slot.facultyName) ? ` · ${slot.facultyName.trim()}` : ''}</span>
        <div className="uc-tt-slot-foot">
          {isReal(slot.venue)
            ? <button className="timetable-map-link" onClick={(event) => { event.stopPropagation(); onNavigateMap(slot.venue); }}><MapPin size={12} />{slot.venue}</button>
            : <span className="uc-tt-venue-missing">Room not published</span>}
          {openable && (
            <button
              className="uc-tt-slot-open"
              onClick={(event) => { event.stopPropagation(); onOpenCourse?.(slot.courseCode); }}
            >
              Daily attendance <ChevronRight size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

export const TimetableView: React.FC<TimetableViewProps> = ({ timetable, attendance, onNavigateMap, onOpenCourse }) => {
  const [selectedDay, setSelectedDay] = useState<TimetableSlot['day']>(currentTimetableDay() || 'Monday');
  const [predictorOpen, setPredictorOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const closeShare = () => setShareOpen(false);
  // Escape closes, Tab stays inside the sheet, focus returns to the trigger.
  const shareRef = useDialog<HTMLDivElement>({ isOpen: shareOpen, onClose: closeShare });
  const [shareOptions, setShareOptions] = useState<ShareOptions>({});
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  // Drag the sheet's header down to dismiss it. Phone-only ergonomics: the
  // close button is still there for anyone who does not drag, and the drag
  // lives on the header so scrolling the body never moves the sheet.
  const [sheetDrag, setSheetDrag] = useState(0);
  const sheetDragFrom = useRef<number | null>(null);
  const currentDay = currentTimetableDay();
  // Re-evaluate "Ongoing"/"Next" states on a minute ticker so a class that
  // starts or ends while the timetable is on screen updates by itself.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const timeRows = useMemo(() => getTimetableTimeRows(timetable), [timetable]);
  const weekDays = useMemo(() => getTimetableDays(timetable), [timetable]);
  const daySlots = useMemo(() => getTimetableDaySlots(timetable, selectedDay), [timetable, selectedDay]);
  const nextSlot = useMemo(() => getNextTimetableSlot(timetable, now), [timetable, now]);
  const ongoingSlot = useMemo(() => getOngoingTimetableSlot(timetable, now), [timetable, now]);
  const freeClassSummary = computeFreeClasses(selectedDay, daySlots);

  // The day's sessions grouped by start time, so a lab and the theory VTOP files
  // in the same hour read as one row rather than two stacked cards.
  const dayRows = useMemo(() => {
    const byStart = new Map<string, { startTime: string; endTime: string; slots: TimetableSlot[] }>();
    for (const slot of daySlots) {
      const existing = byStart.get(slot.startTime);
      if (!existing) {
        byStart.set(slot.startTime, { startTime: slot.startTime, endTime: slot.endTime, slots: [slot] });
        continue;
      }
      existing.slots.push(slot);
      if ((timetableTimeToMinutes(slot.endTime) ?? 0) > (timetableTimeToMinutes(existing.endTime) ?? 0)) existing.endTime = slot.endTime;
    }
    return [...byStart.values()].sort((a, b) => (timetableTimeToMinutes(a.startTime) ?? 0) - (timetableTimeToMinutes(b.startTime) ?? 0));
  }, [daySlots]);

  const isToday = selectedDay === currentDay;
  const nextAway = nextSlot ? minutesUntil(nextSlot.startTime, now) : null;

  // Where the present falls in today's rail. The marker sits just above the
  // first session that has not finished yet, and at the foot of the day once
  // they all have — so everything above the line is over and everything below
  // it is still to come. It is drawn for today only: no other day has a "now".
  // -1 means "no session is still ahead", which draws it last.
  const nowMarkerIndex = useMemo(() => {
    if (!isToday || dayRows.length === 0) return -1;
    const at = minutesOfDay(now);
    return dayRows.findIndex((row) => (timetableTimeToMinutes(row.endTime) ?? Number.POSITIVE_INFINITY) > at);
  }, [isToday, dayRows, now]);

  /** Step the day rail by one weekday; the week strip and the swipe both use it. */
  const stepDay = (delta: number) => {
    const nextDay = weekDays[weekDays.indexOf(selectedDay) + delta];
    if (nextDay) setSelectedDay(nextDay);
  };

  // Swipe the rail sideways to change day. Kept local and presentation-only: it
  // reads the same weekDays order the strip does, and ignores a diagonal drag so
  // scrolling the rail never flips the day under the student's thumb.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // A swipe that changes the day must not also read as a tap on the class under
  // the finger — the two gestures end at the same instant. The rail swallows the
  // click a completed swipe leaves behind, before any row can open a course.
  const swipeGuard = useRef(0);
  const onRailTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
  };
  const onRailTouchEnd = (event: React.TouchEvent) => {
    const from = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!from || !touch) return;
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    // A completed swipe changes the day, and the browser still delivers the click
    // that follows the finger up. Stamp the moment so the rail can tell that click
    // apart from a genuine tap before it reaches a class under the thumb.
    swipeGuard.current = Date.now();
    stepDay(dx < 0 ? 1 : -1);
  };
  // Capture, not bubble: this runs on the way down to the row, so the click a swipe
  // leaves behind never opens the course the finger happened to lift off. 400ms is
  // wider than any tap a student makes on purpose. A plain tap never stamps the
  // guard, so every real tap still opens its class.
  const onRailClickCapture = (event: React.MouseEvent) => {
    if (Date.now() - swipeGuard.current < 400) {
      event.stopPropagation();
      event.preventDefault();
    }
  };

  // Pointer events, not touch events: a touchmove listener is the exact shape
  // the pull-to-refresh bug was built from, and mobileScrollRefresh.test.ts bans
  // it outright. Pointer capture gives the same drag — and it keeps the pointer
  // routed to the header even when the finger wanders off it — without ever
  // putting a touchmove handler on the page. Mouse users keep the close button.
  const onSheetDragStart = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    sheetDragFrom.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onSheetDragMove = (event: React.PointerEvent) => {
    const from = sheetDragFrom.current;
    if (from === null) return;
    setSheetDrag(Math.max(0, event.clientY - from));
  };
  const onSheetDragEnd = () => {
    const dragged = sheetDrag;
    sheetDragFrom.current = null;
    setSheetDrag(0);
    if (dragged > 72) closeShare();
  };

  // The present, drawn as a rule across the day rail. It reads as a divider, not
  // a control — a student scrolling a timetable wants to know where "now" is,
  // not to interact with it — so it stays out of the tab order and announces
  // itself only to a screen reader.
  const nowMarker = (
    <div className="uc-tt-now" role="separator" aria-label={`Now, ${clockNow(now)}`}>
      <span>Now</span>
      <span className="uc-num">{clockNow(now)}</span>
    </div>
  );

  return (
    <div className="timetable-view timetable-portal-view uc-tt">
      <header className="uc-plate uc-tt-head">
        <div className="uc-tt-head-id">
          <span className="uc-cap">Academic schedule</span>
          <h2 className="uc-tt-title">Timetable</h2>
          <p className="uc-note">{timetable.length > 0 ? `${weekDays.length} days · ${timetable.length} ${timetable.length === 1 ? 'class' : 'classes'} from your VTOP timetable` : 'Sync VTOP to load your weekly schedule.'}</p>
        </div>
        <div className="uc-tt-actions">
          <button className="uc-tt-act" onClick={() => setPredictorOpen(true)}><Calculator size={14} /> Predict attendance</button>
          {timetable.length > 0 && <button className="uc-tt-act" aria-label="Save the timetable as a PDF" onClick={() => exportTimetableToPdf(timetable.map(exportRow), {})}><Printer size={14} /> PDF</button>}
          {timetable.length > 0 && <button className="uc-tt-act" aria-label="Download the timetable as an image" onClick={() => exportTimetableImage(timetable.map(exportRow), {})}><ImageIcon size={14} /> Image</button>}
          {timetable.length > 0 && <button className="uc-tt-act" aria-label="Share the timetable read-only" onClick={() => { setShareCode(null); setShareOpen(true); }}><Share2 size={14} /> Share</button>}
        </div>
      </header>

      {/* The one line a student reads from the corridor: the class running now, or
          the one they are walking to. Same departure-board grammar as Home. */}
      {ongoingSlot ? (
        <div className="uc-tt-live">
          <span className="uc-lamp uc-lamp--live">Now</span>
          <strong>{courseLabel(ongoingSlot)} · {ongoingSlot.courseTitle || 'Course'}</strong>
          <span className="uc-num">{ongoingSlot.venue ? `${ongoingSlot.venue} · ` : ''}until {formatTime(ongoingSlot.endTime)}</span>
        </div>
      ) : nextSlot && nextAway !== null ? (
        <div className="uc-tt-live is-next">
          <span className="uc-lamp">Next</span>
          <strong>{courseLabel(nextSlot)} · {nextSlot.courseTitle || 'Course'}</strong>
          <span className="uc-num">{nextSlot.venue ? `${nextSlot.venue} · ` : ''}{formatTime(nextSlot.startTime)} · in {shortAway(nextAway)}</span>
        </div>
      ) : null}

      <section className="timetable-week-panel uc-plate uc-tt-week">
        <header className="uc-plate-head">
          <div>
            <span className="uc-cap">The week</span>
            <h3>Every class, slot and room in one view</h3>
          </div>
          <span className="uc-tt-week-note">{currentDay ? `Today is ${currentDay}` : 'Select a day to see its classes'}</span>
        </header>
        {timeRows.length > 0 ? (
          <div className="timetable-week-scroll">
            <table className="timetable-week-table">
              <thead><tr><th scope="col" className="timetable-time-heading">Time</th>{weekDays.map((day) => <th scope="col" key={day} className={currentDay === day ? 'is-today' : ''}><span>{formatDay(day)}</span><small>{getTimetableDaySlots(timetable, day).length} {getTimetableDaySlots(timetable, day).length === 1 ? 'class' : 'classes'}</small></th>)}</tr></thead>
              <tbody>
                {timeRows.map((row, index) => {
                  const gap = getTimetableGap(timetable, row, timeRows[index + 1]);
                  return <React.Fragment key={row.startTime}>
                    <tr>
                      <th scope="row" className="timetable-time-cell"><strong>{formatTime(row.startTime)}</strong><small>to {formatTime(row.endTime)}</small></th>
                      {weekDays.map((day) => {
                        const cells = getTimetableCellSlots(timetable, day, row.startTime);
                        if (cells.length > 0) return <td key={`${day}-${row.startTime}`} className={currentDay === day ? 'is-today' : ''}>{cells.map((slot) => <WeekClass key={slot.id} slot={slot} isToday={currentDay === day} nextSlotId={nextSlot?.id} now={now} onOpenCourse={onOpenCourse} />)}</td>;
                        // A two-period lab starts in an earlier row but still covers
                        // this one. Calling that cell "Free" contradicted the class
                        // card directly above it, so say which session continues.
                        const continues = getTimetableContinuationSlots(timetable, day, row.startTime);
                        const continuesUntil = continues.reduce((latest, slot) => (slot.endTime.localeCompare(latest) > 0 ? slot.endTime : latest), continues[0]?.endTime ?? '');
                        return <td key={`${day}-${row.startTime}`} className={currentDay === day ? 'is-today' : ''}>{continues.length > 0 ? <span className="timetable-continues-cell">{continues.map(courseLabel).join(' · ')} <small>continues until {formatTime(continuesUntil)}</small></span> : <span className="timetable-free-cell">Free</span>}</td>;
                      })}
                    </tr>
                    {/* The row spans the whole week, and the gap is only reported
                        when no class on any day runs through it — so say which
                        claim it is, instead of a day-level card disagreeing. */}
                    {gap && <tr className="timetable-lunch-row"><th scope="row">{gap.isLunch ? 'Lunch' : 'Break'}</th><td colSpan={weekDays.length}>{formatTime(gap.start)} – {formatTime(gap.end)} <span>No classes scheduled on any day</span></td></tr>}
                  </React.Fragment>;
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="timetable-empty-state"><Clock size={20} /><strong>Timetable data is not available</strong><span>Sync VTOP to load the weekly schedule.</span></div>}
      </section>

      <section className="timetable-mobile-panel uc-tt-day">
        {/* The week strip: seven days the thumb can drag or tap, with today
            marked and the selected day carried on the student's own accent. */}
        <div
          className="timetable-mobile-day-tabs uc-tt-strip"
          role="tablist"
          aria-label="Timetable day selection"
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); stepDay(1); }
            else if (event.key === 'ArrowLeft') { event.preventDefault(); stepDay(-1); }
          }}
        >
          {weekDays.map((day) => <button key={day} role="tab" aria-selected={selectedDay === day} className={`${selectedDay === day ? 'active' : ''} ${currentDay === day ? 'today' : ''}`} onClick={() => setSelectedDay(day)}><span>{formatDay(day)}</span><small>{getTimetableDaySlots(timetable, day).length}</small></button>)}
        </div>
        <div className="uc-tt-day-head">
          <div><span className="uc-cap">{isToday ? 'Today' : 'Selected day'}</span><h3>{selectedDay}</h3></div>
          <strong className="uc-num">{daySlots.length} {daySlots.length === 1 ? 'class' : 'classes'}</strong>
        </div>
        {/* key restarts the rise animation when the day changes, so the swipe
            lands somewhere rather than swapping text in place. */}
        <div className="uc-tt-rail" key={selectedDay} onTouchStart={onRailTouchStart} onTouchEnd={onRailTouchEnd} onClickCapture={onRailClickCapture}>
          {dayRows.map((row, index) => {
            const gap = getTimetableGap(daySlots, row, dayRows[index + 1]);
            return <React.Fragment key={row.startTime}>
              {index === nowMarkerIndex && nowMarker}
              {row.slots.map((slot) => <RailClass key={slot.id} slot={slot} isToday={isToday} nextSlotId={nextSlot?.id} now={now} onNavigateMap={onNavigateMap} onOpenCourse={onOpenCourse} />)}
              {gap && <div className="uc-tt-break"><span className="uc-cap">{gap.isLunch ? 'Lunch' : 'Break'}</span><span className="uc-num">{formatTime(gap.start)} – {formatTime(gap.end)}</span><span>{gap.minutes}m free</span></div>}
            </React.Fragment>;
          })}
          {/* Every session today has already ended, so the present sits at the foot. */}
          {isToday && nowMarkerIndex === -1 && dayRows.length > 0 && nowMarker}
          {dayRows.length === 0 && <div className="timetable-empty-state"><Clock size={20} /><strong>Free day</strong><span>No classes scheduled for {selectedDay}.</span></div>}
        </div>
        <button className="timetable-mobile-predictor" onClick={() => setPredictorOpen(true)}><Calculator size={15} /> Predict attendance for {formatDay(selectedDay)}</button>
      </section>

      <section className="timetable-support-grid">
        <div className="timetable-support-card"><div className="timetable-support-title"><div><span className="uc-cap">Selected day</span><h3>{selectedDay} availability</h3></div><Coffee size={16} /></div><div className="timetable-free-summary">{/* VTOP publishes no standard FFCS period table for every day — a
            Sunday class is real, but there is no set of periods to call free or
            busy against. "0 / 0" read as a fully-booked day to a student who
            had nothing scheduled, so an uncountable day says so instead. The
            periods counted here are VTOP's theory periods — a 12:30 lab batch
            sits in the lunch hour, not in the published period table — so the
            headline names what it counts. */freeClassSummary.freeCount === null ? (
            <strong>Not available<small>{selectedDay} has no FFCS period table</small></strong>
          ) : (
            <strong>{freeClassSummary.freeCount}<small> / {freeClassSummary.totalPeriods} free theory periods</small></strong>
          )}{/* The minutes and the chips both come from the same gap list, so
            the headline and the detail cannot quote different free time. The
            count stays silent when the day only has short changeovers, because
            a five-minute walk between rooms is not time anyone can use. */}<span>{freeClassSummary.freeMinutes > 0
              ? `${freeClassSummary.freeMinutes} minutes free in ${freeClassSummary.gaps.length} usable ${freeClassSummary.gaps.length === 1 ? 'gap' : 'gaps'} of ${MIN_FREE_GAP_MINUTES}+ min`
              : `No free window of ${MIN_FREE_GAP_MINUTES}+ minutes`}</span></div>{freeClassSummary.gaps.length > 0 && <div className="timetable-free-windows">{freeClassSummary.gaps.map((window) => <span key={`${window.start}-${window.end}`}>{formatTime(window.start)} – {formatTime(window.end)} · {window.minutes}m</span>)}</div>}</div>
        <div className="timetable-support-card"><div className="timetable-support-title"><div><span className="uc-cap">Venue lookup</span><h3>Find a classroom</h3></div><MapPin size={16} /></div><p>Open the campus map for a room from the live timetable.</p><button className="timetable-map-link" onClick={() => onNavigateMap('')}><Building size={13} /> Open VIT WayFinder</button></div>
      </section>

      {predictorOpen && <AttendancePredictorSheet timetable={timetable} attendance={attendance} initialDay={selectedDay} onClose={() => setPredictorOpen(false)} />}

      {shareOpen && (
        <div className="uc-overlay fixed inset-0 z-[70]" onClick={() => setShareOpen(false)}>
          <div
            ref={shareRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="timetable-share-title"
            className="uc-sheet"
            style={sheetDrag ? { transform: `translateY(${sheetDrag}px)`, transition: 'none' } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="uc-sheet-head" onPointerDown={onSheetDragStart} onPointerMove={onSheetDragMove} onPointerUp={onSheetDragEnd} onPointerCancel={onSheetDragEnd}>
              <div>
                <span className="uc-cap">Read-only</span>
                <h3 id="timetable-share-title">Share timetable</h3>
              </div>
              <button className="uc-sheet-close" onClick={closeShare} aria-label="Close share dialog"><X size={18} /></button>
            </header>
            <div className="uc-sheet-body">
              {shareCode ? (
                <div className="uc-sheet-stack">
                  <div className="uc-sheet-note"><ShieldCheck size={15} /><span>{describeExpiry(decodeTimetableShare(shareCode)?.data?.expiresAt ?? 0)} · paste this code into another UltraCC to view</span></div>
                  <textarea readOnly value={shareCode} rows={5} onFocus={(e) => e.currentTarget.select()} className="uc-sheet-code" aria-label="Timetable share code" />
                  <button
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(shareCode); } catch { /* clipboard unavailable — text is selectable */ }
                      setShareCopied(true);
                      setTimeout(() => setShareCopied(false), 2000);
                    }}
                    className="uc-sheet-action"
                  >
                    {shareCopied ? 'Copied' : 'Copy share code'}
                  </button>
                </div>
              ) : (
                <div className="uc-sheet-stack">
                  <p className="uc-note">Generate a read-only code a friend can paste into their own UltraCC. Nothing is uploaded — the code is self-contained text.</p>
                  <ul className="uc-sheet-list">
                    {describeShareContents(shareOptions).map((item) => (
                      <li key={item}><ShieldCheck size={14} /> {item}</li>
                    ))}
                  </ul>
                  <div className="uc-sheet-toggles">
                    <button onClick={() => setShareOptions((o) => ({ ...o, includeVenue: !o.includeVenue }))} aria-pressed={Boolean(shareOptions.includeVenue)} className={`uc-sheet-toggle${shareOptions.includeVenue ? ' is-on' : ''}`}>Venues</button>
                    <button onClick={() => setShareOptions((o) => ({ ...o, includeFaculty: !o.includeFaculty }))} aria-pressed={Boolean(shareOptions.includeFaculty)} className={`uc-sheet-toggle${shareOptions.includeFaculty ? ' is-on' : ''}`}>Faculty</button>
                    <select value={shareOptions.expiresInDays ?? 7} onChange={(e) => setShareOptions((o) => ({ ...o, expiresInDays: Number(e.target.value) }))} aria-label="Share code expiry" className="uc-sheet-select">
                      <option value={1}>1 day</option>
                      <option value={7}>7 days</option>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                    </select>
                  </div>
                  <button onClick={() => setShareCode(encodeTimetableShare(timetable, shareOptions))} className="uc-sheet-action is-primary">Generate share code</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
