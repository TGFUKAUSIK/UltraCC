/**
 * AttendancePredictorScreen.tsx — "can I skip this class?" answered two ways.
 *
 * 1. PER COURSE — the number VTOP actually reports. Every theory and lab row
 *    gets its own forecast (how many more classes can be missed, or how many
 *    must be attended to climb back to 75%), because VIT's requirement is
 *    applied per component: a healthy theory record does not rescue a failing
 *    lab. The maths lives in utils/attendanceForecast.ts and is pinned by
 *    src/lib/__tests__/mobileAttendanceForecast.test.ts.
 * 2. SKIP A DAY — a hypothetical week plan on the real timetable, using the
 *    already-ported projectAttendance(). Each class can be marked present,
 *    absent, or left neutral, and one tap marks the whole day absent. The
 *    projection shows where attendance lands and which courses drop below the
 *    bar.
 *
 * Nothing is written back to VTOP and nothing is invented: a course VTOP has no
 * attendance row for is labelled "not counted" instead of being guessed at.
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
  Chip,
  ChipRow,
  EmptyState,
  InkPanel,
  Meta,
  ProgressBar,
  Row,
  ScreenHeader,
  SectionTitle,
  SegmentedControl,
  StatBlock,
  ThresholdGauge,
  type Tone,
} from '../components/ui';
import {
  componentLabel,
  groupCourseAttendance,
} from '../utils/attendanceComponents';
import {
  ATTENDANCE_THRESHOLD,
  forecastAttendance,
  forecastCourse,
  forecastSentence,
} from '../utils/attendanceForecast';
import { projectAttendance, type AttendancePredictionAction } from '../utils/attendancePredictor';
import type { AttendanceRecord, TimetableSlot } from '../types';
import { PAGE, RADIUS, SP, TYPE, mono, FONT } from '../theme';

const DAYS: TimetableSlot['day'][] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The first weekday the timetable actually has classes on, else Monday. */
function firstTeachingDay(slots: TimetableSlot[]): TimetableSlot['day'] {
  return DAYS.find((d) => slots.some((s) => s.day === d)) ?? 'Monday';
}

type Mode = 'course' | 'day';

function riskOf(p: number | null): { label: string; tone: Tone } {
  if (p === null) return { label: 'No data', tone: 'muted' };
  if (p >= 80) return { label: 'Safe', tone: 'success' };
  if (p >= ATTENDANCE_THRESHOLD) return { label: 'At risk', tone: 'warning' };
  return { label: 'Below 75%', tone: 'danger' };
}

export function AttendancePredictorScreen() {
  const { theme, data } = useApp();
  const records = data?.attendance ?? [];
  const timetable = data?.timetable ?? [];

  const [mode, setMode] = useState<Mode>('course');

  if (!records.length) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="trending-up-outline"
          title="No attendance yet"
          hint="Sync from the home screen — the predictor works on VTOP's real attended / held counts."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Attendance predictor"
          subtitle={`Against VIT's ${ATTENDANCE_THRESHOLD}% requirement`}
        />

        <SegmentedControl
          style={styles.segment}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'course', label: 'Per course' },
            { value: 'day', label: 'Skip a day' },
          ]}
        />

        {mode === 'course' ? <CourseForecast records={records} /> : <DayPlanner timetable={timetable} records={records} />}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------- per course ------------------------------- */

function CourseForecast({ records }: { records: AttendanceRecord[] }) {
  const { theme } = useApp();
  const groups = useMemo(() => groupCourseAttendance(records), [records]);

  const overall = useMemo(() => {
    const attended = records.reduce((s, r) => s + (Number(r.attended) || 0), 0);
    const held = records.reduce((s, r) => s + (Number(r.totalHeld) || 0), 0);
    return forecastAttendance(attended, held);
  }, [records]);

  const below = groups.filter((g) => g.percentage !== null && g.percentage < ATTENDANCE_THRESHOLD).length;

  return (
    <>
      <InkPanel glow={overall.meetsThreshold ? 'success' : 'danger'} style={styles.hero}>
        <Caption style={{ color: theme.onInkMuted }}>Overall attendance</Caption>
        <Row style={styles.heroRow}>
          <Text style={[styles.heroNum, { color: theme.onInk }]}>
            {overall.percentage !== null ? overall.percentage.toFixed(1) : '—'}
            <Text style={[styles.heroUnit, { color: theme.onInkMuted }]}>%</Text>
          </Text>
          <View style={[styles.heroTag, { backgroundColor: overall.meetsThreshold ? 'rgba(15,138,95,0.28)' : 'rgba(214,58,61,0.28)' }]}>
            <Text style={[TYPE.caption, { color: '#fff', textTransform: 'uppercase' }]}>
              {overall.meetsThreshold ? 'Eligible' : 'Below bar'}
            </Text>
          </View>
        </Row>
        <Text style={[TYPE.body, { color: theme.onInk, fontFamily: FONT.bold, marginTop: SP.md }]}>{forecastSentence(overall)}</Text>
        <Text style={[TYPE.meta, { color: theme.onInkMuted, marginTop: 4 }]}>
          {overall.attended} of {overall.totalHeld} classes attended · {below} {below === 1 ? 'course is' : 'courses are'} below the bar
        </Text>
      </InkPanel>

      <SectionTitle>Courses · {groups.length}</SectionTitle>
      <Card pad={0}>
        {groups.map((g, i) => {
          const course = forecastCourse(g.rows.map((r) => ({ attended: r.attended, totalHeld: r.totalHeld })));
          const risk = riskOf(g.percentage);
          return (
            <View
              key={g.key}
              style={[styles.courseBlock, i < groups.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}
            >
              <Row style={styles.courseHead}>
                <View style={styles.flex}>
                  <Text style={[styles.courseTitle, { color: theme.text }]} numberOfLines={1}>{g.courseTitle || g.courseCode}</Text>
                  <Text style={[TYPE.caption, { color: theme.textMuted, letterSpacing: 0.4 }]}>{g.courseCode} · {g.attended}/{g.conducted} · {g.percentage !== null ? `${g.percentage.toFixed(1)}%` : '—'}</Text>
                </View>
                <Badge tone={risk.tone}>{risk.label}</Badge>
              </Row>

              <View style={{ marginTop: SP.sm }}>
                <ProgressBar percent={g.percentage ?? 0} height={5} tone={risk.tone === 'muted' ? undefined : risk.tone} />
              </View>

              <Text style={[TYPE.body, { color: theme.textSecondary, marginTop: SP.sm }]}>{forecastSentence(course)}</Text>

              {g.components.map((c) => {
                const f = forecastAttendance(c.attended, c.conducted);
                return (
                  <View key={`${g.key}-${c.kind}`} style={styles.compRow}>
                    <Text style={[TYPE.caption, { color: theme.textMuted, flex: 1 }]}>{componentLabel(c.kind)}</Text>
                    <Text style={[TYPE.caption, { color: theme.text, fontFamily: FONT.bold }]}>
                      {c.percentage !== null ? `${c.percentage.toFixed(0)}%` : '—'}
                    </Text>
                    <Text style={[styles.compHint, { color: f.meetsThreshold ? theme.success : theme.danger }]}>
                      {c.conducted === 0
                        ? 'not counted'
                        : f.meetsThreshold
                          ? f.canSkip === 0 ? 'skip none' : `skip ${f.canSkip}`
                          : `+${f.neededToReach} to clear`}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })}
      </Card>

      <View style={[styles.footNote, { backgroundColor: theme.surfaceMuted }]}>
        <Caption>How these numbers are worked out</Caption>
        <Meta style={{ marginTop: 4, lineHeight: 19 }}>
          Skipping a class adds one to the classes held but not to the classes attended. Each line says what has to happen to the count, not what VTOP will accept — eligibility is decided by your faculty and the department.
        </Meta>
      </View>
    </>
  );
}

/* ------------------------------ skip a day -------------------------------- */

function DayPlanner({ timetable, records }: { timetable: TimetableSlot[]; records: AttendanceRecord[] }) {
  const { theme } = useApp();
  const [day, setDay] = useState<TimetableSlot['day']>(() => firstTeachingDay(timetable));
  const [actions, setActions] = useState<Record<string, AttendancePredictionAction>>({});

  const daySlots = useMemo(
    () => timetable.filter((s) => s.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [timetable, day],
  );
  const projection = useMemo(() => projectAttendance(daySlots, records, actions), [daySlots, records, actions]);

  const changed = Object.values(actions).some((a) => a !== 'ignore');
  const dropped = projection.courses.filter((c) => c.classCount > 0 && c.currentPercentage >= ATTENDANCE_THRESHOLD && c.projectedPercentage < ATTENDANCE_THRESHOLD);

  const setAction = (id: string, action: AttendancePredictionAction) =>
    setActions((current) => ({ ...current, [id]: current[id] === action ? 'ignore' : action }));

  const skipWholeDay = () => {
    const next: Record<string, AttendancePredictionAction> = {};
    for (const slot of daySlots) next[slot.id] = 'absent';
    setActions(next);
  };

  const overall = projection.overall;
  const after = overall?.projectedPercentage ?? null;
  const tone: Tone = after === null ? 'muted' : after >= 80 ? 'success' : after >= ATTENDANCE_THRESHOLD ? 'warning' : 'danger';

  if (!timetable.length) {
    return (
      <EmptyState
        icon="calendar-outline"
        title="No timetable yet"
        hint="The day planner projects against your real weekly classes. Sync from the home screen first."
      />
    );
  }

  return (
    <>
      <ChipRow style={styles.chips}>
        {DAYS.map((d) => (
          <Chip key={d} label={d.slice(0, 3)} selected={d === day} onPress={() => { setDay(d); setActions({}); }} />
        ))}
      </ChipRow>

      <InkPanel glow={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'success'} style={styles.hero}>
        <Caption style={{ color: theme.onInkMuted }}>{day} · {daySlots.length} {daySlots.length === 1 ? 'class' : 'classes'}</Caption>
        <Row style={styles.heroRow}>
          <Text style={[styles.heroNum, { color: theme.onInk }]}>
            {after !== null ? after.toFixed(1) : '—'}
            <Text style={[styles.heroUnit, { color: theme.onInkMuted }]}>%</Text>
          </Text>
          {overall ? (
            <Text style={[TYPE.meta, { color: theme.onInkMuted, marginBottom: 8 }]}>
              {overall.currentPercentage.toFixed(1)}% now
            </Text>
          ) : null}
        </Row>
        <Text style={[TYPE.body, { color: theme.onInk, fontFamily: FONT.bold, marginTop: SP.sm }]}>
          {overall
            ? `${overall.projectedAttended}/${overall.projectedTotal} classes attended if this plan happens`
            : 'Sync attendance to see the effect.'}
        </Text>
        <View style={{ marginTop: SP.md }}>
          <ThresholdGauge percent={after ?? 0} threshold={ATTENDANCE_THRESHOLD} tone={tone === 'muted' ? undefined : tone} />
        </View>
      </InkPanel>

      {daySlots.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No classes on this day" hint="Pick another day, or sync your timetable if this one should have classes." />
      ) : (
        <>
          <Row style={styles.dayActions}>
            <Pressable onPress={skipWholeDay} android_ripple={{ color: theme.surfaceMuted }} style={[styles.actionBtn, { backgroundColor: theme.dangerSoft }]}>
              <Ionicons name="close-circle-outline" size={16} color={theme.danger} />
              <Text style={[TYPE.caption, { color: theme.danger, fontFamily: FONT.extrabold }]}>Skip the whole day</Text>
            </Pressable>
            <Pressable onPress={() => setActions({})} disabled={!changed} android_ripple={{ color: theme.surfaceMuted }} style={[styles.actionBtn, { backgroundColor: theme.surfaceMuted, opacity: changed ? 1 : 0.5 }]}>
              <Ionicons name="refresh-outline" size={16} color={theme.textMuted} />
              <Text style={[TYPE.caption, { color: theme.textMuted, fontFamily: FONT.extrabold }]}>Reset</Text>
            </Pressable>
          </Row>

          <SectionTitle>This day</SectionTitle>
          <Card pad={0}>
            {projection.classes.map((item, i) => (
              <View key={item.slot.id} style={[styles.classRow, i < projection.classes.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
                <View style={styles.timeCol}>
                  <Text style={[TYPE.bodyStrong, { color: theme.text, fontSize: 13 }]}>{item.slot.startTime}</Text>
                  {item.mapping === 'unavailable' ? (
                    <Text style={[TYPE.caption, { color: theme.warning }]}>not counted</Text>
                  ) : null}
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.courseTitle, { color: theme.text }]} numberOfLines={1}>{item.slot.courseCode}</Text>
                  <Text style={[TYPE.caption, { color: theme.textMuted }]} numberOfLines={1}>{item.slot.courseTitle || '—'}</Text>
                </View>
                <Row style={styles.toggles}>
                  {(['present', 'absent'] as const).map((kind) => {
                    const on = item.action === kind;
                    const color = kind === 'present' ? theme.success : theme.danger;
                    return (
                      <Pressable
                        key={kind}
                        onPress={() => setAction(item.slot.id, kind)}
                        android_ripple={{ color: theme.surfaceMuted }}
                        style={[styles.toggle, { borderColor: on ? color : theme.border, backgroundColor: on ? (kind === 'present' ? theme.successSoft : theme.dangerSoft) : 'transparent' }]}
                      >
                        <Ionicons name={kind === 'present' ? 'checkmark' : 'close'} size={15} color={on ? color : theme.textMuted} />
                      </Pressable>
                    );
                  })}
                </Row>
              </View>
            ))}
          </Card>

          {dropped.length > 0 ? (
            <Card style={styles.warnCard}>
              <Row style={styles.warnHead}>
                <Ionicons name="alert-circle-outline" size={17} color={theme.danger} />
                <Text style={[TYPE.bodyStrong, { color: theme.text }]}>This plan drops {dropped.length} {dropped.length === 1 ? 'course' : 'courses'} below 75%</Text>
              </Row>
              {dropped.map((c) => (
                <Text key={c.key} style={[TYPE.caption, { color: theme.textSecondary, marginTop: 6 }]}>
                  {c.courseCode} — {c.currentPercentage.toFixed(1)}% → {c.projectedPercentage.toFixed(1)}%
                </Text>
              ))}
            </Card>
          ) : null}

          <SectionTitle>Projected by course</SectionTitle>
          <Card pad={0}>
            {projection.courses.filter((c) => c.classCount > 0).map((c, i, all) => (
              <View key={c.key} style={[styles.miniRow, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
                <View style={styles.flex}>
                  <Text style={[TYPE.body, { color: theme.text, fontFamily: FONT.bold }]}>{c.courseCode}</Text>
                  <Text style={[TYPE.caption, { color: theme.textMuted }]} numberOfLines={1}>{c.courseTitle}</Text>
                </View>
                <Text style={[TYPE.bodyStrong, { color: c.projectedPercentage < ATTENDANCE_THRESHOLD ? theme.danger : theme.success }]}>
                  {c.currentPercentage.toFixed(0)}% → {c.projectedPercentage.toFixed(0)}%
                </Text>
              </View>
            ))}
          </Card>

          <View style={[styles.statStrip, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <StatBlock value={String(daySlots.length)} label="classes" sub={day} />
            <StatBlock value={String(projection.classes.filter((c) => c.action === 'absent').length)} label="skipped" tone="danger" />
            <StatBlock value={String(projection.classes.filter((c) => c.action === 'present').length)} label="attended" tone="success" />
          </View>

          <View style={[styles.footNote, { backgroundColor: theme.surfaceMuted }]}>
            <Meta>A plan, not a record. Nothing here is sent to VTOP — it only projects what your counts would become.</Meta>
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },
  segment: { marginTop: SP.sm, marginBottom: SP.md },

  hero: { marginTop: SP.xs },
  heroRow: { alignItems: 'flex-end', gap: SP.md, justifyContent: 'space-between', marginTop: SP.xs },
  heroNum: { ...mono('bold'), fontSize: 46, letterSpacing: -2, lineHeight: 52 },
  heroUnit: { ...mono('bold'), fontSize: 22, letterSpacing: 0 },
  heroTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill, marginBottom: 8 },

  courseBlock: { paddingHorizontal: SP.lg, paddingVertical: SP.md + 2 },
  courseHead: { gap: SP.md, alignItems: 'center', justifyContent: 'space-between' },
  courseTitle: { fontFamily: FONT.bold, fontSize: 14.5, letterSpacing: -0.2 },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm },
  compHint: { ...mono('bold'), fontSize: 11, minWidth: 78, textAlign: 'right' },

  chips: { marginBottom: SP.md },
  dayActions: { gap: SP.sm, marginBottom: SP.md },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SP.md, paddingVertical: SP.sm + 1, borderRadius: RADIUS.pill },

  classRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.lg, paddingVertical: SP.md },
  timeCol: { width: 58 },
  toggles: { gap: 6 },
  toggle: { width: 34, height: 34, borderRadius: RADIUS.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  warnCard: { marginTop: SP.md, borderColor: '#f2b9b9' },
  warnHead: { gap: SP.sm, alignItems: 'center' },

  miniRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.lg, paddingVertical: SP.md },
  statStrip: { flexDirection: 'row', gap: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.lg, marginTop: SP.md },

  footNote: { borderRadius: RADIUS.md, padding: SP.lg, marginTop: SP.xl },
});
