/**
 * OdScreen.tsx — the OD (on-duty) calculator. An ink hero shows hours used
 * against VIT's semester cap with a progress rail; the per-course breakdown is
 * a compact list. Every figure comes straight from VTOP.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import {
  Caption,
  Card,
  EmptyState,
  InkPanel,
  InkTag,
  ProgressBar,
  Row,
  ScreenHeader,
  SectionTitle,
} from '../components/ui';
import { PAGE, RADIUS, SP, TYPE } from '../theme';

export function OdScreen() {
  const { theme, data } = useApp();
  const od = data?.od;

  if (!od || !od.available) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="timer-outline"
          title="No OD data"
          hint="VTOP has no on-duty record for you, or it has not been synced."
        />
      </SafeAreaView>
    );
  }

  const remaining = Math.max(0, od.limitHours - od.totalOdHours);
  const usedPercent = od.limitHours > 0 ? (od.totalOdHours / od.limitHours) * 100 : 0;
  const tone = remaining <= 0 ? 'danger' : remaining <= 8 ? 'warning' : 'success';

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <ScreenHeader title="On-duty" subtitle="OD hours this semester" />

        <InkPanel glow={tone === 'success' ? 'accent' : tone}>
          <Row style={styles.heroTop}>
            <Caption style={{ color: theme.onInkMuted }}>Hours used</Caption>
            <InkTag
              icon={remaining <= 0 ? 'close-circle' : 'time'}
              label={remaining <= 0 ? 'Cap reached' : `${remaining} hrs left`}
              tone={remaining <= 0 ? 'live' : 'plain'}
            />
          </Row>
          <View style={styles.bigRow}>
            <Text style={[TYPE.statLg, { color: theme.onInk }]}>{od.totalOdHours}</Text>
            <Text style={[TYPE.cardTitle, { color: theme.onInkMuted, marginTop: 5 }]}> / {od.limitHours} hrs</Text>
          </View>
          <View style={{ marginTop: SP.md }}>
            <ProgressBar percent={usedPercent} tone={tone} height={9} track="rgba(255,255,255,0.16)" />
          </View>
        </InkPanel>

        {od.perCourse.length > 0 ? (
          <>
            <SectionTitle>Per course</SectionTitle>
            <Card pad={0}>
              {od.perCourse.map((entry, i) => (
                <View
                  key={`${entry.courseCode}-${entry.slot}-${i}`}
                  style={[styles.row, { borderBottomColor: theme.border }, i === od.perCourse.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <View style={[styles.hoursChip, { backgroundColor: theme.accentSoft }]}>
                    <Text style={[TYPE.stat, { color: theme.accent, fontSize: 17 }]}>{entry.odHours}h</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={[TYPE.cardTitle, { color: theme.text, fontSize: 15 }]} numberOfLines={1}>
                      {entry.courseName || entry.courseCode}
                    </Text>
                    <Text style={[TYPE.meta, { color: theme.textMuted, marginTop: 2 }]}>
                      {entry.courseCode} · {entry.slot} · {entry.present} present · {entry.absent} absent
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },
  heroTop: { justifyContent: 'space-between', alignItems: 'center' },
  bigRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.md, paddingHorizontal: SP.lg, borderBottomWidth: StyleSheet.hairlineWidth, gap: SP.md },
  hoursChip: { width: 46, height: 46, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
});
