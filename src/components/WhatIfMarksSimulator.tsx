import React, { useState, useMemo, useCallback, useId } from 'react';
import { SlidersHorizontal, Target, Info } from 'lucide-react';
import { CourseMarks } from '../types';
import {
  TARGET_SCORES,
  VIT_BANDS,
  buildCourseModel,
  earnedOf,
  gradeFromVitPercent,
  projectCoursePercent,
  projectedPercentLabel,
  solveTargetFAT,
  hasDeclaredFat,
  fatHostPart,
  publishedWeightLabel,
  impliedFatWeight,
  withAssumedFat,
  type AssessmentRow,
  type GradeLetter,
} from '../utils/gradeModel';

/* ── Styling only ───────────────────────────────────────────────────────────
 * Colours and labels for a grade letter live here because they are this card's
 * look. What a grade *means* — the band a letter starts at, the points it is
 * worth, the FAT score a target demands — comes from `gradeModel`, the same
 * model the Grade Predictor and the Reverse Target simulator read.
 *
 * This card used to keep its own copies of all of it: its own seven bands, its
 * own letter lookup, its own FAT solver. Its solver also graded every
 * not-yet-returned assessment as a zero, so a student mid-semester saw a
 * "Current Total" of 31.2/100 next to the predictor's 72% for the same course,
 * and a target that ignored VIT's 40%-of-FAT minimum. One course, one set of
 * numbers.
 * ──────────────────────────────────────────────────────────────────────── */

const GRADE_COLORS: Record<GradeLetter, string> = {
  S: '#34d399', A: '#60a5fa', B: '#a78bfa', C: '#fbbf24',
  D: '#fb923c', E: '#f87171', F: '#ef4444',
};

/** The letters a student can aim at: every band but a fail. */
const TARGET_BANDS = VIT_BANDS.filter((band) => band.grade !== 'F');

interface WhatIfMarksSimulatorProps {
  marks: CourseMarks[];
  /** VTOP register number — its first two digits decide the theory/lab rule. */
  regNo?: string;
}

export const WhatIfMarksSimulator: React.FC<WhatIfMarksSimulatorProps> = ({ marks, regNo }) => {
  const uid = useId();
  const [selectedCourse, setSelectedCourse] = useState<string>(marks[0]?.courseCode ?? '');
  /** The student's own marks, per VTOP row key, on that row's own paper. */
  const [simMarks, setSimMarks] = useState<Record<string, number>>({});
  const [targetGrade, setTargetGrade] = useState<GradeLetter>('A');
  const [batchPct, setBatchPct] = useState<number | null>(null);
  /** The FAT weight the student pinned for a course VTOP has not weighted. */
  const [assumedFat, setAssumedFat] = useState<number | null>(null);

  const course = useMemo(
    () => marks.find((m) => m.courseCode === selectedCourse),
    [marks, selectedCourse],
  );

  const baseModel = useMemo(() => (course ? buildCourseModel(course, { regNo }) : null), [course, regNo]);
  // VTOP weighted this course's internals but published no FAT row. Without one,
  // the target solver refused every question and the FAT had no slider, which is
  // the exact "simulator is not working" a student mid-semester hits. Take a FAT
  // weight (VIT's published 40% final exam, or what is left of 100) and let the
  // solver answer from it — flagged as an assumption everywhere it is used.
  // One class's scheme, not the sum of an embedded course's two schemes.
  const fatHost = baseModel && !hasDeclaredFat(baseModel) ? fatHostPart(baseModel) : null;
  const fatGap = fatHost ? impliedFatWeight(fatHost.configuredWeight) : null;
  const fatWeight = assumedFat ?? fatGap?.weight ?? 0;
  const model = useMemo(
    () => (baseModel && fatWeight > 0 ? withAssumedFat(baseModel, fatWeight) : baseModel),
    [baseModel, fatWeight],
  );

  /** Theory rows then lab rows, in VTOP's own titles and weightage. */
  const rows: AssessmentRow[] = model
    ? [...(model.parts.theory?.rows ?? []), ...(model.parts.lab?.rows ?? [])]
    : [];

  const resetSim = useCallback(() => {
    setSimMarks({});
    setBatchPct(null);
  }, []);

  /**
   * Fill every assessment VTOP has not graded with one percentage of its own
   * paper. Returned marks are left exactly as VTOP posted them — a "what if the
   * rest goes well" must not silently rewrite the marks a student already has.
   * An assessment VTOP gave no paper size for is stored as the percentage
   * itself, which is the only unit the student can speak in for it.
   */
  const applyBatch = useCallback((pct: number | null) => {
    setBatchPct(pct);
    if (pct === null) {
      setSimMarks({});
      return;
    }
    const next: Record<string, number> = {};
    for (const row of rows) {
      if (row.scored !== null) continue;
      next[row.key] = row.max > 0 ? Math.round((pct / 100) * row.max) : pct;
    }
    setSimMarks(next);
  }, [rows]);

  // The pace the model holds unspoken rows at: the student's own graded marks.
  const pace = model?.gradedPercent ?? null;

  /**
   * What one row's slider sits at, and where that number came from. A row VTOP
   * gave a paper size for is answered in marks out of that size; a row VTOP
   * declared but never sized (a still-unpublished CAT 2, say) is answered as a
   * share of the assessment, because marks against an unknown maximum are a
   * question the student cannot answer.
   */
  const rowState = useCallback((row: AssessmentRow) => {
    const mine = simMarks[row.key];
    const hasMine = typeof mine === 'number';
    if (row.max > 0) {
      if (hasMine) return { value: mine, source: 'what-if' as const, unit: 'mark' as const };
      if (row.scored !== null) return { value: row.scored, source: 'graded' as const, unit: 'mark' as const };
      // Nothing is graded yet, so the model has no pace and shows no total; the
      // slider rests at 0 purely so the student has something to move.
      if (pace === null) return { value: 0, source: 'unset' as const, unit: 'mark' as const };
      return { value: Math.round((pace / 100) * row.max), source: 'pace' as const, unit: 'mark' as const };
    }
    if (hasMine) return { value: mine, source: 'what-if' as const, unit: 'percent' as const };
    if (pace === null) return { value: 0, source: 'unset' as const, unit: 'percent' as const };
    return { value: Math.round(pace), source: 'pace' as const, unit: 'percent' as const };
  }, [simMarks, pace]);

  /** The student's what-ifs, as percentages of each row's own paper. */
  const rowPercents = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of rows) {
      const mine = simMarks[row.key];
      if (typeof mine !== 'number') continue;
      out[row.key] = row.max > 0 ? (mine / row.max) * 100 : mine;
    }
    return out;
  }, [rows, simMarks]);

  const currentPercent = model ? projectCoursePercent(model) : null;
  const simulatedPercent = model ? projectCoursePercent(model, { rowPercents }) : null;
  const currentGrade = gradeFromVitPercent(currentPercent);
  const simulatedGrade = gradeFromVitPercent(simulatedPercent);
  const hasWhatIf = Object.keys(rowPercents).length > 0;
  const delta = currentPercent !== null && simulatedPercent !== null
    ? Math.round((simulatedPercent - currentPercent) * 10) / 10
    : null;

  const gradedWeight = (model?.parts.theory?.gradedWeight ?? 0) + (model?.parts.lab?.gradedWeight ?? 0);
  const pendingCount = rows.filter((r) => r.scored === null).length;

  // The same solver the Reverse Target simulator runs, now fed with this
  // student's own what-ifs: VTOP's weights, the batch's theory/lab rule for an
  // embedded course, ungraded rows at their pace — and VIT's 40%-of-FAT floor.
  const target = model && model.configuredWeight > 0
    ? solveTargetFAT(model, TARGET_SCORES[targetGrade], { rowPercents })
    : null;

  return (
    <div className="space-y-5 pb-12">
      <div className="uc-plate p-6 sm:p-8">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-2.5 acc-soft border acc-border rounded-2xl acc-text">
            <SlidersHorizontal className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Marks Simulator</h3>
            <p className="text-xs text-zinc-500 font-medium">What-if analysis: adjust any assessment and see your projected grade</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <select
            aria-label="Course to simulate"
            value={selectedCourse}
            onChange={(e) => { setSelectedCourse(e.target.value); resetSim(); }}
            className="flex-1 uc-dir-select"
          >
            {marks.map((m) => (
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

        {model && model.configuredWeight <= 0 && (
          <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-2xl p-4 mb-6">
            VTOP has not published the assessment weightage for this course yet, so there is nothing to
            simulate against. Check again once its marks are on the portal.
          </p>
        )}

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 text-center">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Projected now</p>
            <p className="text-3xl font-black font-mono text-zinc-900 mt-1">{projectedPercentLabel(currentPercent)}</p>
            <p className="text-sm text-zinc-500 mt-1">
              {currentGrade ? `= ${currentGrade}` : 'Nothing graded yet'}
            </p>
          </div>
          <div className={`border rounded-2xl p-4 text-center ${simulatedGrade ? (currentGrade === simulatedGrade ? 'bg-emerald-500/10 border-emerald-500/20' : 'acc-soft acc-border') : 'bg-zinc-50 border border-zinc-200'}`}>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">In this what-if</p>
            <p className="text-3xl font-black font-mono acc-text mt-1">{projectedPercentLabel(simulatedPercent)}</p>
            <p className="text-sm acc-text mt-1">
              {simulatedGrade ? `= ${simulatedGrade}` : '…'}
              {delta !== null && delta !== 0 && hasWhatIf
                ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(1)} vs projected now)`
                : ''}
            </p>
          </div>
        </div>

        <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-4 w-4 acc-text" />
            <h4 className="text-sm font-extrabold text-zinc-900">Target Grade Solver</h4>
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span id={`${uid}-target`} className="text-xs text-zinc-500 font-medium">What grade do you want?</span>
            <div className="flex gap-1" role="group" aria-labelledby={`${uid}-target`}>
              {TARGET_BANDS.map((band) => {
                const selected = targetGrade === band.grade;
                return (
                  <button
                    key={band.grade}
                    type="button"
                    onClick={() => setTargetGrade(band.grade)}
                    aria-pressed={selected}
                    aria-label={`Target grade ${band.grade}, from ${band.min} marks${selected ? ' (selected)' : ''}`}
                    className={`w-8 h-8 rounded-lg font-black text-xs border transition cursor-pointer ${
                      selected ? 'text-zinc-900 border-white' : 'bg-zinc-100 text-zinc-500 border-zinc-200 hover:text-zinc-900'
                    }`}
                    style={selected ? { backgroundColor: GRADE_COLORS[band.grade], borderColor: GRADE_COLORS[band.grade] } : undefined}
                  >
                    {band.grade}
                  </button>
                );
              })}
            </div>
          </div>

          {!target ? (
            <p className="text-xs text-zinc-500">
              Pick a course with published marks to solve a target.
            </p>
          ) : target.isUnknown ? (
            <div className="p-4 rounded-xl border bg-zinc-100 border-zinc-200 text-xs text-zinc-500">
              {target.message}
            </div>
          ) : target.isAlreadyAchieved ? (
            <div className="p-4 rounded-xl border bg-emerald-500/10 border-emerald-500/20">
              <p className="text-xs text-zinc-500 mb-2">
                For <span className="font-bold text-zinc-900">{target.targetGrade}</span> (≥{TARGET_SCORES[target.targetGrade]}):
              </p>
              <p className="text-lg font-black font-mono text-emerald-600">Already on track — 0 / {target.fatMax}</p>
              <p className="text-[11px] text-emerald-700 mt-1">
                {target.targetGrade} holds without a single FAT mark at this pace.
              </p>
            </div>
          ) : !target.isAchievable ? (
            <div className="p-4 rounded-xl border bg-rose-500/10 border-rose-500/20">
              <p className="text-xs text-zinc-500 mb-2">
                For <span className="font-bold text-zinc-900">{target.targetGrade}</span> (≥{TARGET_SCORES[target.targetGrade]}):
              </p>
              <p className="text-lg font-black font-mono text-rose-600">Out of reach in the {target.part === 'L' ? 'lab ' : ''}FAT alone</p>
              <p className="text-[11px] text-rose-700 mt-1">
                {target.message} Marks above your pace in the assessments still ungraded are what would move it.
              </p>
            </div>
          ) : (
            <div className={`p-4 rounded-xl border ${target.meetsVITMinimumCutoff ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
              <p className="text-xs text-zinc-500 mb-2">
                For <span className="font-bold text-zinc-900">{target.targetGrade}</span> (≥{TARGET_SCORES[target.targetGrade]}):
              </p>
              <p className={`text-lg font-black font-mono ${target.meetsVITMinimumCutoff ? 'text-emerald-600' : 'text-amber-700'}`}>
                Need {target.requiredRaw} / {target.fatMax} in the {target.part === 'L' ? 'lab ' : ''}FAT
              </p>
              <p className="text-[11px] text-zinc-500 mt-1">
                That is {target.requiredPercent}% of the paper — {
                  target.feasibility === 'miracle' ? 'a near-impossible ask'
                    : target.feasibility === 'tough' ? 'a hard climb'
                      : target.feasibility === 'moderate' ? 'a solid push'
                        : 'comfortably within reach'
                }.
              </p>
              {target.vitFatMinimumRaw !== null && (target.requiredRaw ?? 0) < target.vitFatMinimumRaw && (
                <p className="text-[11px] text-amber-700 mt-1">
                  VIT also requires at least {target.vitFatMinimumRaw} / {target.fatMax} in the FAT to pass this
                  course, so {target.vitFatMinimumRaw} is the real floor for the paper.
                </p>
              )}
            </div>
          )}
        </div>

        {fatGap && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6">
            <label htmlFor={`${uid}-fatweight`} className="block text-[10px] font-extrabold text-amber-700 uppercase tracking-widest mb-1.5">
              FAT weight: <span className="acc-text">{fatWeight}%</span> of the {fatHost?.part === 'L' ? 'lab' : 'theory'} assessment
            </label>
            <input
              id={`${uid}-fatweight`}
              type="range" min={20} max={70} step={5} value={fatWeight}
              onChange={(e) => setAssumedFat(parseInt(e.target.value, 10))}
              className="w-full accent-[var(--acc-500)]"
            />
            <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1.5 leading-relaxed">
              VTOP has not published this course's final-exam weight yet, so the FAT is modelled at {fatWeight}% of the {fatHost?.part === 'L' ? 'lab' : 'theory'} assessment
              {fatGap.derived
                ? ` — what is left of 100 after the ${Math.round(fatHost?.configuredWeight ?? 0)}% of internals VTOP declared for this class.`
                : ' — VIT\u2019s published final exam, marked out of 100.'}
              {' '}Change it if your course differs.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-zinc-500 font-medium">
            Batch-fill the {pendingCount} {pendingCount === 1 ? 'assessment' : 'assessments'} not graded yet:
          </span>
          {[40, 50, 60, 70, 80, 90, 100].map((p) => (
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

        <div className="space-y-3">
          {course && rows.map((row) => {
            const { value, source, unit } = rowState(row);
            const pct = unit === 'percent' ? value : Math.round((value / row.max) * 100);
            const weighted = source === 'graded' ? earnedOf(row) : (pct / 100) * row.weightage;

            return (
              <div key={`${row.part}-${row.key}`} className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-zinc-900 truncate">{row.title}</span>
                    {row.assumed && (
                      <span className="text-[9px] uppercase tracking-wide text-amber-700 border border-amber-500/30 rounded px-1">assumed</span>
                    )}
                    {model?.isEmbedded && (
                      <span className="font-mono text-[9px] uppercase text-zinc-400 border border-zinc-200 rounded px-1">
                        {row.part === 'L' ? 'lab' : 'theory'}
                      </span>
                    )}
                    {row.scored === null
                      ? <span className="text-[10px] text-amber-600 font-bold">Not graded</span>
                      : source === 'what-if'
                        ? <span className="text-[10px] acc-text font-bold">What-if</span>
                        : <span className="text-[10px] text-zinc-400 font-bold">VTOP</span>}
                  </div>
                  <span className="text-xs font-mono text-zinc-500 whitespace-nowrap">
                    {unit === 'percent'
                      ? `${pct}% · ${weighted.toFixed(1)}/${row.weightage} wt`
                      : `${value}/${row.max} (${pct}%) · ${weighted.toFixed(1)}/${row.weightage} wt`}
                  </span>
                </div>
                <input
                  type="range"
                  aria-label={unit === 'percent'
                    ? `${row.title} — share of this assessment`
                    : `${row.title} score, out of ${row.max}`}
                  min={0}
                  max={unit === 'percent' ? 100 : row.max}
                  step={1}
                  value={value}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setSimMarks((prev) => ({ ...prev, [row.key]: v }));
                  }}
                  className="w-full h-1.5 cursor-pointer accent-[color:var(--acc-500)]"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
                  <span>0</span>
                  <span className="font-mono acc-text font-bold">{unit === 'percent' ? `${value}%` : value}</span>
                  <span>{unit === 'percent' ? '100%' : row.max}</span>
                </div>
              </div>
            );
          })}
        </div>

        {model && model.configuredWeight > 0 && (
          <p className="pt-3 text-[11px] text-zinc-500 flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 acc-text shrink-0 mt-px" />
            <span>
              {`Built on ${fatGap ? "VTOP's published weightage plus the assumed FAT" : "VTOP's own weightage"}`}
              {gradedWeight > 0
                ? ` — ${gradedWeight.toFixed(0)} of ${model.configuredWeight.toFixed(0)} weight graded so far (${publishedWeightLabel(model)} published)`
                : ''}
              {pendingCount > 0
                ? `, and the ${pendingCount} assessment${pendingCount === 1 ? '' : 's'} still ungraded ${pendingCount === 1 ? 'is' : 'are'} held at your pace of ${pace === null ? '—' : `${pace.toFixed(0)}%`} rather than counted as a zero.`
                : '.'}
              {model.isEmbedded
                ? ' Theory and lab are blended by their registered credits.'
                : ''}
            </span>
          </p>
        )}
      </div>
    </div>
  );
};
