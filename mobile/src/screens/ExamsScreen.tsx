/**
 * ExamsScreen.tsx — the exam schedule as an urgency timeline.
 *
 * The single nearest upcoming paper is rendered large on the ink hero with its
 * countdown and full detail. Everything after it is a compact timeline grouped
 * by urgency (today / tomorrow / N days / upcoming), and papers already sat are
 * dimmed at the bottom. No exam looks identical to the next; the data and the
 * IST-safe date maths are unchanged.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../state/AppContext';
import {
  Badge,
  Caption,
  Card,
  EmptyState,
  InkPanel,
  InkTag,
  Meta,
  Row,
  SectionTitle,
  toneColors,
  type Tone,
} from '../components/ui';
import { examStartMs, countdownLabel, isSameIstDay, istDateLabel } from '../utils/examUtils';
import { PAGE, RADIUS, SP, TYPE, mono, FONT } from '../theme';
import type { ExamRecord } from '../types';

function dayNum(iso: string): string {
  return iso.slice(8);
}
function monthShort(iso: string): string {
  const d = new Date(`${iso.slice(0, 4)}-${iso.slice(5, 7)}-01`);
  return d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
}
function weekdayShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

type Urgency = { label: string; tone: Tone };

function urgencyOf(exam: ExamRecord, starts: number | null, now: number, tomorrowIso: string): Urgency {
  if (isSameIstDay(exam.date)) return { label: 'Today', tone: 'danger' };
  if (exam.date === tomorrowIso) return { label: 'Tomorrow', tone: 'warning' };
  if (starts !== null && starts < now) return { label: 'Done', tone: 'muted' };
  if (starts !== null) {
    const days = Math.ceil((starts - now) / 86400000);
    if (days <= 7) return { label: `${days} days`, tone: 'gold' };
  }
  return { label: 'Upcoming', tone: 'muted' };
}

export function ExamsScreen() {
  const { theme, data } = useApp();
  const exams = data?.exams ?? [];
  const now = Date.now();
  const tomorrowIso = istDateLabel(new Date(now + 86400000));

  const sorted = useMemo(
    () => [...exams].sort((a, b) => (examStartMs(a.date, a.time) ?? 0) - (examStartMs(b.date, b.time) ?? 0)),
    [exams],
  );

  if (!exams.length) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        <EmptyState icon="document-text-outline" title="No exams scheduled" hint="Your exam timetable appears here once VTOP publishes it." />
      </SafeAreaView>
    );
  }

  const next = sorted.find((e) => (examStartMs(e.date, e.time) ?? Number.MAX_SAFE_INTEGER) >= now) ?? null;
  const rest = sorted.filter((e) => e !== next);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {next ? (
          <InkPanel glow="gold">
            <Row style={styles.heroTop}>
              <InkTag icon="alarm-outline" label={countdownLabel(examStartMs(next.date, next.time) ?? now, now)} />
              <Text style={[TYPE.caption, { color: theme.onInkMuted, textTransform: 'uppercase' }]}>{next.examType}</Text>
            </Row>
            <Text style={[styles.heroTitle, { color: theme.onInk }]} numberOfLines={2}>{next.courseTitle || next.courseCode}</Text>
            <Text style={[TYPE.meta, { color: theme.onInkMuted, marginTop: 4 }]}>{next.courseCode}</Text>
            <View style={[styles.heroDateRow, { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.12)' }]}>
              <View style={styles.heroDateBlock}>
                <Text style={[styles.heroDateNum, { color: theme.onInk }]}>{dayNum(next.date)}</Text>
                <Text style={[TYPE.caption, { color: theme.onInkMuted }]}>{monthShort(next.date)}</Text>
              </View>
              <View style={[styles.heroDateDiv, { backgroundColor: 'rgba(255,255,255,0.14)' }]} />
              <View style={styles.flex}>
                <HeroLine icon="calendar-outline" text={weekdayShort(next.date)} />
                <HeroLine icon="time-outline" text={next.time || 'Time TBA'} />
                {next.venue ? <HeroLine icon="location-outline" text={next.venue} /> : null}
                {next.seatNo ? <HeroLine icon="person-outline" text={`Seat ${next.seatNo}`} /> : null}
              </View>
            </View>
          </InkPanel>
        ) : (
          <Card>
            <Caption>All exams completed</Caption>
            <Meta style={{ marginTop: 6 }}>You have no upcoming papers in this semester.</Meta>
          </Card>
        )}

        {rest.length ? (
          <>
            <SectionTitle>Full schedule</SectionTitle>
            {rest.map((exam, i) => {
              const starts = examStartMs(exam.date, exam.time);
              const urgency = urgencyOf(exam, starts, now, tomorrowIso);
              const done = urgency.label === 'Done';
              const c = toneColors(theme, urgency.tone);
              return (
                <View key={exam.id} style={[styles.row, done && styles.rowDone]}>
                  <View style={styles.dateCol}>
                    <View style={[styles.dateBlock, { backgroundColor: c.bg }]}>
                      <Text style={[styles.dateNum, { color: c.fg }]}>{dayNum(exam.date)}</Text>
                      <Text style={[styles.dateMonth, { color: c.fg }]}>{monthShort(exam.date)}</Text>
                    </View>
                  </View>
                  {i < rest.length - 1 ? <View style={[styles.connector, { backgroundColor: theme.border }]} /> : null}
                  <View style={[styles.examCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                    <Row style={styles.examHead}>
                      <Text style={[TYPE.bodyStrong, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{exam.courseTitle || exam.courseCode}</Text>
                      <Badge tone={urgency.tone}>{urgency.label}</Badge>
                    </Row>
                    <Meta numberOfLines={1}>{exam.courseCode ? `${exam.courseCode} · ` : ''}{exam.examType}</Meta>
                    <Row style={styles.examMetaRow}>
                      <Ionicons name="time-outline" size={13} color={theme.textMuted} />
                      <Text style={[TYPE.caption, { color: theme.textMuted }]}>{exam.time || 'TBA'}</Text>
                      {exam.venue ? (
                        <>
                          <Ionicons name="location-outline" size={13} color={theme.textMuted} style={{ marginLeft: 8 }} />
                          <Text style={[TYPE.caption, { color: theme.textMuted }]} numberOfLines={1}>{exam.venue}</Text>
                        </>
                      ) : null}
                    </Row>
                  </View>
                </View>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function HeroLine({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { theme } = useApp();
  return (
    <Row style={styles.heroLine}>
      <Ionicons name={icon} size={14} color={theme.onInkMuted} />
      <Text style={[TYPE.meta, { color: theme.onInkMuted }]} numberOfLines={1}>{text}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },

  heroTop: { justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.lg },
  heroTitle: { fontFamily: FONT.extrabold, fontSize: 24, letterSpacing: -0.5, lineHeight: 29 },
  heroDateRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md, marginTop: SP.xl },
  heroDateBlock: { width: 52, alignItems: 'center' },
  heroDateNum: { ...mono('bold'), fontSize: 30, letterSpacing: -1 },
  heroDateDiv: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  heroLine: { gap: 7, marginTop: 5 },

  row: { flexDirection: 'row', gap: SP.md, marginBottom: SP.sm },
  rowDone: { opacity: 0.55 },
  dateCol: { width: 48, alignItems: 'center' },
  dateBlock: { width: 48, height: 54, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  dateNum: { ...mono('bold'), fontSize: 20, letterSpacing: -0.5 },
  dateMonth: { ...mono('bold'), fontSize: 10, letterSpacing: 0.5, marginTop: 1 },
  connector: { position: 'absolute', left: 23, top: 54, bottom: -SP.sm, width: 2 },
  examCard: { flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md + 2 },
  examHead: { justifyContent: 'space-between', gap: SP.sm, alignItems: 'center', marginBottom: 3 },
  examMetaRow: { gap: 5, alignItems: 'center', marginTop: 7 },
});
