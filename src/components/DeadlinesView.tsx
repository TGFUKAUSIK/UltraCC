import React, { useMemo, useState } from 'react';
import { CalendarClock, FileText, Timer, Award, Layers } from 'lucide-react';
import { ExamRecord } from '../lib/vtop/types';
import { LmsAssignment, LmsQuizWindow, LmsCourse } from '../lib/lms/types';
import { examStartMs } from '../utils/examUtils';

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
  /** Sort instant (due / open / exam time). */
  at: number;
  detail: string;
  statusLabel?: string;
  sourceBadge: string;
}

const BADGE: Record<DeadlineKind, string> = {
  exam: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  assignment: 'bg-purple-500/15 text-purple-700 border-purple-500/30',
  quiz: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
};

const KIND_LABEL: Record<DeadlineKind, string> = { exam: 'Exam', assignment: 'Assignment', quiz: 'Quiz' };

function countdown(target: number, now: number): string {
  const diff = target - now;
  if (diff <= 0) return 'Due now';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function fmtAt(ts: number): string {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayStart = new Date(ts); dayStart.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((dayStart.getTime() - today.getTime()) / 86400000);
  const day =
    dayDiff === 0 ? 'Today'
    : dayDiff === 1 ? 'Tomorrow'
    : dayDiff === -1 ? 'Yesterday'
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${day} • ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

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
        detail: 'Due',
        statusLabel: 'LMS',
        sourceBadge: 'LMS',
      });
    }

    // LMS quizzes (open window — the critical timestamp)
    for (const q of quizzes) {
      if (!q.openTime) continue;
      const dt = new Date(q.openTime);
      if (isNaN(dt.getTime())) continue;
      list.push({
        kind: 'quiz',
        title: q.name,
        courseName: courseName(q.courseId),
        at: dt.getTime(),
        detail: q.closeTime ? `Closes ${fmtAt(new Date(q.closeTime).getTime())}` : 'Opens',
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

  return (
    <div className="space-y-6 pb-12">
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600">
              <CalendarClock className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight">All Deadlines</h2>
              <p className="text-xs text-zinc-500 font-medium">VTOP exams + LMS assignments + quiz windows, one timeline</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                  filter === f.id
                    ? 'acc-bg text-zinc-900 border-transparent'
                    : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {filtered.length === 0 ? (
            <div className="p-8 bg-zinc-50 rounded-2xl border border-zinc-200 text-center">
              <CalendarClock className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
              <p className="text-sm font-bold text-zinc-900">Nothing scheduled</p>
              <p className="text-[11px] text-zinc-500 mt-1">
                {items.length === 0
                  ? 'Sync VTOP and your LMS account to see exams, assignments and quiz windows here.'
                  : 'No items in this filter.'}
              </p>
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.kind === 'exam' ? Layers : item.kind === 'assignment' ? FileText : Timer;
              // Derive a course code for hub drill-down (exam has one directly;
              // LMS items are matched by course name containing the code).
              const hubCode =
                item.kind === 'exam' ? item.title.split(':')[0].trim()
                : onOpenCourse && item.courseName ? item.courseName : undefined;
              return (
                <div
                  key={`${item.kind}-${idx}`}
                  onClick={hubCode && onOpenCourse ? () => onOpenCourse(hubCode) : undefined}
                  className={`p-4 rounded-2xl border bg-zinc-50 border-zinc-200 flex items-center justify-between gap-3 ${hubCode && onOpenCourse ? 'cursor-pointer hover:border-zinc-300 transition' : ''}`}
                >
                  <div className="flex items-start space-x-3 min-w-0">
                    <div className={`p-2 rounded-xl shrink-0 ${BADGE[item.kind]}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-bold text-zinc-900 truncate">{item.title}</h4>
                        <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border ${BADGE[item.kind]}`}>
                          {KIND_LABEL[item.kind]}
                        </span>
                        <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded border bg-zinc-100 text-zinc-500 border-zinc-200">
                          {item.sourceBadge}
                        </span>
                      </div>
                      {item.courseName && <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{item.courseName}</p>}
                      <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                        {fmtAt(item.at)} {item.detail && <span className="text-zinc-500">• {item.detail}</span>}
                      </p>
                      {item.statusLabel && <p className="text-[10px] text-zinc-500 mt-0.5">{item.statusLabel}</p>}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-mono font-bold px-2.5 py-1 rounded-lg border ${
                      item.at - now < 3600 * 1000
                        ? 'bg-rose-500/15 text-rose-700 border-rose-500/30'
                        : item.at - now < 24 * 3600 * 1000
                        ? 'bg-amber-500/15 text-amber-700 border-amber-500/30'
                        : 'bg-white text-zinc-900 border-zinc-200'
                    }`}
                  >
                    {item.at < now ? <Award className="h-3 w-3 inline mr-1" /> : null}
                    {countdown(item.at, now)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
