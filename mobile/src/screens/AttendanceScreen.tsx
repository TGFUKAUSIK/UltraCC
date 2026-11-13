/**
 * AttendanceScreen.tsx — an academic attendance dashboard.
 *
 * Top: an ink hero with the overall percentage, the attended/held count and a
 * SAFE / WARNING / CRITICAL read, followed by a threshold gauge against VIT's
 * 75% rule and the theory / lab / project split. Then a COMPACT course list
 * (code, title, %, count, risk, a small progress bar) — not a card per session.
 * Tapping a course drills into a detail view with the risk visualisation and the
 * real per-component breakdown. Every number comes straight from VTOP's rows;
 * theory and lab are never blended and nothing is invented.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../state/AppContext';
import {
  Badge,
  Caption,
  Card,
  EmptyState,
  IconButton,
  InkPanel,
  Meta,
  ProgressBar,
  Row,
  SectionTitle,
  ThresholdGauge,
  type Tone,
} from '../components/ui';
import { componentTotals, groupCourseAttendance, componentLabel, type CourseAttendanceGroup } from '../utils/attendanceComponents';
import { PAGE, RADIUS, SP, TYPE, type Theme, mono, FONT } from '../theme';

function riskOf(p: number | null): { label: string; tone: Tone } {
  if (p === null) return { label: 'No data', tone: 'muted' };
  if (p >= 80) return { label: 'Safe', tone: 'success' };
  if (p >= 75) return { label: 'Warning', tone: 'warning' };
  return { label: 'Critical', tone: 'danger' };
}

export function AttendanceScreen() {
  const { theme, data } = useApp();
  const records = data?.attendance ?? [];
  const [selected, setSelected] = useState<CourseAttendanceGroup | null>(null);

  const groups = useMemo(() => groupCourseAttendance(records), [records]);
  const totals = useMemo(() => (records.length ? componentTotals(records) : null), [records]);

  if (!records.length) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        <EmptyState icon="checkmark-done-outline" title="No attendance yet" hint="Sync from the home screen to load your attendance." />
      </SafeAreaView>
    );
  }

  if (selected) {
    return <CourseDetail group={selected} onBack={() => setSelected(null)} />;
  }

  const overallRisk = riskOf(totals?.percentage ?? null);
  const overallPct = totals?.percentage ?? null;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Overall ink hero */}
        <InkPanel glow={overallRisk.tone === 'danger' ? 'danger' : overallRisk.tone === 'warning' ? 'warning' : 'success'}>
          <Row style={styles.heroTop}>
            <Caption style={{ color: theme.onInkMuted }}>Overall attendance</Caption>
            <View style={[styles.riskTag, { backgroundColor: riskInk(overallRisk.tone) }]}>
              <Text style={[TYPE.caption, { color: '#fff', textTransform: 'uppercase' }]}>{overallRisk.label}</Text>
            </View>
          </Row>
          <Row style={styles.heroNumRow}>
            <Text style={[styles.heroNum, { color: theme.onInk }]}>
              {overallPct !== null ? overallPct.toFixed(1) : '—'}
              <Text style={[styles.heroNumUnit, { color: theme.onInkMuted }]}>%</Text>
            </Text>
            <Text style={[TYPE.meta, { color: theme.onInkMuted, marginBottom: 6 }]}>
              {totals ? `${totals.attended} / ${totals.conducted} classes` : ''}
            </Text>
          </Row>
          <View style={{ marginTop: SP.sm }}>
            <ProgressBar percent={overallPct ?? 0} height={6} track="rgba(255,255,255,0.16)" tone={overallRisk.tone === 'muted' ? undefined : overallRisk.tone} />
          </View>
        </InkPanel>

        {/* Threshold + component split */}
        <Card style={styles.gaugeCard}>
          <Caption>Against the 75% requirement</Caption>
          <View style={{ marginTop: SP.md }}>
            <ThresholdGauge percent={overallPct ?? 0} threshold={75} tone={overallRisk.tone === 'muted' ? undefined : overallRisk.tone} />
          </View>
          {totals && totals.present.length > 1 ? (
            <View style={styles.splitRow}>
              {totals.present.map((c) => (
                <View key={c.kind} style={[styles.splitChip, { backgroundColor: theme.surfaceMuted }]}>
                  <Text style={[TYPE.caption, { color: theme.textMuted, textTransform: 'uppercase' }]}>{componentLabel(c.kind)}</Text>
                  <Text style={[styles.splitValue, { color: theme.text }]}>{c.percentage !== null ? `${c.percentage.toFixed(0)}%` : '—'}</Text>
                  <Text style={[TYPE.caption, { color: theme.textMuted }]}>{c.attended}/{c.conducted}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        {/* Compact course list */}
        <SectionTitle>Courses · {groups.length}</SectionTitle>
        <Card pad={0}>
          {groups.map((g, i) => {
            const risk = riskOf(g.percentage);
            return (
              <Pressable
                key={g.key}
                onPress={() => setSelected(g)}
                android_ripple={{ color: theme.surfaceMuted }}
                style={[styles.courseRow, i < groups.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}
              >
                <View style={styles.coursePctCol}>
                  <Text style={[styles.coursePct, { color: toneFg(theme, risk.tone) }]}>{g.percentage !== null ? g.percentage.toFixed(0) : '—'}</Text>
                  <Text style={[TYPE.caption, { color: theme.textMuted }]}>%</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.courseTitle, { color: theme.text }]} numberOfLines={1}>{g.courseTitle || g.courseCode}</Text>
                  <Text style={[TYPE.caption, { color: theme.textMuted, letterSpacing: 0.4 }]}>{g.courseCode} · {g.attended}/{g.conducted}</Text>
                  <View style={{ marginTop: 7 }}>
                    <ProgressBar percent={g.percentage ?? 0} tone={risk.tone === 'muted' ? undefined : risk.tone} height={5} />
                  </View>
                </View>
                <Badge tone={risk.tone}>{risk.label}</Badge>
              </Pressable>
            );
          })}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------ course detail ----------------------------- */

function CourseDetail({ group, onBack }: { group: CourseAttendanceGroup; onBack: () => void }) {
  const { theme } = useApp();
  const risk = riskOf(group.percentage);
  const pct = group.percentage;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.detailHeader}>
        <IconButton name="arrow-back" onPress={onBack} size={38} />
        <Text style={[TYPE.screenTitle, { color: theme.text, fontSize: 20, flex: 1 }]} numberOfLines={1}>Attendance</Text>
      </View>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <InkPanel glow={risk.tone === 'danger' ? 'danger' : risk.tone === 'warning' ? 'warning' : 'success'}>
          <Text style={[TYPE.caption, { color: theme.onInkMuted, letterSpacing: 1.2 }]}>{group.courseCode}</Text>
          <Text style={[styles.detailTitle, { color: theme.onInk }]} numberOfLines={2}>{group.courseTitle || group.courseCode}</Text>
          <Row style={styles.heroNumRow}>
            <Text style={[styles.heroNum, { color: theme.onInk }]}>{pct !== null ? pct.toFixed(1) : '—'}<Text style={[styles.heroNumUnit, { color: theme.onInkMuted }]}>%</Text></Text>
            <View style={[styles.riskTag, { backgroundColor: riskInk(risk.tone) }]}>
              <Text style={[TYPE.caption, { color: '#fff', textTransform: 'uppercase' }]}>{risk.label}</Text>
            </View>
          </Row>
          <Text style={[TYPE.meta, { color: theme.onInkMuted }]}>{group.attended} of {group.conducted} classes attended</Text>
        </InkPanel>

        <Card style={styles.gaugeCard}>
          <Caption>Position vs the 75% rule</Caption>
          <View style={{ marginTop: SP.md }}>
            <ThresholdGauge percent={pct ?? 0} threshold={75} tone={risk.tone === 'muted' ? undefined : risk.tone} />
          </View>
        </Card>

        <SectionTitle>Components</SectionTitle>
        {group.components.map((c) => {
          const cr = riskOf(c.percentage);
          return (
            <Card key={c.kind} style={styles.compCard}>
              <Row style={styles.compHead}>
                <Text style={[TYPE.cardTitle, { color: theme.text }]}>{componentLabel(c.kind)}</Text>
                <Badge tone={cr.tone}>{c.percentage !== null ? `${c.percentage.toFixed(1)}%` : '—'}</Badge>
              </Row>
              <View style={{ marginTop: SP.md }}>
                <ProgressBar percent={c.percentage ?? 0} tone={cr.tone === 'muted' ? undefined : cr.tone} height={7} />
              </View>
              <Row style={styles.compFoot}>
                <Meta>{c.attended} attended</Meta>
                <Meta>{c.conducted - c.attended} missed</Meta>
                <Meta>{c.conducted} held</Meta>
              </Row>
            </Card>
          );
        })}

        <SectionTitle>Classes</SectionTitle>
        <Card pad={0}>
          {group.rows.map((r, i) => (
            <View key={`${r.courseCode}-${r.slot}-${i}`} style={[styles.miniRow, i < group.rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
              <Ionicons name={r.slot?.toUpperCase().startsWith('L') ? 'flask-outline' : 'book-outline'} size={16} color={theme.textMuted} />
              <View style={styles.flex}>
                <Text style={[TYPE.body, { color: theme.text, fontFamily: FONT.semibold }]}>{r.courseCode}</Text>
                <Text style={[TYPE.caption, { color: theme.textMuted }]}>{r.slot || componentLabel('Unknown')} · {r.facultyName || 'Faculty TBA'}</Text>
              </View>
              <Text style={[TYPE.bodyStrong, { color: theme.text }]}>{r.attended}/{r.totalHeld}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function riskInk(tone: Tone): string {
  if (tone === 'danger') return '#d63a3d';
  if (tone === 'warning') return '#c2760b';
  if (tone === 'success') return '#0f8a5f';
  return '#5a6478';
}

function toneFg(theme: Theme, tone: Tone): string {
  if (tone === 'danger') return theme.danger;
  if (tone === 'warning') return theme.warning;
  if (tone === 'success') return theme.success;
  return theme.textMuted;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },

  heroTop: { justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.md },
  riskTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill },
  heroNumRow: { alignItems: 'flex-end', gap: SP.md, justifyContent: 'space-between', marginTop: SP.xs },
  heroNum: { ...mono('bold'), fontSize: 52, letterSpacing: -2, lineHeight: 56 },
  heroNumUnit: { ...mono('bold'), fontSize: 24, letterSpacing: 0 },

  gaugeCard: { marginTop: SP.md },
  splitRow: { flexDirection: 'row', gap: SP.sm, marginTop: SP.lg, flexWrap: 'wrap' },
  splitChip: { flex: 1, minWidth: 84, borderRadius: RADIUS.md, padding: SP.md },
  splitValue: { ...mono('bold'), fontSize: 20, letterSpacing: -0.5, marginVertical: 3 },

  courseRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.lg, paddingVertical: SP.md + 2 },
  coursePctCol: { width: 46, alignItems: 'center' },
  coursePct: { ...mono('bold'), fontSize: 22, letterSpacing: -0.6 },
  courseTitle: { fontFamily: FONT.bold, fontSize: 14.5, letterSpacing: -0.2 },

  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: PAGE, paddingTop: SP.sm, paddingBottom: SP.sm },
  detailTitle: { fontFamily: FONT.extrabold, fontSize: 21, letterSpacing: -0.4, marginTop: 4, marginBottom: SP.lg },

  compCard: { marginBottom: SP.sm },
  compHead: { justifyContent: 'space-between', alignItems: 'center' },
  compFoot: { justifyContent: 'space-between', marginTop: SP.md },

  miniRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.lg, paddingVertical: SP.md },
});
