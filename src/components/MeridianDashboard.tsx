import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, ClipboardList, Clock3, Eye, EyeOff, ExternalLink, GraduationCap, MapPin, Send, ShieldCheck, Users } from 'lucide-react';
import { StudentProfile, AttendanceRecord, TimetableSlot, ExamSchedule, AssignmentTask, CourseMarks, NextActionState } from '../types';
import { CircularRecord, OdSummary, SemesterInfo } from '../lib/vtop/types';
import { calculateAcademicHealth } from '../utils/academicHealth';
import { ALL_WEEK_DAYS, getOngoingTimetableSlot, getNextTimetableSlot, isTimetableSlotOngoing } from '../utils/timetableGrid';
import { localTodayIso } from '../utils/localDate';
import { getCourseAcademicLabel, getInternalMarksRatio } from '../utils/internalMarks';
import { componentLabel, componentTotals, baseCourseCode, findCourseGroup, groupCourseAttendance } from '../utils/attendanceComponents';
import { nextUpcomingExam } from '../utils/examUtils';
import { ProfilePhoto } from './ProfilePhoto';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';

interface Props {
  student: StudentProfile; attendance: AttendanceRecord[]; timetable: TimetableSlot[]; exams: ExamSchedule[]; assignments: AssignmentTask[];
  marks?: CourseMarks[]; circulars?: CircularRecord[]; od: OdSummary | null; nextActionState?: NextActionState;
  semesterLabel?: string; semesters?: SemesterInfo[]; selectedSemesterId?: string; onSemesterChange?: (id: string) => void; profilePhotoUrl?: string; onNavigateTab: (tab: string) => void;
}
const display = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return !text || ['—', '-', 'n/a', 'na', 'not available'].includes(text.toLowerCase()) ? 'Not available' : text;
};
const percent = (n: number) => `${Math.max(0, Math.min(100, n)).toFixed(1)}%`;
const dayLabel = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long' }) as TimetableSlot['day'];
const nextCalendarDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
const initials = (name: string) => name.trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2) || '—';
/** "14:00" -> "2:00 PM" (keeps the raw value when it is not a clock time). */
const clockLabel = (value: string) => {
  const match = (value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value || '—';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
};

export const UltraCCDashboard: React.FC<Props> = ({ student, attendance, timetable, exams, assignments, marks = [], circulars = [], od, nextActionState, semesterLabel, profilePhotoUrl, onNavigateTab }) => {
  const [scheduleView, setScheduleView] = useState<'today' | 'tomorrow' | 'week'>('today');
  const [cgpaHidden, setCgpaHidden] = useCgpaPrivacy();
  // One live clock for the whole dashboard, so class start/end flips markers
  // on its own.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(tick);
  }, []);
  const today = now;
  const todayName = dayLabel(today);
  const tomorrowName = dayLabel(nextCalendarDay(today));
  const scheduleSlots = useMemo(() => {
    const selected = scheduleView === 'today' ? todayName : tomorrowName;
    return timetable.filter(slot => scheduleView === 'week' || slot.day === selected).sort((a, b) => (ALL_WEEK_DAYS.indexOf(a.day) - ALL_WEEK_DAYS.indexOf(b.day)) || a.startTime.localeCompare(b.startTime));
  }, [scheduleView, timetable, todayName, tomorrowName]);
  // Attended over held (not an average of per-course percentages), matching
  // VTOP's figure.
  const attendedClasses = attendance.reduce((sum, row) => sum + (row.totalHeld > 0 ? row.attended : 0), 0);
  const heldClasses = attendance.reduce((sum, row) => sum + Math.max(0, row.totalHeld), 0);
  const avgAttendance = heldClasses > 0 ? (attendedClasses / heldClasses) * 100 : null;
  // VTOP tracks theory and lab as separate records; show each component's own
  // figure alongside the headline.
  const attendanceTotals = useMemo(() => componentTotals(attendance), [attendance]);
  const attendanceNote = attendance.length === 0
    ? 'Sync data to view attendance'
    : attendanceTotals.present.length > 1
      ? attendanceTotals.present.map(c => `${componentLabel(c.kind)} ${c.percentage === null ? 'not started' : percent(c.percentage)}`).join(' · ')
      : `${attendance.length} courses synced`;
  const health = calculateAcademicHealth(student.cgpa, attendance, marks);
  // One card per course. VTOP files a course's theory and lab halves under
  // sibling codes (CSE2001 / CSE2001L), so cards are keyed by base code and
  // report both components.
  const courseCards = useMemo(() => {
    const groups = groupCourseAttendance(attendance);
    const codesByBase = new Map<string, string[]>();
    for (const code of [...timetable.map(x => x.courseCode), ...attendance.map(x => x.courseCode), ...marks.map(x => x.courseCode)]) {
      if (!code) continue;
      const base = baseCourseCode(code) || code;
      const list = codesByBase.get(base);
      if (list) { if (!list.includes(code)) list.push(code); } else codesByBase.set(base, [code]);
    }
    return [...codesByBase.entries()].map(([base, codes]) => ({
      base,
      codes,
      group: findCourseGroup(base, groups),
      mark: marks.find(m => codes.includes(m.courseCode)) ?? null,
    }));
  }, [attendance, timetable, marks]);
  const todayIso = localTodayIso(today);
  const nextExam = exams
    .filter((exam) => exam.date && exam.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  // The chronologically next exam, IST-safe and honouring the start time so an
  // exam already past today drops out. Recomputed on the 30s tick.
  const upcomingExam = useMemo(() => nextUpcomingExam(exams, now.getTime()), [exams, now]);
  // VTOP lists future exams (e.g. CAT 2) before publishing their dates; an
  // undated row surfaced as "next scheduled" reads as a bug.
  const undatedExamsPending = !nextExam && exams.some((exam) => !exam.date);
  const creditsProgress = student.totalCreditsRequired && student.totalCreditsCompleted !== null ? (student.totalCreditsCompleted / student.totalCreditsRequired) * 100 : null;
  const pending = assignments.filter(a => a.status === 'Pending');
  const firstName = display(student.name).split(' ')[0];
  // Identity line under the student's name. VTOP's profile page has no branch
  // row for Chennai students, so the School is named there. Not `groupStudied`:
  // that is the Class-XII group and read as a wrong course label.
  const branchLine = student.branch || student.school || '';
  const scheduleTitle = scheduleView === 'week' ? 'This week’s timetable' : `${scheduleView === 'today' ? "Today’s" : 'Tomorrow’s'} timetable`;
  const scheduleSub = scheduleView === 'week' ? `${timetable.length} sessions in the synced timetable` : `${scheduleView === 'today' ? todayName : tomorrowName} · ${scheduleSlots.length} sessions`;
  // Live class state, only on the "Today" view. A 2-period lab counts as
  // ongoing for its whole block.
  const showLiveStates = scheduleView === 'today';
  const ongoingSlot = useMemo(() => (showLiveStates ? getOngoingTimetableSlot(timetable, now) : null), [showLiveStates, timetable, now]);
  const nextSlot = useMemo(() => (showLiveStates ? getNextTimetableSlot(timetable, now) : null), [showLiveStates, timetable, now]);

  return <div className="portal-dashboard">
    <section className="portal-page-heading">
      <div className="portal-heading-identity"><ProfilePhoto name={student.name} src={profilePhotoUrl} size="md" /><div><span className="portal-eyebrow">VIT Chennai · Student Portal</span><h1>Welcome back, {firstName}</h1><p>{display(branchLine)} <span>·</span> {display(semesterLabel || (student.semester ? `Semester ${student.semester}` : null))}</p></div></div>
      <div className="portal-heading-actions"><span className="portal-record-date">{today.toLocaleDateString('en-IN', { dateStyle: 'long' })}</span><button className="portal-outline-button" onClick={() => onNavigateTab('my-info')}>Student profile <ArrowRight size={14} /></button></div>
    </section>

    <section className="portal-summary-grid" aria-label="Academic summary">
      <SummaryCard label="CGPA" value={cgpaHidden ? '••••' : display(student.cgpa)} suffix="/ 10.0" note={cgpaHidden ? 'Tap the eye to show your CGPA' : 'Cumulative grade point average'} onClick={() => onNavigateTab('grades')} privacyMode privacyHidden={cgpaHidden} onTogglePrivacy={() => setCgpaHidden(!cgpaHidden)} />
      <SummaryCard label="Overall attendance" value={avgAttendance === null ? 'Not available' : percent(avgAttendance)} note={attendanceNote} onClick={() => onNavigateTab('academics')} tone={avgAttendance !== null && avgAttendance < 75 ? 'warning' : 'normal'} />
      <SummaryCard label="Credits completed" value={display(student.totalCreditsCompleted)} suffix={student.totalCreditsRequired ? `/ ${student.totalCreditsRequired}` : ''} note={creditsProgress === null ? 'Degree progress not available' : `${percent(creditsProgress)} of required credits`} onClick={() => onNavigateTab('grades')} progress={creditsProgress} />
      <SummaryCard label="Academic standing" value={health.score === null ? 'Not available' : `${health.score}/100`} note="Based on available academic records" onClick={() => onNavigateTab('academics')} />
    </section>

    {upcomingExam && (
      <section className="portal-exam-banner" aria-label="Upcoming examination">
        <div className="portal-exam-banner-icon"><ClipboardList size={20} /></div>
        <div className="portal-exam-banner-main">
          <span className="portal-eyebrow">{display(upcomingExam.exam.examType)} · Next exam</span>
          <strong>{upcomingExam.exam.courseCode || (upcomingExam.exam.slot ? `Slot ${upcomingExam.exam.slot}` : 'Examination')}{upcomingExam.exam.courseTitle ? ` · ${display(upcomingExam.exam.courseTitle)}` : ''}</strong>
          <p>
            {upcomingExam.exam.date && <span>{display(upcomingExam.exam.date)}</span>}
            {upcomingExam.exam.time && <span>· {display(upcomingExam.exam.time)}</span>}
            {upcomingExam.exam.venue && <span>· {display(upcomingExam.exam.venue)}</span>}
            {upcomingExam.exam.seatNo && <span>· Seat {display(upcomingExam.exam.seatNo)}</span>}
          </p>
        </div>
        <div className="portal-exam-banner-countdown"><span>Countdown</span><strong>{upcomingExam.countdown}</strong></div>
        <button className="portal-primary-button" onClick={() => onNavigateTab('exams')}>View schedule <ArrowRight size={14} /></button>
      </section>
    )}

    <div className="portal-dashboard-grid">
      <section className="portal-panel portal-span-8">
        <PanelHeader icon={<CalendarDays size={18} />} title={scheduleTitle} sub={scheduleSub} action={<div className="portal-tabs">{(['today', 'tomorrow', 'week'] as const).map(value => <button key={value} className={scheduleView === value ? 'selected' : ''} onClick={() => setScheduleView(value)}>{value === 'today' ? 'Today' : value === 'tomorrow' ? 'Tomorrow' : 'Week'}</button>)}</div>} />
        {ongoingSlot && <div className="portal-now-banner" role="status" aria-live="polite"><span className="timetable-live-dot" aria-hidden="true" /><span><b>In class now</b> {ongoingSlot.courseCode}{ongoingSlot.slot ? ` · ${ongoingSlot.slot}` : ''}{ongoingSlot.venue ? ` · ${ongoingSlot.venue}` : ''} <small>until {clockLabel(ongoingSlot.endTime)}</small></span><button onClick={() => onNavigateTab('timetable')}>Open timetable</button></div>}
        {scheduleSlots.length ? <div className="portal-schedule-list">{scheduleSlots.slice(0, 8).map((slot) => {
          // Only the class genuinely happening right now is highlighted.
          const ongoing = showLiveStates && isTimetableSlotOngoing(slot, now);
          const upcoming = showLiveStates && !ongoing && nextSlot?.id === slot.id;
          return <div className={`portal-schedule-row ${ongoing ? 'is-ongoing' : ''} ${upcoming ? 'is-next' : ''}`} key={`${slot.id}-${slot.day}`}><time>{clockLabel(slot.startTime)}<small>{clockLabel(slot.endTime)}</small></time><div className="portal-schedule-main"><span className="portal-schedule-title"><strong>{slot.courseCode}: {display(slot.courseTitle)}</strong>{ongoing && <span className="portal-live-chip" title={`Happening now · until ${clockLabel(slot.endTime)}`}><span className="timetable-live-dot" aria-hidden="true" />Ongoing</span>}{upcoming && <span className="portal-live-chip next">Up next</span>}</span><span><Users size={13} /> {display(slot.facultyName)} <i>·</i> <MapPin size={13} /> {display(slot.venue)}</span><small>{slot.day} · {slot.isLab ? 'Lab' : 'Theory'}{slot.slot ? ` · Slot ${slot.slot}` : ''} · {display(slot.roomNo)}</small></div><button className="portal-row-link" onClick={() => onNavigateTab('timetable')} aria-label={`Open the timetable for ${slot.courseCode}`}><span>View timetable</span> <ArrowRight size={13} /></button></div>;
        })}</div> : <Empty text={`No classes found for ${scheduleView === 'week' ? 'the synced week' : scheduleView}.`} action="Open timetable" onClick={() => onNavigateTab('timetable')} />}
        {/* Summary panel: state what is cut off. */}
        {scheduleSlots.length > 8 && <div className="portal-panel-footer"><span>Showing the first 8 of {scheduleSlots.length} sessions</span><button className="portal-row-link" onClick={() => onNavigateTab('timetable')}>Open full timetable <ArrowRight size={13} /></button></div>}
        {nextActionState && <div className="portal-next-action"><Clock3 size={15} /><span><b>Next action</b> {nextActionState.title} <small>{nextActionState.timeContext || 'From synced data'}</small></span><button onClick={() => onNavigateTab('timetable')}>Open</button></div>}
      </section>

      <section className="portal-panel portal-span-4">
        <PanelHeader icon={<GraduationCap size={18} />} title="Academic summary" sub="Information available from your profile" />
        <dl className="portal-detail-list"><Detail label="Registration number" value={display(student.regNo)} /><Detail label="Programme" value={display(student.program)} /><Detail label="Branch" value={display(student.branch)} /><Detail label="School" value={display(student.school)} /><Detail label="Semester" value={display(semesterLabel || (student.semester ? `Semester ${student.semester}` : null))} /><Detail label="Proctor" value={student.proctorAvailable ? display(student.proctorName) : 'Not available'} /></dl>
        <div className="portal-panel-footer"><span>{od?.available ? `OD balance: ${display(od.totalOdHours)} hours` : 'OD information not available'}</span><button className="portal-row-link" onClick={() => onNavigateTab('my-info')}>View profile <ArrowRight size={13} /></button></div>
      </section>

      <section className="portal-panel portal-span-8">
        <PanelHeader icon={<Send size={18} />} title="Assignments & deadlines" sub="Pending academic work from synced sources" action={<span className="portal-count">{assignments.length ? `${pending.length} pending` : 'Not synced'}</span>} />
        {pending.length ? <div className="portal-deadline-list">{pending.slice(0, 5).map(task => <div className="portal-deadline-row" key={task.id}><div className="portal-course-code">{display(task.courseCode)}</div><div><strong>{display(task.title)}</strong><span>{display(task.description || task.courseTitle)}</span></div><time>{display(task.dueDate)}{task.dueTime ? ` · ${task.dueTime}` : ''}</time><button className="portal-row-link" onClick={() => onNavigateTab('lms')}>Open <ExternalLink size={13} /></button></div>)}</div> : <Empty text={assignments.length ? 'There are no pending assignments.' : 'Assignment data is not available from the current sync.'} action="Open LMS" onClick={() => onNavigateTab('lms')} />}
      </section>

      <section className="portal-panel portal-span-4">
        <PanelHeader icon={<ClipboardList size={18} />} title="Upcoming examinations" sub="Next scheduled examination" />
        {nextExam ? <div className="portal-exam-card"><span className="portal-eyebrow">{display(nextExam.courseCode)}</span><strong>{display(nextExam.courseTitle)}</strong><dl><Detail label="Date" value={display(nextExam.date)} /><Detail label="Venue" value={display(nextExam.venue)} /></dl><button className="portal-primary-button" onClick={() => onNavigateTab('exams')}>View examination schedule <ArrowRight size={14} /></button></div>
          : undatedExamsPending ? <Empty text="VTOP has not published dates for your upcoming exams yet (e.g. CAT 2)." action="Open examinations" onClick={() => onNavigateTab('exams')} />
          : <Empty text="Examination data is not available from the current sync." action="Open examinations" onClick={() => onNavigateTab('exams')} />}
      </section>

      <section className="portal-panel portal-span-8">
        <PanelHeader icon={<BookOpen size={18} />} title="Current courses" sub={courseCards.length ? `${courseCards.length} courses in synced academic data` : 'Course data not available'} action={<button className="portal-row-link" onClick={() => onNavigateTab('grades')}>Academic records <ArrowRight size={13} /></button>} />
        {courseCards.length ? <div className="portal-course-grid">{courseCards.slice(0, 8).map(course => {
          const group = course.group;
          const components = group?.components ?? [];
          // A course with both halves shows both figures; a single-component
          // course keeps the simple attended/held line.
          const attendanceLine = !group
            ? 'Attendance not available'
            : components.length > 1
              ? `${group.attended}/${group.conducted} classes attended`
              : `${group.attended}/${group.conducted} attended`;
          const academicLabel = getCourseAcademicLabel(course.mark, course.mark ? null : group?.percentage);
          // Marks and attendance are two different fractions of a course. Each
          // gets its own labelled meter; the marks one only appears for rows
          // VTOP has actually graded.
          const marksRatio = getInternalMarksRatio(course.mark);
          return <div className="portal-course-card" key={course.base}>
            <header><span className="portal-course-code">{course.base}</span><b>{academicLabel}</b></header>
            <strong>{display(group?.courseTitle || course.mark?.courseTitle)}</strong>
            <span>{display(group?.rows.find(r => r.facultyName)?.facultyName)} · {attendanceLine}</span>
            {components.length > 1 && <div className="portal-course-split">{components.map(c => <span key={c.kind}>{componentLabel(c.kind)} <b>{c.percentage === null ? '—' : `${c.percentage}%`}</b> {c.attended}/{c.conducted}</span>)}</div>}
            {marksRatio && <div className="portal-course-meter marks"><span>Marks</span><div className="portal-progress" role="img" aria-label={`${course.base} internal marks ${marksRatio.scored} of ${marksRatio.max} held (${Math.round(marksRatio.percent)}%)`}><i style={{ width: `${marksRatio.percent}%` }} /></div><b>{Math.round(marksRatio.percent)}%</b></div>}
            {group && group.percentage !== null && <div className="portal-course-meter"><span>Attendance</span><div className="portal-progress" role="img" aria-label={`${course.base} overall attendance ${group.percentage}%`}><i style={{ width: `${Math.min(100, group.percentage)}%` }} /></div><b>{Math.round(group.percentage)}%</b></div>}
          </div>;
        })}</div> : <Empty text="Sync VTOP to load current courses." action="Open profile" onClick={() => onNavigateTab('my-info')} />}
      </section>

      <aside className="portal-side-stack portal-span-4">
        <section className="portal-panel"><PanelHeader icon={<ShieldCheck size={18} />} title="Proctor & faculty" action="Profile data" /><div className="portal-person"><div className="portal-person-avatar">{initials(student.proctorName)}</div><div><strong>{student.proctorAvailable ? display(student.proctorName) : 'Proctor not available'}</strong><span>{student.proctorAvailable ? display(student.proctorContact) : 'No proctor record in synced data'}</span></div></div><div className="portal-note"><CheckCircle2 size={15} /> {student.proctorAvailable ? 'Details shown as provided by VTOP.' : 'Sync VTOP to check for proctor information.'}</div><button className="portal-secondary-button" onClick={() => onNavigateTab('faculty')}>Open faculty directory <ArrowRight size={14} /></button></section>
        <section className="portal-panel"><PanelHeader icon={<Send size={18} />} title="University notices" action={circulars.length ? `${circulars.length} synced` : 'Not available'} />{circulars.length ? circulars.slice(0, 3).map(c => <div className="portal-notice" key={c.id}><span>{display(c.category)}</span><strong>{display(c.title)}</strong><small>{display(c.date)}</small></div>) : <Empty text="No notices are available in the current sync." action="View profile" onClick={() => onNavigateTab('my-info')} />}</section>
      </aside>
    </div>
  </div>;
};

const SummaryCard = ({ label, value, suffix, note, onClick, progress, tone = 'normal', privacyMode = false, privacyHidden = false, onTogglePrivacy }: { label: string; value: string; suffix?: string; note: string; onClick: () => void; progress?: number | null; tone?: 'normal' | 'warning'; privacyMode?: boolean; privacyHidden?: boolean; onTogglePrivacy?: () => void }) => <button className={`portal-summary-card ${tone} ${privacyMode ? 'privacy-card' : ''}`} onClick={privacyMode && onTogglePrivacy ? onTogglePrivacy : onClick} title={privacyMode ? (privacyHidden ? 'Show CGPA' : 'Hide CGPA') : undefined}><span>{label}</span><strong>{value} <small>{suffix}</small></strong><p>{note}</p>{progress !== undefined && progress !== null && <div className="portal-progress"><i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>}{privacyMode && onTogglePrivacy && <span className="portal-privacy-icon" aria-label={privacyHidden ? 'Show CGPA' : 'Hide CGPA'}>{privacyHidden ? <Eye size={14} /> : <EyeOff size={14} />}</span>}{!privacyMode && <ArrowRight className="portal-card-arrow" size={14} />}</button>;
const PanelHeader = ({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) => <header className="portal-panel-header"><span className="portal-panel-icon">{icon}</span><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{action && <div className="portal-panel-action">{action}</div>}</header>;
const Detail = ({ label, value }: { label: string; value: string }) => <div><dt>{label}</dt><dd>{value}</dd></div>;
const Empty = ({ text, action, onClick }: { text: string; action?: string; onClick?: () => void }) => <div className="portal-empty"><span>{text}</span>{action && onClick && <button className="portal-row-link" onClick={onClick}>{action} <ArrowRight size={13} /></button>}</div>;

export const MeridianDashboard = UltraCCDashboard;
