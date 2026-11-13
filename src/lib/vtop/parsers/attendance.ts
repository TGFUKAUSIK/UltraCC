import { AttendanceRecord } from '../types';
import { localTodayIso } from '../../../utils/localDate';
import { attendancePercentFromCounts } from '../../../utils/attendanceBands';
import {
  parseDocument,
  findTableByHeaders,
  indexHeaders,
  cellText,
  toInt,
  toNumber,
  clampPercentage,
  parseOutcome,
  ParseOutcome,
  isPlausibleCourseCode,
  isLikelyLoginPage,
  isLikelySessionExpiredPage,
} from './helpers';

/**
 * VTOP Chennai "Attendance" page.
 *
 * Real page (current Chennai portal): the table is id="getStudentDetails" with
 * header columns that include "Course Code", "Course Title", "Course Type",
 * "Slot", "Attended", "Total", "Percentage". Column ORDER varies, so columns
 * are always mapped from the header row, never assumed.
 *
 * The parser first targets #getStudentDetails (the live shape, corroborated by
 * the MIT-licensed VtopMCP client that was live-tested on vtopcc.vit.ac.in),
 * then falls back to any table with the attendance headers.
 *
 * Verification status: UNVERIFIED until an authenticated live pass — see
 * src/lib/vtop/verification.ts
 */
export function parseAttendanceHtml(htmlString: string): AttendanceRecord[];
export function parseAttendanceHtml(htmlString: string, withOutcome: true): ParseOutcome<AttendanceRecord[]>;
export function parseAttendanceHtml(htmlString: string, withOutcome?: true) {
  const warnings: ParseOutcome<AttendanceRecord[]>['warnings'] = [];
  const doc = parseDocument(htmlString);

  if (isLikelyLoginPage(htmlString) || isLikelySessionExpiredPage(htmlString)) {
    return withOutcome
      ? parseOutcome([], [{ code: 'session-expired', detail: 'Received the login page instead of attendance data.' }], true)
      : [];
  }

  // Preferred: the real page's table id.
  const byId = doc.querySelector('table#getStudentDetails');
  const found =
    (byId ? { table: byId as HTMLTableElement, headerIndex: indexHeaders(byId as HTMLTableElement) } : null) ||
    findTableByHeaders(doc, ['course code', 'attended', 'percentage']);
  if (!found || !Object.keys(found.headerIndex).some((k) => k.includes('course code'))) {
    warnings.push({ code: 'missing-header', detail: 'No attendance table with Course Code / Attended / Percentage headers found.' });
    return withOutcome ? parseOutcome([], warnings, true) : [];
  }
  warnings.push(...('warnings' in found && found.warnings ? found.warnings : []));

  const { table, headerIndex } = found;
  const col = {
    code: headerIndex[Object.keys(headerIndex).find((k) => k.includes('course code')) || ''] ?? 0,
    title: headerIndex[Object.keys(headerIndex).find((k) => k.includes('course title')) || ''] ?? 1,
    type: headerIndex[Object.keys(headerIndex).find((k) => k.includes('course type')) || ''] ?? -1,
    slot: headerIndex[Object.keys(headerIndex).find((k) => k.includes('slot')) || ''] ?? -1,
    attended: headerIndex[Object.keys(headerIndex).find((k) => k.includes('attended')) || ''] ?? -1,
    total: headerIndex[Object.keys(headerIndex).find((k) => k.includes('total') || k.includes('held')) || ''] ?? -1,
    pct: headerIndex[Object.keys(headerIndex).find((k) => k.includes('percentage')) || ''] ?? -1,
    faculty: headerIndex[Object.keys(headerIndex).find((k) => k.includes('faculty') || k.includes('staff')) || ''] ?? -1,
  };

  // Course type may be a separate column OR embedded in the code-title cell
  // ("CSE2001L - Data Structures Lab"). Normalize to a category.
  const categoryFromType = (raw: string, code: string): AttendanceRecord['category'] => {
    const upper = raw.toUpperCase();
    if (upper.includes('LAB') || code.toUpperCase().endsWith('L')) return 'Lab';
    return 'Theory';
  };

  const records: AttendanceRecord[] = [];
  const rows = Array.from(table.querySelectorAll('tr'));
  rows.forEach((row, rowIdx) => {
    // Skip header row(s)
    if (Array.from(row.querySelectorAll('th')).length > 0) return;
    if (rowIdx === 0 && Array.from(row.querySelectorAll('td')).every((c) => !c.textContent?.trim())) return;

    const courseCode = cellText(row, col.code);
    if (!courseCode || !isPlausibleCourseCode(courseCode)) {
      // Totals/footer rows and empty spacer rows are skipped silently.
      return;
    }

    const attended = toInt(col.attended >= 0 ? cellText(row, col.attended) : '');
    const total = toInt(col.total >= 0 ? cellText(row, col.total) : '');
    if (attended === null || total === null || total <= 0) {
      warnings.push({ code: 'invalid-numbers', detail: `Row ${courseCode}: attended/total not parseable, skipped.` });
      return;
    }

    const pctRaw = col.pct >= 0 ? cellText(row, col.pct) : '';
    let pct = toNumber(pctRaw);
    if (pct === null || pct < 0 || pct > 100) {
      // VTOP's own cell wins whenever it answers. When it does not, the counts
      // are written in the same tenths every other surface uses — rounding here
      // used to store 66.7 for a course whose VTOP cell reads 66.66, so the
      // cached record, the cards and the debar filter quoted a number VTOP never
      // wrote (see attendancePercentFromCounts).
      pct = attendancePercentFromCounts(attended, total) ?? 0;
      warnings.push({ code: 'percentage-recomputed', detail: `Row ${courseCode}: percentage missing/invalid, recomputed.` });
    }

    const courseType = (col.type >= 0 ? cellText(row, col.type) : '') || (courseCode.endsWith('L') ? 'ELA' : 'ETH');
    const slot = col.slot >= 0 ? cellText(row, col.slot) : '';

    records.push({
      courseCode,
      courseTitle: col.title >= 0 ? cellText(row, col.title) || courseCode : courseCode,
      courseType,
      slot,
      facultyName: col.faculty >= 0 ? cellText(row, col.faculty) : '',
      attended,
      totalHeld: total,
      percentage: clampPercentage(pct),
      category: categoryFromType(courseType, courseCode),
      lastUpdated: localTodayIso(),
    });
  });

  if (!records.length) {
    warnings.push({ code: 'no-valid-rows', detail: 'Attendance table found but no valid course rows could be parsed.' });
  }

  return withOutcome ? parseOutcome(records, warnings) : records;
}
