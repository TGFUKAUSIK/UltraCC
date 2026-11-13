/**
 * AcademicsScreen.tsx — the academics hub, grouped by what a student is trying
 * to do rather than by screen count.
 *
 * Two primary tiles carry the surfaces used every day (Attendance, Timetable)
 * and show their live number, so the hub is informative before it is
 * navigable. Everything else sits in three labelled lists — Plan your week,
 * Marks & work, Campus life — each row stating the feature by name, a one-line
 * description, and the real value behind it when the synced snapshot has one.
 *
 * No tile is decorative: every key here is a registered screen, and no row
 * invents a number the backend did not return.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../state/AppContext';
import {
  Caption,
  Card,
  IconBox,
  Meta,
  Row,
  RowGroup,
  ScreenHeader,
  SectionTitle,
  SettingsRow,
  Tap,
  type IoniconName,
  type Tone,
} from '../components/ui';
import { componentTotals } from '../utils/attendanceComponents';
import { ATTENDANCE_THRESHOLD, forecastAttendance } from '../utils/attendanceForecast';
import { groupAssignmentsByCourse, summarizeAssignments, toAssignmentViews } from '../utils/assignmentStatus';
import { allKnownRooms } from '../utils/roomAvailability';
import { istDateLabel, nextUpcomingExam } from '../utils/examUtils';
import { PAGE, RADIUS, SP, TYPE, mono, FONT } from '../theme';

interface Tile {
  key: string;
  title: string;
  hint: string;
  value: string;
  caption: string;
  icon: IoniconName;
  tone: Tone;
}

interface ListRow {
  key: string;
  title: string;
  hint: string;
  value?: string;
  tone?: Tone;
  icon: IoniconName;
  go: (nav: any) => void;
}

export function AcademicsScreen() {
  const { theme, data } = useApp();
  const navigation = useNavigation<any>();

  const attendance = data?.attendance ?? [];
  const timetable = data?.timetable ?? [];
  const marks = data?.marks ?? [];
  const exams = data?.exams ?? [];
  const assignments = data?.assignments ?? [];
  const calendar = data?.calendar;
  const od = data?.od;
  const transport = data?.transport;

  const totals = useMemo(() => (attendance.length ? componentTotals(attendance) : null), [attendance]);
  const overallPct = totals?.percentage ?? null;
  const overallForecast = useMemo(() => forecastAttendance(totals?.attended ?? 0, totals?.conducted ?? 0), [totals]);

  const todayName = useMemo(() => weekdayOfToday(), []);
  const todayClasses = useMemo(
    () => timetable.filter((s) => s.day === todayName).length,
    [timetable, todayName],
  );

  // How many courses are sitting under the bar right now — the one number that
  // makes the predictor worth opening.
  const belowBar = useMemo(() => {
    if (!attendance.length) return 0;
    return Object.entries(
      attendance.reduce<Record<string, { a: number; h: number }>>((acc, r) => {
        const key = r.courseCode || 'Unknown';
        const cur = acc[key] ?? { a: 0, h: 0 };
        acc[key] = { a: cur.a + (Number(r.attended) || 0), h: cur.h + (Number(r.totalHeld) || 0) };
        return acc;
      }, {}),
    ).filter(([, v]) => v.h > 0 && (v.a / v.h) * 100 < ATTENDANCE_THRESHOLD).length;
  }, [attendance]);

  const roomCount = useMemo(() => allKnownRooms(timetable.map((s) => s.venue || '')).length, [timetable]);

  const odValue = od?.available ? `${od.totalOdHours}/${od.limitHours} hrs` : undefined;

  const assignmentSummary = useMemo(() => summarizeAssignments(toAssignmentViews(assignments)), [assignments]);
  const assignmentCount = useMemo(() => groupAssignmentsByCourse(toAssignmentViews(assignments)).length, [assignments]);

  const nextExam = useMemo(() => nextUpcomingExam(exams), [exams]);
  const examValue = nextExam ? `Next in ${nextExam.countdown}` : undefined;

  const todayRow = useMemo(
    () => calendar?.days.find((d) => d.date === istDateLabel()) ?? null,
    [calendar],
  );
  const calendarValue = calendar?.available
    ? todayRow
      ? todayRow.label || (todayRow.dayOrder ? `Day order ${todayRow.dayOrder}` : 'Instructional day')
      : `${calendar.days.length} days mapped`
    : undefined;

  const tiles: Tile[] = [
    {
      key: 'Attendance',
      title: 'Attendance',
      hint: 'Theory, lab and project kept apart',
      value: overallPct !== null ? `${overallPct.toFixed(1)}%` : '—',
      caption: overallForecast.meetsThreshold ? 'Above the bar' : 'Below the bar',
      icon: 'checkmark-done-outline',
      tone: overallPct !== null && overallPct < ATTENDANCE_THRESHOLD ? 'danger' : 'success',
    },
    {
      key: 'Timetable',
      title: 'Timetable',
      hint: 'Slots, venues and the day ahead',
      value: String(todayClasses),
      caption: 'classes today',
      icon: 'calendar-outline',
      tone: 'accent',
    },
  ];

  const planRows: ListRow[] = [
    {
      key: 'AttendancePredictor',
      title: 'Attendance predictor',
      hint: 'How many classes you can still miss',
      value: attendance.length ? (belowBar ? `${belowBar} below 75%` : 'All courses clear') : undefined,
      tone: belowBar ? 'danger' : 'success',
      icon: 'trending-up-outline',
      go: (nav) => nav.navigate('AttendancePredictor'),
    },
    {
      key: 'FreeClassrooms',
      title: 'Free classrooms',
      hint: 'Empty rooms and labs, period by period',
      value: `${roomCount} rooms mapped`,
      icon: 'business-outline',
      go: (nav) => nav.navigate('FreeClassrooms'),
    },
    {
      key: 'Od',
      title: 'OD calculator',
      hint: 'On-duty hours against the department limit',
      value: odValue,
      icon: 'briefcase-outline',
      go: (nav) => nav.navigate('Od'),
    },
    {
      key: 'Calendar',
      title: 'Academic calendar',
      hint: 'Day orders, holidays and exam windows',
      value: calendarValue,
      icon: 'today-outline',
      go: (nav) => nav.navigate('Calendar'),
    },
  ];

  const workRows: ListRow[] = [
    {
      key: 'Marks',
      title: 'Internal marks',
      hint: 'CAT, DA, quiz and lab component scores',
      value: marks.length ? `${marks.length} courses` : undefined,
      icon: 'stats-chart-outline',
      go: (nav) => nav.navigate('Marks'),
    },
    {
      key: 'GradePredictor',
      title: 'Grade predictor',
      hint: 'What you need in the FAT to hit a grade',
      value: marks.length ? `${marks.length} predictable` : undefined,
      icon: 'calculator-outline',
      go: (nav) => nav.navigate('GradePredictor'),
    },
    {
      key: 'Exams',
      title: 'Exams',
      hint: 'Dates, slots, venues and seats',
      value: examValue,
      tone: 'gold',
      icon: 'document-text-outline',
      go: (nav) => nav.navigate('Exams'),
    },
    {
      key: 'Assignments',
      title: 'Assignments',
      hint: 'The VTOP DA list, ordered by due date',
      value: assignments.length
        ? `${assignmentSummary.pending} of ${assignmentCount} courses open`
        : undefined,
      tone: assignmentSummary.needingAttention ? 'danger' : 'info',
      icon: 'documents-outline',
      go: (nav) => nav.navigate('Assignments'),
    },
  ];

  const lifeRows: ListRow[] = [
    {
      key: 'Events',
      title: 'Event hub',
      hint: 'Clubs, fests and workshops worth registering for',
      icon: 'ticket-outline',
      go: (nav) => nav.navigate('Events'),
    },
    {
      key: 'PYQs',
      title: 'Question bank',
      hint: 'Previous-year papers by course and exam type',
      icon: 'library-outline',
      go: (nav) => nav.navigate('PYQs'),
    },
    {
      key: 'Transport',
      title: 'Transport',
      hint: 'Day-scholar bus route and pass status',
      value: transport?.routeSelected || undefined,
      icon: 'bus-outline',
      go: (nav) => nav.navigate('More', { screen: 'Transport' }),
    },
  ];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Academics"
          subtitle={data?.profile?.semester ? `Semester ${data.profile.semester} · ${data.profile.branch || 'VIT Chennai'}` : 'Your VTOP account'}
        />

        <View style={styles.tileRow}>
          {tiles.map((t) => (
            <Tap key={t.key} onPress={() => navigation.navigate(t.key)} style={styles.tile}>
              <View style={[styles.tileInner, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <IconBox name={t.icon} tone={t.tone} size={38} iconSize={19} />
                <Text style={[styles.tileValue, { color: theme.text }]} numberOfLines={1}>{t.value}</Text>
                <Text style={[styles.tileTitle, { color: theme.text }]}>{t.title}</Text>
                <Text style={[TYPE.caption, { color: theme.textMuted, marginTop: 1 }]}>{t.hint}</Text>
                <Text style={[styles.tileCaption, { color: toneFg(theme, t.tone) }]}>{t.caption}</Text>
              </View>
            </Tap>
          ))}
        </View>

        <SectionTitle style={styles.section}>Plan your week</SectionTitle>
        <RowGroup>
          {planRows.map((r, i) => (
            <SettingsRow
              key={r.key}
              icon={r.icon}
              title={r.title}
              value={r.hint}
              tone={r.tone ?? 'accent'}
              right={r.value ? <Trailing value={r.value} tone={r.tone} /> : undefined}
              onPress={() => r.go(navigation)}
              last={i === planRows.length - 1}
            />
          ))}
        </RowGroup>

        <SectionTitle>Marks &amp; work</SectionTitle>
        <RowGroup>
          {workRows.map((r, i) => (
            <SettingsRow
              key={r.key}
              icon={r.icon}
              title={r.title}
              value={r.hint}
              tone={r.tone ?? 'info'}
              right={r.value ? <Trailing value={r.value} tone={r.tone} /> : undefined}
              onPress={() => r.go(navigation)}
              last={i === workRows.length - 1}
            />
          ))}
        </RowGroup>

        <SectionTitle>Campus life</SectionTitle>
        <RowGroup>
          {lifeRows.map((r, i) => (
            <SettingsRow
              key={r.key}
              icon={r.icon}
              title={r.title}
              value={r.hint}
              tone={r.tone ?? 'secondary'}
              right={r.value ? <Trailing value={r.value} tone={r.tone} /> : undefined}
              onPress={() => r.go(navigation)}
              last={i === lifeRows.length - 1}
            />
          ))}
        </RowGroup>

        <Card style={styles.footNote} level={0}>
          <Caption>Everything here is read from VTOP</Caption>
          <Meta style={{ marginTop: 4, lineHeight: 19 }}>
            Pull to refresh on the home screen to update these numbers. Your sign-in details are used once per session and never saved on this device.
          </Meta>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Trailing({ value, tone }: { value: string; tone?: Tone }) {
  const { theme } = useApp();
  const color = tone === 'danger' ? theme.danger : tone === 'success' ? theme.success : tone === 'warning' ? theme.warning : theme.textMuted;
  return (
    <View style={[styles.trailing, { backgroundColor: theme.surfaceMuted }]}>
      <Text style={[TYPE.caption, { color, fontFamily: FONT.extrabold }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/**
 * Today spelled the way the timetable spells it, taken from the IST date rather
 * than the phone's clock — a student visiting family in another timezone is
 * still on the same class day as the campus.
 */
function weekdayOfToday(): string | null {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const istNoon = new Date(`${istDateLabel()}T12:00:00Z`);
  return names[istNoon.getUTCDay()] ?? null;
}

function toneFg(theme: ReturnType<typeof useApp>['theme'], tone: Tone): string {
  if (tone === 'danger') return theme.danger;
  if (tone === 'success') return theme.success;
  if (tone === 'warning') return theme.warning;
  if (tone === 'gold') return theme.gold;
  return theme.accent;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },

  tileRow: { flexDirection: 'row', gap: SP.md, marginTop: SP.sm },
  tile: { flex: 1 },
  tileInner: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.lg, minHeight: 168, gap: 2 },
  tileValue: { ...mono('bold'), fontSize: 28, letterSpacing: -1, marginTop: SP.md },
  tileTitle: { fontFamily: FONT.extrabold, fontSize: 15, letterSpacing: -0.3, marginTop: 2 },
  tileCaption: { fontFamily: FONT.extrabold, fontSize: 11.5, marginTop: SP.sm, textTransform: 'uppercase', letterSpacing: 0.3 },

  section: { marginTop: SP.xl },

  trailing: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: RADIUS.pill, maxWidth: 132 },
  footNote: { marginTop: SP.xl },
});
