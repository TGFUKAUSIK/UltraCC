import React, { useId, useMemo, useState } from 'react';
import { TrendingUp, BarChart3, ShieldCheck } from 'lucide-react';
import { CourseMarks } from '../types';
import { buildCourseModel, projectCoursePercent, gradeFromVitPercent } from '../utils/gradeModel';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/communityBackend';

/**
 * Relative Grade Predictor (Part 4).
 *
 * Model: community-derived approximation of VIT's relative grading curve,
 * NOT VIT's official algorithm. Default cutoffs (unofficial estimate):
 *   S ≥ μ+1.5σ · A: μ+1σ..1.5σ · B: μ+0.5σ..1σ · C: μ−0.5σ..+0.5σ
 *   D: μ−1σ..−0.5σ · E: μ−1.5σ..−1σ · F below μ−1.5σ
 *
 * When a course has >=15 anonymous grade_submissions, empirical μ/σ replace
 * the defaults (fetched from the compute_grade_stats edge function, cached
 * in IndexedDB for 7 days).
 *
 * Privacy: submissions send ONLY { courseId, totalMarks, finalGrade } — no
 * student identifiers, no auth linkage (hard requirement).
 */

export type LetterGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

const GRADE_ORDER: LetterGrade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

const GRADE_COLORS: Record<LetterGrade, string> = {
  S: 'text-emerald-700 bg-emerald-500/15 border-emerald-500/30',
  A: 'text-blue-700 bg-blue-500/15 border-blue-500/30',
  B: 'text-teal-700 bg-teal-500/15 border-teal-500/30',
  C: 'text-amber-700 bg-amber-500/15 border-amber-500/30',
  D: 'text-orange-700 bg-orange-500/15 border-orange-500/30',
  E: 'text-rose-700 bg-rose-500/15 border-rose-500/30',
  F: 'text-rose-600 bg-rose-500/20 border-rose-500/40',
};

/** Normal CDF (Abramowitz–Stegun approximation). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

export function gradeFromScore(score: number, mu: number, sigma: number): LetterGrade {
  const z = (score - mu) / sigma;
  if (z >= 1.5) return 'S';
  if (z >= 1.0) return 'A';
  if (z >= 0.5) return 'B';
  if (z >= -0.5) return 'C';
  if (z >= -1.0) return 'D';
  if (z >= -1.5) return 'E';
  return 'F';
}

/**
 * Grade probability via normal CDF.
 *
 * Model: the student's projected total has uncertainty (the FAT score is
 * hypothetical), modeled as N(score, sigma). Each grade band is a range of
 * z-scores vs the class mean: S ≥ μ+1.5σ, A: +1σ..+1.5σ, etc. So
 *   P(S) = P(total ≥ μ + 1.5σ) = 1 − Φ((μ + 1.5σ − score) / σ)
 *   P(A) = P(μ+1σ ≤ total < μ+1.5σ), … and F below μ−1.5σ.
 */
export function gradeProbabilities(score: number, mu: number, sigma: number): Record<LetterGrade, number> {
  if (sigma <= 0) {
    const g = gradeFromScore(score, mu, sigma);
    const out = {} as Record<LetterGrade, number>;
    for (const x of GRADE_ORDER) out[x] = x === g ? 1 : 0;
    return out;
  }
  const above = (zBoundary: number) => 1 - normCdf((mu + zBoundary * sigma - score) / sigma);
  const below = (zBoundary: number) => normCdf((mu + zBoundary * sigma - score) / sigma);
  const out: Record<LetterGrade, number> = {
    S: above(1.5),
    A: above(1.0) - above(1.5),
    B: above(0.5) - above(1.0),
    C: above(-0.5) - above(0.5),
    D: above(-1.0) - above(-0.5),
    E: above(-1.5) - above(-1.0),
    F: below(-1.5),
  };
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum > 0) for (const g of GRADE_ORDER) out[g] = out[g] / sum;
  return out;
}

/** Deterministic PRNG (mulberry32) so Monte Carlo is reproducible per seed. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Projected course percentage (0–100 of the weightage VTOP has declared).
 *
 * Every input is VTOP's own: each row contributes its declared Weightage %
 * (its Weightage Mark when VTOP published one), theory and lab classes are
 * blended by their registered credits, and a row VTOP has not graded is
 * projected at the student's current pace instead of being counted as a zero.
 * Nothing reserves marks for attendance that VTOP never published, and nothing
 * imposes a 50/40/10 regulation split on a course that weights differently.
 */
export function projectedTotal(m: CourseMarks, fatScore: number): number {
  const percent = projectCoursePercent(buildCourseModel(m), {
    fatPercent: Math.min(100, Math.max(0, fatScore)),
  });
  return Math.min(100, Math.max(0, percent ?? 0));
}

// ---------------------------------------------------------------------------
// Empirical stats cache (IndexedDB, 7-day TTL)
// ---------------------------------------------------------------------------

interface EmpiricalStats {
  courseId: string;
  count: number;
  mu: number;
  sigma: number;
  fetchedAt: number;
}

const STATS_KEY = (courseId: string) => `gradeStats:${courseId}`;

async function getCachedEmpiricalStats(courseId: string): Promise<EmpiricalStats | null> {
  try {
    const raw = localStorage.getItem(STATS_KEY(courseId));
    if (!raw) return null;
    const s = JSON.parse(raw) as EmpiricalStats;
    if (Date.now() - s.fetchedAt > 7 * 24 * 3600 * 1000) return null;
    return s;
  } catch { return null; }
}

async function fetchEmpiricalStats(courseId: string): Promise<EmpiricalStats | null> {
  try {
    const url = `${SUPABASE_URL}/functions/v1/compute_grade_stats?courseId=${encodeURIComponent(courseId)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.count || data.count < 15 || data.mu == null || data.sigma == null) return null;
    const stats: EmpiricalStats = { courseId, count: data.count, mu: data.mu, sigma: data.sigma, fetchedAt: Date.now() };
    try { localStorage.setItem(STATS_KEY(courseId), JSON.stringify(stats)); } catch { /* ignore */ }
    return stats;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GradePredictorProps {
  marks: CourseMarks[];
}

export const GradePredictor: React.FC<GradePredictorProps> = ({ marks }) => {
  // Stable, collision-free ids so every control here is programmatically
  // associated with its visible label (screen readers announce "Course,
  // combobox" instead of an unnamed select).
  const uid = useId();
  const courseFieldId = `${uid}-course`;
  const fatFieldId = `${uid}-fat`;
  const muFieldId = `${uid}-mu`;
  const sigmaFieldId = `${uid}-sigma`;
  const [selectedCode, setSelectedCode] = useState<string>(marks[0]?.courseCode || '');
  const [fatScore, setFatScore] = useState(60);
  const [mu, setMu] = useState(58);
  const [sigma, setSigma] = useState(12);
  const [empirical, setEmpirical] = useState<EmpiricalStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const course = marks.find((m) => m.courseCode === selectedCode) || marks[0];

  // Load empirical stats for the selected course when >=15 submissions exist.
  React.useEffect(() => {
    if (!course) return;
    let cancelled = false;
    setLoadingStats(true);
    getCachedEmpiricalStats(course.courseCode).then((cached) => {
      if (cancelled) return;
      if (cached) { setEmpirical(cached); setLoadingStats(false); return; }
      fetchEmpiricalStats(course.courseCode).then((s) => {
        if (!cancelled) { setEmpirical(s); setLoadingStats(false); }
      });
    });
    return () => { cancelled = true; };
  }, [course?.courseCode]);

  const effectiveMu = empirical?.mu ?? mu;
  const effectiveSigma = empirical?.sigma ?? sigma;

  const model = useMemo(() => (course ? buildCourseModel(course) : null), [course]);
  const total = model
    ? Math.min(100, Math.max(0, projectCoursePercent(model, { fatPercent: fatScore }) ?? 0))
    : 0;
  // Rows VTOP declared but has not graded. The projection holds them at the
  // student's own pace, so name what is missing rather than letting one number
  // imply the whole course is already known. FAT rows are excluded because the
  // slider above is the user's own assumption about that paper.
  const ungradedInternals: string[] = model
    ? model.pendingTitles.filter((t) => !/\bFAT\b/i.test(t))
    : [];
  const probs = useMemo(() => gradeProbabilities(total, effectiveMu, effectiveSigma), [total, effectiveMu, effectiveSigma]);
  const projectedGrade = gradeFromScore(total, effectiveMu, effectiveSigma);
  // VIT's published absolute bands, applied to the same score — the honest
  // counterpart to the community curve above.
  const vitGrade = gradeFromVitPercent(total);

  // Monte Carlo: 1000 FAT outcomes around the user's expected score.
  const monteCarlo = useMemo(() => {
    if (!course || !model) return null;
    const rand = mulberry32(course.courseCode.split('').reduce((a, c) => a + c.charCodeAt(0), 7));
    const counts: Record<LetterGrade, number> = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
    for (let i = 0; i < 1000; i++) {
      const sample = fatScore + randn(rand) * 8; // ±8-point spread around expected
      const projected = projectCoursePercent(model, { fatPercent: sample }) ?? 0;
      const g = gradeFromScore(Math.min(100, Math.max(0, projected)), effectiveMu, effectiveSigma);
      counts[g] += 1;
    }
    const out = {} as Record<LetterGrade, number>;
    for (const g of GRADE_ORDER) out[g] = counts[g] / 1000;
    return out;
  }, [course, model, fatScore, effectiveMu, effectiveSigma]);

  if (!course) {
    return (
      <div className="p-6 rounded-2xl bg-zinc-50 border border-zinc-200 text-center text-sm text-zinc-500">
        Sync marks first to use the grade predictor.
      </div>
    );
  }

  const handleSubmit = async () => {
    try {
      // Anonymous submission — NO identifiers, NO auth linkage (hard rule).
      const url = `${SUPABASE_URL}/rest/v1/grade_predictions`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ course_id: course.courseCode, total_marks: Math.round(total), final_grade: projectedGrade }),
      });
      setSubmitted(true);
      setShowConsent(false);
      // Invalidate cache so a re-fetch can pick up the new submission.
      try { localStorage.removeItem(STATS_KEY(course.courseCode)); } catch { /* ignore */ }
    } catch {
      setSubmitted(false);
      setShowConsent(false);
      alert('Submission failed — check your connection and try again.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center space-x-3">
        <div className="p-2.5 bg-violet-500/10 border border-violet-500/20 rounded-2xl text-violet-600">
          <TrendingUp className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-base font-bold text-zinc-900">Relative Grade Predictor</h4>
          <p className="text-[11px] text-zinc-500">
            Community model — <span className="text-amber-700 font-semibold">not VIT's official algorithm</span>.
          </p>
        </div>
      </div>

      {/* Course + FAT score */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor={courseFieldId} className="block text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-1.5">Course</label>
          <select
            id={courseFieldId}
            value={course.courseCode}
            onChange={(e) => { setSelectedCode(e.target.value); setSubmitted(false); }}
            className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-xs text-zinc-900 focus:border-violet-500 focus:outline-none"
          >
            {marks.map((m) => <option key={m.courseCode} value={m.courseCode}>{m.courseCode}: {m.courseTitle}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={fatFieldId} className="block text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-1.5">
            Hypothetical FAT score: <span className="text-violet-700">{fatScore}/100</span>
          </label>
          <input
            id={fatFieldId}
            type="range" min={0} max={100} value={fatScore}
            onChange={(e) => setFatScore(parseInt(e.target.value, 10))}
            className="w-full accent-violet-500"
          />
        </div>
      </div>

      {/* μ/σ controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor={muFieldId} className="block text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-1.5">
            Assumed mean (μ): <span className="text-violet-700">{effectiveMu}</span>
            {empirical ? ` (from ${empirical.count} submissions)` : ' (default estimate)'}
          </label>
          <input id={muFieldId} type="range" min={30} max={90} value={effectiveMu} disabled={!!empirical}
            onChange={(e) => setMu(parseInt(e.target.value, 10))}
            className="w-full accent-violet-500 disabled:opacity-40" />
        </div>
        <div>
          <label htmlFor={sigmaFieldId} className="block text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-1.5">
            Assumed std dev (σ): <span className="text-violet-700">{effectiveSigma}</span>
            {empirical ? ' (empirical)' : ' (default estimate)'}
          </label>
          <input id={sigmaFieldId} type="range" min={4} max={25} value={effectiveSigma} disabled={!!empirical}
            onChange={(e) => setSigma(parseInt(e.target.value, 10))}
            className="w-full accent-violet-500 disabled:opacity-40" />
        </div>
      </div>

      {empirical && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Based on {empirical.count} anonymous real submissions (μ={empirical.mu.toFixed(1)}, σ={empirical.sigma.toFixed(1)}).
        </div>
      )}
      {loadingStats && <p className="text-[10px] text-zinc-500">Checking for community grade data…</p>}

      {/* Projected total + grade */}
      <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest">Projected total</p>
            <p className="text-2xl font-black text-zinc-900 mt-0.5">{total.toFixed(1)}<span className="text-sm text-zinc-500">/100</span></p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest">Projected grade</p>
            <span className={`inline-block mt-1 px-3 py-1 text-lg font-black rounded-xl border ${GRADE_COLORS[projectedGrade]}`}>{projectedGrade}</span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-zinc-200 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-zinc-500">
          <p>
            {model?.credits
              ? <>Registered credits: <span className="font-bold text-zinc-700">{model.credits}</span>{model.isEmbedded && model.theoryCredits && model.labCredits ? ` (${model.theoryCredits} theory + ${model.labCredits} lab)` : ''}</>
              : 'Registered credits not synced yet — re-sync to weight theory and lab properly.'}
          </p>
          <p className="sm:text-right">
            VTOP weightage published: <span className="font-bold text-zinc-700">{model ? Math.round(model.configuredWeight) : 0}%</span>
            {vitGrade ? <> · VIT's bands put this at <span className="font-bold text-zinc-700">{vitGrade}</span></> : null}
          </p>
        </div>
        {model?.weightsUndeclared && (
          <p className="mt-2 text-[10px] leading-relaxed text-amber-700">
            VTOP has not published any assessment weightage for this course yet, so this total cannot be
            weighted — it is not a prediction of your grade.
          </p>
        )}
        {ungradedInternals.length > 0 && (
          <p className="mt-3 pt-3 border-t border-zinc-200 text-[10px] leading-relaxed text-zinc-500">
            {ungradedInternals.join(', ')} {ungradedInternals.length === 1 ? 'has' : 'have'} not been graded by VTOP yet.
            This projection assumes you score {ungradedInternals.length === 1 ? 'it' : 'them'} at your current average —
            {model?.pendingWeight ? ` that is ${Math.round(model.pendingWeight)}% of the course weightage` : ''} — and is not a promise.
          </p>
        )}
      </div>

      {/* Probability bars (Monte Carlo) */}
      <div>
        <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5" /> Grade probability (1000 simulated FAT outcomes)
        </p>
        <div className="space-y-2">
          {GRADE_ORDER.map((g) => {
            const p = (monteCarlo?.[g] ?? probs[g]) * 100;
            return (
              <div key={g} className="flex items-center gap-3">
                <span className={`w-8 text-center text-xs font-black px-1.5 py-0.5 rounded border ${GRADE_COLORS[g]}`}>{g}</span>
                <div className="flex-1 h-4 bg-white rounded-full border border-zinc-200 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${g === projectedGrade ? 'bg-violet-500' : 'bg-zinc-200'}`}
                    style={{ width: `${Math.max(0.5, p)}%` }} />
                </div>
                <span className="w-12 text-right text-xs font-mono text-zinc-900">{p.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
        <p className="text-[9px] text-zinc-600 mt-1">Band model: S ≥ μ+1.5σ · A μ+1σ–1.5σ · B μ+0.5σ–1σ · C μ±0.5σ · D/E · F below μ−1.5σ. Unofficial community estimate.</p>
      </div>

      {/* Anonymous submission */}
      {submitted ? (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0" /> Thank you — your anonymous grade data helps improve predictions for everyone.
        </div>
      ) : (
        <button
          onClick={() => setShowConsent(true)}
          className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-zinc-900 text-xs font-extrabold transition cursor-pointer"
        >
          Help improve predictions — anonymously submit this grade
        </button>
      )}

      {/* Consent modal */}
      {showConsent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-50 backdrop-blur-md">
          <div className="w-full max-w-md bg-white border border-zinc-200 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-600"><ShieldCheck className="h-5 w-5" /></div>
              <h4 className="text-base font-extrabold text-zinc-900">Help improve grade predictions</h4>
            </div>
            <div className="text-xs text-zinc-900 space-y-2 leading-relaxed">
              <p>Your submitted marks are <strong className="text-zinc-900">completely anonymous</strong> and used only to help other VIT students make better grade predictions. Your student ID or personal info is <strong className="text-zinc-900">never stored</strong>.</p>
              <p>We collect: <strong className="text-emerald-700">course + total marks + final grade (letter)</strong></p>
              <p>We do NOT collect: <strong className="text-rose-700">your name, student ID, email, or any identifying info</strong></p>
              <div className="p-3 bg-white rounded-xl border border-zinc-200 font-mono text-[10px] text-zinc-500">
                {course.courseCode} · {Math.round(total)}/100 · Grade {projectedGrade}
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowConsent(false)}
                className="flex-1 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-bold transition cursor-pointer"
              >
                Maybe later
              </button>
              <button
                onClick={handleSubmit}
                className="flex-1 py-2.5 rounded-xl acc-bg text-zinc-900 text-xs font-extrabold transition cursor-pointer"
              >
                I understand, submit my grade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
