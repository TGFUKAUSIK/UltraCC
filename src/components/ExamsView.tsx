import React, { useState } from 'react';
import { ExamSchedule } from '../types';
import { MakeupExamRecord, RefatInfo, CompreInfo, ArrearRecord } from '../lib/vtop/types';
import { Layers, Clock, MapPin, CheckSquare, AlertTriangle, ShieldCheck, FileCheck, Repeat, CalendarClock, Info, CalendarPlus, AlertOctagon, Image as ImageIcon } from 'lucide-react';
import { exportExamsImage } from '../utils/imageExport';
import { exportExamsToIcs, downloadIcs, isExamCalendarReady } from '../utils/icalExport';
import { istDateLabel } from '../utils/examUtils';

interface ExamsViewProps {
  exams: ExamSchedule[];
  /** Makeup exam schedule (semester-scoped, from VTOP). */
  makeupExams?: MakeupExamRecord[];
  /** Re-exam / reFAT eligibility + courses. */
  refat?: RefatInfo | null;
  /** Compre exam registration status. */
  compre?: CompreInfo | null;
  /** Backlog (arrear) courses from VTOP — pending ones are exam candidates. */
  arrears?: ArrearRecord[];
  onNavigateMap: (building: string) => void;
}

const hasExamValue = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && normalized !== '-' && normalized !== '—' && normalized !== 'n/a' && normalized !== 'na');
};

const examValue = (value: string | undefined | null, fallback: string) => (
  hasExamValue(value) ? value!.trim() : fallback
);

export const ExamsView: React.FC<ExamsViewProps> = ({ exams, makeupExams, refat, compre, arrears, onNavigateMap }) => {
  const [examDayMode, setExamDayMode] = useState<boolean>(false);
  const [examFilter, setExamFilter] = useState<'All' | ExamSchedule['examType']>('All');
  // Per-topic check state keyed by exam id + topic index (ids are unique;
  // course codes may be empty on the real VTOP exam page).
  const [syllabusState, setSyllabusState] = useState<{ [key: string]: boolean }>({});

  const toggleTopic = (key: string) => {
    setSyllabusState((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const activeExams = exams.filter((exam) => {
    if (!exam.date) return true;
    // VTOP dates are India calendar dates, so compare the ISO labels.
    // `new Date('2026-08-18')` is UTC midnight, which against local midnight
    // drops today's exam entirely on any device west of Greenwich.
    const iso = exam.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return true;
    return iso >= istDateLabel();
  }).filter((exam) => examFilter === 'All' || exam.examType === examFilter);
  const calendarReadyExams = activeExams.filter((exam) => isExamCalendarReady(exam));

  return (
    <div className="exams-view space-y-6 pb-12">
      {/* Header Banner Bento Card */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-1">
              CAT 1, CAT 2, FAT, makeup and re-examination seating
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-900 flex items-center gap-2 tracking-tight">
              <Layers className="h-6 w-6 text-rose-600" />
              Examination schedule & seating
            </h2>
            <p className="text-sm text-zinc-500 mt-1 font-medium">
              CAT / FAT / makeup / re-exam schedules and seating from VTOP — carry your VIT student ID card.
            </p>
          </div>

          {/* Exam Day Mode Toggle */}
          <button
            onClick={() => setExamDayMode(!examDayMode)}
            className={`px-4 py-2.5 rounded-2xl text-xs font-extrabold border transition flex items-center space-x-2 cursor-pointer ${
              examDayMode
                ? 'bg-rose-600 text-zinc-900 border-rose-500 shadow-lg shadow-rose-900/30'
                : 'bg-white text-zinc-900 border-zinc-200 hover:border-zinc-200'
            }`}
          >
            <ShieldCheck className="h-4 w-4 text-amber-600" />
            <span>{examDayMode ? 'EXAM-DAY MODE ACTIVE' : 'Enable Exam-Day Mode'}</span>
          </button>
          {calendarReadyExams.length > 0 && (
            <button
              onClick={() => {
                const ics = exportExamsToIcs(calendarReadyExams.map(e => ({
                  id: e.id, slot: e.slot || '', courseCode: e.courseCode, courseTitle: e.courseTitle,
                  examType: e.examType, date: e.date, time: e.time, venue: e.venue,
                  seatNo: e.seatNo, syllabusTopics: [],
                })));
                downloadIcs(ics, 'ultracc-exam-schedule.ics');
              }}
              className="p-2.5 rounded-2xl bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 transition cursor-pointer"
              title="Add all exams to calendar"
            >
              <CalendarPlus className="h-4 w-4" />
            </button>
          )}
          {calendarReadyExams.length > 0 && (
            <button
              onClick={() => exportExamsImage(calendarReadyExams.map(e => ({
                courseCode: e.courseCode, courseTitle: e.courseTitle, examType: e.examType,
                date: e.date, time: e.time, venue: e.venue, seatNo: e.seatNo,
              })), {})}
              className="p-2.5 rounded-2xl bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 transition cursor-pointer"
              title="Download exam schedule as image"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="exam-filter-bar" aria-label="Filter examination schedule">
        <span>Examination schedule</span>
        {(['All', 'CAT 1', 'CAT 2', 'FAT', 'Lab FAT', 'Other'] as const).filter((filter) => filter === 'All' || exams.some((exam) => exam.examType === filter)).map((filter) => <button key={filter} className={examFilter === filter ? 'selected' : ''} onClick={() => setExamFilter(filter)}>{filter}</button>)}
      </div>

      {/* Exam Day Mode Banner if Active */}
      {examDayMode && (
        <div className="p-6 bg-white border border-rose-500/40 rounded-3xl shadow-xl space-y-4">
          <div className="flex items-center space-x-2 text-rose-700 font-extrabold text-sm">
            <AlertTriangle className="h-5 w-5 text-amber-600 animate-bounce" />
            <span>EXAM-DAY MODE: MANDATORY CHECKLIST BEFORE LEAVING HOSTEL</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-zinc-900">
            <div className="p-3.5 bg-zinc-50 rounded-2xl border border-rose-500/20 flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="font-bold">Physical VIT Student ID Card</span>
            </div>
            <div className="p-3.5 bg-zinc-50 rounded-2xl border border-rose-500/20 flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="font-bold">Approved Non-Programmable Calculator &amp; Pens</span>
            </div>
            <div className="p-3.5 bg-zinc-50 rounded-2xl border border-rose-500/20 flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="font-bold">No Smartwatches &amp; Phones inside Hall</span>
            </div>
          </div>
        </div>
      )}

      {/* Examination schedule: compact record table on desktop, stacked records on mobile. */}
      {activeExams.length > 0 ? <div className="exam-schedule-panel">
        <div className="exam-table-wrap">
          <table className="exam-schedule-table">
            <thead><tr><th scope="col">Assessment</th><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Venue / seat</th><th scope="col" aria-label="Actions" /></tr></thead>
            <tbody>{activeExams.map((exam) => <tr key={exam.id}>
              <td><span className="exam-type-label">{exam.examType}</span><strong>{exam.courseCode || (exam.slot ? `Slot ${exam.slot}` : 'Examination')}</strong><small>{exam.courseTitle || 'Course name not provided by VTOP'}</small>{exam.syllabusTopics.length > 0 && <details className="exam-syllabus-details"><summary>Syllabus progress: {exam.syllabusTopics.filter((_, idx) => syllabusState[`${exam.id}-${idx}`]).length}/{exam.syllabusTopics.length}</summary>{exam.syllabusTopics.map((topic, idx) => { const key = `${exam.id}-${idx}`; const isDone = Boolean(syllabusState[key]); return <button type="button" key={key} onClick={() => toggleTopic(key)} className={isDone ? 'done' : ''}><CheckSquare />{topic}</button>; })}</details>}</td>
              <td><strong>{examValue(exam.date, 'Not released yet')}</strong></td>
              <td>{examValue(exam.time, 'Not released yet')}</td>
              <td><span>{hasExamValue(exam.venue) ? exam.venue : 'Not available yet'}</span><small>{hasExamValue(exam.seatNo) ? `Seat ${exam.seatNo}` : 'Seat not released'}</small></td>
              <td><div className="exam-row-actions">{hasExamValue(exam.venue) && <button onClick={() => onNavigateMap(exam.venue)} title="Locate venue"><MapPin /></button>}{isExamCalendarReady(exam) && <button onClick={() => downloadIcs(exportExamsToIcs([{ ...exam }]), `ultracc-${exam.courseCode || exam.examType}.ics`)} title="Add to calendar"><CalendarPlus /></button>}</div></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="exam-mobile-list">{activeExams.map((exam) => <article key={exam.id} className="exam-mobile-row"><div className="exam-mobile-top"><span className="exam-type-label">{exam.examType}</span><strong>{examValue(exam.date, 'Not released yet')}</strong></div><h3>{exam.courseCode || (exam.slot ? `Slot ${exam.slot}` : 'Examination')}</h3><p>{exam.courseTitle || 'Course name not provided by VTOP'}</p><dl><div><dt>Time</dt><dd>{examValue(exam.time, 'Not released yet')}</dd></div><div><dt>Venue</dt><dd>{hasExamValue(exam.venue) ? exam.venue : 'Not available yet'}</dd></div><div><dt>Seat</dt><dd>{hasExamValue(exam.seatNo) ? exam.seatNo : 'Not released'}</dd></div></dl><div className="exam-row-actions">{hasExamValue(exam.venue) && <button onClick={() => onNavigateMap(exam.venue)}><MapPin /> Locate venue</button>}{isExamCalendarReady(exam) && <button onClick={() => downloadIcs(exportExamsToIcs([{ ...exam }]), `ultracc-${exam.courseCode || exam.examType}.ics`)}><CalendarPlus /> Add to calendar</button>}</div></article>)}</div>
      </div> : <div className="exam-empty-state">No examination records match this filter. Examination data is shown only when provided by VTOP.</div>}

      {/* ---------- Arrears / backlog (from VTOP) ---------- */}
      <ArrearsSection arrears={arrears} />

      {/* ---------- Special exams: makeup / re-exam / compre (from VTOP) ---------- */}
      {(makeupExams && makeupExams.length > 0) || (refat && refat.available) || (compre && compre.available) ? (
        <>
          {/* Makeup Exams */}
          {makeupExams && makeupExams.length > 0 && (
            <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
              <div className="flex items-center space-x-3 mb-5">
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-600">
                  <Repeat className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Makeup Exams</h3>
                  <p className="text-xs text-zinc-500 font-medium">From VTOP — carry your VIT student ID card</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {makeupExams.map((ex) => (
                  <div key={ex.id} className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-zinc-900">{ex.courseCode || (ex.slot ? `Slot ${ex.slot}` : '—')}</span>
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/25 font-extrabold uppercase tracking-wider text-[10px]">
                        {ex.examType}
                      </span>
                    </div>
                    {ex.courseTitle && <p className="text-zinc-500 truncate">{ex.courseTitle}</p>}
                    <p className="text-zinc-900 font-mono"><Clock className="h-3 w-3 inline mr-1 text-amber-600" />{ex.date}{ex.time ? ` · ${ex.time}` : ''}</p>
                    {ex.venue && <p className="text-zinc-500"><MapPin className="h-3 w-3 inline mr-1 text-blue-600" />{ex.venue}{ex.seatNo ? ` · Seat ${ex.seatNo}` : ''}</p>}
                    <p className="text-[10px] text-zinc-500">{ex.semesterName}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Re-exam / reFAT */}
          {refat && refat.available && (
            <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
              <div className="flex items-center space-x-3 mb-5">
                <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-2xl text-sky-600">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Re-exam / Re-FAT</h3>
                  <p className="text-xs text-zinc-500 font-medium">Eligibility from VTOP — carry your VIT student ID card</p>
                </div>
              </div>
              {refat.status && (
                <p className="text-xs text-zinc-900 mb-3 font-medium">{refat.status}</p>
              )}
              {refat.semesters.length > 0 ? (
                <div className="space-y-3">
                  {refat.semesters.filter((s) => s.courses.length > 0).map((s) => (
                    <div key={s.id} className="p-3 bg-zinc-50 border border-zinc-200 rounded-2xl">
                      <p className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 mb-2">{s.name}</p>
                      <div className="flex flex-wrap gap-2">
                        {s.courses.map((c) => (
                          <span key={c.courseCode} className="px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/25 text-sky-700 font-mono text-[11px]">
                            {c.courseCode}{c.courseTitle && c.courseTitle !== c.courseCode ? ` · ${c.courseTitle}` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">No re-exam courses listed by VTOP for your profile.</p>
              )}
            </div>
          )}

          {/* Compre Exam */}
          {compre && compre.available && (
            <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
              <div className="flex items-center space-x-3 mb-3">
                <div className="p-2.5 bg-violet-500/10 border border-violet-500/20 rounded-2xl text-violet-600">
                  <Info className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Comprehensive Examination</h3>
                  <p className="text-xs text-zinc-500 font-medium">Registration status from VTOP</p>
                </div>
              </div>
              <p className={`text-xs font-bold ${compre.status && /closed|not eligible|no/i.test(compre.status) ? 'text-rose-600' : 'text-emerald-600'}`}>
                {compre.status || 'Registration open'}
              </p>
              {compre.message && <p className="text-xs text-zinc-500 mt-1">{compre.message}</p>}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

/**
 * Arrears / backlog courses straight from VTOP. Pending or registered
 * arrears are shown as exam candidates; cleared ones are counted, never
 * invented. Empty state is honest: no data ≠ no arrears.
 */
const ArrearsSection: React.FC<{ arrears?: ArrearRecord[] }> = ({ arrears }) => {
  if (!arrears || arrears.length === 0) return null;
  const pending = arrears.filter((a) => a.status !== 'Cleared');
  const cleared = arrears.length - pending.length;
  return (
    <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
      <div className="flex items-center space-x-3 mb-5">
        <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-600">
          <AlertOctagon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Arrears / Backlog</h3>
          <p className="text-xs text-zinc-500 font-medium">From VTOP — register for the arrear exam when the window opens</p>
        </div>
      </div>
      {pending.length > 0 ? (
        <div className="space-y-3">
          {Array.from(pending.reduce((acc, a) => {
            const list = acc.get(a.semesterName) ?? [];
            list.push(a);
            acc.set(a.semesterName, list);
            return acc;
          }, new Map<string, ArrearRecord[]>()).entries()).map(([semester, courses]) => (
            <div key={semester} className="p-3 bg-zinc-50 border border-zinc-200 rounded-2xl">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 mb-2">{semester}</p>
              <div className="flex flex-wrap gap-2">
                {courses.map((c) => (
                  <span key={`${c.courseCode}-${c.semesterId}`} className="px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-700 font-mono text-[11px]">
                    {c.courseCode}{c.courseTitle && c.courseTitle !== c.courseCode ? ` · ${c.courseTitle}` : ''}
                    {c.status === 'Registered' ? ' · registered' : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-emerald-600 font-bold">All previously listed arrears are cleared.</p>
      )}
      {cleared > 0 && <p className="text-[10px] text-zinc-500 mt-3">{cleared} previously pending course{cleared > 1 ? 's' : ''} cleared.</p>}
    </div>
  );
};
