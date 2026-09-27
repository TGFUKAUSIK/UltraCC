/**
 * ffcsPlanner.ts — FFCS planning engine (pure, testable).
 *
 * Data model adapted from FFCSonTheGo (github.com/vatz88/FFCSonTheGo,
 * GPL-3.0): a per-campus slot grid (theory/lab rows: time → slot per day)
 * plus a course inventory where every row is one offered section
 * (CODE/TITLE/TYPE/CREDITS/VENUE/SLOT/FACULTY). The Chennai files are
 * vendored under src/data/ffcs-*.json.
 *
 * HONESTY: this catalogue is a SNAPSHOT of the sections FFCSonTheGo
 * published for Fall Semester 2026-27 — it is NOT a live feed of what VIT
 * is offering right now. The UI must surface that provenance; seat
 * availability does not exist in this data and is never implied.
 *
 * PLANS: a plan is a list of picked sections. A section expands through the
 * slot grid into concrete day×slot meetings; clashes are computed between
 * expanded meetings (handles multi-slot sections like "F1+TF1" and the
 * theory/lab double-occupancy grid, e.g. L-rows overlapping theory rows at
 * the same wall-clock time).
 */

import catalogueJson from '../data/ffcs-catalogue-chennai.json';
import slotGridJson from '../data/ffcs-slot-grid-chennai.json';

// ---------------------------------------------------------------------------
// Vendored data (FFCSonTheGo, Fall Semester 2026-27 snapshot)

/** One offered section in the catalogue. */
export interface FfcsSection {
  code: string;
  title: string;
  /** ETH/TH/ELA/LO/SS/OC/PJT/EPJ as published. */
  type: string;
  credits: number;
  venue: string;
  /** Slot string as published, e.g. "F1+TF1" or "L11+L12". */
  slot: string;
  faculty: string;
}

export const FFCS_CATALOGUE: FfcsSection[] = (catalogueJson as {
  CODE: string; TITLE: string; TYPE: string; CREDITS: string; VENUE: string; SLOT: string; FACULTY: string;
}[]).map((r) => ({
  code: r.CODE,
  title: r.TITLE,
  type: r.TYPE || '',
  credits: parseInt(r.CREDITS, 10) || 0,
  venue: r.VENUE || '',
  slot: (r.SLOT || '').trim(),
  faculty: r.FACULTY || '',
}));

/** Semester the vendored snapshot describes — shown in the UI. */
export const FFCS_DATA_SEMESTER = 'Fall Semester 2026-27';

interface GridRow { start: string; end: string; days?: Record<string, string>; lunch?: boolean }
const GRID = slotGridJson as { theory: GridRow[]; lab: GridRow[] };

// ---------------------------------------------------------------------------
// Unique courses + section lookup

export interface FfcsCourseOption {
  code: string;
  title: string;
  sectionCount: number;
  /** Distinct course types offered across its sections (e.g. TH + LO). */
  types: string[];
}

/** Unique courses (the picker's autocomplete entries), title from first row. */
export function ffcsCourseOptions(): FfcsCourseOption[] {
  const byCode = new Map<string, FfcsCourseOption>();
  for (const s of FFCS_CATALOGUE) {
    const existing = byCode.get(s.code);
    if (existing) {
      existing.sectionCount += 1;
      if (!existing.types.includes(s.type)) existing.types.push(s.type);
    } else {
      byCode.set(s.code, { code: s.code, title: s.title, sectionCount: 1, types: [s.type] });
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** All sections offered for one course code, in catalogue order. */
export function ffcsSectionsFor(code: string): FfcsSection[] {
  const wanted = code.trim().toUpperCase();
  return FFCS_CATALOGUE.filter((s) => s.code.toUpperCase() === wanted);
}

/** Case-insensitive search across code + title (picker filtering). */
export function searchFfcsCourses(query: string, limit = 12): FfcsCourseOption[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const options = ffcsCourseOptions();
  const starts: FfcsCourseOption[] = [];
  const contains: FfcsCourseOption[] = [];
  for (const o of options) {
    if (o.code.toUpperCase().startsWith(q) || o.title.toUpperCase().startsWith(q)) starts.push(o);
    else if (o.code.toUpperCase().includes(q) || o.title.toUpperCase().includes(q)) contains.push(o);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Slot grid — slot → meeting times per day

export interface SlotMeeting {
  day: string;
  /** 24h "HH:MM". */
  start: string;
  end: string;
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABEL: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/** Normalize a grid time ("2:00 PM", "08:00") to 24h "HH:MM". */
export function to24h(t: string): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

/** slot token → meetings (a slot can meet at different times on different days). */
const SLOT_MEETINGS: Map<string, SlotMeeting[]> = (() => {
  const map = new Map<string, SlotMeeting[]>();
  for (const rows of [GRID.theory, GRID.lab]) {
    for (const row of rows) {
      if (!row.days || !row.start || !row.end) continue;
      for (const day of DAY_ORDER) {
        const slot = row.days[day];
        if (!slot) continue;
        const meeting: SlotMeeting = { day: DAY_LABEL[day], start: to24h(row.start), end: to24h(row.end) };
        const list = map.get(slot) || [];
        list.push(meeting);
        map.set(slot, list);
      }
    }
  }
  return map;
})();

/** All concrete day×time meetings a slot string ("A1+TB1", "L11+L12") expands to. */
export function expandSlotString(slotString: string): SlotMeeting[] {
  const out: SlotMeeting[] = [];
  for (const token of slotString.split('+').map((t) => t.trim().toUpperCase()).filter(Boolean)) {
    for (const meeting of SLOT_MEETINGS.get(token) || []) out.push(meeting);
  }
  return out;
}

/** Every slot token that appears in the grid, grouped theory/lab-ish. */
export function allSlotTokens(): { theory: string[]; lab: string[] } {
  const theory = new Set<string>();
  const lab = new Set<string>();
  for (const [slot] of SLOT_MEETINGS) {
    if (slot.toUpperCase().startsWith('L')) lab.add(slot);
    else theory.add(slot);
  }
  return { theory: [...theory].sort(), lab: [...lab].sort() };
}

// ---------------------------------------------------------------------------
// Plans + clash detection

export interface PlanSection {
  id: string;
  code: string;
  title: string;
  slot: string;
  type: string;
  credits: number;
  venue: string;
  faculty: string;
}

export interface ExpandedMeeting extends SlotMeeting {
  /** Which plan entry produced this meeting. */
  sectionId: string;
}

/** Expand one plan section into concrete meetings. Unknown slots yield []. */
export function expandSection(section: PlanSection): ExpandedMeeting[] {
  return expandSlotString(section.slot).map((m) => ({ ...m, sectionId: section.id }));
}

/**
 * Overlap test: two meetings clash when the same day and their time ranges
 * intersect (end is exclusive; touching ranges do not clash).
 */
export function meetingsOverlap(a: SlotMeeting, b: SlotMeeting): boolean {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

export interface ClashGroup {
  /** Section ids in this clash. */
  ids: string[];
  day: string;
  start: string;
  end: string;
}

/**
 * Find every clashing group in a plan: same-day overlapping meetings from
 * DIFFERENT sections. Two meetings of the same section never self-clash
 * (VTOP slot strings don't self-overlap; if the grid disagrees, that is a
 * data error we don't model).
 */
export function findPlanClashes(sections: PlanSection[]): ClashGroup[] {
  const expanded = sections.flatMap((s) => expandSection(s));
  const groups: ClashGroup[] = [];
  for (let i = 0; i < expanded.length; i++) {
    for (let j = i + 1; j < expanded.length; j++) {
      const a = expanded[i];
      const b = expanded[j];
      if (a.sectionId === b.sectionId) continue;
      if (meetingsOverlap(a, b)) {
        groups.push({ ids: [a.sectionId, b.sectionId], day: a.day, start: a.start > b.start ? a.start : b.start, end: a.end < b.end ? a.end : b.end });
      }
    }
  }
  return groups;
}

/** Section ids involved in ANY clash (for row highlighting). */
export function clashingSectionIds(sections: PlanSection[]): Set<string> {
  const ids = new Set<string>();
  for (const g of findPlanClashes(sections)) for (const id of g.ids) ids.add(id);
  return ids;
}

/** Total planned credits; sections without a credit value contribute 0. */
export function planCredits(sections: PlanSection[]): number {
  return sections.reduce((sum, s) => sum + (s.credits || 0), 0);
}
