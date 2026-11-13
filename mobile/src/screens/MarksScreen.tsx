/**
 * MarksScreen.tsx — course-wise internal marks with the projected grade from the
 * ported grade model. A strong ink course hero (code, title, projected %, grade)
 * sits above compact theory / lab statistics and an assessment list that keeps
 * VTOP's REAL assessment names, score/max, weightage and status. Each evaluated
 * row is visually graded excellent / average / weak; pending rows are never read
 * as a zero. No marks logic is changed here — it is presentation only.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../state/AppContext';
import {
  Badge,
  Button,
  Caption,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  InkPanel,
  Meta,
  ProgressBar,
  Row,
  SectionTitle,
  toneColors,
  type Tone,
} from '../components/ui';
import {
  assessmentRowsOf,
  blendLabel,
  buildCourseModel,
  passLineOf,
  projectGrade,
  publishedMarksOf,
  type GradeLetter,
  type PassLine,
  type PassState,
} from '../utils/gradeModel';
import { baseCourseCode } from '../utils/courseCredits';
import { formatInternalMark, getInternalMarksRatio } from '../utils/internalMarks';
import { GRADE_BAND_COLORS, PAGE, RADIUS, SP, TYPE, mono, FONT } from '../theme';

function performanceOf(ratio: number): { label: string; tone: Tone } {
  if (ratio >= 85) return { label: 'Excellent', tone: 'success' };
  if (ratio >= 60) return { label: 'Good', tone: 'accent' };
  if (ratio >= 40) return { label: 'Average', tone: 'warning' };
  return { label: 'Weak', tone: 'danger' };
}

function passToneOf(state: PassState): Tone {
  if (state === 'passed' || state === 'secured') return 'success';
  if (state === 'failed' || state === 'impossible') return 'danger';
  if (state === 'needs') return 'accent';
  return 'muted';
}

/** The chip's short phrase: VTOP's outcome, or the FAT marks the pass needs. */
function passLabelOf(pass: PassLine): string {
  if (pass.state === 'passed') return 'Passed';
  if (pass.state === 'failed') return 'Failed';
  if (pass.state === 'impossible') return 'Out of reach';
  if ((pass.state === 'secured' || pass.state === 'needs') && pass.requiredRaw !== null) {
    return `Safe ${Math.ceil(pass.requiredRaw)}${pass.fatMax !== null ? `/${pass.fatMax}` : ''}`;
  }
  return 'Pass n/a';
}

function passIconOf(state: PassState): 'shield-checkmark-outline' | 'alert-circle-outline' {
  return state === 'failed' || state === 'impossible' ? 'alert-circle-outline' : 'shield-checkmark-outline';
}

export function MarksScreen() {
  const { theme, data } = useApp();
  const navigation = useNavigation<any>();
  const marks = data?.marks ?? [];
  // The batch — read from the register number — decides how an embedded course
  // combines its theory and lab halves. Without it the model cannot apply the
  // 2025 rule and falls back to the registered credits.
  const regNo = data?.registrationNo || data?.profile?.registrationNo;

  const models = useMemo(() => marks.map((m) => buildCourseModel(m, { regNo })), [marks, regNo]);
  const [index, setIndex] = useState(0);

  const safeIndex = Math.min(index, Math.max(0, models.length - 1));
  const model = models[safeIndex];
  const mark = marks[safeIndex];
  const { percent, grade } = useMemo(() => (model ? projectGrade(model) : { percent: null, grade: null }), [model]);
  const ratio = useMemo(() => (mark ? getInternalMarksRatio(mark) : null), [mark]);
  const rows = useMemo(() => (mark ? assessmentRowsOf(mark) : []), [mark]);

  // VTOP's grade view is the only place a course total is published. Two rows
  // under one code are an embedded course's halves, so neither half's 100-mark
  // total is claimed as the merged course's.
  const publishedByCourse = useMemo(() => {
    const map = new Map<string, { grade: string; grandTotal: number | null } | null>();
    for (const g of data?.semesterGrades?.grades ?? []) {
      const code = g.courseCode.trim().toUpperCase();
      if (!code) continue;
      map.set(code, map.has(code) ? null : { grade: g.grade, grandTotal: g.grandTotal });
    }
    return map;
  }, [data?.semesterGrades]);
  const publishedFor = (code: string) => {
    const key = code.trim().toUpperCase();
    if (publishedByCourse.has(key)) return publishedByCourse.get(key) ?? null;
    const base = baseCourseCode(code).trim().toUpperCase();
    return publishedByCourse.has(base) ? publishedByCourse.get(base) ?? null : null;
  };
  const published = mark ? publishedFor(mark.courseCode) : null;
  const publishedMarks = useMemo(
    () => (model ? publishedMarksOf(model, published?.grandTotal ?? null) : null),
    [model, published],
  );
  const pass = useMemo(
    () => (model ? passLineOf(model, { publishedGrade: published?.grade ?? null, publishedTotal: published?.grandTotal ?? null }) : null),
    [model, published],
  );
  const heroTotal = publishedMarks?.courseTotal ?? null;
  const heroGrade = published?.grade || grade;

  if (!marks.length || !model) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        <EmptyState icon="stats-chart-outline" title="No marks yet" hint="Sync to load your internal assessment marks." />
      </SafeAreaView>
    );
  }

  const theory = model.parts.theory;
  const lab = model.parts.lab;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Course selector */}
        <ChipRow>
          {models.map((m, i) => (
            <Chip key={`${m.courseCode}-${i}`} label={m.courseCode} selected={i === safeIndex} onPress={() => setIndex(i)} />
          ))}
        </ChipRow>

        {/* Ink course hero */}
        <InkPanel glow={heroGrade ? 'accent' : 'none'} style={styles.hero}>
          <Row style={styles.heroHead}>
            <View style={styles.flex}>
              <Text style={[TYPE.caption, { color: theme.onInkMuted, letterSpacing: 1.2 }]}>{model.courseCode}</Text>
              <Text style={[styles.heroTitle, { color: theme.onInk }]} numberOfLines={2}>{model.courseTitle}</Text>
            </View>
            <View style={[styles.gradeChip, { backgroundColor: '#fff' }]}>
              <Text style={[styles.gradeLetter, { color: heroGrade ? GRADE_BAND_COLORS[heroGrade as GradeLetter] : '#64748b' }]}>{heroGrade ?? '—'}</Text>
            </View>
          </Row>
          <Row style={styles.heroFigures}>
            <View>
              {heroTotal !== null ? (
                <>
                  <Text style={[styles.heroPct, { color: theme.onInk }]}>{heroTotal.toFixed(1)}<Text style={{ fontSize: 20, color: theme.onInkMuted }}> / 100</Text></Text>
                  <Text style={[TYPE.caption, { color: theme.onInkMuted, textTransform: 'uppercase' }]}>VTOP total</Text>
                </>
              ) : (
                <>
                  <Text style={[styles.heroPct, { color: theme.onInk }]}>{percent !== null ? percent.toFixed(1) : '—'}<Text style={{ fontSize: 22, color: theme.onInkMuted }}>%</Text></Text>
                  <Text style={[TYPE.caption, { color: theme.onInkMuted, textTransform: 'uppercase' }]}>Projected</Text>
                </>
              )}
            </View>
            <View style={[styles.heroStatDiv, { backgroundColor: 'rgba(255,255,255,0.14)' }]} />
            <View>
              <Text style={[styles.heroStat, { color: theme.onInk }]}>{ratio ? `${formatInternalMark(ratio.scored)}/${formatInternalMark(ratio.max)}` : '—'}</Text>
              <Text style={[TYPE.caption, { color: theme.onInkMuted, textTransform: 'uppercase' }]}>Internal</Text>
            </View>
            <View style={[styles.heroStatDiv, { backgroundColor: 'rgba(255,255,255,0.14)' }]} />
            <View>
              <Text style={[styles.heroStat, { color: theme.onInk }]}>{model.credits !== null ? model.credits : '—'}</Text>
              <Text style={[TYPE.caption, { color: theme.onInkMuted, textTransform: 'uppercase' }]}>Credits</Text>
            </View>
          </Row>
          <View style={{ marginTop: SP.lg }}>
            <ProgressBar percent={heroTotal ?? percent ?? 0} height={6} track="rgba(255,255,255,0.16)" tone={(heroTotal ?? percent) !== null ? undefined : 'muted'} />
          </View>
        </InkPanel>

        {pass ? (
          <Card style={styles.passCard}>
            <Row style={styles.passHead}>
              <Row style={styles.passTitle}>
                <Ionicons name={passIconOf(pass.state)} size={16} color={toneColors(theme, passToneOf(pass.state)).fg} />
                <Text style={[TYPE.bodyStrong, { color: theme.text }]}>Safe mark</Text>
              </Row>
              <Badge tone={passToneOf(pass.state)}>{passLabelOf(pass)}</Badge>
            </Row>
            <Text style={[TYPE.meta, { color: theme.textSecondary, marginTop: SP.sm, lineHeight: 19 }]}>{pass.message}</Text>
            {pass.coursePercent !== null && (pass.state === 'needs' || pass.state === 'secured' || pass.state === 'impossible') ? (
              <Text style={[TYPE.caption, { color: theme.textMuted, marginTop: SP.xs, lineHeight: 17 }]}>
                On the marks VTOP has graded, with ungraded rows at zero, the course sits at {pass.coursePercent.toFixed(1)} / 100.
                {pass.assumedFat ? ' VTOP has not published the FAT weight, so this uses its 40% rule.' : ''}
              </Text>
            ) : null}
          </Card>
        ) : null}

        <Button
          label="Open grade predictor"
          icon="calculator-outline"
          variant="soft"
          onPress={() => navigation.navigate('GradePredictor', { courseCode: model.courseCode })}
          style={styles.predictorBtn}
        />

        {/* Compact theory / lab stats */}
        {(theory || lab) ? (
          <>
            <SectionTitle>Breakdown</SectionTitle>
            <Row style={styles.partRow}>
              {theory ? <PartStat label="Theory" part={theory} accent /> : null}
              {lab ? <PartStat label="Lab" part={lab} accent={false} /> : null}
            </Row>
            {blendLabel(model) ? <Caption>{blendLabel(model)}</Caption> : null}
          </>
        ) : null}

        {model.pendingTitles.length > 0 ? (
          <View style={[styles.pendingBanner, { backgroundColor: theme.warningSoft }]}>
            <Ionicons name="time-outline" size={16} color={theme.warning} />
            <Text style={[TYPE.meta, { color: theme.warning, flex: 1 }]}>
              Awaiting evaluation: {model.pendingTitles.join(', ')}
            </Text>
          </View>
        ) : null}

        {/* Assessment list */}
        <SectionTitle>Assessments</SectionTitle>
        <Card pad={0}>
          {rows.map((row, i) => {
            const pending = row.scored === null;
            const pct = !pending && row.max > 0 ? (row.scored! / row.max) * 100 : 0;
            const perf = performanceOf(pct);
            return (
              <View key={row.key} style={[styles.assessRow, i < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
                <View style={[styles.assessBar, { backgroundColor: pending ? theme.border : toneColors(theme, perf.tone).fg }]} />
                <View style={styles.flex}>
                  <Row style={styles.assessTitleRow}>
                    <Text style={[TYPE.bodyStrong, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{row.title}</Text>
                    {row.isFat ? <Badge tone="gold">FAT</Badge> : null}
                  </Row>
                  <Row style={styles.assessMetaRow}>
                    <Meta>{row.weightage > 0 ? `${row.weightage} wt` : '—'}</Meta>
                    <View style={[styles.metaDot, { backgroundColor: theme.border }]} />
                    <Meta>{pending ? 'Not evaluated' : `${pct.toFixed(0)}% scored`}</Meta>
                  </Row>
                  {!pending ? (
                    <View style={{ marginTop: 7 }}>
                      <ProgressBar percent={pct} tone={perf.tone} height={4} />
                    </View>
                  ) : null}
                </View>
                <View style={styles.assessScore}>
                  <Text style={[styles.assessValue, { color: pending ? theme.textMuted : theme.text }]}>
                    {pending ? '—' : `${row.scored}`}
                    <Text style={{ fontSize: 12, color: theme.textMuted }}>/{row.max}</Text>
                  </Text>
                  {!pending ? <Badge tone={perf.tone}>{perf.label}</Badge> : <Badge tone="warning">Pending</Badge>}
                </View>
              </View>
            );
          })}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function PartStat({ label, part, accent }: { label: string; part: NonNullable<ReturnType<typeof buildCourseModel>['parts']['theory']>; accent: boolean }) {
  const { theme } = useApp();
  const c = toneColors(theme, accent ? 'accent' : 'secondary');
  const declared = part.configuredWeight;
  const pct = declared > 0 ? (part.earned / declared) * 100 : 0;
  const complete = declared > 0 && part.pendingWeight <= 0;
  return (
    <View style={[styles.partCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Row style={styles.partHead}>
        <View style={[styles.partDot, { backgroundColor: c.fg }]} />
        <Text style={[TYPE.bodyStrong, { color: theme.text }]}>{label}</Text>
        <Text style={[TYPE.caption, { color: theme.textMuted }]}>{part.credits} cr</Text>
      </Row>
      <Text style={[styles.partPct, { color: theme.text }]}>
        {declared > 0 ? part.earned.toFixed(1) : '—'}
        {declared > 0 ? <Text style={{ fontSize: 13, color: theme.textMuted }}> / {declared}</Text> : null}
      </Text>
      <Caption>
        {declared <= 0
          ? 'No weight published'
          : complete
            ? `${pct.toFixed(0)}% of the class`
            : `${part.gradedCount} of ${part.gradedCount + part.pendingCount} rows graded`}
      </Caption>
      <View style={{ marginTop: SP.sm }}>
        <ProgressBar percent={pct} tone={accent ? 'accent' : 'secondary'} height={5} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },

  hero: { marginTop: SP.md },
  heroHead: { alignItems: 'flex-start', gap: SP.md },
  heroTitle: { fontFamily: FONT.extrabold, fontSize: 20, letterSpacing: -0.4, marginTop: 4, lineHeight: 25 },
  gradeChip: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  gradeLetter: { ...mono('bold'), fontSize: 24 },
  heroFigures: { alignItems: 'center', marginTop: SP.xl, gap: SP.lg },
  heroPct: { ...mono('bold'), fontSize: 34, letterSpacing: -1 },
  heroStat: { ...mono('bold'), fontSize: 22, letterSpacing: -0.4 },
  heroStatDiv: { width: StyleSheet.hairlineWidth, height: 34 },
  passCard: { marginTop: SP.md },
  passHead: { justifyContent: 'space-between', gap: SP.sm },
  passTitle: { gap: SP.sm, alignItems: 'center' },
  predictorBtn: { marginTop: SP.md },

  partRow: { gap: SP.md },
  partCard: { flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.lg },
  partHead: { gap: SP.sm, justifyContent: 'space-between' },
  partDot: { width: 8, height: 8, borderRadius: 4 },
  partPct: { ...mono('bold'), fontSize: 26, letterSpacing: -0.8, marginTop: SP.md },

  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderRadius: RADIUS.md, padding: SP.md, marginTop: SP.md },

  assessRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.md + 1, paddingHorizontal: SP.lg, overflow: 'hidden' },
  assessBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  assessTitleRow: { gap: SP.sm, alignItems: 'center' },
  assessMetaRow: { gap: 6, alignItems: 'center', marginTop: 3 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5 },
  assessScore: { alignItems: 'flex-end', gap: 5 },
  assessValue: { ...mono('bold'), fontSize: 19, letterSpacing: -0.5 },
});
