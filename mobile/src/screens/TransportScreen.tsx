/**
 * TransportScreen.tsx — the student's day-scholar transport registration,
 * straight from VTOP. The selected route leads as an ink hero; the rest of the
 * record is presented as native grouped rows. Shows only what VTOP states.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../state/AppContext';
import {
  Caption,
  EmptyState,
  InkPanel,
  InkTag,
  RowGroup,
  ScreenHeader,
  SectionTitle,
  SettingsRow,
} from '../components/ui';
import { PAGE, SP, TYPE } from '../theme';

export function TransportScreen() {
  const { theme, data } = useApp();
  const t = data?.transport;

  if (!t || !t.hasRegistration) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="bus-outline"
          title="No transport registration"
          hint="VTOP has no day-scholar transport record for you."
        />
      </SafeAreaView>
    );
  }

  const paid = (t.paymentStatus || '').toLowerCase().includes('paid');
  const rows: [string, string][] = [
    ['Registration number', t.registerNumber],
    ['Name', t.name],
    ['Programme', t.programme],
    ['Branch', t.branch],
    ['Payment status', t.paymentStatus],
    ['Reference', t.fpReference],
  ].filter(([, v]) => !!v) as [string, string][];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Transport" subtitle="Day-scholar bus registration" />

        <InkPanel glow="info">
          <Caption style={{ color: theme.onInkMuted }}>Route selected</Caption>
          <View style={styles.routeRow}>
            <View style={styles.routeIcon}>
              <Ionicons name="bus" size={19} color={theme.onInk} />
            </View>
            <Text style={[TYPE.cardTitle, { color: theme.onInk, flex: 1 }]} numberOfLines={2}>
              {t.routeSelected || 'Not specified'}
            </Text>
          </View>
          <View style={styles.heroFoot}>
            <InkTag icon={paid ? 'checkmark-circle' : 'alert-circle'} label={t.paymentStatus || 'Payment status unknown'} tone={paid ? 'live' : 'plain'} />
          </View>
        </InkPanel>

        <SectionTitle>Registration details</SectionTitle>
        <RowGroup>
          {rows.map(([label, value], i) => (
            <SettingsRow
              key={label}
              title={label}
              value={value}
              last={i === rows.length - 1}
            />
          ))}
        </RowGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: SP.sm },
  routeIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  heroFoot: { flexDirection: 'row', marginTop: SP.lg },
});
