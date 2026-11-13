/**
 * labSessions.ts — VIT FFCS class-session model.
 *
 * In the VIT FFCS timetable, theory and lab classes are NOT equivalent:
 *
 *   - A theory class occupies exactly ONE period (e.g. A1 = Mon 08:00–08:50).
 *   - A lab class occupies TWO consecutive periods (e.g. L31+L32 = Mon
 *     14:00–15:40). VTOP models it as two slot tokens in the course's slot
 *     string ("L31+L32"), and it must be represented as ONE combined class
 *     session — a single 2-period block — not as two independent classes.
 *
 * This module is the single source of truth for that model: detection of lab
 * slot tokens, merging of per-slot rows into combined sessions, and session
 * helpers (duration, overlap/clash) that treat a lab as the one session it
 * actually is.
 */

/**
 * Structural session row — works for BOTH the canonical VTOP TimetableSlot
 * (src/lib/vtop/types) and the UI TimetableSlot (src/types). `isLab` is
 * optional because the canonical type carries the course type instead.
 */
export interface SessionRow {
  id: string;
  slot: string;
  courseCode: string;
  courseType?: string;
  day: string;
  startTime: string;
  endTime: string;
  isLab?: boolean;
}

/** A lab slot token: L1..L99 (optionally suffixed), e.g. "L31", "L7". */
const LAB_SLOT_RE = /^L\d{1,2}[A-Z]?$/;

export function isLabSlotToken(slot: string): boolean {
  return LAB_SLOT_RE.test((slot || '').trim().toUpperCase());
}

/** A lab course is one whose slot tokens (or course type) identify a lab. */
export function isLabSession(slot: Pick<SessionRow, 'slot' | 'isLab' | 'courseType'>): boolean {
  if (slot.isLab) return true;
  if ((slot.courseType || '').toUpperCase().includes('ELA')) return true;
  const tokens = (slot.slot || '').toUpperCase().split('+').map((t) => t.trim()).filter(Boolean);
  return tokens.length > 0 && tokens.every(isLabSlotToken);
}

/** Parse "HH:MM" to minutes since midnight; null when unparseable. */
export function slotTimeToMinutes(value: string): number | null {
  const m = (value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Duration of a session in minutes; null when either time is missing. */
export function sessionDurationMinutes(slot: Pick<SessionRow, 'startTime' | 'endTime'>): number | null {
  const start = slotTimeToMinutes(slot.startTime);
  const end = slotTimeToMinutes(slot.endTime);
  if (start === null || end === null || end <= start) return null;
  return end - start;
}

/** True when two same-day sessions overlap in time (clash detection). */
export function sessionsOverlap(
  a: Pick<SessionRow, 'day' | 'startTime' | 'endTime'>,
  b: Pick<SessionRow, 'day' | 'startTime' | 'endTime'>,
): boolean {
  if (a.day !== b.day) return false;
  const aStart = slotTimeToMinutes(a.startTime);
  const aEnd = slotTimeToMinutes(a.endTime);
  const bStart = slotTimeToMinutes(b.startTime);
  const bEnd = slotTimeToMinutes(b.endTime);
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false;
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Merge two consecutive lab rows (e.g. L31 14:00–14:50 + L32 14:50–15:40)
 * for the same course/day into ONE session 14:00–15:40. Returns the merged
 * slot, or null when the pair is not a mergeable consecutive lab pair.
 */
export function mergeConsecutiveLabPair(
  a: SessionRow,
  b: SessionRow,
): SessionRow | null {
  if (a.day !== b.day) return null;
  if (a.courseCode.toUpperCase() !== b.courseCode.toUpperCase()) return null;
  if (!isLabSlotToken(a.slot) || !isLabSlotToken(b.slot)) return null;

  const aStart = slotTimeToMinutes(a.startTime);
  const aEnd = slotTimeToMinutes(a.endTime);
  const bStart = slotTimeToMinutes(b.startTime);
  const bEnd = slotTimeToMinutes(b.endTime);
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return null;
  // Consecutive = the second starts exactly when the first ends.
  if (aEnd !== bStart) return null;

  return {
    ...a,
    // Slot string keeps both VTOP tokens: "L31+L32".
    slot: `${a.slot}+${b.slot}`,
    endTime: b.endTime,
    courseType: a.courseType || b.courseType || 'ELA',
    isLab: true,
  };
}

/**
 * Convert raw per-slot rows (as VTOP serves them: a 2-period lab as two
 * rows) into combined class sessions. Lab pairs on the same day/time-contiguous
 * course are merged into one session each; theory rows pass through
 * untouched. Merged sessions keep the FIRST row's id so downstream identity
 * (selected keys, notification dedup) stays stable.
 *
 * Non-contiguous lab rows (venues differ, timetable gaps) are never merged —
 * honesty over prettiness.
 */
export function combineLabSessions<T extends SessionRow>(slots: T[]): T[] {
  const groups = new Map<string, number[]>();
  slots.forEach((slot, index) => {
    if (!isLabSession(slot)) return;
    const key = `${slot.day}::${slot.courseCode.toUpperCase()}`;
    const list = groups.get(key) ?? [];
    list.push(index);
    groups.set(key, list);
  });

  const consumed = new Set<number>();
  const mergedByIndex = new Map<number, T>();
  for (const indices of groups.values()) {
    const ordered = [...indices].sort(
      (a, b) => (slotTimeToMinutes(slots[a].startTime) ?? 0) - (slotTimeToMinutes(slots[b].startTime) ?? 0),
    );
    for (let i = 0; i < ordered.length; i++) {
      const baseIndex = ordered[i];
      if (consumed.has(baseIndex)) continue;
      for (let j = i + 1; j < ordered.length; j++) {
        if (consumed.has(ordered[j])) continue;
        const merged = mergeConsecutiveLabPair(slots[baseIndex], slots[ordered[j]]);
        if (merged) {
          consumed.add(ordered[j]);
          // The merged session keeps the earlier row's shape (id + identity),
          // extended with the partner's endTime, so the generic T is preserved.
          mergedByIndex.set(baseIndex, { ...slots[baseIndex], slot: merged.slot, endTime: merged.endTime, isLab: true });
          break;
        }
      }
    }
  }

  const out: T[] = [];
  slots.forEach((slot, index) => {
    if (consumed.has(index)) return;
    out.push(mergedByIndex.get(index) ?? slot);
  });
  return out;
}

/**
 * Number of FFCS periods a session occupies: labs run 2 consecutive periods
 * (>= 80 minutes), theory exactly 1. Used by weekly-load summaries so a lab
 * is never double-counted as two independent classes.
 */
export function sessionPeriodCount(slot: Pick<SessionRow, 'startTime' | 'endTime' | 'slot' | 'isLab'>): number {
  const duration = sessionDurationMinutes(slot);
  if (duration !== null && duration >= 80) return 2;
  return 1;
}

/**
 * How many 50-minute attendance periods one class costs, for rows that carry
 * no clock: a VTOP attendance record has a slot and a course type but no
 * start/end time.
 *
 * This is the bridge between the two units the app stores. VTOP's attendance
 * summary counts periods — a lab appears with twice as many held periods as
 * sessions — while a student acts in classes. A lab session is a two-period
 * block even when the row names only its first token, because VTOP's detail
 * link spells `L31` for the timetable's `L31+L32`. Theory is always one.
 */
export function periodsPerClass(slot: Pick<SessionRow, 'slot' | 'isLab' | 'courseType'>): number {
  if (!isLabSession(slot)) return 1;
  const labTokens = (slot.slot || '')
    .toUpperCase()
    .split('+')
    .map((token) => token.trim())
    .filter(isLabSlotToken);
  return Math.max(2, labTokens.length);
}
