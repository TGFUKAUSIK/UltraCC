/**
 * One course's detail sheet: what VTOP served, class by class, with the
 * student's own figures and nothing blended that VTOP never printed.
 *
 * Desktop gets a centred modal; a phone gets the same sheet at full height,
 * because a five-column marks table in a 42rem box on a 390px screen would
 * either shrink to unreadable or scroll sideways inside a scrolling dialog.
 */

import React, { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Info } from 'lucide-react';
import type { CourseMarks } from '../types';
import {
  assessmentRowsOf,
  earnedOf,
  type AssessmentRow,
} from '../utils/gradeModel';
import {
  classMarkLabel,
  combinedLabel,
  type CourseTotals,
} from '../utils/courseTotals';
import type { ContributionContext } from '../lib/gradeSharing';
import { useDialog } from '../hooks/useDialog';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useSheetDrag } from '../hooks/useSheetDrag';
import { GradePredictionPanel, type ShareControl } from './GradePredictionPanel';

interface CourseDetailsDialogProps {
  course: CourseMarks;
  totals: CourseTotals;
  context: ContributionContext;
  /** VTOP's published grade for the course, when the grade view posted one. */
  publishedGrade: string | null;
  share: ShareControl;
  onClose: () => void;
}

export const COURSE_KIND_LABEL: Record<CourseTotals['kind'], string> = {
  theory: 'Theory',
  lab: 'Lab',
  embedded: 'Theory + Lab',
};

function rowsFor(course: CourseMarks, part: 'T' | 'L'): AssessmentRow[] {
  return assessmentRowsOf(course).filter((r) => r.part === part);
}

function weight(n: number): string {
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

function Summary({ totals }: { totals: CourseTotals }) {
  const single = totals.classes.length === 1 ? totals.classes[0] : null;
  let figure: string;
  let label: string;
  let note: string;

  if (totals.finalTotal !== null) {
    figure = `${totals.finalTotal.toFixed(1)} / 100`;
    label = 'Course total (VTOP)';
    note = 'VTOP’s published total for the whole course, including the FAT.';
  } else if (totals.combined?.finalMark != null) {
    figure = combinedLabel(totals.combined) ?? '—';
    label = 'Course total';
    note = `Internals out of 60 plus the FAT out of 40. ${totals.combined.basis}.`;
  } else if (totals.combined) {
    figure = `${totals.combined.internalMark.toFixed(1)} / 60`;
    label = 'Internal total';
    note = `The internal half, out of 60 (${totals.combined.basis}). It becomes a /100 course total only once both FATs are graded.`;
  } else if (single?.finalMark != null) {
    figure = `${single.finalMark.toFixed(1)} / 100`;
    label = 'Course total';
    note = 'Internals out of 60 plus the FAT out of 40.';
  } else if (single?.internalMark != null) {
    figure = `${single.internalMark.toFixed(1)} / 60`;
    label = 'Internal total';
    note = single.complete
      ? 'The internal half, out of 60. The FAT is not graded yet, so this is not a /100 course total.'
      : `A pace on the ${weight(single.internalGraded)} of ${weight(single.internalWeight)} internal weight VTOP has graded — out of 60, not yet a /100 course total.`;
  } else {
    figure = '—';
    label = 'Course total';
    note = totals.missing.length
      ? `Not available yet — ${totals.missing.join(', ')} missing.`
      : 'VTOP has not published marks for this course yet.';
  }

  return (
    <div className="uc-course-summary">
      <div className="uc-course-summary-figure">
        <span className="uc-course-summary-label">{label}</span>
        <b className="uc-num">{figure}</b>
        <p>{note}</p>
      </div>
      <dl className="uc-course-summary-classes">
        {totals.classes.map((c) => (
          <div key={c.part}>
            <dt>{c.label}</dt>
            <dd className="uc-num">{classMarkLabel(c) ?? 'Not published'}</dd>
          </div>
        ))}
      </dl>
      {totals.incomplete && totals.missing.length > 0 && (
        <p className="uc-course-summary-missing">
          <Info size={12} aria-hidden="true" />
          Still open: {totals.missing.join(', ')}.
        </p>
      )}
      {totals.splitNote && <p className="uc-course-summary-split">{totals.splitNote}</p>}
    </div>
  );
}

function ClassTable({ label, rows, total }: {
  label: string;
  rows: AssessmentRow[];
  total: CourseTotals['classes'][number] | undefined;
}) {
  return (
    <section className="uc-course-class" aria-label={`${label} assessments`}>
      <header className="uc-course-class-head">
        <h3>{label}</h3>
        <span className="uc-num">{total ? classMarkLabel(total) ?? 'Not published' : '—'}</span>
      </header>
      {rows.length === 0 ? (
        <p className="uc-course-class-empty">
          VTOP has not published this {label.toLowerCase()}’s marks yet.
        </p>
      ) : (
        <div className="uc-course-table-wrap">
          <table className="uc-course-table">
            <thead>
              <tr>
                <th scope="col">Test</th>
                <th scope="col">Max</th>
                <th scope="col">Scored</th>
                <th scope="col">Weight %</th>
                <th scope="col">Weighted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.title}</th>
                  <td className="uc-num">{r.max}</td>
                  <td className="uc-num">{r.scored === null ? <em>Pending</em> : r.scored}</td>
                  <td className="uc-num">{r.weightage > 0 ? r.weightage : '—'}</td>
                  <td className="uc-num">{r.scored === null ? '—' : earnedOf(r).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
            {total && total.declared > 0 && (
              <tfoot>
                <tr>
                  <th scope="row">{total.complete ? 'Total' : 'Graded so far'}</th>
                  <td />
                  <td />
                  <td className="uc-num">{total.declared}</td>
                  <td className="uc-num">{total.earned.toFixed(1)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

export const CourseDetailsDialog: React.FC<CourseDetailsDialogProps> = ({
  course, totals, context, publishedGrade, share, onClose,
}) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialog<HTMLDivElement>({ isOpen: true, onClose, initialFocus: closeRef });
  useBodyScrollLock(true);
  const drag = useSheetDrag({ onDismiss: onClose });

  const faculty = context.faculty || 'Faculty not synced';
  const slot = context.slot || 'Slot not synced';
  const theory = totals.classes.find((c) => c.part === 'T');
  const lab = totals.classes.find((c) => c.part === 'L');

  // `main` is a scroll container, so a fixed sheet inside it paints under the
  // app bar; mounting on body puts the whole sheet, and its close button, on top.
  return createPortal(
    <div
      className="uc-scrim fixed inset-0 z-[80] flex items-center justify-center uc-course-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="uc-plate uc-sheet uc-course-sheet"
        style={drag.offset ? { transform: `translateY(${drag.offset}px)` } : undefined}
      >
        <header className={`uc-sheet-head uc-course-head is-draggable${drag.dragging ? ' is-dragging' : ''}`} {...drag.handlers}>
          <div className="uc-course-head-id">
            <p className="uc-course-code uc-num">{course.courseCode}</p>
            <h2 id={titleId}>{course.courseTitle}</h2>
            <p className="uc-course-meta">
              {faculty} · {slot} · {COURSE_KIND_LABEL[totals.kind]}
              {publishedGrade ? ` · Grade ${publishedGrade}` : ''}
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="uc-sheet-close"
            onClick={onClose}
            aria-label="Close course details"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="uc-sheet-body uc-course-body">
          <Summary totals={totals} />
          {theory && <ClassTable label="Theory" rows={rowsFor(course, 'T')} total={theory} />}
          {lab && <ClassTable label="Lab" rows={rowsFor(course, 'L')} total={lab} />}
          <GradePredictionPanel course={course} totals={totals} context={context} share={share} />
        </div>
      </div>
    </div>,
    document.body,
  );
};
