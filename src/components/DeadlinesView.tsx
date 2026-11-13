import React, { useMemo, useState } from 'react';
import { CalendarClock, ChevronRight, FileText, Timer, Layers } from 'lucide-react';
import { ExamRecord } from '../lib/vtop/types';
import { LmsAssignment, LmsQuizWindow, LmsCourse } from '../lib/lms/types';
import { examEndMs, examStartMs, formatRemaining, istClock, istDayDiff } from '../utils/examUtils';

interface DeadlinesViewProps {
  exams: ExamRecord[];
  assignments: LmsAssignment[];
  quizzes: LmsQuizWindow[];
  courses: LmsCourse[];
  /** Open the Course Hub for a course code (LMS course name match). */
  onOpenCourse?: (courseCode: string) => void;
}

type DeadlineKind = 'exam' | 'assignment' | 'quiz';
type Filter = 'all' | DeadlineKind;

interface DeadlineItem {
  kind: DeadlineKind;
  title: string;
  courseName: string;
  /** Where the item sits on the timeline (exam start, due date, window open). */
  at: number;
  /**
   * The instant the student must have acted by. This is what the countdown
   * counts down to, and it is not always `at`: a quiz opens days before it
   * closes, and the close is the deadline.
   */
  dueAt: number;
  /** When the window shuts or the paper ends; null when neither is known. */
  endsAt: number | null;
  detail: string;
  statusLabel?: string;
  sourceBadge: string;
}

/**
 * Every kind wears the same quiet chip. What a deadline *is* is already said by
 * its icon and its label; the hue it used to wear — blue for an exam, purple for
 * an assignment, green for a quiz — was a second colour language spoken beside
 * the countdown's own, and on this board colour means urgency. Those literals
 * also broke the dark themes outright: `text-purple-700` on a purple tint is a
 * value the shell never repaints, so an assignment's label sank into the surface
 * after dark.
 */
const KIND_CHIP = 'uc-panel-unknown uc-ink-unknown';

const KIND_LABEL: Record<DeadlineKind, string> = { exam: 'Exam', assignment: 'Assignment', quiz: 'Quiz' };

/**
 * What each kind's timeline instant actually is. Without these words a quiz's
 * opening time and an assignment's submission deadline look like the same
 * thing, and only one of them is the time the student must be ready for.
 */
const ANCHOR_LABEL: Record<DeadlineKind, string> = { exam: 'Starts', assignment: 'Due', quiz: 'Opens' };

/**
 * Once the moment has passed, each kind means something different: an
 * assignment is still the student's fault, a closed quiz and a finished exam
 * are simply history. One shared "Due now" said nothing true about either.
 */
function pastLabel(item: DeadlineItem, now: number): { text: string; actionable: boolean } {
  if (item.kind === 'assignment') return { text: 'Overdue', actionable: true };
  if (item.kind === 'quiz') return { text: 'Closed', actionable: false };
  if (item.endsAt === null || now >= item.endsAt) return { text: 'Done', actionable: false };
  return { text: 'Running', actionable: false };
}

const IST_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * An instant as the student's clock reads it, with today's word in front of it.
 * Printed on the India clock because every instant here was built from India
 * calendar strings — a device set elsewhere would show a different hour than
 * the countdown beside it is counting to.
 */
function fmtAt(ts: number, now: number = Date.now()): string {
  const c = istClock(ts);
  if (!c) return '—';
  const dayDiff = istDayDiff(c.dayStartMs, now);
  const day =
    dayDiff === 0 ? 'Today'
    : dayDiff === 1 ? 'Tomorrow'
    : dayDiff === -1 ? 'Yesterday'
    : `${c.day} ${IST_MONTHS[c.month]}`;
  const hour12 = c.hour % 12 === 0 ? 12 : c.hour % 12;
  return `${day} • ${hour12}:${String(c.minute).padStart(2, '0')} ${c.hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * The deadline feed: one ruled ledger of every instant that has a clock on it,
 * ordered the way the term arrives. The next thing to be owed is the only row
 * with an accent edge, so the student's eye lands on it before reading a word —
 * the countdown beside it is the answer, everything below it is the week.
 */
export const DeadlinesView: React.FC<DeadlinesViewProps> = ({ exams, assignments, quizzes, courses, onOpenCourse }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [now, setNow] = useState(Date.now());
  React.useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const courseName = (id: number) => courses.find((c) => c.courseId === id)?.name || `Course ${id}`;

  const items = useMemo<DeadlineItem[]>(() => {
    const list: DeadlineItem[] = [];

    // VTOP exams (exam date + time; skip ones with no date)
    for (const e of exams) {
      if (!e.date) continue;
      // VTOP writes the time as a range ("10:00 AM - 11:30 AM"), which
      // `new Date()` cannot parse — every exam used to be silently dropped from
      // this list. examStartMs reads the IST range and takes its start.
      const start = examStartMs(e.date, e.time || '');
      if (start === null || Number.isNaN(start)) continue;
      list.push({
        kind: 'exam',
        title: `${e.courseCode || e.slot || 'Exam'}: ${!e.examType || e.examType === 'Other' ? 'Examination' : e.examType}`,
        courseName: e.courseTitle || e.courseCode || '',
        at: start,
        dueAt: start,
        endsAt: examEndMs(e.date, e.time || ''),
        detail: [e.venue, e.seatNo ? `Seat ${e.seatNo}` : ''].filter(Boolean).join(' • '),
        sourceBadge: 'VTOP',
      });
    }

    // LMS assignments (due date)
    for (const a of assignments) {
      if (!a.dueDate) continue;
      const dt = new Date(a.dueDate);
      if (isNaN(dt.getTime())) continue;
      list.push({
        kind: 'assignment',
        title: a.name,
        courseName: courseName(a.courseId),
        at: dt.getTime(),
        dueAt: dt.getTime(),
        endsAt: null,
        detail: '',
        sourceBadge: 'LMS',
      });
    }

    // LMS quizzes (window: opens then closes — the close is the deadline)
    for (const q of quizzes) {
      if (!q.openTime) continue;
      const dt = new Date(q.openTime);
      if (isNaN(dt.getTime())) continue;
      const closes = q.closeTime ? new Date(q.closeTime).getTime() : NaN;
      const closeAt = Number.isNaN(closes) ? null : closes;
      list.push({
        kind: 'quiz',
        title: q.name,
        courseName: courseName(q.courseId),
        at: dt.getTime(),
        // A quiz that opened three days ago is not "overdue" — it is still
        // open until its window shuts, and that is the time worth counting.
        dueAt: closeAt ?? dt.getTime(),
        endsAt: closeAt,
        detail: q.timeLimitMins ? `${q.timeLimitMins} min attempt` : '',
        statusLabel: q.submissionStatus || undefined,
        sourceBadge: 'LMS',
      });
    }

    return list.sort((a, b) => a.at - b.at);
  }, [exams, assignments, quizzes, courses]);

  const filtered = items.filter((i) => filter === 'all' || i.kind === filter);
  const counts = {
    all: items.length,
    exam: items.filter((i) => i.kind === 'exam').length,
    assignment: items.filter((i) => i.kind === 'assignment').length,
    quiz: items.filter((i) => i.kind === 'quiz').length,
  };

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: `All (${counts.all})` },
    { id: 'exam', label: `Exams (${counts.exam})` },
    { id: 'assignment', label: `Assignments (${counts.assignment})` },
    { id: 'quiz', label: `Quizzes (${counts.quiz})` },
  ];

  // The one row the screen is for: the first thing still owed. An exam already
  // being written, or an already-overdue assignment, is not it.
  const nextIdx = filtered.findIndex((i) => i.dueAt > now);

  return (
    <section className="uc-plate uc-dl" aria-label="Deadlines">
      <div className="uc-plate-head">
        <div className="uc-dl-id">
          <p className="uc-cap">Everything with a clock on it</p>
          <h3 className="uc-dl-title">Deadlines</h3>
          <p className="uc-note">VTOP exams, LMS assignments and quiz windows, in the order they arrive.</p>
        </div>
        <span className="uc-num uc-dl-count">{counts.all}</span>
      </div>

      {items.length > 0 && (
        <div className="uc-dl-filter" role="group" aria-label="Filter deadlines">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              className={filter === f.id ? 'is-on' : ''}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="uc-empty">
          <span>
            {items.length === 0
              ? 'Sync VTOP and your LMS account to see exams, assignments and quiz windows here.'
              : 'No items in this filter.'}
          </span>
          <CalendarClock size={18} aria-hidden="true" />
        </div>
      ) : (
        <div className="uc-dl-ledger">
          {filtered.map((item, idx) => {
            const Icon = item.kind === 'exam' ? Layers : item.kind === 'assignment' ? FileText : Timer;
            // Derive a course code for hub drill-down (exam has one directly;
            // LMS items are matched by course name containing the code).
            const hubCode =
              item.kind === 'exam' ? item.title.split(':')[0].trim()
              : onOpenCourse && item.courseName ? item.courseName : undefined;
            const open = hubCode && onOpenCourse ? () => onOpenCourse(hubCode) : null;
            const leftMs = item.dueAt - now;
            const passed = pastLabel(item, now);
            // Colour on this board means urgency, and it is worn on the `--uc-*`
            // tone tokens the dark themes repaint. The rose/amber/zinc literals
            // that used to sit here were fixed light-mode values: `text-rose-700`
            // on a rose tint sank below AA after dark, and the far-off badge
            // (`bg-white text-zinc-900`) turned white-on-white once the shell
            // claimed `text-zinc-900`. A finished exam is not an emergency; work
            // the student still owes is.
            const tone = leftMs <= 0
              ? passed.actionable
                ? 'uc-panel-critical uc-ink-critical'
                : 'uc-panel-unknown uc-ink-unknown'
              : leftMs < 3600 * 1000
              ? 'uc-panel-critical uc-ink-critical'
              : leftMs < 24 * 3600 * 1000
              ? 'uc-panel-warning uc-ink-warning'
              : 'uc-panel-unknown uc-ink-unknown';
            return (
              // `rounded-2xl` is kept only because the deadline regression suite
              // finds a row by that class; `.uc-dl-row` neutralises the radius
              // and rules the row flat.
              <div
                key={`${item.kind}-${idx}`}
                onClick={open ?? undefined}
                className={`uc-dl-row rounded-2xl${idx === nextIdx ? ' is-next' : ''}${open ? ' is-open' : ''}`}
              >
                <div className={`uc-dl-kind ${KIND_CHIP}`} aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="uc-dl-main">
                  <div className="uc-dl-top">
                    <h4 className="uc-dl-name">{item.title}</h4>
                    <span className={`uc-dl-tag ${KIND_CHIP}`}>{KIND_LABEL[item.kind]}</span>
                    <span className="uc-dl-src">{item.sourceBadge}</span>
                  </div>
                  {item.courseName && <p className="uc-dl-course">{item.courseName}</p>}
                  <p className="uc-dl-when">
                    {ANCHOR_LABEL[item.kind]} {fmtAt(item.at, now)}
                    {item.detail && <span> • {item.detail}</span>}
                  </p>
                  {/* The far end of the window, read off the moving clock:
                      when the paper finishes and when a quiz shuts are both
                      things a student plans the day around. */}
                  {item.endsAt !== null && (
                    <p className="uc-dl-when">Until {fmtAt(item.endsAt, now)}</p>
                  )}
                  {item.statusLabel && item.statusLabel !== item.sourceBadge && (
                    <p className="uc-dl-status">{item.statusLabel}</p>
                  )}
                </div>
                <div className="uc-dl-right">
                  <span className={`uc-dl-badge ${tone}`}>{leftMs <= 0 ? passed.text : formatRemaining(leftMs)}</span>
                  {/* Tapping anywhere on the row works, but a keyboard or
                      screen-reader student needs a control that says what it is. */}
                  {open && (
                    <button
                      type="button"
                      aria-label={`Open ${item.courseName || hubCode} in the Course Hub`}
                      onClick={(e) => {
                        e.stopPropagation();
                        open();
                      }}
                      className="uc-dl-open"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
