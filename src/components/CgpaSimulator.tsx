import React, { useMemo, useState } from 'react';
import { CourseMarks } from '../types';
import { Calculator, Target, Trophy, Trash2 } from 'lucide-react';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import { gpaLabel, publishedGpaLabel, requiredGpaLabel, gradePointsOf, VIT_BANDS, GRADE_ORDER, type GradeLetter } from '../utils/gradeModel';

interface CgpaSimulatorProps {
  marks: CourseMarks[];
  /**
   * VTOP's registered credits per course. A course missing from this map has
   * credits VTOP never published (a cache from before credits were captured),
   * so it is left out of the SGPA rather than being weighted as a default 3.
   */
  creditsByCourse: Record<string, number>;
  cumulativeCgpa: number | null;
  cumulativeCreditsEarned: number | null;
}

// What each letter is worth in points, and where each letter starts, comes from
// `gradeModel` — the same table the predictor, the reverse simulator and the
// marks simulator read. This screen used to keep its own copy of both, so the
// bands printed in its footer could outlive a change to the rule above them.
const BAND_LABEL = VIT_BANDS
  .filter((band) => band.grade !== 'F')
  .map((band) => `${band.grade}≥${band.min}`)
  .join(', ');

const GRADE_COLORS: Record<string, string> = {
  S: '#10b981',
  A: '#3b82f6',
  B: '#8b5cf6',
  C: '#f59e0b',
  D: '#f97316',
  E: '#ef4444',
  F: '#6b7280',
};


export const CgpaSimulator: React.FC<CgpaSimulatorProps> = ({
  marks,
  creditsByCourse,
  cumulativeCgpa,
  cumulativeCreditsEarned,
}) => {
  const [cgpaHidden] = useCgpaPrivacy();
  const [courseGrades, setCourseGrades] = useState<Record<string, GradeLetter>>(() => {
    const init: Record<string, GradeLetter> = {};
    marks.forEach((m) => {
      init[m.courseCode] = 'A';
    });
    return init;
  });

  const [targetCgpa, setTargetCgpa] = useState<string>('');
  const [savedGoal, setSavedGoal] = useState<{ target: number; requiredSgpa: number } | null>(() => {
    try {
      const saved = localStorage.getItem('ultracc_cgpa_goal');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const setGrade = (courseCode: string, grade: GradeLetter) => {
    setCourseGrades((prev) => ({ ...prev, [courseCode]: grade }));
  };

  const { totalCreditsThisSem, totalPointsThisSem, predictedSgpa, coursesWithoutCredits } = useMemo(() => {
    let totalCreds = 0;
    let totalPts = 0;
    let missing = 0;

    marks.forEach((m) => {
      const creds = creditsByCourse[m.courseCode];
      const grade = courseGrades[m.courseCode] || 'A';
      const point = gradePointsOf(grade);
      if (!(creds && creds > 0)) { missing += 1; return; }
      totalCreds += creds;
      totalPts += creds * point;
    });

    const sgpa = totalCreds > 0 ? totalPts / totalCreds : 0;
    return {
      totalCreditsThisSem: totalCreds,
      totalPointsThisSem: totalPts,
      predictedSgpa: sgpa,
      coursesWithoutCredits: missing,
    };
  }, [marks, creditsByCourse, courseGrades]);

  const currentCgpa = cumulativeCgpa ?? 0;
  const creditsEarned = cumulativeCreditsEarned ?? 0;

  const predictedCgpa = useMemo(() => {
    const totalOldPoints = currentCgpa * creditsEarned;
    const totalNewPoints = totalOldPoints + totalPointsThisSem;
    const totalNewCredits = creditsEarned + totalCreditsThisSem;
    return totalNewCredits > 0 ? totalNewPoints / totalNewCredits : predictedSgpa;
  }, [currentCgpa, creditsEarned, totalPointsThisSem, totalCreditsThisSem, predictedSgpa]);

  const targetCgpaNum = parseFloat(targetCgpa) || 0;
  const requiredSgpa = useMemo(() => {
    if (!targetCgpaNum || targetCgpaNum <= 0) return 0;
    const totalNewCredits = creditsEarned + totalCreditsThisSem;
    const targetTotalPoints = targetCgpaNum * totalNewCredits;
    const currentPoints = currentCgpa * creditsEarned;
    const neededPoints = targetTotalPoints - currentPoints;
    return totalCreditsThisSem > 0 ? neededPoints / totalCreditsThisSem : 0;
  }, [targetCgpaNum, creditsEarned, totalCreditsThisSem, currentCgpa]);

  // A target below the current CGPA asks for no SGPA at all: the points it
  // needs come out negative. That is "already achieved", not "impossible".
  const alreadyAtTarget = targetCgpaNum > 0 && requiredSgpa < 0;
  const isTargetPossible = requiredSgpa <= 10 && (alreadyAtTarget || requiredSgpa >= 0);

  const saveGoal = () => {
    if (targetCgpaNum > 0 && isTargetPossible) {
      const goal = { target: targetCgpaNum, requiredSgpa };
      setSavedGoal(goal);
      localStorage.setItem('ultracc_cgpa_goal', JSON.stringify(goal));
    }
  };

  const clearGoal = () => {
    setSavedGoal(null);
    localStorage.removeItem('ultracc_cgpa_goal');
  };

  if (!marks.length) return null;

  return (
    <div className="mt-6 uc-plate p-6 sm:p-8">
      <div className="flex items-center space-x-3 mb-6">
        <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-600">
          <Calculator className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Interactive CGPA Simulator & Goal Planner</h3>
          <p className="text-xs text-zinc-500 font-medium">Predict your SGPA/CGPA and calculate targets for this semester</p>
        </div>
      </div>

      {savedGoal && (
        <div className="p-4 acc-soft border acc-border rounded-2xl flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl acc-text">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] acc-text uppercase tracking-wider font-extrabold">Current Goal</p>
              <p className="text-lg font-black text-zinc-900">{gpaLabel(savedGoal.target)} CGPA</p>
              <p className="text-xs acc-text">{savedGoal.requiredSgpa < 0 ? 'Already met — your current CGPA covers it' : <>Requires <strong className="text-zinc-900">{requiredGpaLabel(savedGoal.requiredSgpa)}</strong> SGPA this semester</>}</p>
            </div>
          </div>
          <button onClick={clearGoal} aria-label="Clear target CGPA" className="grid place-items-center min-h-[44px] min-w-[44px] rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-white/10 transition cursor-pointer">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Current CGPA', value: cgpaHidden ? '••••' : publishedGpaLabel(currentCgpa), color: 'acc-text' },
          { label: 'Credits Earned', value: String(creditsEarned), color: 'text-zinc-900' },
          { label: 'Predicted SGPA', value: gpaLabel(predictedSgpa), color: 'acc-text' },
          { label: 'Predicted CGPA', value: gpaLabel(predictedCgpa), color: 'text-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="p-3 bg-zinc-50 border border-zinc-200 rounded-2xl">
            <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-black font-mono mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Target className="h-5 w-5 acc-text" />
          <h4 className="text-sm font-extrabold text-zinc-900">1. Set Target CGPA</h4>
        </div>
        <div className="flex gap-3">
          <input
            type="number"
            aria-label="Target CGPA"
            step="0.01"
            min="0"
            max="10"
            value={targetCgpa}
            onChange={(e) => setTargetCgpa(e.target.value)}
            placeholder="e.g. 9.00"
            className="flex-1 uc-dir-input uc-num"
          />
          <button
            onClick={saveGoal}
            disabled={!targetCgpa || !isTargetPossible}
            className="px-4 py-2.5 acc-bg disabled:opacity-40 rounded-xl font-bold text-sm transition cursor-pointer"
          >
            Save
          </button>
        </div>
        {targetCgpaNum > 0 && (
          <div className={`mt-3 p-3 rounded-xl border ${isTargetPossible ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
            <p className="text-xs text-zinc-500">{alreadyAtTarget ? 'Your current CGPA already meets this target' : 'Required SGPA this semester'}</p>
            <p className={`text-2xl font-black ${isTargetPossible ? 'text-emerald-600' : 'text-rose-600'}`}>
              {alreadyAtTarget ? '0.00' : isTargetPossible ? requiredGpaLabel(requiredSgpa) : 'Impossible (> 10.0)'}
            </p>
          </div>
        )}
      </div>

      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Calculator className="h-5 w-5 acc-text" />
          <h4 className="text-sm font-extrabold text-zinc-900">2. Expected Semester Grades</h4>
        </div>

        <div className="flex items-center justify-between p-4 bg-white rounded-xl mb-4">
          <div className="text-center flex-1">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Predicted SGPA</p>
            <p className="text-2xl font-black acc-text font-mono">{gpaLabel(predictedSgpa)}</p>
          </div>
          <span className="text-zinc-600 text-lg mx-2">→</span>
          <div className="text-center flex-1">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">New CGPA</p>
            <p className="text-2xl font-black text-emerald-600 font-mono">{gpaLabel(predictedCgpa)}</p>
          </div>
        </div>

        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {marks.map((m) => {
            const credits = creditsByCourse[m.courseCode];
            const grade = courseGrades[m.courseCode] || 'A';
            const point = gradePointsOf(grade);

            return (
              <div key={m.courseCode} className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl hover:border-zinc-200 transition">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-900">{m.courseCode} · <span className="text-zinc-500 font-normal text-xs">{m.courseTitle}</span></p>
                    <p className="text-[11px] text-zinc-500 font-mono">
                      {credits > 0 ? `${credits} CR` : '— CR · re-sync for credits'}
                      {' · '}
                      <span style={{ color: GRADE_COLORS[grade] }} className="font-bold">{grade}</span> ({point} pts)
                    </p>
                  </div>
                </div>
                {/* 7 grade buttons in one row squeezed to ~18px at 320px and gave
                    a screen reader nothing but the letter. They now wrap onto two
                    lines, stay at least 40px wide/44px tall, and announce the
                    course plus the selected state. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {GRADE_ORDER.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGrade(m.courseCode, g)}
                      aria-pressed={grade === g}
                      aria-label={`Grade ${g} for ${m.courseCode}${grade === g ? ' (selected)' : ''}`}
                      className={`flex-1 min-w-[40px] min-h-[44px] py-2 rounded-lg text-[12px] font-black transition-all cursor-pointer ${
                        grade === g
                          ? 'text-zinc-900 shadow-lg'
                          : 'bg-zinc-100 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200'
                      }`}
                      style={grade === g ? { backgroundColor: GRADE_COLORS[g] } : undefined}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {coursesWithoutCredits > 0 && (
        <p className="text-[11px] text-amber-700 mb-4 leading-relaxed">
          {coursesWithoutCredits} {coursesWithoutCredits === 1 ? 'course has' : 'courses have'} no credit data in the synced
          VTOP record, so {coursesWithoutCredits === 1 ? 'it is' : 'they are'} excluded from this SGPA rather than being
          assumed to be worth 3 credits. Sync VTOP again to pull the registered credits in.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl text-center">
          <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-wider">Predicted SGPA</p>
          <p className="text-3xl font-black acc-text font-mono mt-1">{gpaLabel(predictedSgpa)}</p>
        </div>
        <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl text-center">
          <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-wider">Predicted CGPA</p>
          <p className="text-3xl font-black text-emerald-600 font-mono mt-1">{gpaLabel(predictedCgpa)}</p>
        </div>
        <div className={`p-4 border rounded-2xl text-center ${targetCgpaNum > 0 && !isTargetPossible ? 'bg-rose-500/10 border-rose-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
          <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-wider">Required SGPA</p>
          <p className={`text-3xl font-black font-mono mt-1 ${targetCgpaNum > 0 && !isTargetPossible ? 'text-rose-600' : 'text-emerald-600'}`}>
            {targetCgpaNum > 0 ? (isTargetPossible ? requiredGpaLabel(Math.max(0, requiredSgpa)) : 'N/A') : '—'}
          </p>
        </div>
      </div>

      <p className="text-[10px] text-zinc-600 mt-4 leading-relaxed">
        Grade bands: {BAND_LABEL}. VIT grades relatively in practice, so treat these as a planning aid.
      </p>
    </div>
  );
};
