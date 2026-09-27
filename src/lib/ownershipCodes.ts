/**
 * ownershipCodes.ts — the shared device-ownership primitive.
 *
 * Community boards (Q-Bank papers, Cab Share rides) protect edits with a
 * capability code generated at post time and verified by the server. The code
 * is shown once; if the browser forgets it on reload the student loses the
 * ability to manage their own listing, so each feature keeps the codes it
 * earned in localStorage under its own key, mapped from a content signature.
 *
 * This is deliberately only a *lookup* mechanism: it never grants anything by
 * itself. Every mutating call still sends the stored code to the server, which
 * checks it against the row. A device that does not hold a code cannot manage
 * the entry, exactly as before.
 */

export type CodeMap = Record<string, string[]>;

/** Bind one code to a key. Returns a new map; duplicate codes are ignored. */
export function recordCode(map: CodeMap, key: string, code: string): CodeMap {
  const existing = map[key] ?? [];
  if (existing.includes(code)) return map;
  return { ...map, [key]: [...existing, code] };
}

/** Every code this device holds for a key ([] = nothing to prove). */
export function codesFor(map: CodeMap, key: string): string[] {
  return map[key] ?? [];
}

/** True when this device holds at least one code for the key. */
export function holdsCode(map: CodeMap, key: string): boolean {
  return (map[key]?.length ?? 0) > 0;
}

/** Drop one code after a successful server-side operation; removes the key when empty. */
export function consumeCode(map: CodeMap, key: string, code: string): CodeMap {
  const remaining = (map[key] ?? []).filter((c) => c !== code);
  const next = { ...map };
  if (remaining.length > 0) next[key] = remaining;
  else delete next[key];
  return next;
}

/** Most recently recorded code for a key, or null. */
export function latestCode(map: CodeMap, key: string): string | null {
  const codes = map[key] ?? [];
  return codes.length > 0 ? codes[codes.length - 1] : null;
}

// ---------------------------------------------------------------------------
// localStorage adapters (thin; a storage failure just means this device cannot
// prove ownership after a reload — the server-side code check still applies).
// ---------------------------------------------------------------------------

export function loadCodeMap(storageKey: string): CodeMap {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: CodeMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        const codes = value.filter((c): c is string => typeof c === 'string' && c.length > 0);
        if (codes.length > 0) out[key] = codes;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCodeMap(storageKey: string, map: CodeMap): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // storage unavailable — ownership just doesn't persist
  }
}
