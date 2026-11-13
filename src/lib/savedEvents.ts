/**
 * savedEvents.ts — the student's saved (bookmarked) Event Hub events.
 *
 * Only these events may produce a campus-event notification: a notice fires
 * solely for something the student explicitly saved, never for every event the
 * Event Hub happens to list. Saved events live on-device in localStorage and
 * carry just the fields a notification needs (id / title / date) — no
 * credentials, no session, nothing about VTOP.
 */

export interface SavedEvent {
  eid: string;
  title: string;
  date: string;
}

const KEY = 'ultracc.savedEvents';

function read(): SavedEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedEvent[]) : [];
  } catch {
    return [];
  }
}

function write(list: SavedEvent[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — saved events simply don't persist
  }
}

const listeners = new Set<() => void>();

// Snapshot cache: `getSavedEvents` is the useSyncExternalStore snapshot, so it
// must return the same array reference until the store actually changes.
let cache: SavedEvent[] = read();

function emit(): void {
  cache = read();
  listeners.forEach((l) => l());
}

export function getSavedEvents(): SavedEvent[] {
  return cache;
}

export function isSaved(eid: string): boolean {
  return cache.some((e) => e.eid === eid);
}

export function saveEvent(event: SavedEvent): void {
  if (cache.some((e) => e.eid === event.eid)) return;
  write([...cache, event]);
  emit();
}

export function removeSavedEvent(eid: string): void {
  const next = cache.filter((e) => e.eid !== eid);
  if (next.length === cache.length) return;
  write(next);
  emit();
}

/** Returns the new saved state (true = now saved). */
export function toggleSavedEvent(event: SavedEvent): boolean {
  if (isSaved(event.eid)) {
    removeSavedEvent(event.eid);
    return false;
  }
  saveEvent(event);
  return true;
}

export function subscribeSavedEvents(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
