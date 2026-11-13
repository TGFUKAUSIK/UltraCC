/**
 * VTOP credentials in browser storage.
 *
 * localStorage is readable by any script that ever runs on this origin, so the
 * university password must never land there. These pin that a save writes only
 * the registration number, that the password still works for this tab, that an
 * older build's stored password is moved out on upgrade, and that the Gemini
 * key has no build-time fallback compiled into the bundle.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const CRED_KEY = 'ultracc.credentials';

async function freshSettings() {
  vi.resetModules();
  return import('../settings');
}

describe('saved VTOP credentials', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it('never writes the password to localStorage', async () => {
    const { saveCredentials } = await freshSettings();
    saveCredentials({ regNo: ' 25BEE0001 ', password: 'correct-horse-battery' });

    const raw = localStorage.getItem(CRED_KEY) ?? '';
    expect(JSON.parse(raw)).toEqual({ regNo: '25BEE0001' });
    expect(raw).not.toContain('correct-horse-battery');
    for (let i = 0; i < localStorage.length; i += 1) {
      expect(localStorage.getItem(localStorage.key(i)!) ?? '').not.toContain('correct-horse-battery');
    }
  });

  it('keeps the password for the life of the tab', async () => {
    const { saveCredentials, getSavedCredentials } = await freshSettings();
    saveCredentials({ regNo: '25BEE0001', password: 'tab-only' });
    expect(getSavedCredentials()).toEqual({ regNo: '25BEE0001', password: 'tab-only' });
  });

  it('moves a password written by an older build out of storage', async () => {
    localStorage.setItem(CRED_KEY, JSON.stringify({ regNo: '25BEE0001', password: 'legacy-pass' }));

    const { getSavedCredentials } = await freshSettings();

    expect(getSavedCredentials()).toEqual({ regNo: '25BEE0001', password: 'legacy-pass' });
    expect(localStorage.getItem(CRED_KEY)).not.toContain('legacy-pass');
  });

  it('drops the password when the student signs out', async () => {
    const { saveCredentials, clearSavedCredentials, getSavedCredentials } = await freshSettings();
    saveCredentials({ regNo: '25BEE0001', password: 'tab-only' });
    clearSavedCredentials();
    expect(getSavedCredentials()).toEqual({ regNo: '', password: '' });
  });

  it('does not compile an operator Gemini key into the bundle', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'operator-key-that-must-not-ship');
    const { getGeminiApiKey } = await freshSettings();
    expect(getGeminiApiKey()).toBe('');
  });
});
