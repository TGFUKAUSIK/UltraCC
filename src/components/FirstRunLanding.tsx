import React from 'react';
import { LogIn, Calendar, LayoutDashboard, ShieldCheck } from 'lucide-react';
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
 * The first thing a brand-new student sees: three steps — sign in to VTOP, pick
 * the academic term, choose minimal vs complete — numbered in the order they can
 * actually be done. No rail, no tab bar, no service grid: the rest of UltraCC
 * only appears once data has been synced.
 *
 * The shape is the same ledger the rest of the app uses, because this is the
 * first screen a student meets and it should already look like the product:
 * wordmark, one bordered plate, a hairline between steps, and a footnote that
 * says where the credentials go.
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
    <div className="ultracc-first-run">
      <div className="uc-onboard">
        <div className="uc-first-run-wordmark">
          <UltraCCLogo size={56} />
          <h1>UltraCC</h1>
          <p className="uc-cap">VIT Chennai · Student portal</p>
        </div>

        {/* Three numbered steps. The numeral is a gutter the step hangs on, so
            the plate reads as a procedure rather than three unrelated boxes. */}
        <div className="uc-first-run-card uc-plate">
          <ol className="uc-first-run-steps">
            <li className="uc-first-run-step">
              <span className="uc-first-run-step-num text-zinc-900" aria-hidden="true">1</span>
              <div className="uc-onboard-body">
                <h2 className="uc-cap">Get started</h2>
                <button type="button" onClick={onLogin} className="uc-dir-go acc-bg uc-onboard-cta min-h-[44px]">
                  <LogIn aria-hidden="true" />
                  Login with VTOP
                </button>
                <p className="uc-dir-sub">
                  Load your timetable, attendance, marks and exams from your campus account.
                </p>
              </div>
            </li>

            <li className="uc-first-run-step">
              <span className="uc-first-run-step-num text-zinc-900" aria-hidden="true">2</span>
              <div className="uc-onboard-body">
                <h2 className="uc-cap"><Calendar aria-hidden="true" />Semester</h2>
                {semesters.length > 0 ? (
                  <select
                    aria-label="Academic semester"
                    value={selectedSemesterId}
                    onChange={(e) => onSemesterChange(e.target.value)}
                    className="uc-dir-select min-h-[44px]"
                  >
                    {semesters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}{s.isCurrent ? ' (Active)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="uc-dir-sub">
                    Your semesters appear here after you log in — pick the term you're studying.
                  </p>
                )}
              </div>
            </li>

            <li className="uc-first-run-step">
              <span className="uc-first-run-step-num text-zinc-900" aria-hidden="true">3</span>
              <div className="uc-onboard-body">
                <h2 className="uc-cap"><LayoutDashboard aria-hidden="true" />Layout</h2>
                <div className="uc-seg uc-onboard-modes" role="radiogroup" aria-label="Feature mode">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'minimal'}
                    onClick={() => chooseMode('minimal')}
                    className={mode === 'minimal' ? 'is-on' : undefined}
                  >
                    Minimal
                    <span className="uc-onboard-mode-note">Just the daily essentials</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'complete'}
                    onClick={() => chooseMode('complete')}
                    className={mode === 'complete' ? 'is-on' : undefined}
                  >
                    Complete
                    <span className="uc-onboard-mode-note">Every UltraCC feature</span>
                  </button>
                </div>
              </div>
            </li>
          </ol>
        </div>

        <p className="uc-first-run-note">
          <ShieldCheck aria-hidden="true" />
          <span>Your credentials stay on this device and are only sent to VTOP when you sign in.</span>
        </p>
      </div>
    </div>
  );
};
