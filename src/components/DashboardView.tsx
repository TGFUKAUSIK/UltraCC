import React, { useState } from 'react';
import { StudentProfile, AttendanceRecord, TimetableSlot, ExamSchedule, AssignmentTask, NextActionState, CourseMarks } from '../types';
import { OdSummary, SemesterInfo, CircularRecord } from '../lib/vtop/types';
import { NextActionEngine } from './NextActionEngine';
import { calculateBunkStats } from '../utils/nextActionEngine';
import { nextUpcomingExam } from '../utils/examUtils';
import { calculateAcademicHealth, calculateExamPressure, calculateWeeklySummary } from '../utils/academicHealth';
import { isEvaluatedAssessment } from '../utils/assessmentStatus';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import {
  BookOpen,
  Calendar,
  AlertTriangle,
  Sparkles,
  Layers,
  ArrowUpRight,
  ShieldAlert,
  GraduationCap,
  CheckCircle,
  UserCheck,
  CalendarDays,
  Activity,
  Flame,
  BarChart2,
} from 'lucide-react';

interface DashboardViewProps {
  student: StudentProfile;
  attendance: AttendanceRecord[];
  timetable: TimetableSlot[];
  exams: ExamSchedule[];
  assignments: AssignmentTask[];
  /** Real per-course internal marks (CAT/DA/Quiz/FAT) — empty = not synced. */
  marks?: CourseMarks[];
  /** VTOP circulars/notices (sanitized, from the cost-centre page). */
  circulars?: CircularRecord[];
  od: OdSummary | null;
  nextActionState: NextActionState;
  /** Active semester label from the saved VTOP selection (e.g. "Winter Semester 2025-26"). */
  semesterLabel?: string;
  /** Available semesters (from VTOP) for the in-dashboard selector. */
  semesters?: SemesterInfo[];
  /** Currently selected semester id (persisted in IndexedDB metadata). */
  selectedSemesterId?: string;
  /** Called when the user picks a different semester (triggers a re-sync). */
  onSemesterChange?: (semesterId: string) => void;
  /** Called when the user needs to log in (no live session for re-sync). */
  onOpenSync?: () => void;
  onNavigateTab: (tab: string) => void;
}

/** Display helper: never show a placeholder faculty name. */
function facultyLabel(name: string): string {
  return name && name.trim() ? name : '—';
}

function valueLabel(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : String(v);
}

/** Free windows between a day's classes (sorted by start time). */
function freeWindows(slots: TimetableSlot[]): { start: string; end: string; minutes: number }[] {
  const sorted = [...slots]
    .filter((s) => s.startTime && s.endTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const windows: { start: string; end: string; minutes: number }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gapMin = toMinutes(sorted[i + 1].startTime) - toMinutes(sorted[i].endTime);
    if (gapMin >= 40) {
      windows.push({ start: sorted[i].endTime, end: sorted[i + 1].startTime, minutes: gapMin });
    }
  }
  return windows;
}

function toMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  student,
  attendance,
  timetable,
  exams,
  assignments,
  marks,
  circulars,
  od,
  nextActionState,
  semesterLabel,
  semesters,
  selectedSemesterId,
  onSemesterChange,
  onOpenSync,
  onNavigateTab,
}) => {
  const [cgpaHidden] = useCgpaPrivacy();
  const [showAllOd, setShowAllOd] = useState(false);
  // Extra assessment rows (soft-skill "Assessment - N", lab experiments, PATs)
  // that don't fit the CAT/DA/Quiz grid — collapsed until the student opens them.
  const [expandedMarksCourses, setExpandedMarksCourses] = useState<Set<string>>(new Set());
  const toggleMarksCourse = (code: string) =>
    setExpandedMarksCourses((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  // Find critical attendance courses (< 75%)
  const criticalCourses = attendance.filter((a) => a.percentage < 75);

  // Today's timetable slots (actual current weekday — not a hardcoded sample)
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const todaySlots = timetable.filter((s) => s.day === todayName);
  const windows = freeWindows(todaySlots);

  // Next upcoming exam, computed chronologically (India-timezone-safe)
  const next = nextUpcomingExam(exams);
  const upcomingExam = next?.exam ?? null;
  const examLabel = upcomingExam?.courseCode
    ? `${upcomingExam.courseCode}${upcomingExam.courseTitle ? ': ' + upcomingExam.courseTitle : ''}`
    : upcomingExam?.slot
      ? `Slot ${upcomingExam.slot}${upcomingExam.examType ? ' • ' + upcomingExam.examType : ''}`
      : upcomingExam?.examType || 'Exam';

  const odAvailable = !!od?.available && od.totalOdHours >= 0;
  const odRemaining = odAvailable ? Math.max(0, (od?.limitHours ?? 40) - (od?.totalOdHours ?? 0)) : 0;

  const academicHealth = calculateAcademicHealth(student.cgpa, attendance, marks);
  const examPressure = calculateExamPressure(exams);
  const weeklySummary = calculateWeeklySummary(timetable);

  return (
    <div className="space-y-6 pb-12">
      {/* Student Welcome Banner Card */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 relative overflow-hidden shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Student Profile</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live VTOP
              </span>
              <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                {semesterLabel ? semesterLabel : `Semester ${student.semester || '—'}`}
              </span>
              {semesters && semesters.length > 0 && onSemesterChange && (
                <select
                  aria-label="Active semester"
                  value={selectedSemesterId || ''}
                  onChange={(e) => (onSemesterChange ? onSemesterChange(e.target.value) : onOpenSync?.())}
                  title="Change semester — re-syncs attendance, timetable, marks, exams & OD"
                  className="bg-white border border-zinc-200 rounded-lg px-2 py-1 text-[11px] font-bold text-zinc-900 focus:border-teal-500 focus:outline-none cursor-pointer max-w-[220px]"
                >
                  {semesters.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (Active)' : ''}</option>
                  ))}
                </select>
              )}
            </div>
            <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight mt-1">
              Welcome back, {student.name.split(' ')[0]} 👋
            </h1>
            <p className="text-sm text-zinc-500 mt-1 font-medium">
              {student.branch || student.school} • Reg: <span className="font-mono text-blue-600 font-bold">{student.regNo}</span>
            </p>
          </div>

          {/* Key Metrics + Quick Actions — a single right-hand column so the
              desktop row has no `mt-*` misalignment between the profile text,
              the metrics and the shortcuts. */}
          <div className="flex flex-col items-stretch lg:items-end gap-3">
            <div className="grid grid-cols-3 gap-3 bg-zinc-50 p-3 rounded-2xl border border-zinc-200">
              <div className="p-2.5 text-center">
                <p className="text-[10px] uppercase font-bold text-zinc-500">CGPA</p>
                <p className="text-2xl font-black text-zinc-900">
                  {cgpaHidden ? '••••' : student.cgpa !== null && student.cgpa !== undefined ? valueLabel(student.cgpa) : '—'}
                </p>
                {student.cgpa === null && <p className="text-[9px] text-zinc-600 mt-0.5">not synced</p>}
              </div>
              <div className="p-2.5 text-center border-x border-zinc-200">
                <p className="text-[10px] uppercase font-bold text-zinc-500">Credits</p>
                <p className="text-base font-bold text-zinc-900 mt-1">
                  {student.totalCreditsCompleted !== null && student.totalCreditsRequired !== null
                    ? `${student.totalCreditsCompleted} / ${student.totalCreditsRequired}`
                    : '—'}
                </p>
                {student.totalCreditsCompleted === null && <p className="text-[9px] text-zinc-600 mt-0.5">earned / registered</p>}
              </div>
              <div className="p-2.5 text-center">
                <p className="text-[10px] uppercase font-bold text-zinc-500">Proctor</p>
                <p className="text-xs font-bold text-blue-700 truncate mt-1">
                  {student.proctorAvailable ? student.proctorName.split('(')[0] : 'Unavailable'}
                </p>
                {!student.proctorAvailable && <p className="text-[9px] text-zinc-600 mt-0.5">not on VTOP</p>}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button onClick={() => onNavigateTab('timetable')} className="px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-900 hover:text-zinc-900 hover:border-zinc-200 transition cursor-pointer flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 acc-text" /> Timetable
              </button>
              <button onClick={() => onNavigateTab('grades')} className="px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-900 hover:text-zinc-900 hover:border-zinc-200 transition cursor-pointer flex items-center gap-1.5">
                <GraduationCap className="h-3.5 w-3.5 acc-text" /> Marks
              </button>
              <button onClick={() => onNavigateTab('exams')} className="px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-900 hover:text-zinc-900 hover:border-zinc-200 transition cursor-pointer flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 acc-text" /> Exams
              </button>
              <button onClick={() => onNavigateTab('calendar')} className="px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-900 hover:text-zinc-900 hover:border-zinc-200 transition cursor-pointer flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 acc-text" /> Calendar
              </button>
              <button onClick={() => onNavigateTab('academics')} className="px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-900 hover:text-zinc-900 hover:border-zinc-200 transition cursor-pointer flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5 acc-text" /> Attendance
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Contextual Next-Action Engine Banner */}
      <NextActionEngine state={nextActionState} onNavigateMap={() => onNavigateTab('campus')} />

      {/* Novelty Analytics Trio: Academic Health, Weekly Load, Exam Pressure */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Academic Health Index */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600">
                  <Activity className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Academic Health</h3>
                  <p className="text-xs text-zinc-500">Attendance + CGPA + Marks</p>
                </div>
              </div>
              <span className={`px-2.5 py-1 text-xs font-black rounded-lg border ${
                academicHealth.status === 'Excellent' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                academicHealth.status === 'Good' ? 'bg-teal-500/10 text-teal-600 border-teal-500/20' :
                academicHealth.status === 'Fair' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
                'bg-rose-500/10 text-rose-600 border-rose-500/20'
              }`}>
                {academicHealth.status}
              </span>
            </div>

            <div className="flex items-baseline gap-2 mt-2">
              <span className={`text-4xl font-black font-mono ${academicHealth.color}`}>
                {academicHealth.score !== null ? `${academicHealth.score}` : '—'}
              </span>
              {academicHealth.score !== null && <span className="text-xs text-zinc-500 font-bold">/ 100</span>}
            </div>
            <p className="text-xs text-zinc-500 mt-1 font-medium">{academicHealth.summary}</p>

            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-[11px] text-zinc-500">
                <span>Attendance Score</span>
                <span className="font-mono text-zinc-900 font-bold">{academicHealth.attendanceScore === null ? '—' : `${academicHealth.attendanceScore}%`}</span>
              </div>
              <div className="w-full bg-white h-1.5 rounded-full overflow-hidden border border-zinc-200">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, academicHealth.attendanceScore ?? 0)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-200 text-[11px] text-zinc-500 flex justify-between items-center">
            <span>Authoritative credits synced</span>
            <button onClick={() => onNavigateTab('academics')} className="text-emerald-600 font-bold hover:underline cursor-pointer">
              Details →
            </button>
          </div>
        </div>

        {/* Weekly Academic Load */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-600">
                  <BarChart2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Weekly Load</h3>
                  <p className="text-xs text-zinc-500">FFCS Timetable Structure</p>
                </div>
              </div>
              <span className="px-2.5 py-1 text-xs font-mono font-bold rounded-lg bg-sky-500/10 text-sky-600 border border-sky-500/20">
                {weeklySummary.totalSlots} Slots
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-200 text-center">
                <p className="text-xs font-bold text-zinc-500">Theory</p>
                <p className="text-xl font-black text-zinc-900 font-mono mt-0.5">{weeklySummary.theorySlots}</p>
                <p className="text-[10px] text-zinc-600">lecture slots</p>
              </div>
              <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-200 text-center">
                <p className="text-xs font-bold text-zinc-500">Labs</p>
                <p className="text-xl font-black text-teal-600 font-mono mt-0.5">{weeklySummary.labSlots}</p>
                <p className="text-[10px] text-zinc-600">practical slots</p>
              </div>
            </div>

            <p className="text-xs text-zinc-500 mt-3 font-medium">
              {weeklySummary.busiestDay
                ? `Peak day: ${weeklySummary.busiestDay.day} (${weeklySummary.busiestDay.count} classes)`
                : 'No registered classes scheduled this week.'}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-200 text-[11px] text-zinc-500 flex justify-between items-center">
            <span>{weeklySummary.totalDaysWithClasses} active days / week</span>
            <button onClick={() => onNavigateTab('timetable')} className="text-sky-600 font-bold hover:underline cursor-pointer">
              Timetable →
            </button>
          </div>
        </div>

        {/* Exam Pressure & Horizon */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600">
                  <Flame className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Exam Pressure</h3>
                  <p className="text-xs text-zinc-500">Upcoming 7 &amp; 14 Day Horizon</p>
                </div>
              </div>
              <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${
                examPressure.pressureLevel === 'Peak' ? 'bg-rose-500/10 text-rose-600 border-rose-500/20' :
                examPressure.pressureLevel === 'High' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
                'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
              }`}>
                {examPressure.badge}
              </span>
            </div>

            <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-200 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Next Exam in</span>
                <span className="font-mono font-black text-amber-600">
                  {examPressure.daysToNextExam !== null ? `${examPressure.daysToNextExam} days` : 'None scheduled'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">In next 7 days</span>
                <span className="font-mono font-bold text-zinc-900">{examPressure.examsIn7Days} exam(s)</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">In next 14 days</span>
                <span className="font-mono font-bold text-zinc-900">{examPressure.examsIn14Days} exam(s)</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-200 text-[11px] text-zinc-500 flex justify-between items-center">
            <span>Physical ID required</span>
            <button onClick={() => onNavigateTab('exams')} className="text-amber-600 font-bold hover:underline cursor-pointer">
              Schedule →
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Timetable Today + Attendance Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Timetable Schedule (2 Columns) */}
        <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-900">Today's Class Schedule</h2>
                  <p className="text-xs text-zinc-500">{todayName} — FFCS slots</p>
                </div>
              </div>
              <button
                onClick={() => onNavigateTab('timetable')}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer bg-white border border-zinc-200 px-3 py-1.5 rounded-xl"
              >
                Full FFCS Grid <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {todaySlots.length > 0 ? (
              <div className="space-y-3">
                {todaySlots.map((slot) => {
                  const courseAtt = attendance.find((a) => a.courseCode === slot.courseCode);
                  const isCritical = courseAtt && courseAtt.percentage < 75;

                  return (
                    <div
                      key={slot.id}
                      className={`p-4 rounded-2xl border flex items-center justify-between transition ${
                        isCritical
                          ? 'bg-rose-50 border-rose-800/50 hover:bg-rose-50'
                          : 'bg-zinc-50 border-zinc-200 hover:border-zinc-200'
                      }`}
                    >
                      <div className="flex items-center space-x-3.5">
                        <div className="text-center px-3 py-2 rounded-xl bg-white text-zinc-900 font-mono text-xs border border-zinc-200 shrink-0">
                          <span className="block font-extrabold text-blue-600">{slot.slot}</span>
                          <span className="text-[10px] text-zinc-500">{slot.startTime}</span>
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                            {slot.courseCode}: {slot.courseTitle}
                            {slot.isLab && (
                              <span className="text-[10px] px-2 py-0.5 bg-teal-500/10 text-teal-700 rounded-md border border-teal-500/20 font-mono font-bold">
                                LAB
                              </span>
                            )}
                          </h4>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            Venue: <span className="text-zinc-900 font-semibold">{slot.venue || '—'}</span> | {facultyLabel(slot.facultyName)}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        {courseAtt && (
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-xs font-extrabold font-mono ${
                                courseAtt.percentage >= 80
                                  ? 'text-emerald-600'
                                  : courseAtt.percentage >= 75
                                  ? 'text-amber-600'
                                  : 'text-rose-600'
                              }`}
                            >
                              {courseAtt.percentage}%
                            </span>
                            <span className="text-[10px] text-zinc-500 font-medium mt-0.5">
                              {calculateBunkStats(courseAtt, 75).canBunk > 0
                                ? `${calculateBunkStats(courseAtt, 75).canBunk} safe bunks`
                                : `Must attend!`}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 rounded-2xl border border-zinc-200 bg-zinc-50 text-center">
                <p className="text-sm font-bold text-zinc-900">No classes today 🎉</p>
                <p className="text-xs text-zinc-500 mt-1">No timetable entries for {todayName}.</p>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 font-medium">
            <span>
              {windows.length > 0
                ? `Free windows: ${windows.map((w) => `${w.start}–${w.end} (${w.minutes}m)`).join(' • ')}`
                : 'No free windows between today\'s classes'}
            </span>
            <span className="text-blue-600 font-mono">Chennai Campus</span>
          </div>
        </div>

        {/* Attendance Safety Radar (1 Column) */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-900">Attendance Radar</h2>
                  <p className="text-xs text-zinc-500">75% Safety Threshold</p>
                </div>
              </div>
              <button
                onClick={() => onNavigateTab('academics')}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer bg-white border border-zinc-200 px-3 py-1.5 rounded-xl"
              >
                Calculator <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {criticalCourses.length > 0 ? (
              <div className="mb-4 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 text-xs">
                <div className="flex items-center space-x-1.5 font-bold text-rose-700 mb-1">
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                  <span>DEBARRED WARNING RISK ({criticalCourses.length} Course)</span>
                </div>
                {criticalCourses.map((c) => (
                  <p key={c.courseCode} className="mt-1 leading-relaxed">
                    <span className="font-semibold">{c.courseCode} ({c.courseTitle})</span> is at{' '}
                    <span className="font-mono font-bold text-rose-600">{c.percentage}%</span>. Must attend next{' '}
                    <span className="underline font-bold text-zinc-900">
                      {calculateBunkStats(c, 75).mustAttend}
                    </span>{' '}
                    classes!
                  </p>
                ))}
              </div>
            ) : (
              <div className="mb-4 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs">
                <CheckCircle className="h-4 w-4 inline mr-1 text-emerald-600" /> All courses currently safe above 75%!
              </div>
            )}

            <div className="space-y-3.5">
              {attendance.slice(0, 4).map((record) => {
                const bunkInfo = calculateBunkStats(record, 75);
                return (
                  <div key={record.courseCode} className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="font-bold text-zinc-900 truncate max-w-[170px]">
                        {record.courseCode}: {record.courseTitle}
                      </span>
                      <span
                        className={`font-mono font-bold ${
                          record.percentage >= 80
                            ? 'text-emerald-600'
                            : record.percentage >= 75
                            ? 'text-amber-600'
                            : 'text-rose-600'
                        }`}
                      >
                        {record.percentage}%
                      </span>
                    </div>
                    <div className="w-full bg-white h-2 rounded-full overflow-hidden border border-zinc-200">
                      <div
                        className={`h-full transition-all duration-500 ${
                          record.percentage >= 80
                            ? 'bg-emerald-500'
                            : record.percentage >= 75
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.min(100, record.percentage)}%` }}
                      ></div>
                    </div>
                    <p className="text-[10px] text-zinc-500 text-right font-mono">
                      {bunkInfo.safeToBunk ? `${bunkInfo.canBunk} safe bunks left` : bunkInfo.message}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-zinc-200 text-[11px] text-zinc-500 flex items-center justify-between">
            <span>Rule: 75% Mandatory | 80% Buffer</span>
            <span className="text-amber-600 font-bold">Bunk Engine Active</span>
          </div>
        </div>
      </div>

      {/* Second Row: Upcoming Exam + OD Hours + Assignments + AI Strategy */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Exam Countdown Card */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Upcoming Exam</h3>
                  <p className="text-xs text-zinc-500">Next exam chronologically</p>
                </div>
              </div>
              <button
                onClick={() => onNavigateTab('exams')}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer bg-white border border-zinc-200 px-3 py-1.5 rounded-xl"
              >
                Seating <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {upcomingExam ? (
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    {upcomingExam.examType && (
                      <span className="px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest rounded-md bg-rose-500/10 text-rose-600 border border-rose-500/20">
                        {upcomingExam.examType}
                      </span>
                    )}
                    <h4 className="text-sm font-bold text-zinc-900 mt-1.5">{examLabel}</h4>
                    <p className="text-[11px] text-zinc-500 mt-1 font-mono">{upcomingExam.date}</p>
                  </div>
                  {next && (
                    <span className="text-xs font-mono font-bold text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20 whitespace-nowrap">
                      {next.countdown}
                    </span>
                  )}
                </div>

                <p className="text-xs text-zinc-900">
                  {upcomingExam.time && (
                    <span className="font-semibold text-zinc-900">{upcomingExam.time}</span>
                  )}
                  {upcomingExam.time && (upcomingExam.venue || upcomingExam.seatNo) && <span> • </span>}
                  {upcomingExam.venue && (
                    <span>Venue: <span className="font-bold text-zinc-900">{upcomingExam.venue}</span></span>
                  )}
                  {upcomingExam.seatNo && (
                    <span>{upcomingExam.venue ? ' • ' : ''}Seat: {upcomingExam.seatNo}</span>
                  )}
                </p>
              </div>
            ) : (
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200 text-center py-8">
                <CheckCircle className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
                <p className="text-sm font-bold text-zinc-900">No upcoming exams</p>
                <p className="text-[11px] text-zinc-500 mt-1">All scheduled exams are over — enjoy the break 🎉</p>
              </div>
            )}
          </div>

          <div className="mt-4 text-xs text-zinc-500 flex items-center justify-between font-medium">
            <span>Carry Physical ID Card</span>
            <span className="text-rose-600 font-bold">{upcomingExam ? 'Hall Allocated' : '—'}</span>
          </div>
        </div>

        {/* On-Duty (OD) Hours Card */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-600">
                  <UserCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900">On-Duty (OD) Hours</h3>
                  <p className="text-xs text-zinc-500">From VTOP attendance detail</p>
                </div>
              </div>
              <button
                onClick={() => onNavigateTab('academics')}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer bg-white border border-zinc-200 px-3 py-1.5 rounded-xl"
              >
                Attendance <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {odAvailable ? (
              <div className="space-y-3">
                <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[10px] uppercase font-extrabold text-zinc-500">Used this semester</p>
                      <p className="text-2xl font-black text-sky-700">
                        {od!.totalOdHours}
                        <span className="text-xs text-zinc-500 font-bold ml-1">/ {od!.limitHours} hrs</span>
                      </p>
                    </div>
                    <span className="text-[11px] text-emerald-600 font-bold font-mono">
                      {odRemaining} hrs left
                    </span>
                  </div>
                  <div className="w-full bg-white h-2 rounded-full overflow-hidden border border-zinc-200 mt-3">
                    <div
                      className="h-full bg-sky-500 transition-all duration-500"
                      style={{ width: `${Math.min(100, (od!.totalOdHours / Math.max(1, od!.limitHours)) * 100)}%` }}
                    ></div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {(showAllOd ? od!.perCourse : od!.perCourse.slice(0, 3)).map((c, i) => (
                    <div key={`${c.courseCode}-${i}`} className="flex justify-between text-xs bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                      <span className="font-bold text-zinc-900 truncate max-w-[180px]">
                        {c.courseCode} <span className="text-zinc-500 font-medium">({c.odHours}h)</span>
                      </span>
                      <span className="font-mono text-sky-600 font-bold">{c.onDutyCount} OD</span>
                    </div>
                  ))}
                </div>
                {od!.perCourse.length > 3 && (
                  <button
                    onClick={() => setShowAllOd(!showAllOd)}
                    className="mt-2 text-[10px] font-bold text-sky-600 hover:text-sky-700 cursor-pointer"
                  >
                    {showAllOd ? 'Show fewer' : `Show all ${od!.perCourse.length} courses`}
                  </button>
                )}
              </div>
            ) : (
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200 text-center py-8">
                <UserCheck className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-sm font-bold text-zinc-900">OD data unavailable</p>
                <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                  {od ? 'VTOP exposes no On-Duty data for this student.' : 'Sync live VTOP data to see OD hours.'}
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 text-xs text-zinc-500 flex items-center justify-between font-medium">
            <span>OD ≠ attendance — counted separately</span>
            <span className="text-sky-600 font-bold">{odAvailable ? 'VTOP Synced' : '—'}</span>
          </div>
        </div>

        {/* AI Daily Academic Recommendation */}
        <div className="bg-white border border-blue-500/30 rounded-3xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600">
                <Sparkles className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-900">AI Strategy Advisor</h3>
                <p className="text-xs text-zinc-500">Optimized Daily Action</p>
              </div>
            </div>

            <div className="p-4 bg-zinc-50 rounded-2xl border border-blue-500/20 text-xs text-zinc-900 space-y-2.5 leading-relaxed">
              {criticalCourses.length > 0 ? (
                <>
                  <p className="font-extrabold text-blue-700 uppercase tracking-wider text-[10px]">
                    📌 High Priority Recommendation:
                  </p>
                  {criticalCourses.slice(0, 2).map((c) => (
                    <p key={c.courseCode}>
                      1. <span className="text-rose-700 font-bold">{c.courseCode} {c.courseTitle}</span> is at{' '}
                      <span className="font-mono font-bold text-rose-600">{c.percentage}%</span>. Prioritize attending
                      every remaining class.
                    </p>
                  ))}
                </>
              ) : (
                <p className="font-extrabold text-blue-700 uppercase tracking-wider text-[10px]">
                  📌 High Priority Recommendation:
                </p>
              )}
              {upcomingExam && (
                <p>
                  2. <span className="text-blue-700 font-bold">{upcomingExam.courseCode || upcomingExam.slot || 'Next exam'}</span>{' '}
                  on {upcomingExam.date}{next ? ` (${next.countdown})` : ''}. Start revision now.
                </p>
              )}
              {!criticalCourses.length && !upcomingExam && (
                <p>All courses are above 75% and no exams are scheduled. Use the free time to get ahead on assignments.</p>
              )}
            </div>
          </div>

          <button
            onClick={() => onNavigateTab('ai-advisor')}
            className="mt-4 w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-zinc-900 rounded-2xl text-xs font-extrabold transition flex items-center justify-center space-x-2 cursor-pointer shadow-lg shadow-blue-900/30"
          >
            <Sparkles className="h-4 w-4" />
            <span>Generate Full Exam Prep Plan</span>
          </button>
        </div>
      </div>

      {/* Marks strip — real per-course internal marks from VTOP */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-600">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900">Internal Marks</h3>
              <p className="text-xs text-zinc-500">CAT / Digital Assignment / Quiz scores from VTOP</p>
            </div>
          </div>
          <button
            onClick={() => onNavigateTab('grades')}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer bg-white border border-zinc-200 px-3 py-1.5 rounded-xl"
          >
            Grade Tools <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {marks && marks.length > 0 ? (
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
                  <th scope="col" className="py-2 pr-3 font-extrabold">Course</th>
                  <th scope="col" className="py-2 pr-3 font-extrabold">CAT 1</th>
                  <th scope="col" className="py-2 pr-3 font-extrabold">CAT 2</th>
                  <th scope="col" className="py-2 pr-3 font-extrabold">DA 1</th>
                  <th scope="col" className="py-2 pr-3 font-extrabold">DA 2</th>
                  <th scope="col" className="py-2 pr-3 font-extrabold">DA 3</th>
                  <th scope="col" className="py-2 pr-3 font-extrabold">Quiz</th>
                  <th scope="col" className="py-2 pr-3 font-extrabold">FAT</th>
                  <th scope="col" className="py-2 font-extrabold">Internal</th>
                </tr>
              </thead>
              <tbody>
                {marks.map((m) => {
                  // A row VTOP declared but has not graded shows "Pending", not
                  // a fabricated 0/50 — same rule as the marks page.
                  const cell = (c?: { scored: number; max: number; weightage?: number; status?: string }) =>
                    isEvaluatedAssessment(c) ? (
                      <span className="font-mono text-zinc-900">{c!.scored}<span className="text-zinc-600">/{c!.max}</span></span>
                    ) : (c && ((c.max ?? 0) > 0 || (c.weightage ?? 0) > 0)) ? (
                      <span className="text-[10px] text-zinc-500 font-medium">Pending</span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    );
                  return (
                    <React.Fragment key={m.courseCode}>
                    <tr className="border-t border-zinc-200">
                      <td className="py-2 pr-3">
                        <span className="font-mono font-bold text-zinc-900">{m.courseCode}</span>
                        <span className="block text-[10px] text-zinc-500 truncate max-w-[160px]">{m.courseTitle}</span>
                      </td>
                      <td className="py-2 pr-3">{cell(m.cat1)}</td>
                      <td className="py-2 pr-3">{cell(m.cat2)}</td>
                      <td className="py-2 pr-3">{cell(m.da1)}</td>
                      <td className="py-2 pr-3">{cell(m.da2)}</td>
                      <td className="py-2 pr-3">{cell(m.da3)}</td>
                      <td className="py-2 pr-3">{cell(m.quiz)}</td>
                      <td className="py-2 pr-3">{cell(m.fat)}</td>
                      <td className="py-2 font-mono font-bold text-emerald-600">
                        {Number.isFinite(m.totalScoredSoFar) && m.totalScoredSoFar > 0 ? m.totalScoredSoFar.toFixed(1) : '—'}
                      </td>
                    </tr>
                    {m.extraComponents && m.extraComponents.length > 0 && (
                      <tr className="border-t border-zinc-200">
                        <td colSpan={9} className="py-1 px-2">
                          <button
                            onClick={() => toggleMarksCourse(m.courseCode)}
                            className="text-[10px] text-blue-600 hover:text-blue-700 font-mono cursor-pointer flex items-center gap-1"
                          >
                            <span className="text-zinc-600">{expandedMarksCourses.has(m.courseCode) ? '▾' : '▸'}</span>
                            {m.extraComponents.length} more assessment{m.extraComponents.length > 1 ? 's' : ''} (Assessment / PAT / Exp)
                          </button>
                        </td>
                      </tr>
                    )}
                    {m.extraComponents && m.extraComponents.length > 0 && expandedMarksCourses.has(m.courseCode) && m.extraComponents.map((ec, i) => (
                      <tr key={`${m.courseCode}-extra-${i}`} className="border-t border-zinc-200 bg-zinc-50">
                        <td className="py-1.5 pl-6 pr-3">
                          <span className="text-[10px] text-zinc-500 font-mono">{ec.title}</span>
                        </td>
                        <td className="py-1.5 pr-3" colSpan={6}></td>
                        <td className="py-1.5 pr-3">
                          <span className="font-mono text-zinc-900 text-[11px]">
                            {isEvaluatedAssessment(ec)
                              ? <>{ec.scored}<span className="text-zinc-600">/{ec.max}</span></>
                              : (ec.max > 0 || ec.weightage > 0
                                ? <span className="text-[10px] text-zinc-500 font-sans font-medium">Pending</span>
                                : '—')}
                          </span>
                        </td>
                        <td className="py-1.5">
                          <span className="text-[10px] font-mono text-zinc-500">
                            {ec.weightage > 0 ? `${ec.weightage}%` : ''}
                          </span>
                        </td>
                      </tr>
                    ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200 text-center py-8">
            <GraduationCap className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm font-bold text-zinc-900">Marks not synced yet</p>
            <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed max-w-sm mx-auto">
              Re-sync from <strong className="text-zinc-900">Login</strong> to see your CAT / assignment marks here — they
              appear once VTOP publishes them.
            </p>
          </div>
        )}
      </div>

      {/* Pending DA Tasks strip */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-600">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900">Pending DA Tasks</h3>
              <p className="text-xs text-zinc-500">Digital Submissions</p>
            </div>
          </div>
          <span className="text-xs text-teal-600 font-bold px-2.5 py-1 bg-teal-500/10 rounded-full border border-teal-500/20">
            {assignments.length} Pending
          </span>
        </div>

        {assignments.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {assignments.map((as) => (
              <div key={as.id} className="p-3.5 bg-zinc-50 rounded-2xl border border-zinc-200 text-xs space-y-1">
                <div className="flex justify-between font-bold text-zinc-900">
                  <span className="truncate max-w-[180px]">{as.title}</span>
                  <span className="text-amber-600 font-mono">{as.dueDate}</span>
                </div>
                <p className="text-zinc-500 text-[11px] truncate">{as.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            {assignments.length === 0 && 'No pending assignments.'}
          </p>
        )}
      </div>

      {/* Circulars / notices from VTOP */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900">Circulars &amp; Notices</h3>
              <p className="text-xs text-zinc-500">From VTOP Chennai</p>
            </div>
          </div>
          <span className="text-xs text-zinc-500 font-bold px-2.5 py-1 bg-white rounded-full border border-zinc-200">
            {circulars && circulars.length > 0 ? `${circulars.length} circulars` : '—'}
          </span>
        </div>

        {circulars && circulars.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {circulars.slice(0, 8).map((c) => (
              <div key={c.id} className="p-3.5 bg-zinc-50 rounded-2xl border border-zinc-200 text-xs space-y-1">
                <p className="font-bold text-zinc-900 leading-snug">{c.title}</p>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 font-extrabold uppercase tracking-wider">
                    {c.category || 'Notice'}
                  </span>
                  {c.date && <span className="font-mono">{c.date}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            No circulars synced — re-sync from <strong className="text-zinc-900">Login</strong> to fetch VTOP notices.
          </p>
        )}
      </div>
    </div>
  );
};
