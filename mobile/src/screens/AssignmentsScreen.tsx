/**
 * AssignmentsScreen.tsx — the semester's DA / assignment list, ordered by when
 * it is actually due.
 *
 * The rows are VTOP's own: code, title, due date, weightage and status come from
 * the assignments dataset the sync already pulls, and the status word is VTOP's
 * (the gateway client normalises it to Pending / Submitted / Graded). This
 * screen adds no academic logic of its other than the calendar-day count in
 * utils/assignmentStatus.ts, which is pinned by
 * src/lib/__tests__/mobileAssignments.test.ts.
 *
 * It is deliberately read-only: submitting work happens on VTOP, and saying so
 * is better than a button that cannot do it.
 */

import React, { useMemo, useState } from 'react';
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
  Meta,
  Row,
  ScreenHeader,
  SectionTitle,
  SegmentedControl,
  type Tone,
} from '../components/ui';
import {
  groupAssignmentsByCourse,
  summarizeAssignments,
  toAssignmentViews,
  type AssignmentView,
} from '../utils/assignmentStatus';
import { PAGE, RADIUS, SP, TYPE, mono, FONT } from '../theme';

type Filter = 'all' | 'todo' | 'done';

const URGENCY_TONE: Record<AssignmentView['urgency'], Tone> = {
  overdue: 'danger',
  today: 'danger',
  tomorrow: 'warning',
  soon: 'warning',
  later: 'muted',
  undated: 'muted',
};

const STATUS_TONE: Record<AssignmentView['record']['status'], Tone> = {
  Pending: 'accent',
  Submitted: 'success',
  Graded: 'info',
};

export function AssignmentsScreen() {
  const { theme, data } = useApp();
  const records = data?.assignments ?? [];
  const [filter, setFilter] = useState<Filter>('all');

  const views = useMemo(() => toAssignmentViews(records), [records]);
  const summary = useMemo(() => summarizeAssignments(views), [views]);

  const shown = useMemo(() => {
    if (filter === 'todo') return views.filter((v) => v.record.status === 'Pending');
    if (filter === 'done') return views.filter((v) => v.record.status !== 'Pending');
    return views;
  }, [views, filter]);

  const groups = useMemo(() => groupAssignmentsByCourse(shown), [shown]);

  if (!records.length) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="documents-outline"
          title="No assignments loaded"
          hint="Sync from the home screen to pull this semester's DA list from VTOP. Courses that set work through the LMS show it there instead."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Assignments"
          subtitle={data?.profile?.semester ? `Semester ${data.profile.semester} · VTOP DA list` : 'Your VTOP DA list'}
        />

        <InkPanel glow={summary.needingAttention > 0 ? 'danger' : 'accent'} style={styles.hero}>
          <Caption style={{ color: theme.onInkMuted }}>Still to do</Caption>
          <Row style={styles.heroRow}>
            <Text style={[styles.heroNum, { color: theme.onInk }]}>
              {summary.pending}
              <Text style={[styles.heroUnit, { color: theme.onInkMuted }]}> / {summary.total}</Text>
            </Text>
            <View style={styles.heroStats}>
              <HeroLine label="Due in 7 days" value={summary.dueThisWeek} theme={theme} />
              <HeroLine label="Past the due date" value={summary.needingAttention} theme={theme} danger={summary.needingAttention > 0} />
              <HeroLine label="Submitted or graded" value={summary.submitted + summary.graded} theme={theme} />
            </View>
          </Row>
        </InkPanel>

        <SegmentedControl
          style={styles.segment}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${summary.total}` },
            { value: 'todo', label: `To do ${summary.pending}` },
            { value: 'done', label: `Done ${summary.submitted + summary.graded}` },
          ]}
        />

        {groups.length === 0 ? (
          <EmptyState
            icon={filter === 'todo' ? 'checkmark-circle-outline' : 'archive-outline'}
            title={filter === 'todo' ? 'Nothing left to submit' : 'Nothing here yet'}
            hint={filter === 'todo' ? 'Every assignment on your VTOP list is marked submitted or graded.' : 'Switch filters to see the rest of the list.'}
          />
        ) : (
          groups.map((group) => (
            <View key={group.courseCode} style={styles.group}>
              <Row style={styles.groupHead}>
                <View style={styles.flex}>
                  <Text style={[styles.groupCode, { color: theme.text }]}>{group.courseCode}</Text>
                  {group.courseTitle ? <Meta numberOfLines={1}>{group.courseTitle}</Meta> : null}
                </View>
                {group.pending > 0 ? <Badge tone="accent">{group.pending} open</Badge> : <Badge tone="success">All in</Badge>}
              </Row>

              <Card pad={0}>
                {group.rows.map((v, i) => (
                  <View
                    key={v.record.id}
                    style={[styles.row, i < group.rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}
                  >
                    <View style={[styles.rowMark, { backgroundColor: urgencyColor(theme, v) }]} />
                    <View style={styles.flex}>
                      <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
                        {v.record.title || 'Untitled assignment'}
                      </Text>
                      <Row style={styles.rowMeta}>
                        <Text style={[TYPE.caption, { color: theme.textMuted }]}>{v.dueLabel}</Text>
                        {Number.isFinite(Number(v.record.weightage)) && Number(v.record.weightage) > 0 ? (
                          <Text style={[TYPE.caption, { color: theme.textMuted }]}>· {Number(v.record.weightage).toFixed(0)} marks</Text>
                        ) : null}
                      </Row>
                    </View>
                    <View style={styles.rowRight}>
                      <Badge tone={STATUS_TONE[v.record.status]}>{v.record.status}</Badge>
                      {v.urgency === 'overdue' ? (
                        <Ionicons name="alert-circle" size={15} color={theme.danger} style={{ marginTop: 4 }} />
                      ) : null}
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}

        <View style={[styles.footNote, { backgroundColor: theme.surfaceMuted }]}>
          <Caption>This is a read-only view</Caption>
          <Meta style={{ marginTop: 4, lineHeight: 19 }}>
            Work is submitted on VTOP (or the course page it points to). UltraCC only shows what VTOP already reports, so a status here is never newer than your last sync.
          </Meta>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function urgencyColor(theme: ReturnType<typeof useApp>['theme'], v: AssignmentView): string {
  if (v.record.status !== 'Pending') return theme.borderStrong;
  const tone = URGENCY_TONE[v.urgency];
  if (tone === 'danger') return theme.danger;
  if (tone === 'warning') return theme.warning;
  return theme.accent;
}

function HeroLine({ label, value, theme, danger }: { label: string; value: number; theme: ReturnType<typeof useApp>['theme']; danger?: boolean }) {
  return (
    <Row style={styles.heroLine}>
      <Text style={[TYPE.caption, { color: theme.onInkMuted, flex: 1 }]}>{label}</Text>
      <Text style={[TYPE.bodyStrong, { color: danger ? '#ff8a8c' : theme.onInk }]}>{value}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },

  hero: { marginTop: SP.xs },
  heroRow: { alignItems: 'center', gap: SP.lg, justifyContent: 'space-between', marginTop: SP.xs },
  heroNum: { ...mono('bold'), fontSize: 44, letterSpacing: -2, lineHeight: 50 },
  heroUnit: { ...mono('bold'), fontSize: 18, letterSpacing: 0 },
  heroStats: { flex: 1, gap: 5, alignItems: 'stretch' },
  heroLine: { gap: SP.sm, alignItems: 'center' },

  segment: { marginTop: SP.md, marginBottom: SP.sm },

  group: { marginTop: SP.md },
  groupHead: { gap: SP.md, alignItems: 'center', marginBottom: SP.sm },
  groupCode: { ...mono('bold'), fontSize: 14, letterSpacing: -0.2 },

  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.lg, paddingVertical: SP.md + 1 },
  rowMark: { width: 4, height: 30, borderRadius: RADIUS.pill },
  rowTitle: { fontFamily: FONT.bold, fontSize: 14, letterSpacing: -0.2 },
  rowMeta: { gap: 4, marginTop: 3, alignItems: 'center' },
  rowRight: { alignItems: 'flex-end' },

  footNote: { borderRadius: RADIUS.md, padding: SP.lg, marginTop: SP.xl },
});
