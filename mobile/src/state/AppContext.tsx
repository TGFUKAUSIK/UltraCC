/**
 * AppContext.tsx — the mobile app's single source of state: theme, campus, the
 * VTOP session, and the synced academic snapshot. The gateway client lives here
 * so its in-memory session token has exactly one owner for the app's lifetime.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VtopError, VtopGatewayClient } from '../lib/gateway';
import { loadCachedData, pickSemesterId, readMeta, syncSemesterData, type CachedData, type SyncResult } from '../lib/sync';
import { themeFor, type Theme, type ThemeMode } from '../theme';
import { AVAILABLE_CAMPUS, type Campus } from '../config';
import type { SemesterInfo } from '../types';

const THEME_KEY = 'ultracc:theme';
const CAMPUS_KEY = 'ultracc:campus';
const PHOTO_KEY = 'ultracc:showProfilePhoto';

interface AppState {
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  campus: Campus;
  setCampus: (c: Campus) => void;
  showProfilePhoto: boolean;
  setShowProfilePhoto: (v: boolean) => void;

  client: VtopGatewayClient;
  authenticated: boolean;

  semesters: SemesterInfo[];
  selectedSemesterId: string;
  data: CachedData | null;
  loading: boolean;
  syncing: boolean;
  lastSync: SyncResult | null;

  login: (regNo: string, password: string, captcha: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSessionStatus: () => Promise<void>;
  sync: (semesterId?: string) => Promise<SyncResult>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('light');
  const [campus, setCampusState] = useState<Campus>('chennai');
  const [showProfilePhoto, setShowProfilePhotoState] = useState(true);

  const clientRef = useRef<VtopGatewayClient | null>(null);
  if (!clientRef.current) clientRef.current = new VtopGatewayClient();
  const client = clientRef.current;

  const [authenticated, setAuthenticated] = useState(false);
  const [semesters, setSemesters] = useState<SemesterInfo[]>([]);
  const [selectedSemesterId, setSelectedSemesterId] = useState('');
  const [data, setData] = useState<CachedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  // Hydrate persisted settings on mount.
  useEffect(() => {
    (async () => {
      try {
        const [theme, campusVal, photo] = await Promise.all([
          AsyncStorage.getItem(THEME_KEY),
          AsyncStorage.getItem(CAMPUS_KEY),
          AsyncStorage.getItem(PHOTO_KEY),
        ]);
        if (theme === 'dark') setThemeModeState('dark');
        // Only Chennai's VTOP is supported today, and a stored value from an
        // older build could name another campus. Ignore it rather than ship a
        // signed-in-looking shell with no data behind it.
        if (campusVal === AVAILABLE_CAMPUS) {
          setCampusState(campusVal);
          client.setCampus(campusVal);
        }
        if (photo === 'false') setShowProfilePhotoState(false);
      } catch {
        /* settings just stay default */
      }
      setLoading(false);
    })();
  }, [client]);

  const setThemeMode = useCallback((m: ThemeMode) => {
    setThemeModeState(m);
    AsyncStorage.setItem(THEME_KEY, m).catch(() => undefined);
  }, []);

  const setCampus = useCallback((c: Campus) => {
    setCampusState(c);
    client.setCampus(c);
    AsyncStorage.setItem(CAMPUS_KEY, c).catch(() => undefined);
  }, [client]);

  const setShowProfilePhoto = useCallback((v: boolean) => {
    setShowProfilePhotoState(v);
    AsyncStorage.setItem(PHOTO_KEY, String(v)).catch(() => undefined);
  }, []);

  const logout = useCallback(async () => {
    await client.logout();
    setAuthenticated(false);
    setData(null);
    setSemesters([]);
    setSelectedSemesterId('');
  }, [client]);

  const refreshSessionStatus = useCallback(async () => {
    setAuthenticated(client.isAuthenticated());
  }, [client]);

  const sync = useCallback(async (semesterId?: string) => {
    setSyncing(true);
    try {
      const list = semesters.length ? semesters : await client.getSemesters();
      setSemesters(list);
      const meta = await readMeta();
      const target = semesterId || pickSemesterId(meta?.selectedSemesterId || '', list);
      setSelectedSemesterId(target);
      const result = await syncSemesterData(client, target, list);
      setLastSync(result);
      // The registration number is only known after the profile is fetched, so
      // re-read the meta the sync just wrote and load the persisted snapshot.
      const freshMeta = await readMeta();
      if (freshMeta?.registrationNo) {
        const cached = await loadCachedData(freshMeta.registrationNo, freshMeta.selectedSemesterId);
        setData(cached);
      }
      return result;
    } catch (e) {
      if (e instanceof VtopError && e.code === 'SESSION_EXPIRED') {
        // The in-memory session is gone (cold start, or VTOP dropped it). Sign
        // out so the student returns to login instead of a dead shell.
        await client.logout();
        setAuthenticated(false);
        setData(null);
        setSemesters([]);
        setSelectedSemesterId('');
      }
      throw e;
    } finally {
      setSyncing(false);
    }
  }, [client, semesters]);

  const login = useCallback(async (regNo: string, password: string, captcha: string) => {
    const result = await client.login(regNo.trim(), password, captcha);
    if (!result.success) throw new Error(result.message);
    setAuthenticated(true);
    // Kick off the first sync in the background so Home has data without a tap.
    void sync().catch(() => undefined);
  }, [client, sync]);

  const theme = useMemo(() => themeFor(themeMode), [themeMode]);

  const value: AppState = {
    theme,
    themeMode,
    setThemeMode,
    campus,
    setCampus,
    showProfilePhoto,
    setShowProfilePhoto,
    client,
    authenticated,
    semesters,
    selectedSemesterId,
    data,
    loading,
    syncing,
    lastSync,
    login,
    logout,
    refreshSessionStatus,
    sync,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
