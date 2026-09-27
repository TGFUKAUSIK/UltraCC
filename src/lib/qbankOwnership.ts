/**
 * qbankOwnership.ts — device-bound ownership for Q-Bank papers.
 *
 * A paper can only be removed by supplying the capability code that was
 * generated when it was shared. That code is never displayed again after
 * upload: the sharing device keeps it in localStorage, keyed by the paper's
 * content, and the UI offers "remove" only for papers this device can prove
 * it shared. There is no prompt for the user to type anything — the server
 * still verifies the code on delete (delete_qbank_paper), so the protection
 * is unchanged; only the UX stopped borrowing Cab Share's "poster code"
 * prompt.
 *
 * The map rules themselves live in ownershipCodes.ts (shared with Cab Share);
 * this module keeps the Q-Bank naming and its content signature.
 */

import { type CodeMap, codesFor, consumeCode, holdsCode, loadCodeMap, recordCode, saveCodeMap } from './ownershipCodes';

export type PaperCodeMap = CodeMap;

const PAPER_CODES_KEY = 'ultracc:qbank-paper-codes';

/** Stable key for a paper's content (normalized the same way the POST is). */
export function paperKey(paper: { course_code: string; title: string; url: string }): string {
  return [paper.course_code.trim().toUpperCase(), paper.title.trim(), paper.url.trim()].join('|');
}

/** Bind one removal code to a paper key. Returns a new map; duplicates ignored. */
export function recordPaperCode(map: PaperCodeMap, key: string, code: string): PaperCodeMap {
  return recordCode(map, key, code);
}

/** Every removal code this device holds for a paper key ([] = not removable). */
export function codesForPaper(map: PaperCodeMap, key: string): string[] {
  return codesFor(map, key);
}

/** True when this device holds at least one removal code for the paper. */
export function canRemovePaper(map: PaperCodeMap, key: string): boolean {
  return holdsCode(map, key);
}

/** Drop one code after a successful server-side delete; removes the key when empty. */
export function consumePaperCode(map: PaperCodeMap, key: string, code: string): PaperCodeMap {
  return consumeCode(map, key, code);
}

export function loadPaperCodeMap(): PaperCodeMap {
  return loadCodeMap(PAPER_CODES_KEY);
}

export function savePaperCodeMap(map: PaperCodeMap): void {
  saveCodeMap(PAPER_CODES_KEY, map);
}
