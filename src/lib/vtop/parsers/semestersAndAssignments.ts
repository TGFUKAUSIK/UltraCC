import { SemesterInfo, AssignmentRecord } from '../types';
import {
  parseDocument,
  findTableByHeaders,
  cellText,
  parseOutcome,
  ParseOutcome,
  normalizeDate,
  isLikelyLoginPage,
  isLikelySessionExpiredPage,
  isPlausibleCourseCode,
  toNumber,
} from './helpers';

/**
 * VTOP renders the semester picker as <select name="semesterSubId"> with
 * option values like "CH2025261". Option ids are authoritative — we never
 * fabricate a semester list.
 *
 * Verification status: UNVERIFIED — see src/lib/vtop/verification.ts
 */
export function parseSemestersHtml(htmlString: string): SemesterInfo[];
export function parseSemestersHtml(htmlString: string, withOutcome: true): ParseOutcome<SemesterInfo[]>;
export function parseSemestersHtml(htmlString: string, withOutcome?: true) {
  const warnings: ParseOutcome<SemesterInfo[]>['warnings'] = [];
  const doc = parseDocument(htmlString);

  if (isLikelyLoginPage(htmlString) || isLikelySessionExpiredPage(htmlString)) {
    return withOutcome
      ? parseOutcome([], [{ code: 'session-expired', detail: 'Received the login page instead of the semester list.' }], true)
      : [];
  }

  const select =
    doc.querySelector('select#semesterSubId') ||
    doc.querySelector('select[name="semesterSubId"]') ||
    doc.querySelector('select[name*="semester"]') ||
    doc.querySelector('select[id*="semester"]');

  const semesters: SemesterInfo[] = [];
  if (select) {
    const options = Array.from(select.querySelectorAll('option'));
    options.forEach((opt) => {
      const value = (opt.getAttribute('value') || opt.value || '').trim();
      const text = opt.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (!value || value === '0' || value === '-1' || !text) return;
      // isCurrent comes ONLY from the `selected` attribute (the term VTOP
      // serves by default). Text heuristics like /winter/ can flag a PAST
      // "Winter Semester" as current — a genuine wrong-term bug — so they are
      // never used (matches the gateway parser in supabase/functions/
      // vtop-gateway/parsers.ts).
      semesters.push({
        id: value,
        name: text,
        isCurrent: opt.hasAttribute('selected') || opt.selected,
      });
    });
  }

  if (!semesters.length) {
    warnings.push({ code: 'no-semester-select', detail: 'No semester <select> element was found in the page.' });
  }

  return withOutcome ? parseOutcome(semesters, warnings) : semesters;
}

/**
 * VTOP "Digital Assignment" page(s) — one row per assignment with course,
 * title, due date, status and weightage.
 *
 * NOTE: VTOP does not reliably expose a single unified assignment feed; this
 * parser targets the DA page shape and returns [] (with a warning) whenever
 * the shape does not match. It never invents assignments.
 *
 * Verification status: UNVERIFIED — see src/lib/vtop/verification.ts
 */
export function parseAssignmentsHtml(htmlString: string): AssignmentRecord[];
export function parseAssignmentsHtml(htmlString: string, withOutcome: true): ParseOutcome<AssignmentRecord[]>;
export function parseAssignmentsHtml(htmlString: string, withOutcome?: true) {
  const warnings: ParseOutcome<AssignmentRecord[]>['warnings'] = [];
  const doc = parseDocument(htmlString);

  if (isLikelyLoginPage(htmlString) || isLikelySessionExpiredPage(htmlString)) {
    return withOutcome
      ? parseOutcome([], [{ code: 'session-expired', detail: 'Received the login page instead of assignment data.' }], true)
      : [];
  }

  const found = findTableByHeaders(doc, ['course code', 'assignment']);
  if (!found) {
    return withOutcome
      ? parseOutcome([], [{ code: 'missing-header', detail: 'No assignment table found (VTOP may not expose assignments).' }], true)
      : [];
  }
  warnings.push(...found.warnings);
  const { table, headerIndex } = found;

  const idx = (fragments: string[]): number => {
    const key = Object.keys(headerIndex).find((k) => fragments.some((f) => k.includes(f)));
    return key ? headerIndex[key] : -1;
  };

  const col = {
    code: idx(['course code']),
    title: idx(['assignment title', 'assignment name', 'title']),
    dueDate: idx(['due date', 'last date', 'submission date']),
    status: idx(['status']),
    weightage: idx(['weightage', 'marks', 'max marks']),
  };

  const assignments: AssignmentRecord[] = [];
  const rows = Array.from(table.querySelectorAll('tr'));
  rows.forEach((row, rowIdx) => {
    if (Array.from(row.querySelectorAll('th')).length > 0) return;
    const courseCode = col.code >= 0 ? cellText(row, col.code) : '';
    if (!courseCode || !isPlausibleCourseCode(courseCode)) return;

    const title = col.title >= 0 ? cellText(row, col.title) : '';
    if (!title) return;

    const statusRaw = (col.status >= 0 ? cellText(row, col.status) : '').toLowerCase();
    let status: AssignmentRecord['status'] = 'Pending';
    if (statusRaw.includes('submitted') || statusRaw.includes('completed')) status = 'Submitted';
    else if (statusRaw.includes('graded') || statusRaw.includes('evaluated')) status = 'Graded';

    const weightRaw = col.weightage >= 0 ? cellText(row, col.weightage) : '';
    const weightage = toNumber(weightRaw) ?? 0;

    assignments.push({
      id: `asgn-${rowIdx}-${courseCode}`,
      courseCode,
      courseTitle: courseCode,
      title,
      dueDate: col.dueDate >= 0 ? normalizeDate(cellText(row, col.dueDate)) : '',
      weightage,
      status,
    });
  });

  if (!assignments.length) {
    warnings.push({ code: 'no-valid-rows', detail: 'Assignment table found but no valid rows could be parsed.' });
  }

  return withOutcome ? parseOutcome(assignments, warnings) : assignments;
}
