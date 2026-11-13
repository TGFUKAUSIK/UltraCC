/**
 * MoreScreen.tsx — the account hub: an ink identity panel, then native grouped
 * rows into Settings and Transport, an About note, and sign-out.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../state/AppContext';
import { Avatar } from '../components/Avatar';
import { Button, Caption, InkPanel, Meta, Row, RowGroup, SectionTitle, SettingsRow } from '../components/ui';
import { PAGE, RADIUS, SP, TYPE, FONT } from '../theme';

export function MoreScreen() {
  const { theme, data, logout } = useApp();
  const navigation = useNavigation<any>();
  const profile = data?.profile;
  const transport = data?.transport;
  const cgpa = data?.grades?.cgpa ?? (profile?.cgpa && profile.cgpa > 0 ? profile.cgpa : null);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <InkPanel glow="accent" style={styles.identity}>
          <Row style={styles.identityRow}>
            <Avatar name={profile?.name} dataUrl={profile?.profilePhotoDataUrl} size={58} />
            <View style={styles.flex}>
              <Text style={[styles.name, { color: theme.onInk }]} numberOfLines={1}>{profile?.name || 'Signed in'}</Text>
              <Text style={[TYPE.meta, { color: theme.onInkMuted, marginTop: 3 }]} numberOfLines={1}>
                {[profile?.registrationNo, profile?.program].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </Row>
          <Row style={styles.identityStats}>
            <IdentityStat value={profile?.branch || '—'} label="Branch" theme={theme} />
            <View style={[styles.idDiv, { backgroundColor: 'rgba(255,255,255,0.14)' }]} />
            <IdentityStat value={profile?.semester ? `Sem ${profile.semester}` : '—'} label="Semester" theme={theme} />
            <View style={[styles.idDiv, { backgroundColor: 'rgba(255,255,255,0.14)' }]} />
            <IdentityStat value={cgpa !== null ? cgpa.toFixed(2) : '—'} label="CGPA" theme={theme} />
          </Row>
        </InkPanel>

        <SectionTitle>Account</SectionTitle>
        <RowGroup>
          <SettingsRow icon="settings-outline" title="Settings" value="Appearance, campus, security" tone="accent" onPress={() => navigation.navigate('Settings')} />
          <SettingsRow icon="bus-outline" title="Transport" value={transport?.routeSelected || 'Day-scholar bus pass'} tone="secondary" onPress={() => navigation.navigate('Transport')} last />
        </RowGroup>

        <SectionTitle>About</SectionTitle>
        <View style={[styles.about, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Caption>UltraCC</Caption>
          <Meta style={{ marginTop: 6, lineHeight: 19 }}>
            Your VIT Chennai student portal. This app is a client of the same secure backend as the web version — VTOP credentials are never stored on this device.
          </Meta>
        </View>

        <Button label="Sign out" variant="ghost" tone="danger" icon="log-out-outline" onPress={() => logout()} style={styles.signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

function IdentityStat({ value, label, theme }: { value: string; label: string; theme: ReturnType<typeof useApp>['theme'] }) {
  return (
    <View style={styles.flex}>
      <Text style={[TYPE.bodyStrong, { color: theme.onInk }]} numberOfLines={1}>{value}</Text>
      <Text style={[TYPE.caption, { color: theme.onInkMuted, marginTop: 2, textTransform: 'uppercase' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },
  identity: { marginTop: SP.sm },
  identityRow: { gap: SP.md, alignItems: 'center' },
  name: { fontFamily: FONT.extrabold, fontSize: 21, letterSpacing: -0.4 },
  identityStats: { gap: SP.md, alignItems: 'center', marginTop: SP.xl },
  idDiv: { width: StyleSheet.hairlineWidth, height: 30 },
  about: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.lg },
  signOut: { marginTop: SP.xxl },
});
