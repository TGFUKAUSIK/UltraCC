import React, { useState, useMemo, useId } from 'react';
import { BookOpen, Calculator, GraduationCap, Info, Trophy, LineChart, TrendingUp, Layers, AlertTriangle, AlertCircle } from 'lucide-react';
import { CourseMarks, TimetableSlot } from '../types';
import { GradeSummary, GradeHistory, SemesterGrades, CurriculumProgress, ArrearRecord } from '../lib/vtop/types';
import { CgpaSimulator } from './CgpaSimulator';
import { WhatIfMarksSimulator } from './WhatIfMarksSimulator';
import { GradePredictor } from './GradePredictor';
import { detectMismatches, type MarksMismatch } from '../lib/lms/mismatch';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import { getInternalMarksSummary } from '../utils/internalMarks';
import { isEvaluatedAssessment, pendingWeightage } from '../utils/assessmentStatus';
import { buildCourseModel, earnedOf, projectCoursePercent, solveTargetFAT } from '../utils/gradeModel';
import { creditProfilesFromTimetable, creditsOfMarkRecord, baseCourseCode } from '../utils/courseCredits';

interface GradesViewProps {
  courseMarks: CourseMarks[];
  timetable: TimetableSlot[];
  grades: GradeSummary | null;
  gradeHistory?: GradeHistory | null;
  semesterGrades?: SemesterGrades | null;
  /** Degree/credit progress from the grade-history page (VTOP). */
  curriculum?: CurriculumProgress | null;
  /** Backlog/arrear courses across all semesters (VTOP). */
  arrears?: ArrearRecord[];
  /** LMS gradebook for mismatch detection (optional — only when LMS is synced). */
  lmsGradebook?: { courseId: number; courseName: string; items: { itemName: string; score: number | null; maxScore: number | null }[] }[];
}

const GRADE_COLORS: Record<string, string> = {
  S: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  A: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  B: 'bg-cyan-500/15 text-cyan-600 border-cyan-500/30',
  C: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  D: 'bg-orange-500/15 text-orange-600 border-orange-500/30',
  E: 'bg-rose-500/15 text-rose-600 border-rose-500/30',
  F: 'bg-red-500/15 text-red-600 border-red-500/30',
  N: 'bg-zinc-100 text-zinc-500 border-zinc-500/30',
};

type GradesTab = 'marks' | 'history' | 'predictor' | 'simulator';

const TABS: { id: GradesTab; label: string }[] = [
  { id: 'marks', label: 'Marks' },
  { id: 'simulator', label: 'Simulator' },
  { id: 'history', label: 'Grade History' },
  { id: 'predictor', label: 'Grade Predictor' },
];

/**
 * Course code -> VTOP's registered credits for that course.
 *
 * The marks record carries the credits stamped at sync time from the same
 * semester's registered course list, so a cached semester is weighted with the
 * credits it was actually synced with. The timetable profile is the fallback
 * for a record synced before that stamp existed. A course neither source knows
 * about is simply absent — the CGPA planner excludes it instead of defaulting
 * to 3 credits.
 */
function authoritativeCredits(
  marks: CourseMarks[],
  timetable: TimetableSlot[],
): Record<string, number> {
  const profiles = creditProfilesFromTimetable(timetable);
  const map: Record<string, number> = {};
  for (const m of marks) {
    const total = creditsOfMarkRecord(m)?.total
      ?? profiles.get(baseCourseCode(m.courseCode))?.total
      ?? 0;
    if (total > 0) map[m.courseCode] = total;
  }
  return map;
}

export const GradesView: React.FC<GradesViewProps> = ({ courseMarks, timetable, grades, gradeHistory, semesterGrades, curriculum, arrears, lmsGradebook }) => {
  const [tab, setTab] = useState<GradesTab>('marks');
  const [cgpaHidden] = useCgpaPrivacy();
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());
  const toggleExpand = (code: string) => {
    setExpandedCourses(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };
  const creditsByCourse = authoritativeCredits(courseMarks, timetable);
  const hasMarks = courseMarks.length > 0;

  return (
    <div className="grades-view space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-600">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight">Grades &amp; Marks</h2>
              <p className="text-xs text-zinc-500 font-medium">Internal marks, grade history and relative-grade prediction</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                  tab === t.id
                    ? 'acc-bg text-zinc-900 border-transparent'
                    : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Marks tab ---------- */}
      {tab === 'marks' && (
        <>
          {/* Per-course marks table */}
          <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600">
                <BookOpen className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Internal Marks</h3>
                <p className="text-xs text-zinc-500 font-medium">CAT / Digital Assignment / Quiz scores from VTOP</p>
              </div>
            </div>

            {hasMarks ? (
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
                      <th scope="col" className="py-2 pr-3 font-extrabold">Course</th>
                      <th scope="col" className="py-2 pr-3 font-extrabold">CAT 1</th>
                      <th scope="col" className="py-2 pr-3 font-extrabold">CAT 2</th>
                      <th scope="col" className="py-2 pr-3 font-extrabold">DA 1</th>
                      <th scope="col" className="py-2 pr-3 font-extrabold">DA 2</th>
                      <th scope="col" className="py-2 pr-3 font-extrabold">DA 3</th>
                      <th scope="col" className="py-2 pr-3 font-extrabold">Quiz</th>
                      <th scope="col" className="py-2 pr-3 font-extrabold">FAT</th>
                      <th scope="col" className="py-2 font-extrabold">Internal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courseMarks.map((m) => {
                      // VTOP publishes an assessment row before it is graded:
                      // real max, scored 0, status 'Pending'. Showing "0/50"
                      // there claims a mark the student does not have, so a
                      // declared-but-ungraded row says "Pending" instead, and
                      // only a row VTOP never declared shows the em dash.
                      const cell = (c?: { scored: number; max: number; weightage?: number; status?: string }) =>
                        isEvaluatedAssessment(c) ? (
                          <span className="font-mono text-zinc-900">{c!.scored}<span className="text-zinc-600">/{c!.max}</span></span>
                        ) : (c && ((c.max ?? 0) > 0 || (c.weightage ?? 0) > 0)) ? (
                          <span className="text-[10px] text-zinc-500 font-medium">Pending</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        );
                      return (
                        <>
                        <tr key={m.courseCode} className="border-t border-zinc-200">
                          <td className="py-2 pr-3">
                            <span className="font-mono font-bold text-zinc-900">{m.courseCode}</span>
                            <span className="block text-[10px] text-zinc-500 truncate max-w-[160px]">{m.courseTitle}</span>
                          </td>
                          <td className="py-2 pr-3">{cell(m.cat1)}</td>
                          <td className="py-2 pr-3">{cell(m.cat2)}</td>
                          <td className="py-2 pr-3">{cell(m.da1)}</td>
                          <td className="py-2 pr-3">{cell(m.da2)}</td>
                          <td className="py-2 pr-3">{cell(m.da3)}</td>
                          <td className="py-2 pr-3">{cell(m.quiz)}</td>
                          <td className="py-2 pr-3">{cell(m.fat)}</td>
                          <td className="py-2 font-mono font-bold text-emerald-600">
                            {Number.isFinite(m.totalScoredSoFar) && m.totalScoredSoFar > 0 ? m.totalScoredSoFar.toFixed(1) : '—'}
                          </td>
                        </tr>
                        {m.extraComponents && m.extraComponents.length > 0 && (
                          <tr className="border-t border-zinc-200">
                            <td colSpan={9} className="py-1 px-2">
                              <button
                                onClick={() => toggleExpand(m.courseCode)}
                                className="text-[10px] text-blue-600 hover:text-blue-700 font-mono cursor-pointer flex items-center gap-1"
                              >
                                <span className="text-zinc-600">{expandedCourses.has(m.courseCode) ? '▾' : '▸'}</span>
                                {m.extraComponents.length} more assessment{m.extraComponents.length > 1 ? 's' : ''} (PAT / Exp / Quiz / etc.)
                              </button>
                            </td>
                          </tr>
                        )}
                        {m.extraComponents && m.extraComponents.length > 0 && expandedCourses.has(m.courseCode) && m.extraComponents.map((ec, i) => (
                          <tr key={`${m.courseCode}-extra-${i}`} className="border-t border-zinc-200 bg-zinc-50">
                            <td className="py-1.5 pl-6 pr-3">
                              <span className="text-[10px] text-zinc-500 font-mono">{ec.title}</span>
                            </td>
                            <td className="py-1.5 pr-3" colSpan={6}></td>
                            <td className="py-1.5 pr-3">
                              <span className="font-mono text-zinc-900 text-[11px]">
                                {isEvaluatedAssessment(ec)
                                  ? <>{ec.scored}<span className="text-zinc-600">/{ec.max}</span></>
                                  : (ec.max > 0 || ec.weightage > 0
                                    ? <span className="text-[10px] text-zinc-500 font-sans font-medium">Pending</span>
                                    : '—')}
                              </span>
                            </td>
                            <td className="py-1.5">
                              <span className={`text-[10px] font-mono ${ec.status === 'Evaluated' ? 'text-zinc-500' : 'text-zinc-600'}`}>
                                {ec.weightage > 0 ? `${ec.weightage}%` : ''}
                              </span>
                            </td>
                          </tr>
                        ))}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-2xl text-center">
                <LineChart className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-sm font-bold text-zinc-900">Marks not synced yet</p>
                <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto leading-relaxed">
                  Re-sync from <strong className="text-zinc-900">Login</strong> to see your CAT / assignment marks here —
                  they appear once VTOP publishes them.
                </p>
              </div>
            )}
          </div>

          {/* LMS vs VTOP marks mismatch detection */}
          <MarksMismatchAlert courseMarks={courseMarks} lmsGradebook={lmsGradebook} />

          {/* Mark distribution — component weightage vs scored, weighted total */}
          {hasMarks && <MarkDistribution marks={courseMarks} />}

          {/* Reverse Target Grade Simulator */}
          {hasMarks && <ReverseGradeSimulator marks={courseMarks} />}

          {/* CGPA Simulator */}
          <CgpaSimulator
            marks={courseMarks}
            creditsByCourse={creditsByCourse}
            cumulativeCgpa={grades?.available && grades.cgpa !== null ? grades.cgpa : null}
            cumulativeCreditsEarned={grades?.available && grades.creditsEarned !== null ? grades.creditsEarned : null}
          />
        </>
      )}

      {/* ---------- Grade History tab ---------- */}
      {tab === 'history' && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2.5 bg-violet-500/10 border border-violet-500/20 rounded-2xl text-violet-600">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Grade History</h3>
              <p className="text-xs text-zinc-500 font-medium">
                Final letter grades from VTOP — per-course this semester and your cumulative grade distribution.
              </p>
            </div>
          </div>

          {!semesterGrades?.available && !gradeHistory?.available ? (
            <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-2xl text-xs text-zinc-500 flex items-start gap-2">
              <Info className="h-4 w-4 text-zinc-500 shrink-0 mt-0.5" />
              <span>
                Grade history not synced yet — re-sync from <strong className="text-zinc-900">Login</strong> after your FAT grades are published.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl">
                  <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-2">Cumulative CGPA</p>
                  <div className="flex items-end gap-3">
                    <p className="text-4xl font-black text-zinc-900 font-mono">{cgpaHidden ? '••••' : (gradeHistory?.cgpa ?? grades?.cgpa ?? '—')}</p>
                    <p className="text-[10px] text-zinc-500 font-mono mb-1.5">
                      {gradeHistory?.creditsEarned != null ? `${gradeHistory.creditsEarned} / ${gradeHistory.creditsRegistered ?? '—'} credits earned` : 'credits unavailable'}
                    </p>
                  </div>
                </div>

                {gradeHistory?.gradeCounts && (
                  <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl">
                    <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-3">Grade Distribution (all semesters)</p>
                    <div className="flex flex-wrap gap-2">
                      {(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'N'] as const).map((g) => (
                        <span key={g} className={`px-3 py-1.5 rounded-xl border text-xs font-extrabold font-mono ${GRADE_COLORS[g] || GRADE_COLORS.N}`}>
                          {g}: {gradeHistory!.gradeCounts![g] ?? 0}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {gradeHistory && gradeHistory.effectiveGrades.length > 0 && (
                  <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl max-h-56 overflow-y-auto">
                    <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-3">Effective Grades</p>
                    <div className="space-y-1.5">
                      {gradeHistory.effectiveGrades.map((eg, i) => (
                        <div key={i} className="flex items-center justify-between text-xs gap-2">
                          <span className="text-zinc-900 truncate">{eg.basketTitle || '—'}</span>
                          <span className="flex items-center gap-2 shrink-0">
                            {eg.creditsEarned != null && <span className="text-[10px] text-zinc-500 font-mono">{eg.creditsEarned} CR</span>}
                            <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-extrabold font-mono ${GRADE_COLORS[eg.grade] || GRADE_COLORS.N}`}>{eg.grade}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest">This Semester's Grades</p>
                  {semesterGrades?.gpa != null && (
                    <span className="px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/25 text-violet-700 text-xs font-extrabold font-mono">
                      GPA {semesterGrades.gpa.toFixed(2)}
                    </span>
                  )}
                </div>
                {semesterGrades && semesterGrades.grades.length > 0 ? (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {semesterGrades.grades.map((g, i) => (
                      <div key={i} className="flex items-center justify-between text-xs gap-2 p-2.5 bg-zinc-50 rounded-xl border border-zinc-200">
                        <div className="min-w-0">
                          <p className="font-mono font-bold text-zinc-900 truncate">{g.courseCode}</p>
                          <p className="text-[10px] text-zinc-500 truncate">{g.courseTitle} · {g.courseType || '—'}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {g.grandTotal != null && <span className="text-[10px] text-zinc-500 font-mono">{g.grandTotal}/100</span>}
                          <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-extrabold font-mono ${GRADE_COLORS[g.grade] || GRADE_COLORS.N}`}>{g.grade || '—'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">No grades published for this semester yet — check back after your FAT exams.</p>
                )}
              </div>
            </div>
          )}

          {/* ---------- Credit / Degree progress (VTOP grade-history page) ---------- */}
          {curriculum?.available && curriculum.totals.creditsRequired > 0 && (
            <div className="mt-6 p-5 bg-zinc-50 border border-zinc-200 rounded-2xl">
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600">
                  <Layers className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-zinc-900 tracking-tight">Credit Progress</p>
                  <p className="text-[10px] text-zinc-500">Degree requirements vs. what you've earned (from VTOP)</p>
                </div>
              </div>
              <div className="mb-4">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-zinc-500 font-medium">Total credits</span>
                  <span className="font-mono font-bold text-zinc-900">
                    {curriculum.totals.creditsEarned} / {curriculum.totals.creditsRequired}
                  </span>
                </div>
                <div className="h-2.5 bg-white rounded-full overflow-hidden border border-zinc-200">
                  <div
                    className="h-full acc-bg rounded-full transition-all"
                    style={{ width: `${Math.min(100, (curriculum.totals.creditsEarned / curriculum.totals.creditsRequired) * 100)}%` }}
                  />
                </div>
                {curriculum.totals.cgpa != null && (
                  <p className="text-[10px] text-zinc-500 mt-1.5 font-mono">CGPA {cgpaHidden ? '••••' : curriculum.totals.cgpa} · {curriculum.totals.creditsRegistered} registered</p>
                )}
              </div>
              {curriculum.distributionTypes.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
                        <th scope="col" className="py-1.5 pr-3 font-extrabold">Category</th>
                        <th scope="col" className="py-1.5 pr-3 font-extrabold">Required</th>
                        <th scope="col" className="py-1.5 font-extrabold">Earned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {curriculum.distributionTypes.map((row, i) => (
                        <tr key={i} className="border-t border-zinc-200">
                          <td className="py-1.5 pr-3 text-zinc-900">{row.name}</td>
                          <td className="py-1.5 pr-3 font-mono text-zinc-500">{row.required}</td>
                          <td className="py-1.5 font-mono font-bold text-emerald-600">{row.earned}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ---------- Arrears / backlogs (VTOP arrear registration page) ---------- */}
          {arrears && arrears.length > 0 && (
            <div className="mt-6 p-5 bg-zinc-50 border border-rose-500/20 rounded-2xl">
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-zinc-900 tracking-tight">Arrears / Backlogs</p>
                  <p className="text-[10px] text-zinc-500">Courses from earlier semesters still to be cleared (from VTOP)</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
                      <th scope="col" className="py-1.5 pr-3 font-extrabold">Course</th>
                      <th scope="col" className="py-1.5 pr-3 font-extrabold">Semester</th>
                      <th scope="col" className="py-1.5 pr-3 font-extrabold">Credits</th>
                      <th scope="col" className="py-1.5 font-extrabold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {arrears.map((a, i) => (
                      <tr key={i} className="border-t border-zinc-200">
                        <td className="py-1.5 pr-3">
                          <span className="font-mono font-bold text-zinc-900">{a.courseCode}</span>
                          <span className="block text-[10px] text-zinc-500 truncate max-w-[200px]">{a.courseTitle}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-zinc-500">{a.semesterName}</td>
                        <td className="py-1.5 pr-3 font-mono text-zinc-500">{a.credits}</td>
                        <td className="py-1.5">
                          <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-extrabold font-mono ${
                            a.status === 'Cleared' ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
                              : a.status === 'Registered' ? 'bg-blue-500/15 text-blue-600 border-blue-500/30'
                              : 'bg-rose-500/15 text-rose-600 border-rose-500/30'
                          }`}>
                            {a.status}
                          </span>
                          {a.grade && <span className="ml-2 font-mono text-zinc-900">{a.grade}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- Simulator tab ---------- */}
      {tab === 'simulator' && (
        <WhatIfMarksSimulator marks={courseMarks} />
      )}

      {/* ---------- Grade Predictor tab ---------- */}
      {tab === 'predictor' && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2.5 bg-violet-500/10 border border-violet-500/20 rounded-2xl text-violet-600">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Relative Grade Predictor</h3>
              <p className="text-xs text-zinc-500 font-medium">Community μ/σ model — not VIT's official algorithm</p>
            </div>
          </div>
          {hasMarks ? (
            <GradePredictor marks={courseMarks} />
          ) : (
            <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-2xl text-center">
              <LineChart className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
              <p className="text-sm font-bold text-zinc-900">Marks not synced yet</p>
              <p className="text-[11px] text-zinc-500 mt-1">The grade predictor needs your CAT / assignment marks.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Marks Mismatch Alert (LMS vs VTOP)
// ---------------------------------------------------------------------------

interface MismatchProps {
  courseMarks: CourseMarks[];
  lmsGradebook?: { courseId: number; courseName: string; items: { itemName: string; score: number | null; maxScore: number | null }[] }[];
}

function MarksMismatchAlert({ courseMarks, lmsGradebook }: MismatchProps) {
  const mismatches = useMemo(() => {
    if (!lmsGradebook || lmsGradebook.length === 0) return [];
    const all: MarksMismatch[] = [];
    for (const lb of lmsGradebook) {
      const vtop = courseMarks.find((m) => m.courseCode === lb.courseName || lb.courseName.includes(m.courseCode));
      if (!vtop) continue;
      all.push(...detectMismatches(lb.items as any, vtop));
    }
    return all;
  }, [courseMarks, lmsGradebook]);

  if (mismatches.length === 0) return null;

  return (
    <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[10px] space-y-1.5">
      <p className="font-extrabold text-amber-700 uppercase tracking-wider flex items-center gap-1.5">
        <AlertCircle className="h-3.5 w-3.5" />
        LMS vs VTOP marks mismatch
      </p>
      {mismatches.slice(0, 5).map((m, i) => (
        <div key={i} className="flex items-start gap-2 text-amber-700/80">
          <span className="font-mono font-bold text-amber-700 shrink-0">{m.courseCode}</span>
          <span>{m.detail}</span>
        </div>
      ))}
      {mismatches.length > 5 && (
        <p className="text-amber-700/60">… and {mismatches.length - 5} more mismatches</p>
      )}
      <p className="text-amber-700/50 pt-0.5">This is informational only — verify with your faculty if you're close to a grade cutoff.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reverse Target Grade Simulator (extracted from AcademicsView)
// ---------------------------------------------------------------------------

const targetThresholds = { S: 90, A: 80, B: 70, C: 60 } as const;

/**
 * MarkDistribution — per-course assessment breakdown exactly as VTOP serves it:
 * each component's scored/max, its weightage, and its weighted contribution.
 * The weighted total (final marks) is derived from component weightages only,
 * never guessed. Pending (AB) components are shown as Pending, not 0.
 */
function MarkDistribution({ marks }: { marks: CourseMarks[] }) {
  const [open, setOpen] = useState<string | null>(marks[0]?.courseCode ?? null);

  const componentsOf = (m: CourseMarks) => {
    const list: { key: string; label: string; c: { scored: number; max: number; weightage: number; status?: string } | undefined; isFat?: boolean }[] = [
      { key: 'cat1', label: 'CAT 1', c: m.cat1 },
      { key: 'cat2', label: 'CAT 2', c: m.cat2 },
      { key: 'da1', label: 'DA 1', c: m.da1 },
      { key: 'da2', label: 'DA 2', c: m.da2 },
      { key: 'da3', label: 'DA 3', c: m.da3 },
      { key: 'quiz', label: 'Quiz', c: m.quiz },
      // Lab/practical extra components: Experiments, PATs, Continuous Assessment, etc.
      ...(m.extraComponents ?? []).map((ec, i) => ({
        key: `extra-${i}`,
        label: ec.title,
        c: ec as { scored: number; max: number; weightage: number; status?: string } | undefined,
        isFat: false,
      })),
      { key: 'fat', label: 'FAT', c: m.fat as { scored: number; max: number; weightage: number; status?: string } | undefined, isFat: true },
      // An embedded course is examined twice; hiding the lab paper made the
      // theory FAT look like the whole final.
      { key: 'labfat', label: 'Lab FAT', c: m.labFat as { scored: number; max: number; weightage: number; status?: string } | undefined, isFat: true },
    ];
    // Include a row VTOP declared but has not graded yet: on a live
    // fresh-semester record those arrive with maxMarks 0 and a real
    // weightageMax, so a `max > 0` gate hid exactly the components that make
    // the total incomplete (and made "Pending" name nothing).
    return list.filter((x) => x.c && ((x.c.max > 0 && x.c.weightage > 0) || pendingWeightage(x.c) > 0));
  };

  /** Declared rows VTOP has not graded yet — their labels, in VTOP's order. */
  const pendingLabels = (m: CourseMarks): string[] =>
    componentsOf(m).filter((x) => !isEvaluatedAssessment(x.c)).map((x) => x.label);

  /**
   * Final marks on VTOP's own scheme: each row at its declared weightage, with
   * an embedded course's theory and lab halves blended by registered credits.
   * Null while any row is ungraded, because folding that row in as a zero would
   * report a score VTOP never published.
   */
  const weightedTotal = (m: CourseMarks): number | null => {
    const model = buildCourseModel(m);
    if (model.weightsUndeclared) return null;
    if (model.pendingTitles.length > 0) return null;
    return projectCoursePercent(model, {});
  };

  return (
    <div className="mt-4 bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
      <div className="flex items-center space-x-3 mb-6">
        <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-600">
          <TrendingUp className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Mark Distribution</h3>
          <p className="text-xs text-zinc-500 font-medium">Component weightage vs scored — theory (CAT/DA/Quiz/FAT) and lab (Experiments/PAT) from VTOP</p>
        </div>
      </div>

      <div className="space-y-3">
        {marks.map((m) => {
          const comps = componentsOf(m);
          const total = weightedTotal(m);
          const isOpen = open === m.courseCode;
          return (
            <div key={m.courseCode} className="bg-zinc-50 border border-zinc-200 rounded-2xl overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : m.courseCode)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer"
              >
                <span className="min-w-0">
                  <span className="font-mono font-bold text-zinc-900 text-sm">{m.courseCode}</span>
                  <span className="block text-[10px] text-zinc-500 truncate">{m.courseTitle}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {total !== null && (
                    <span className="font-mono font-bold text-emerald-600 text-sm">
                      {total.toFixed(1)}<span className="text-zinc-600 text-[10px]"> / 100</span>
                    </span>
                  )}
                  <span className={`text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    <Layers className="h-4 w-4" />
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-zinc-200">
                  {comps.length === 0 ? (
                    <p className="text-[11px] text-zinc-500 py-2">No weighted components on the page for this course.</p>
                  ) : (
                    <div className="space-y-2 pt-2">
                      {comps.map((x) => {
                        const c = x.c!;
                        // VTOP's own row status decides this — a declared FAT
                        // arrives with scored 0, which is not a grade.
                        const scoredIsPending = !isEvaluatedAssessment(c);
                        const pct = scoredIsPending ? null : (c.scored / c.max) * 100;
                        return (
                          <div key={x.key}>
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="text-zinc-500 font-medium">{x.label}</span>
                              <span className="font-mono text-zinc-900">
                                {scoredIsPending ? (
                                  <span className="text-amber-600">Pending</span>
                                ) : (
                                  <>
                                    {c.scored}<span className="text-zinc-600">/{c.max}</span>
                                    <span className="text-zinc-600"> · {((c.scored / c.max) * c.weightage).toFixed(1)}/{c.weightage} wt</span>
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${scoredIsPending ? 'bg-amber-500/50' : 'bg-indigo-500'}`}
                                style={{ width: `${scoredIsPending ? 12 : Math.max(2, pct ?? 0)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      <div className="pt-2 flex items-center justify-between border-t border-zinc-200 text-[11px]">
                        <span className="text-zinc-500 font-medium">Weighted total (final marks)</span>
                        <span className="font-mono font-bold text-emerald-600">
                          {total !== null ? `${total.toFixed(1)} / 100` : (() => {
                            const waiting = pendingLabels(m);
                            return waiting.length
                              ? `Pending — ${waiting.slice(0, 3).join(', ')}${waiting.length > 3 ? ' +more' : ''} not graded`
                              : 'Pending';
                          })()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReverseGradeSimulator({ marks }: { marks: CourseMarks[] }) {
  const uid = useId();
  const courseSelectId = `${uid}-course`;
  const [selectedCourseForSim, setSelectedCourseForSim] = useState<CourseMarks | null>(marks[0] ?? null);
  const [targetGrade, setTargetGrade] = useState<'S' | 'A' | 'B' | 'C'>('S');

  const model = useMemo(
    () => (selectedCourseForSim ? buildCourseModel(selectedCourseForSim) : null),
    [selectedCourseForSim],
  );
  const rows = model
    ? [...(model.parts.theory?.rows ?? []), ...(model.parts.lab?.rows ?? [])]
    : [];
  // Every non-FAT row VTOP published, in VTOP's own weightage — including PAT,
  // Experiments and Project Review rows rather than a fixed CAT/DA layout.
  const internalRows = rows.filter((r) => !r.isFat);
  const gradedInternals = internalRows.filter((r) => r.scored !== null);
  const pendingInternals = internalRows.filter((r) => r.scored === null);
  const currentInternalMarks = gradedInternals.reduce((sum, r) => sum + earnedOf(r), 0);
  const gradedInternalWeight = gradedInternals.reduce((sum, r) => sum + r.weightage, 0);
  const openInternalWeight = pendingInternals.reduce((sum, r) => sum + r.weightage, 0);

  // The same model the predictor runs: VTOP's declared weights, the course's
  // registered credits as the theory/lab blend, and ungraded rows held at the
  // student's pace rather than at zero. `worstCase` keeps the old honest
  // caveat available without letting it masquerade as the answer.
  const targetPercent = targetThresholds[targetGrade];
  const target = model ? solveTargetFAT(model, targetPercent) : null;
  const worstCase = model ? solveTargetFAT(model, targetPercent, { pendingPercent: 0 }) : null;
  const fatComponent = target?.fatDeclared ? { max: target.fatMax, weightage: target.fatWeight } : null;
  const fatRawScoreNeeded = target && !target.isUnknown ? target.requiredRaw : null;
  const needsMoreThanPaper = !!target && !target.isUnknown && !target.isAlreadyAchieved && !target.isAchievable;

  return (
    <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
      <div className="flex items-center space-x-3 mb-6">
        <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600">
          <Calculator className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Reverse Target Grade Simulator</h3>
          <p className="text-xs text-zinc-500 font-medium">Exact FAT score needed based on your internal marks</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4 bg-zinc-50 p-5 rounded-2xl border border-zinc-200">
          <div>
            <label htmlFor={courseSelectId} className="block text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-2">1. Select Course</label>
            <select
              id={courseSelectId}
              value={selectedCourseForSim?.courseCode ?? ''}
              onChange={(e) => {
                const found = marks.find((c) => c.courseCode === e.target.value);
                if (found) setSelectedCourseForSim(found);
              }}
              className="w-full bg-white border border-zinc-200 rounded-xl p-3 text-xs text-zinc-900 focus:outline-none focus:border-blue-500 font-medium"
            >
              {marks.map((c) => (
                <option key={c.courseCode} value={c.courseCode}>{c.courseCode}: {c.courseTitle}</option>
              ))}
            </select>
          </div>
          <div>
            {/* A label with no control is announced as stray text, so the grade
                picker is a real button group named by its heading. */}
            <span id={`${uid}-grade`} className="block text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-2">2. Desired Grade</span>
            <div className="grid grid-cols-4 gap-2" role="group" aria-labelledby={`${uid}-grade`}>
              {(['S', 'A', 'B', 'C'] as const).map((grade) => (
                <button
                  key={grade}
                  type="button"
                  onClick={() => setTargetGrade(grade)}
                  aria-pressed={targetGrade === grade}
                  aria-label={`Target grade ${grade}${targetGrade === grade ? ' (selected)' : ''}`}
                  className={`py-2 text-xs font-bold rounded-xl border transition cursor-pointer ${
                    targetGrade === grade ? 'acc-bg text-zinc-900 border-blue-500' : 'bg-white text-zinc-500 border-zinc-200 hover:bg-zinc-100'
                  }`}
                >
                  {grade}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-zinc-50 p-5 rounded-2xl border border-zinc-200 space-y-3">
          <h4 className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest">
            Internal Score (from VTOP weightage)
            {model?.credits ? ` · ${model.credits} registered credits` : ''}
          </h4>
          <div className="space-y-2 text-xs">
            {internalRows.length === 0 && (
              <p className="text-[11px] text-zinc-500">VTOP has published no weighted internal assessments for this course yet.</p>
            )}
            {internalRows.map((r) => {
              const graded = r.scored !== null;
              return (
                <div key={`${r.part}-${r.key}`} className="flex justify-between p-2.5 bg-white rounded-xl border border-zinc-200">
                  <span className="text-zinc-500">
                    {model?.isEmbedded ? <span className="font-mono text-[9px] uppercase mr-1 text-zinc-400">{r.part === 'L' ? 'lab' : 'theory'}</span> : null}
                    {graded ? `${r.title} (${r.scored}/${r.max}):` : `${r.title} — not graded yet:`}
                  </span>
                  <span className={`font-mono font-bold ${graded ? 'text-blue-600' : 'text-zinc-500'}`}>
                    {graded ? `${earnedOf(r).toFixed(1)} / ${r.weightage}` : `— / ${r.weightage}`}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="pt-2 border-t border-zinc-200 flex justify-between text-xs font-bold">
            <span className="text-zinc-900">Graded so far:</span>
            <span className="text-emerald-600 font-mono text-sm">{currentInternalMarks.toFixed(1)} / {gradedInternalWeight.toFixed(0)}</span>
          </div>
          {openInternalWeight > 0 && (
            <p className="text-[11px] text-zinc-500 font-medium">
              {openInternalWeight}% of the internal weight is still ungraded
              {pendingInternals.length ? ` (${pendingInternals.map((x) => x.title).join(', ')})` : ''}.
            </p>
          )}
        </div>

        <div className="bg-zinc-50 p-5 rounded-2xl border border-blue-500/30 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest">Target FAT Score</span>
              <Trophy className="h-5 w-5 text-amber-600" />
            </div>
            <div className="my-4 text-center">
              {!target || target.isUnknown ? (
                openInternalWeight > 0 ? (
                  /* No FAT row from VTOP yet, but the course is far from over:
                     naming the ungraded weight is the honest answer, and far
                     more useful than "data not available". */
                  <div className="p-3 bg-zinc-100 border border-zinc-200 rounded-2xl text-zinc-900 text-xs">
                    <p className="font-bold text-sm">Target still open</p>
                    <p className="mt-1">VTOP has not declared the final exam for this course yet, and {openInternalWeight}% of the course weight is still ungraded.</p>
                  </div>
                ) : (
                  <div className="p-3 bg-zinc-100 border border-zinc-200 rounded-2xl text-zinc-900 text-xs">FAT weightage is not available in the synced VTOP marks data.</div>
                )
              ) : target.isAlreadyAchieved ? (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-700 text-xs">
                  <p className="text-3xl font-black text-emerald-600 font-mono">0 / {fatComponent?.max}</p>
                  <p className="mt-1 font-medium">Already on track — {target.targetGrade} holds without marks from the FAT at your current pace.</p>
                </div>
              ) : needsMoreThanPaper ? (
                openInternalWeight > 0 ? (
                  /* The target is out of reach only while the ungraded internals
                     are read at the student's pace. That is a caveat, not a
                     verdict — declaring the grade unreachable mid-semester is a
                     false alarm. */
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-700 text-xs">
                    <p className="font-bold text-sm">Not decided yet</p>
                    <p className="mt-1">
                      On your current pace the {target.part === 'L' ? 'lab ' : ''}FAT would have to be worth more than the
                      {fatComponent ? ` ${fatComponent.max}-mark` : ''} paper. Marks above your pace in{' '}
                      {pendingInternals.map((x) => x.title).join(', ')} are what would make {target.targetGrade} reachable.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-700 text-xs">
                    <p className="font-bold text-sm">Target Unattainable</p>
                    <p className="mt-1">{target.message}</p>
                  </div>
                )
              ) : target.feasibility === 'easy' ? (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-700 text-xs">
                  <p className="text-3xl font-black text-emerald-600 font-mono">{fatRawScoreNeeded} / {fatComponent?.max}</p>
                  <p className="mt-1 font-medium">This FAT score reaches the {target.targetGrade} threshold.</p>
                </div>
              ) : (
                <div>
                  <p className="text-4xl font-black text-zinc-900 font-mono">{fatRawScoreNeeded} / {fatComponent?.max}</p>
                  <p className="text-xs text-blue-700 mt-1 font-medium">
                    Needed in {target.part === 'L' ? 'the lab ' : 'the '}FAT exam for{' '}
                    <span className="font-bold underline">{target.targetGrade} Grade</span>
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="p-3 bg-white rounded-xl border border-zinc-200 text-[11px] text-zinc-900">
            <Info className="h-3.5 w-3.5 acc-text inline mr-1" />
            <span>{selectedCourseForSim ? getInternalMarksSummary(selectedCourseForSim) : 'Internal marks not available'}{model?.credits ? ` · ${model.credits} credits` : ''}</span>
            {openInternalWeight > 0 && !target?.isUnknown && (
              <span className="block mt-1 text-zinc-500">
                This target projects the {openInternalWeight}% VTOP has not graded at your current pace — it is not read as a zero.
                {worstCase && !worstCase.isUnknown && worstCase.requiredRaw !== target?.requiredRaw
                  ? ` If those internals scored nothing, you would need ${worstCase.requiredRaw} in the FAT.`
                  : ''}
              </span>
            )}
            {target && !target.isUnknown && !needsMoreThanPaper && fatComponent && target.vitFatMinimumRaw !== null && (target.requiredRaw ?? 0) < target.vitFatMinimumRaw && (
              <span className="block mt-1 text-amber-700">
                VIT also requires at least {target.vitFatMinimumRaw} / {fatComponent.max} in the FAT to pass the course, so that
                is the real floor for this paper.
              </span>
            )}
            {model?.isEmbedded && (
              <span className="block mt-1 text-zinc-500">
                Embedded course: theory and lab are weighted by their registered credits
                ({model.theoryCredits || '?'} + {model.labCredits || '?'}), and the lab paper is projected at your pace.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
