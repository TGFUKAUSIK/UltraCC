/**
 * Typed errors for the VTOP pipeline.
 *
 * Every failure path in the extension bridge, parser layer, and client layer
 * surfaces one of these codes so the UI can react (re-login, show cached data,
 * prompt extension install, etc.) instead of silently substituting mock data.
 */

export type VtopErrorCode =
  | 'EXTENSION_UNAVAILABLE'
  | 'SESSION_EXPIRED'
  | 'LOGIN_FAILED'
  | 'CAPTCHA_FAILED'
  | 'VTOP_UNAVAILABLE'
  | 'PARSE_FAILED'
  | 'OFFLINE'
  | 'UNKNOWN';

export class VtopError extends Error {
  readonly code: VtopErrorCode;
  /** Optional normalized data that WAS parsed successfully before failure. */
  readonly partialData?: unknown;

  constructor(code: VtopErrorCode, message: string, partialData?: unknown) {
    super(message);
    this.name = 'VtopError';
    this.code = code;
    this.partialData = partialData;
  }
}

export function isVtopError(err: unknown): err is VtopError {
  return err instanceof VtopError;
}

/**
 * What `RealVTOPClient` says when a fetch is attempted with no session at all.
 * Exported because the UI has to recognise the sentence: it is thrown as
 * SESSION_EXPIRED (the reaction is the same — ask for a login) but it describes
 * a different fact from a session that VTOP actually ended.
 */
export const NOT_AUTHENTICATED_MESSAGE = 'Not authenticated — call login() first.';

/**
 * True when a SESSION_EXPIRED failure really means "this tab never signed in".
 *
 * The session token lives in browser memory only, so a page reload ends it with
 * nothing expiring on VTOP's side. Both states carry the same code because the
 * action is the same, and both stay distinct from a genuine expiry because
 * "your session expired" on a plain reload reports an event that did not happen
 * — which is exactly what a student reads as "my account is broken".
 *
 * Matches the gateway's phrasing too (`Not authenticated — call DO_LOGIN
 * first`), which reaches this layer as an error message on some paths.
 */
export function isMissingSessionError(err: unknown): boolean {
  if (!isVtopError(err) || err.code !== 'SESSION_EXPIRED') return false;
  return /not authenticated|call\s+\w+\s*\(\s*\)\s*first/i.test(err.message);
}

export function toErrorMessage(err: unknown): string {
  if (isVtopError(err)) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
