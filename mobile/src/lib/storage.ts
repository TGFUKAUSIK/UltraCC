/**
 * storage.ts — AsyncStorage-backed offline cache for the mobile app.
 *
 * The cache holds VTOP data AFTER a successful sync, keyed by registration
 * number + semester so one student's rows can never surface under another.
 * Unlike the web app's IndexedDB, credentials are NEVER written here — the
 * gateway session token is memory-only and VTOP passwords are never stored.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'ultracc:v1:';

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable — cache just doesn't persist this time.
  }
}

export async function removeCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Remove every UltraCC cache key (used on account switch / logout). */
export async function clearAllCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    /* ignore */
  }
}
