/**
 * Grade Predictor — what this semester is heading for, in one screen.
 *
 * Four tiles answer the whole question (SGPA, CGPA, the letters, how much of
 * this is actually known); the course list below lets a student change one FAT
 * estimate and watch the grade, the SGPA and the CGPA move together. Every
 * number comes from `gradeProjection`, which owns the scene and is the only
 * place a letter is decided, so this panel cannot print a relative B above an
 * absolute C for the same course.
 *
 * Nothing here is official. VTOP decides grades; this is a planning figure
 * built on the weightage VTOP published and the marks it has returned.
 */

import React, { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, Info, RotateCcw, TrendingUp, Users } from 'lucide-react';
import type { CourseMarks, TimetableSlot } from '../types';
import type { GradeHistory } from '../lib/vtop/types';
import {
  GRADE_ORDER,
  GRADE_POINTS,
  buildCourseModel,
  gpaLabel,
  projectedPercentLabel,
} from '../utils/gradeModel';
import {
  SCENARIO_LABEL,
  SCENARIO_ORDER,
  SCENARIO_STEP,
  cgpaOf,
  gpaImpactOf,
  projectCourse,
  semesterGpaOf,
  withScenario,
  type Confidence,
  type CourseProjection,
  type Scenario,
} from '../utils/gradeProjection';
import {
  MIN_COHORT_SIZE,
  cohortKeyOf,
  contextOf,
  fetchCohortStats,
  readCohortStats,
  type CohortKey,
  type CohortStats,
} from '../lib/gradeSharing';
import type { ShareControl } from './GradePredictionPanel';

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

function gradeTint(grade: string | null): string {
  return GRADE_TINT[(grade ?? '').trim().toUpperCase()] ?? 'uc-panel-unknown';
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'Not enough data',
};

const CONFIDENCE_RANK: Record<Confidence, number> = { none: 0, low: 1, medium: 2, high: 3 };

/** What the student typed for one course's assumed class curve. */
interface ManualStats {
  mean: string;
  sd: string;
}

function manualReadingOf(manual: ManualStats | undefined): { count: number; mean: number; sd: number } | null {
  if (!manual || manual.mean.trim() === '' || manual.sd.trim() === '') return null;
  const mean = Number(manual.mean);
  const sd = Number(manual.sd);
  if (!Number.isFinite(mean) || mean < 0 || mean > 100) return null;
  if (!Number.isFinite(sd) || sd <= 0) return null;
  return { count: 0, mean, sd };
}

function rangeLabel(row: CourseProjection): string {
  if (row.publishedGrade) return 'VTOP';
  if (!row.range) return 'no projection';
  const [conservative, optimistic] = row.range;
  return conservative === optimistic ? `likely ${conservative}` : `likely ${optimistic}–${conservative}`;
}

interface GradePredictorProps {
  marks: CourseMarks[];
  /** VTOP register number — decides the theory/lab rule and the batch's regulation. */
  regNo?: string;
  /** Timetable rows, the only source of a course's faculty for the class cohort. */
  timetable?: TimetableSlot[];
  /** The selected semester — the term a shared mark belongs to. */
  semesterId?: string;
  /** VTOP's published CGPA and earned credits, the denominators a CGPA rides. */
  cumulativeCgpa?: number | null;
  cumulativeCreditsEarned?: number | null;
  gradeHistory?: GradeHistory | null;
  /** Course code → the letter VTOP has already posted for it. */
  publishedGrades?: Record<string, string>;
  /** Course code → registered credits, when the marks record carries none. */
  creditsByCourse?: Record<string, number>;
  share?: ShareControl;
}

export const GradePredictor: React.FC<GradePredictorProps> = ({
  marks,
  regNo,
  timetable,
  semesterId,
  cumulativeCgpa,
  cumulativeCreditsEarned,
  gradeHistory,
  publishedGrades,
  creditsByCourse,
  share,
}) => {
  const uid = useId();
  const shareLabelId = `${uid}-share`;
  const [scenario, setScenario] = useState<Scenario>('expected');
  const [openCode, setOpenCode] = useState<string | null>(null);
  /** Course code → the FAT percentage the student expects. */
  const [fatEdits, setFatEdits] = useState<Record<string, number>>({});
  /** Course code → a class curve the student typed. Never mixed with class data. */
  const [manual, setManual] = useState<Record<string, ManualStats>>({});
  const [cohort, setCohort] = useState<{ loading: boolean; stats: Record<string, CohortStats | null> }>({
    loading: false,
    stats: {},
  });

  // One cohort request per course, keyed by everything that makes two classes
  // comparable. A course with no term or batch has no cohort to ask about.
  const cohortTargets = useMemo(() => marks.flatMap((course) => {
    const context = contextOf(course, timetable ?? [], { term: semesterId, regNo });
    if (!context.term || !context.regulation) return [];
    const model = buildCourseModel(course, { regNo });
    const component = (model.parts.theory?.gradedWeight ?? 0) > 0 ? 'theory' : 'lab';
    const key: CohortKey = { courseCode: course.courseCode, ...context, component, stage: 'internal' };
    return [{ courseCode: course.courseCode, key }];
  }), [marks, timetable, semesterId, regNo]);
  const cohortSignature = cohortTargets.map((t) => cohortKeyOf(t.key)).join('~');

  useEffect(() => {
    if (!cohortTargets.length) {
      setCohort({ loading: false, stats: {} });
      return undefined;
    }
    let cancelled = false;
    setCohort({ loading: true, stats: {} });
    void Promise.all(cohortTargets.map(async ({ courseCode, key }) => {
      try {
        return [courseCode, await fetchCohortStats(key)] as const;
      } catch {
        return [courseCode, null] as const;
      }
    })).then((entries) => {
      if (!cancelled) setCohort({ loading: false, stats: Object.fromEntries(entries) });
    });
    return () => { cancelled = true; };
    // cohortSignature is the content of cohortTargets; the array identity is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohortSignature]);

  const projections = useMemo(() => marks.map((course) => {
    const typed = manualReadingOf(manual[course.courseCode]);
    const stats = cohort.stats[course.courseCode];
    const fromClass = stats && !stats.suppressed && stats.mean !== null && stats.sd !== null
      && stats.count >= MIN_COHORT_SIZE
      ? { count: stats.count, mean: stats.mean, sd: stats.sd, source: 'class' as const }
      : null;
    const classStats = typed ? { ...typed, source: 'manual' as const } : fromClass;
    return projectCourse(course, {
      regNo,
      classStats,
      publishedGrade: publishedGrades?.[course.courseCode] ?? null,
      fatPercent: fatEdits[course.courseCode] ?? null,
    });
  }), [marks, regNo, publishedGrades, fatEdits, manual, cohort.stats]);

  // The one reading the tiles and the course rows both show: the selected
  // scenario, so a student who picks "conservative" sees a conservative SGPA.
  const rows = useMemo(
    () => projections.map((row) => withScenario(row, scenario)),
    [projections, scenario],
  );

  const semester = useMemo(() => semesterGpaOf(rows, creditsByCourse ?? {}), [rows, creditsByCourse]);
  const impacts = useMemo(() => gpaImpactOf(rows, creditsByCourse ?? {}), [rows, creditsByCourse]);

  const history = useMemo(() => (
    gradeHistory?.effectiveGrades?.map((g) => ({ credits: g.creditsEarned, grade: g.grade })) ?? null
  ), [gradeHistory]);
  const previousCgpa = cumulativeCgpa ?? gradeHistory?.cgpa ?? null;
  const previousCredits = cumulativeCreditsEarned ?? gradeHistory?.creditsEarned ?? null;
  const cgpa = useMemo(
    () => cgpaOf({ semester, history, previousCgpa, previousCredits }),
    [semester, history, previousCgpa, previousCredits],
  );

  const counted = rows.filter((r) => r.counted);
  const compared = counted.filter((r) => r.basis === 'relative').length;
  const openCourses = counted.filter((r) => r.pending.length > 0).length;
  const overall = counted.reduce<Confidence>(
    (worst, r) => (CONFIDENCE_RANK[r.confidence] < CONFIDENCE_RANK[worst] ? r.confidence : worst),
    'high',
  );
  const tally = GRADE_ORDER
    .map((g) => [g, counted.filter((r) => r.grade === g).length] as const)
    .filter(([, n]) => n > 0);

  const hasCustom = Object.keys(fatEdits).length > 0
    || Object.keys(manual).length > 0;

  const setFat = (code: string, value: number) => {
    if (!Number.isFinite(value)) return;
    setFatEdits((prev) => ({ ...prev, [code]: Math.min(100, Math.max(0, Math.round(value))) }));
  };
  const setManualValue = (code: string, field: keyof ManualStats, value: string) => {
    setManual((prev) => ({
      ...prev,
      [code]: { mean: '', sd: '', ...prev[code], [field]: value },
    }));
  };
  const reset = () => {
    setFatEdits({});
    setManual({});
  };

  if (!marks.length) {
    return (
      <div className="uc-empty">
        <TrendingUp size={20} aria-hidden="true" />
        <strong>No marks to predict from</strong>
        <p>Sync your VTOP marks first — the predictor works from your CAT, DA and quiz marks.</p>
      </div>
    );
  }

  return (
    <div className="uc-pred">
      <div className="uc-pred-bar">
        <p className="uc-note">
          A planning estimate from your own marks. VTOP decides your official grade.
        </p>
        {hasCustom && (
          <button type="button" className="uc-pred-reset" onClick={reset}>
            <RotateCcw size={13} aria-hidden="true" /> Reset estimates
          </button>
        )}
      </div>

      <div className="uc-pred-tiles">
        <div className="uc-pred-tile">
          <span>Predicted SGPA</span>
          <b className="uc-num">{semester.sgpa === null ? '—' : gpaLabel(semester.sgpa)}</b>
          <p>
            {semester.courses > 0
              ? `${semester.courses} course${semester.courses === 1 ? '' : 's'} · ${semester.credits} credits counted`
              : 'No course has a grade to count yet'}
          </p>
        </div>
        <div className="uc-pred-tile">
          <span>Predicted CGPA</span>
          <b className="uc-num">
            {cgpa.cgpa === null ? '—' : <>{cgpa.mode === 'approximate' ? '≈ ' : ''}{gpaLabel(cgpa.cgpa)}</>}
          </b>
          <p>{previousCgpa !== null ? `VTOP now ${gpaLabel(previousCgpa)}` : 'No published CGPA yet'}</p>
        </div>
        <div className="uc-pred-tile">
          <span>Expected grades</span>
          {tally.length > 0 ? (
            <p className="uc-pred-tally">
              {tally.map(([g, n]) => (
                <i key={g} className={`uc-pred-grade ${gradeTint(g)}`}>{g} × {n}</i>
              ))}
            </p>
          ) : (
            <b>—</b>
          )}
          <p>{counted.length} course{counted.length === 1 ? '' : 's'} counted</p>
        </div>
        <div className="uc-pred-tile">
          <span>Prediction confidence</span>
          <b>{CONFIDENCE_LABEL[overall]}</b>
          <p>
            {compared} of {counted.length} compared with your class · {openCourses} still being assessed
          </p>
        </div>
      </div>

      {cgpa.note && <p className="uc-pred-sub">{cgpa.note}</p>}
      {semester.excluded.length > 0 && (
        <p className="uc-pred-sub">
          Left out of the GPA: {semester.excluded.map((e) => e.courseCode).join(', ')} — {semester.excluded[0].reason}.
        </p>
      )}
      {semester.missingCredits.length > 0 && (
        <p className="uc-pred-sub">
          No credits synced for {semester.missingCredits.join(', ')}, so they are left out rather than weighted as
          a guess.
        </p>
      )}
      {semester.missingGrades.length > 0 && (
        <p className="uc-pred-sub">
          Nothing graded yet in {semester.missingGrades.join(', ')} — left out, never counted as an F.
        </p>
      )}

      <div className="uc-seg" role="group" aria-label="FAT scenario">
        {SCENARIO_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={scenario === s}
            className={scenario === s ? 'is-on' : ''}
            onClick={() => setScenario(s)}
          >
            {SCENARIO_LABEL[s]}
          </button>
        ))}
      </div>
      <p className="uc-pred-sub">
        Expected uses the FAT estimate you set for each course — your own internal pace until you move it.
        Conservative and optimistic are {SCENARIO_STEP} points either side, and all three move the grades, the
        SGPA and the CGPA together.
      </p>

      <div className="uc-pred-list">
        {rows.map((row, i) => {
          const open = openCode === row.courseCode;
          const panelId = `${uid}-detail-${i}`;
          const fatId = `${uid}-fat-${i}`;
          const meanId = `${uid}-mean-${i}`;
          const sdId = `${uid}-sd-${i}`;
          const fatValue = row.scenarios.expected.fatPercent;
          const typed = manual[row.courseCode];
          const stats = cohort.stats[row.courseCode];
          const reading = stats ? readCohortStats(stats, row.pace) : null;
          const readingAt = row.scenarios[scenario];

          return (
            <div className="uc-pred-course" key={row.courseCode}>
              <button
                type="button"
                className="uc-course-row uc-pred-course-row"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenCode(open ? null : row.courseCode)}
              >
                <span className="uc-course-row-id">
                  <span className="uc-course-row-code uc-num">{row.courseCode}</span>
                  <span className="uc-course-row-title">{row.courseTitle}</span>
                  <span className="uc-course-row-tags">
                    <i className="uc-course-kind">{row.structure}</i>
                    <i className="uc-course-kind">{row.credits !== null ? `${row.credits} cr` : 'credits not synced'}</i>
                    {!row.counted && <i className="uc-course-flag">Not counted</i>}
                  </span>
                </span>
                <span className="uc-course-row-figs">
                  {row.figures.filter((f) => f.value !== null).map((f) => (
                    <span key={f.label}>
                      <small>{f.label}</small>
                      <b className="uc-num">{f.value}</b>
                    </span>
                  ))}
                  <span className="uc-pred-verdict">
                    <i className={`uc-pred-grade ${gradeTint(row.grade)}`}>{row.grade ?? '—'}</i>
                    <small>{rangeLabel(row)}</small>
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={`uc-course-row-caret${open ? ' is-open' : ''}`}
                />
              </button>

              {open && (
                <div className="uc-pred-detail" id={panelId}>
                  {row.fat.open ? (
                    <div className="uc-pred-field">
                      <label htmlFor={fatId}>
                        What do you expect in the {row.fat.part === 'Lab' ? 'lab' : 'theory'} FAT?
                      </label>
                      <div className="uc-pred-slider">
                        <input
                          id={fatId}
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={fatValue}
                          onChange={(e) => setFat(row.courseCode, Number(e.target.value))}
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={fatValue}
                          aria-label="FAT percentage"
                          className="uc-pred-input uc-num"
                          onChange={(e) => setFat(row.courseCode, Number(e.target.value))}
                        />
                        <span>% of the {row.fat.max}-mark paper</span>
                      </div>
                      <p className="uc-pred-sub">
                        {row.pace === null
                          ? 'Nothing is graded yet, so this starts at half the paper.'
                          : `Your internal pace is ${Math.round(row.pace)}%.`}
                        {' '}Conservative {row.scenarios.conservative.fatPercent}% · expected{' '}
                        {row.scenarios.expected.fatPercent}% · optimistic {row.scenarios.optimistic.fatPercent}%.
                      </p>
                      {row.scenarios.conservative.fatPercent < 40 && (
                        <p className="uc-pred-warn">
                          Under 40% on the FAT paper is an F course, however strong the internals are.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="uc-pred-sub">
                      {row.fat.weight > 0
                        ? 'The FAT is already graded, so VTOP’s own mark decides this course.'
                        : 'VTOP has not published a final-exam weight for this course, so there is no FAT to model.'}
                    </p>
                  )}

                  <dl className="uc-pred-dl">
                    <div>
                      <dt>Projected total · {SCENARIO_LABEL[scenario].toLowerCase()}</dt>
                      <dd className="uc-num">
                        {projectedPercentLabel(readingAt.percent)}
                        {readingAt.percent !== null ? ' / 100' : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Projected grade</dt>
                      <dd className="uc-num">{readingAt.grade ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Grade points</dt>
                      <dd className="uc-num">{readingAt.points ?? '—'}</dd>
                    </div>
                  </dl>

                  {row.pending.length > 0 && (
                    <p className="uc-pred-sub">Still to be assessed: {row.pending.join(', ')}.</p>
                  )}

                  <p className="uc-pred-sub">{row.confidenceNote}</p>

                  <div className="uc-pred-compare">
                    <p className="uc-pred-label">
                      <Users size={12} aria-hidden="true" /> Your class
                    </p>
                    {row.classStats?.source === 'manual' ? (
                      <p className="uc-pred-sub">
                        Using the mean you set ({row.classStats.mean}% ± {row.classStats.sd}) — your assumption,
                        not classmates’ marks.
                      </p>
                    ) : reading?.level === 'ok' ? (
                      <>
                        <dl className="uc-pred-dl">
                          <div><dt>Class mean</dt><dd className="uc-num">{reading.mean?.toFixed(1)}%</dd></div>
                          <div><dt>Spread</dt><dd className="uc-num">{reading.sd === null ? '—' : reading.sd.toFixed(2)}</dd></div>
                          <div>
                            <dt>You vs class</dt>
                            <dd className="uc-num">
                              {(reading.difference ?? 0) >= 0 ? '+' : ''}{(reading.difference ?? 0).toFixed(1)} pts
                            </dd>
                          </div>
                          <div>
                            <dt>Typical range</dt>
                            <dd className="uc-num">
                              {reading.band ? `${reading.band[0].toFixed(1)}–${reading.band[1].toFixed(1)}%` : '—'}
                            </dd>
                          </div>
                        </dl>
                        <p className="uc-pred-sub">
                          From {reading.count} shared internal marks in this course, term, faculty and slot — a
                          sample, not your class strength.
                        </p>
                        {reading.warning && <p className="uc-pred-warn">{reading.warning}</p>}
                      </>
                    ) : (
                      <p className="uc-pred-sub">
                        {cohort.loading
                          ? 'Checking how your class compares…'
                          : stats === null
                            ? 'Peer comparison is unavailable right now. Your own projection is unaffected.'
                            : `Not enough same-class marks to compare${reading && reading.count > 0 ? ` (${reading.count} shared, ${MIN_COHORT_SIZE} needed)` : ''}, so VIT’s published bands decide the letter.`}
                      </p>
                    )}

                    <div className="uc-pred-manual">
                      <label htmlFor={meanId}>
                        Class mean (your assumption)
                        <input
                          id={meanId}
                          type="number"
                          min={0}
                          max={100}
                          inputMode="numeric"
                          value={typed?.mean ?? ''}
                          placeholder="—"
                          className="uc-pred-input uc-num"
                          onChange={(e) => setManualValue(row.courseCode, 'mean', e.target.value)}
                        />
                      </label>
                      <label htmlFor={sdId}>
                        Spread
                        <input
                          id={sdId}
                          type="number"
                          min={0}
                          max={50}
                          inputMode="numeric"
                          value={typed?.sd ?? ''}
                          placeholder="—"
                          className="uc-pred-input uc-num"
                          onChange={(e) => setManualValue(row.courseCode, 'sd', e.target.value)}
                        />
                      </label>
                      {typed && (
                        <button
                          type="button"
                          className="uc-pred-reset"
                          onClick={() => setManual((prev) => {
                            const next = { ...prev };
                            delete next[row.courseCode];
                            return next;
                          })}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="uc-pred-sub">
                      A mean you type is labelled an assumption and stays on this device. It is never shown as
                      class data, and the confidence above drops to say so.
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {impacts.length > 0 && (
        <section className="uc-pred-impact">
          <p className="uc-pred-label">Where a grade step moves your SGPA most</p>
          <p className="uc-pred-sub">
            Ranked by credits × the grade points one step is worth. This is not a reason to study less — every
            open assessment still decides these letters.
          </p>
          <p className="uc-pred-sub">
            If {impacts[0].courseCode} ends on {impacts[0].to} instead of {impacts[0].from}, your predicted SGPA
            moves from {gpaLabel(impacts[0].fromSgpa)} to {gpaLabel(impacts[0].toSgpa)}.
          </p>
          <ul className="uc-pred-impact-list">
            {impacts.map((imp) => (
              <li key={imp.courseCode}>
                <span className="uc-num">{imp.courseCode}</span>
                <span className="uc-num">{imp.from} → {imp.to}</span>
                <span className="uc-num">+{gpaLabel(imp.toSgpa - imp.fromSgpa)} SGPA</span>
                <span className="uc-num">{imp.credits} cr</span>
                {imp.remaining.length > 0 && <small>{imp.remaining.join(' · ')}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="uc-pred-adv">
        <summary>How this is calculated</summary>
        <div className="uc-pred-adv-body">
          <p>
            <b>Score.</b> Every course is projected on the weightage VTOP published, and a row it has not graded
            sits at your current pace — never at zero. The FAT is VIT’s 40% of the course. An embedded course’s
            theory and lab combine by the split its registration is under.
          </p>
          <p>
            <b>Letter.</b> One rule per course: once at least {MIN_COHORT_SIZE} students in the same course, term,
            faculty and slot have shared marks, the class mean and spread draw the bands; otherwise VIT’s
            published absolute bands do. A course never shows both. Under either rule, a FAT paper below 40% is
            an F — no internal mark lifts it.
          </p>
          <p>
            <b>GPA.</b> Credits × grade points ({GRADE_ORDER.map((g) => `${g} ${GRADE_POINTS[g]}`).join(' · ')}),
            divided by the credits counted. Pass/fail, audit, Minor, Honours and Second Major courses stay out.
            A course with no grade yet is named and left out, never counted as an F.
          </p>
          <p>
            <b>CGPA.</b> Exact when the grades VTOP has already awarded add up to its earned credits; otherwise
            weighted from the CGPA and credits VTOP published, and marked ≈.
          </p>
          <p>
            <b>What is official.</b> VTOP’s published CGPA and grades are official. Everything else here is a
            prediction, and a student’s scenario is a what-if.
          </p>
          {share && (
            <div className="uc-predict-share">
              <div className="uc-predict-share-head">
                <span id={shareLabelId}>Share my marks with UltraCC</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={share.on}
                  aria-labelledby={shareLabelId}
                  disabled={share.status === 'saving'}
                  onClick={() => share.toggle(!share.on)}
                  className={`uc-predict-switch${share.on ? ' is-on' : ''}`}
                >
                  <i aria-hidden="true" />
                  {share.on ? 'On' : 'Off'}
                </button>
              </div>
              <p className="uc-predict-copy">
                <Info size={12} aria-hidden="true" />
                Your class totals feed an anonymous average for this course, faculty and slot. Other students
                see that average, never your marks. Turning sharing off withdraws your contribution — it never
                changes your own prediction.
              </p>
              {share.status === 'error' && (
                <p className="uc-predict-warn">
                  {share.on
                    ? 'UltraCC could not reach the sharing service, so your marks are not being added right now.'
                    : 'UltraCC could not confirm the withdrawal. Your earlier contribution may still be stored — try again.'}
                </p>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
};
