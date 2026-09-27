import { CourseMarksRecord, ExamRecord, ComponentMark, MarkPart } from '../types';
import {
  parseDocument,
  findTableByHeaders,
  cellText,
  toNumber,
  parseOutcome,
  ParseOutcome,
  normalizeDate,
  isLikelyLoginPage,
  isLikelySessionExpiredPage,
  isPlausibleCourseCode,
  normalizeHeader,
} from './helpers';

/**
 * VTOP's Weightage % column is the only weight this portal uses, so a blank
 * weightage cell means the course has NO declared weight. Falling back to the
 * standard VIT Chennai split (CAT 1: 15, CAT 2: 15, DA 1: 5, DA 2: 5, Quiz: 10)
 * made every projection wrong: a CAT weighted at 20 was modelled at 15, and a
 * course whose internals weigh 60 was modelled at 50 plus 10 unpublished marks.
 * Unknown weight means exactly that — the grade model reports the scheme as
 * undeclared instead of inventing one.
 */
const UNDECLARED_WEIGHTAGE = 0;

type MarkComponentKey = 'cat1' | 'cat2' | 'da1' | 'da2' | 'da3' | 'quiz';

/**
 * Which half of the course a marks row belongs to, from VTOP's own Course Type
 * and Slot columns (the two signals the current portal publishes). Lab slots
 * are 'L…'; an embedded course therefore arrives as a 'T' row set and an 'L'
 * row set that must be credit-weighted separately, not summed together.
 */
function markPartOf(courseType: string, slot: string, courseCode: string): MarkPart {
  const t = (courseType || '').toUpperCase();
  if (t.includes('ELA') || t.includes('LAB')) return 'L';
  const firstSlot = (slot || '').toUpperCase().replace(/[^A-Z]/g, '').charAt(0);
  if (firstSlot === 'L') return 'L';
  if ((courseCode || '').toUpperCase().endsWith('L')) return 'L';
  return 'T';
}

/**
 * Map a VTOP assessment title onto the CAT 1 / CAT 2 / DA 1 / DA 2 / Quiz
 * slots. Tolerant of BOTH the short forms seen in fixtures ("CAT 1",
 * "CAT-1", "CAT I", "DA 1", "Quiz 1") AND the full-word titles the live
 * Chennai portal actually serves ("Continuous Assessment Test - I",
 * "Assignment - II", "Digital Assignment - I", "Quiz - I", "Online
 * Assessment").
 *
 * "Assessment - N" is the soft-skill/ACE equivalent of a digital assignment
 * (BASTS101 publishes "Assessment - 1/2/3" next to its CAT), so it maps to
 * DA N — but only for the theory half: a lab course's "Assessment - N" is an
 * experiment mark and stays unmapped. Lab-specific rows ("Experiment_N",
 * "PAT - N") never become CAT/DA/Quiz.
 */
function componentFromTitle(titleRaw: string, part: MarkPart = 'T'): MarkComponentKey | null {
  const t = titleRaw.toLowerCase().replace(/\s+/g, ' ');
  const flat = t.replace(/[^a-z0-9]/g, '');
  const hasSuffixOne = /(^|[^a-z])(i|1)\s*$/.test(t);
  const hasSuffixTwo = /(^|[^a-z])(ii|2)\s*$/.test(t);
  // CAT: "CAT 1" / "CAT1" / "CAT I" / "Continuous Assessment Test - I"
  const isCat = flat.includes('cat') || /continuous\s*assessment\s*test/.test(t);
  if (isCat) {
    if (flat.includes('cat1') || t.includes('cat 1') || /\bcat\s*i\b/.test(t) || hasSuffixOne) return 'cat1';
    if (flat.includes('cat2') || t.includes('cat 2') || /\bcat\s*ii\b/.test(t) || hasSuffixTwo) return 'cat2';
  }
  // DA short forms first ("DA 1", "DA-1", "DA1" carry no "assignment" word).
  // VIT publishes THREE digital assignments ("DA - 1/2/3"), each its own row
  // at its own weightage — a third row mapped to nothing silently dropped a
  // declared component from the total.
  if (flat.includes('da1') || flat.includes('digitalassignment1')) return 'da1';
  if (flat.includes('da2') || flat.includes('digitalassignment2')) return 'da2';
  if (flat.includes('da3') || flat.includes('digitalassignment3')) return 'da3';
  // DA full words: "Digital Assignment 1" / "Assignment - I" ("assignment" is
  // NOT a substring of "assessment", so the soft-skill rows below are separate).
  const isAssignment = flat.includes('assignment');
  if (isAssignment) {
    if (/(^|[^a-z])i\b/.test(t) || t.includes(' 1')) return 'da1';
    if (/(^|[^a-z])ii\b/.test(t) || t.includes(' 2')) return 'da2';
    if (/(^|[^a-z])iii\b/.test(t) || t.includes(' 3')) return 'da3';
  }
  // Soft-skill / ACE courses name their digital-assignment equivalent
  // "Assessment - N" (BASTS101: "Assessment - 1", "Assessment - 2"). Map it to
  // DA N for the theory half only — a lab course's "Assessment - N" is an
  // experiment mark, not a DA, and must stay in extraComponents. CAT ("Continuous
  // Assessment Test") and FAT ("Final Assessment Test") are handled above, so any
  // "assessment" reaching here is a plain numbered assessment.
  if (part !== 'L' && flat.includes('assessment')) {
    if (/(^|[^a-z])i\b/.test(t) || t.includes(' 1')) return 'da1';
    if (/(^|[^a-z])ii\b/.test(t) || t.includes(' 2')) return 'da2';
    if (/(^|[^a-z])iii\b/.test(t) || t.includes(' 3')) return 'da3';
  }
  // Quiz: "Quiz" / "Quiz - I" / "Quiz 1" / "Online Assessment"
  if (flat.includes('quiz') || flat.includes('onlineassessment')) return 'quiz';
  return null;
}

/** True when the title is the FAT assessment ("Final Assessment Test"/"FAT"). */
function isFatTitle(title: string): boolean {
  return (
    (/\bfat\b/i.test(title) && !/cat/i.test(title)) ||
    /final\s*assessment\s*test/i.test(title) ||
    /^final\s*exam/i.test(title)
  );
}

function makeComponent(weightage: number, part?: MarkPart): ComponentMark {
  return { title: '', maxMarks: 0, scored: 0, weightageMax: weightage, weightageScored: 0, status: 'Pending', ...(part ? { part } : {}) };
}

/**
 * A record for one course row VTOP served. The standard CAT/DA/Quiz slots are
 * left EMPTY (weightage 0) until VTOP publishes a row for them: a fresh
 * semester has no CAT 2 yet, and seeding the regulation weightage there made
 * the page claim ungraded weight that does not exist and let the projection
 * silently score a phantom zero.
 */
function emptyRecord(courseCode: string, courseTitle: string, courseType = '', slot = ''): CourseMarksRecord {
  const part = markPartOf(courseType, slot, courseCode);
  return {
    courseCode,
    courseTitle,
    cat1: makeComponent(0, part),
    cat2: makeComponent(0, part),
    da1: makeComponent(0, part),
    da2: makeComponent(0, part),
    da3: makeComponent(0, part),
    quiz: makeComponent(0, part),
    extraComponents: [],
    courseType,
    slot,
    totalInternalWeightScored: 0,
    // A pending VTOP row is not evidence of a low grade. Keep this explicit
    // until at least one internal component has actually been evaluated.
    currentEstimatedGrade: 'Internal marks not available',
  };
}

function hasEvaluatedInternal(record: CourseMarksRecord): boolean {
  return (['cat1', 'cat2', 'da1', 'da2', 'da3', 'quiz'] as const).some((key) => {
    const component = record[key];
    return component.status === 'Evaluated' && component.maxMarks > 0;
  });
}

function titleFor(key: MarkComponentKey): string {
  switch (key) {
    case 'cat1': return 'CAT 1';
    case 'cat2': return 'CAT 2';
    case 'da1': return 'Digital Assignment 1';
    case 'da2': return 'Digital Assignment 2';
    case 'da3': return 'Digital Assignment 3';
    case 'quiz': return 'Quiz / Online Assessment';
    default: return '';
  }
}

/**
 * Merge two marks records for the SAME course code into one (the live page
 * serves a theory assessment table AND a lab assessment table per course).
 *
 * The theory and lab tables carry different credits and each ends in its own
 * FAT. A slot claimed by both halves keeps the theory row in place and the lab
 * row alongside it (`labFat` for the final exam, `extraComponents` for the
 * rest), so neither FAT is dropped.
 */
function mergeRecords(a: CourseMarksRecord, b: CourseMarksRecord): CourseMarksRecord {
  const filled = (c?: ComponentMark) => !!c && c.maxMarks > 0 && Number.isFinite(c.scored);
  /** Rows kept in their slot; rows displaced by the other half are returned. */
  const displaced: ComponentMark[] = [];
  const pick = (key: MarkComponentKey, x?: ComponentMark, y?: ComponentMark): ComponentMark => {
    if (!x) return y || makeComponent(0);
    if (!y) return x;
    if (filled(y) && !filled(x)) {
      if (filled(x)) displaced.push({ ...x, title: x.title || titleFor(key) });
      return y;
    }
    if (filled(x) && filled(y)) displaced.push({ ...y, title: y.title || titleFor(key) });
    return x;
  };
  const merged: CourseMarksRecord = {
    ...a,
    cat1: pick('cat1', a.cat1, b.cat1),
    cat2: pick('cat2', a.cat2, b.cat2),
    da1: pick('da1', a.da1, b.da1),
    da2: pick('da2', a.da2, b.da2),
    da3: pick('da3', a.da3, b.da3),
    quiz: pick('quiz', a.quiz, b.quiz),
    extraComponents: [...(a.extraComponents || []), ...(b.extraComponents || [])],
    // The halves stay distinguishable after the merge: prefer the record that
    // actually carried VTOP's Course Type / Slot, and note that a lab half exists.
    courseType: a.courseType || b.courseType || '',
    slot: a.slot || b.slot || '',
    courseTitle: a.courseTitle || b.courseTitle,
  };
  const fatA = a.fat;
  const fatB = b.fat;
  if (fatA || fatB) {
    merged.fat = fatA || fatB;
    // Two FAT rows (theory + lab) — keep both, ordered theory first.
    if (fatA && fatB) {
      merged.labFat = fatA.part === 'T' ? fatB : fatA;
      if (fatA.part === 'L' && fatB.part === 'T') merged.fat = fatB;
    }
  }
  if (a.labFat || b.labFat) merged.labFat = a.labFat || b.labFat;
  // Anything the merge could not keep in its slot is still VTOP's data.
  displaced.forEach((d) => merged.extraComponents!.push(d));
  return merged;
}

function weightedScoreOf(c: ComponentMark): number {
  // VTOP's own Weightage Mark column wins whenever it published one — that is
  // the number that lands in the student's final score, and VTOP rounds it in
  // ways our scored/max × weightage arithmetic does not always reproduce.
  if (c.status === 'Evaluated' && typeof c.weightageMark === 'number' && Number.isFinite(c.weightageMark)) {
    return Math.round(c.weightageMark * 100) / 100;
  }
  return c.maxMarks > 0 && c.weightageMax > 0
    ? Math.round((c.scored / c.maxMarks) * c.weightageMax * 100) / 100
    : 0;
}

function finalizeRecord(record: CourseMarksRecord): CourseMarksRecord {
  const fallbackPart = markPartOf(record.courseType || '', record.slot || '', record.courseCode);
  const part: MarkPart = record.cat1?.part ?? fallbackPart;
  for (const key of ['cat1', 'cat2', 'da1', 'da2', 'da3', 'quiz'] as const) {
    record[key].title = record[key].title || titleFor(key);
    if (part && !record[key].part) record[key].part = part;
    record[key].weightageScored = weightedScoreOf(record[key]);
  }
  if (record.fat) {
    if (part && !record.fat.part) record.fat.part = part;
    record.fat.weightageScored = weightedScoreOf(record.fat);
  }
  if (record.labFat) record.labFat.weightageScored = weightedScoreOf(record.labFat);
  // Also compute weightageScored for unmapped extra components (e.g. lab Experiments, PATs)
  for (const ec of record.extraComponents ?? []) {
    if (part && !ec.part) ec.part = part;
    ec.weightageScored = weightedScoreOf(ec);
  }
  const baseScore = record.cat1.weightageScored + record.cat2.weightageScored + record.da1.weightageScored +
    record.da2.weightageScored + record.da3.weightageScored + record.quiz.weightageScored;
  const extraScore = (record.extraComponents ?? []).reduce((s, ec) => s + (ec.weightageScored ?? 0), 0);
  record.totalInternalWeightScored = Math.round((baseScore + extraScore) * 100) / 100;
  // A course is considered to have evaluated internals if any standard component OR extra component is evaluated
  const hasEvaluatedExtra = (record.extraComponents ?? []).some(
    (ec) => ec.status === 'Evaluated' && ec.maxMarks > 0,
  );
  record.currentEstimatedGrade = hasEvaluatedInternal(record) || hasEvaluatedExtra
    ? estimateGrade(record.totalInternalWeightScored)
    : 'Internal marks not available';
  return record;
}

/**
 * VTOP Chennai "Marks" page.
 *
 * Real shape (PRIMARY — live-verified): a table.customTable whose
 * tr.tableContent course rows
 * ([0] S.No, [1] Class Nbr, [2] Course Code, [3] Course Title, [4] Course
 * Type, [5] Course System, [6] Faculty, [7] Slot, [8] Course Mode) are each
 * immediately followed by a tr.tableContent row holding a nested
 * table.customTable-level1 of assessment rows (tr.tableContent-level1 with
 * <output> cells [0] S.No, [1] Title, [2] Max Mark, [3] Weightage %,
 * [4] Status, [5] Scored Mark, [6] Weightage Mark).
 *
 * Legacy fallbacks: div#fixedTableContainer with alternating course rows +
 * nested component tables; then a flat table with CAT 1 (max) / DA / Quiz
 * columns. Components are mapped by title onto CAT 1 / CAT 2 / DA 1 / DA 2 /
 * Quiz (+ FAT); "AB"/Pending -> Pending. Unmapped components are ignored with
 * a warning (never fabricated).
 *
 * Verification status: UNVERIFIED until an authenticated live pass — see
 * src/lib/vtop/verification.ts
 */

export function parseMarksHtml(htmlString: string): CourseMarksRecord[];
export function parseMarksHtml(htmlString: string, withOutcome: true): ParseOutcome<CourseMarksRecord[]>;
export function parseMarksHtml(htmlString: string, withOutcome?: true) {
  const warnings: ParseOutcome<CourseMarksRecord[]>['warnings'] = [];
  const doc = parseDocument(htmlString);

  if (isLikelyLoginPage(htmlString) || isLikelySessionExpiredPage(htmlString)) {
    return withOutcome
      ? parseOutcome([], [{ code: 'session-expired', detail: 'Received the login page instead of marks data.' }], true)
      : [];
  }

  if (htmlString.toLowerCase().includes('no data found')) {
    return withOutcome ? parseOutcome([], [{ code: 'no-data', detail: 'VTOP reported no marks data.' }]) : [];
  }

  // --- Primary: table.customTable + nested customTable-level1 (real Chennai) ---
  const custom = Array.from(doc.querySelectorAll('table.customTable')).find((t) => {
    const rows = Array.from(t.querySelectorAll('tr'));
    return rows.some((r) => r.querySelector('table.customTable-level1'));
  });
  if (custom) {
    const records: CourseMarksRecord[] = [];
    const rows = Array.from(custom.querySelectorAll('tr'));
    let pending: CourseMarksRecord | null = null;
    const text = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    for (const row of rows) {
      // Nested assessment row — belongs to the immediately preceding course row.
      const nested = row.querySelector('table.customTable-level1');
      if (nested) {
        if (pending) {
          const part = markPartOf(pending.courseType || '', pending.slot || '', pending.courseCode);
          const assRows = Array.from(nested.querySelectorAll('tr.tableContent-level1, tr'));
          for (const assRow of assRows) {
            const cells = Array.from(assRow.querySelectorAll('td'));
            if (cells.length < 7) continue;
            const title = text(cells[1]);
            if (!title) continue;
            const statusRaw = text(cells[4]).toLowerCase();
            const rawScored = text(cells[5]);
            const isAb =
              /^(ab|absent|na|-|--|pending)$/i.test(rawScored.replace(/\s+/g, '')) ||
              statusRaw.includes('pending') ||
              statusRaw.includes('ab');
            const maxMarks = toNumber(text(cells[2])) ?? 0;
            const weightageMax = toNumber(text(cells[3])) ?? 0;
            // VTOP's own weighted mark for this row (its final column). This is
            // the number the portal puts into the total, so it outranks ours.
            const weightageMark = toNumber(text(cells[6]));
            if (isFatTitle(title)) {
              const fat: ComponentMark = {
                title,
                maxMarks,
                scored: isAb || !rawScored ? 0 : toNumber(rawScored) ?? 0,
                // No invented FAT weightage. VTOP declares the FAT's weight in
                // this same column for every other row; when it leaves this one
                // blank the weight is unknown, and the UI says so instead of
                // assuming 50 (which silently halved a 40-weight FAT target).
                weightageMax,
                weightageScored: 0,
                status: isAb || !rawScored ? 'Pending' : 'Evaluated',
                weightageMark: weightageMark ?? undefined,
                part,
              };
              // A second FAT row is the other half of an embedded course, not a
              // replacement for the first.
              if (pending.fat) {
                if (pending.labFat) pending.extraComponents!.push(fat);
                else pending.labFat = fat;
              } else {
                pending.fat = fat;
              }
              continue;
            }
            const slot = componentFromTitle(title, part);
            if (!slot) {
              // Store unmapped component in extraComponents (lab Experiments, PATs, etc.)
              if (!pending.extraComponents) pending.extraComponents = [];
              pending.extraComponents.push({
                title,
                maxMarks,
                scored: isAb || !rawScored ? 0 : toNumber(rawScored) ?? 0,
                weightageMax,
                weightageScored: 0,
                status: isAb || !rawScored ? 'Pending' : 'Evaluated',
                weightageMark: weightageMark ?? undefined,
                part,
              });
              continue; // unmapped — do not attempt pending[null] assignment
            }
            pending[slot] = {
              title,
              maxMarks,
              scored: isAb || !rawScored ? 0 : toNumber(rawScored) ?? 0,
              weightageMax,
              weightageScored: 0,
              status: isAb || !rawScored ? 'Pending' : 'Evaluated',
              weightageMark: weightageMark ?? undefined,
              part,
            };
          }
          records.push(finalizeRecord(pending));
          pending = null;
        }
        continue;
      }
      const cells = Array.from(row.children).filter((el) => el.tagName === 'TD');
      if (cells.length < 9) continue;
      const courseCode = text(cells[2]);
      if (!courseCode || !isPlausibleCourseCode(courseCode)) continue;
      // [4] Course Type and [7] Slot decide which half of an embedded course the
      // nested assessment table below belongs to. They were read and thrown
      // away, which left theory and lab rows indistinguishable after the merge.
      pending = emptyRecord(courseCode, text(cells[3]) || courseCode, text(cells[4]), text(cells[7]));
    }
    if (pending) records.push(finalizeRecord(pending));
    if (records.length) {
      // Merge duplicate course records (theory + lab assessment tables for the
      // same course) so one course = one row, keeping real values.
      const byCode = new Map<string, CourseMarksRecord>();
      for (const rec of records) {
        const existing = byCode.get(rec.courseCode);
        if (existing) byCode.set(rec.courseCode, mergeRecords(existing, rec));
        else byCode.set(rec.courseCode, rec);
      }
      const merged = [...byCode.values()].map(finalizeRecord);
      return withOutcome ? parseOutcome(merged, warnings) : merged;
    }
  }

  // --- Legacy fallback 1: #fixedTableContainer nested-table shape ---
  const container = doc.querySelector('#fixedTableContainer');
  const outerTable = container && (container as HTMLElement).tagName === 'TABLE'
    ? (container as HTMLTableElement)
    : container?.querySelector('table');
  if (outerTable) {
    // Nested tables live INSIDE outer rows; we keep every <tr> and rely on the
    // per-row guards (nested-table rows skipped; nested data rows fail the
    // course-code check). Avoid :scope (unsupported in some DOMParser impls).
    const rows = Array.from(outerTable.querySelectorAll('tr'));
    const headerRow = rows.find((r) => Array.from(r.querySelectorAll('th, td')).some((c) => (c.textContent || '').trim()));
    const headings = headerRow
      ? Array.from(headerRow.querySelectorAll('th, td')).map((c) => normalizeHeader(c.textContent || ''))
      : [];
    const idx = (fragments: string[]): number => headings.findIndex((h) => fragments.some((f) => h.includes(f)));

    const codeIdx = idx(['course code']);
    const titleIdx = idx(['course title', 'course name']);
    if (codeIdx >= 0) {
      const records: CourseMarksRecord[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.querySelector('table')) continue; // nested-table row — consumed below
        const cells = Array.from(row.children).filter((el) => el.tagName === 'TD');
        const cell = (ci: number) => (ci >= 0 && ci < cells.length ? (cells[ci].textContent || '').replace(/\s+/g, ' ').trim() : '');
        const courseCode = cell(codeIdx);
        if (!courseCode || !isPlausibleCourseCode(courseCode)) continue;
        const record = emptyRecord(courseCode, titleIdx >= 0 ? cell(titleIdx) || courseCode : courseCode);

        const innerTable = i + 1 < rows.length ? rows[i + 1].querySelector('table') : null;
        if (innerTable) {
          const innerRows = Array.from(innerTable.querySelectorAll('tr'));
          const ih = innerRows[0]
            ? Array.from(innerRows[0].querySelectorAll('th, td')).map((c) => normalizeHeader(c.textContent || ''))
            : [];
          const tIdx = ih.findIndex((h) => h.includes('title') || h.includes('component'));
          const maxIdx = ih.findIndex((h) => h.includes('max') && !h.includes('weightage'));
          const scoredIdx = ih.findIndex((h) => h.includes('scored') || h.includes('obtained'));
          const maxWtIdx = ih.findIndex((h) => h.includes('%') || h.includes('weightage mark') || h.includes('max weightage'));

          for (let j = 1; j < innerRows.length; j++) {
            const ic = Array.from(innerRows[j].querySelectorAll('td'));
            const c = (ci: number) => (ci >= 0 && ci < ic.length ? (ic[ci].textContent || '').replace(/\s+/g, ' ').trim() : '');
            const compTitle = tIdx >= 0 ? c(tIdx) : '';
            if (!compTitle) continue;
            const slot = componentFromTitle(compTitle);
            const rawScored = scoredIdx >= 0 ? c(scoredIdx) : '';
            const isAb = /^(ab|absent|na|-|--|pending)$/i.test(rawScored.replace(/\s+/g, ''));
            if (!slot) {
              // Store unmapped component in extraComponents (lab Experiments, PATs, etc.)
              if (!record.extraComponents) record.extraComponents = [];
              record.extraComponents.push({
                title: compTitle,
                maxMarks: maxIdx >= 0 ? toNumber(c(maxIdx)) ?? 0 : 0,
                scored: isAb || !rawScored ? 0 : toNumber(rawScored) ?? 0,
                weightageMax: maxWtIdx >= 0 ? toNumber(c(maxWtIdx)) ?? 0 : 0,
                weightageScored: 0,
                status: isAb || !rawScored ? 'Pending' : 'Evaluated',
              });
              continue; // unmapped — do not attempt record[null] assignment
            }

            record[slot].title = compTitle;
            record[slot].maxMarks = maxIdx >= 0 ? toNumber(c(maxIdx)) ?? 0 : 0;
            record[slot].scored = isAb || !rawScored ? 0 : toNumber(rawScored) ?? 0;
            record[slot].weightageMax = maxWtIdx >= 0 ? toNumber(c(maxWtIdx)) ?? UNDECLARED_WEIGHTAGE : UNDECLARED_WEIGHTAGE;
            record[slot].status = isAb || !rawScored ? 'Pending' : 'Evaluated';
          }
        }
        records.push(finalizeRecord(record));
      }
      if (records.length) {
        return withOutcome ? parseOutcome(records, warnings) : records;
      }
      warnings.push({ code: 'no-valid-rows', detail: 'Marks table found but no valid course rows could be parsed.' });
      return withOutcome ? parseOutcome([], warnings, true) : [];
    }
  }

  // --- Fallback: flat table with CAT/DA/Quiz columns (legacy shape) ---
  const flat = parseFlatMarks(doc, warnings);
  if (flat.found) {
    return withOutcome ? parseOutcome(flat.records, warnings) : flat.records;
  }
  warnings.push({ code: 'missing-header', detail: 'No marks table (nested #fixedTableContainer or flat CAT/DA columns) found.' });
  return withOutcome ? parseOutcome([], warnings, true) : [];
}

interface MarksColumns {
  code: number;
  title: number;
  cat1: number;
  cat2: number;
  da1: number;
  da2: number;
  da3: number;
  quiz: number;
}

interface MarksMaxes {
  cat1: number;
  cat2: number;
  da1: number;
  da2: number;
  da3: number;
  quiz: number;
}


function parseFlatMarks(
  doc: Document,
  warnings: ParseOutcome<CourseMarksRecord[]>['warnings']
): { records: CourseMarksRecord[]; found: boolean } {
  const tables = Array.from(doc.querySelectorAll('table'));
  for (const table of tables) {
    const headerRow = Array.from(table.querySelectorAll('tr')).find((r) =>
      Array.from(r.querySelectorAll('th, td')).some((c) => (c.textContent || '').trim())
    );
    if (!headerRow) continue;
    const cells = Array.from(headerRow.querySelectorAll('th, td'));
    const normalized = cells.map((c) => normalizeHeader(c.textContent || ''));

    const findIdx = (fragments: string[]): number =>
      normalized.findIndex((h) => fragments.some((f) => h.includes(f)));
    const maxFromHeader = (i: number): number => {
      if (i < 0) return 0;
      const match = cells[i].textContent?.match(/\((\d+)\)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    const cols: MarksColumns = {
      code: findIdx(['course code']),
      title: findIdx(['course title']),
      cat1: findIdx(['cat 1', 'cat1']),
      cat2: findIdx(['cat 2', 'cat2']),
      da1: findIdx(['da 1', 'da1', 'digital assignment 1']),
      da2: findIdx(['da 2', 'da2', 'digital assignment 2']),
      da3: findIdx(['da 3', 'da3', 'digital assignment 3']),
      quiz: findIdx(['quiz']),
    };
    const maxes: MarksMaxes = {
      cat1: maxFromHeader(cols.cat1),
      cat2: maxFromHeader(cols.cat2),
      da1: maxFromHeader(cols.da1),
      da2: maxFromHeader(cols.da2),
      da3: maxFromHeader(cols.da3),
      quiz: maxFromHeader(cols.quiz),
    };
    if (cols.code < 0 || (!(cols.cat1 >= 0 || cols.cat2 >= 0) && !(cols.da1 >= 0 || cols.da2 >= 0 || cols.da3 >= 0 || cols.quiz >= 0))) {
      continue;
    }

    const records: CourseMarksRecord[] = [];
    const rows = Array.from(table.querySelectorAll('tr'));
    rows.forEach((row) => {
      if (Array.from(row.querySelectorAll('th')).length > 0) return;
      const courseCode = cellText(row, cols.code);
      if (!courseCode || !isPlausibleCourseCode(courseCode)) return;

      const record = emptyRecord(courseCode, cols.title >= 0 ? cellText(row, cols.title) || courseCode : courseCode);
      const set = (key: MarkComponentKey, colIdx: number, max: number) => {
        if (colIdx < 0) return;
        const raw = cellText(row, colIdx);
        // This legacy layout has no weightage column at all, so the weight is
        // undeclared rather than assumed: the header number is the marks out of,
        // not the share of the course.
        const parsed = parseComponent(raw, UNDECLARED_WEIGHTAGE, max);
        record[key] = { ...record[key], ...parsed };
      };
      set('cat1', cols.cat1, maxes.cat1);
      set('cat2', cols.cat2, maxes.cat2);
      set('da1', cols.da1, maxes.da1);
      set('da2', cols.da2, maxes.da2);
      set('da3', cols.da3, maxes.da3);
      set('quiz', cols.quiz, maxes.quiz);
      records.push(finalizeRecord(record));
    });

    if (records.length) {
      return { records, found: true };
    }
    warnings.push({ code: 'no-valid-rows', detail: 'Flat marks table found but no valid course rows could be parsed.' });
  }
  return { records: [], found: false };
}

function parseComponent(raw: string, weightage: number, headerMax: number): Partial<ComponentMark> {
  const value = raw.replace(/\s+/g, ' ').trim();
  if (/^(ab|absent|-|--|na|pending)$/i.test(value)) {
    return { status: 'Pending', maxMarks: headerMax, scored: 0, weightageMax: weightage, weightageScored: 0 };
  }
  // Formats: "42.5", "42.5 / 50", "42.5 (50)"
  const scoredMatch = value.match(/^([\d.]+)\s*(?:\/\s*(\d+)|\(\s*(\d+)\))?/);
  if (!scoredMatch) {
    return { status: 'Pending', maxMarks: headerMax, scored: 0, weightageMax: weightage, weightageScored: 0 };
  }
  const scored = toNumber(scoredMatch[1]) ?? 0;
  const cellMax = scoredMatch[2] ? toNumber(scoredMatch[2]) ?? 0 : scoredMatch[3] ? toNumber(scoredMatch[3]) ?? 0 : 0;
  const max = cellMax || headerMax;
  return {
    title: '',
    maxMarks: max,
    scored,
    weightageMax: weightage,
    weightageScored: max > 0 ? (scored / max) * weightage : 0,
    status: 'Evaluated',
  };
}

/**
 * Partial internals are not a reliable final-grade model. Keep the legacy
 * field for cache/API compatibility, but never populate it with a grade path
 * or a warning derived from incomplete assessment rows.
 */
function estimateGrade(_internalWeight: number): string {
  return 'Grade estimate unavailable';
}

/**
 * VTOP Chennai "Exam Schedule" page.
 *
 * Real shape (corroborated by the live-tested VtopMCP client): a table whose
 * data rows are grouped under exam-type header rows that span multiple columns
 * (colspan > 1), e.g. "FAT EXAM". Data rows carry Slot / Date / Exam Time /
 * Venue / Location / Seat No. — there is NO course-code column on this page.
 * Column order is mapped from the first header row.
 *
 * Course codes are NOT present on the real schedule page, so ExamRecord
 * courseCode/courseTitle are left empty rather than invented. Enrichment with
 * the timetable (slot -> course) happens in the adapters if the UI needs it.
 *
 * Verification status: UNVERIFIED until an authenticated live pass — see
 * src/lib/vtop/verification.ts
 */
export function parseExamsHtml(htmlString: string): ExamRecord[];
export function parseExamsHtml(htmlString: string, withOutcome: true): ParseOutcome<ExamRecord[]>;
export function parseExamsHtml(htmlString: string, withOutcome?: true) {
  const warnings: ParseOutcome<ExamRecord[]>['warnings'] = [];
  const doc = parseDocument(htmlString);

  if (isLikelyLoginPage(htmlString) || isLikelySessionExpiredPage(htmlString)) {
    return withOutcome
      ? parseOutcome([], [{ code: 'session-expired', detail: 'Received the login page instead of exam schedule data.' }], true)
      : [];
  }

  if (htmlString.toLowerCase().includes('not found') || htmlString.toLowerCase().includes('no data found')) {
    return withOutcome ? parseOutcome([], [{ code: 'no-data', detail: 'VTOP reported no exam schedule data.' }]) : [];
  }

  // --- Primary: real Chennai schedule (table.customTable, POSITIONAL cells) ---
  // Rows grouped under a single-cell colspan=13 exam-type header; data rows
  // are tr.tableContent with 13 cells: [1] Course Code, [2] Course Title,
  // [4] Class Id, [5] Slot, [6] Exam Date, [7] Session, [8] Reporting Time,
  // [9] Exam Time, [10] Venue, [11] Seat Location, [12] Seat No.
  // (live-verified)
  const table =
    Array.from(doc.querySelectorAll('table.customTable, table')).find((t) => {
      const rows = Array.from(t.querySelectorAll('tr'));
      const hasColspanGroup = rows.some((r) => {
        const cell = r.querySelector('td');
        return cell && parseInt(cell.getAttribute('colspan') || '1', 10) >= 10;
      });
      if (!hasColspanGroup) return false;
      const headerRow = rows.find((r) =>
        Array.from(r.querySelectorAll('th, td')).some((c) => (c.textContent || '').trim())
      );
      const texts = headerRow
        ? Array.from(headerRow.querySelectorAll('th, td')).map((c) => normalizeHeader(c.textContent || ''))
        : [];
      return texts.some((h) => h.includes('slot')) || texts.some((h) => h.includes('seat'));
    }) || null;

  if (table) {
    const exams: ExamRecord[] = [];
    const rows = Array.from(table.querySelectorAll('tr'));
    let examTitle = '';

    const examTypeOf = (raw: string): ExamRecord['examType'] => {
      const upper = raw.toUpperCase();
      if (/\bCAT\s*[- ]?1\b/.test(upper) || /CONTINUOUS\s+ASSESSMENT\s+TEST\s*[- ]?I\b/.test(upper)) return 'CAT 1';
      if (/\bCAT\s*[- ]?2\b/.test(upper) || /CONTINUOUS\s+ASSESSMENT\s+TEST\s*[- ]?II\b/.test(upper)) return 'CAT 2';
      if (upper.includes('LAB')) return 'Lab FAT';
      // 'FAT' is matched, never assumed: an unrecognised heading (Compre,
      // Mid Sem, re-allotment) must not be labelled a FAT.
      if (/\bFAT\b|FINAL ASSESSMENT/.test(upper)) return 'FAT';
      return 'Other';
    };

    for (const row of rows) {
      if (row.classList.contains('tableHeader')) continue;
      const cells = Array.from(row.querySelectorAll('td'));
      if (!cells.length) continue;
      const first = cells[0];
      const colspan = parseInt(first.getAttribute('colspan') || '1', 10);
      if (colspan >= 10) {
        examTitle = (first.textContent || '').replace(/\s+/g, ' ').trim();
        continue;
      }
      if (!row.classList.contains('tableContent') || cells.length < 13) continue;
      const text = (i: number) => (cells[i]?.textContent || '').replace(/\s+/g, ' ').trim();
      const courseCode = text(1);
      const slot = text(5);
      if (!slot && !courseCode) continue;

      const examTime = text(9);
      const reportingTime = text(8);
      const venue = text(10) || text(11);
      exams.push({
        id: `exam-${exams.length}-${examTitle}-${slot}-${courseCode}`,
        slot: slot.split('+')[0].trim(),
        courseCode,
        courseTitle: text(2),
        examType: examTypeOf(examTitle),
        date: normalizeDate(text(6)),
        time: reportingTime && examTime ? `${reportingTime} - ${examTime}` : examTime || reportingTime,
        venue,
        seatNo: text(12),
        syllabusTopics: [],
      });
    }

    if (exams.length) {
      return withOutcome ? parseOutcome(exams, warnings) : exams;
    }
    warnings.push({ code: 'no-valid-rows', detail: 'Exam schedule table found but no valid exam rows could be parsed.' });
    return withOutcome ? parseOutcome([], warnings, true) : [];
  }

  const flat = parseFlatExams(doc, warnings);
  if (flat.found) {
    return withOutcome ? parseOutcome(flat.exams, warnings) : flat.exams;
  }
  warnings.push({ code: 'missing-header', detail: 'No exam schedule table (Slot / Date / Exam Time or Course Code / Exam Type headers) found.' });
  return withOutcome ? parseOutcome([], warnings, true) : [];
}

/** Legacy flat shape: one row per exam with Course Code / Exam Type / Date / Time / Venue. */
function parseFlatExams(
  doc: Document,
  warnings: ParseOutcome<ExamRecord[]>['warnings']
): { exams: ExamRecord[]; found: boolean } {
  const found = findTableByHeaders(doc, ['course code', 'exam type']);
  if (!found) return { exams: [], found: false };
  warnings.push(...found.warnings);
  const { table, headerIndex } = found;

  const idx = (fragments: string[]): number => {
    const key = Object.keys(headerIndex).find((k) => fragments.some((f) => k.includes(f)));
    return key ? headerIndex[key] : -1;
  };
  const col = {
    code: idx(['course code']),
    title: idx(['course title']),
    type: idx(['exam type', 'assessment', 'exam name']),
    date: idx(['date']),
    time: idx(['time', 'timing']),
    venue: idx(['venue', 'room', 'location']),
  };

  const examTypeOf = (raw: string): ExamRecord['examType'] => {
    const upper = raw.toUpperCase();
    if (/\bCAT\s*[- ]?1\b/.test(upper) || /CONTINUOUS\s+ASSESSMENT\s*[- ]?I\b/.test(upper)) return 'CAT 1';
    if (/\bCAT\s*[- ]?2\b/.test(upper) || /CONTINUOUS\s+ASSESSMENT\s*[- ]?II\b/.test(upper)) return 'CAT 2';
    if (upper.includes('LAB')) return 'Lab FAT';
    // Matched, not assumed — see the grouped parser above.
    if (/\bFAT\b|FINAL ASSESSMENT/.test(upper)) return 'FAT';
    return 'Other';
  };

  const exams: ExamRecord[] = [];
  const rows = Array.from(table.querySelectorAll('tr'));
  rows.forEach((row, rowIdx) => {
    if (Array.from(row.querySelectorAll('th')).length > 0) return;
    const courseCode = col.code >= 0 ? cellText(row, col.code) : '';
    if (!courseCode || !isPlausibleCourseCode(courseCode)) return;
    // A schedule with no exam-type column says nothing about the type; blank
    // parses to 'Other' rather than inventing a Final Assessment.
    const typeRaw = col.type >= 0 ? cellText(row, col.type) : '';
    exams.push({
      id: `exam-${rowIdx}-${courseCode}-${typeRaw}`,
      slot: '',
      courseCode,
      courseTitle: col.title >= 0 ? cellText(row, col.title) || courseCode : courseCode,
      examType: examTypeOf(typeRaw),
      date: col.date >= 0 ? normalizeDate(cellText(row, col.date)) : '',
      time: col.time >= 0 ? cellText(row, col.time) : '',
      venue: col.venue >= 0 ? cellText(row, col.venue) : '',
      seatNo: '',
      syllabusTopics: [],
    });
  });

  if (!exams.length) {
    warnings.push({ code: 'no-valid-rows', detail: 'Exam table found but no valid exam rows could be parsed.' });
  }
  return { exams, found: exams.length > 0 };
}
