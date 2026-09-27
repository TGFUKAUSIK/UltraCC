/**
 * UltraCC local settings — persisted in localStorage (device-local only).
 *
 * Holds: saved VTOP credentials (prefilled into the login form), the user's
 * Gemini API key (used only for AI chat, sent directly to Google), and the
 * accent/theme preferences. Nothing here is ever sent to VTOP, the gateway, or any
 * third party other than Google when the user actively chats with the AI.
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

export function getSavedCredentials(): SavedCredentials {
  return read<SavedCredentials>(CRED_KEY) || { regNo: '', password: '' };
}

export function saveCredentials(creds: SavedCredentials): void {
  write(CRED_KEY, { regNo: creds.regNo.trim(), password: creds.password });
}

export function clearSavedCredentials(): void {
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

export function getGeminiApiKey(): string {
  const stored = read<string>(GEMINI_KEY);
  if (stored) return stored;
  // Fallback: the key configured at build time via env (optional).
  try {
    return (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  } catch {
    return '';
  }
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
}

/** Apply the saved accent on startup. */
export function applySavedAccent(): void {
  try {
    document.documentElement.setAttribute('data-accent', getAccentColor());
  } catch {
    /* ignore */
  }
}

// --- Surface theme -----------------------------------------------------------

export function getAppTheme(): AppTheme {
  const stored = read<string>(THEME_KEY);
  return stored === 'dark' || stored === 'midnight' ? stored : 'light';
}

export function saveAppTheme(theme: AppTheme): void {
  write(THEME_KEY, theme);
  try {
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    /* ignore */
  }
}

export function applySavedTheme(): void {
  try {
    document.documentElement.setAttribute('data-theme', getAppTheme());
  } catch {
    /* ignore */
  }
}

// --- Feature mode (minimal vs complete) --------------------------------------

export function getFeatureMode(): FeatureMode {
  const stored = read<string>(MODE_KEY);
  return stored === 'minimal' ? 'minimal' : 'complete';
}

export function saveFeatureMode(mode: FeatureMode): void {
  write(MODE_KEY, mode);
}
