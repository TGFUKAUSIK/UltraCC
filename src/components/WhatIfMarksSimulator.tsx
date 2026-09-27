import React, { useState, useMemo, useCallback } from 'react';
import { Sparkles, Target } from 'lucide-react';
import { CourseMarks } from '../types';
import { resolveMarkingScheme } from '../utils/markingSchemes';

/* ── Constants ────────────────────────────────────────────────────────────── */

const GRADE_COLORS: Record<string, string> = {
  S: '#34d399', A: '#60a5fa', B: '#a78bfa', C: '#fbbf24',
  D: '#fb923c', E: '#f87171', F: '#ef4444',
};

const GRADE_BANDS = [
  { grade: 'S', min: 90, color: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  { grade: 'A', min: 80, color: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  { grade: 'B', min: 70, color: 'bg-indigo-500/15 text-indigo-600 border-indigo-500/30' },
  { grade: 'C', min: 60, color: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  { grade: 'D', min: 50, color: 'bg-orange-500/15 text-orange-600 border-orange-500/30' },
  { grade: 'E', min: 40, color: 'bg-rose-500/15 text-rose-600 border-rose-500/30' },
  { grade: 'F', min: 0, color: 'bg-red-500/15 text-red-600 border-red-500/30' },
];

/* ── Helper: derive grade from total marks ────────────────────────────────── */

function gradeFromTotal(total: number): string {
  for (const b of GRADE_BANDS) {
    if (total >= b.min) return b.grade;
  }
  return 'F';
}

/* ── Main Component ───────────────────────────────────────────────────────── */

interface WhatIfMarksSimulatorProps {
  marks: CourseMarks[];
}

export const WhatIfMarksSimulator: React.FC<WhatIfMarksSimulatorProps> = ({ marks }) => {
  const [selectedCourse, setSelectedCourse] = useState<string>(marks[0]?.courseCode ?? '');
  const [simValues, setSimValues] = useState<Record<string, number>>({});
  const [targetGrade, setTargetGrade] = useState<string>('A');
  const [batchPct, setBatchPct] = useState<number | null>(null);

  const course = useMemo(() => marks.find(m => m.courseCode === selectedCourse), [marks, selectedCourse]);

  const resetSim = useCallback(() => {
    setSimValues({});
    setBatchPct(null);
  }, []);

  const applyBatch = useCallback((pct: number | null) => {
    setBatchPct(pct);
    if (pct === null) {
      setSimValues({});
      return;
    }
    const next: Record<string, number> = {};
    const components = getComponents(course);
    for (const c of components) {
      if (c.max > 0) next[c.key] = Math.round((pct / 100) * c.max);
    }
    setSimValues(next);
  }, [course]);

  const allComponents = useMemo(() => {
    if (!course) return [];
    return getComponents(course);
  }, [course]);

  // The un-simulated weighted total — the same sum `simulatedTotal` uses, but
  // with every component at its actual scored mark. It is the honest "where
  // the course stands on VTOP's own weightage" number, on the same /100 scale
  // as the grade bands and the Simulated column. The old value here was
  // `totalInternalWeightScored` (internals only, ~/50) — grading that against
  // the /100 bands read every student as an F while the Simulated column,
  // computed on the full weightage, said otherwise.
  const currentTotal = useMemo(() => {
    if (!course) return null;
    let total = 0;
    for (const c of allComponents) {
      if (c.max > 0) total += (c.scored / c.max) * c.weightage;
    }
    return Math.round(total * 100) / 100;
  }, [course, allComponents]);

  const currentGrade = currentTotal !== null ? gradeFromTotal(currentTotal) : '';

  const simulatedTotal = useMemo(() => {
    if (!course) return null;
    let total = 0;
    for (const c of allComponents) {
      const sim = simValues[c.key] ?? (batchPct !== null ? Math.round((batchPct / 100) * c.max) : c.scored);
      if (c.max > 0) total += (sim / c.max) * c.weightage;
    }
    return Math.round(total * 100) / 100;
  }, [course, allComponents, simValues, batchPct]);

  const simulatedGrade = simulatedTotal !== null ? gradeFromTotal(simulatedTotal) : '';

  const fatScoreForGrade = useMemo(() => {
    // A FAT row VTOP has not weighted (or not declared) has no denominator to
    // solve against; dividing by its 0 weightage produced "need Infinity/…".
    if (!course || !(course.fat?.weightage > 0) || !(course.fat?.max > 0)) return null;
    const targetMin = GRADE_BANDS.find(b => b.grade === targetGrade)?.min ?? 80;
    const otherWeight = allComponents.filter(c => c.key !== 'fat').reduce((s, c) => {
      const sim = simValues[c.key] ?? (batchPct !== null ? Math.round((batchPct / 100) * c.max) : c.scored);
      return s + ((sim / c.max) * c.weightage);
    }, 0);
    const fatWeight = course.fat.weightage;
    const neededFromFat = Math.max(0, targetMin - otherWeight);
    const fatRaw = Math.ceil((neededFromFat / fatWeight) * course.fat.max);
    return { neededFromFat, fatRaw, maxFat: course.fat.max, achievable: fatRaw <= course.fat.max };
  }, [course, allComponents, simValues, batchPct, targetGrade]);

  return (
    <div className="space-y-5 pb-12">
      {/* Header */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-2.5 bg-violet-500/10 border border-violet-500/20 rounded-2xl text-violet-600">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Marks Simulator</h3>
            <p className="text-xs text-zinc-500 font-medium">What-if analysis: adjust any component and see your projected grade</p>
          </div>
        </div>

        {/* Course selector */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <select
            aria-label="Course to simulate"
            value={selectedCourse}
            onChange={(e) => { setSelectedCourse(e.target.value); resetSim(); }}
            className="flex-1 bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-sm text-zinc-900 font-mono focus:border-blue-500 focus:outline-none"
          >
            {marks.map(m => (
              <option key={m.courseCode} value={m.courseCode}>
                {m.courseCode}: {m.courseTitle}
              </option>
            ))}
          </select>
          <button
            onClick={resetSim}
            className="px-4 py-2.5 bg-zinc-100 text-zinc-500 rounded-xl text-sm font-bold hover:text-zinc-900 transition cursor-pointer border border-zinc-200"
          >
            Reset
          </button>
        </div>

        {/* Current vs Simulated */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 text-center">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Current Total</p>
            <p className="text-3xl font-black font-mono text-zinc-900 mt-1">{currentTotal !== null ? currentTotal.toFixed(1) : '—'}</p>
            <p className="text-sm text-zinc-500 mt-1">{currentGrade || ''}</p>
          </div>
          <div className={`border rounded-2xl p-4 text-center ${simulatedGrade ? (currentGrade === simulatedGrade ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-blue-500/10 border-blue-500/20') : 'bg-zinc-50 border border-zinc-200'}`}>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Simulated</p>
            <p className="text-3xl font-black font-mono text-blue-600 mt-1">{simulatedTotal !== null ? simulatedTotal.toFixed(1) : '—'}</p>
            <p className="text-sm text-blue-700 mt-1">={simulatedGrade || '…'}</p>
          </div>
        </div>

        {/* Target Grade Solver */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-4 w-4 text-blue-600" />
            <h4 className="text-sm font-extrabold text-zinc-900">Target Grade Solver</h4>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs text-zinc-500 font-medium">What grade do you want?</span>
            <div className="flex gap-1">
              {GRADE_BANDS.slice(0, 6).map(b => (
                <button
                  key={b.grade}
                  onClick={() => setTargetGrade(b.grade)}
                  className={`w-8 h-8 rounded-lg font-black text-xs border transition cursor-pointer ${
                    targetGrade === b.grade ? 'text-zinc-900 border-white' : 'bg-zinc-100 text-zinc-500 border-zinc-200 hover:text-zinc-900'
                  }`}
                  style={targetGrade === b.grade ? { backgroundColor: GRADE_COLORS[b.grade], borderColor: GRADE_COLORS[b.grade] } : undefined}
                >
                  {b.grade}
                </button>
              ))}
            </div>
          </div>

          {fatScoreForGrade && (
            <div className={`p-4 rounded-xl border ${fatScoreForGrade.achievable ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
              <p className="text-xs text-zinc-500 mb-2">
                To get <span className="font-bold text-zinc-900">{targetGrade}</span> (≥{GRADE_BANDS.find(b => b.grade === targetGrade)?.min} marks):
              </p>
              {fatScoreForGrade.achievable ? (
                <p className="text-lg font-black font-mono text-emerald-600">Need {fatScoreForGrade.fatRaw} / {fatScoreForGrade.maxFat} in FAT</p>
              ) : (
                <p className="text-lg font-black font-mono text-rose-600">Impossible — need {fatScoreForGrade.fatRaw} but max is {fatScoreForGrade.maxFat}</p>
              )}
            </div>
          )}
        </div>

        {/* Batch simulate quick buttons */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-zinc-500 font-medium">Batch simulate pending:</span>
          {[40, 50, 60, 70, 80, 90, 100].map(p => (
            <button
              key={p}
              onClick={() => applyBatch(p)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                batchPct === p ? 'acc-bg text-zinc-900 border-transparent' : 'bg-zinc-100 text-zinc-500 border-zinc-200 hover:text-zinc-900'
              }`}
            >
              {p}%
            </button>
          ))}
          <button
            onClick={() => applyBatch(null)}
            className="px-2.5 py-1 rounded-lg text-xs font-bold bg-zinc-100 text-zinc-500 border border-zinc-200 hover:text-zinc-900 transition cursor-pointer"
          >
            Clear
          </button>
        </div>

        {/* Component sliders */}
        <div className="space-y-3">
          {course && allComponents.map(c => {
            const simVal = simValues[c.key] ?? (batchPct !== null ? Math.round((batchPct / 100) * c.max) : c.scored);
            const pct = c.max > 0 ? Math.round((simVal / c.max) * 100) : 0;
            const isPending = c.status === 'Pending';

            return (
              <div key={c.key} className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-zinc-900">{c.title}</span>
                    {isPending && <span className="text-[10px] text-amber-600 font-bold">Pending</span>}
                  </div>
                  <span className="text-xs font-mono text-zinc-500">
                    {simVal}/{c.max} ({pct}%) · {c.weightage}% weight
                  </span>
                </div>
                <input
                  type="range"
                  aria-label={`${c.title} score`}
                  min={0}
                  max={c.max}
                  step={1}
                  value={simVal}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setSimValues(prev => ({ ...prev, [c.key]: v }));
                  }}
                  className="w-full h-1.5 cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
                  <span>0</span>
                  <span className="font-mono text-blue-600 font-bold">{simVal}</span>
                  <span>{c.max}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ── Helper: get all assessment components from a course ─────────────────── */

function getComponents(course: CourseMarks | undefined): { key: string; title: string; scored: number; max: number; weightage: number; status: string }[] {
  if (!course) return [];
  const list: { key: string; title: string; scored: number; max: number; weightage: number; status: string }[] = [];
  const add = (key: string, title: string, c: { scored?: number; max: number; weightage: number; status?: string } | undefined) => {
    if (c && c.max > 0) {
      list.push({
        key,
        title,
        scored: typeof c.scored === 'number' ? c.scored : 0,
        max: c.max,
        weightage: c.weightage,
        status: c.status || (typeof c.scored === 'number' ? 'Evaluated' : 'Pending'),
      });
    }
  };
  // Curriculum-aware: lab-only courses evaluate Experiments + Lab FAT (no
  // CAT/DA/Quiz rows), so their extra components come FIRST as the real
  // internals. Theory keeps the standard component order.
  const scheme = resolveMarkingScheme(course);
  if (scheme.kind === 'lab' || scheme.kind === 'softskill' || scheme.kind === 'project') {
    if (course.extraComponents) {
      for (const ec of course.extraComponents) {
        if (ec.max > 0) add(`extra_${ec.title}`, ec.title, ec);
      }
    }
    if (course.fat) add('fat', scheme.kind === 'project' ? 'Project FAT' : 'Lab FAT', course.fat);
    return list;
  }
  if (course.cat1) add('cat1', 'CAT 1', course.cat1);
  if (course.cat2) add('cat2', 'CAT 2', course.cat2);
  if (course.da1) add('da1', 'DA 1', course.da1);
  if (course.da2) add('da2', 'DA 2', course.da2);
  if (course.da3) add('da3', 'DA 3', course.da3);
  if (course.quiz) add('quiz', 'Quiz', course.quiz);
  if (course.fat) add('fat', 'FAT', course.fat);
  // An embedded course is assessed twice over: VTOP serves a theory FAT and a
  // separate lab FAT row. Showing only one made the lab's weight invisible.
  if (course.labFat) add('labfat', 'Lab FAT', course.labFat);
  if (course.extraComponents) {
    for (const ec of course.extraComponents) {
      if (ec.max > 0) add(`extra_${ec.title}`, ec.title, ec);
    }
  }
  return list;
}
