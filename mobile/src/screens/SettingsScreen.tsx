/**
 * SettingsScreen.tsx — a native-style settings page in grouped sections.
 *
 * Every control maps to a real capability: theme (Appearance), the VTOP profile
 * photo (Privacy), the biometric app lock (Security), the campus (Account, where
 * the campuses UltraCC cannot sign in to yet are labelled rather than offered)
 * and a read-only Data section with the last-sync time and a manual re-sync. No
 * placeholder toggles are invented — where the app has no notification backend,
 * no fake switch is shown.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useApp } from '../state/AppContext';
import { Button, Caption, Pill, RowGroup, SectionTitle, SegmentedControl, SettingsRow } from '../components/ui';
import { CAMPUSES } from '../config';
import { PAGE, RADIUS, SP, FONT } from '../theme';

const LOCK_KEY = 'ultracc:applock';

/** What a student sees beside a campus this app cannot sign in to yet. */
const NOT_AVAILABLE_HINT = 'Not available yet';

export function SettingsScreen() {
  const { theme, themeMode, setThemeMode, campus, setCampus, showProfilePhoto, setShowProfilePhoto, logout, lastSync, syncing, sync } = useApp();
  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockSupported, setLockSupported] = useState(false);

  useEffect(() => {
    (async () => {
      const [supported, stored] = await Promise.all([
        LocalAuthentication.hasHardwareAsync().catch(() => false),
        SecureStore.getItemAsync(LOCK_KEY).catch(() => null),
      ]);
      setLockSupported(supported);
      setLockEnabled(stored === '1');
    })();
  }, []);

  const toggleLock = async (value: boolean) => {
    if (value) {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Enable app lock' });
      if (!result.success) return;
      await SecureStore.setItemAsync(LOCK_KEY, '1').catch(() => undefined);
      setLockEnabled(true);
    } else {
      await SecureStore.deleteItemAsync(LOCK_KEY).catch(() => undefined);
      setLockEnabled(false);
    }
  };

  const lastSyncLabel = lastSync?.syncedAt
    ? new Date(lastSync.syncedAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Not synced this session';

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <SectionTitle style={styles.first}>Appearance</SectionTitle>
        <View style={[styles.themeCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <SegmentedControl
            options={[
              { value: 'light' as const, label: 'Light', icon: 'sunny-outline' },
              { value: 'dark' as const, label: 'Dark', icon: 'moon-outline' },
            ]}
            value={themeMode}
            onChange={(m) => setThemeMode(m)}
          />
        </View>

        <SectionTitle>Privacy</SectionTitle>
        <RowGroup>
          <SettingsRow
            icon="image-outline"
            title="Show VTOP profile photo"
            value="Used on Home and your account page"
            tone="accent"
            last
            right={<Switch value={showProfilePhoto} onValueChange={setShowProfilePhoto} trackColor={{ true: theme.accent }} />}
          />
        </RowGroup>

        <SectionTitle>Security</SectionTitle>
        <RowGroup>
          <SettingsRow
            icon="finger-print-outline"
            title="Require biometric to open"
            value={lockSupported ? 'Lock the app with your fingerprint or face' : 'Not available on this device'}
            tone="success"
            last
            right={lockSupported ? <Switch value={lockEnabled} onValueChange={toggleLock} trackColor={{ true: theme.accent }} /> : undefined}
          />
        </RowGroup>

        <SectionTitle>Account · campus</SectionTitle>
        <RowGroup>
          {CAMPUSES.map((c, i) => (
            <SettingsRow
              key={c.id}
              icon={c.available ? 'location-outline' : 'lock-closed-outline'}
              title={c.label}
              value={c.available ? undefined : NOT_AVAILABLE_HINT}
              onPress={c.available ? () => setCampus(c.id) : undefined}
              last={i === CAMPUSES.length - 1}
              right={
                campus === c.id ? (
                  <Text style={[styles.selected, { color: theme.accent }]}>Selected</Text>
                ) : c.available ? undefined : (
                  <Pill label="Soon" tone="muted" />
                )
              }
            />
          ))}
        </RowGroup>
        <Caption style={styles.campusNote}>
          UltraCC signs in to VIT Chennai today. The other campuses are listed so you know they are coming, not because they work yet.
        </Caption>

        <SectionTitle>Data</SectionTitle>
        <RowGroup>
          <SettingsRow icon="cloud-done-outline" title="Last synced" value={lastSyncLabel} tone="info" last />
        </RowGroup>
        <Button label={syncing ? 'Syncing…' : 'Sync now'} icon="refresh" variant="soft" onPress={() => sync()} disabled={syncing} style={styles.syncBtn} />

        <Caption style={styles.footNote}>
          Academic data is cached on this device so it opens instantly. Pulling fresh numbers always re-reads VTOP through the gateway.
        </Caption>

        <Button label="Sign out" variant="ghost" tone="danger" icon="log-out-outline" onPress={() => logout()} style={styles.signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },
  first: { marginTop: SP.sm },
  themeCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.sm },
  selected: { fontFamily: FONT.extrabold, fontSize: 13 },
  campusNote: { marginTop: SP.md, lineHeight: 18 },
  syncBtn: { marginTop: SP.md },
  footNote: { marginTop: SP.lg, lineHeight: 18 },
  signOut: { marginTop: SP.xl },
});
