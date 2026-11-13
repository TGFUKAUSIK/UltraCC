import React, { useEffect, useState } from 'react';
import { AlertTriangle, BellRing, Timer } from 'lucide-react';
import { LmsQuizWindow, LmsCourse } from '../lib/lms/types';
import { formatTimestamp } from '../utils/timestamp';
// The window rule lives in lib so Home can print the same countdown this
// tracker does. Two copies would eventually disagree about what "open" means.
import { quizStatus } from '../lib/lms/quizWindow';

interface QuizTrackerViewProps {
  quizzes: LmsQuizWindow[];
  courses: LmsCourse[];
}

/**
 * The quiz-window tracker: one ruled line per window, ordered by when it opens,
 * with both ends of the window printed on the mono face so the student can see
 * how long they have. State is punctuation — a lamp and a word — not a surface,
 * because a wall of coloured chips is exactly what the app is shedding.
 */
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
    <section className="uc-plate uc-qz" aria-label="Quiz windows">
      <div className="uc-plate-head">
        <div className="uc-qz-id">
          <p className="uc-cap">Assessment windows</p>
          <h3 className="uc-qz-title">Quiz tracker</h3>
          <p className="uc-note">LMS quiz open and close windows, with alerts 15 minutes before each end.</p>
        </div>
        {hasData && <span className="uc-num uc-qz-count">{quizzes.length}</span>}
      </div>

      {hasData ? (
        <div className="uc-qz-ledger">
          {sorted.map((q) => {
            const { status, label } = quizStatus(q, now);
            const state = status === 'open-now' ? 'is-open' : status === 'not-open' ? 'is-soon' : 'is-closed';
            const lamp = status === 'open-now' ? 'uc-lamp--live' : status === 'not-open' ? 'uc-lamp--warn' : '';
            return (
              <article key={q.quizId} className={`uc-qz-row ${state}`}>
                <div className="uc-qz-main">
                  <div className="uc-qz-top">
                    <h4 className="uc-qz-name">{q.name}</h4>
                    <span className={`uc-lamp ${lamp} uc-qz-state`}>{label}</span>
                  </div>
                  <p className="uc-qz-course">{courseName(q.courseId)}</p>
                  <p className="uc-qz-when">
                    <span>Opens <b>{formatTimestamp(q.openTime)}</b></span>
                    <span>Closes <b>{formatTimestamp(q.closeTime)}</b></span>
                    {q.timeLimitMins !== null && <span><Timer size={11} aria-hidden="true" /> {q.timeLimitMins} min</span>}
                    {q.attemptLimit !== null && <span>{q.attemptLimit} attempt{q.attemptLimit === 1 ? '' : 's'}</span>}
                  </p>
                  {q.submissionStatus && <p className="uc-qz-sub">{q.submissionStatus}</p>}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="uc-empty">
          <span>No quiz windows have been loaded yet. Sync your LMS account in Settings to see them and get alerts.</span>
          <BellRing size={18} aria-hidden="true" />
        </div>
      )}

      <div className="uc-note-row uc-note-row--warn uc-qz-warn">
        <AlertTriangle size={15} aria-hidden="true" />
        <div>
          <p className="uc-note-row-head">Missed windows do not reopen</p>
          <p className="uc-note-row-line">Allow notifications when asked, and UltraCC will warn you 15 minutes before a quiz opens and before it closes.</p>
        </div>
      </div>
    </section>
  );
};
