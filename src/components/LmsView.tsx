import React, { useState } from 'react';
import { CalendarClock, BellRing, HardDrive, GraduationCap, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { ExamRecord } from '../lib/vtop/types';
import { humanErrorCopy } from '../lib/errorCopy';
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
  { id: 'quizzes', label: 'Quiz Tracker', icon: BellRing },
  { id: 'materials', label: 'Materials', icon: HardDrive },
];

/** Last resort for a failure string that still reads like a machine. */
const LMS_ERROR_FALLBACK = 'The LMS did not answer, so this was not loaded. Your other data is unaffected.';

/**
 * LMS/Moodle — one section covering the VIT Moodle (lms.vit.ac.in): a unified
 * deadline feed (VTOP exams + LMS assignments + quiz windows), the quiz-window
 * tracker with push alerts, and course materials with offline caching.
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
    <div className="lms-view space-y-6 pb-12">
      {/* Section header */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-600">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight">LMS</h2>
              <p className="text-xs text-zinc-500 font-medium">
                Coursework, assignments, quiz windows and course materials
                {courses.length > 0 && (
                  <span className="text-teal-600/80"> · {courses.length} course{courses.length === 1 ? '' : 's'} synced</span>
                )}
              </p>
            </div>
          </div>
          <div className="lms-status-actions">
            <span className={`lms-status-badge ${badgeClass}`}><span />{statusLabel}</span>
            {onLmsSync && <button className="lms-sync-button" onClick={() => void onLmsSync()} disabled={lmsSyncing}>{lmsSyncing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} {lmsSyncing ? 'Syncing…' : 'Sync LMS'}</button>}
          </div>
          {hasLmsData && (
            <div className="flex flex-wrap gap-2">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                      tab === t.id
                        ? 'acc-bg text-zinc-900 border-transparent'
                        : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!hasLmsData && (
          <div className="mt-5 p-5 rounded-2xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-500 space-y-2">
            <p className="font-bold text-zinc-900 flex items-center gap-2"><ShieldAlert size={15} />{statusLabel === 'Authentication required' ? 'LMS authentication is required.' : statusLabel === 'No courses returned' ? 'No enrolled LMS courses were returned.' : 'LMS data is not available yet.'}</p>
            <p>
              {statusLabel === 'Authentication required' ? 'Save your VIT LMS username and password in Settings, then sync again.' : 'No assignments, course materials or quiz windows have been loaded for this account. If Moodle is unavailable, UltraCC keeps showing the last data it loaded.'}
            </p>
            <p className="text-[10px] text-zinc-500">
              This does not mean that your LMS has no coursework; the portal has not received LMS data yet.
            </p>
          </div>
        )}
        {(lmsSyncMessage || lmsLastSynced) && <p className="lms-sync-meta">{lmsSyncMessage ? humanErrorCopy(lmsSyncMessage, LMS_ERROR_FALLBACK) : 'Last synced'}{lmsLastSynced ? ` · ${new Date(lmsLastSynced).toLocaleString()}` : ''}</p>}
        {lmsSyncErrors.length > 0 && <div className="lms-sync-errors" role="status">{lmsSyncErrors.slice(0, 4).map((error) => <p key={`${error.label}-${error.error}`}><strong>{error.label}:</strong> {humanErrorCopy(error.error, LMS_ERROR_FALLBACK)}</p>)}</div>}
      </div>

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
