import React from 'react';
import { LogIn, Calendar, LayoutDashboard } from 'lucide-react';
import { UltraCCLogo } from './UltraCCLogo';
import { SemesterInfo } from '../lib/vtop/types';
import { saveFeatureMode } from '../lib/settings';
import type { FeatureMode } from '../lib/navVisibility';

interface FirstRunLandingProps {
  onLogin: () => void;
  semesters: SemesterInfo[];
  selectedSemesterId: string;
  onSemesterChange: (semesterId: string) => void;
  mode: FeatureMode;
  onModeChange: (mode: FeatureMode) => void;
}

/**
 * The first thing a brand-new student sees: a clean onboarding surface with
 * exactly three actions — sign in to VTOP, pick their academic semester, and
 * choose minimal vs complete. No rail, no tab bar, no service grid: the rest
 * of UltraCC only appears once data has been synced.
 */
export const FirstRunLanding: React.FC<FirstRunLandingProps> = ({
  onLogin,
  semesters,
  selectedSemesterId,
  onSemesterChange,
  mode,
  onModeChange,
}) => {
  const chooseMode = (next: FeatureMode) => {
    saveFeatureMode(next);
    onModeChange(next);
  };

  return (
    <div className="ultracc-first-run min-h-[calc(100dvh-2rem)] flex items-center justify-center py-8">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-7">
          <UltraCCLogo size={64} />
          <h1 className="mt-4 text-2xl font-extrabold text-zinc-900 tracking-tight">UltraCC</h1>
          <p className="mt-1 text-xs text-zinc-500 font-medium">VIT Chennai · Student Portal</p>
        </div>

        <div className="bg-white border border-zinc-200 rounded-3xl shadow-xl overflow-hidden">
          {/* Sign in */}
          <div className="p-6 border-b border-zinc-200">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-extrabold mb-3">Get started</p>
            <button
              onClick={onLogin}
              className="w-full py-3.5 acc-bg text-white rounded-2xl text-sm font-extrabold transition flex items-center justify-center gap-2 cursor-pointer hover:opacity-90 shadow-lg acc-glow"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Login with VTOP
            </button>
            <p className="mt-2.5 text-[11px] text-zinc-500 text-center">
              Load your timetable, attendance, marks and exams from your campus account.
            </p>
          </div>

          {/* Semester */}
          <div className="p-6 border-b border-zinc-200">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-extrabold mb-3 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" /> Semester
            </p>
            {semesters.length > 0 ? (
              <select
                aria-label="Academic semester"
                value={selectedSemesterId}
                onChange={(e) => onSemesterChange(e.target.value)}
                className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none"
              >
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.isCurrent ? ' (Active)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-zinc-500">
                Your semesters appear here after you log in — pick the term you're studying.
              </p>
            )}
          </div>

          {/* Feature mode */}
          <div className="p-6">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-extrabold mb-3 flex items-center gap-1.5">
              <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" /> Layout
            </p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Feature mode">
              <button
                role="radio"
                aria-checked={mode === 'minimal'}
                onClick={() => chooseMode('minimal')}
                className={`text-left rounded-xl border px-3 py-3 transition cursor-pointer ${mode === 'minimal' ? 'acc-soft acc-border' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}
              >
                <span className="block text-xs font-extrabold text-zinc-900">Minimal</span>
                <span className="block text-[10px] text-zinc-500 mt-1">Just the daily essentials</span>
              </button>
              <button
                role="radio"
                aria-checked={mode === 'complete'}
                onClick={() => chooseMode('complete')}
                className={`text-left rounded-xl border px-3 py-3 transition cursor-pointer ${mode === 'complete' ? 'acc-soft acc-border' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}
              >
                <span className="block text-xs font-extrabold text-zinc-900">Complete</span>
                <span className="block text-[10px] text-zinc-500 mt-1">Every UltraCC feature</span>
              </button>
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] text-zinc-500">
          Your credentials stay on this device and are only sent to VTOP when you sign in.
        </p>
      </div>
    </div>
  );
};
