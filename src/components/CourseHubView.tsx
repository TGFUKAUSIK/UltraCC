import React from 'react';
import { ArrowLeft, FileText, Timer, Award, AlertTriangle, BookOpen } from 'lucide-react';
import { CourseMarks } from '../types';
import { LmsAssignment, LmsQuizWindow, LmsGradeItem, LmsMaterial, LmsForumPost } from '../lib/lms/types';
import { detectMismatches } from '../lib/lms/mismatch';
import { GradePredictor } from './GradePredictor';
import { internalMarksValueLabel } from '../utils/internalMarks';
import { assessmentRowsOf } from '../utils/gradeModel';
import { formatTimestamp } from '../utils/timestamp';
import { isNavHidden } from '../lib/navVisibility';

interface CourseHubViewProps {
  courseCode: string;
  courseTitle: string;
  /** VTOP marks for this course (may be empty pre-sync). */
  marks: CourseMarks | null;
  /** VTOP faculty (from timetable/attendance) if known. */
  faculty?: string;
  lmsData: {
    assignments: LmsAssignment[];
    quizzes: LmsQuizWindow[];
    gradebook: LmsGradeItem[];
    materials: LmsMaterial[];
    forum: LmsForumPost[];
  } | null;
  onBack: () => void;
  /** Opens this course's entry on the Syllabus tab (VTOP's own file).
   *  Optional so the hub still renders where the tab is unreachable. */
  onOpenSyllabus?: (courseCode: string) => void;
  /** VTOP register number — its first two digits decide the theory/lab rule. */
  regNo?: string;
}

/** VTOP course codes (CSE2009, MAT2001, CHE1001L) — what the Syllabus tab keys on. */
const VTOP_COURSE_CODE = /^[A-Z]{3,4}\d{4}$/;

/**
 * One course, and every source the app holds on it: VTOP marks, the LMS
 * assignment and quiz windows, the LMS shelf and the announcements board.
 * Identity leads in its own band, then each source keeps its own plate — a fact
 * row stays a fact row, a library stays a library — so the screen never becomes
 * one card repeated five times.
 *
 * Wide screens put the sourced panels side by side; a phone keeps the same order
 * stacked, so nothing moves between the two.
 */
export const CourseHubView: React.FC<CourseHubViewProps> = ({ courseCode, courseTitle, marks, faculty, lmsData, onBack, onOpenSyllabus, regNo }) => {
  const mismatches = marks && lmsData ? detectMismatches(lmsData.gradebook, marks) : [];
  // Syllabus lives on its own tab and is keyed by VTOP course code, so the
  // action only appears when this hub was opened for a real code — an LMS course
  // name would deep-link to nothing. The whole feature is currently withdrawn
  // from navigation (src/lib/navVisibility.ts), and a course page is navigation,
  // so the button follows the flag.
  const canOpenSyllabus = !isNavHidden('syllabus') && onOpenSyllabus ? VTOP_COURSE_CODE.test(courseCode) : false;
  const materialsShown = lmsData ? lmsData.materials.slice(0, 6) : [];
  const announcementsShown = lmsData ? lmsData.forum.slice(0, 4) : [];

  return (
    <div className="uc-hub pb-12">
      <button className="uc-dir-back" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
      </button>

      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap uc-num">{courseCode}</span>
            <h2 className="uc-dir-name">{courseTitle}</h2>
            {faculty && <p className="uc-note">{faculty}</p>}
          </div>
          {canOpenSyllabus && (
            <div className="uc-dir-rail">
              <button className="uc-dir-go" onClick={() => onOpenSyllabus(courseCode.toUpperCase())}>
                <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Syllabus
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Marks mismatch — non-blocking, never auto-resolved */}
      {mismatches.length > 0 && (
        <section className="uc-plate">
          <div className="uc-plate-head">
            <span className="uc-cap">Marks mismatch</span>
            <span className="uc-dir-count">{mismatches.length}</span>
          </div>
          <div className="uc-dir-detail">
            <div className="uc-dir-form">
              {mismatches.map((m, i) => (
                <div key={`${m.component}-${i}`} className="uc-note-row uc-note-row--warn">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <span><b>{m.component}</b> — {m.detail}</span>
                </div>
              ))}
              <span className="uc-dir-sub">This could be a data sync delay or a faculty entry error — worth checking with faculty if you are close to a grade cutoff.</span>
            </div>
          </div>
        </section>
      )}

      <div className="uc-hub-cols">
        {/* VTOP marks — the source assessment titles, exactly as VTOP serves them. */}
        <section className="uc-plate" aria-label="VTOP marks">
          <div className="uc-plate-head">
            <span className="uc-cap">VTOP marks</span>
          </div>
          {marks ? (
            <dl className="uc-facts">
              {/* Every internal row VTOP published, in VTOP's own titles. The old
                  table walked six fixed slots, so a lab's experiments, a PAT or an
                  "Assessment - N" simply never appeared here. */}
              {assessmentRowsOf(marks)
                .filter((row) => !row.isFat)
                .map((row) => (
                  <div key={row.key}>
                    <dt>{row.title}</dt>
                    <dd className="uc-num">
                      {row.scored !== null ? `${row.scored}/${row.max}` : 'Pending'}
                    </dd>
                  </div>
                ))}
              <div>
                <dt>Internal</dt>
                <dd className="uc-num">{internalMarksValueLabel(marks) ?? '—'}</dd>
              </div>
            </dl>
          ) : (
            <div className="uc-empty"><span>Marks not synced for this course yet.</span></div>
          )}
        </section>

        {/* LMS assignments */}
        <section className="uc-plate uc-dir-ledger" aria-label="LMS assignments">
          <div className="uc-plate-head">
            <span className="uc-cap">LMS assignments</span>
            <span className="uc-dir-count">{lmsData?.assignments.length ?? 0}</span>
          </div>
          {lmsData && lmsData.assignments.length > 0 ? (
            lmsData.assignments.map((a) => (
              <div key={a.assignmentId} className="uc-dir-row uc-dir-row--media">
                <span className="uc-dir-tile"><FileText className="h-4 w-4" aria-hidden="true" /></span>
                <div className="uc-dir-main">
                  <span className="uc-dir-title">{a.name}</span>
                  <span className="uc-dir-meta">Due {formatTimestamp(a.dueDate)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="uc-dir-blank">No LMS assignments synced for this course.</div>
          )}
        </section>

        {/* LMS quiz windows */}
        <section className="uc-plate uc-dir-ledger" aria-label="LMS quiz windows">
          <div className="uc-plate-head">
            <span className="uc-cap">Quiz windows</span>
            <span className="uc-dir-count">{lmsData?.quizzes.length ?? 0}</span>
          </div>
          {lmsData && lmsData.quizzes.length > 0 ? (
            lmsData.quizzes.map((q) => (
              <div key={q.quizId} className="uc-dir-row uc-dir-row--media">
                <span className="uc-dir-tile"><Timer className="h-4 w-4" aria-hidden="true" /></span>
                <div className="uc-dir-main">
                  <span className="uc-dir-title">{q.name}</span>
                  <span className="uc-dir-meta">Opens {formatTimestamp(q.openTime)} · Closes {formatTimestamp(q.closeTime)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="uc-dir-blank">No quiz windows synced for this course.</div>
          )}
        </section>

        {/* LMS shelf */}
        <section className="uc-plate uc-dir-ledger" aria-label="LMS materials">
          <div className="uc-plate-head">
            <span className="uc-cap">Materials</span>
            <span className="uc-dir-count">{lmsData?.materials.length ?? 0}</span>
          </div>
          {materialsShown.length > 0 ? (
            materialsShown.map((m) => (
              <a
                key={m.materialId}
                className="uc-dir-row uc-dir-row--media"
                href={m.downloadUrl || undefined}
                target="_blank"
                rel="noreferrer"
              >
                <span className="uc-dir-tile"><BookOpen className="h-4 w-4" aria-hidden="true" /></span>
                <div className="uc-dir-main">
                  <span className="uc-dir-title">{m.name}</span>
                  <span className="uc-dir-meta">{m.downloadUrl ? 'Opens in a new tab' : 'No file attached'}</span>
                </div>
              </a>
            ))
          ) : (
            <div className="uc-dir-blank">No materials synced for this course.</div>
          )}
          {lmsData && lmsData.materials.length > materialsShown.length && (
            <div className="uc-plate-foot">
              <span>+{lmsData.materials.length - materialsShown.length} more in the Materials tab</span>
            </div>
          )}
        </section>

        {/* Announcements */}
        <section className="uc-plate uc-dir-ledger" aria-label="Course announcements">
          <div className="uc-plate-head">
            <span className="uc-cap">Announcements</span>
            <span className="uc-dir-count">{lmsData?.forum.length ?? 0}</span>
          </div>
          {announcementsShown.length > 0 ? (
            announcementsShown.map((p) => (
              <div key={p.postId} className="uc-dir-row uc-dir-row--media">
                <span className="uc-dir-tile"><Award className="h-4 w-4" aria-hidden="true" /></span>
                <div className="uc-dir-main">
                  <span className="uc-dir-title">{p.title}</span>
                  {p.bodyText && <span className="uc-dir-meta uc-dir-meta--clip">{p.bodyText}</span>}
                </div>
              </div>
            ))
          ) : (
            <div className="uc-dir-blank">No announcements synced for this course.</div>
          )}
        </section>

        {/* Grade predictor for this course */}
        {marks && (
          <section className="uc-plate">
            <div className="uc-dir-detail">
              <GradePredictor marks={[marks]} regNo={regNo} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
