/**
 * HomeScreen.tsx — the composed dashboard.
 *
 * Structure (deliberately NOT "greeting → row of metric cards → class cards"):
 *   1. identity header: time-of-day, name, avatar, sync action
 *   2. TODAY hero on the signature ink surface: the current/next class with a
 *      state that actually *feels* different (LIVE NOW / STARTING SOON / NEXT /
 *      DAY COMPLETE), a progress indicator while live, and compact metadata
 *   3. a compact horizontal timeline of the rest of today
 *   4. a highly visual academic summary (attendance / CGPA / credits)
 *   5. UP NEXT — the next exam and any genuine attention items from real data
 *
 * Everything is derived from the synced snapshot; nothing here re-fetches or
 * re-computes academic numbers.
 */

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../state/AppContext';
import { Avatar } from '../components/Avatar';
import {
  Badge,
  Body,
  Caption,
  Card,
  CardTitle,
  IconButton,
  IconBox,
  InkPanel,
  InkTag,
  Meta,
  Pill,
  ProgressBar,
  Row,
  SectionTitle,
  StatBlock,
  Tap,
  toneColors,
} from '../components/ui';
import { componentTotals, groupCourseAttendance } from '../utils/attendanceComponents';
import { nextUpcomingExam } from '../utils/examUtils';
import { slotTimeToMinutes, isLabSession } from '../utils/labSessions';
import { PAGE, RADIUS, SP, TYPE, mono, FONT } from '../theme';
import type { TimetableSlot, Weekday } from '../types';

const WEEKDAYS: Weekday[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type HeroState = 'live' | 'soon' | 'next' | 'done' | 'free';

function greetingFor(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function firstName(name?: string | null): string {
  return (name || 'Student').trim().split(/\s+/)[0] || 'Student';
}

const STATE_LABEL: Record<HeroState, string> = {
  live: 'Live now',
  soon: 'Starting soon',
  next: 'Next up',
  done: 'Day complete',
  free: 'No classes today',
};

export function HomeScreen() {
  const { theme, data, syncing, sync, lastSync } = useApp();
  const navigation = useNavigation<any>();
  const openAttendance = () => navigation.navigate('Academics', { screen: 'Attendance' });
  const openTimetable = () => navigation.navigate('Academics', { screen: 'Timetable' });
  const openExams = () => navigation.navigate('Academics', { screen: 'Exams' });
  const openMarks = () => navigation.navigate('Academics', { screen: 'Marks' });

  const totals = useMemo(() => (data?.attendance?.length ? componentTotals(data.attendance) : null), [data]);
  const nextExam = useMemo(() => (data?.exams?.length ? nextUpcomingExam(data.exams) : null), [data]);
  const lowAttendance = useMemo(
    () => (data?.attendance?.length ? groupCourseAttendance(data.attendance).filter((g) => g.percentage !== null && g.percentage < 75) : []),
    [data],
  );
  const pendingAssignments = useMemo(() => (data?.assignments ?? []).filter((a) => a.status === 'Pending'), [data]);

  const schedule = useMemo(() => {
    const slots = data?.timetable ?? [];
    const now = new Date();
    const today = WEEKDAYS[now.getDay()];
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todaySlots = slots
      .filter((s) => s.day === today)
      .sort((a, b) => (slotTimeToMinutes(a.startTime) ?? 0) - (slotTimeToMinutes(b.startTime) ?? 0));
    const live = todaySlots.find((s) => (slotTimeToMinutes(s.startTime) ?? 0) <= nowMin && (slotTimeToMinutes(s.endTime) ?? 0) > nowMin);
    const upcoming = todaySlots.filter((s) => (slotTimeToMinutes(s.startTime) ?? 0) > nowMin);
    return { today, todaySlots, live, upcoming, nowMin };
  }, [data]);

  const heroSlot: TimetableSlot | null = schedule.live ?? schedule.upcoming[0] ?? null;
  let heroState: HeroState = 'free';
  if (schedule.live) {
    heroState = 'live';
  } else if (heroSlot) {
    const startsIn = (slotTimeToMinutes(heroSlot.startTime) ?? 0) - schedule.nowMin;
    heroState = startsIn <= 30 ? 'soon' : 'next';
  } else if (schedule.todaySlots.length) {
    heroState = 'done';
  }

  const heroProgress = useMemo(() => {
    if (heroState !== 'live' || !heroSlot) return 0;
    const start = slotTimeToMinutes(heroSlot.startTime) ?? 0;
    const end = slotTimeToMinutes(heroSlot.endTime) ?? 0;
    if (end <= start) return 0;
    return Math.max(0, Math.min(100, ((schedule.nowMin - start) / (end - start)) * 100));
  }, [heroState, heroSlot, schedule.nowMin]);

  const startsInLabel = heroSlot
    ? (() => {
        const mins = (slotTimeToMinutes(heroSlot.startTime) ?? 0) - schedule.nowMin;
        if (mins <= 0) return 'now';
        if (mins < 60) return `in ${mins} min`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `in ${h}h${m ? ` ${m}m` : ''}`;
      })()
    : '';

  const profileCgpa = data?.profile?.cgpa;
  const cgpa = data?.grades?.cgpa ?? (profileCgpa !== undefined && profileCgpa > 0 ? profileCgpa : null);
  const creditsEarned = data?.grades?.creditsEarned ?? null;
  const creditsRegistered = data?.grades?.creditsRegistered ?? null;
  const attPct = totals?.percentage ?? null;

  const syncLabel = syncing
    ? 'Syncing…'
    : lastSync?.syncedAt
      ? `Synced ${new Date(lastSync.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : 'Tap to sync';

  const accent = toneColors(theme, 'accent');

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* 1 — identity header */}
        <View style={styles.header}>
          <Tap onPress={() => navigation.navigate('More')}>
            <Avatar name={data?.profile?.name} dataUrl={data?.profile?.profilePhotoDataUrl} size={44} />
          </Tap>
          <View style={styles.flex}>
            <Text style={[TYPE.caption, { color: theme.textMuted, textTransform: 'uppercase' }]}>{greetingFor(new Date())}</Text>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{firstName(data?.profile?.name)}</Text>
          </View>
          <IconButton name={syncing ? 'sync' : 'refresh'} onPress={() => sync()} disabled={syncing} tone="accent" size={40} />
        </View>
        <Row style={styles.syncRow}>
          <Ionicons name={syncing ? 'cloud-upload-outline' : 'cloud-done-outline'} size={12} color={theme.textMuted} />
          <Text style={[TYPE.caption, { color: theme.textMuted }]}>{syncLabel}</Text>
        </Row>

        {/* 2 — TODAY hero */}
        <SectionTitle>Today · {schedule.today}</SectionTitle>
        <InkPanel onPress={openTimetable} glow={heroState === 'live' ? 'success' : heroState === 'free' || heroState === 'done' ? 'none' : 'accent'}>
          {heroSlot ? (
            <>
              <Row style={styles.heroTop}>
                <InkTag tone={heroState === 'live' ? 'live' : 'plain'} icon={heroState === 'soon' ? 'flash' : 'time-outline'} label={STATE_LABEL[heroState]} />
                <Text style={[TYPE.caption, mono('regular'), { color: theme.onInkMuted }]}>
                  {heroState === 'live' ? `ends ${heroSlot.endTime}` : `starts ${startsInLabel}`}
                </Text>
              </Row>
              <Text style={[styles.heroTitle, { color: theme.onInk }]} numberOfLines={2}>{heroSlot.courseTitle}</Text>
              <Row style={styles.heroSub}>
                <Text style={[TYPE.meta, mono('medium'), { color: theme.onInkMuted }]}>{heroSlot.courseCode}</Text>
                <View style={[styles.heroDot, { backgroundColor: theme.onInkMuted }]} />
                <Text style={[TYPE.meta, mono('medium'), { color: theme.onInkMuted }]}>{heroSlot.slot}</Text>
                <View style={[styles.heroDot, { backgroundColor: theme.onInkMuted }]} />
                <Text style={[TYPE.meta, { color: theme.onInkMuted }]}>{isLabSession(heroSlot) ? 'Lab' : 'Theory'}</Text>
              </Row>

              {heroState === 'live' ? (
                <View style={styles.heroProgress}>
                  <ProgressBar percent={heroProgress} tone="success" height={5} track="rgba(255,255,255,0.15)" />
                </View>
              ) : null}

              <View style={styles.heroMetaRow}>
                <HeroMeta icon="time-outline" text={`${heroSlot.startTime} – ${heroSlot.endTime}`} />
                <HeroMeta icon="location-outline" text={heroSlot.venue || heroSlot.building || 'Venue TBA'} />
              </View>
            </>
          ) : (
            <>
              <Row style={styles.heroTop}>
                <InkTag label={STATE_LABEL[heroState]} />
              </Row>
              <Text style={[styles.heroTitle, { color: theme.onInk }]}>
                {heroState === 'done' ? 'All classes finished' : 'A free day'}
              </Text>
              <Text style={[TYPE.meta, { color: theme.onInkMuted, marginTop: 6 }]}>
                {heroState === 'done' ? 'Everything on today’s timetable is done. Tap to review your week.' : 'Nothing on the timetable today. Tap to open your week.'}
              </Text>
            </>
          )}
        </InkPanel>

        {/* 3 — compact horizontal timeline of today */}
        {schedule.todaySlots.length > 0 ? (
          <>
            <SectionTitle>Day timeline</SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeline}>
              {schedule.todaySlots.map((slot) => {
                const isLive = schedule.live?.id === slot.id;
                const isPast = (slotTimeToMinutes(slot.endTime) ?? 0) <= schedule.nowMin && !isLive;
                const isNext = !isLive && !isPast && heroSlot?.id === slot.id;
                const c = isLive ? toneColors(theme, 'success') : isNext ? accent : null;
                return (
                  <Tap key={slot.id} onPress={openTimetable}>
                    <View
                      style={[
                        styles.tlChip,
                        {
                          backgroundColor: isLive || isNext ? (c!.fg) : theme.surface,
                          borderColor: isLive || isNext ? (c!.fg) : theme.border,
                          opacity: isPast ? 0.55 : 1,
                        },
                      ]}
                    >
                      <Text style={[TYPE.caption, mono('regular'), { color: isLive || isNext ? theme.onAccent : theme.textMuted }]}>{slot.startTime}</Text>
                      <Text style={[styles.tlCode, mono('bold'), { color: isLive || isNext ? theme.onAccent : theme.text }]} numberOfLines={1}>
                        {slot.courseCode}
                      </Text>
                      {isLabSession(slot) ? (
                        <Ionicons name="flask-outline" size={12} color={isLive || isNext ? theme.onAccent : theme.textMuted} />
                      ) : null}
                    </View>
                  </Tap>
                );
              })}
            </ScrollView>
          </>
        ) : null}

        {/* 4 — academic summary */}
        <SectionTitle>Your standing</SectionTitle>
        <Card>
          <View style={styles.summaryRow}>
            <Tap onPress={openAttendance} style={styles.summaryTap}>
              <StatBlock
                value={attPct !== null ? `${attPct.toFixed(0)}%` : '—'}
                label="Attendance"
                sub={totals ? `${totals.attended}/${totals.conducted}` : 'no data'}
                tone={attPct === null ? 'muted' : attPct >= 75 ? 'success' : attPct >= 65 ? 'warning' : 'danger'}
              />
            </Tap>
            <View style={[styles.summaryDivider, { backgroundColor: theme.border }]} />
            <Tap onPress={openMarks} style={styles.summaryTap}>
              <StatBlock value={cgpa !== null ? cgpa.toFixed(2) : '—'} label="CGPA" sub="cumulative" tone="accent" />
            </Tap>
            <View style={[styles.summaryDivider, { backgroundColor: theme.border }]} />
            <StatBlock
              value={creditsEarned !== null ? String(creditsEarned) : '—'}
              label="Credits"
              sub={creditsRegistered !== null ? `of ${creditsRegistered}` : 'earned'}
              tone="secondary"
            />
          </View>
          {attPct !== null ? (
            <View style={{ marginTop: SP.lg }}>
              <ProgressBar percent={attPct} tone={attPct >= 75 ? 'success' : attPct >= 65 ? 'warning' : 'danger'} height={7} />
            </View>
          ) : null}
        </Card>

        {/* 5 — up next */}
        {nextExam || pendingAssignments.length > 0 || lowAttendance.length > 0 ? (
          <>
            <SectionTitle>Up next</SectionTitle>
            {nextExam ? (
              <Tap onPress={openExams}>
                <View style={[styles.upNext, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <View style={[styles.upNextAccent, { backgroundColor: toneColors(theme, 'gold').fg }]} />
                  <IconBox name="calendar-outline" tone="gold" size={40} iconSize={20} />
                  <View style={styles.flex}>
                    <Caption>Next exam · {nextExam.countdown}</Caption>
                    <Text style={[styles.upNextTitle, { color: theme.text }]} numberOfLines={1}>
                      {nextExam.exam.courseTitle || nextExam.exam.courseCode}
                    </Text>
                    <Meta style={mono('regular')}>
                      {nextExam.exam.examType} · {nextExam.exam.date}
                      {nextExam.exam.time ? ` · ${nextExam.exam.time}` : ''}
                    </Meta>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                </View>
              </Tap>
            ) : null}

            {lowAttendance.slice(0, 1).map((g) => (
              <Tap key={g.key} onPress={openAttendance}>
                <View style={[styles.upNext, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <View style={[styles.upNextAccent, { backgroundColor: theme.danger }]} />
                  <IconBox name="alert-circle-outline" tone="danger" size={40} iconSize={20} />
                  <View style={styles.flex}>
                    <Caption>Attendance risk</Caption>
                    <Text style={[styles.upNextTitle, { color: theme.text }]} numberOfLines={1}>
                      {g.courseTitle || g.courseCode}
                    </Text>
                    <Meta style={mono('regular')}>{g.percentage?.toFixed(1)}% — below the 75% requirement</Meta>
                  </View>
                  <Badge tone="danger" numeric>{g.percentage?.toFixed(0)}%</Badge>
                </View>
              </Tap>
            ))}

            {pendingAssignments.length > 0 ? (
              <Tap onPress={openMarks}>
                <View style={[styles.upNext, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <View style={[styles.upNextAccent, { backgroundColor: theme.accent }]} />
                  <IconBox name="document-text-outline" tone="accent" size={40} iconSize={20} />
                  <View style={styles.flex}>
                    <Caption>Assignments</Caption>
                    <Text style={[styles.upNextTitle, { color: theme.text }]}>
                      {pendingAssignments.length} pending
                    </Text>
                    <Meta>{pendingAssignments[0].courseCode} · {pendingAssignments[0].title}</Meta>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                </View>
              </Tap>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function HeroMeta({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { theme } = useApp();
  return (
    <View style={styles.heroMeta}>
      <Ionicons name={icon} size={14} color={theme.onInkMuted} />
      <Text style={[TYPE.meta, mono('regular'), { color: theme.onInkMuted }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },

  header: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: SP.sm },
  name: { fontFamily: FONT.extrabold, fontSize: 23, letterSpacing: -0.5, marginTop: 2 },
  syncRow: { gap: 5, marginTop: 8, marginLeft: 2 },

  heroTop: { justifyContent: 'space-between', marginBottom: SP.lg },
  heroTitle: { fontFamily: FONT.extrabold, fontSize: 23, letterSpacing: -0.5, lineHeight: 29 },
  heroSub: { gap: 7, marginTop: 7 },
  heroDot: { width: 3, height: 3, borderRadius: 1.5 },
  heroProgress: { marginTop: SP.lg },
  heroMetaRow: { flexDirection: 'row', gap: SP.xl, marginTop: SP.lg },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },

  timeline: { gap: SP.sm, paddingRight: SP.sm },
  tlChip: { minWidth: 76, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: SP.md, paddingVertical: 10, alignItems: 'center', gap: 4 },
  tlCode: { fontSize: 13, letterSpacing: -0.2 },

  summaryRow: { flexDirection: 'row', alignItems: 'stretch' },
  summaryTap: { flex: 1 },
  summaryDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: SP.md },

  upNext: { flexDirection: 'row', alignItems: 'center', gap: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md, marginBottom: SP.sm, overflow: 'hidden' },
  upNextAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  upNextTitle: { fontFamily: FONT.bold, fontSize: 15, marginTop: 2, marginBottom: 1 },
});
