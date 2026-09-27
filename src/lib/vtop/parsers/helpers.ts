/**
 * Shared parsing helpers for VTOP HTML.
 *
 * VTOP is a Spring MVC app that renders data in HTML tables. The DOM changes
 * between semesters, so every parser here is:
 *   1. Header-driven (column positions are discovered, never assumed),
 *   2. Strictly validated (numbers must be numbers, codes must look like codes),
 *   3. Failure-safe (returns [] / null + warnings rather than fabricating rows).
 */

export interface ParseIssue {
  /** Stable machine-readable reason, e.g. 'invalid-number' | 'missing-header'. */
  code: string;
  detail: string;
}

export interface ParseOutcome<T> {
  data: T;
  warnings: ParseIssue[];
  /** true when the source HTML did not look like the expected page at all. */
  structuralMismatch: boolean;
}

export function parseOutcome<T>(data: T, warnings: ParseIssue[] = [], structuralMismatch = false): ParseOutcome<T> {
  return { data, warnings, structuralMismatch };
}

export function parseDocument(htmlString: string): Document {
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is not available in this environment');
  }
  return new DOMParser().parseFromString(htmlString, 'text/html');
}

export function normalizeHeader(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^a-zA-Z0-9 /-]/g, '')
    .trim()
    .toLowerCase();
}

/** Find the first table whose header row contains ALL of the given header fragments. */
export function findTableByHeaders(
  doc: Document,
  requiredHeaders: string[]
): { table: HTMLTableElement; headerIndex: Record<string, number>; warnings: ParseIssue[] } | null {
  const tables = Array.from(doc.querySelectorAll('table'));
  const warnings: ParseIssue[] = [];

  for (const table of tables) {
    const headerRow = Array.from(table.querySelectorAll('tr')).find((row) =>
      Array.from(row.querySelectorAll('th, td')).some((cell) => cell.textContent && cell.textContent.trim().length > 0)
    );
    if (!headerRow) continue;

    const cells = Array.from(headerRow.querySelectorAll('th, td'));
    const headerIndex: Record<string, number> = {};
    const headerTexts = cells.map((cell, idx) => {
      const normalized = normalizeHeader(cell.textContent || '');
      if (normalized) headerIndex[normalized] = idx;
      return normalized;
    });

    const hasAll = requiredHeaders.every((h) => headerTexts.some((t) => t.includes(normalizeHeader(h))));
    if (hasAll) {
      return { table, headerIndex, warnings };
    }
  }

  warnings.push({
    code: 'missing-header',
    detail: `No table found containing headers: ${requiredHeaders.join(', ')}`,
  });
  return null;
}

export function cellText(row: Element, index: number): string {
  const cells = row.querySelectorAll('td');
  return cells[index]?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Build a normalized-header -> column-index map for a table's header row. */
export function indexHeaders(table: HTMLTableElement): Record<string, number> {
  const headerIndex: Record<string, number> = {};
  const headerRow = Array.from(table.querySelectorAll('tr')).find((row) =>
    Array.from(row.querySelectorAll('th, td')).some((cell) => cell.textContent && cell.textContent.trim().length > 0)
  );
  if (!headerRow) return headerIndex;
  Array.from(headerRow.querySelectorAll('th, td')).forEach((cell, idx) => {
    const normalized = normalizeHeader(cell.textContent || '');
    if (normalized) headerIndex[normalized] = idx;
  });
  return headerIndex;
}

export function toNumber(value: string): number | null {
  if (value === undefined || value === null) return null;
  const cleaned = value.replace(/[%,]/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '--' || /^-$/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function toInt(value: string): number | null {
  const num = toNumber(value);
  return num === null ? null : Math.round(num);
}

/**
 * VIT course codes look like BCSE302L, BMAT101L, CSE2001, CSE2001L, MAT2002,
 * EEE1001 ... — 2-6 letters, then 3 OR 4 digits, an optional letter, and an
 * optional L (lab). The 3-digit forms (BCSE302L) are the CURRENT VIT Chennai
 * convention; 4-digit forms appear in older codes and fixtures.
 */
export function isPlausibleCourseCode(value: string): boolean {
  return /^[A-Z]{2,6}\d{3,4}[A-Z]?L?$/.test(value.trim());
}

/** 0..100 clamp. */
export function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * VTOP dates arrive in many formats ("18-AUG-2026", "18/08/2026", "2026-08-18").
 * Normalize to ISO YYYY-MM-DD when possible; otherwise return the raw string.
 */
export function normalizeDate(raw: string): string {
  const value = raw.trim();
  if (!value) return '';

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  // dd-MMM-yyyy  or  dd-MMM-yy
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const mmm = value.match(/^(\d{1,2})[-\s/]+([A-Za-z]{3,4})[-\s/]+(\d{2,4})$/);
  if (mmm) {
    const [, dd, mon, yyyyRaw] = mmm;
    const month = monthMap[mon.slice(0, 3).toLowerCase()];
    if (month) {
      let yyyy = yyyyRaw.length === 2 ? `20${yyyyRaw}` : yyyyRaw;
      const day = dd.padStart(2, '0');
      return `${yyyy}-${month}-${day}`;
    }
  }

  // dd/mm/yyyy
  const dmy = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  return value;
}

/** "08:00 AM" | "8:00" | "8 AM" -> "08:00" (24h). Returns '' when unparseable. */
export function to24hTime(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return '';
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridian = (match[3] || '').toUpperCase();
  if (meridian === 'PM' && hour < 12) hour += 12;
  if (meridian === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * True when the HTML looks like a VTOP login / auth page rather than a data
 * page. Matches BOTH the legacy portal markup (processLogin/uname/passwd/
 * captchaCheck — pre-2024 research) and the CURRENT Chennai portal markup
 * (id="vtopLoginForm", name="captchaStr", id="captchaBlock"), which was
 * confirmed live on 2026-08-10.
 */
export function isLikelyLoginPage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('processlogin') ||
    lower.includes('name="uname"') ||
    lower.includes('name="captchacheck"') ||
    lower.includes('vtoploginform') ||
    lower.includes('name="captchastr"') ||
    (lower.includes('login') && lower.includes('password') && lower.includes('captcha'))
  );
}

/**
 * True when VTOP served a session-expiry / not-authorized page instead of
 * data. Markers are the ones the current Chennai portal emits (verified via
 * the login/error page and corroborated by the live-tested VtopMCP client).
 */
export function isLikelySessionExpiredPage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('not authorized') ||
    lower.includes('session expired') ||
    lower.includes('session timed out') ||
    lower.includes('sessiontimeout') ||
    lower.includes('your session has expired') ||
    lower.includes('vtoploginform') ||
    lower.includes('invalid captcha')
  );
}

export function isLikelyErrorPage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('exception') ||
    lower.includes('session timed out') ||
    lower.includes('your session has expired')
  );
}
