import React, { useMemo, useState } from 'react';
import { Gauge } from 'lucide-react';
import { AttendanceRecord, CourseMarks } from '../types';
import { buildCourseIntelRows, CourseIntel, TargetGrade } from '../utils/courseIntel';
import { componentLabel } from '../utils/attendanceComponents';
import { attendancePercentLabel } from '../utils/attendanceBands';
import { useTargetAttendance } from '../lib/attendanceTarget';
import { courseTone } from '../utils/courseTone';

/**
 * CourseIntelView — compact per-course analytics from data VTOP already
 * provides. Reuses the safe-bunk and grade-band arithmetic; never invents
 * grades or marks.
 *
 * One ledger, a row per course component, each keyed to the same course colour
 * the timetable and the home board use, so a course reads the same here as it
 * does everywhere else. The two meters are the same two the home course card
 * shows — attended and marks — so the same course cannot look like two
 * different things on two screens.
 */

const TARGET_GRADES: TargetGrade[] = ['S', 'A', 'B', 'C', 'D', 'E'];
const TARGETS_KEY = 'ultracc.courseIntel.targets';

function readTargets(): Record<string, TargetGrade> {
  try {
    const raw = localStorage.getItem(TARGETS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, TargetGrade>) : {};
  } catch {
    return {};
  }
}

export const CourseIntelView: React.FC<{
  attendance: AttendanceRecord[];
  marks: CourseMarks[];
  /** VTOP register number — its first two digits decide the theory/lab rule. */
  regNo?: string;
}> = ({ attendance, marks, regNo }) => {
  const [targets, setTargets] = useState<Record<string, TargetGrade>>(() => readTargets());
  // The same bar the Academics slider sets, read live: these rows render on
  // that screen, so a bunk count here must move when the slider moves.
  const [targetPercent] = useTargetAttendance();

  const rows = useMemo(
    () => buildCourseIntelRows(attendance, marks, targets, targetPercent, regNo),
    [attendance, marks, targets, targetPercent, regNo],
  );

  const setTarget = (code: string, grade: TargetGrade) => {
    setTargets((prev) => {
      const next = { ...prev, [code]: grade };
      try { localStorage.setItem(TARGETS_KEY, JSON.stringify(next)); } catch { /* device-local only */ }
      return next;
    });
  };

  return (
    <div className="uc-dir-view pb-12">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">Course intelligence</span>
            <h2 className="uc-dir-name">Where each course stands</h2>
            <p className="uc-note">
              Attendance risk, weighted performance so far and what your target grade still needs — computed from the
              data VTOP has served, never guessed.
            </p>
          </div>
          <div className="uc-dir-rail">
            <span className="uc-dir-tag is-live">Attendance bar {targetPercent}%</span>
          </div>
        </div>
      </section>

      {!rows.length ? (
        // Only when there is nothing at all to compute from — the same condition
        // the analytics themselves use, so an attendance-only sync still lists.
        <section className="uc-plate">
          <div className="uc-dir-detail">
            <div className="uc-note-row">
              <Gauge aria-hidden="true" />
              <span>
                Sync VTOP once and every course gets an attendance risk, a weighted score and a target-grade plan here.
                Nothing on this row is invented — it is all read from the data you have already synced.
              </span>
            </div>
          </div>
        </section>
      ) : (
        <section className="uc-plate uc-dir-ledger" aria-label="Course intelligence by course">
          <div className="uc-plate-head">
            <span className="uc-cap">Courses</span>
            <span className="uc-dir-count">{rows.length} {rows.length === 1 ? 'row' : 'rows'}</span>
          </div>
          <div className="uc-courses">
            {rows.map((row) => (
              <CourseRow
                key={`${row.courseCode}-${row.component}`}
                row={row}
                targetGrade={targets[row.courseCode] ?? 'B'}
                onSetTarget={setTarget}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

function CourseRow({ row, targetGrade, onSetTarget }: { key?: React.Key; row: CourseIntel; targetGrade: TargetGrade; onSetTarget: (code: string, grade: TargetGrade) => void }) {
  const att = row.attendance;
  const component = componentLabel(row.component);
  const hasMarks = row.marks.evaluated.length > 0;
  const attWidth = att.percentage === null ? 0 : Math.max(0, Math.min(100, att.percentage));
  const markWidth = hasMarks ? Math.max(0, Math.min(100, row.marks.weightedSoFar)) : 0;

  // One sentence, chosen by what VTOP actually did — and every recovery count
  // quotes the bar it is measured against, so "attend 6 in a row" cannot be
  // read as VTOP's 75% rule rather than the student's own target.
  const attendanceLine = att.totalHeld <= 0
    ? 'No classes conducted yet'
    : att.risk === 'risk'
      ? `Attend ${att.mustAttend} in a row to reach ${row.targetPercent}%`
      : att.risk === 'borderline'
        ? `${att.attended}/${att.totalHeld} — borderline, stay present`
        : `${att.attended}/${att.totalHeld} · ${att.safeBunks} safe bunk${att.safeBunks === 1 ? '' : 's'} at your ${row.targetPercent}%`;

  const marksLine = !hasMarks
    ? 'No graded assessments yet'
    : row.marks.weightRemaining > 0
      // Name the rows VTOP has not graded — "35% ungraded" alone leaves the
      // student guessing which assessment is missing.
      ? `${row.marks.weightRemaining.toFixed(0)}% of course weight still ungraded${
        row.marks.pending.length
          ? ` (${row.marks.pending.slice(0, 3).map((p) => p.name).join(', ')}${row.marks.pending.length > 3 ? ', …' : ''})`
          : ''
      }`
      : 'All graded assessments are in';

  // Only the two definite outcomes are painted; on-track and PENDING-FAT are
  // stated plainly rather than dressed in a colour that implies a verdict.
  const verdictClass = row.target?.status === 'achieved'
    ? 'uc-note-row uc-note-row--good'
    : row.target?.status === 'not_achievable'
      ? 'uc-note-row uc-note-row--risk'
      : 'uc-note-row';

  return (
    <article className="uc-course uc-course--static">
      <span className={`uc-course-rule tone-${courseTone(row.courseCode)}`} aria-hidden="true" />
      <span className="uc-course-head">
        {/* VTOP tracks theory and lab separately — say which half this row is
            about instead of showing two identical-looking rows. */}
        <span>{row.courseCode} · {component}</span>
        <b>{att.percentage !== null ? `${attendancePercentLabel(att.percentage)}%` : '—'}</b>
      </span>
      {row.courseTitle && <strong>{row.courseTitle}</strong>}
      <small>{row.schemeLabel}</small>

      <span className="uc-course-meters">
        <span className="uc-course-meter">
          <span>Attended</span>
          <span
            className="uc-meter"
            role="img"
            aria-label={att.percentage !== null
              ? `${row.courseCode} ${component} attendance ${attendancePercentLabel(att.percentage)} percent`
              : `${row.courseCode} ${component} attendance not recorded`}
          >
            <i style={{ width: `${attWidth}%` }} />
          </span>
          <b>{att.totalHeld > 0 ? `${att.attended}/${att.totalHeld}` : '—'}</b>
        </span>
        <span className="uc-course-meter is-marks">
          <span>Marks</span>
          <span
            className="uc-meter"
            role="img"
            aria-label={hasMarks
              ? `${row.courseCode} weighted marks so far ${row.marks.weightedSoFar.toFixed(1)} of 100`
              : `${row.courseCode} no graded assessments yet`}
          >
            <i style={{ width: `${markWidth}%` }} />
          </span>
          <b>{hasMarks ? `${row.marks.weightedSoFar.toFixed(1)}/100` : '—'}</b>
        </span>
      </span>

      <span className="uc-dir-sub">{attendanceLine}</span>
      <span className="uc-dir-sub">{marksLine}</span>

      <div className={verdictClass}>{row.nextAction}</div>

      {/* A minor action, kept beside the content it changes: pick the grade this
          course is aiming at and the verdict above re-reads against it. */}
      <span className="uc-dir-acts">
        <span className="uc-cap">Target grade</span>
        <select
          value={targetGrade}
          onChange={(e) => onSetTarget(row.courseCode, e.target.value as TargetGrade)}
          aria-label={`Target grade for ${row.courseCode} ${component}`}
          className="uc-dir-select"
        >
          {TARGET_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </span>
    </article>
  );
}
