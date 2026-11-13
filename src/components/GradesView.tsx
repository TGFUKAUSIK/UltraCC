import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BookOpen, ChevronRight, GraduationCap, Info, LineChart, TrendingUp, Layers, AlertCircle, AlertTriangle } from 'lucide-react';
import { CourseMarks, TimetableSlot } from '../types';
import { GradeSummary, GradeHistory, SemesterGrades, CurriculumProgress, ArrearRecord } from '../lib/vtop/types';
import { CgpaSimulator } from './CgpaSimulator';
import { WhatIfMarksSimulator } from './WhatIfMarksSimulator';
import { GradePredictor } from './GradePredictor';
import { detectMismatches, type MarksMismatch } from '../lib/lms/mismatch';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import { gpaLabel, publishedGpaLabel } from '../utils/gradeModel';
import { classMarkLabel, combinedLabel, courseTotalsOf, type CourseTotals } from '../utils/courseTotals';
import {
  contributionsOf,
  contextOf,
  getSharingDeviceCode,
  readSharePreference,
  shareContributions,
  withdrawContributions,
  writeSharePreference,
  type ContributionContext,
  type MarksContribution,
} from '../lib/gradeSharing';
import { creditProfilesFromTimetable, creditsOfMarkRecord, baseCourseCode } from '../utils/courseCredits';
import { COURSE_KIND_LABEL, CourseDetailsDialog } from './CourseDetailsDialog';

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
  /** VTOP register number — its first two digits decide the theory/lab rule. */
  regNo?: string;
  /** The selected VTOP semester id — the term a shared mark belongs to. */
  semesterId?: string;
}

/**
 * VTOP's grade view by course code. Two grade rows under one code are an
 * embedded course's two halves; neither half's 100-mark total is the merged
 * course's, so that code then claims no published total at all.
 */
function publishedByCourseOf(semesterGrades?: SemesterGrades | null) {
  const map = new Map<string, { grade: string; grandTotal: number | null } | null>();
  for (const g of semesterGrades?.grades ?? []) {
    const code = g.courseCode.trim().toUpperCase();
    if (!code) continue;
    map.set(code, map.has(code) ? null : { grade: g.grade, grandTotal: g.grandTotal });
  }
  return map;
}

function publishedForCode(map: Map<string, { grade: string; grandTotal: number | null } | null>, code: string) {
  const key = code.trim().toUpperCase();
  if (map.has(key)) return map.get(key) ?? null;
  const base = baseCourseCode(code).trim().toUpperCase();
  return map.has(base) ? map.get(base) ?? null : null;
}

/** The head-line figures a course row prints, one per class plus a total. */
function rowFigures(totals: CourseTotals): { label: string; value: string }[] {
  const figures: { label: string; value: string }[] = totals.classes.map((c) => ({
    label: c.label,
    value: classMarkLabel(c) ?? 'Not published',
  }));
  if (totals.finalTotal !== null) {
    figures.push({ label: 'Course', value: `${totals.finalTotal.toFixed(1)} / 100` });
  } else if (totals.combined?.finalMark != null) {
    figures.push({ label: 'Course', value: combinedLabel(totals.combined) as string });
  }
  return figures;
}

/**
 * A letter grade's band, said in the board's own tones.
 *
 * This used to be eight Tailwind literals — `bg-emerald-500/15 text-emerald-600
 * border-emerald-500/30` and its seven siblings — which made grades a second
 * colour language beside the board's, and a *light-only* one: the dark canvas
 * repaints `--uc-*`, never `bg-emerald-500/15`, so after dark an S's letter sank
 * into its own chip. #059669 at 10px on white is 3.8:1, so a tone ink here would
 * fail AA anyway; the band therefore rides a `.uc-panel-*` tint and the letter
 * stays theme ink. Safe marks an S/A/B, warning a C/D/E, critical an F, and an N
 * is simply unknown — the bands are a grouping, not a badge of honour.
 */
const GRADE_TINT: Record<string, string> = {
  S: 'uc-panel-safe',
  A: 'uc-panel-safe',
  B: 'uc-panel-safe',
  C: 'uc-panel-warning',
  D: 'uc-panel-warning',
  E: 'uc-panel-warning',
  F: 'uc-panel-critical',
  N: 'uc-panel-unknown',
};

function gradeTint(grade: string | undefined | null): string {
  return GRADE_TINT[(grade ?? '').trim().toUpperCase()] ?? 'uc-panel-unknown';
}

type GradesTab = 'marks' | 'history' | 'predictor' | 'simulator';

const TABS: { id: GradesTab; label: string }[] = [
  { id: 'marks', label: 'Marks' },
  { id: 'simulator', label: 'Simulator' },
  { id: 'history', label: 'Grade History' },
  { id: 'predictor', label: 'Grade Predictor' },
];

/**
 * Which chip the page opens on is part of the address, not just a click.
 *
 * The four screens here answer four different questions, and a student usually
 * wants one of them: the friend who asks "what will I get if I score 30 on the
 * FAT" should be sent a link that opens the simulator, not the marks table they
 * then have to find the chip for. `?subtab=` is written by the app itself — the
 * same treatment the Academics chips already have — so a refresh, a Back, or a
 * link pasted into a group chat keeps the student on the chip they chose. The
 * default chip stays out of the URL, and a value that names no chip is ignored:
 * the marks list is the one screen that has an answer for every signed-in
 * student, so a wrong link lands there instead of on a blank page.
 */
const GRADE_TABS: GradesTab[] = TABS.map((t) => t.id);
const DEFAULT_GRADE_TAB: GradesTab = 'marks';

function initialSubtab(): GradesTab {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('subtab');
    if (fromUrl && GRADE_TABS.includes(fromUrl as GradesTab)) return fromUrl as GradesTab;
  } catch { /* a page the browser will not give a URL for */ }
  return DEFAULT_GRADE_TAB;
}

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

export const GradesView: React.FC<GradesViewProps> = ({ courseMarks, timetable, grades, gradeHistory, semesterGrades, curriculum, arrears, lmsGradebook, regNo, semesterId }) => {
  const [tab, setTab] = useState<GradesTab>(initialSubtab);
  const [cgpaHidden] = useCgpaPrivacy();
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [sharing, setSharing] = useState<boolean>(() => readSharePreference());
  const [shareStatus, setShareStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  // Keep the address bar in step with the chip, and drop the parameter on the
  // default one so a shared link never carries a chip the student did not pick.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (tab === DEFAULT_GRADE_TAB) url.searchParams.delete('subtab');
      else url.searchParams.set('subtab', tab);
      if (url.toString() !== window.location.href) window.history.replaceState({}, '', url.toString());
    } catch { /* web views with no URL to offer */ }
  }, [tab]);

  const creditsByCourse = authoritativeCredits(courseMarks, timetable);
  const hasMarks = courseMarks.length > 0;
  const publishedByCourse = useMemo(() => publishedByCourseOf(semesterGrades), [semesterGrades]);
  // The predictor needs only the letter VTOP already awarded, keyed like the
  // marks records it reads them against.
  const publishedGrades = useMemo(() => Object.fromEntries(
    courseMarks.flatMap((course) => {
      const published = publishedForCode(publishedByCourse, course.courseCode);
      return published?.grade ? [[course.courseCode, published.grade] as const] : [];
    }),
  ), [courseMarks, publishedByCourse]);

  // One figure set per course, from the same rules the detail sheet uses. The
  // list and the sheet can never disagree about what a course has earned.
  const courseViews = useMemo(() => courseMarks.map((course) => {
    const published = publishedForCode(publishedByCourse, course.courseCode);
    const { totals } = courseTotalsOf(course, { regNo, publishedTotal: published?.grandTotal ?? null });
    return { course, totals, published };
  }), [courseMarks, regNo, publishedByCourse]);

  const contextFor = useCallback(
    (course: CourseMarks): ContributionContext => contextOf(course, timetable, { term: semesterId, regNo }),
    [timetable, semesterId, regNo],
  );

  // What this device owes the shared pool while sharing is on: the classes VTOP
  // has graded, at the internal stage. A course with a published final total
  // stops contributing internals, and an ungraded row contributes nothing.
  const shareRows = useMemo(() => courseViews.flatMap(({ course, totals }) =>
    contributionsOf(course, totals, contextFor(course)),
  ), [courseViews, contextFor]);
  const shareSignature = JSON.stringify(shareRows);

  useEffect(() => {
    if (!sharing || !shareRows.length) return undefined;
    let cancelled = false;
    setShareStatus('saving');
    shareContributions(getSharingDeviceCode(), shareRows)
      .then(() => { if (!cancelled) setShareStatus('idle'); })
      .catch(() => { if (!cancelled) setShareStatus('error'); });
    return () => { cancelled = true; };
    // shareSignature is the content of shareRows; the array identity is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharing, shareSignature]);

  const toggleSharing = useCallback((next: boolean) => {
    setSharing(next);
    writeSharePreference(next);
    if (next) {
      setShareStatus('idle');
      return;
    }
    // Off is a withdrawal, not just a flag: the stored row has to go too.
    setShareStatus('saving');
    withdrawContributions(getSharingDeviceCode())
      .then((removed) => setShareStatus(removed ? 'idle' : 'error'))
      .catch(() => setShareStatus('error'));
  }, []);

  const openView = openCode ? courseViews.find((v) => v.course.courseCode === openCode) ?? null : null;
  // The credit line the ledger prints: the degree tally once VTOP has posted it,
  // the semester's earned credits otherwise, and an em dash when neither exists —
  // never a zero standing in for a figure that was simply not synced.
  const creditsLine = curriculum?.available && curriculum.totals.creditsRequired > 0
    ? `${curriculum.totals.creditsEarned} / ${curriculum.totals.creditsRequired}`
    : gradeHistory?.creditsEarned != null
      ? `${gradeHistory.creditsEarned} earned`
      : '—';

  return (
    <div className="uc-grades pb-12">
      {/*
        The head of the mark sheet. One figure is large — the CGPA VTOP posted —
        and the ledger under it carries the rest of the numbers the old header
        stacked as four cards of equal weight. The chips are the index tabs of
        this same document, so they sit inside it rather than floating above it.
      */}
      <header className="uc-plate uc-grades-mast">
        <span className="uc-cap">Marks &amp; grades</span>
        <div className="uc-grades-hero">
          <p className={`uc-grades-figure uc-num${cgpaHidden ? ' is-dim' : ''}`}>
            <b>{cgpaHidden ? '••••' : publishedGpaLabel(grades?.cgpa ?? null, '—')}</b>
            <small>CGPA</small>
          </p>
          <p className="uc-grades-aside">
            {hasMarks
              ? `${courseMarks.length} course${courseMarks.length === 1 ? '' : 's'} in this sheet`
              : 'VTOP has not published marks yet'}
          </p>
        </div>
        <div className="uc-grades-ledger">
          <div className="uc-grades-cell">
            <span>SGPA</span>
            <b>{semesterGrades?.gpa != null ? gpaLabel(semesterGrades.gpa) : '—'}</b>
          </div>
          <div className="uc-grades-cell">
            <span>Credits</span>
            <b>{creditsLine}</b>
          </div>
          <div className="uc-grades-cell">
            <span>Courses</span>
            <b>{courseMarks.length}</b>
          </div>
          <div className="uc-grades-cell">
            <span>Arrears</span>
            <b className={arrears && arrears.length > 0 ? '' : 'is-quiet'}>{arrears?.length ?? 0}</b>
          </div>
        </div>
        <div className="uc-seg" role="tablist" aria-label="Grades screen">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={tab === t.id ? 'is-on' : ''}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* ---------- Marks tab ---------- */}
      {tab === 'marks' && (
        <>
          {/* One compact row per course; the detail sheet opens from it. */}
          <section className="uc-plate uc-grades-plate">
            <header className="uc-plate-head">
              <div className="uc-grades-id">
                <h3 className="uc-grades-title">Course marks</h3>
                <p className="uc-note">Each class on its own mark — open a course for assessments and prediction</p>
              </div>
              <span className="uc-marker uc-marker--quiet uc-marker--sm" aria-hidden="true"><BookOpen size={16} /></span>
            </header>

            {hasMarks ? (
              <div className="uc-grades-body">
                <div className="uc-course-list">
                  {courseViews.map(({ course, totals, published }) => (
                    <button
                      type="button"
                      key={course.courseCode}
                      className="uc-course-row"
                      aria-haspopup="dialog"
                      onClick={() => setOpenCode(course.courseCode)}
                    >
                      <span className="uc-course-row-id">
                        <span className="uc-course-row-code uc-num">{course.courseCode}</span>
                        <span className="uc-course-row-title">{course.courseTitle}</span>
                        <span className="uc-course-row-tags">
                          <i className="uc-course-kind">{COURSE_KIND_LABEL[totals.kind]}</i>
                          {totals.incomplete && <i className="uc-course-flag">Incomplete</i>}
                          {published?.grade && <i className="uc-course-grade">Grade {published.grade}</i>}
                        </span>
                      </span>
                      <span className="uc-course-row-figs">
                        {rowFigures(totals).map((f) => (
                          <span key={f.label}>
                            <small>{f.label}</small>
                            <b className="uc-num">{f.value}</b>
                          </span>
                        ))}
                      </span>
                      <ChevronRight size={16} aria-hidden="true" className="uc-course-row-caret" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="uc-grades-body">
                <div className="uc-empty">
                  <LineChart size={20} aria-hidden="true" />
                  <strong>Marks not synced yet</strong>
                  <p>
                    Re-sync from <b>Login</b> to see your CAT / assignment marks here —
                    they appear once VTOP publishes them.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* LMS vs VTOP marks mismatch detection */}
          <MarksMismatchAlert courseMarks={courseMarks} lmsGradebook={lmsGradebook} />

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
        <section className="uc-plate uc-grades-plate">
          <header className="uc-plate-head">
            <div className="uc-grades-id">
              <h3 className="uc-grades-title">Grade History</h3>
              <p className="uc-note">Final letter grades from VTOP — per-course this semester and your cumulative grade distribution.</p>
            </div>
            <span className="uc-marker uc-marker--quiet uc-marker--sm" aria-hidden="true"><GraduationCap size={16} /></span>
          </header>
          <div className="uc-grades-body">

          {!semesterGrades?.available && !gradeHistory?.available ? (
            <div className="uc-note-row">
              <Info size={14} aria-hidden="true" />
              <span>
                Grade history not synced yet — re-sync from <b>Login</b> after your FAT grades are published.
              </span>
            </div>
          ) : (
            <div className="uc-hist">
              <div className="uc-hist-col">
                <div className="uc-sub">
                  <p className="uc-cap">Cumulative CGPA</p>
                  <div className="uc-hist-figrow">
                    <p className="uc-hist-figure uc-num">{cgpaHidden ? '••••' : publishedGpaLabel(gradeHistory?.cgpa ?? grades?.cgpa, '—')}</p>
                    <p className="uc-hist-figsub uc-num">
                      {gradeHistory?.creditsEarned != null ? `${gradeHistory.creditsEarned} / ${gradeHistory.creditsRegistered ?? '—'} credits earned` : 'credits unavailable'}
                    </p>
                  </div>
                </div>

                {gradeHistory?.gradeCounts && (
                  <div className="uc-sub">
                    <p className="uc-cap">Grade Distribution (all semesters)</p>
                    <div className="uc-grade-grid">
                      {(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'N'] as const).map((g) => (
                        <span key={g} className={`uc-grade-chip ${GRADE_TINT[g]}`}>
                          {g}: {gradeHistory!.gradeCounts![g] ?? 0}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {gradeHistory && gradeHistory.effectiveGrades.length > 0 && (
                  <div className="uc-sub uc-sub--scroll">
                    <p className="uc-cap">Effective Grades</p>
                    <div className="uc-hist-list">
                      {gradeHistory.effectiveGrades.map((eg, i) => (
                        <div key={i} className="uc-hist-row">
                          <span className="uc-hist-row-name">{eg.basketTitle || '—'}</span>
                          <span className="uc-hist-row-tail">
                            {eg.creditsEarned != null && <span className="uc-hist-row-cr">{eg.creditsEarned} CR</span>}
                            <span className={`uc-grade-chip ${gradeTint(eg.grade)}`}>{eg.grade}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="uc-sub">
                <div className="uc-sub-head">
                  <p className="uc-cap">This Semester's Grades</p>
                  {semesterGrades?.gpa != null && (
                    <span className="uc-hist-gpa uc-num">GPA {gpaLabel(semesterGrades.gpa)}</span>
                  )}
                </div>
                {semesterGrades && semesterGrades.grades.length > 0 ? (
                  <div className="uc-hist-list uc-hist-list--tall">
                    {semesterGrades.grades.map((g, i) => (
                      <div key={i} className="uc-hist-row">
                        <span className="min-w-0">
                          <span className="uc-hist-row-code">{g.courseCode}</span>
                          <span className="uc-hist-row-sub">{g.courseTitle} · {g.courseType || '—'}</span>
                        </span>
                        <span className="uc-hist-row-tail">
                          {g.grandTotal != null && <span className="uc-hist-row-cr">{g.grandTotal}/100</span>}
                          <span className={`uc-grade-chip ${gradeTint(g.grade)}`}>{g.grade || '—'}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="uc-grades-note">No grades published for this semester yet — check back after your FAT exams.</p>
                )}
              </div>
            </div>
          )}

          {/* ---------- Credit / Degree progress (VTOP grade-history page) ---------- */}
          {curriculum?.available && curriculum.totals.creditsRequired > 0 && (
            <div className="uc-sub uc-hist-block">
              <div className="uc-block-head">
                <span className="uc-marker uc-marker--quiet uc-marker--sm" aria-hidden="true"><Layers size={14} /></span>
                <div className="uc-grades-id">
                  <p className="uc-grades-title">Credit Progress</p>
                  <p className="uc-note">Degree requirements vs. what you've earned (from VTOP)</p>
                </div>
              </div>
              <div className="uc-hist-block-body">
                <div className="uc-hist-line">
                  <span>Total credits</span>
                  <b className="uc-num">{curriculum.totals.creditsEarned} / {curriculum.totals.creditsRequired}</b>
                </div>
                <div className="uc-hist-bar">
                  <i style={{ width: `${Math.min(100, (curriculum.totals.creditsEarned / curriculum.totals.creditsRequired) * 100)}%` }} />
                </div>
                {curriculum.totals.cgpa != null && (
                  <p className="uc-hist-figsub uc-num">CGPA {cgpaHidden ? '••••' : gpaLabel(curriculum.totals.cgpa)} · {curriculum.totals.creditsRegistered} registered</p>
                )}
              </div>
              {curriculum.distributionTypes.length > 0 && (
                <div className="uc-hist-table">
                  <table className="uc-grades-table">
                    <thead>
                      <tr>
                        <th scope="col">Category</th>
                        <th scope="col">Required</th>
                        <th scope="col">Earned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {curriculum.distributionTypes.map((row, i) => (
                        <tr key={i}>
                          <td className="uc-grades-table-key">{row.name}</td>
                          <td className="uc-grades-table-num">{row.required}</td>
                          <td className="uc-grades-table-earned">{row.earned}</td>
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
            <div className="uc-sub uc-sub--alert uc-hist-block">
              <div className="uc-block-head">
                <span className="uc-marker uc-marker--alert uc-marker--sm" aria-hidden="true"><AlertTriangle size={14} /></span>
                <div className="uc-grades-id">
                  <p className="uc-grades-title">Arrears / Backlogs</p>
                  <p className="uc-note">Courses from earlier semesters still to be cleared (from VTOP)</p>
                </div>
              </div>
              <div className="uc-hist-table">
                <table className="uc-grades-table">
                  <thead>
                    <tr>
                      <th scope="col">Course</th>
                      <th scope="col">Semester</th>
                      <th scope="col">Credits</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {arrears.map((a, i) => (
                      <tr key={i}>
                        <td>
                          <span className="uc-grades-table-key">{a.courseCode}</span>
                          <span className="uc-grades-table-title">{a.courseTitle}</span>
                        </td>
                        <td className="uc-grades-table-num">{a.semesterName}</td>
                        <td className="uc-grades-table-num">{a.credits}</td>
                        <td>
                          <span className="uc-grades-chiprow">
                            <span className={`uc-grade-chip ${a.status === 'Cleared' ? 'uc-panel-safe' : a.status === 'Registered' ? 'uc-panel-info' : 'uc-panel-critical'}`}>
                              {a.status}
                            </span>
                            {a.grade && <span className="uc-grade-chip">{a.grade}</span>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </div>
        </section>
      )}

      {/* ---------- Simulator tab ---------- */}
      {tab === 'simulator' && (
        <WhatIfMarksSimulator marks={courseMarks} regNo={regNo} />
      )}

      {/* ---------- Grade Predictor tab ---------- */}
      {tab === 'predictor' && (
        <section className="uc-plate uc-grades-plate">
          <header className="uc-plate-head">
            <div className="uc-grades-id">
              <h3 className="uc-grades-title">Grade Predictor</h3>
              <p className="uc-note">A planning estimate from your marks and VTOP's weights — VTOP decides your official grades.</p>
            </div>
            <span className="uc-marker uc-marker--quiet uc-marker--sm" aria-hidden="true"><TrendingUp size={16} /></span>
          </header>
          <div className="uc-grades-body">
          {hasMarks ? (
            <GradePredictor
              marks={courseMarks}
              regNo={regNo}
              timetable={timetable}
              semesterId={semesterId}
              cumulativeCgpa={grades?.available && grades.cgpa !== null ? grades.cgpa : null}
              cumulativeCreditsEarned={grades?.available && grades.creditsEarned !== null ? grades.creditsEarned : null}
              gradeHistory={gradeHistory}
              publishedGrades={publishedGrades}
              creditsByCourse={creditsByCourse}
              share={{ on: sharing, status: shareStatus, toggle: toggleSharing }}
            />
          ) : (
            <div className="uc-empty">
              <LineChart size={20} aria-hidden="true" />
              <strong>Marks not synced yet</strong>
              <p>The grade predictor needs your CAT / assignment marks.</p>
            </div>
          )}
          </div>
        </section>
      )}

      {openView && (
        <CourseDetailsDialog
          course={openView.course}
          totals={openView.totals}
          context={contextFor(openView.course)}
          publishedGrade={openView.published?.grade ?? null}
          share={{ on: sharing, status: shareStatus, toggle: toggleSharing }}
          onClose={() => setOpenCode(null)}
        />
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
    <div className="uc-note-row uc-note-row--warn uc-note-row--stack">
      <p className="uc-note-row-head">
        <AlertCircle size={13} aria-hidden="true" />
        LMS vs VTOP marks mismatch
      </p>
      {mismatches.slice(0, 5).map((m, i) => (
        <p key={i} className="uc-note-row-line">
          <span className="uc-num">{m.courseCode}</span> {m.detail}
        </p>
      ))}
      {mismatches.length > 5 && (
        <p className="uc-note-row-line">… and {mismatches.length - 5} more mismatches</p>
      )}
      <p className="uc-note-row-foot">This is informational only — verify with your faculty if you're close to a grade cutoff.</p>
    </div>
  );
}

