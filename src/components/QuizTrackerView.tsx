import React, { useEffect, useState } from 'react';
import { Clock, Timer, BellRing, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { LmsQuizWindow, LmsCourse } from '../lib/lms/types';

interface QuizTrackerViewProps {
  quizzes: LmsQuizWindow[];
  courses: LmsCourse[];
}

type QuizStatus = 'open-now' | 'not-open' | 'closed' | 'unknown';

function quizStatus(q: LmsQuizWindow, now: number): { status: QuizStatus; label: string } {
  const open = q.openTime ? new Date(q.openTime).getTime() : null;
  const close = q.closeTime ? new Date(q.closeTime).getTime() : null;
  if (open && close) {
    if (now < open) return { status: 'not-open', label: `Opens in ${countdown(open - now)}` };
    if (now >= open && now <= close) return { status: 'open-now', label: `Closes in ${countdown(close - now)}` };
    return { status: 'closed', label: 'Closed' };
  }
  if (open && now < open) return { status: 'not-open', label: `Opens in ${countdown(open - now)}` };
  if (close && now <= close) return { status: 'open-now', label: `Closes in ${countdown(close - now)}` };
  return { status: 'unknown', label: q.submissionStatus || 'Timing not published' };
}

function countdown(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

export const QuizTrackerView: React.FC<QuizTrackerViewProps> = ({ quizzes, courses }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(iv);
  }, []);

  const courseName = (courseId: number) => {
    const c = courses.find((x) => x.courseId === courseId);
    return c ? c.name : `Course ${courseId}`;
  };

  const sorted = [...quizzes].sort((a, b) => {
    const ao = a.openTime ? new Date(a.openTime).getTime() : Infinity;
    const bo = b.openTime ? new Date(b.openTime).getTime() : Infinity;
    return ao - bo;
  });

  const hasData = quizzes.length > 0;

  return (
    <div className="space-y-6 pb-12">
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600">
            <BellRing className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight">Quiz Window Tracker</h2>
            <p className="text-xs text-zinc-500 font-medium">
              LMS quiz open/close windows with push alerts — 15 min before open, 15 &amp; 5 min before close.
            </p>
          </div>
        </div>

        {hasData ? (
          <div className="mt-6 space-y-3">
            {sorted.map((q) => {
              const { status, label } = quizStatus(q, now);
              return (
                <div key={q.quizId} className="p-4 rounded-2xl border bg-zinc-50 border-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900">{q.name}</h4>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{courseName(q.courseId)}</p>
                    <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-zinc-500 font-mono">
                      <span>Opens: <span className="text-zinc-900 font-bold">{fmt(q.openTime)}</span></span>
                      <span>Closes: <span className="text-zinc-900 font-bold">{fmt(q.closeTime)}</span></span>
                      {q.timeLimitMins !== null && (
                        <span className="flex items-center gap-1"><Timer className="h-3 w-3" /> {q.timeLimitMins} min</span>
                      )}
                      {q.attemptLimit !== null && <span>{q.attemptLimit} attempts</span>}
                    </div>
                    {q.submissionStatus && (
                      <p className="text-[10px] text-zinc-500 mt-1.5">Status: {q.submissionStatus}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`inline-block px-3 py-1.5 rounded-full text-xs font-extrabold border ${
                        status === 'open-now'
                          ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                          : status === 'not-open'
                          ? 'bg-amber-500/15 text-amber-700 border-amber-500/30'
                          : status === 'closed'
                          ? 'bg-zinc-100 text-zinc-500 border-zinc-200'
                          : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                      }`}
                    >
                      {status === 'open-now' ? <CheckCircle2 className="h-3 w-3 inline mr-1" /> : <Clock className="h-3 w-3 inline mr-1" />}
                      {label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 p-8 bg-zinc-50 rounded-2xl border border-zinc-200 text-center">
            <BellRing className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm font-bold text-zinc-900">No quiz windows synced</p>
            <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto leading-relaxed">
              Sync your LMS account (Settings → LMS Account → Sync) to see quiz open/close windows and get alerts.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2.5 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 text-xs">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>Missed quiz windows are unrecoverable.</strong> Notifications require browser permission — allow
          notifications when prompted so UltraCC can alert you 15 minutes before a quiz opens and before it closes.
        </p>
      </div>
    </div>
  );
};
