import React, { useState } from 'react';
import { CalendarClock, BellRing, HardDrive, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { ExamRecord } from '../lib/vtop/types';
import { humanErrorCopy } from '../lib/errorCopy';
import { formatSyncStamp } from '../utils/timestamp';
import { LMS_NEEDS_CREDENTIALS } from '../lib/lms/lmsClient';
import { LmsAssignment, LmsQuizWindow, LmsMaterial, LmsCourse } from '../lib/lms/types';
import { DeadlinesView } from './DeadlinesView';
import { QuizTrackerView } from './QuizTrackerView';
import { LmsMaterialsView } from './LmsMaterialsView';

interface LmsViewProps {
  exams: ExamRecord[];
  assignments: LmsAssignment[];
  quizzes: LmsQuizWindow[];
  materials: LmsMaterial[];
  courses: LmsCourse[];
  onOpenCourse?: (courseCode: string) => void;
  lmsSyncing?: boolean;
  lmsSyncMessage?: string | null;
  lmsSyncErrors?: { label: string; error: string }[];
  lmsLastSynced?: number | null;
  /** The last sync did not fully succeed — the badge must not claim "Synced". */
  needsAttention?: boolean;
  onLmsSync?: () => Promise<{ ok: boolean; message: string }>;
}

type LmsTab = 'deadlines' | 'quizzes' | 'materials';

const TABS: { id: LmsTab; label: string; icon: React.ElementType }[] = [
  { id: 'deadlines', label: 'Deadlines', icon: CalendarClock },
  { id: 'quizzes', label: 'Quiz tracker', icon: BellRing },
  { id: 'materials', label: 'Materials', icon: HardDrive },
];

/** Last resort for a failure string that still reads like a machine. */
const LMS_ERROR_FALLBACK = 'The LMS did not answer, so this was not loaded. Your other data is unaffected.';

/**
 * LMS/Moodle — one section covering the VIT Moodle (lms.vit.ac.in): a unified
 * deadline feed (VTOP exams + LMS assignments + quiz windows), the quiz-window
 * tracker with push alerts, and course materials with offline caching.
 *
 * The section heads with what the sync actually did, because the badge used to
 * answer "is there any cached LMS data?" and could read "Synced" beside a failed
 * refresh. The three registers below it are one document each: a ledged
 * deadline feed, a window tracker, and a file library.
 */
export const LmsView: React.FC<LmsViewProps> = ({ exams, assignments, quizzes, materials, courses, onOpenCourse, lmsSyncing = false, lmsSyncMessage, lmsSyncErrors = [], lmsLastSynced, needsAttention = false, onLmsSync }) => {
  const [tab, setTab] = useState<LmsTab>('deadlines');
  const hasLmsData = courses.length > 0 || assignments.length > 0 || quizzes.length > 0 || materials.length > 0;

  /*
   * The badge used to answer "is there any cached LMS data?", which let a
   * completely failed sync sit next to a red "LMS refresh failed" toast and
   * still read "Synced". It now reports the last attempt: cached rows are
   * "Cached", a partial run is "Partly synced", and only a clean run is
   * "Synced". "No courses returned" is likewise only claimed when the sync
   * actually reached Moodle and came back empty.
   */
  const needsCredentials = lmsSyncMessage === LMS_NEEDS_CREDENTIALS;
  const statusLabel = lmsSyncing
    ? 'Loading LMS data'
    : needsCredentials
      ? 'Authentication required'
      : lmsSyncErrors.length > 0
        ? 'Partly synced'
        : needsAttention
          ? 'Not synced'
          : hasLmsData
            ? lmsSyncMessage ? 'Synced' : 'Cached'
            : lmsSyncMessage ? 'No courses returned' : 'Not synced';
  const badgeClass = statusLabel === 'Synced' || statusLabel === 'Cached'
    ? 'synced'
    : statusLabel === 'Partly synced' || statusLabel === 'Authentication required' || statusLabel === 'Not synced'
      ? 'partial'
      : statusLabel === 'Loading LMS data'
        ? 'loading'
        : '';

  return (
    <div className="lms-view uc-lms pb-12">
      <section className="uc-plate uc-lms-mast">
        <div className="uc-plate-head">
          <div className="uc-lms-id">
            <p className="uc-cap">Coursework</p>
            <h2 className="uc-lms-title">LMS</h2>
            <p className="uc-note">
              Assignments, quiz windows and course files from lms.vit.ac.in
              {courses.length > 0 && ` · ${courses.length} course${courses.length === 1 ? '' : 's'} synced`}
            </p>
          </div>
          <div className="lms-status-actions">
            <span className={`lms-status-badge ${badgeClass}`}><span />{statusLabel}</span>
            {onLmsSync && <button className="lms-sync-button" onClick={() => void onLmsSync()} disabled={lmsSyncing}>{lmsSyncing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} {lmsSyncing ? 'Syncing…' : 'Sync LMS'}</button>}
          </div>
        </div>

        {hasLmsData && (
          <div className="uc-seg uc-lms-tabs" role="group" aria-label="LMS section">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tab === t.id}
                  className={tab === t.id ? 'is-on' : ''}
                  onClick={() => setTab(t.id)}
                >
                  <Icon size={14} aria-hidden="true" />
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        {!hasLmsData && (
          <div className="uc-note-row uc-lms-empty" role="status">
            <ShieldAlert size={15} aria-hidden="true" />
            <div>
              <p><b>{statusLabel === 'Authentication required' ? 'LMS authentication is required.' : statusLabel === 'No courses returned' ? 'No enrolled LMS courses were returned.' : 'LMS data is not available yet.'}</b></p>
              <p>
                {statusLabel === 'Authentication required' ? 'Save your VIT LMS username and password in Settings, then sync again.' : 'No assignments, course materials or quiz windows have been loaded for this account. If Moodle is unavailable, UltraCC keeps showing the last data it loaded.'}
              </p>
            </div>
          </div>
        )}
        {(lmsSyncMessage || lmsLastSynced) && <p className="lms-sync-meta">{lmsSyncMessage ? humanErrorCopy(lmsSyncMessage, LMS_ERROR_FALLBACK) : 'Last synced'}{lmsLastSynced ? ` · ${formatSyncStamp(lmsLastSynced)}` : ''}</p>}
        {lmsSyncErrors.length > 0 && <div className="lms-sync-errors" role="status">{lmsSyncErrors.slice(0, 4).map((error) => <p key={`${error.label}-${error.error}`}><strong>{error.label}:</strong> {humanErrorCopy(error.error, LMS_ERROR_FALLBACK)}</p>)}</div>}
      </section>

      {hasLmsData && tab === 'deadlines' && (
        <DeadlinesView
          exams={exams}
          assignments={assignments}
          quizzes={quizzes}
          courses={courses}
          onOpenCourse={onOpenCourse}
        />
      )}
      {hasLmsData && tab === 'quizzes' && <QuizTrackerView quizzes={quizzes} courses={courses} />}
      {hasLmsData && tab === 'materials' && <LmsMaterialsView materials={materials} courses={courses} />}
    </div>
  );
};
