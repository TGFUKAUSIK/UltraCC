/**
 * AcademicsView — attendance hub.
 *   Tab 1: Weekly Overview (day selector + course cards + daily planner)
 *   Tab 2: Attendance Predictor (per-course skip simulation)
 *   Tab 3: OD Tracker
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  BookOpen, AlertTriangle, CheckCircle2, MapPin, User,
  Calendar, Sliders, TrendingUp, ChevronRight, Target, BarChart3,
  ArrowLeft,
} from 'lucide-react';
import { AttendanceRecord, TimetableSlot } from '../types';
import { calculateBunkStats } from '../utils/nextActionEngine';
import { matchAttendanceRecord } from '../utils/attendancePredictor';
import {
  attendanceComponent, componentLabel, componentTotals, findCourseGroup,
  groupCourseAttendance, type ComponentAttendance,
} from '../utils/attendanceComponents';
import { exportAttendanceToPdf } from '../utils/printExport';
import { Printer } from 'lucide-react';
import { Image as ImageIcon } from 'lucide-react';
import { exportAttendanceImage } from '../utils/imageExport';
import { OdSummary } from '../lib/vtop/types';

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface AcademicsViewProps {
  attendance: AttendanceRecord[];
  timetable: TimetableSlot[];
  od?: OdSummary | null;
}

type Tab = 'weekly' | 'predictor' | 'od';

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

function getWeekDates(): { key: DayKey; date: Date; label: string; dayNum: number; isToday: boolean }[] {
  const now = new Date();
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

function currentSlotNow(): string | null {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const min = h * 60 + m;
  // VIT Chennai time slots
  const slots: [string, number, number][] = [
    ['A1', 480, 530], ['B1', 540, 590], ['C1', 600, 650], ['D1', 660, 710],
    ['E1', 720, 770], ['F1', 780, 830], ['A2', 840, 890], ['B2', 900, 950],
    ['C2', 960, 1010], ['D2', 1020, 1070], ['E2', 1080, 1130], ['F2', 1140, 1190],
  ];
  for (const [name, start, end] of slots) {
    if (min >= start && min <= end) return name;
  }
  return null;
}

/* ── Main Component ────────────────────────────────────────────────────────── */

/**
 * Colour band for an attendance figure: the 75% university floor decides
 * "critical", the student's own target decides "safe". `null` (VTOP has not
 * conducted any class for this component yet) gets a neutral band — an
 * unknown is never painted green or red.
 */
function toneOf(percentage: number | null, safetyThreshold: number): 'safe' | 'warning' | 'critical' | 'unknown' {
  if (percentage === null) return 'unknown';
  if (percentage >= safetyThreshold) return 'safe';
  return percentage >= 75 ? 'warning' : 'critical';
}

const TONE_TEXT: Record<ReturnType<typeof toneOf>, string> = {
  safe: 'text-emerald-600', warning: 'text-amber-600', critical: 'text-rose-600', unknown: 'text-zinc-500',
};

const TONE_PANEL: Record<ReturnType<typeof toneOf>, string> = {
  safe: 'bg-emerald-500/10 border-emerald-500/20',
  warning: 'bg-amber-500/10 border-amber-500/20',
  critical: 'bg-rose-500/10 border-rose-500/20',
  unknown: 'bg-zinc-50 border-zinc-200',
};

/**
 * One VTOP attendance component (theory / lab / project) rendered as its own
 * figure. Each row is a separate VTOP record with its own conducted count, so
 * they are shown separately and never blended into one percentage.
 */
const ComponentBlock: React.FC<{ component: ComponentAttendance; safetyThreshold: number }> = ({ component, safetyThreshold }) => {
  const tone = toneOf(component.percentage, safetyThreshold);
  const rows = component.rows;
  return (
    <div className={`rounded-2xl border p-4 ${TONE_PANEL[tone]}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{componentLabel(component.kind)}</p>
        {component.percentage === null
          ? <p className="text-[10px] font-medium text-zinc-500">No classes conducted yet</p>
          : <p className={`text-2xl font-black font-mono ${TONE_TEXT[tone]}`}>{component.percentage}%</p>}
      </div>
      <p className="mt-1 text-xs font-medium text-zinc-900">
        {component.percentage === null ? `${component.attended}/${component.conducted} classes` : `${component.attended} / ${component.conducted} classes attended`}
      </p>
      {/* VTOP tracks the components under their own codes/slots — show which. */}
      {rows.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-zinc-500 font-mono">
          {rows.map((r, i) => <span key={`${r.courseCode}-${r.slot}-${i}`}>{r.courseCode}{r.slot ? ` · ${r.slot}` : ''}</span>)}
        </p>
      )}
    </div>
  );
};

export const AcademicsView: React.FC<AcademicsViewProps> = ({ attendance, timetable, od = null }) => {
  const [tab, setTab] = useState<Tab>('weekly');
  const [selectedDay, setSelectedDay] = useState<DayKey>(getTodayKey());
  const [safetyThreshold, setSafetyThreshold] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.targetAttendance) return Number(parsed.targetAttendance);
      }
    } catch { /* ignore */ }
    return 75;
  });
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'present' | 'absent' | 'od'>('all');

  const weekDates = useMemo(() => getWeekDates(), []);
  const activeSlot = useMemo(() => currentSlotNow(), []);

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
      percentage: totals.percentage === null ? '—' : totals.percentage.toFixed(1),
      theory: totals.theory,
      lab: totals.lab,
      components: totals.present,
      // Counted per VTOP row, so a course with a weak lab half is flagged for
      // the component that is actually at risk (not for the whole course).
      coursesAtRisk: attendance.filter(a => a.percentage < safetyThreshold).length,
      coursesDebar: attendance.filter(a => a.percentage < 75).length,
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

  // Attendance summary cards — counted per COURSE, not per VTOP row, so a
  // course with both a theory and a lab row is not counted twice. A course is
  // only "safe" when every tracked component clears the target.
  const summaryStats = useMemo(() => {
    let safe = 0, warning = 0, danger = 0;
    for (const group of courseGroups) {
      const tracked = group.components.filter(c => c.percentage !== null);
      if (tracked.length === 0) { warning += 1; continue; }
      if (tracked.some(c => (c.percentage ?? 0) < 75)) danger += 1;
      else if (tracked.every(c => (c.percentage ?? 0) >= safetyThreshold)) safe += 1;
      else warning += 1;
    }
    return { safe, warning, danger, total: courseGroups.length };
  }, [courseGroups, safetyThreshold]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'weekly', label: 'Weekly', icon: <Calendar className="h-4 w-4" /> },
    { id: 'predictor', label: 'Predictor', icon: <TrendingUp className="h-4 w-4" /> },
    { id: 'od', label: 'OD', icon: <Target className="h-4 w-4" /> },
  ];

  /* ── Course Detail Subpage ─────────────────────────────────────────────── */
  if (selectedCourse && selectedCourseData) {
    const group = selectedCourseData.group;
    const pct = group.percentage;
    const tone = toneOf(pct, safetyThreshold);
    const components = group.components;
    const splitNote = components.length > 1
      ? components.map(c => `${componentLabel(c.kind)} ${c.percentage === null ? 'not started' : `${c.attended}/${c.conducted} = ${c.percentage}%`}`).join(' · ')
      : null;

    return (
      <div className="space-y-5 pb-12 animate-in fade-in duration-300">
        {/* Back button + Course header */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
          <button
            onClick={() => setSelectedCourse(null)}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 mb-4 transition cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to weekly view
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight">{group.courseCode}</h2>
              <p className="text-sm text-zinc-500 font-medium mt-0.5">{group.courseTitle || 'Course title unavailable'}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {/* One chip per VTOP row: the slot label and the component VTOP
                    itself published — nothing here is inferred. */}
                {group.rows.map((r, i) => (
                  <span key={`${r.courseCode}-${r.slot}-${i}`} className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg bg-white acc-text border border-zinc-200 font-mono">{r.slot || 'Slot unavailable'}</span>
                    <span className="text-[11px] text-zinc-500">{r.courseCode} · {componentLabel(attendanceComponent(r))}</span>
                  </span>
                ))}
                {group.rows.some(r => r.facultyName) && (
                  <span className="text-[11px] text-zinc-500">Faculty: <span className="text-zinc-900">{group.rows.find(r => r.facultyName)?.facultyName}</span></span>
                )}
              </div>
            </div>

            {/* Combined percentage — the plain sum of VTOP's own rows. */}
            <div className={`text-center p-4 rounded-2xl border ${TONE_PANEL[tone]}`}>
              <p className={`text-4xl font-black font-mono ${TONE_TEXT[tone]}`}>{pct === null ? '—' : `${pct}%`}</p>
              <p className="text-[10px] text-zinc-500 mt-1">{group.attended}/{group.conducted} classes</p>
              {splitNote && <p className="text-[10px] text-zinc-500 mt-1 max-w-[16rem]">{splitNote}</p>}
            </div>
          </div>
        </div>

        {/* Theory / lab tracked separately, exactly as VTOP reports them */}
        {components.length > 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            return (
              <div key={`${row.courseCode}-${row.slot}-${component.kind}`} className="bg-white border border-zinc-200 rounded-2xl p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-bold text-zinc-900">{label}</h3>
                  <span className={`text-sm font-black font-mono ${TONE_TEXT[componentTone]}`}>
                    {component.percentage === null ? '—' : `${component.percentage}%`}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: 'Attended', value: `${row.attended}`, color: 'text-emerald-600' },
                    { label: 'Absent', value: `${Math.max(0, row.totalHeld - row.attended)}`, color: 'text-rose-600' },
                    { label: 'Safe Bunks', value: notStarted ? '—' : `${bunk.canBunk}`, color: 'text-blue-600' },
                    { label: 'Must Attend', value: notStarted ? '—' : `${bunk.mustAttend}`, color: 'text-amber-600' },
                  ].map(s => (
                    <div key={s.label} className="bg-zinc-50 border border-zinc-200 rounded-2xl p-3 text-center">
                      <p className={`text-2xl font-black font-mono ${s.color}`}>{s.value}</p>
                      <p className="text-[10px] text-zinc-500 mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between text-xs text-zinc-500 mb-2">
                  <span>Attendance Progress</span>
                  <span className="font-mono text-zinc-900 font-bold">{row.attended}/{row.totalHeld}</span>
                </div>
                <div className="h-3 bg-white rounded-full overflow-hidden border border-zinc-200" role="img" aria-label={`${label} attendance ${component.percentage === null ? 'unavailable' : `${component.percentage}%`}`}>
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${
                      componentTone === 'safe' ? 'bg-emerald-500' : componentTone === 'warning' ? 'bg-amber-500' : componentTone === 'critical' ? 'bg-rose-500' : 'bg-zinc-300'
                    }`}
                    style={{ width: `${Math.min(100, component.percentage ?? 0)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-2 text-[9px] text-zinc-600 font-mono">
                  <span>0%</span>
                  <span className="text-rose-500">75% min</span>
                  <span className="text-amber-500">{safetyThreshold}% target</span>
                  <span>100%</span>
                </div>

                <div className={`mt-4 p-4 rounded-2xl text-xs font-medium border ${
                  notStarted ? 'bg-zinc-50 border-zinc-200 text-zinc-500' :
                  (component.percentage ?? 0) < 75 ? 'bg-rose-50 border-rose-800 text-rose-700' :
                  bunk.safeToBunk ? 'bg-emerald-50 border-emerald-800/50 text-emerald-700' :
                  'bg-amber-50 border-amber-800/50 text-amber-700'
                }`}>
                  {notStarted ? (
                    <p className="flex items-center gap-1.5 font-bold">VTOP has not conducted any {componentLabel(component.kind).toLowerCase()} class for this course yet.</p>
                  ) : (
                    <>
                      <p className="flex items-center gap-1.5 font-bold mb-1">
                        {(component.percentage ?? 0) < 75 ? <AlertTriangle className="h-4 w-4 text-rose-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                        {bunk.status}
                      </p>
                      <p className="text-[11px] leading-relaxed">{bunk.message}</p>
                    </>
                  )}
                </div>
              </div>
            );
          });
        })}

        {/* Course schedule — this course's own timetable rows (was previously
            the selected day's unrelated classes). */}
        <div className="bg-white border border-zinc-200 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-zinc-900 mb-3">Weekly Schedule</h3>
          <div className="space-y-2">
            {selectedCourseData.slots.map((s) => (
              <div key={s.id || `${s.day}-${s.startTime}-${s.courseCode}`} className="flex items-center gap-3 p-2.5 bg-zinc-50 rounded-xl border border-zinc-200">
                <span className="text-[11px] font-mono font-bold text-zinc-900 w-10 shrink-0">{s.day?.substring(0, 3) || '—'}</span>
                <span className="text-[11px] font-mono text-zinc-500 w-24 shrink-0">{s.startTime}–{s.endTime}</span>
                <span className="text-[11px] text-zinc-900 flex-1 min-w-0 truncate">{s.venue || 'Venue unavailable'}</span>
                <span className="text-[10px] text-zinc-500 font-mono shrink-0">{s.slot || 'Slot unavailable'}</span>
              </div>
            ))}
            {selectedCourseData.slots.length === 0 && (
              <p className="text-xs text-zinc-500 text-center py-3">No scheduled classes found in the synced timetable</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── Main View ─────────────────────────────────────────────────────────── */
  return (
    <div className="academics-view space-y-5 pb-12">
      {/* Header */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2 text-zinc-500 text-xs font-bold uppercase tracking-wider mb-1">
              <span>Academics</span>
              <span>•</span>
              <span className="acc-text">Attendance</span>
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-900 flex items-center gap-2 tracking-tight">
              <BookOpen className="h-6 w-6 acc-text" />
              Attendance
            </h2>
            <p className="text-sm text-zinc-500 mt-1 font-medium">
              {overallStats.coursesAtRisk > 0 ? (
                <span className="text-amber-600">{overallStats.coursesAtRisk} course{overallStats.coursesAtRisk > 1 ? 's' : ''} below {safetyThreshold}%</span>
              ) : (
                <span className="text-emerald-600">All courses above {safetyThreshold}%</span>
              )}
              {' · Overall '}
              <span className="font-bold text-zinc-900">{overallStats.percentage === '—' ? 'Not available' : `${overallStats.percentage}%`}</span>
            </p>
            {/* Theory and lab are separate VTOP records — never blended into one
                number without saying what each half actually is. */}
            {overallStats.components.length > 1 && (
              <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500 font-mono">
                {overallStats.components.map(c => (
                  <span key={c.kind}>
                    {componentLabel(c.kind)}: <span className="font-bold text-zinc-900">{c.percentage === null ? 'no classes yet' : `${c.percentage}%`}</span>
                    <span className="text-zinc-400"> ({c.attended}/{c.conducted})</span>
                  </span>
                ))}
              </p>
            )}
          </div>

          {/* Tabs */}
          <div className="academics-header-actions flex flex-wrap gap-2">
            {attendance.length > 0 && (
              <button
                onClick={() => exportAttendanceToPdf(attendance.map(a => ({
                  courseCode: a.courseCode,
                  courseTitle: a.courseTitle,
                  attended: a.attended,
                  total: a.totalHeld,
                  percentage: Math.round(a.percentage),
                  faculty: a.facultyName || '',
                })), { overall: overallStats.total > 0 ? Number(overallStats.percentage) : undefined })}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900"
                aria-label="Print or save attendance report as PDF"
              >
                <Printer className="h-4 w-4" /> PDF
              </button>
            )}
            {attendance.length > 0 && (
              <button
                onClick={() => exportAttendanceImage(attendance.map(a => ({
                  courseCode: a.courseCode,
                  courseTitle: a.courseTitle,
                  attended: a.attended,
                  total: a.totalHeld,
                  percentage: Math.round(a.percentage),
                  faculty: a.facultyName || '',
                })), {})}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900"
                aria-label="Download attendance report as image"
              >
                <ImageIcon className="h-4 w-4" /> Image
              </button>
            )}
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                  tab === t.id
                    ? 'acc-bg text-zinc-900 border-transparent'
                    : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Safety threshold */}
        <div className="mt-4 bg-zinc-50 p-3 rounded-xl border border-zinc-200">
          <div className="flex justify-between items-center text-xs font-bold mb-1.5">
            <span className="text-zinc-500 flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 acc-text" /> Target:
            </span>
            <span className="font-mono acc-text text-sm">{safetyThreshold}%</span>
          </div>
          <input
            type="range"
            aria-label="Target attendance safety threshold"
            min="75"
            max="95"
            step="1"
            value={safetyThreshold}
            onChange={(e) => setSafetyThreshold(Number(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-white rounded-lg"
          />
          <div className="flex justify-between text-[9px] text-zinc-600 mt-1 font-mono">
            <span>75%</span><span>80%</span><span>85%</span><span>90%</span><span>95%</span>
          </div>
        </div>
      </div>

      {/* ─── WEEKLY TAB ──────────────────────────────────────────────────── */}
      {tab === 'weekly' && (
        <>
          {/* Summary cards */}
          <div className="academics-summary-grid grid grid-cols-3 gap-3">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-center">
              <p className="text-2xl font-black text-emerald-600 font-mono">{summaryStats.safe}</p>
              <p className="text-[10px] text-zinc-500 mt-1">Safe</p>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-center">
              <p className="text-2xl font-black text-amber-600 font-mono">{summaryStats.warning}</p>
              <p className="text-[10px] text-zinc-500 mt-1">Warning</p>
            </div>
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 text-center">
              <p className="text-2xl font-black text-rose-600 font-mono">{summaryStats.danger}</p>
              <p className="text-[10px] text-zinc-500 mt-1">At Risk</p>
            </div>
          </div>

          {/* Day selector */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-1.5 flex gap-1 overflow-x-auto">
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
                  onClick={() => setSelectedDay(d.key)}
                  className={`flex-1 min-w-[60px] flex flex-col items-center py-2.5 rounded-xl transition cursor-pointer ${
                    isSelected
                      ? 'acc-bg text-zinc-900 shadow-lg'
                      : d.isToday
                        ? 'bg-zinc-100 text-zinc-900 border border-zinc-200'
                        : 'text-zinc-500 hover:bg-zinc-100'
                  }`}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider">{d.label}</span>
                  <span className={`text-lg font-black mt-0.5 ${d.isToday && !isSelected ? 'acc-text' : ''}`}>{d.dayNum}</span>
                  <span className={`text-[9px] mt-0.5 ${classes > 0 ? (isSelected ? 'text-emerald-700' : 'text-zinc-500') : 'text-zinc-700'}`}>
                    {classes > 0 ? `${classes} cls` : 'Free'}
                  </span>
                  {hasRisk && !isSelected && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1" />}
                </button>
              );
            })}
          </div>

          {/* Day's classes — planner style */}
          <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-zinc-900">
                {DAYS.find(d => d.key === selectedDay)?.full} Classes
              </h3>
              <span className="text-[10px] text-zinc-500">{selectedDayClasses.length} scheduled</span>
            </div>

            {selectedDayClasses.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-8">No classes on {DAYS.find(d => d.key === selectedDay)?.full} 🎉</p>
            ) : (
              <div className="space-y-2">
                {selectedDayClasses.map((s, idx) => {
                  // The matched VTOP row for THIS session (theory row for a
                  // theory period, lab row for a lab block) — never a
                  // course-code guess that could show the wrong half.
                  const att = s.attendance;
                  const pct = att?.percentage ?? null;
                  const isCurrent = activeSlot === s.slot;
                  const isPast = (() => {
                    const now = new Date();
                    const endParts = (s.endTime || '').split(':');
                    const endMin = (parseInt(endParts[0]) || 0) * 60 + (parseInt(endParts[1]) || 0);
                    return now.getHours() * 60 + now.getMinutes() > endMin;
                  })();

                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedCourse(s.courseCode)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer text-left ${
                        isCurrent ? 'bg-blue-500/10 border-blue-500/30 ring-1 ring-blue-500/20' :
                        isPast ? 'bg-zinc-50 border-zinc-200 opacity-60 hover:opacity-100' :
                        'bg-zinc-50 border-zinc-200 hover:border-zinc-200'
                      }`}
                    >
                      {/* Time column */}
                      <div className="w-16 shrink-0 text-center">
                        <p className="text-[11px] font-mono font-bold text-zinc-900">{s.startTime}</p>
                        <p className="text-[9px] text-zinc-600">{s.endTime}</p>
                        {isCurrent && <span className="text-[8px] font-bold text-blue-600 uppercase">Now</span>}
                      </div>

                      {/* Course info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-zinc-900">{s.courseCode}</span>
                          {/* VTOP's own slot label — the authoritative one. */}
                          {s.slot && <span className="text-[9px] font-mono font-bold text-zinc-500 border border-zinc-200 rounded px-1 py-px">{s.slot}</span>}
                          {s.isLab && <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wide">Lab</span>}
                          {pct !== null && pct < 75 && <AlertTriangle className="h-3 w-3 text-red-600 shrink-0" />}
                          {pct !== null && pct >= safetyThreshold && <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />}
                        </div>
                        <p className="text-[10px] text-zinc-500 truncate">{s.courseTitle}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="flex items-center gap-0.5 text-[9px] text-zinc-600">
                            <User className="h-2.5 w-2.5" /> {s.facultyName}
                          </span>
                          <span className="flex items-center gap-0.5 text-[9px] text-zinc-600">
                            <MapPin className="h-2.5 w-2.5" /> {s.venue}
                          </span>
                        </div>
                      </div>

                      {/* Attendance + arrow */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          {pct === null ? (
                            <p className="text-[10px] font-medium text-zinc-500 max-w-[5rem]">{att ? 'No classes yet' : 'Not in attendance'}</p>
                          ) : (
                            <>
                              <p className={`text-lg font-black font-mono ${
                                pct >= safetyThreshold ? 'text-emerald-600' :
                                pct >= 75 ? 'text-amber-600' : 'text-red-600'
                              }`}>{pct}%</p>
                              <p className="text-[9px] text-zinc-600">{att?.attended}/{att?.totalHeld}</p>
                            </>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-zinc-600" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* All courses overview */}
          <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-1.5">
                <BarChart3 className="h-4 w-4 acc-text" /> All Courses
              </h3>
              <div className="flex gap-1">
                {(['all', 'present', 'absent', 'od'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilterStatus(f)}
                    className={`px-2 py-1 text-[10px] font-bold rounded-lg transition cursor-pointer ${
                      filterStatus === f ? 'acc-bg text-zinc-900' : 'bg-white text-zinc-500 hover:text-zinc-900'
                    }`}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {bunkStats
                .filter(b => {
                  if (filterStatus === 'all') return true;
                  if (filterStatus === 'present') return b.percentage >= safetyThreshold;
                  if (filterStatus === 'absent') return b.percentage < 75;
                  if (filterStatus === 'od') return b.slot?.includes('OD') || false;
                  return true;
                })
                .sort((a, b) => a.percentage - b.percentage)
                .map(b => (
                  <button
                    key={b.rowKey}
                    onClick={() => setSelectedCourse(b.courseCode)}
                    className="w-full flex items-center gap-3 p-3 bg-zinc-50 border border-zinc-200 rounded-xl hover:border-zinc-200 transition cursor-pointer text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-zinc-900 font-mono">{b.courseCode}</span>
                        {/* Which VTOP component this row is: a course with a lab
                            half appears once per component, labelled. */}
                        <span className="text-[9px] font-bold uppercase tracking-wide text-zinc-500 border border-zinc-200 rounded px-1 py-px shrink-0">{componentLabel(b.component)}</span>
                        <span className="text-[10px] text-zinc-500 truncate">{b.courseTitle}</span>
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{b.attended}/{b.totalHeld} · {b.facultyName || '—'} · Safe bunks: {b.totalHeld > 0 ? b.bunk.canBunk : '—'}</p>
                    </div>

                    {/* Mini progress */}
                    <div className="w-20 shrink-0">
                      <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            b.percentage >= safetyThreshold ? 'bg-emerald-500' :
                            b.percentage >= 75 ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                          style={{ width: `${Math.min(100, b.percentage)}%` }}
                        />
                      </div>
                    </div>

                    <span className={`text-sm font-black font-mono w-14 text-right ${
                      b.percentage >= safetyThreshold ? 'text-emerald-600' :
                      b.percentage >= 75 ? 'text-amber-600' : 'text-red-600'
                    }`}>{b.percentage}%</span>

                    <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                  </button>
                ))}
            </div>
          </div>
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
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600">
              <Target className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-900 tracking-tight">On-Duty Tracker</h3>
              <p className="text-xs text-zinc-500 font-medium">OD hours per course — from VTOP</p>
            </div>
          </div>

          {od?.available && (
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-center">
                <p className="text-2xl font-black font-mono text-blue-600">{od.totalOdHours}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">OD hours</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-center">
                <p className="text-2xl font-black font-mono text-zinc-900">{od.perCourse.reduce((sum, entry) => sum + entry.onDutyCount, 0)}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">OD sessions</p>
              </div>
            </div>
          )}

          {od?.available && od.perCourse.length > 0 ? (
            <div className="space-y-2">
              {od.perCourse.map(entry => {
                return (
                  <div key={`${entry.courseCode}-${entry.slot}`} className="flex items-center gap-3 p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold text-zinc-900 font-mono">{entry.courseCode}</span>
                      <span className="text-[10px] text-zinc-500 ml-2 truncate">{entry.courseName}</span>
                    </div>
                    <span className="text-sm font-black font-mono text-blue-600">{entry.onDutyCount}</span>
                    <span className="text-[10px] text-zinc-500">sessions · {entry.odHours}h</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-zinc-500 text-center py-8">{od?.available ? 'No on-duty sessions were reported for this semester.' : 'OD data is not available — sync your semester from Login first.'}</p>
          )}
        </div>
      )}
    </div>
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

  const simStats = useMemo(() => {
    // Every conducted class counts exactly once: theory and lab are both real
    // VTOP rows, so weighting one above the other would invent a rule.
    let totalAttended = 0;
    let totalClasses = 0;
    for (const { record, key } of rows) {
      const skips = simSkips[key] || 0;
      totalAttended += record.attended;
      totalClasses += record.totalHeld + skips;
    }
    const origTotal = rows.reduce((s, r) => s + r.record.totalHeld, 0);
    const origAttended = rows.reduce((s, r) => s + r.record.attended, 0);
    return {
      original: origTotal > 0 ? ((origAttended / origTotal) * 100).toFixed(1) : '—',
      simulated: totalClasses > 0 ? ((totalAttended / totalClasses) * 100).toFixed(1) : '—',
      hasSimulation: Object.values(simSkips).some((v: number) => v > 0),
    };
  }, [rows, simSkips]);

  return (
    <div className="space-y-4">
      {/* Overall simulation result */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-violet-500/10 border border-violet-500/20 rounded-2xl text-violet-600">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Attendance Predictor</h3>
            <p className="text-xs text-zinc-500 font-medium">Simulate future absences and see the impact</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 text-center">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Current (VTOP)</p>
            <p className="text-3xl font-black font-mono text-zinc-900 mt-1">{simStats.original === '—' ? '—' : `${simStats.original}%`}</p>
          </div>
          <div className={`border rounded-2xl p-4 text-center ${
            simStats.simulated === '—' ? 'bg-zinc-50 border-zinc-200' :
            Number(simStats.simulated) >= safetyThreshold
              ? 'bg-emerald-500/10 border-emerald-500/20'
              : 'bg-rose-500/10 border-rose-500/20'
          }`}>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">After Simulation</p>
            <p className={`text-3xl font-black font-mono mt-1 ${
              simStats.simulated === '—' ? 'text-zinc-500' :
              Number(simStats.simulated) >= safetyThreshold ? 'text-emerald-600' : 'text-rose-600'
            }`}>{simStats.simulated === '—' ? '—' : `${simStats.simulated}%`}</p>
          </div>
        </div>
        <p className="mt-3 text-[10px] text-zinc-500">
          Combined across every VTOP attendance row (theory and lab counted once each). Simulate per component below.
        </p>
      </div>

      {/* Per-course simulator */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-xl">
        <h3 className="text-sm font-bold text-zinc-900 mb-4">Skip Simulator</h3>
        <div className="space-y-2">
          {rows.filter(({ record }) => record.totalHeld > 0).map(({ record: a, key, component }) => {
            const skips = simSkips[key] || 0;
            const newTotal = a.totalHeld + skips;
            const newPct = newTotal > 0 ? ((a.attended / newTotal) * 100).toFixed(1) : '0';
            const origPct = a.percentage;

            return (
              <div key={key} className="flex items-center gap-3 p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-zinc-900 font-mono">{a.courseCode}</span>
                  {/* Which half of the course this simulator row controls. */}
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-zinc-500 border border-zinc-200 rounded px-1 py-px">{componentLabel(component)}</span>
                  <span className="text-[10px] text-zinc-500 ml-1">{a.courseTitle}</span>
                  <p className="text-[9px] text-zinc-600 mt-0.5">{a.attended}/{a.totalHeld} → {a.attended}/{newTotal}</p>
                </div>

                {/* Skip buttons — 44px targets with real accessible names. */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => toggleSkip(key, -1)}
                    disabled={skips === 0}
                    aria-label={`Simulate one fewer skipped ${componentLabel(component)} class for ${a.courseCode}`}
                    className="w-11 h-11 rounded-lg bg-zinc-100 text-zinc-500 hover:text-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-base font-bold cursor-pointer transition"
                  >−</button>
                  <span className="w-6 text-center text-xs font-mono font-bold text-amber-600" aria-live="polite">{skips}</span>
                  <button
                    onClick={() => toggleSkip(key, 1)}
                    aria-label={`Simulate skipping one more ${componentLabel(component)} class for ${a.courseCode}`}
                    className="w-11 h-11 rounded-lg bg-zinc-100 text-zinc-500 hover:text-zinc-900 flex items-center justify-center text-base font-bold cursor-pointer transition"
                  >+</button>
                </div>

                {/* Resulting percentage */}
                <div className="text-right shrink-0 w-16">
                  <p className={`text-sm font-black font-mono ${
                    Number(newPct) >= safetyThreshold ? 'text-emerald-600' :
                    Number(newPct) >= 75 ? 'text-amber-600' : 'text-red-600'
                  }`}>{newPct}%</p>
                  {skips > 0 && (
                    <p className={`text-[9px] font-mono ${
                      Number(newPct) < Number(origPct) ? 'text-red-600' : 'text-emerald-600'
                    }`}>
                      {Number(newPct) < Number(origPct) ? '↓' : '→'} {origPct}%
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
