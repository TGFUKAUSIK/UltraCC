/**
 * The Grade Prediction section of a course's detail sheet.
 *
 * It answers one question and refuses the ones it cannot: how does this
 * student's internal pace compare with the class, on the marks that class
 * actually shared. It never converts the comparison into a letter grade —
 * nobody's final grade is decided by internal marks alone — and it never shows
 * a figure from a group smaller than the privacy floor.
 */

import React, { useEffect, useState } from 'react';
import { Info, Users } from 'lucide-react';
import type { CourseMarks } from '../types';
import type { CourseTotals } from '../utils/courseTotals';
import {
  MIN_COHORT_SIZE,
  cohortKeyOf,
  fetchCohortStats,
  readCohortStats,
  type ContributionContext,
  type CohortStats,
} from '../lib/gradeSharing';

export interface ShareControl {
  on: boolean;
  status: 'idle' | 'saving' | 'error';
  toggle: (next: boolean) => void;
}

interface GradePredictionPanelProps {
  course: CourseMarks;
  totals: CourseTotals;
  context: ContributionContext;
  share: ShareControl;
}

type FetchState =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; stats: CohortStats };

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export const GradePredictionPanel: React.FC<GradePredictionPanelProps> = ({ course, totals, context, share }) => {
  // Only a class VTOP has graded has a pace to compare, and only a class the
  // server can label gets a group. A registered lab with no rows asks nothing.
  const classes = totals.classes.filter((c) => !c.unpublished && c.percent !== null);
  const keys = classes.map((c) => cohortKeyOf({
    courseCode: course.courseCode,
    term: context.term,
    regulation: context.regulation,
    faculty: context.faculty,
    slot: context.slot,
    component: c.part === 'L' ? 'lab' : 'theory',
    stage: 'internal',
  }));
  const signature = keys.join('~');

  const [states, setStates] = useState<Record<string, FetchState>>({});

  useEffect(() => {
    if (!signature) return undefined;
    let cancelled = false;
    setStates(Object.fromEntries(keys.map((k) => [k, { state: 'loading' } as FetchState])));
    void Promise.all(keys.map(async (key, i) => {
      try {
        const stats = await fetchCohortStats({
          courseCode: course.courseCode,
          term: context.term,
          regulation: context.regulation,
          faculty: context.faculty,
          slot: context.slot,
          component: classes[i].part === 'L' ? 'lab' : 'theory',
          stage: 'internal',
        });
        return [key, { state: 'ready', stats } as FetchState] as const;
      } catch {
        return [key, { state: 'error' } as FetchState] as const;
      }
    })).then((entries) => {
      if (!cancelled) setStates(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <section className="uc-predict" aria-labelledby="uc-predict-title">
      <header className="uc-predict-head">
        <p className="uc-cap">Beta feature — Grade prediction</p>
        <h3 id="uc-predict-title">How you compare</h3>
        <p className="uc-predict-lede">
          Your internal pace next to the class average, on the marks students chose to share.
          This is not a final grade — VTOP decides that, and it includes your FAT.
        </p>
      </header>

      {classes.length === 0 ? (
        <p className="uc-predict-note">
          VTOP has not graded an internal mark for this course yet, so there is nothing to compare.
        </p>
      ) : (
        <div className="uc-predict-rows">
          {classes.map((c, i) => {
            const key = keys[i];
            const own = c.percent as number;
            const fetched = states[key];
            return (
              <div className="uc-predict-row" key={key}>
                <div className="uc-predict-row-head">
                  <span className="uc-predict-class">{c.label}</span>
                  <b className="uc-num">{pct(own)} of graded internal weight</b>
                </div>
                {!fetched || fetched.state === 'loading' ? (
                  <p className="uc-predict-note">Checking how your class compares…</p>
                ) : fetched.state === 'error' ? (
                  <p className="uc-predict-note">
                    Peer comparison is unavailable right now. Your own pace above is unaffected.
                  </p>
                ) : (() => {
                  const reading = readCohortStats(fetched.stats, own);
                  if (reading.level === 'none') {
                    return (
                      <p className="uc-predict-note">
                        Not enough comparable data for a reliable grade estimate.
                        {reading.count > 0
                          ? ` ${reading.count} shared so far; ${MIN_COHORT_SIZE} are needed before figures are shown.`
                          : ''}
                      </p>
                    );
                  }
                  return (
                    <>
                      <dl className="uc-predict-stats">
                        <div><dt>Class mean</dt><dd className="uc-num">{pct(reading.mean as number)}</dd></div>
                        <div><dt>Std. deviation</dt><dd className="uc-num">{reading.sd === null ? '—' : reading.sd.toFixed(2)}</dd></div>
                        <div>
                          <dt>You vs class</dt>
                          <dd className="uc-num">
                            {(reading.difference as number) >= 0 ? '+' : ''}{(reading.difference as number).toFixed(2)} pts
                          </dd>
                        </div>
                        <div>
                          <dt>Typical range</dt>
                          <dd className="uc-num">
                            {reading.band ? `${pct(reading.band[0])} – ${pct(reading.band[1])}` : '—'}
                          </dd>
                        </div>
                      </dl>
                      <p className="uc-predict-note uc-predict-count">
                        <Users size={12} aria-hidden="true" />
                        From {reading.count} shared internal marks — a sample, not your official class strength.
                      </p>
                      {reading.warning && <p className="uc-predict-warn">{reading.warning}</p>}
                    </>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      <div className="uc-predict-share">
        <div className="uc-predict-share-head">
          <span id="uc-predict-share-label">Share my marks with UltraCC</span>
          <button
            type="button"
            role="switch"
            aria-checked={share.on}
            aria-labelledby="uc-predict-share-label"
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
          Your class totals become part of an anonymous average for this course, faculty and slot.
          Other students see that average — never your individual marks. This browser keeps a
          random ID only so a re-sync updates your entry and turning sharing off removes it.
        </p>
        {share.status === 'saving' && <p className="uc-predict-note">Updating your contribution…</p>}
        {share.status === 'error' && (
          share.on ? (
            <p className="uc-predict-warn">
              UltraCC could not reach the sharing service, so your marks are not being added to
              the average right now. Try again, or turn sharing off.
            </p>
          ) : (
            <p className="uc-predict-warn">
              UltraCC could not confirm the withdrawal. Your earlier contribution may still be
              stored — try again so it is removed.
            </p>
          )
        )}
      </div>
    </section>
  );
};
