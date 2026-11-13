/**
 * AcademicsView — attendance hub.
 *   Tab 1: Weekly Overview (day selector + course cards + daily planner)
 *   Tab 2: Attendance Predictor (per-course skip simulation)
 *   Tab 3: OD Tracker
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  AlertTriangle, CheckCircle2, Calendar, Sliders,
  TrendingUp, ChevronRight, Target, ArrowLeft,
} from 'lucide-react';
import { courseTone } from '../utils/courseTone';
import { isReal } from '../utils/placeholders';
import { AttendanceRecord, TimetableSlot } from '../types';
import { calculateBunkStats } from '../utils/nextActionEngine';
import { periodsPerClass } from '../utils/labSessions';
import {
  ATTENDANCE_TARGET_MAX, ATTENDANCE_TARGET_MIN, ATTENDANCE_TARGET_TICKS,
} from '../lib/settings';
import { useTargetAttendance } from '../lib/attendanceTarget';
import { matchAttendanceRecord } from '../utils/attendancePredictor';
import { attendanceBandCopy, attendancePercentLabel, attendanceTone, VTOP_ATTENDANCE_FLOOR } from '../utils/attendanceBands';
import {
  attendanceComponent, baseCourseCode, componentLabel, componentTotals, findCourseGroup,
  groupCourseAttendance, type ComponentAttendance,
} from '../utils/attendanceComponents';
import { exportAttendanceToPdf } from '../utils/printExport';
import { Printer } from 'lucide-react';
import { Image as ImageIcon } from 'lucide-react';
import { exportAttendanceImage } from '../utils/imageExport';
import { isTimetableSlotOngoing, minutesOfDay, timetableTimeToMinutes } from '../utils/timetableGrid';
import { OdSummary } from '../lib/vtop/types';

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface AcademicsViewProps {
  attendance: AttendanceRecord[];
  timetable: TimetableSlot[];
  od?: OdSummary | null;
}

type Tab = 'weekly' | 'predictor' | 'od';

/**
 * The chip the page opens on. `?subtab=` is written by the app itself — the
 * dashboard's OD figure links straight to the tracker instead of dropping the
 * student on the weekly list, and a refresh keeps the chip they chose. A value
 * that is not one of the three is ignored: an unknown chip is no chip, and the
 * weekly view is where this page always has an answer.
 */
const ACADEMICS_TABS: Tab[] = ['weekly', 'predictor', 'od'];

function initialSubtab(): Tab {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('subtab');
    if (fromUrl && ACADEMICS_TABS.includes(fromUrl as Tab)) return fromUrl as Tab;
  } catch { /* a page the browser will not give a URL for */ }
  return 'weekly';
}

/**
 * The course whose class-by-class record to open first, from `?course=`.
 *
 * Tapping a class in the Timetable lands here with the code in the URL, so the
 * drill-down opens on that subject instead of dropping the student on the weekly
 * list to find it again. The code is passed to `findCourseGroup`, which strips a
 * lab suffix, so a timetable `CSE2001L` still opens the `CSE2001` record.
 */
function initialCourse(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('course');
    return fromUrl ? fromUrl.trim().toUpperCase() : null;
  } catch { /* a page the browser will not give a URL for */ }
  return null;
}

type DayKey = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';

const DAYS: { key: DayKey; short: string; full: string }[] = [
  { key: 'MON', short: 'Mon', full: 'Monday' },
  { key: 'TUE', short: 'Tue', full: 'Tuesday' },
  { key: 'WED', short: 'Wed', full: 'Wednesday' },
  { key: 'THU', short: 'Thu', full: 'Thursday' },
  { key: 'FRI', short: 'Fri', full: 'Friday' },
  { key: 'SAT', short: 'Sat', full: 'Saturday' },
];

const DAY_SHORT_TO_KEY: Record<string, DayKey> = {
  Mon: 'MON', Tue: 'TUE', Wed: 'WED', Thu: 'THU', Fri: 'FRI', Sat: 'SAT',
};

function getTodayKey(): DayKey {
  const s = new Date().toLocaleDateString('en-US', { weekday: 'short' });
  return DAY_SHORT_TO_KEY[s] || 'MON';
}

function getWeekDates(now: Date = new Date()): { key: DayKey; date: Date; label: string; dayNum: number; isToday: boolean }[] {
  const curDay = now.getDay(); // 0=Sun
  const mondayOffset = curDay === 0 ? -6 : 1 - curDay;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  return DAYS.map((d, i) => {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    return {
      key: d.key,
      date: dt,
      label: d.short.toUpperCase(),
      dayNum: dt.getDate(),
      isToday: dt.toDateString() === now.toDateString(),
    };
  });
}

/* ── Date-wise attendance helpers ──────────────────────────────────────────── */

const VTOP_MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * VTOP's date-wise attendance rows carry "DD-MMM-YYYY" (e.g. "23-SEP-2026").
 * Parse it into a timestamp (for chronological order) plus a short human
 * label, so the list never re-dates what VTOP printed. Unparseable rows come
 * back null and are shown with their raw text rather than dropped or moved.
 */
function vtopDate(raw: string): { ts: number; label: string; weekday: string } | null {
  const m = (raw || '').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthIdx = VTOP_MONTHS[m[2].toUpperCase()];
  const year = parseInt(m[3], 10);
  if (!Number.isFinite(day) || monthIdx === undefined || !Number.isFinite(year)) return null;
  const dt = new Date(year, monthIdx, day);
  if (Number.isNaN(dt.getTime())) return null;
  // A Date built from parts does not object to "30-FEB" — it answers March 2nd.
  // If the day moved under us, VTOP's cell was not a date, and this row's own
  // promise is to show the raw text rather than a repaired one.
  if (dt.getDate() !== day || dt.getMonth() !== monthIdx) return null;
  const monthLabel = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
  return {
    ts: dt.getTime(),
    label: `${day} ${monthLabel}`,
    weekday: dt.toLocaleDateString('en-US', { weekday: 'short' }),
  };
}

/** VTOP's status cell on a class-by-class row: the dot's colour, the surface
 *  tint behind the word, and the word itself. The word is VTOP's own, never
 *  rewritten, and it is the signal — the tint only agrees with it. The word is
 *  printed in theme ink because the light-theme green at 10px is 3.8:1 on white,
 *  under the AA bar; colour is never the only carrier here. */
function statusTone(status: string): { dot: string; panel: string; label: string } {
  const s = (status || '').trim().toLowerCase();
  if (s === 'present') return { dot: 'uc-fill-safe', panel: 'uc-panel-safe', label: 'Present' };
  if (s === 'absent') return { dot: 'uc-fill-critical', panel: 'uc-panel-critical', label: 'Absent' };
  if (s.startsWith('on duty') || s.startsWith('onduty') || s === 'od') return { dot: 'uc-fill-info', panel: 'uc-panel-info', label: 'On Duty' };
  return { dot: 'uc-fill-unknown', panel: 'uc-panel-unknown', label: (status || '').trim() || '—' };
}

/* ── Main Component ────────────────────────────────────────────────────────── */

/**
 * Colour band for an attendance figure: the 75% university floor decides
 * "critical", the student's own target decides "safe". `null` (VTOP has not
 * conducted any class for this component yet) gets a neutral band — an
 * unknown is never painted green or red.
 *
 * The rule lives in `attendanceTone` because the summary cards count with it
 * too; a screen that coloured a course one way and counted it another is the
 * same bug the palette used to have.
 */
const toneOf = attendanceTone;

/**
 * The four bands as board tones: an ink class for a figure, a fill class for a
 * bar and a panel class for the surface a figure stands on. Each is defined once
 * in index.css from the shared tokens, so the green here is the same green the
 * rest of the app prints — and it survives a theme swap, which a literal
 * `text-emerald-600` did not (dark ink on a dark plate, and the shell's own
 * `p { color: muted }` re-map silently overruled the count on every card).
 */
const TONE_TEXT: Record<ReturnType<typeof toneOf>, string> = {
  safe: 'uc-ink-safe', warning: 'uc-ink-warning', critical: 'uc-ink-critical', unknown: 'uc-ink-unknown',
};

/** The bar fill for a band — the same four bands, the same three colours. */
const TONE_FILL: Record<ReturnType<typeof toneOf>, string> = {
  safe: 'uc-fill-safe', warning: 'uc-fill-warning', critical: 'uc-fill-critical', unknown: 'uc-fill-unknown',
};

const TONE_PANEL: Record<ReturnType<typeof toneOf>, string> = {
  safe: 'uc-panel-safe',
  warning: 'uc-panel-warning',
  critical: 'uc-panel-critical',
  unknown: 'uc-panel-unknown',
};

/**
 * One VTOP attendance component (theory / lab / project) as its own plate. Each
 * row is a separate VTOP record with its own conducted count, so they are shown
 * separately and never blended into one percentage.
 */
const ComponentBlock: React.FC<{ component: ComponentAttendance; safetyThreshold: number }> = ({ component, safetyThreshold }) => {
  const tone = toneOf(component.percentage, safetyThreshold);
  const rows = component.rows;
  return (
    <section className={`uc-plate uc-panel-${tone}`}>
      <div className="uc-plate-head">
        <span className="uc-cap">{componentLabel(component.kind)}</span>
        {component.percentage === null
          ? <span className="uc-note" style={{ margin: 0 }}>No classes conducted yet</span>
          : <span className="uc-acad-pct"><b className={TONE_TEXT[tone]}>{attendancePercentLabel(component.percentage)}%</b></span>}
      </div>
      <div className="uc-plate-foot">
        <span>
          {component.percentage === null
            ? `${component.attended}/${component.conducted} classes`
            : `${component.attended} / ${component.conducted} classes attended`}
        </span>
        {/* VTOP tracks the components under their own codes/slots — show which. */}
        {rows.length > 0 && (
          <span className="uc-num">
            {rows.map((r, i) => (
              <span key={`${r.courseCode}-${r.slot}-${i}`}>{i > 0 ? ' · ' : ''}{r.courseCode}{r.slot ? ` ${r.slot}` : ''}</span>
            ))}
          </span>
        )}
      </div>
    </section>
  );
};

export const AcademicsView: React.FC<AcademicsViewProps> = ({ attendance, timetable, od = null }) => {
  const [tab, setTab] = useState<Tab>(initialSubtab);
  const [selectedDay, setSelectedDay] = useState<DayKey>(getTodayKey());
  const [safetyThreshold, setSafetyThreshold] = useTargetAttendance();
  const [selectedCourse, setSelectedCourse] = useState<string | null>(initialCourse);
  const [filterStatus, setFilterStatus] = useState<'all' | 'present' | 'absent' | 'od'>('all');

  // The weekly list marks classes as running now or already over, so it needs a
  // clock that moves; frozen at mount these badges drift wrong by the second
  // period of the day.
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const tick = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(tick);
  }, []);
  // The chip belongs in the address bar the way the tab does: written on change,
  // and left out of the URL entirely on the default view, so a shared link says
  // exactly what the student is looking at.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (tab === 'weekly') url.searchParams.delete('subtab');
      else url.searchParams.set('subtab', tab);
      if (url.toString() !== window.location.href) window.history.replaceState({}, '', url.toString());
    } catch { /* web views with no URL to offer */ }
  }, [tab]);
  const weekDates = useMemo(() => getWeekDates(clock), [clock]);
  // Which day is on screen decides every time badge below: a Thursday class is
  // not "over" just because it is Thursday afternoon and the student is
  // looking at Friday.
  const selectedWeek = weekDates.find((d) => d.key === selectedDay) ?? null;
  const midnightOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const selectedDayStart = selectedWeek ? midnightOf(selectedWeek.date) : null;
  const todayStart = midnightOf(clock);
  const selectedDayIsToday = selectedDayStart !== null && selectedDayStart === todayStart;
  const selectedDayIsPast = selectedDayStart !== null && selectedDayStart < todayStart;
  const minutesNow = minutesOfDay(clock);

  // Build day → classes map from timetable.
  // Attendance is matched through the same confident matcher the predictor
  // uses, so a 2-slot lab session lands on the lab row and a theory period on
  // the theory row even when VTOP filed both under one course code.
  const dayClassesMap = useMemo(() => {
    const map: Record<DayKey, (TimetableSlot & { attendance?: AttendanceRecord })[]> = {
      MON: [], TUE: [], WED: [], THU: [], FRI: [], SAT: [],
    };
    for (const slot of timetable) {
      const dk = DAY_SHORT_TO_KEY[slot.day?.substring(0, 3)] || 'MON';
      const idx = matchAttendanceRecord(slot, attendance);
      map[dk].push({ ...slot, attendance: idx === null ? undefined : attendance[idx] });
    }
    // Sort by startTime
    for (const key of Object.keys(map) as DayKey[]) {
      map[key].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    }
    return map;
  }, [timetable, attendance]);

  const selectedDayClasses = dayClassesMap[selectedDay] || [];

  /** VTOP rows grouped per course — theory and lab stay separate rows. */
  const courseGroups = useMemo(() => groupCourseAttendance(attendance), [attendance]);

  // Course detail data: opening either the theory or the lab row of a course
  // shows the whole course, so both components are visible together.
  const selectedCourseData = useMemo(() => {
    if (!selectedCourse) return null;
    const group = findCourseGroup(selectedCourse, courseGroups);
    if (!group) return null;
    const codes = new Set(group.rows.map(r => r.courseCode.toUpperCase()));
    const slots = timetable.filter(t => codes.has((t.courseCode || '').toUpperCase()));
    return { group, slots };
  }, [selectedCourse, timetable, courseGroups]);

  // `?course=` is the Timetable's way in: it opens the drill-down on the subject
  // that was tapped. It is kept in step with the drill-down, so Back, a refresh
  // and a shared link all land on the same screen — and a code that matches no
  // course (a stale link, an attendance row not yet synced) is dropped from both
  // the screen and the address bar rather than left dangling over the weekly view.
  useEffect(() => {
    const resolved = selectedCourse && selectedCourseData ? selectedCourseData.group.courseCode : null;
    try {
      const url = new URL(window.location.href);
      if (resolved) url.searchParams.set('course', resolved);
      else url.searchParams.delete('course');
      if (url.toString() !== window.location.href) window.history.replaceState({}, '', url.toString());
    } catch { /* web views with no URL to offer */ }
    if (selectedCourse && !resolved) setSelectedCourse(null);
  }, [selectedCourse, selectedCourseData]);

  /**
   * Overall figures straight from VTOP's own rows: every conducted class
   * counts once. Theory and lab are reported separately as well, because a
   * single blended number hides which component is actually short.
   */
  const overallStats = useMemo(() => {
    const totals = componentTotals(attendance);
    return {
      total: totals.conducted,
      attended: totals.attended,
      // The number, plus the one text form of it. Screens print `percentageLabel`
      // so no surface can re-round the figure on the way to the student.
      percentage: totals.percentage,
      percentageLabel: totals.percentage === null ? '—' : attendancePercentLabel(totals.percentage),
      theory: totals.theory,
      lab: totals.lab,
      components: totals.present,
      // Counted per VTOP row, so a course with a weak lab half is flagged for
      // the component that is actually at risk (not for the whole course).
      coursesAtRisk: attendance.filter(a => a.percentage < safetyThreshold).length,
      coursesDebar: attendance.filter(a => a.percentage < VTOP_ATTENDANCE_FLOOR).length,
    };
  }, [attendance, safetyThreshold]);

  // Safe bunks per VTOP row (a row is one component of one course)
  const bunkStats = useMemo(() => {
    return attendance.map((a, index) => ({
      ...a,
      rowKey: `${a.courseCode}-${a.slot || a.type || index}`,
      component: attendanceComponent(a),
      bunk: calculateBunkStats(a, safetyThreshold),
    }));
  }, [attendance, safetyThreshold]);

  /**
   * Attendance summary cards — counted per COURSE, not per VTOP row, so a
   * course with both a theory and a lab row is not counted twice. A course is
   * only "safe" when every tracked component clears the target.
   *
   * A course with no percentage from VTOP at all lands in the middle card: it
   * is neither cleared nor debared, and the card says so in its own rule line —
   * at the default 75% bar that card can hold nothing else.
   */
  const summaryStats = useMemo(() => {
    let safe = 0, warning = 0, critical = 0;
    for (const group of courseGroups) {
      const tracked = group.components.filter(c => c.percentage !== null);
      if (tracked.length === 0) { warning += 1; continue; }
      if (tracked.some(c => (c.percentage ?? 0) < VTOP_ATTENDANCE_FLOOR)) critical += 1;
      else if (tracked.every(c => (c.percentage ?? 0) >= safetyThreshold)) safe += 1;
      else warning += 1;
    }
    // Keyed by the tone names, so a card cannot count one thing and label
    // another: the keys are the same three values `attendanceTone` returns.
    return { safe, warning, critical, total: courseGroups.length };
  }, [courseGroups, safetyThreshold]);

  /**
   * The All Courses chips, applied. Sorted worst first so the course that needs
   * attention is the first row a student sees.
   */
  const visibleBunks = useMemo(() => {
    return bunkStats
      .filter((b) => {
        if (filterStatus === 'present') return b.percentage >= safetyThreshold;
        if (filterStatus === 'absent') return b.percentage < VTOP_ATTENDANCE_FLOOR;
        if (filterStatus === 'od') return Boolean(b.slot?.includes('OD'));
        return true;
      })
      .sort((a, b) => a.percentage - b.percentage);
  }, [bunkStats, filterStatus, safetyThreshold]);

  /**
   * What to say when a filter matches nothing. A blank card reads as a page
   * that failed to load, so each filter names the reason in the student's own
   * terms — including the good-news case, where below 75% is empty.
   */
  const noCoursesNote = bunkStats.length === 0
    ? 'No attendance rows yet — sync your semester and they appear here.'
    : filterStatus === 'present'
      ? `No course is at your ${safetyThreshold}% bar yet. Attend a class, then sync again.`
      : filterStatus === 'absent'
        ? `Nothing is below ${VTOP_ATTENDANCE_FLOOR}% — every course clears the eligibility line.`
        : 'No on-duty rows in this attendance. OD days appear here once VTOP marks them.';

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'weekly', label: 'Weekly', icon: <Calendar className="h-4 w-4" /> },
    { id: 'predictor', label: 'Predictor', icon: <TrendingUp className="h-4 w-4" /> },
    { id: 'od', label: 'OD', icon: <Target className="h-4 w-4" /> },
  ];

  const courseFilters: { id: 'all' | 'present' | 'absent' | 'od'; label: string; hint: string }[] = [
    { id: 'all', label: 'All', hint: 'every course and lab row' },
    { id: 'present', label: 'On target', hint: `courses at or above your ${safetyThreshold}% bar` },
    { id: 'absent', label: `Below ${VTOP_ATTENDANCE_FLOOR}%`, hint: `courses short of VTOP’s ${VTOP_ATTENDANCE_FLOOR}% eligibility line` },
    { id: 'od', label: 'OD', hint: 'rows VTOP marked on duty' },
  ];

  /* ── Course Detail Subpage ─────────────────────────────────────────────── */
  if (selectedCourse && selectedCourseData) {
    const group = selectedCourseData.group;
    const pct = group.percentage;
    const tone = toneOf(pct, safetyThreshold);
    const components = group.components;
    const splitNote = components.length > 1
      ? components.map(c => `${componentLabel(c.kind)} ${c.percentage === null ? 'not started' : `${c.attended}/${c.conducted} = ${attendancePercentLabel(c.percentage)}%`}`).join(' · ')
      : null;

    // Date-wise attendance: the per-class detail rows VTOP serves alongside the
    // OD counts, matched to this course by base code (lab suffix stripped).
    // Cached OD data from before date capture predates `dates`, so guard it.
    const matchedOd = (od?.perCourse ?? []).filter((e) => baseCourseCode(e.courseCode) === group.courseCode);
    // Whether this OD record carries VTOP's per-class date rows at all. A record
    // written before the gateway served `dates` has none on any course: that is
    // "not downloaded yet", not "no classes" — saying the latter would be a fact
    // VTOP never gave. Only the loaded case may claim a course has no sessions.
    const historyLoaded = (od?.perCourse ?? []).some((e) => Array.isArray(e.dates));

    return (
      <div className="uc-acad">
        {/* Back + course header */}
        <section className="uc-plate">
          <div className="uc-plate-head">
            <button className="uc-dir-back" onClick={() => setSelectedCourse(null)}>
              <ArrowLeft size={13} /> Back to weekly view
            </button>
          </div>

          <div className="uc-acad-mast">
            <div className="uc-acad-head-id">
              <span className="uc-cap">Course</span>
              <h2 className="uc-acad-title">{group.courseCode}</h2>
              <p className="uc-acad-sub">{group.courseTitle || 'Course title unavailable'}</p>
              <p className="uc-acad-parts">
                {/* One entry per VTOP row: the slot label and the component VTOP
                    itself published — nothing here is inferred. */}
                {group.rows.map((r, i) => (
                  <span key={`${r.courseCode}-${r.slot}-${i}`}>
                    {r.slot || 'Slot unavailable'} <b>{r.courseCode}</b> <i>{componentLabel(attendanceComponent(r))}</i>
                  </span>
                ))}
                {group.rows.some(r => r.facultyName) && (
                  <span>Faculty <b>{group.rows.find(r => r.facultyName)?.facultyName}</b></span>
                )}
              </p>
            </div>

            {/* Combined percentage — the plain sum of VTOP's own rows. */}
            <div className={`uc-acad-figure uc-panel-${tone}`}>
              <b className={TONE_TEXT[tone]}>{pct === null ? '—' : `${attendancePercentLabel(pct)}%`}</b>
              <span>{group.attended}/{group.conducted} classes</span>
              {splitNote && <i>{splitNote}</i>}
            </div>
          </div>
        </section>

        {/* Class-by-class record — VTOP's own per-class Date / Day-timing / Status
            rows for this course, matched by base code. Dates are VTOP's; none are
            invented, and an unparseable date stays visible as its raw text. */}
        <section className="uc-plate">
          <div className="uc-plate-head">
            <span className="uc-cap">Class-by-class attendance</span>
            <span className="uc-note" style={{ margin: 0 }}>{historyLoaded ? 'VTOP’s own record · newest first' : 'Not downloaded yet'}</span>
          </div>
          {matchedOd.length === 0 ? (
            <div className="uc-empty">
              <span>
                {od?.perCourse?.length
                  ? 'No class-by-class record for this course yet.'
                  : 'Class-by-class record unavailable — sync your semester to load it.'}
              </span>
            </div>
          ) : !historyLoaded ? (
            <div className="uc-empty">
              <span>Attendance history has not been downloaded yet — refresh to load it from VTOP.</span>
            </div>
          ) : (
            matchedOd.map((entry) => {
              // Most recent class first: the student opens this list to see how
              // the latest sessions went, not to scroll the term from August. A
              // row whose date VTOP printed in a form we cannot read keeps its
              // raw text and sorts to the foot rather than moving to the top.
              const rows = [...(entry.dates ?? [])].sort((a, b) => {
                const ta = vtopDate(a.date)?.ts ?? 0;
                const tb = vtopDate(b.date)?.ts ?? 0;
                return tb - ta;
              });
              const showHeader = matchedOd.length > 1 || !!(entry.slot && entry.slot.trim());
              return (
                <React.Fragment key={`${entry.courseCode}-${entry.slot}`}>
                  {showHeader && (
                    <div className="uc-acad-log">
                      <span className="uc-acad-daytag">{entry.courseCode}</span>
                      {entry.slot && <span className="uc-tt-slotcode">{entry.slot}</span>}
                    </div>
                  )}
                  {rows.map((row, i) => {
                    const parsed = vtopDate(row.date);
                    const tone = statusTone(row.status);
                    return (
                      <div key={`${row.date}-${i}`} className="uc-acad-log">
                        <span className="uc-acad-dot"><i className={tone.dot} /></span>
                        <span className="uc-acad-log-body">
                          <strong>{parsed ? `${parsed.label} · ${parsed.weekday}` : (row.date || 'Date unavailable')}</strong>
                          {row.timing && <small>{row.timing}</small>}
                        </span>
                        <span className={`uc-acad-status ${tone.panel}`}>{tone.label}</span>
                      </div>
                    );
                  })}
                  {rows.length === 0 && (
                    <div className="uc-empty"><span>No sessions recorded{entry.slot ? ` for ${entry.slot}` : ''} yet.</span></div>
                  )}
                </React.Fragment>
              );
            })
          )}
        </section>

        {/* Theory / lab tracked separately, exactly as VTOP reports them */}
        {components.length > 1 && (
          <div className="uc-acad-pair">
            {components.map(c => <ComponentBlock key={c.kind} component={c} safetyThreshold={safetyThreshold} />)}
          </div>
        )}

        {/* Per-component detail: progress, bunks and status are computed from
            that component's own conducted count — never from a blended one. */}
        {components.map(component => {
          const componentTone = toneOf(component.percentage, safetyThreshold);
          return component.rows.map((row) => {
            const bunk = calculateBunkStats(row, safetyThreshold);
            const notStarted = row.totalHeld <= 0;
            const label = components.length > 1 || row.courseCode !== group.courseCode
              ? `${componentLabel(component.kind)} · ${row.courseCode}`
              : componentLabel(component.kind);
            // Which of the three verdict surfaces this row earns. "Not started"
            // is a fourth, quiet state — VTOP has held nothing to judge yet.
            const verdictBand = notStarted ? 'is-quiet'
              : (component.percentage ?? 0) < VTOP_ATTENDANCE_FLOOR ? 'is-risk'
                : bunk.safeToBunk ? 'is-good' : 'is-warn';
            return (
              <section key={`${row.courseCode}-${row.slot}-${component.kind}`} className="uc-plate">
                <div className="uc-plate-head">
                  <span className="uc-cap">{label}</span>
                  <span className="uc-acad-pct">
                    <b className={component.percentage === null ? '' : TONE_TEXT[componentTone]}>
                      {component.percentage === null ? '—' : `${attendancePercentLabel(component.percentage)}%`}
                    </b>
                  </span>
                </div>

                <div className="uc-acad-body">
                  <div className="uc-acad-stats">
                    {[
                      { label: 'Attended', value: `${row.attended}`, tone: 'uc-ink-safe' },
                      { label: 'Absent', value: `${Math.max(0, row.totalHeld - row.attended)}`, tone: 'uc-ink-critical' },
                      { label: 'Safe bunks', value: notStarted ? '—' : `${bunk.canBunk}`, tone: 'uc-ink-info' },
                      { label: 'Must attend', value: notStarted ? '—' : `${bunk.mustAttend}`, tone: 'uc-ink-warning' },
                    ].map(s => (
                      <div key={s.label} className="uc-acad-stat">
                        <b className={s.value === '—' ? '' : s.tone}>{s.value}</b>
                        <span>{s.label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="uc-acad-progress">
                    <span>Attendance progress</span>
                    <span className="uc-num">{row.attended}/{row.totalHeld}</span>
                  </div>
                  <div className="uc-acad-bar" role="img" aria-label={`${label} attendance ${component.percentage === null ? 'unavailable' : `${attendancePercentLabel(component.percentage)}%`}`}>
                    <i
                      className={TONE_FILL[componentTone]}
                      style={{ width: `${Math.min(100, component.percentage ?? 0)}%` }}
                    />
                  </div>
                  <div className="uc-acad-marks">
                    <span>0%</span>
                    <span>{VTOP_ATTENDANCE_FLOOR}% min</span>
                    <span>{safetyThreshold}% target</span>
                    <span>100%</span>
                  </div>

                  <div className={`uc-note-row uc-acad-verdict ${verdictBand}`}>
                    {notStarted ? (
                      <>
                        <AlertTriangle size={15} />
                        <span>VTOP has not conducted any {componentLabel(component.kind).toLowerCase()} class for this course yet.</span>
                      </>
                    ) : (
                      <>
                        {bunk.state === 'on-target' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                        <span>
                          <strong>{bunk.status}</strong>
                          <span>{bunk.message}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </section>
            );
          });
        })}

        {/* Course schedule — this course's own timetable rows (was previously
            the selected day's unrelated classes). */}
        <section className="uc-plate">
          <div className="uc-plate-head">
            <span className="uc-cap">Weekly schedule</span>
            <span className="uc-note" style={{ margin: 0 }}>
              {selectedCourseData.slots.length === 0
                ? 'Not in the synced timetable'
                : `${selectedCourseData.slots.length} ${selectedCourseData.slots.length === 1 ? 'period' : 'periods'} a week`}
            </span>
          </div>
          {selectedCourseData.slots.map((s) => (
            <div key={s.id || `${s.day}-${s.startTime}-${s.courseCode}`} className="uc-acad-log">
              <span className="uc-acad-daytag">{s.day?.substring(0, 3) || '—'}</span>
              <span className="uc-acad-log-body">
                <strong>{s.startTime}–{s.endTime}</strong>
                <small>{s.venue || 'Venue unavailable'}</small>
              </span>
              <span className="uc-tt-slotcode">{s.slot || '—'}</span>
            </div>
          ))}
          {selectedCourseData.slots.length === 0 && (
            <div className="uc-empty">
              <span>No scheduled classes found in the synced timetable.</span>
            </div>
          )}
        </section>
      </div>
    );
  }

  /* ── Main View ─────────────────────────────────────────────────────────── */
  return (
    <div className="uc-acad">
      {/* Masthead — the plate a student opens between two classes. It leads with
          where the attendance stands and the bar it is measured against, then
          the chips that move between the three views of it. */}
      <section className="uc-plate">
        <div className="uc-acad-mast">
          <div className="uc-acad-head-id">
            <span className="uc-cap">Academics · Attendance</span>
            <h2 className="uc-acad-title">Attendance</h2>
            <p className="uc-acad-sub">
              {/* The tone rides the dot, not the sentence: the light-theme green
                  at 11.5px is 3.8:1 on white, under the AA bar, so the words
                  stay theme ink and the colour is the second signal rather than
                  the only one. */}
              <span className="uc-acad-flag">
                <i className={overallStats.coursesAtRisk > 0 ? 'uc-fill-warning' : 'uc-fill-safe'} />
                {overallStats.coursesAtRisk > 0
                  ? `${overallStats.coursesAtRisk} course${overallStats.coursesAtRisk > 1 ? 's' : ''} below ${safetyThreshold}%`
                  : `All courses above ${safetyThreshold}%`}
              </span>
              {' · Overall '}
              <b>{overallStats.percentage === null ? 'Not available' : `${overallStats.percentageLabel}%`}</b>
            </p>
            {/* Theory and lab are separate VTOP records — never blended into one
                number without saying what each half actually is. */}
            {overallStats.components.length > 1 && (
              <p className="uc-acad-parts">
                {overallStats.components.map(c => (
                  <span key={c.kind}>
                    {componentLabel(c.kind)} <b>{c.percentage === null ? 'no classes yet' : `${attendancePercentLabel(c.percentage)}%`}</b> <i>({c.attended}/{c.conducted})</i>
                  </span>
                ))}
              </p>
            )}
          </div>

          {/* The two export actions, then the three views of the attendance. The
              chip the page is on carries `acc-bg` — the app's own selected-fill
              token — and deliberately no `aria-pressed`, which is the course
              filters' attribute further down this page. */}
          <div className="uc-chips uc-acad-tabs" role="group" aria-label="Attendance views">
            {attendance.length > 0 && (
              <button
                type="button"
                onClick={() => exportAttendanceToPdf(attendance.map(a => ({
                  courseCode: a.courseCode,
                  courseTitle: a.courseTitle,
                  attended: a.attended,
                  total: a.totalHeld,
                  percentage: a.percentage,
                  faculty: a.facultyName || '',
                })), { overall: overallStats.percentage ?? undefined })}
                aria-label="Print or save attendance report as PDF"
              >
                <Printer className="h-4 w-4" /> PDF
              </button>
            )}
            {attendance.length > 0 && (
              <button
                type="button"
                onClick={() => exportAttendanceImage(attendance.map(a => ({
                  courseCode: a.courseCode,
                  courseTitle: a.courseTitle,
                  attended: a.attended,
                  total: a.totalHeld,
                  percentage: a.percentage,
                  faculty: a.facultyName || '',
                })), {})}
                aria-label="Download attendance report as image"
              >
                <ImageIcon className="h-4 w-4" /> Image
              </button>
            )}
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? 'true' : undefined}
                onClick={() => setTab(t.id)}
                className={tab === t.id ? 'acc-bg' : undefined}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* The bar every figure on this page is measured against — the student's
            own target, saved as a preference and quoted on every card below. */}
        <div className="uc-acad-target">
          <div className="uc-acad-target-top">
            <span className="uc-acad-target-cap"><Sliders /> Target attendance</span>
            <span className="uc-acad-target-value">{safetyThreshold}%</span>
          </div>
          <input
            type="range"
            aria-label="Target attendance safety threshold"
            min={ATTENDANCE_TARGET_MIN}
            max={ATTENDANCE_TARGET_MAX}
            step="1"
            value={safetyThreshold}
            onChange={(e) => setSafetyThreshold(Number(e.target.value))}
            className="uc-acad-range"
          />
          <div className="uc-acad-ticks">
            {ATTENDANCE_TARGET_TICKS.map((t) => <span key={t}>{t}%</span>)}
          </div>
        </div>
      </section>

      {/* The verdict leads, on every chip except the OD tracker: where the
          attendance stands, the bar it is measured against, and the one
          sentence that answers "can I skip the next class". The per-course
          simulation and the weekly list below are the working. */}
      {tab !== 'od' && <BunksVerdict attendance={attendance} target={safetyThreshold} />}

      {/* ─── WEEKLY TAB ──────────────────────────────────────────────────── */}
      {tab === 'weekly' && (
        <>
          {/* Summary cards. Each count quotes the line it was counted against,
              generated from the same rule that colours the rows below — a bare
              "Warning 2" asks the student to trust a threshold they never chose
              and cannot see. The `is-*` class paints the figure; the count
              itself stays a `<p>` and a first child, because that is what the
              card's contract with the rest of the page says. */}
          <div className="academics-summary-grid uc-acad-bands">
            {attendanceBandCopy(safetyThreshold).map((band) => (
              <div
                key={band.tone}
                className={`uc-acad-band-card ${TONE_PANEL[band.tone]} is-${band.tone}`}
                aria-label={`${summaryStats[band.tone]} course${summaryStats[band.tone] === 1 ? '' : 's'} ${band.label.toLowerCase()}: ${band.rule}`}
              >
                <p>{summaryStats[band.tone]}</p>
                <p className="uc-cap">{band.label}</p>
                <p className="uc-acad-band-rule">{band.rule}</p>
              </div>
            ))}
          </div>

          {/* OD Calculator entry point — the tracker already lives on the OD tab;
              this card just makes it reachable from the attendance summary. */}
          {od && (
            <button
              type="button"
              onClick={() => setTab('od')}
              className="uc-plate uc-acad-od"
            >
              <Target className="h-5 w-5" />
              <span className="uc-acad-head-id">
                <span className="uc-cap">On duty</span>
                <strong>OD Calculator</strong>
                <small>
                  {od.available
                    ? `On-duty hours used · ${od.totalOdHours}h${od.limitHours !== null ? ` of a ${od.limitHours}h semester cap` : ''}`
                    : 'Track on-duty hours per course'}
                </small>
              </span>
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {/* Day selector — the same week strip the Timetable board uses, so the
              two screens a student flips between carry the same gesture: tap a
              day, or arrow along it. The count under each day is the periods
              the synced timetable has for it, never an estimate. */}
          <div
            className="uc-tt-strip"
            role="tablist"
            aria-label="Attendance day selection"
            onKeyDown={(event) => {
              const idx = weekDates.findIndex(d => d.key === selectedDay);
              if (event.key === 'ArrowRight' && idx < weekDates.length - 1) { event.preventDefault(); setSelectedDay(weekDates[idx + 1].key); }
              else if (event.key === 'ArrowLeft' && idx > 0) { event.preventDefault(); setSelectedDay(weekDates[idx - 1].key); }
            }}
          >
            {weekDates.map(d => {
              const classes = dayClassesMap[d.key]?.length || 0;
              const isSelected = selectedDay === d.key;
              const hasRisk = dayClassesMap[d.key]?.some(s => {
                const att = s.attendance;
                return !!att && att.percentage < safetyThreshold;
              });
              return (
                <button
                  key={d.key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSelectedDay(d.key)}
                  className={`${isSelected ? 'active' : ''} ${d.isToday ? 'today' : ''} ${hasRisk ? 'has-risk' : ''}`}
                >
                  <span>{d.label}</span>
                  <small>{d.dayNum} · {classes > 0 ? `${classes} cls` : 'free'}</small>
                </button>
              );
            })}
          </div>

          {/* Day's classes — planner style. The whole row is one target that
              opens that course's page, and the rule down its left edge is the
              same colour the Timetable board paints the same course. */}
          <section className="uc-plate">
            <div className="uc-plate-head">
              <span className="uc-cap">{DAYS.find(d => d.key === selectedDay)?.full} classes</span>
              <span className="uc-note" style={{ margin: 0 }}>
                {selectedDayClasses.length === 0 ? 'Nothing scheduled' : `${selectedDayClasses.length} scheduled`}
              </span>
            </div>

            {selectedDayClasses.length === 0 ? (
              <div className="uc-empty">
                <span>No classes on {DAYS.find(d => d.key === selectedDay)?.full} — sync the timetable if one belongs here.</span>
              </div>
            ) : (
              selectedDayClasses.map((s, idx) => {
                // The matched VTOP row for THIS session (theory row for a
                // theory period, lab row for a lab block) — never a
                // course-code guess that could show the wrong half.
                const att = s.attendance;
                const pct = att?.percentage ?? null;
                // Whether this session is running comes from VTOP's own times
                // for the row — the same two values printed in the time column —
                // through the helper the dashboard and the timetable grid
                // already use, so the three screens cannot disagree. A
                // slot-code lookup would miss combined theory ("A1+TA1") and
                // lab blocks ("L55+L56") and would drift the moment VTOP moved
                // a period.
                const endMin = timetableTimeToMinutes(s.endTime);
                const isCurrent = selectedDayIsToday && isTimetableSlotOngoing(s, clock);
                const isPast = (() => {
                  if (selectedDayIsPast) return true;
                  if (!selectedDayIsToday) return false;
                  // A period VTOP left without an end time is not a period
                  // that ended at midnight.
                  return endMin !== null && minutesNow > endMin;
                })();

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedCourse(s.courseCode)}
                    className={`uc-tt-slot tone-${courseTone(s.courseCode)}${isCurrent ? ' is-now' : ''}${isPast ? ' is-past' : ''}`}
                  >
                    {/* Time column — VTOP's own start and end, unformatted. */}
                    <span className="uc-tt-slot-time">
                      <b>{s.startTime}</b>
                      <small>{s.endTime}</small>
                    </span>

                    {/* Course column */}
                    <span className="uc-tt-slot-main">
                      <span className="uc-tt-slot-top">
                        <span className="uc-tt-slot-title">{s.courseTitle || s.courseCode}</span>
                        <span className="uc-tt-slot-tail">
                          {s.isLab && <span className="uc-acad-tag">Lab</span>}
                          {isCurrent && <span className="uc-acad-tag">Now</span>}
                          {pct !== null && pct < VTOP_ATTENDANCE_FLOOR && <AlertTriangle size={14} className="uc-ink-critical" />}
                          {pct !== null && pct >= safetyThreshold && <CheckCircle2 size={14} className="uc-ink-safe" />}
                        </span>
                      </span>
                      <span className="uc-tt-slot-meta">
                        {s.courseCode}{s.slot ? ` · ${s.slot}` : ''}{isReal(s.venue) ? ` · ${s.venue.trim()}` : ''}
                      </span>
                    </span>

                    {/* Attendance for this session, at the one precision the app
                        prints, or VTOP's own state word when there is no figure. */}
                    <span className="uc-acad-pct">
                      {pct === null
                        ? <small>{att ? 'No classes yet' : 'Not tracked'}</small>
                        : <b className={TONE_TEXT[toneOf(pct, safetyThreshold)]}>{attendancePercentLabel(pct)}%</b>}
                    </span>
                  </button>
                );
              })
            )}
          </section>

          {/* All courses overview — one row per VTOP attendance record, worst
              first, filtered by the chips in the head. A course with a lab half
              appears once per component, labelled with VTOP's own name for it. */}
          <section className="uc-plate">
            <div className="uc-plate-head">
              <span className="uc-cap">All courses</span>
              <div className="uc-chips" role="group" aria-label="Filter courses by attendance">
                {courseFilters.map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilterStatus(f.id)}
                    aria-pressed={filterStatus === f.id}
                    title={`Show ${f.hint}`}
                    className={filterStatus === f.id ? 'acc-bg' : undefined}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {visibleBunks.length === 0 ? (
              <div className="uc-empty"><span>{noCoursesNote}</span></div>
            ) : (
              <div className="uc-courses">
                {visibleBunks.map(b => (
                  <button
                    key={b.rowKey}
                    type="button"
                    onClick={() => setSelectedCourse(b.courseCode)}
                    className="uc-course"
                  >
                    <span className={`uc-course-rule tone-${courseTone(b.courseCode)}`} />
                    <span className="uc-course-head">
                      <span>{b.courseCode}</span>
                      {/* Which VTOP component this row is: a course with a lab
                          half appears once per component, labelled. */}
                      <span>{componentLabel(b.component)}</span>
                    </span>
                    <strong>{b.courseTitle || 'Course name unavailable'}</strong>
                    <small>
                      {b.attended}/{b.totalHeld} · {b.facultyName || 'Faculty unavailable'} · Safe bunks {b.totalHeld > 0 ? b.bunk.canBunk : '—'}
                    </small>
                    <span className="uc-acad-barrow">
                      <span
                        className="uc-acad-bar"
                        role="img"
                        aria-label={`${b.courseCode} attendance ${attendancePercentLabel(b.percentage)}%`}
                      >
                        <i className={TONE_FILL[toneOf(b.percentage, safetyThreshold)]} style={{ width: `${Math.min(100, b.percentage)}%` }} />
                      </span>
                      <b>{attendancePercentLabel(b.percentage)}%</b>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* ─── PREDICTOR TAB ───────────────────────────────────────────────── */}
      {tab === 'predictor' && (
        <AttendancePredictor
          attendance={attendance}
          safetyThreshold={safetyThreshold}
        />
      )}

      {/* ─── OD TAB ──────────────────────────────────────────────────────── */}
      {tab === 'od' && (
        <section className="uc-plate">
          <div className="uc-acad-mast">
            <div className="uc-acad-head-id">
              <span className="uc-cap">On duty</span>
              <h3 className="uc-acad-title">On-Duty Tracker</h3>
              <p className="uc-note" style={{ margin: 0 }}>OD hours per course — from VTOP</p>
            </div>
          </div>

          {od?.available && (
            <div className="uc-acad-body">
              {/* Each figure names the quantity it counts. The cap only appears
                  when a response carried one, so "left" is arithmetic the
                  student can check on the screen rather than a second number
                  from somewhere else. */}
              <div className="uc-acad-stats">
                <div className="uc-acad-stat">
                  <b className="uc-ink-info">{od.totalOdHours}</b>
                  <span>OD hours used</span>
                </div>
                {od.limitHours !== null && (
                  <div className="uc-acad-stat">
                    <b className="uc-ink-safe">{Math.max(0, od.limitHours - od.totalOdHours)}</b>
                    <span>Hours left of {od.limitHours}</span>
                  </div>
                )}
                <div className="uc-acad-stat">
                  <b>{od.perCourse.reduce((sum, entry) => sum + entry.onDutyCount, 0)}</b>
                  <span>OD sessions</span>
                </div>
              </div>
            </div>
          )}

          {od?.available && od.perCourse.length > 0 ? (
            od.perCourse.map(entry => (
              <div key={`${entry.courseCode}-${entry.slot}`} className="uc-acad-log">
                <span className="uc-acad-log-body">
                  <strong>{entry.courseCode}</strong>
                  <small>{entry.courseName || 'Course name unavailable'}</small>
                </span>
                <span className="uc-acad-pct">
                  <b className="uc-ink-info">{entry.onDutyCount}</b>
                  <small>sessions · {entry.odHours}h</small>
                </span>
              </div>
            ))
          ) : (
            <div className="uc-empty">
              <span>{od?.available ? 'No on-duty sessions were reported for this semester.' : 'OD data is not available — sync your semester from Login first.'}</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

/* ── Bunks verdict ─────────────────────────────────────────────────────────── */

/**
 * Attendance tones → the lamp, the word and the surface modifier used by the
 * verdict plate. One map per attribute, keyed by the same four values
 * `attendanceTone` returns, so the plate can never be painted one band and
 * labelled another.
 */
const VERDICT_LAMP: Record<ReturnType<typeof toneOf>, string> = {
  safe: 'uc-lamp--live', warning: 'uc-lamp--warn', critical: 'uc-lamp--alert', unknown: '',
};
const VERDICT_TAG: Record<ReturnType<typeof toneOf>, string> = {
  safe: 'Safe', warning: 'Below target', critical: 'Debar risk', unknown: 'No classes yet',
};
const VERDICT_BAND: Record<ReturnType<typeof toneOf>, string> = {
  safe: 'is-safe', warning: 'is-watch', critical: 'is-risk', unknown: 'is-quiet',
};

/**
 * The attendance answer, as a readout rather than a report.
 *
 * A student opens this between two classes to ask one thing — can I miss the
 * next one — so the plate leads with the two figures the answer sits between
 * (where the attendance is, and the bar it is measured against) and then says
 * the verdict in words. The counts behind it, attended over held and each VTOP
 * component on its own line, are underneath, which is where working belongs.
 *
 * Every number comes from the rules that already exist: `componentTotals` sums
 * VTOP's own rows exactly as the dashboard's standing band does, and
 * `calculateBunkStats` is the one bunk rule. Nothing is re-derived here, so this
 * plate and the dashboard cannot quote different safe-skip counts.
 */
const BunksVerdict: React.FC<{ attendance: AttendanceRecord[]; target: number }> = ({ attendance, target }) => {
  const readout = useMemo(() => {
    const totals = componentTotals(attendance);
    const current = totals.percentage;
    // Nothing held is not 0% — it is unmeasurable, and the plate says so rather
    // than printing a verdict for a class VTOP has not run.
    if (current === null || totals.conducted === 0) return null;
    return {
      current,
      attended: totals.attended,
      held: totals.conducted,
      parts: totals.present,
      verdict: calculateBunkStats({
        courseCode: 'All courses', courseTitle: '', type: 'TH', slot: '', facultyName: '',
        attended: totals.attended, totalHeld: totals.conducted, percentage: current,
        lastUpdated: '', venue: '',
      }, target, { periods: true }),
    };
  }, [attendance, target]);

  if (!readout) {
    return (
      <div className="uc-plate uc-plate--quiet">
        <span className="uc-cap">Attendance</span>
        <p className="uc-note">Nothing held yet — your verdict appears here once VTOP marks a class.</p>
      </div>
    );
  }

  const { verdict, current, attended, held, parts } = readout;
  const tone = toneOf(current, target);
  const canSkip = verdict.state === 'on-target';

  return (
    <section className={`uc-plate uc-bunk ${VERDICT_BAND[tone]}`} aria-label="Attendance verdict">
      <div className="uc-bunk-head">
        <span className="uc-cap">Attendance</span>
        <span className={`uc-lamp ${VERDICT_LAMP[tone]}`}>{VERDICT_TAG[tone]}</span>
      </div>

      <div className="uc-bunk-figures">
        <div className="uc-bunk-fig">
          <span className="uc-cap">Now</span>
          <b className="uc-num">{attendancePercentLabel(current)}%</b>
          <small>{attended} of {held} held</small>
        </div>
        <div className="uc-bunk-gauge">
          <span className="uc-bunk-bar"><i style={{ width: `${Math.min(100, current)}%` }} /></span>
        </div>
        <div className="uc-bunk-fig is-target">
          <span className="uc-cap">Target</span>
          <b className="uc-num">{target}%</b>
          <small>your bar</small>
        </div>
      </div>

      <div className="uc-bunk-verdict">
        <span className="uc-cap">{canSkip ? 'Can skip' : 'Must attend'}</span>
        <b className="uc-num">{canSkip ? verdict.canBunk : verdict.mustAttend}</b>
        <span>{verdict.message}</span>
      </div>

      {/* VTOP keeps theory and lab as separate records with separate conducted
          counts, so the working shows each on its own line. */}
      {parts.length > 1 && (
        <div className="uc-bunk-parts">
          {parts.map((component) => (
            <div className="uc-bunk-part" key={component.kind}>
              <span>{componentLabel(component.kind)}</span>
              <b className="uc-num">
                {component.percentage === null ? '—' : `${attendancePercentLabel(component.percentage)}%`}
                <i> {component.attended}/{component.conducted}</i>
              </b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

/* ── Attendance Predictor ──────────────────────────────────────────────────── */

function AttendancePredictor({
  attendance,
  safetyThreshold,
}: {
  attendance: AttendanceRecord[];
  safetyThreshold: number;
}) {
  const [simSkips, setSimSkips] = useState<Record<string, number>>({});

  /**
   * One entry per VTOP row (a course's theory and lab halves are separate
   * rows), keyed so the two halves never share a skip counter.
   */
  const rows = useMemo(() => attendance.map((a, index) => ({
    record: a,
    key: `${a.courseCode}-${a.slot || a.type || index}`,
    component: attendanceComponent(a),
  })), [attendance]);

  const toggleSkip = useCallback((key: string, delta: number) => {
    setSimSkips(prev => ({
      ...prev,
      [key]: Math.max(0, (prev[key] || 0) + delta),
    }));
  }, []);

  // A row with no conducted class has nothing to divide, so it cannot be
  // simulated — and if every row is like that the card says so instead of
  // showing an empty box under a heading.
  const simulatable = useMemo(() => rows.filter(({ record }) => record.totalHeld > 0), [rows]);

  const simStats = useMemo(() => {
    // Every conducted period counts exactly once. A skipped class costs its
    // own number of periods — one for theory, two for a lab session — because
    // VTOP's totals are periods and a lab session is two of them.
    let totalAttended = 0;
    let totalClasses = 0;
    for (const { record, key } of rows) {
      const skips = simSkips[key] || 0;
      const span = periodsPerClass({ slot: record.slot, courseType: record.type });
      totalAttended += record.attended;
      totalClasses += record.totalHeld + skips * span;
    }
    const origTotal = rows.reduce((s, r) => s + r.record.totalHeld, 0);
    const origAttended = rows.reduce((s, r) => s + r.record.attended, 0);
    return {
      // Kept as raw numbers: a percentage rounded here would be a second
      // formatter, and the one on screen would no longer match the one in the
      // colour decision two lines below.
      original: origTotal > 0 ? (origAttended / origTotal) * 100 : null,
      simulated: totalClasses > 0 ? (totalAttended / totalClasses) * 100 : null,
      hasSimulation: Object.values(simSkips).some((v: number) => v > 0),
    };
  }, [rows, simSkips]);

  return (
    <div className="uc-acad">
      {/* The combined result — what the whole semester's attendance does if the
          skips counted below are taken. */}
      <section className="uc-plate">
        <div className="uc-acad-mast">
          <div className="uc-acad-head-id">
            <span className="uc-cap">Simulator</span>
            <h3 className="uc-acad-title">Attendance Predictor</h3>
            <p className="uc-note" style={{ margin: 0 }}>Simulate future absences and see the impact</p>
          </div>
        </div>
        <div className="uc-acad-body">
          <div className="uc-acad-stats">
            <div className="uc-acad-stat">
              <b>{simStats.original === null ? '—' : `${attendancePercentLabel(simStats.original)}%`}</b>
              <span>Current (VTOP)</span>
            </div>
            <div className="uc-acad-stat">
              {/* The projection is painted with the same band rule as every
                  other figure on this page, so it cannot read safe here and
                  critical on the course it came from. */}
              <b className={simStats.simulated === null ? '' : TONE_TEXT[toneOf(simStats.simulated, safetyThreshold)]}>
                {simStats.simulated === null ? '—' : `${attendancePercentLabel(simStats.simulated)}%`}
              </b>
              <span>After simulation</span>
            </div>
          </div>
          <p className="uc-note">Combined across every VTOP attendance row. Counts are VTOP periods — a lab session uses two.</p>
        </div>
      </section>

      {/* Per-course simulator — one row per VTOP record, so a course's theory
          and lab halves are simulated against their own conducted counts. */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap">Skip simulator</span>
          <span className="uc-note" style={{ margin: 0 }}>{simulatable.length} {simulatable.length === 1 ? 'row' : 'rows'}</span>
        </div>
        {simulatable.length === 0 ? (
          <div className="uc-empty">
            <span>
              {rows.length === 0
                ? 'No courses to simulate yet — sync your semester and they appear here.'
                : 'None of these courses has a marked class yet, so there is nothing to predict. Rows appear as soon as attendance is taken.'}
            </span>
          </div>
        ) : (
          simulatable.map(({ record: a, key, component }) => {
            const skips = simSkips[key] || 0;
            // One simulated absence is one class, not one period: a lab
            // session adds both of its periods to the conducted count.
            const span = periodsPerClass({ slot: a.slot, courseType: a.type });
            const newTotal = a.totalHeld + skips * span;
            const newPct = newTotal > 0 ? (a.attended / newTotal) * 100 : 0;
            const origPct = a.percentage;

            return (
              <div key={key} className="uc-acad-log is-sim">
                <span className="uc-acad-log-body">
                  <strong>{a.courseCode}<span className="uc-acad-tag">{componentLabel(component)}</span></strong>
                  <small>{a.courseTitle} · {a.attended}/{a.totalHeld} → {a.attended}/{newTotal}</small>
                </span>

                {/* 44px targets with real accessible names, and a count a screen
                    reader announces when it changes. */}
                <span className="uc-acad-steppers">
                  <button
                    type="button"
                    onClick={() => toggleSkip(key, -1)}
                    disabled={skips === 0}
                    aria-label={`Simulate one fewer skipped ${componentLabel(component)} class for ${a.courseCode}`}
                    className="uc-acad-step"
                  >−</button>
                  <span className="uc-acad-skip-count" aria-live="polite">{skips}</span>
                  <button
                    type="button"
                    onClick={() => toggleSkip(key, 1)}
                    aria-label={`Simulate skipping one more ${componentLabel(component)} class for ${a.courseCode}`}
                    className="uc-acad-step"
                  >+</button>
                </span>

                {/* The resulting figure, and what it fell from. The arrow reads
                    red only when the bar actually moved down. */}
                <span className="uc-acad-pct">
                  <b className={TONE_TEXT[toneOf(newPct, safetyThreshold)]}>{attendancePercentLabel(newPct)}%</b>
                  {skips > 0 && (
                    <small className={newPct < origPct ? 'uc-ink-critical' : ''}>
                      {newPct < origPct ? '↓' : '→'} {attendancePercentLabel(origPct)}%
                    </small>
                  )}
                </span>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
