/**
 * UltraCC local settings — persisted in localStorage (device-local only).
 *
 * Holds: the saved VTOP registration number, the user's Gemini API key (used
 * only for AI chat, sent directly to Google), and the accent/theme
 * preferences. Nothing here is ever sent to VTOP, the gateway, or any third
 * party other than Google when the user actively chats with the AI.
 *
 * The VTOP password is deliberately NOT in that list. It is the credential for
 * the student's university account, and localStorage is readable by any script
 * that ever runs on this origin — including one injected through a dependency
 * or an upstream string rendered into a page. The password is held in memory for
 * the life of the tab instead, which still covers the reload-free flow and the
 * silent re-login, and is dropped when the tab closes.
 */

import type { FeatureMode } from './navVisibility';

export type AccentColor = 'blue' | 'teal' | 'emerald' | 'violet' | 'rose' | 'amber';

export interface SavedCredentials {
  regNo: string;
  password: string;
}

const CRED_KEY = 'ultracc.credentials';
const GEMINI_KEY = 'ultracc.geminiApiKey';
const ACCENT_KEY = 'ultracc.accent';
const THEME_KEY = 'ultracc.theme';
const MODE_KEY = 'ultracc.featureMode';
const PHOTO_KEY = 'ultracc.showProfilePhoto';
const TARGET_ATTENDANCE_KEY = 'ultracc.targetAttendance';

export type AppTheme = 'light' | 'dark' | 'midnight';

export const THEME_OPTIONS: { id: AppTheme; label: string; description: string }[] = [
  { id: 'light', label: 'Light', description: 'Bright academic workspace' },
  { id: 'dark', label: 'Dark', description: 'Low-glare evening workspace' },
  { id: 'midnight', label: 'Midnight', description: 'Deep contrast for focus' },
];

export const ACCENT_OPTIONS: { id: AccentColor; label: string; swatch: string }[] = [
  { id: 'blue',    label: 'Blue',    swatch: '#2563eb' },
  { id: 'teal',    label: 'Teal',    swatch: '#0d9488' },
  { id: 'emerald', label: 'Emerald', swatch: '#059669' },
  { id: 'violet',  label: 'Violet',  swatch: '#7c3aed' },
  { id: 'rose',    label: 'Rose',    swatch: '#e11d48' },
  { id: 'amber',   label: 'Amber',   swatch: '#d97706' },
];

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode / quota) — settings just don't persist
  }
}

// --- Saved VTOP credentials -------------------------------------------------
//
// Only the registration number (or VTOP username) is persisted: it is an
// identifier, not a secret, and remembering it is the whole point of prefilling
// the sign-in sheet. The password lives in this tab's memory only.

let inMemoryVtopPassword = '';

/**
 * Move any password an older build wrote to localStorage into memory and
 * rewrite the stored entry without it.
 *
 * Runs once at module load so the plaintext does not survive the upgrade that
 * removes it. A student keeps the silent re-login for the rest of this tab and
 * is asked to type the password once after the next cold start.
 */
function migrateLegacyVtopPassword(): void {
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<SavedCredentials> | null;
    if (!parsed || typeof parsed !== 'object') return;
    if (typeof parsed.password === 'string' && parsed.password) {
      inMemoryVtopPassword = parsed.password;
    }
    const regNo = typeof parsed.regNo === 'string' ? parsed.regNo : '';
    localStorage.setItem(CRED_KEY, JSON.stringify({ regNo }));
  } catch {
    /* storage unavailable or the entry is not ours — nothing to migrate */
  }
}

migrateLegacyVtopPassword();

export function getSavedCredentials(): SavedCredentials {
  return { regNo: read<SavedCredentials>(CRED_KEY)?.regNo ?? '', password: inMemoryVtopPassword };
}

export function saveCredentials(creds: SavedCredentials): void {
  inMemoryVtopPassword = creds.password;
  write(CRED_KEY, { regNo: creds.regNo.trim() });
}

export function clearSavedCredentials(): void {
  inMemoryVtopPassword = '';
  try {
    localStorage.removeItem(CRED_KEY);
  } catch {
    /* ignore */
  }
}

// --- Saved LMS (Moodle) credentials ----------------------------------------

export interface SavedLmsCredentials {
  username: string;
  password: string;
}

// LMS credentials are intentionally session-memory-only. The gateway receives
// them over HTTPS for the login request, while the browser never persists them
// in localStorage, URLs, logs, or IndexedDB.
let inMemoryLmsCredentials: SavedLmsCredentials = { username: '', password: '' };
try {
  // Remove credentials written by older UltraCC builds; current builds never
  // read or persist this legacy localStorage entry.
  localStorage.removeItem('ultracc.lmsCredentials');
} catch {
  /* browser storage may be unavailable */
}

export function getSavedLmsCredentials(): SavedLmsCredentials {
  return { ...inMemoryLmsCredentials };
}

export function saveLmsCredentials(creds: SavedLmsCredentials): void {
  inMemoryLmsCredentials = { username: creds.username.trim(), password: creds.password };
}

export function clearSavedLmsCredentials(): void {
  inMemoryLmsCredentials = { username: '', password: '' };
}

// --- Gemini API key ----------------------------------------------------------
//
// The student's own key, entered in Settings and kept on this device. There is
// deliberately no build-time fallback: anything in `import.meta.env.VITE_*` is
// compiled into the public bundle, so a fallback would publish the key to every
// visitor. A key an operator wants to share belongs behind a server route, not
// in the JavaScript.

export function getGeminiApiKey(): string {
  return read<string>(GEMINI_KEY) || '';
}

export function saveGeminiApiKey(key: string): void {
  write(GEMINI_KEY, key.trim());
}

export function clearGeminiApiKey(): void {
  try {
    localStorage.removeItem(GEMINI_KEY);
  } catch {
    /* ignore */
  }
}

// --- Accent theme -------------------------------------------------------------

export function getAccentColor(): AccentColor {
  const stored = read<string>(ACCENT_KEY);
  return (ACCENT_OPTIONS.some((o) => o.id === stored) ? (stored as AccentColor) : 'blue');
}

export function saveAccentColor(color: AccentColor): void {
  write(ACCENT_KEY, color);
  try {
    document.documentElement.setAttribute('data-accent', color);
  } catch {
    /* ignore */
  }
  // Cheap, and correct if the theme was never applied: the meta tag falls back
  // to the accent swatch when the stylesheet has not been read yet.
  applyChromeThemeColor();
}

/** Apply the saved accent on startup. */
export function applySavedAccent(): void {
  try {
    document.documentElement.setAttribute('data-accent', getAccentColor());
  } catch {
    /* ignore */
  }
  applyChromeThemeColor();
}

// --- Surface theme -----------------------------------------------------------

/**
 * Which surface the app wears when the student has not chosen one.
 *
 * The portal is opened between classes, most often on a phone already in dark
 * mode, so the system preference decides the first impression instead of a
 * default that has to be corrected in Settings. An explicit choice — including
 * an explicit 'light' — always wins, which is why the stored value is read
 * first and only a *missing* key falls through to the system.
 */
function prefersDarkCanvas(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function getAppTheme(): AppTheme {
  const stored = read<string>(THEME_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'midnight') return stored;
  return prefersDarkCanvas() ? 'dark' : 'light';
}

/**
 * Whether the student has ever picked a theme. Settings uses this to mark the
 * current option as following the system, and the app uses it to decide whether
 * an OS theme flip should move the canvas with it — it should not for someone
 * who deliberately chose Light.
 */
export function hasChosenTheme(): boolean {
  const stored = read<string>(THEME_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'midnight';
}

/**
 * Paint the browser's own chrome to match the app's top edge.
 *
 * `<meta name="theme-color">` colours the Android status bar and the Safari
 * toolbar, and the OS reads it before any script runs — so it cannot name a CSS
 * variable and has to be written at runtime. The value is the *surface* the
 * app bar sits on, not the accent: a blue bar above a near-black app is a seam,
 * and the header is already the app's top edge. Reading the token back out of
 * the stylesheet keeps this from drifting when the theme palette moves.
 */
export function applyChromeThemeColor(): void {
  try {
    const token = getComputedStyle(document.documentElement).getPropertyValue('--uc-surface').trim();
    const colour = token || ACCENT_OPTIONS.find((option) => option.id === getAccentColor())?.swatch;
    if (!colour) return;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colour);
    else {
      const created = document.createElement('meta');
      created.setAttribute('name', 'theme-color');
      created.setAttribute('content', colour);
      document.head.appendChild(created);
    }
  } catch {
    /* ignore */
  }
}

export function saveAppTheme(theme: AppTheme): void {
  write(THEME_KEY, theme);
  try {
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    /* ignore */
  }
  applyChromeThemeColor();
}

export function applySavedTheme(): void {
  try {
    document.documentElement.setAttribute('data-theme', getAppTheme());
  } catch {
    /* ignore */
  }
  applyChromeThemeColor();
}

// --- Feature mode (minimal vs complete) --------------------------------------

export function getFeatureMode(): FeatureMode {
  const stored = read<string>(MODE_KEY);
  return stored === 'minimal' ? 'minimal' : 'complete';
}

export function saveFeatureMode(mode: FeatureMode): void {
  write(MODE_KEY, mode);
}

// --- Attendance safety target ------------------------------------------------

/**
 * The attendance percentage the student wants to hold — their own bar, not
 * VTOP's 75%. The Academics screen has had a slider for this since the start,
 * but it only ever read a `settings` key nothing wrote, so every reload (and
 * every remount) dropped the choice back to 75 while still showing the slider
 * as if it were a preference. Range and step match the control.
 *
 * More than one surface quotes this number, so it is a subscription rather than
 * one component's private state — see `useTargetAttendance`.
 */
export const ATTENDANCE_TARGET_MIN = 75;
export const ATTENDANCE_TARGET_MAX = 95;

/**
 * What a student who never touched the slider is held to: VTOP's own bar.
 * Every attendance surface falls back to this one constant, so a course is
 * never "safe" on one card and "at risk" on the card below it because one
 * guessed 75 while the other read the saved 85.
 */
export const ATTENDANCE_TARGET_DEFAULT = 75;

/** Labels under the slider, derived so the scale can never disagree with the range. */
export const ATTENDANCE_TARGET_TICKS: number[] = Array.from(
  { length: ATTENDANCE_TARGET_MAX - ATTENDANCE_TARGET_MIN + 1 },
  (_, i) => ATTENDANCE_TARGET_MIN + i,
).filter((value) => value % 5 === 0);

export function getTargetAttendance(): number {
  const stored = Number(read<unknown>(TARGET_ATTENDANCE_KEY));
  if (!Number.isFinite(stored)) return ATTENDANCE_TARGET_DEFAULT;
  return Math.min(ATTENDANCE_TARGET_MAX, Math.max(ATTENDANCE_TARGET_MIN, Math.round(stored)));
}

const targetListeners = new Set<() => void>();

// The 'storage' event only fires for OTHER tabs/windows on the same origin. A
// student with UltraCC open twice — laptop and phone tab, or two monitor tabs —
// would otherwise keep the second one showing bunk maths against the bar the
// first one stopped using.
let targetCrossTabBound = false;

export function subscribeTargetAttendance(listener: () => void): () => void {
  targetListeners.add(listener);
  if (!targetCrossTabBound && typeof window !== 'undefined') {
    targetCrossTabBound = true;
    window.addEventListener('storage', (event) => {
      if (event.key !== TARGET_ATTENDANCE_KEY) return;
      [...targetListeners].forEach((notify) => notify());
    });
  }
  return () => targetListeners.delete(listener);
}

export function saveTargetAttendance(percent: number): void {
  if (!Number.isFinite(percent)) return;
  const clamped = Math.min(ATTENDANCE_TARGET_MAX, Math.max(ATTENDANCE_TARGET_MIN, Math.round(percent)));
  write(TARGET_ATTENDANCE_KEY, clamped);
  // The Academics slider owns the control, but the course-intelligence cards
  // rendered right below it quote the same bar. A plain write would leave those
  // cards showing "3 safe bunks" against 75% while the slider already reads 85%,
  // so dragging the bar has to broadcast.
  [...targetListeners].forEach((listener) => listener());
}

// --- VTOP profile photo preference -------------------------------------------

/**
 * Whether the VTOP profile photo (fetched over the student's own session)
 * renders in identity surfaces, or the initials/default avatar is shown
 * instead. Default ON; stored per-device only. The preference never touches
 * the underlying photo data — turning it off just stops rendering it.
 */
export function getShowProfilePhoto(): boolean {
  const stored = read<unknown>(PHOTO_KEY);
  return stored !== false;
}

export function saveShowProfilePhoto(show: boolean): void {
  write(PHOTO_KEY, show);
  photoListeners.forEach((listener) => listener());
}

// A tiny listener set so avatar surfaces re-render the moment the toggle flips
// (the app keeps SettingsModal mounted, so a plain localStorage write would
// not repaint the header/profile photos already on screen).
const photoListeners = new Set<() => void>();

export function subscribeShowProfilePhoto(listener: () => void): () => void {
  photoListeners.add(listener);
  return () => photoListeners.delete(listener);
}
