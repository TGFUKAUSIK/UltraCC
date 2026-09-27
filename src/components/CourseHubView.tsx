import React from 'react';
import { ArrowLeft, FileText, Timer, Award, AlertTriangle, BookOpen, GraduationCap } from 'lucide-react';
import { CourseMarks } from '../types';
import { LmsAssignment, LmsQuizWindow, LmsGradeItem, LmsMaterial, LmsForumPost } from '../lib/lms/types';
import { detectMismatches } from '../lib/lms/mismatch';
import { GradePredictor } from './GradePredictor';
import { getInternalMarksSummary } from '../utils/internalMarks';
import { isEvaluatedAssessment } from '../utils/assessmentStatus';
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
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

/** VTOP course codes (CSE2009, MAT2001, CHE1001L) — what the Syllabus tab keys on. */
const VTOP_COURSE_CODE = /^[A-Z]{3,4}\d{4}$/;

export const CourseHubView: React.FC<CourseHubViewProps> = ({ courseCode, courseTitle, marks, faculty, lmsData, onBack, onOpenSyllabus }) => {
  const mismatches = marks && lmsData ? detectMismatches(lmsData.gradebook, marks) : [];

  return (
    <div className="space-y-6 pb-12">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-zinc-900 transition cursor-pointer"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>

      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg acc-soft acc-text border acc-border">{courseCode}</span>
              {faculty && <span className="text-[11px] text-zinc-500">{faculty}</span>}
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight mt-2">{courseTitle}</h2>
          </div>
          {/* Syllabus lives on its own tab and is keyed by VTOP course code, so
              the action only appears when this hub was opened for a real code —
              an LMS course name would deep-link to nothing. The whole feature is
              currently withdrawn from navigation (src/lib/navVisibility.ts), and
              a course page is navigation, so the button follows the flag. */}
          {!isNavHidden('syllabus') && onOpenSyllabus && VTOP_COURSE_CODE.test(courseCode) && (
            <button
              onClick={() => onOpenSyllabus(courseCode.toUpperCase())}
              className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 rounded-2xl border border-zinc-200 bg-zinc-50 hover:bg-white text-[11px] font-bold text-zinc-700 transition cursor-pointer shrink-0"
            >
              <FileText className="h-3.5 w-3.5 acc-text" /> Syllabus
            </button>
          )}
        </div>

        {/* Marks mismatch alert — non-blocking, never auto-resolved */}
        {mismatches.length > 0 && (
          <div className="mt-5 space-y-2">
            {mismatches.map((m, i) => (
              <div key={i} className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 text-xs flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-amber-700">Marks mismatch: {m.component}</p>
                  <p className="text-amber-700/80 mt-0.5">{m.detail}</p>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-zinc-500 px-1">This could be a data sync delay or faculty entry error — worth checking with faculty if you're close to a grade cutoff.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* VTOP marks */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2 mb-4">
            <GraduationCap className="h-4 w-4 acc-text" /> VTOP Marks
          </h3>
          {marks ? (
            <div className="space-y-2 text-xs">
              {([['CAT 1', marks.cat1], ['CAT 2', marks.cat2], ['DA 1', marks.da1], ['DA 2', marks.da2], ['DA 3', marks.da3], ['Quiz', marks.quiz]] as const).map(([label, c]) => (
                <div key={label} className="flex justify-between p-2.5 bg-zinc-50 rounded-xl border border-zinc-200">
                  <span className="text-zinc-500">{label}</span>
                  <span className="font-mono text-zinc-900 font-bold">
                    {isEvaluatedAssessment(c)
                      ? `${c!.scored}/${c!.max}`
                      : (c && ((c.max ?? 0) > 0 || (c.weightage ?? 0) > 0)
                        ? <span className="text-[10px] text-zinc-500 font-sans font-medium">Pending</span>
                        : '—')}
                  </span>
                </div>
              ))}
              <div className="flex justify-between p-2.5 bg-zinc-50 rounded-xl border border-zinc-200">
                <span className="text-zinc-500">Estimated</span>
                <span className="font-mono text-emerald-600 font-bold">{getInternalMarksSummary(marks)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Marks not synced for this course.</p>
          )}
        </div>

        {/* LMS assignments + quizzes */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2 mb-4">
            <FileText className="h-4 w-4 acc-text" /> LMS Assignments
          </h3>
          {lmsData && lmsData.assignments.length > 0 ? (
            <div className="space-y-2">
              {lmsData.assignments.map((a) => (
                <div key={a.assignmentId} className="p-2.5 bg-zinc-50 rounded-xl border border-zinc-200 text-xs">
                  <p className="font-bold text-zinc-900">{a.name}</p>
                  <p className="text-[10px] text-zinc-500 font-mono mt-0.5">Due {fmtDate(a.dueDate)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No LMS assignments synced.</p>
          )}

          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2 mt-6 mb-3">
            <Timer className="h-4 w-4 acc-text" /> Quiz Windows
          </h3>
          {lmsData && lmsData.quizzes.length > 0 ? (
            <div className="space-y-2">
              {lmsData.quizzes.map((q) => (
                <div key={q.quizId} className="p-2.5 bg-zinc-50 rounded-xl border border-zinc-200 text-xs">
                  <p className="font-bold text-zinc-900">{q.name}</p>
                  <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                    Opens {fmtDate(q.openTime)} • Closes {fmtDate(q.closeTime)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No quiz windows synced.</p>
          )}
        </div>

        {/* LMS materials + forum */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2 mb-4">
            <BookOpen className="h-4 w-4 acc-text" /> Materials
          </h3>
          {lmsData && lmsData.materials.length > 0 ? (
            <div className="space-y-1.5">
              {lmsData.materials.slice(0, 6).map((m) => (
                <a
                  key={m.materialId}
                  href={m.downloadUrl || undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="block p-2.5 bg-zinc-50 rounded-xl border border-zinc-200 text-xs text-zinc-900 hover:border-zinc-300 transition"
                >
                  {m.name}
                </a>
              ))}
              {lmsData.materials.length > 6 && (
                <p className="text-[10px] text-zinc-500">+{lmsData.materials.length - 6} more in the Materials tab</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No materials synced.</p>
          )}

          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2 mt-6 mb-3">
            <Award className="h-4 w-4 acc-text" /> Announcements
          </h3>
          {lmsData && lmsData.forum.length > 0 ? (
            <div className="space-y-1.5">
              {lmsData.forum.slice(0, 4).map((p) => (
                <div key={p.postId} className="p-2.5 bg-zinc-50 rounded-xl border border-zinc-200 text-xs">
                  <p className="font-bold text-zinc-900">{p.title}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{p.bodyText}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No announcements synced.</p>
          )}
        </div>
      </div>

      {/* Grade predictor for this course */}
      {marks && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
          <GradePredictor marks={[marks]} />
        </div>
      )}
    </div>
  );
};
