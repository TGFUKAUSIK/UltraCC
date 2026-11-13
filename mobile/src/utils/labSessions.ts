/**
 * labSessions.ts — VIT FFCS class-session model (ported verbatim from the web
 * app). A 2-period lab (L31+L32) is ONE combined session, never two classes.
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

const LAB_SLOT_RE = /^L\d{1,2}[A-Z]?$/;

export function isLabSlotToken(slot: string): boolean {
  return LAB_SLOT_RE.test((slot || '').trim().toUpperCase());
}

export function isLabSession(slot: Pick<SessionRow, 'slot' | 'isLab' | 'courseType'>): boolean {
  if (slot.isLab) return true;
  if ((slot.courseType || '').toUpperCase().includes('ELA')) return true;
  const tokens = (slot.slot || '').toUpperCase().split('+').map((t) => t.trim()).filter(Boolean);
  return tokens.length > 0 && tokens.every(isLabSlotToken);
}

export function slotTimeToMinutes(value: string): number | null {
  const m = (value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function sessionDurationMinutes(slot: Pick<SessionRow, 'startTime' | 'endTime'>): number | null {
  const start = slotTimeToMinutes(slot.startTime);
  const end = slotTimeToMinutes(slot.endTime);
  if (start === null || end === null || end <= start) return null;
  return end - start;
}

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

export function mergeConsecutiveLabPair(a: SessionRow, b: SessionRow): SessionRow | null {
  if (a.day !== b.day) return null;
  if (a.courseCode.toUpperCase() !== b.courseCode.toUpperCase()) return null;
  if (!isLabSlotToken(a.slot) || !isLabSlotToken(b.slot)) return null;

  const aStart = slotTimeToMinutes(a.startTime);
  const aEnd = slotTimeToMinutes(a.endTime);
  const bStart = slotTimeToMinutes(b.startTime);
  const bEnd = slotTimeToMinutes(b.endTime);
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return null;
  if (aEnd !== bStart) return null;

  return {
    ...a,
    slot: `${a.slot}+${b.slot}`,
    endTime: b.endTime,
    courseType: a.courseType || b.courseType || 'ELA',
    isLab: true,
  };
}

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

export function sessionPeriodCount(slot: Pick<SessionRow, 'startTime' | 'endTime' | 'slot' | 'isLab'>): number {
  const duration = sessionDurationMinutes(slot);
  if (duration !== null && duration >= 80) return 2;
  return 1;
}
