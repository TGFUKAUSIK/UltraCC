/**
 * SyllabusView — the Syllabus tab: this semester's courses, one tap from VTOP's
 * own syllabus file. Presented as a document library: a term mast, then one
 * hair-lined ledger row per course — its code, its name, and the single action
 * that opens the paper.
 *
 * WHERE EVERYTHING ON THIS PAGE COMES FROM:
 *  - The course list is the student's own synced timetable for the selected
 *    semester, reduced to what a student reads: a course code and its name.
 *    VTOP's Course Page is not asked for a listing — the timetable is the
 *    visible list, while the syllabus itself is never derived from it.
 *  - The syllabus is VTOP's file, fetched by vtop-gateway through the student's
 *    authenticated Course Page (semester → course → class → its syllabus link).
 *    THE STUDENT PICKS A COURSE AND NOTHING ELSE: the gateway resolves VTOP's
 *    own semester, finds the course, takes its first valid class row and
 *    downloads the file. No slot, no faculty, no class id ever appears here, and
 *    no VTOP cookie, CSRF token or authorizedID reaches this component.
 *  - A cached copy is read first, so reopening a syllabus is instant and works
 *    offline; the sheet says which of the two is on screen.
 *  - Whether VTOP can be asked is React state (`useLiveSessionActive`), not a
 *    value read once during render — a login that succeeds while this tab is
 *    open removes the sign-in prompt and re-asks for the courses waiting on it.
 *
 * WHAT THIS PAGE NEVER DOES: invent units, topics or textbooks to fill a gap;
 * show a success message for a file that did not arrive; or report a failure
 * before VTOP was actually asked. When VTOP has nothing, the sheet says so in
 * one sentence and offers a retry.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Download, ExternalLink, FileText, GraduationCap, Loader2, RefreshCw, X } from 'lucide-react';
import type { SyllabusDocument, TimetableSlot } from '../lib/vtop/types';
import { getLiveClient, isLiveSessionActive } from '../lib/vtop/liveSession';
import { useLiveSessionActive } from '../lib/vtop/useLiveSession';
import { useDialog } from '../hooks/useDialog';
import {
  coursesFromTimetable,
  IDLE,
  LOADING,
  type SyllabusCourse,
  type SyllabusStatus,
} from '../lib/syllabus';
import { formatFileSize } from '../utils/fileSize';
import { loadCourseSyllabus } from '../lib/syllabusStore';
import { vtopDb } from '../lib/db/vtopDatabase';

interface SyllabusViewProps {
  /** Synced timetable slots for the selected semester — the visible course list. */
  timetable: TimetableSlot[];
  /** Opens the VTOP login modal, for the one state that needs a sign-in. */
  onLogin: () => void;
  /** Selected VTOP semester id — sent along when the app has one. */
  semesterId?: string;
  /** VTOP's own name for that semester, so the page says which term it shows. */
  semesterLabel?: string;
  /** Student identity, so one browser cannot serve another student's file. */
  registrationNo?: string;
}

export const SyllabusView: React.FC<SyllabusViewProps> = ({
  timetable, onLogin, semesterId = '', semesterLabel = '', registrationNo = '',
}) => {
  /** The one truth about "can VTOP be asked", reactive instead of read-once. */
  const sessionActive = useLiveSessionActive();

  const [statuses, setStatuses] = useState<Record<string, SyllabusStatus>>({});
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const inFlight = useRef<Set<string>>(new Set());
  // A deep link (?course=CSE2009) opens and fetches that course once.
  const handledDeepLink = useRef(false);
  // Unmount stops the "re-ask everything that was waiting for a session" loop —
  // a tab the student already left must not keep walking VTOP.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const courses = useMemo(() => coursesFromTimetable(timetable), [timetable]);

  const askVtop = useCallback(async (course: SyllabusCourse, force: boolean) => {
    const key = course.courseCode;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setStatuses((s) => ({ ...s, [key]: LOADING }));
    const result = await loadCourseSyllabus({
      course,
      // The term the app is showing, when it can name one. Nothing here blocks
      // the request on a missing id: the gateway resolves the semester itself.
      term: { semesterId, semesterLabel },
      registrationNo,
      client: getLiveClient(),
      cache: vtopDb,
      force,
      // Read at request time, not from the render that scheduled this: a session
      // that arrived in between is a session VTOP will answer for.
      sessionActive: isLiveSessionActive(),
    });
    inFlight.current.delete(key);
    if (!alive.current) return;
    setStatuses((s) => ({ ...s, [key]: result.status }));
    if (result.cacheNote) setNotes((n) => ({ ...n, [key]: result.cacheNote as string }));
  }, [semesterId, semesterLabel, registrationNo]);

  const openSyllabus = useCallback((course: SyllabusCourse) => {
    const key = course.courseCode;
    setOpenCode(key);
    const current = statuses[key];
    // Already fetched (or being fetched) — show what we have; only a failure
    // state is worth re-asking, and the sheet's own button does that explicitly.
    if (!current || current.kind === 'no-session' || current.kind === 'session-expired'
      || current.kind === 'error' || current.kind === 'parse-failed') {
      void askVtop(course, false);
    }
  }, [askVtop, statuses]);

  // A semester (or student) change must not leave the previous term's documents
  // on screen under the same course code.
  const scopeKey = `${registrationNo}|${semesterId}|${semesterLabel}`;
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (askedFor.current === scopeKey) return;
    const switched = askedFor.current !== null;
    askedFor.current = scopeKey;
    if (switched) {
      setStatuses({});
      setNotes({});
      setOpenCode(null);
    }
  }, [scopeKey]);

  // Deep link: /?tab=syllabus&course=CSE2009 opens that course's syllabus.
  useEffect(() => {
    if (handledDeepLink.current || !courses.length) return;
    const wanted = (new URLSearchParams(window.location.search).get('course') || '').trim().toUpperCase();
    if (!wanted) return;
    handledDeepLink.current = true;
    const match = courses.find((c) => c.courseCode === wanted);
    if (match) openSyllabus(match);
  }, [courses, openSyllabus]);

  // A session that arrived while this tab was open: re-ask for any card left
  // saying "sign in". This is the transition the old mount-only effect could
  // never see.
  const wasSignedIn = useRef(sessionActive);
  useEffect(() => {
    const before = wasSignedIn.current;
    wasSignedIn.current = sessionActive;
    if (before || !sessionActive) return;
    const waiting = courses.filter((c) => {
      const kind = statuses[c.courseCode]?.kind;
      return kind === 'no-session' || kind === 'session-expired';
    });
    void (async () => {
      for (const course of waiting) {
        if (!alive.current) return;
        await askVtop(course, false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: only the false→true edge acts.
  }, [sessionActive, askVtop, courses, statuses]);

  const openCourse = openCode ? courses.find((c) => c.courseCode === openCode) : undefined;
  const coursesLabel = `${courses.length} ${courses.length === 1 ? 'course' : 'courses'}`;

  return (
    <div className="uc-syl-view pb-12 min-w-0">
      {/* Mast — the term this library belongs to, and how many papers it holds. */}
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">Syllabus</span>
            <h2 className="uc-dir-name">Papers for this term</h2>
            <p className="uc-note">
              {semesterLabel ? `${semesterLabel} · ` : ''}{coursesLabel}
            </p>
          </div>
        </div>
      </section>

      {!courses.length ? (
        <section className="uc-plate">
          <div className="uc-syl-blank">
            <GraduationCap className="h-8 w-8" aria-hidden="true" />
            <b>No courses to show yet</b>
            <small>
              Sync your VTOP data and this semester’s courses appear here, each with its own syllabus.
            </small>
          </div>
        </section>
      ) : (
        <section className="uc-plate uc-dir-ledger" aria-label="Courses">
          {courses.map((c) => (
            <CourseRow
              key={c.courseCode}
              course={c}
              status={statuses[c.courseCode] ?? IDLE}
              onOpen={() => openSyllabus(c)}
            />
          ))}
        </section>
      )}

      {openCourse && (
        <SyllabusSheet
          course={openCourse}
          status={statuses[openCourse.courseCode] ?? IDLE}
          note={notes[openCourse.courseCode]}
          onLogin={onLogin}
          onRetry={() => void askVtop(openCourse, false)}
          onRecheck={() => void askVtop(openCourse, true)}
          onClose={() => setOpenCode(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Course row — a code, a name and the one thing to do with them
// ---------------------------------------------------------------------------

const CourseRow: React.FC<{
  course: SyllabusCourse;
  status: SyllabusStatus;
  onOpen: () => void;
}> = ({ course, status, onOpen }) => {
  /**
   * "Try again" only ever follows a real failure: an idle row asks, a row VTOP
   * answered shows, and a row that failed offers the retry.
   */
  const label = {
    idle: 'Syllabus',
    loading: 'Fetching…',
    ready: 'View syllabus',
    unavailable: 'Try again',
    // Both kinds of "VTOP cannot answer" want the same click from the student.
    'no-session': 'Syllabus',
    'session-expired': 'Syllabus',
    'parse-failed': 'Try again',
    error: 'Try again',
  }[status.kind];

  const busy = status.kind === 'loading';
  const failed = status.kind === 'error' || status.kind === 'parse-failed' || status.kind === 'unavailable';

  return (
    <article className="uc-dir-row uc-dir-row--acts">
      <span className="uc-dir-tile" aria-hidden="true">
        <FileText className="h-4 w-4" />
      </span>
      <div className="uc-dir-main">
        <b className="uc-dir-title uc-num uc-syl-code">{course.courseCode}</b>
        <span className="uc-syl-name">{course.courseTitle || '—'}</span>
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        aria-label={`${label} — ${course.courseCode}`}
        className="uc-syl-go"
      >
        {busy
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          : failed
            ? <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            : <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />}
        {label}
      </button>
    </article>
  );
};

// ---------------------------------------------------------------------------
// The document itself
// ---------------------------------------------------------------------------

/** Exported so the sheet's states can be tested without VTOP. */
export const SyllabusSheet: React.FC<{
  course: SyllabusCourse;
  status: SyllabusStatus;
  note?: string;
  onLogin: () => void;
  onRetry: () => void;
  onRecheck: () => void;
  onClose: () => void;
}> = ({ course, status, note, onLogin, onRetry, onRecheck, onClose }) => {
  const titleId = 'syllabus-sheet-title';
  // Escape closes, Tab stays inside the sheet, and focus returns to the course
  // row it was opened from.
  const sheetRef = useDialog<HTMLDivElement>({ isOpen: true, onClose });

  const doc = status.kind === 'ready' ? status.document : null;
  /**
   * VTOP answered for a different term than the one UltraCC had selected — its
   * own Course Page dropdown named the term this answer is really about. The
   * student is told which term they are looking at rather than being left to
   * read a Fall file as a Winter one.
   */
  const otherTerm = status.kind === 'ready' || status.kind === 'unavailable' ? status.semester : undefined;

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="uc-overlay fixed inset-0 z-[70]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="uc-syl-panel">
        <header className="uc-syl-head">
          <div className="min-w-0">
            <h3 id={titleId} className="uc-syl-title">
              {course.courseCode} — Syllabus
            </h3>
            <p className="uc-syl-sub">
              {doc
                ? <>VTOP’s own file · {doc.fileName}{doc.bytes > 0 ? ` · ${formatFileSize(doc.bytes)}` : ''}{status.kind === 'ready' && status.cached ? ' · saved on this device' : ''}</>
                : 'Fetching this course’s syllabus from VTOP.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close syllabus"
            className="uc-syl-close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="uc-syl-body" aria-live="polite">
          {otherTerm && (
            <p className="uc-syl-term">
              VTOP answered for {otherTerm.label} — this document belongs to that term.
            </p>
          )}

          {status.kind === 'loading' && (
            <div className="uc-syl-wait">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <p>Fetching syllabus…</p>
            </div>
          )}

          {/*
            One sentence per reality, and only after VTOP was actually asked:
            the gateway's own reason decides which of the five the student
            reads, and nothing here blames the student or pretends the course
            does not exist.
          */}
          {(status.kind === 'unavailable' || status.kind === 'error' || status.kind === 'parse-failed') && (
            <SheetOutcome message={status.message} action={{ label: 'Try again', onClick: onRetry }} />
          )}

          {/* A reload keeps the cached file readable and simply ends the tab's
              session, so this asks for a sign-in without claiming one expired. */}
          {(status.kind === 'no-session' || status.kind === 'session-expired') && (
            <SheetOutcome message={status.message} action={{ label: 'Login with VTOP', onClick: onLogin }} />
          )}

          {doc && (
            <div className="uc-syl-docwrap">
              <DocumentFrame document={doc} />
              <p className="uc-syl-fine">
                Page navigation and zoom are VTOP’s file in your browser’s own document viewer.
                {note ? ` ${note}` : ''}
              </p>
            </div>
          )}
        </div>

        {doc && (
          <footer className="uc-syl-foot">
            <a
              href={doc.dataUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="uc-syl-act acc-bg"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open paper
            </a>
            <a
              href={doc.dataUrl}
              download={doc.fileName}
              className="uc-syl-act uc-syl-act--ghost"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
            </a>
            <button
              type="button"
              onClick={onRecheck}
              className="uc-syl-act uc-syl-act--ghost"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Re-check with VTOP
            </button>
          </footer>
        )}
      </div>
    </div>
  );
};

/**
 * Render VTOP's file where the browser can, and say so plainly where it
 * cannot. VTOP serves PDFs, and occasionally Word/Excel course plans; only the
 * first two are viewable inline, so the other shapes get an honest
 * "Open paper" panel instead of a broken frame.
 */
const DocumentFrame: React.FC<{ document: SyllabusDocument }> = ({ document }) => {
  const isPdf = document.contentType === 'application/pdf';
  const isImage = /^image\//.test(document.contentType);

  if (isImage) {
    return (
      <img
        src={document.dataUrl}
        alt="Course syllabus as published by VTOP"
        className="uc-syl-doc uc-syl-doc--img"
      />
    );
  }
  if (!isPdf) {
    return (
      <div className="uc-note-row uc-syl-notpdf">
        <FileText className="h-4 w-4" aria-hidden="true" />
        <div className="min-w-0">
          <p className="uc-syl-notpdf-title">VTOP’s file is not a PDF</p>
          <p className="uc-syl-notpdf-text">
            This course’s syllabus is a {document.fileName.split('.').pop()?.toUpperCase() || 'document'} file,
            which browsers cannot display inside a page. Use “Open paper” to view it in the app your device already has.
          </p>
        </div>
      </div>
    );
  }
  return (
    <iframe
      title="Course syllabus from VTOP"
      src={document.dataUrl}
      className="uc-syl-doc"
    />
  );
};

// ---------------------------------------------------------------------------
// The sheet's one-line outcome: the sentence, and the click it asks for
// ---------------------------------------------------------------------------

function SheetOutcome({ message, action }: {
  message: string;
  action: { label: string; onClick: () => void };
}) {
  return (
    <div className="uc-syl-outcome">
      <FileText className="h-6 w-6" aria-hidden="true" />
      <p className="uc-syl-outcome-msg">{message}</p>
      <button
        type="button"
        onClick={action.onClick}
        className="uc-syl-act acc-bg"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {action.label}
      </button>
    </div>
  );
}
