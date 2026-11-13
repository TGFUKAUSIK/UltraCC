import React, { useState } from 'react';
import { ExamSchedule } from '../types';
import { MakeupExamRecord, RefatInfo, CompreInfo, ArrearRecord } from '../lib/vtop/types';
import { ShieldCheck, MapPin, CheckSquare, FileCheck, Repeat, CalendarClock, Info, CalendarPlus, AlertOctagon, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { exportExamsImage } from '../utils/imageExport';
import { exportExamsToIcs, downloadIcs, isExamCalendarReady } from '../utils/icalExport';
import { calendarDaysUntil, examEndMs, examStartMs, istDateLabel, isSameIstDay, upcomingExams, isRealCalendarDate, NextExam } from '../utils/examUtils';
import { isReal } from '../utils/placeholders';

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

/** Whether VTOP actually stated a field — the shared placeholder rule. */
const hasExamValue = (value?: string | null) => isReal(value);

const examValue = (value: string | undefined | null, fallback: string) => (
  hasExamValue(value) ? value!.trim() : fallback
);

/** What a student was told to bring on the morning of a paper. */
const EXAM_DAY_CHECKS = [
  'Physical VIT student ID card',
  'Approved, non-programmable calculator and pens',
  'No smartwatches or phones inside the hall',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The day and month a paper sits on, for the ledger's date stamp. Read straight
 * from VTOP's own text (both spellings reach the client) rather than through a
 * Date, so no device timezone can move the paper to the day before.
 */
function stampOf(raw?: string | null): { day: string; mon: string } | null {
  const text = (raw ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso && isRealCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))) {
    return { day: iso[3], mon: MONTHS[Number(iso[2]) - 1] ?? iso[2] };
  }
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
  if (dmy && isRealCalendarDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))) {
    return { day: dmy[1].padStart(2, '0'), mon: MONTHS[Number(dmy[2]) - 1] ?? dmy[2] };
  }
  return null;
}

/** "2026-10-08" -> "Thu 08 Oct", falling back to whatever VTOP wrote. */
function friendlyDate(raw?: string | null): string {
  const text = (raw ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!iso) return text || 'Not released';
  const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  // A cached "2026-02-30" must never be dressed up as a real weekday.
  if (!isRealCalendarDate(year, month, day)) return text;
  const ts = Date.UTC(year, month - 1, day);
  return `${WEEKDAYS[new Date(ts).getUTCDay()]} ${iso[3]} ${MONTHS[month - 1] ?? iso[2]}`;
}

/**
 * How far off a paper is, as a student reads it — "Today", "Tomorrow", "in 5
 * days". The distance itself is `calendarDaysUntil`, the one home in the tree
 * for turning a VTOP date into India calendar days, so the hero and the ledger
 * cannot disagree; this only puts that number into words. A ledger row carrying
 * only a date stamp otherwise asks the student to do the sums ("03 Oct … what
 * is today?") to answer the one question the screen exists for. Nothing is said
 * for a paper that is not ahead.
 */
function awayLabel(days: number | null): string | null {
  if (days === null || days < 0) return null;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `in ${days} days`;
}

interface BoardExam {
  exam: ExamSchedule;
  startsAtMs: number;
  /** VTOP published the date but no usable clock time. */
  timePending: boolean;
  /** The paper has begun and the hall clock has not run out yet. */
  running?: boolean;
}

interface BoardRowProps {
  key?: React.Key;
  examType: string;
  code: string;
  title?: string;
  date?: string;
  time?: string;
  venue?: string;
  seatNo?: string;
  /** A semester name, for makeup records. */
  note?: string;
  /** How far off a dated, upcoming paper is — the ledger's own countdown. */
  distance?: string;
  today?: boolean;
  now?: boolean;
  children?: React.ReactNode;
}

/** The seat, boxed wherever it appears: the one number asked for at the door. */
const Seat: React.FC<{ seatNo?: string }> = ({ seatNo }) => {
  const known = hasExamValue(seatNo);
  return (
    <span className={`uc-exams-seat${known ? '' : ' is-quiet'}`}>
      {known ? <><b>{seatNo!.trim()}</b><i>seat</i></> : <i>no seat</i>}
    </span>
  );
};

/**
 * One paper as a ruled board row: the day in a left-hand stamp, the type and
 * code at the top, and the seat hard against the right edge so seating scans
 * down one column. The same row draws a main-ledger paper and a makeup one.
 */
const BoardRow: React.FC<BoardRowProps> = ({ examType, code, title, date, time, venue, seatNo, note, distance, today, now, children }) => {
  const stamp = stampOf(date);
  const when = [
    distance,
    stamp ? null : (date ?? '').trim() || null,
    examValue(time, 'Time not released'),
    hasExamValue(venue) ? venue!.trim() : null,
  ].filter(Boolean).join(' · ');
  return (
    <article className={`uc-exams-row${now ? ' is-now' : ''}${today ? ' is-today' : ''}`}>
      <div className="uc-exams-stamp" aria-hidden="true">
        <i>{stamp ? stamp.day : '··'}</i>
        <em>{stamp ? stamp.mon : 'TBD'}</em>
      </div>
      <div className="uc-exams-row-main">
        <div className="uc-exams-row-top">
          <span className="uc-exams-type">{examType}</span>
          <strong>{code}</strong>
          <Seat seatNo={seatNo} />
        </div>
        {title ? <small className="uc-exams-row-title">{title}</small> : null}
        <small className="uc-exams-row-when">{when}</small>
        {note ? <small className="uc-exams-row-title">{note}</small> : null}
        {now ? <span className="uc-exams-now">In the hall now</span> : null}
        {children}
      </div>
    </article>
  );
};

/** The syllabus checklist a paper carries, as a native disclosure. */
const Syllabus: React.FC<{ key?: React.Key; exam: ExamSchedule; state: { [key: string]: boolean }; onToggle: (key: string) => void }> = ({ exam, state, onToggle }) => {
  const done = exam.syllabusTopics.filter((_, idx) => state[`${exam.id}-${idx}`]).length;
  return (
    <details className="uc-exams-syllabus">
      <summary>
        <ChevronRight className="is-caret" size={14} aria-hidden="true" />
        Syllabus · {done} of {exam.syllabusTopics.length} done
      </summary>
      <div className="uc-exams-topics">
        {exam.syllabusTopics.map((topic, idx) => {
          const itemKey = `${exam.id}-${idx}`;
          return (
            <button type="button" key={itemKey} className={state[itemKey] ? 'is-done' : undefined} onClick={() => onToggle(itemKey)}>
              <CheckSquare aria-hidden="true" />
              <span>{topic}</span>
            </button>
          );
        })}
      </div>
    </details>
  );
};

export const ExamsView: React.FC<ExamsViewProps> = ({ exams, makeupExams, refat, compre, arrears, onNavigateMap }) => {
  const [examDayMode, setExamDayMode] = useState<boolean>(false);
  const [examFilter, setExamFilter] = useState<'All' | ExamSchedule['examType']>('All');
  // Per-topic check state keyed by exam id + topic index (ids are unique;
  // course codes may be empty on the real VTOP exam page).
  const [syllabusState, setSyllabusState] = useState<{ [key: string]: boolean }>({});

  const toggleTopic = (key: string) => {
    setSyllabusState((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const now = Date.now();
  const todayIso = istDateLabel();
  const activeExams = exams.filter((exam) => {
    if (!exam.date) return true;
    // VTOP dates are India calendar dates, so compare the ISO labels.
    // `new Date('2026-08-18')` is UTC midnight, which against local midnight
    // drops today's exam entirely on any device west of Greenwich.
    const iso = exam.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return true;
    return iso >= todayIso;
  }).filter((exam) => examFilter === 'All' || exam.examType === examFilter);

  const calendarReadyExams = activeExams.filter((exam) => isExamCalendarReady(exam));

  // What is still ahead, the same list Home answers with. A paper that has
  // begun is not ahead of anything, but it stays on the board while the hall is
  // open — `examEndMs` is the only thing that knows when that is, and a paper
  // with a start and no honest end drops away exactly as it does on Home.
  const ahead = upcomingExams(activeExams, now);
  const hero: NextExam | null = ahead[0] ?? null;
  const running: BoardExam[] = activeExams
    .map((exam): BoardExam | null => {
      const start = examStartMs(exam.date, exam.time);
      const end = examEndMs(exam.date, exam.time);
      return start !== null && end !== null && start <= now && now < end
        ? { exam, startsAtMs: start, timePending: false, running: true }
        : null;
    })
    .filter((x): x is BoardExam => x !== null);
  const rows: BoardExam[] = [...running, ...ahead.slice(1)].sort((a, b) => a.startsAtMs - b.startsAtMs);
  // Papers VTOP has listed without a date have no place in a chronology; they
  // are not hidden and they are not dated by guessing — they get their own block.
  const undated = activeExams.filter((exam) => examStartMs(exam.date, exam.time) === null);

  const aheadCount = upcomingExams(exams, now).length;
  const noteLine = aheadCount > 0
    ? `${aheadCount} ${aheadCount === 1 ? 'paper' : 'papers'} ahead`
    : exams.length === 0 ? 'Nothing published by VTOP yet' : 'No dated papers ahead';

  const heroDay = hero ? calendarDaysUntil(hero.exam.date, now) ?? 0 : 0;
  const heroValue = heroDay <= 0 ? 'Today' : heroDay === 1 ? 'Tomorrow' : String(heroDay);
  const heroUnit = heroDay >= 2
    ? 'days'
    : heroDay <= 0 && !hero?.timePending && hero && hero.countdown !== 'Today' ? `in ${hero.countdown}` : '';
  const heroLamp = !hero ? '' : heroDay <= 0 ? ' uc-lamp--alert' : heroDay <= 3 ? ' uc-lamp--warn' : '';

  const idleLine = undated.length > 0
    ? `VTOP has published ${undated.length} ${undated.length === 1 ? 'paper' : 'papers'} without a date yet — ${undated.length === 1 ? 'it is' : 'they are'} listed below.`
    : examFilter !== 'All'
      ? `No ${examFilter} papers are still ahead this semester.`
      : exams.length === 0
        ? "VTOP has not published this semester's exam schedule yet. Dates, halls and seat numbers appear here as soon as it does."
        : 'Every paper with a published date has already taken place.';

  const exportAllIcs = () => {
    const ics = exportExamsToIcs(calendarReadyExams.map((e) => ({
      id: e.id, slot: e.slot || '', courseCode: e.courseCode, courseTitle: e.courseTitle,
      examType: e.examType, date: e.date, time: e.time, venue: e.venue, seatNo: e.seatNo,
    })));
    downloadIcs(ics, 'ultracc-exam-schedule.ics');
  };
  const exportAllImage = () => exportExamsImage(calendarReadyExams.map((e) => ({
    courseCode: e.courseCode, courseTitle: e.courseTitle, examType: e.examType,
    date: e.date, time: e.time, venue: e.venue, seatNo: e.seatNo,
  })), {});
  const exportOne = (exam: ExamSchedule) => downloadIcs(
    exportExamsToIcs([{ ...exam }]),
    `ultracc-${exam.courseCode || exam.examType}.ics`,
  );

  const filterOptions = (['All', 'CAT 1', 'CAT 2', 'FAT', 'Lab FAT', 'Other'] as const)
    .filter((filter) => filter === 'All' || exams.some((exam) => exam.examType === filter));

  return (
    <div className="uc-exams pb-12">
      {/* The head: what the screen is, the type filter, and the two exports. */}
      <section className="uc-plate uc-exams-mast" aria-label="Examination schedule">
        <span className="uc-cap">Academic schedule</span>
        <h2>Examinations</h2>
        <p className="uc-note">{noteLine}</p>
        <div className="uc-exams-mast-acts">
          <button className="uc-exams-mode" aria-pressed={examDayMode} onClick={() => setExamDayMode(!examDayMode)}>
            <ShieldCheck size={14} aria-hidden="true" />
            {examDayMode ? 'Exam-day check on' : 'Exam-day check'}
          </button>
          {calendarReadyExams.length > 0 && (
            <button className="uc-exams-act" onClick={exportAllIcs}>
              <CalendarPlus size={14} aria-hidden="true" /> Add all to calendar
            </button>
          )}
          {calendarReadyExams.length > 0 && (
            <button className="uc-exams-act" onClick={exportAllImage}>
              <ImageIcon size={14} aria-hidden="true" /> Save the schedule
            </button>
          )}
        </div>
        {filterOptions.length > 1 && (
          <div className="uc-exams-filter" role="group" aria-label="Filter by assessment">
            {filterOptions.map((filter) => (
              <button
                key={filter}
                className={examFilter === filter ? 'is-on' : undefined}
                aria-pressed={examFilter === filter}
                onClick={() => setExamFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* The board readout: the next paper, or one honest sentence. */}
      <section className={`uc-plate uc-exams-hero${hero ? '' : ' is-idle'}`} aria-label="Next examination">
        <div className="uc-exams-hero-head">
          <span className={`uc-lamp${heroLamp}`}>Next paper</span>
          {hero && <span className="uc-exams-type">{hero.exam.examType}</span>}
        </div>
        {hero ? (
          <>
            <p className="uc-exams-when">
              <b>{heroValue}</b>
              {heroUnit && <i>{heroUnit}</i>}
            </p>
            <p className="uc-exams-paper">
              <b>{hero.exam.courseCode || (hero.exam.slot ? `Slot ${hero.exam.slot}` : 'Examination')}</b>
              {hero.exam.courseTitle ? ` · ${hero.exam.courseTitle}` : ''}
            </p>
            <div className="uc-exams-facts">
              <div className="uc-exams-fact">
                <span>Date</span>
                <b>{friendlyDate(hero.exam.date)}</b>
              </div>
              <div className="uc-exams-fact">
                <span>Time</span>
                <b className={hasExamValue(hero.exam.time) ? undefined : 'is-quiet'}>{examValue(hero.exam.time, 'Not released yet')}</b>
              </div>
              <div className="uc-exams-fact">
                <span>Room</span>
                <b className={hasExamValue(hero.exam.venue) ? undefined : 'is-quiet'}>{examValue(hero.exam.venue, 'Not available yet')}</b>
              </div>
              <div className="uc-exams-fact">
                <span>Seat</span>
                <b className={hasExamValue(hero.exam.seatNo) ? undefined : 'is-quiet'}>{examValue(hero.exam.seatNo, 'Not released')}</b>
              </div>
            </div>
            <div className="uc-exams-hero-foot">
              {hasExamValue(hero.exam.venue) && (
                <button className="uc-exams-act" onClick={() => onNavigateMap(hero.exam.venue)}>
                  <MapPin size={14} aria-hidden="true" /> Locate venue
                </button>
              )}
              {isExamCalendarReady(hero.exam) && (
                <button className="uc-exams-act" onClick={() => exportOne(hero.exam)}>
                  <CalendarPlus size={14} aria-hidden="true" /> Add to calendar
                </button>
              )}
              {hero.exam.syllabusTopics.length > 0 && (
                <Syllabus exam={hero.exam} state={syllabusState} onToggle={toggleTopic} />
              )}
            </div>
          </>
        ) : (
          <p className="uc-exams-idle">{idleLine}</p>
        )}
      </section>

      {/* Exam-day mode: the checklist, kept off the board until it is asked for. */}
      {examDayMode && (
        <section className="uc-plate" aria-label="Exam-day checklist">
          <div className="uc-plate-head">
            <span className="uc-lamp uc-lamp--warn">Exam-day check</span>
            <button className="uc-link" onClick={() => setExamDayMode(false)}>Hide</button>
          </div>
          <ul className="uc-exams-checks">
            {EXAM_DAY_CHECKS.map((item) => (
              <li className="uc-exams-check" key={item}>
                <FileCheck size={14} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The ledger: every other dated paper, in order, one ruled row each. */}
      {(rows.length > 0 || undated.length > 0) && (
        <section className="uc-plate uc-exams-plate" aria-label="All published exam dates">
          <div className="uc-plate-head">
            <span className="uc-cap">All published dates</span>
            <span className="uc-num uc-exams-count">{rows.length + undated.length}</span>
          </div>
          {rows.length > 0 && (
            <div className="uc-exams-ledger">
              {rows.map((row) => (
                <BoardRow
                  key={row.exam.id}
                  examType={row.exam.examType}
                  code={row.exam.courseCode || (row.exam.slot ? `Slot ${row.exam.slot}` : 'Examination')}
                  title={row.exam.courseTitle}
                  date={row.exam.date}
                  time={row.exam.time}
                  venue={row.exam.venue}
                  seatNo={row.exam.seatNo}
                  distance={row.running ? undefined : awayLabel(calendarDaysUntil(row.exam.date, now)) ?? undefined}
                  today={isSameIstDay(row.exam.date, new Date(now))}
                  now={row.running}
                >
                  <div className="uc-exams-row-acts">
                    {hasExamValue(row.exam.venue) && (
                      <button className="uc-exams-act" onClick={() => onNavigateMap(row.exam.venue)}>
                        <MapPin size={13} aria-hidden="true" /> Locate
                      </button>
                    )}
                    {isExamCalendarReady(row.exam) && (
                      <button className="uc-exams-act" onClick={() => exportOne(row.exam)}>
                        <CalendarPlus size={13} aria-hidden="true" /> Calendar
                      </button>
                    )}
                  </div>
                  {row.exam.syllabusTopics.length > 0 && (
                    <Syllabus exam={row.exam} state={syllabusState} onToggle={toggleTopic} />
                  )}
                </BoardRow>
              ))}
            </div>
          )}
          {undated.length > 0 && (
            <div className="uc-exams-undated">
              <span className="uc-cap">Dates not published yet</span>
              {undated.map((exam) => (
                <BoardRow
                  key={exam.id}
                  examType={exam.examType}
                  code={exam.courseCode || (exam.slot ? `Slot ${exam.slot}` : 'Examination')}
                  title={exam.courseTitle}
                  date={exam.date}
                  time={exam.time}
                  venue={exam.venue}
                  seatNo={exam.seatNo}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---------- Arrears / backlog (from VTOP) ---------- */}
      <ArrearsSection arrears={arrears} />

      {/* ---------- Makeup exams: dated records, drawn as board rows ---------- */}
      {makeupExams && makeupExams.length > 0 && (
        <section className="uc-plate uc-exams-plate" aria-label="Makeup exam schedule">
          <div className="uc-plate-head">
            <div className="uc-exams-head">
              <span className="uc-marker uc-marker--quiet uc-marker--sm" aria-hidden="true"><Repeat size={14} /></span>
              <div className="uc-exams-id">
                <p className="uc-exams-title">Makeup exams</p>
                <p className="uc-note">From VTOP — carry your VIT student ID card</p>
              </div>
            </div>
          </div>
          <div className="uc-exams-ledger">
            {makeupExams.map((ex) => (
              <BoardRow
                key={ex.id}
                examType={ex.examType}
                code={ex.courseCode || (ex.slot ? `Slot ${ex.slot}` : 'Examination')}
                title={ex.courseTitle}
                date={ex.date}
                time={ex.time}
                venue={ex.venue}
                seatNo={ex.seatNo}
                note={ex.semesterName}
              />
            ))}
          </div>
        </section>
      )}

      {/* ---------- Re-exam / reFAT eligibility ---------- */}
      {refat && refat.available && (
        <section className="uc-plate uc-exams-plate" aria-label="Re-exam eligibility">
          <div className="uc-plate-head">
            <div className="uc-exams-head">
              <span className="uc-marker uc-marker--quiet uc-marker--sm" aria-hidden="true"><CalendarClock size={14} /></span>
              <div className="uc-exams-id">
                <p className="uc-exams-title">Re-exam / re-FAT</p>
                <p className="uc-note">Eligibility from VTOP — carry your VIT student ID card</p>
              </div>
            </div>
          </div>
          {refat.status ? <p className="uc-exams-note-line">{refat.status}</p> : null}
          {refat.semesters.some((s) => s.courses.length > 0) ? (
            <div className="uc-exams-body">
              {refat.semesters.filter((s) => s.courses.length > 0).map((s) => (
                <div className="uc-exams-block" key={s.id}>
                  <span className="uc-cap">{s.name}</span>
                  <div className="uc-exams-chips">
                    {s.courses.map((c) => (
                      <span className="uc-exams-chip" key={c.courseCode}>
                        {c.courseCode}
                        {c.courseTitle && c.courseTitle !== c.courseCode ? <i>{c.courseTitle}</i> : null}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="uc-exams-note-line is-quiet">No re-exam courses listed by VTOP for your profile.</p>
          )}
        </section>
      )}

      {/* ---------- Compre registration ---------- */}
      {compre && compre.available && (
        <section className="uc-plate uc-exams-plate" aria-label="Comprehensive examination">
          <div className="uc-plate-head">
            <div className="uc-exams-head">
              <span className="uc-marker uc-marker--quiet uc-marker--sm" aria-hidden="true"><Info size={14} /></span>
              <div className="uc-exams-id">
                <p className="uc-exams-title">Comprehensive exam</p>
                <p className="uc-note">Registration status from VTOP</p>
              </div>
            </div>
          </div>
          <div className="uc-exams-block">
            <p className={`uc-exams-status${compre.status && /closed|not eligible|no/i.test(compre.status) ? ' is-bad' : ''}`}>
              {compre.status || 'Registration open'}
            </p>
            {compre.message ? <p className="uc-exams-note">{compre.message}</p> : null}
          </div>
        </section>
      )}
    </div>
  );
};

/**
 * Arrears / backlog courses straight from VTOP. Pending or registered arrears
 * are shown as exam candidates; cleared ones are counted, never invented.
 * Empty state is honest: no data ≠ no arrears.
 */
const ArrearsSection: React.FC<{ arrears?: ArrearRecord[] }> = ({ arrears }) => {
  if (!arrears || arrears.length === 0) return null;
  const pending = arrears.filter((a) => a.status !== 'Cleared');
  const cleared = arrears.length - pending.length;
  const bySemester = Array.from(pending.reduce((acc, a) => {
    const list = acc.get(a.semesterName) ?? [];
    list.push(a);
    acc.set(a.semesterName, list);
    return acc;
  }, new Map<string, ArrearRecord[]>()).entries());
  return (
    <section className="uc-plate uc-exams-plate" aria-label="Arrears and backlogs">
      <div className="uc-plate-head">
        <div className="uc-exams-head">
          <span className="uc-marker uc-marker--alert uc-marker--sm" aria-hidden="true"><AlertOctagon size={14} /></span>
          <div className="uc-exams-id">
            <p className="uc-exams-title">Arrears &amp; backlog</p>
            <p className="uc-note">Register for the arrear exam when the window opens</p>
          </div>
        </div>
      </div>
      {pending.length > 0 ? (
        <div className="uc-exams-body">
          {bySemester.map(([semester, courses]) => (
            <div className="uc-exams-block" key={semester}>
              <span className="uc-cap">{semester}</span>
              <div className="uc-exams-chips">
                {courses.map((c) => (
                  <span className="uc-exams-chip is-alert" key={`${c.courseCode}-${c.semesterId}`}>
                    {c.courseCode}
                    {c.courseTitle && c.courseTitle !== c.courseCode ? <i>{c.courseTitle}</i> : null}
                    {c.status === 'Registered' ? <i>registered</i> : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="uc-exams-cleared">All previously listed arrears are cleared.</p>
      )}
      {cleared > 0 && (
        <p className="uc-plate-foot">{cleared} previously pending course{cleared > 1 ? 's' : ''} cleared</p>
      )}
    </section>
  );
};
