/**
 * syllabusDiagnostics — the one place that reads the gateway's structured
 * syllabus-failure fields.
 *
 * WHY IT EXISTS: a syllabus click fails at one of eight different hops, and
 * every one of them used to reach the sheet as the same sentence. "VTOP could
 * not be reached right now" is equally true of a 404 course route, an
 * unreadable page, a dead session and a refused connection, so a live failure
 * could not be traced from outside the gateway. The gateway now names the
 * failing STAGE (SESSION | SEMESTER | COURSE | SLOT | FACULTY | DETAIL |
 * DOWNLOAD | UPSTREAM), a reason from a closed vocabulary, and — when a route
 * answered at all — its HTTP status. This module turns those three fields into
 * one safe development line:
 *
 *     [UltraCC syllabus] stage=COURSE reason=COURSE_NOT_FOUND status=200
 *
 * The student-facing sentences are NOT chosen here and are unchanged: the
 * sheet keeps its curated five, mapped in `syllabus.ts`. This is a
 * diagnostic, not a message.
 *
 * WHAT CANNOT TRAVEL THROUGH HERE: cookies, JSESSIONID, CSRF tokens,
 * authorizedID, session tokens, raw VTOP HTML, file bytes, course data. The
 * three fields are the gateway's own closed vocabulary, and this module
 * re-validates each one against a fixed shape before it is used — so a buggy
 * or hostile response cannot smuggle anything into the line.
 */

/** The stages the gateway may name. A closed list: nothing else is accepted. */
export const SYLLABUS_FAILURE_STAGES = [
  'SESSION',
  'SEMESTER',
  'COURSE',
  'SLOT',
  'FACULTY',
  'DETAIL',
  'DOWNLOAD',
  'UPSTREAM',
] as const;

export type SyllabusFailureStage = (typeof SYLLABUS_FAILURE_STAGES)[number];

export interface SyllabusFailureInfo {
  stage: SyllabusFailureStage;
  reason: string;
  status?: number;
}

/** The gateway's reason vocabulary: SCREAMING_SNAKE, and nothing else. */
const REASON_RE = /^[A-Z][A-Z0-9_]{0,39}$/;

/** The failure fields as they arrive on a gateway response (unknowns included). */
export interface SyllabusFailureFields {
  syllabusStage?: unknown;
  syllabusReason?: unknown;
  syllabusStatus?: unknown;
}

/**
 * Read the safe failure fields off a gateway response. Null when the response
 * did not name a failure — a success, or a gateway older than the fields — in
 * which case the caller says nothing rather than guessing a stage.
 */
export function syllabusFailureInfo(
  res: SyllabusFailureFields | null | undefined
): SyllabusFailureInfo | null {
  const stage = typeof res?.syllabusStage === 'string' ? res.syllabusStage.toUpperCase() : '';
  if (!(SYLLABUS_FAILURE_STAGES as readonly string[]).includes(stage)) return null;

  const reason = typeof res?.syllabusReason === 'string' && REASON_RE.test(res.syllabusReason)
    ? res.syllabusReason
    : 'UNKNOWN_REASON';

  // A real HTTP status, or nothing. 0 and out-of-range values are dropped
  // rather than printed as a number nobody can look up.
  const raw = res?.syllabusStatus;
  const status = typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw <= 599
    ? raw
    : undefined;

  return { stage: stage as SyllabusFailureStage, reason, ...(status !== undefined ? { status } : {}) };
}

/** The development line. Fixed alphabet, fixed shape, no free text. */
export function syllabusFailureLine(info: SyllabusFailureInfo): string {
  return `stage=${info.stage} reason=${info.reason}${info.status !== undefined ? ` status=${info.status}` : ''}`;
}
