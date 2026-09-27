/**
 * ffcsShare.ts — pure helpers for the FFCS planner's share/compare codes.
 *
 * The code format is intentionally compact and contains ONLY course codes,
 * titles, day/slot and (optionally) venue/faculty — nothing sensitive.
 */

export const PLAN_PREFIX = 'ULTRA-FFCS:v1';
/** Namespace shared by every plan-code version ("ULTRA-FFCS:v1", "v2", …). */
export const PLAN_NAMESPACE = 'ULTRA-FFCS:';

/**
 * Version token of a pasted plan code ("v1"), or null when the text doesn't
 * look like an UltraCC plan code at all. Lets callers tell apart "wrong text"
 * from "a version we can't read yet".
 */
export function planCodeVersion(text: string): string | null {
  const first = (text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  if (!first.startsWith(PLAN_NAMESPACE)) return null;
  return first.slice(PLAN_NAMESPACE.length).trim();
}

export interface PlanEntry {
  id: string;
  code: string;
  title: string;
  /** Optional student-entered metadata; absent in older share codes. */
  credits?: number;
  courseType?: string;
  day: string;
  slot: string;
  venue: string;
  faculty: string;
}

let uidCounter = 0;
export function nextPlanId(): string {
  uidCounter += 1;
  return `p${uidCounter}-${Date.now().toString(36)}`;
}

export function encodePlan(plan: Omit<PlanEntry, 'id'>[]): string {
  return [PLAN_PREFIX, ...plan.map((p) => [
    p.code,
    p.title,
    p.day,
    p.slot,
    p.venue,
    p.faculty,
    p.credits == null ? '' : String(p.credits),
    p.courseType || '',
  ].join('|'))].join('\n');
}

export function decodePlan(text: string): PlanEntry[] {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines[0]?.startsWith(PLAN_PREFIX)) return [];
  const out: PlanEntry[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split('|').map((s) => (s ?? '').trim());
    const [code, title, day, slot, venue, faculty, creditsRaw, courseType] = parts;
    // The planner encodes `day` as '' (a PlanSection only stores its slot
    // string, and the slot grid carries the meeting days), so `day` is
    // optional on decode — `slot` is the field that carries scheduling.
    if (code && title && slot) {
      const credits = creditsRaw && Number.isFinite(Number(creditsRaw)) ? Number(creditsRaw) : undefined;
      out.push({ id: nextPlanId(), code, title, day: day || '', slot, venue: venue || '', faculty: faculty || '', credits, courseType: courseType || undefined });
    }
  }
  return out;
}
