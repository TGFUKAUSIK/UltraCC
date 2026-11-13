import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarCheck, CalendarClock, ClipboardList, DoorOpen, Inbox, MapPinned, Send, Users } from 'lucide-react';
import { StudentProfile, AttendanceRecord, TimetableSlot, ExamSchedule, AssignmentTask, CourseMarks } from '../types';
import { CircularRecord, OdSummary, SemesterInfo } from '../lib/vtop/types';
import type { LmsQuizWindow } from '../lib/lms/types';
import { calculateAcademicHealth } from '../utils/academicHealth';
import { ALL_WEEK_DAYS, formatClassTime, getOngoingTimetableSlot, getNextTimetableSlot, getTimetableDaySlots, isTimetableSlotOngoing, minutesOfDay, timetableTimeToMinutes } from '../utils/timetableGrid';
import { getCourseAcademicLabel, getInternalMarksRatio } from '../utils/internalMarks';
import { componentLabel, componentTotals, baseCourseCode, findCourseGroup, groupCourseAttendance } from '../utils/attendanceComponents';
import { attendancePercentLabel, attendanceTone } from '../utils/attendanceBands';
import { calendarDaysUntil, upcomingExams, vtopDateDayStartMs } from '../utils/examUtils';
import { publishedGpaLabel } from '../utils/gradeModel';
import { calculateBunkStats } from '../utils/nextActionEngine';
import { useTargetAttendance } from '../lib/attendanceTarget';
import { quizStatus } from '../lib/lms/quizWindow';
import { courseTone } from '../utils/courseTone';
import { ProfilePhoto } from './ProfilePhoto';
import { ProctorPerson } from './ProctorPerson';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import { isReal, placeOf } from '../utils/placeholders';
import { schoolLabel } from '../utils/vitSchools';
import { isNavHiddenInMode, type FeatureMode } from '../lib/navVisibility';

/**
 * Home, as a departures board.
 *
 * The order is the order of the questions a student asks walking between two
 * classes: what am I in or nearly late for (hero), where do I stand and how many
 * classes can I still miss (readouts), what closes soon (strip), when is the next
 * paper (exam plate), what does the rest of the day look like (rail). Everything
 * else is below the fold and one tap away, which is why there is exactly one
 * link out of each plate instead of a "view" control on every row.
 *
 * Nothing here computes attendance, marks or exam dates: those answers live in
 * the shared utils and this screen only lays them out.
 */

interface Props {
  student: StudentProfile; attendance: AttendanceRecord[]; timetable: TimetableSlot[]; exams: ExamSchedule[]; assignments: AssignmentTask[];
  marks?: CourseMarks[]; circulars?: CircularRecord[]; quizzes?: LmsQuizWindow[]; od: OdSummary | null;
  semesterLabel?: string; semesters?: SemesterInfo[]; selectedSemesterId?: string; onSemesterChange?: (id: string) => void; profilePhotoUrl?: string;
  /** Go to a tab, and optionally to one screen inside it (Academics' OD chip). */
  onNavigateTab: (tab: string, subtab?: string) => void;
  /**
   * Which destinations the navigation currently offers. The board is the same
   * board in both modes — same numbers, same order — but a door the mode does
   * not have is not drawn: minimal mode keeps the figures and drops the plates
   * and shortcuts whose only purpose is opening a screen it does not offer. That
   * is the same rule the rail, the bar and ⌘K apply, so a tap can never land on
   * a screen the mode has just removed (App bounces such a tab straight back,
   * which from the student's side is a tap that does nothing).
   */
  mode?: FeatureMode;
}
/**
 * Everything the board prints goes through the shared placeholder test: a field
 * VTOP left blank, stubbed ("R -", "Seat -") or filled with the word "None"
 * reads as "Not available" rather than as a fact.
 */
const display = (value: unknown) => (isReal(value) ? String(value).trim() : 'Not available');
/** Degree progress, not attendance — attendance figures go through the shared label. */
const creditsPercent = (n: number) => `${attendancePercentLabel(Math.max(0, Math.min(100, n)))}%`;
/** "1 session", "2 sessions" — a single course never gets described as plural. */
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const dayLabel = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long' }) as TimetableSlot['day'];
const nextCalendarDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
/** "14:00" -> "2:00 PM" (keeps the raw value when it is not a clock time). */
const clockLabel = (value: string) => formatClassTime(value, '—');
/** The greeting names the part of the day, because the student is in one. */
const greetingFor = (now: Date) => (now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening');
/** Minutes as "12 min" / "1 hr 40 min", for a bell that is close enough to count. */
const minutesAway = (minutes: number) => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;

/** The attendance figure as a 26px ring: a shape, not a chart. */
const AttendanceRing = ({ percent, tone }: { percent: number; tone: 'safe' | 'warning' | 'critical' }) => {
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const state = tone === 'safe' ? 'is-ok' : tone === 'warning' ? 'is-watch' : 'is-risk';
  return (
    <svg className={`uc-ring ${state}`} viewBox="0 0 26 26" aria-hidden="true">
      <circle className="uc-ring-track" cx="13" cy="13" r={radius} />
      <circle className="uc-ring-arc" cx="13" cy="13" r={radius} strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference - (clamped / 100) * circumference} />
    </svg>
  );
};

export const UltraCCDashboard: React.FC<Props> = ({ student, attendance, timetable, exams, assignments, marks = [], circulars = [], quizzes = [], od, semesterLabel, profilePhotoUrl, onNavigateTab, mode = 'complete' as FeatureMode }) => {
  const [scheduleView, setScheduleView] = useState<'today' | 'tomorrow' | 'week'>('today');
  const [cgpaHidden, setCgpaHidden] = useCgpaPrivacy();
  const [targetAttendance] = useTargetAttendance();
  // One live clock for the whole board, so a bell that arrives while the screen
  // is open moves the hero and the rail without a refresh.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(tick);
  }, []);

  const todayName = dayLabel(now);
  const tomorrowName = dayLabel(nextCalendarDay(now));
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
  const componentNote = attendanceTotals.present.length > 1
    ? attendanceTotals.present.map(c => `${componentLabel(c.kind)} ${c.percentage === null ? 'not started' : `${attendancePercentLabel(c.percentage)}%`}`).join(' · ')
    : `${plural(attendance.length, 'course')} synced`;
  // The band, the ring and the bunk count all read the student's own bar rather
  // than a threshold baked in here (attendanceTone / calculateBunkStats).
  const attendanceBand = attendanceTone(avgAttendance, targetAttendance);
  const bunk = useMemo(
    () => calculateBunkStats({
      courseCode: 'All courses', courseTitle: '', type: 'TH', slot: '', facultyName: '',
      attended: attendedClasses, totalHeld: heldClasses, percentage: avgAttendance ?? 0, lastUpdated: '', venue: '',
    }, targetAttendance, { periods: true }),
    [attendedClasses, heldClasses, avgAttendance, targetAttendance],
  );
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

  // One answer to "what is my next exam", from the IST-safe helper, recomputed
  // on the same 30s tick the rail uses.
  const upcoming = useMemo(() => upcomingExams(exams, now.getTime()), [exams, now]);
  const upcomingExam = upcoming[0] ?? null;
  // VTOP lists future exams (e.g. CAT 2) before publishing their dates; an
  // undated row surfaced as "next" reads as a bug.
  const undatedExamsPending = !upcomingExam && exams.some((exam) => !exam.date);
  const examsAllFinished = !upcomingExam && !undatedExamsPending && exams.some((exam) => exam.date);
  const creditsProgress = student.totalCreditsRequired && student.totalCreditsCompleted !== null ? (student.totalCreditsCompleted / student.totalCreditsRequired) * 100 : null;

  // Nearest deadline first: VTOP returns assignments grouped by course, so a
  // submission already past its date can sit behind next month's quiz.
  const pending = useMemo(
    () => assignments
      .filter(a => a.status === 'Pending')
      .sort((a, b) => (vtopDateDayStartMs(a.dueDate) ?? Number.MAX_SAFE_INTEGER) - (vtopDateDayStartMs(b.dueDate) ?? Number.MAX_SAFE_INTEGER)),
    [assignments],
  );
  const lateCount = pending.reduce((total, task) => total + ((calendarDaysUntil(task.dueDate, now.getTime()) ?? 1) < 0 ? 1 : 0), 0);

  // One feed for "what is about to close": quiz windows and assignment due
  // dates, sorted by the instant each one next matters. Quizzes come first when
  // they are open, because a window that closes is the one thing here that
  // cannot be recovered.
  const dueItems = useMemo(() => {
    const items: Array<{ id: string; when: string; title: string; meta: string; at: number; tone: string; onClick: () => void }> = [];
    for (const quiz of quizzes) {
      const state = quizStatus(quiz, now.getTime());
      if (state.status === 'closed' || state.at === null) continue;
      items.push({
        id: `quiz-${quiz.quizId}`,
        when: state.status === 'open-now' ? 'Open now' : 'Opens',
        title: quiz.name || 'Quiz window',
        meta: `Quiz · ${state.label}`,
        at: state.at,
        tone: state.status === 'open-now' ? 'is-live' : '',
        onClick: () => onNavigateTab('lms'),
      });
    }
    for (const task of pending) {
      const days = calendarDaysUntil(task.dueDate, now.getTime());
      const late = days !== null && days < 0;
      items.push({
        id: `task-${task.id}`,
        when: late ? 'Late' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : display(task.dueDate),
        title: display(task.title),
        meta: [display(task.courseCode), task.dueTime].filter(Boolean).join(' · '),
        at: vtopDateDayStartMs(task.dueDate) ?? Number.MAX_SAFE_INTEGER,
        tone: late ? 'is-late' : days === 0 ? 'is-urgent' : '',
        onClick: () => onNavigateTab('lms'),
      });
    }
    return items.sort((a, b) => a.at - b.at);
  }, [quizzes, pending, now, onNavigateTab]);

  // The hero. What is happening now wins, then the next bell, then tomorrow —
  // and only ever one of the three is on the screen.
  const ongoingSlot = useMemo(() => getOngoingTimetableSlot(timetable, now), [timetable, now]);
  const nextSlot = useMemo(() => getNextTimetableSlot(timetable, now), [timetable, now]);
  // The next bell that is not today, looking at the six days after this one. The
  // seventh would be this same weekday again, and a class a whole week out is not
  // "next" — it is exactly what "no classes left today" means. Naming the day
  // lets the hero stop announcing there is nothing left over a class it holds up.
  const nextDayFirst = useMemo(() => {
    for (let offset = 1; offset <= 6; offset += 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const slot = getTimetableDaySlots(timetable, dayLabel(date))[0];
      if (slot) return { slot, day: dayLabel(date), date, offset };
    }
    return null;
  }, [timetable, now]);
  const hero = useMemo(() => {
    const current = minutesOfDay(now);
    if (ongoingSlot) {
      const end = timetableTimeToMinutes(ongoingSlot.endTime);
      const start = timetableTimeToMinutes(ongoingSlot.startTime);
      const left = end === null ? null : Math.max(0, end - current);
      const total = start !== null && end !== null ? Math.max(1, end - start) : null;
      return {
        state: 'is-live' as const, lamp: 'In class now',
        when: '',
        tel: ongoingSlot.endTime ? clockLabel(ongoingSlot.endTime) : '—',
        note: left === null || total === null ? 'ends when the bell rings' : `${minutesAway(left)} left`,
        span: `${clockLabel(ongoingSlot.startTime)} – ${clockLabel(ongoingSlot.endTime)}`,
        progress: left === null || total === null ? null : Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100))),
        slot: ongoingSlot,
      };
    }
    if (nextSlot) {
      const start = timetableTimeToMinutes(nextSlot.startTime);
      const away = start === null ? null : start - current;
      return {
        state: 'is-next' as const, lamp: away !== null && away <= 10 ? 'Starting now' : 'Up next',
        when: '',
        tel: clockLabel(nextSlot.startTime),
        note: away === null ? 'later today' : away <= 0 ? 'now' : `in ${minutesAway(away)}`,
        span: `${clockLabel(nextSlot.startTime)} – ${clockLabel(nextSlot.endTime)}`,
        progress: null, slot: nextSlot,
      };
    }
    if (nextDayFirst) {
      // The label names the day the card is showing, and the big day line below
      // repeats it at the time's own size: a 9px chip is too quiet to carry the
      // one fact the hero turns to report once today has run out.
      return {
        state: 'is-idle' as const,
        lamp: 'Next class',
        when: nextDayFirst.offset === 1 ? 'Tomorrow' : nextDayFirst.day,
        tel: clockLabel(nextDayFirst.slot.startTime),
        note: nextDayFirst.date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
        span: `${clockLabel(nextDayFirst.slot.startTime)} – ${clockLabel(nextDayFirst.slot.endTime)}`,
        progress: null, slot: nextDayFirst.slot,
      };
    }
    return {
      state: 'is-idle' as const,
      when: '',
      // Reached only when the timetable is empty, or the sole classes are
      // today's — the six-day walk above covers every other weekday.
      lamp: timetable.length ? 'No classes left today' : 'No timetable synced',
      tel: '', note: '', span: '', progress: null, slot: null,
    };
  }, [ongoingSlot, nextSlot, nextDayFirst, now, timetable]);

  // The board's own "and then?": the bells that follow the hero on its day, so
  // the answer to "what is next" sits on the same object rather than a scroll
  // below it. Tomorrow's list is used when today has run out.
  const following = useMemo(() => {
    const slot = hero.slot;
    if (!slot) return [];
    const rest = getTimetableDaySlots(timetable, slot.day).filter(
      (row) => !(row.id === slot.id && row.startTime === slot.startTime && row.endTime === slot.endTime),
    );
    if (hero.state === 'is-idle') return rest.slice(0, 2);
    return rest
      .filter((row) => {
        const end = timetableTimeToMinutes(row.endTime);
        return end !== null && end > minutesOfDay(now);
      })
      .slice(0, 2);
  }, [timetable, hero.slot, hero.state, now]);

  const firstName = display(student.name) === 'Not available' ? '' : display(student.name).split(' ')[0];
  // Identity line under the name. VTOP's profile page has no branch row for
  // Chennai students, so the School is named there. Not `groupStudied`: that is
  // the Class-XII group and read as a wrong course label.
  const branchLine = student.branch || schoolLabel(student.school) || '';
  // Only the parts that are actually known: an unknown term must not push a
  // literal "Not available" onto the identity line.
  const termLine = [display(branchLine), semesterLabel || (student.semester ? `Semester ${student.semester}` : '')]
    .filter((part) => part && part !== 'Not available')
    .join(' · ');
  const showLiveStates = scheduleView === 'today';
  // The hero's location and teacher, read through the strict helper: a stub
  // venue ("R -") or an unallotted seat is dropped rather than printed as if it
  // were a place a student could walk to.
  const heroRoom = hero.slot ? placeOf(hero.slot.venue, hero.slot.roomNo) : '';
  const heroFaculty = hero.slot && isReal(hero.slot.facultyName) ? hero.slot.facultyName : '';

  // The two priority tiles: the work that can still be done, and the next paper.
  // When only one of them has anything to say it takes the whole row instead of
  // leaving an equal-width hole beside it.
  const dueHasData = dueItems.length > 0;
  const examHasData = Boolean(upcomingExam);
  /**
   * Can the student open this destination under the current mode? Both plates
   * answer through the same function the rest of the navigation uses, so the
   * board can never point at a screen the mode has dropped.
   */
  const can = (tab: string) => !isNavHiddenInMode(tab, mode);
  const showDue = can('lms');
  const showExam = can('exams');
  /**
   * The shortcut rail is the tab bar's overflow, built from the services this
   * mode still has. A mode whose bar already holds every destination it offers
   * has nothing to overflow — and a rail of one is a button, which is already in
   * the bar — so the row is drawn only when two or more survive.
   */
  const shortcutRail: Array<{ tab: string; subtab?: string; label: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }> = [
    { tab: 'exams', label: 'Exams', Icon: ClipboardList },
    { tab: 'lms', label: 'Assignments', Icon: Send },
    { tab: 'academics', subtab: 'od', label: 'OD hours', Icon: CalendarCheck },
    { tab: 'freeClassrooms', label: 'Free rooms', Icon: DoorOpen },
    { tab: 'campus', label: 'Campus map', Icon: MapPinned },
  ];
  const shortcuts = shortcutRail.filter((item) => can(item.tab));
  // The attendance state, spelled out. The ring and this lamp carry the
  // red/amber/green verdict; no surface is ever filled with it.
  const attendState = avgAttendance === null
    ? { cls: '', label: 'Attendance' }
    : attendanceBand === 'safe' ? { cls: 'uc-lamp--live', label: 'On track' }
      : attendanceBand === 'critical' ? { cls: 'uc-lamp--alert', label: 'Below your bar' }
        : { cls: 'uc-lamp--warn', label: 'Cutting it close' };
  const bandState = attendanceBand === 'unknown' ? '' : attendanceBand;

  return <div className="uc-home">
    {/* Identity, not a headline: who the board belongs to, and the term it
        applies to. The student knows their own name. */}
    <div className="uc-home-id">
      <ProfilePhoto name={student.name} src={profilePhotoUrl} size="md" />
      <div className="uc-home-id-main">
        <h1 className="uc-home-greeting">{firstName ? `${greetingFor(now)}, ${firstName}` : greetingFor(now)}</h1>
        <span>{termLine}</span>
      </div>
      <span className="uc-home-id-date">{now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
    </div>

    {/* The focal point: where the student has to be, right now. Time, course,
        room, and the two bells after it — one loud object, and nothing else on
        the page is allowed near its weight. */}
    <section className={`uc-plate uc-plate--hero uc-now ${hero.state}`} aria-label="Your next class">
      <div className="uc-lamp-row">
        <span className={`uc-lamp ${hero.state === 'is-live' ? 'uc-lamp--live' : hero.state === 'is-next' ? 'uc-lamp--warn' : ''}`}>{hero.lamp}</span>
        <span className="uc-num uc-now-at">{hero.span}</span>
      </div>
      {/* The day, when today has run out — set as the headline, because it is the
          one fact the hero turned to report once nothing is left. */}
      {hero.when && <div className="uc-now-day">{hero.when}</div>}
      {hero.slot ? (
        <>
          {/* One dominant element: the course name, in the display face. Time,
              room and slot are read off it rather than competing with it. */}
          <h2 className="uc-hero uc-now-course">{display(hero.slot.courseTitle || hero.slot.courseCode)}</h2>
          <div className="uc-now-facts">
            <span className="uc-now-time">{hero.tel}<small>{hero.note}</small></span>
            {heroRoom ? <span className="uc-now-room">{heroRoom}</span> : null}
            <span className="uc-now-kind">
              <b className="uc-num">{display(hero.slot.courseCode)}</b>
              {hero.slot.slot ? ` · Slot ${hero.slot.slot}` : ''} · {hero.slot.isLab ? 'Lab' : 'Theory'}
            </span>
          </div>
          {heroFaculty ? <p className="uc-now-teacher">{heroFaculty}</p> : null}
        </>
      ) : <p className="uc-note uc-now-blank">Sign in and sync to load your timetable, or open it to add classes.</p>}
      {hero.progress !== null && <div className="uc-meter" role="img" aria-label={`${hero.progress}% of this class has passed`}><i style={{ width: `${hero.progress}%` }} /></div>}
      {following.length > 0 && (
        <div className="uc-now-then">
          <span className="uc-now-then-cap">Then</span>
          {following.map((slot) => (
            <span className="uc-now-next" key={`${slot.id}-${slot.day}`}>
              <b>{clockLabel(slot.startTime)}</b> {display(slot.courseCode)}
            </span>
          ))}
        </div>
      )}
      {can('timetable') && (
        <div className="uc-now-foot">
          <button className="uc-link" onClick={() => onNavigateTab('timetable')}>Full timetable <ArrowRight size={13} /></button>
        </div>
      )}
    </section>

    {/* Standing, in two tiles: the answer that matters most — how many classes can
        still be missed — and the three figures that ride beside it. It sits right
        under the hero, because "can I skip tomorrow" is the next thing a student
        asks after "where am I now". The verdict is the ring and the lamp; no
        surface is ever filled with a red/amber/green. */}
    <div className="uc-stand-grid" role="group" aria-label="Your standing">
      <button className={`uc-attend ${bandState ? `is-${bandState}` : 'is-quiet'}`} onClick={() => onNavigateTab('academics')}>
        <span className="uc-attend-head">
          <span className="uc-attend-label">Attendance &amp; bunks</span>
          <span className={`uc-lamp ${attendState.cls}`}>{attendState.label}</span>
        </span>
        <span className="uc-attend-band">
          <span className="uc-attend-figure">
            {avgAttendance === null
              ? <span className="uc-attend-dash">—</span>
              : <><AttendanceRing percent={avgAttendance} tone={attendanceBand === 'unknown' ? 'warning' : attendanceBand} /><b>{attendancePercentLabel(avgAttendance)}%</b></>}
          </span>
          <span className="uc-attend-text">
            <strong>{avgAttendance === null ? 'No attendance synced yet' : bunk.canBunk > 0 ? `Can skip ${bunk.canBunk} more ${bunk.unit}${bunk.canBunk === 1 ? '' : 's'}` : 'Nothing left to spare'}</strong>
            <i>{avgAttendance === null ? 'Sync to load your attendance' : attendanceBand === 'safe' ? componentNote : `${componentNote} · under your ${targetAttendance}% bar`}</i>
          </span>
        </span>
      </button>
      <section className="uc-plate uc-metrics" aria-label="Academic standing">
        <button className={`uc-metric ${cgpaHidden ? 'is-quiet' : ''}`} onClick={() => setCgpaHidden(!cgpaHidden)} aria-pressed={!cgpaHidden} aria-label={cgpaHidden ? 'Show CGPA' : 'Hide CGPA'}>
          <span>CGPA</span>
          <b>{cgpaHidden ? '••••' : publishedGpaLabel(student.cgpa)}{!cgpaHidden && publishedGpaLabel(student.cgpa) !== 'Not available' && <small>/ 10</small>}</b>
          <i>{cgpaHidden ? 'Tap to show' : 'Tap to hide'}</i>
        </button>
        <button className={`uc-metric ${creditsProgress === null ? 'is-quiet' : ''}`} onClick={() => onNavigateTab('grades')}>
          <span>Credits</span>
          <b>{display(student.totalCreditsCompleted)}{student.totalCreditsRequired ? <small>/ {student.totalCreditsRequired}</small> : null}</b>
          <i>{creditsProgress === null ? 'Degree progress not available' : `${creditsPercent(creditsProgress)} of required credits`}</i>
        </button>
        <button className={`uc-metric ${health.score === null ? 'is-quiet' : ''}`} onClick={() => onNavigateTab('academics')}>
          <span>Standing</span>
          <b>{health.score === null ? '—' : health.score}<small>/ 100</small></b>
          <i>{health.score === null ? 'Not enough records yet' : 'From your synced records'}</i>
        </button>
      </section>
    </div>

    {/* Priorities: the two things on this page that cannot be recovered — a
        deadline and a paper. Side by side once there is room; on a phone each
        keeps its own head, so an empty one collapses to a caption and a line.
        Each plate is a door as much as a readout, and a mode without that door
        drops the plate with it. */}
    {(showDue || showExam) && <div className={`uc-brief ${showDue === showExam ? '' : 'is-solo'}`}>
      {/* What is about to close. The one thing on this screen that cannot be recovered. */}
      {showDue && <section className="uc-plate" aria-label="Due next">
        <div className="uc-plate-head">
          <span className="uc-plate-title">Due next</span>
          <button className="uc-link" onClick={() => onNavigateTab('lms')}>Assignments &amp; courses <ArrowRight size={13} /></button>
        </div>
        {dueItems.length ? (
          <div className="uc-strip">
            {dueItems.slice(0, 5).map(item => (
              <button className={`uc-strip-item ${item.tone}`} key={item.id} onClick={item.onClick}>
                <span className="uc-strip-when">{item.when}</span>
                <strong>{item.title}</strong>
                <small>{item.meta}</small>
              </button>
            ))}
          </div>
        ) : <div className="uc-empty">
          <span className="uc-empty-lead">
            <Inbox size={18} aria-hidden="true" />
            <span>{
              assignments.length || quizzes.length
                ? 'Nothing is pending or about to open. Next deadlines appear here as soon as VTOP or Moodle lists them.'
                : 'No assignments or quiz windows are synced yet.'
            }</span>
          </span>
          <button className="uc-link" onClick={() => onNavigateTab('lms')}>Open assignments <ArrowRight size={13} /></button>
        </div>}
        {dueItems.length > 0 && (
          <div className="uc-plate-foot">
            <span className="uc-num">{dueItems.length} pending{lateCount ? ` · ${lateCount} late` : ''}</span>
            {dueItems.length > 5 && <span>Showing the 5 most urgent</span>}
          </div>
        )}
      </section>}

      {/* The next paper, with its room and seat, because those are the two things
          a student is asked for at the door. */}
      {showExam && (upcomingExam ? (
        <section className="uc-plate" aria-label="Next examination">
          <div className="uc-plate-head">
            <span className="uc-lamp uc-lamp--warn">Next exam</span>
            <button className="uc-link" onClick={() => onNavigateTab('exams')}>Seating &amp; schedule <ArrowRight size={13} /></button>
          </div>
          <div className="uc-exam">
            <div className="uc-exam-when">
              <b>{upcomingExam.countdown === 'Today' ? 'Today' : `In ${upcomingExam.countdown}`}</b>
              <span>{display(upcomingExam.exam.examType)} · {display(upcomingExam.exam.courseCode || `Slot ${upcomingExam.exam.slot}`)}</span>
            </div>
            <p className="uc-note">
              {[
                display(upcomingExam.exam.courseTitle),
                isReal(upcomingExam.exam.date) ? upcomingExam.exam.date : null,
                upcomingExam.timePending ? 'Time not released' : (isReal(upcomingExam.exam.time) ? upcomingExam.exam.time : null),
                isReal(upcomingExam.exam.venue) ? upcomingExam.exam.venue : null,
              ].filter((part) => part && part !== 'Not available').join(' · ')}
            </p>
            {/* The seat is the other thing asked for at the door, so an unallotted
                one is stated plainly instead of printed as "Seat -". */}
            <span className={`uc-seat${isReal(upcomingExam.exam.seatNo) ? '' : ' is-quiet'}`}>
              {isReal(upcomingExam.exam.seatNo) ? `Seat ${upcomingExam.exam.seatNo}` : 'Seat not allotted yet'}
            </span>
          </div>
          {upcoming.length > 1 && (
            <div className="uc-rows">
              {upcoming.slice(1, 3).map((item) => (
                <button className="uc-row" key={`${item.exam.id}-${item.startsAtMs}`} onClick={() => onNavigateTab('exams')}>
                  <div>
                    <strong>{display(item.exam.courseCode || `Slot ${item.exam.slot}`)}{item.exam.courseTitle ? ` · ${display(item.exam.courseTitle)}` : ''}</strong>
                    <small>{display(item.exam.examType)} · {[item.exam.date, item.timePending ? 'Time not released' : item.exam.time].filter(Boolean).join(' · ')}</small>
                  </div>
                  <time>{item.countdown === 'Today' ? 'Today' : `In ${item.countdown}`}</time>
                </button>
              ))}
            </div>
          )}
          {upcoming.length > 1 && (
            <div className="uc-plate-foot">
              <span>{upcoming.length > 3 ? `Showing the next 3 of ${upcoming.length} published dates` : `${upcoming.length} published dates ahead`}</span>
            </div>
          )}
        </section>
      ) : (
        <section className="uc-plate" aria-label="Next examination">
          <div className="uc-plate-head">
            <span className="uc-plate-title">Next exam</span>
            <button className="uc-link" onClick={() => onNavigateTab('exams')}>Seating &amp; schedule <ArrowRight size={13} /></button>
          </div>
          <div className="uc-empty">
            <span className="uc-empty-lead">
              <CalendarClock size={18} aria-hidden="true" />
              <span>{
                undatedExamsPending ? 'VTOP has not published dates for your upcoming exams yet.'
                  : examsAllFinished ? 'Every examination with a published date has already taken place.'
                    : 'No examination dates have been published yet.'
              }</span>
            </span>
            <button className="uc-link" onClick={() => onNavigateTab('exams')}>Open exams <ArrowRight size={13} /></button>
          </div>
        </section>
      ))}
    </div>}

    {/* The day itself, one row per bell, full width — the ledger the hero is
        read from. */}
    <section className="uc-plate" aria-label="Timetable">
      <div className="uc-plate-head">
        <span className="uc-plate-title">{scheduleView === 'week' ? 'This week' : scheduleView === 'today' ? `Today · ${plural(scheduleSlots.length, 'session')}` : `Tomorrow · ${plural(scheduleSlots.length, 'session')}`}</span>
        <div className="uc-tabs">
          {(['today', 'tomorrow', 'week'] as const).map(value => (
            <button key={value} aria-pressed={scheduleView === value} onClick={() => setScheduleView(value)}>{value === 'today' ? 'Today' : value === 'tomorrow' ? 'Tomorrow' : 'Week'}</button>
          ))}
        </div>
      </div>
      {scheduleSlots.length ? (
        <div className="uc-rail">
          {scheduleSlots.slice(0, 8).map((slot) => {
            const ongoing = showLiveStates && isTimetableSlotOngoing(slot, now);
            const end = timetableTimeToMinutes(slot.endTime);
            const past = showLiveStates && !ongoing && end !== null && minutesOfDay(now) >= end;
            // A stub venue ("R -") or a trailing dash is dropped, and the room is
            // not reprinted when the venue already carries it.
            const meta = [placeOf(slot.venue, slot.roomNo), isReal(slot.facultyName) ? slot.facultyName : '', slot.isLab ? 'Lab' : 'Theory', slot.slot]
              .filter(Boolean).join(' · ');
            return (
              <div className={`uc-rail-row ${ongoing ? 'is-now' : past ? 'is-past' : ''}`} key={`${slot.id}-${slot.day}`}>
                <span className="uc-rail-time">{clockLabel(slot.startTime)}<small>{clockLabel(slot.endTime)}</small></span>
                <span className="uc-rail-spine" aria-hidden="true" />
                <div className="uc-rail-main">
                  <strong>{display(slot.courseCode)}: {display(slot.courseTitle)}</strong>
                  <span>{meta}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="uc-empty"><span>No classes found for {scheduleView === 'week' ? 'the synced week' : scheduleView}.</span>{can('timetable') && <button className="uc-link" onClick={() => onNavigateTab('timetable')}>Open timetable <ArrowRight size={13} /></button>}</div>}
      <div className="uc-plate-foot">
        <span>{scheduleSlots.length > 8 ? `Showing the first 8 of ${scheduleSlots.length} sessions` : scheduleView === 'week' ? `${plural(timetable.length, 'session')} in the synced timetable` : `${plural(scheduleSlots.length, 'session')}`}</span>
        {can('timetable') && <button className="uc-link" onClick={() => onNavigateTab('timetable')}>Full timetable <ArrowRight size={13} /></button>}
      </div>
    </section>

    {/* The utility rail: the destinations the tab bar cannot hold, as one
        hairline grid rather than a row of loose pills. */}
    {shortcuts.length > 1 && <div className="uc-services" role="group" aria-label="Shortcuts">
      {shortcuts.map(({ tab, subtab, label, Icon }) => (
        <button className="uc-service" key={tab} onClick={() => onNavigateTab(tab, subtab)}><Icon size={15} aria-hidden="true" />{label}</button>
      ))}
    </div>}

    <div className="uc-home-lower">
      <div className="uc-home-col">
        {/* One card per course, colour-keyed to the timetable. */}
        <section className="uc-plate" aria-label="Current courses">
          <div className="uc-plate-head">
            <span className="uc-plate-title">Courses</span>
            <button className="uc-link" onClick={() => onNavigateTab('grades')}>Marks &amp; grades <ArrowRight size={13} /></button>
          </div>
          {courseCards.length ? (
            <div className="uc-courses">
              {courseCards.slice(0, 8).map(course => {
                const group = course.group;
                const components = group?.components ?? [];
                const academicLabel = getCourseAcademicLabel(course.mark, course.mark ? null : group?.percentage);
                // Marks and attendance are two different fractions of a course.
                // Each gets its own labelled meter; the marks one only appears
                // for rows VTOP has actually graded.
                const marksRatio = getInternalMarksRatio(course.mark);
                return (
                  <button className="uc-course" key={course.base} onClick={() => onNavigateTab('grades')}>
                    <span className={`uc-course-rule tone-${courseTone(course.base)}`} aria-hidden="true" />
                    <span className="uc-course-head"><span>{course.base}</span><b>{academicLabel}</b></span>
                    <strong>{display(group?.courseTitle || course.mark?.courseTitle)}</strong>
                    <small>{display(group?.rows.find(r => r.facultyName)?.facultyName)} · {group ? `${group.attended}/${group.conducted} attended` : 'Attendance not available'}</small>
                    {components.length > 1 && <span className="uc-course-split">{components.map(c => <span key={c.kind}>{componentLabel(c.kind)} <b>{c.percentage === null ? '—' : `${attendancePercentLabel(c.percentage)}%`}</b> {c.attended}/{c.conducted}</span>)}</span>}
                    {(marksRatio || (group && group.percentage !== null)) && (
                      <span className="uc-course-meters">
                        {marksRatio && <span className="uc-course-meter is-marks"><span>Marks</span><span className="uc-meter" role="img" aria-label={`${course.base} internal marks ${marksRatio.scored} of ${marksRatio.max} held`}><i style={{ width: `${marksRatio.percent}%` }} /></span><b>{Math.round(marksRatio.percent)}%</b></span>}
                        {group && group.percentage !== null && <span className="uc-course-meter"><span>Attended</span><span className="uc-meter" role="img" aria-label={`${course.base} overall attendance ${attendancePercentLabel(group.percentage)}%`}><i style={{ width: `${Math.min(100, group.percentage)}%` }} /></span><b>{attendancePercentLabel(group.percentage)}%</b></span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : <div className="uc-empty"><span>No course records arrived in this sync — use Sync and refresh in the header to ask VTOP again.</span></div>}
          {courseCards.length > 0 && (
            <div className="uc-plate-foot">
              <span>{courseCards.length > 8 ? `Showing 8 of ${courseCards.length} courses` : plural(courseCards.length, 'course')}</span>
            </div>
          )}
        </section>
      </div>

      <div className="uc-home-col">
        {/* The record: what VTOP has on file, and where the OD hours went. */}
        <section className="uc-plate" aria-label="Academic record">
          <div className="uc-plate-head"><span className="uc-plate-title">Academic record</span>{can('my-info') && <button className="uc-link" onClick={() => onNavigateTab('my-info')}>Profile <ArrowRight size={13} /></button>}</div>
          <dl className="uc-facts">
            <div><dt>Registration no.</dt><dd>{display(student.regNo)}</dd></div>
            <div><dt>Programme</dt><dd>{display(student.program)}</dd></div>
            <div><dt>Branch</dt><dd>{display(student.branch)}</dd></div>
            <div><dt>School</dt><dd>{display(schoolLabel(student.school))}</dd></div>
            <div><dt>Semester</dt><dd>{display(semesterLabel || (student.semester ? `Semester ${student.semester}` : null))}</dd></div>
            <div><dt>Proctor</dt><dd>{student.proctorAvailable ? display(student.proctorName) : 'Not available'}</dd></div>
          </dl>
          {/* The footer quotes the OD figure, so its button goes to the OD
              tracker — the profile told a student their hours and gave them no
              way to see how they were spent. */}
          {/* The tracker stays reachable whether or not the hours arrived — a
              missing figure is exactly when a student wants to see why. */}
          <div className="uc-plate-foot">
            <span>{od?.available ? `OD hours used: ${display(od.totalOdHours)}${od.limitHours !== null ? ` of ${display(od.limitHours)} this semester` : ''}` : 'OD information not available'}</span>
            <button className="uc-link" onClick={() => onNavigateTab('academics', 'od')}>OD tracker <ArrowRight size={13} /></button>
          </div>
        </section>

        {/* Proctor and faculty, with the honest note about where it came from. */}
        <section className="uc-plate" aria-label="Proctor and faculty">
          <div className="uc-plate-head"><span className="uc-plate-title">Proctor</span><button className="uc-link" onClick={() => onNavigateTab('faculty')}>Faculty directory <ArrowRight size={13} /></button></div>
          {student.proctorAvailable && isReal(student.proctorName) ? (
            <ProctorPerson name={display(student.proctorName)} contact={student.proctorContact} />
          ) : (
            <div className="uc-person">
              <span className="uc-person-avatar is-quiet" aria-hidden="true">—</span>
              <div>
                <strong>Proctor not available</strong>
                <span>No proctor record in synced data</span>
              </div>
            </div>
          )}
          <div className="uc-plate-foot"><span>{student.proctorAvailable && isReal(student.proctorName) ? 'Details shown as provided by VTOP.' : 'Sync to check for proctor information.'}</span><Users size={14} aria-hidden="true" /></div>
        </section>

        {/* University notices. */}
        <section className="uc-plate" aria-label="University notices">
          <div className="uc-plate-head"><span className="uc-plate-title">Notices</span>{circulars.length > 0 && <span className="uc-num uc-now-at">{circulars.length} new</span>}</div>
          {circulars.length ? (
            <div className="uc-rows">
              {circulars.slice(0, 3).map(c => (
                <div className="uc-notice" key={c.id}>
                  <span>{display(c.category)}</span>
                  <strong>{display(c.title)}</strong>
                  <small>{display(c.date)}</small>
                </div>
              ))}
            </div>
          ) : <div className="uc-empty"><span>VTOP has no notices for your account right now.</span></div>}
        </section>
      </div>
    </div>
  </div>;
};

export const MeridianDashboard = UltraCCDashboard;
