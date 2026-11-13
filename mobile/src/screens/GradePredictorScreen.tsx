/**
 * GradePredictorScreen.tsx — an interactive "what do I need in the FAT?" tool.
 *
 * This is a NEW screen, but it adds NO new academic logic: it is a presentation
 * over the already-ported grade model (buildCourseModel, projectGrade and
 * solveTargetFAT). The student picks a course and a target grade; the screen
 * shows the required FAT score, the feasibility and a live what-if projection as
 * they move the assumed FAT percentage. Large result, small explanatory text.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useApp } from '../state/AppContext';
import {
  Badge,
  Caption,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  IconButton,
  InkPanel,
  Meta,
  ProgressBar,
  Row,
  SectionTitle,
  toneColors,
  type Tone,
} from '../components/ui';
import {
  buildCourseModel,
  blendLabel,
  projectGrade,
  solveTargetFAT,
  GRADE_ORDER,
  TARGET_SCORES,
  type FatFeasibility,
  type GradeLetter,
} from '../utils/gradeModel';
import { GRADE_BAND_COLORS, PAGE, RADIUS, SP, TYPE, mono, FONT } from '../theme';

const FEASIBILITY: Record<FatFeasibility, { label: string; tone: Tone }> = {
  secured: { label: 'Secured', tone: 'success' },
  easy: { label: 'Very achievable', tone: 'success' },
  moderate: { label: 'Achievable', tone: 'accent' },
  tough: { label: 'Tough', tone: 'warning' },
  miracle: { label: 'Needs a miracle', tone: 'warning' },
  impossible: { label: 'Out of reach', tone: 'danger' },
  unknown: { label: 'Not enough data', tone: 'muted' },
};

const WHATIF_PRESETS = [40, 50, 60, 70, 80, 90, 100];

export function GradePredictorScreen() {
  const { theme, data } = useApp();
  const route = useRoute<RouteProp<{ params?: { courseCode?: string } }, 'params'>>();
  const marks = data?.marks ?? [];
  // The register number carries the admission batch, and the batch decides how
  // an embedded course weighs its theory and lab halves.
  const regNo = data?.registrationNo || data?.profile?.registrationNo;
  const models = useMemo(() => marks.map((m) => buildCourseModel(m, { regNo })), [marks, regNo]);

  const initial = Math.max(0, models.findIndex((m) => m.courseCode === route.params?.courseCode));
  const [index, setIndex] = useState(initial === -1 ? 0 : initial);
  const [target, setTarget] = useState<GradeLetter>('A');
  const [whatIf, setWhatIf] = useState<number>(60);

  const safeIndex = Math.min(index, Math.max(0, models.length - 1));
  const model = models[safeIndex];

  const baseline = useMemo(() => (model ? projectGrade(model) : { percent: null, grade: null }), [model]);
  const fatTarget = useMemo(() => (model ? solveTargetFAT(model, TARGET_SCORES[target]) : null), [model, target]);
  const whatIfProjection = useMemo(() => (model ? projectGrade(model, { fatPercent: whatIf }) : { percent: null, grade: null }), [model, whatIf]);

  if (!models.length || !model) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        <EmptyState icon="calculator-outline" title="No courses to predict" hint="Sync your marks first — the predictor works on your real internal scores." />
      </SafeAreaView>
    );
  }

  const feas = fatTarget ? FEASIBILITY[fatTarget.feasibility] : FEASIBILITY.unknown;
  const splitNote = blendLabel(model);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <ChipRow>
          {models.map((m, i) => (
            <Chip key={`${m.courseCode}-${i}`} label={m.courseCode} selected={i === safeIndex} onPress={() => setIndex(i)} />
          ))}
        </ChipRow>

        {/* Current standing on ink */}
        <InkPanel glow="accent" style={styles.hero}>
          <Text style={[TYPE.caption, { color: theme.onInkMuted, letterSpacing: 1.2 }]}>{model.courseCode}</Text>
          <Text style={[styles.heroTitle, { color: theme.onInk }]} numberOfLines={1}>{model.courseTitle}</Text>
          <Row style={styles.heroRow}>
            <View>
              <Text style={[styles.heroPct, { color: theme.onInk }]}>{baseline.percent !== null ? baseline.percent.toFixed(1) : '—'}<Text style={{ fontSize: 20, color: theme.onInkMuted }}>%</Text></Text>
              <Text style={[TYPE.caption, { color: theme.onInkMuted, textTransform: 'uppercase' }]}>Current projection</Text>
            </View>
            <View style={[styles.gradeChip, { backgroundColor: '#fff' }]}>
              <Text style={[styles.gradeLetter, { color: baseline.grade ? GRADE_BAND_COLORS[baseline.grade] : '#64748b' }]}>{baseline.grade ?? '—'}</Text>
            </View>
          </Row>
          {splitNote ? (
            <Text style={[TYPE.caption, { color: theme.onInkMuted, marginTop: SP.md }]}>{splitNote}</Text>
          ) : null}
        </InkPanel>

        {/* Target selector */}
        <SectionTitle>Target grade</SectionTitle>
        <Row style={styles.targetRow}>
          {GRADE_ORDER.filter((g) => g !== 'F').map((g) => {
            const active = g === target;
            return (
              <Pressable
                key={g}
                onPress={() => setTarget(g)}
                style={[styles.targetChip, { backgroundColor: active ? GRADE_BAND_COLORS[g] : theme.surface, borderColor: active ? GRADE_BAND_COLORS[g] : theme.border }]}
              >
                <Text style={[styles.targetLetter, { color: active ? '#fff' : theme.text }]}>{g}</Text>
                <Text style={[styles.targetScore, { color: active ? 'rgba(255,255,255,0.85)' : theme.textMuted }]}>{TARGET_SCORES[g]}%</Text>
              </Pressable>
            );
          })}
        </Row>

        {/* Required FAT result */}
        <Card style={styles.resultCard}>
          <Row style={styles.resultHead}>
            <Caption>Required in the FAT</Caption>
            <Badge tone={feas.tone}>{feas.label}</Badge>
          </Row>
          {fatTarget && !fatTarget.isUnknown ? (
            <>
              <Row style={styles.resultFigures}>
                <Text style={[styles.resultBig, { color: fatTarget.isAchievable || fatTarget.isAlreadyAchieved ? theme.text : theme.danger }]}>
                  {fatTarget.requiredRaw !== null ? fatTarget.requiredRaw : '—'}
                  <Text style={[styles.resultMax, { color: theme.textMuted }]}> / {fatTarget.fatMax || '—'}</Text>
                </Text>
                {fatTarget.requiredPercent !== null ? (
                  <View style={[styles.resultPctPill, { backgroundColor: toneColors(theme, feas.tone).bg }]}>
                    <Text style={[TYPE.bodyStrong, { color: toneColors(theme, feas.tone).fg }]}>{fatTarget.requiredPercent.toFixed(0)}%</Text>
                  </View>
                ) : null}
              </Row>
              <Text style={[TYPE.meta, { color: theme.textSecondary, marginTop: SP.sm, lineHeight: 19 }]}>{fatTarget.message}</Text>
              {fatTarget.vitFatMinimumRaw !== null ? (
                <Row style={styles.cutoffRow}>
                  <Ionicons name={fatTarget.meetsVITMinimumCutoff ? 'shield-checkmark-outline' : 'alert-circle-outline'} size={15} color={fatTarget.meetsVITMinimumCutoff ? theme.success : theme.warning} />
                  <Text style={[TYPE.caption, { color: theme.textMuted }]}>
                    VIT needs ≥ {fatTarget.vitFatMinimumRaw} (40%) in the FAT to pass — {fatTarget.meetsVITMinimumCutoff ? 'this clears it' : 'this is below it'}
                  </Text>
                </Row>
              ) : null}
            </>
          ) : (
            <Text style={[TYPE.meta, { color: theme.textSecondary, marginTop: SP.xs, lineHeight: 19 }]}>{fatTarget?.message || 'Not enough graded work yet to solve a target.'}</Text>
          )}
        </Card>

        {/* What-if */}
        <SectionTitle>What if I score…</SectionTitle>
        <Card>
          <Row style={styles.stepperRow}>
            <IconButton name="remove" onPress={() => setWhatIf((v) => Math.max(0, v - 5))} size={40} />
            <View style={styles.flex}>
              <Text style={[styles.whatIfValue, { color: theme.text }]}>{whatIf}%</Text>
              <View style={{ marginTop: 8 }}>
                <ProgressBar percent={whatIf} tone="accent" height={6} />
              </View>
            </View>
            <IconButton name="add" onPress={() => setWhatIf((v) => Math.min(100, v + 5))} size={40} />
          </Row>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
            {WHATIF_PRESETS.map((p) => (
              <Pressable key={p} onPress={() => setWhatIf(p)} style={[styles.preset, { backgroundColor: p === whatIf ? theme.accentSoft : theme.surfaceMuted, borderColor: p === whatIf ? theme.accent : 'transparent' }]}>
                <Text style={[TYPE.caption, { color: p === whatIf ? theme.accent : theme.textMuted }]}>{p}%</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={[styles.whatIfResult, { backgroundColor: theme.surfaceMuted }]}>
            <View style={styles.flex}>
              <Caption>Resulting course grade</Caption>
              <Row style={styles.whatIfGradeRow}>
                <Text style={[styles.whatIfPct, { color: theme.text }]}>{whatIfProjection.percent !== null ? whatIfProjection.percent.toFixed(1) : '—'}%</Text>
                {whatIfProjection.grade ? (
                  <View style={[styles.whatIfGrade, { backgroundColor: GRADE_BAND_COLORS[whatIfProjection.grade] }]}>
                    <Text style={styles.whatIfGradeText}>{whatIfProjection.grade}</Text>
                  </View>
                ) : null}
              </Row>
            </View>
            <Meta style={{ maxWidth: 120, textAlign: 'right' }}>
              Assumes the FAT is worth its declared weight and other pending work lands at your current pace.
            </Meta>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },
  backBar: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: PAGE, paddingTop: SP.sm },

  hero: { marginTop: SP.md },
  heroTitle: { fontFamily: FONT.extrabold, fontSize: 20, letterSpacing: -0.4, marginTop: 4, lineHeight: 25 },
  heroRow: { justifyContent: 'space-between', alignItems: 'center', marginTop: SP.xl },
  heroPct: { ...mono('bold'), fontSize: 40, letterSpacing: -1.4 },
  gradeChip: { width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  gradeLetter: { ...mono('bold'), fontSize: 28 },

  targetRow: { gap: SP.sm, flexWrap: 'wrap' },
  targetChip: { flex: 1, minWidth: 52, alignItems: 'center', paddingVertical: SP.md, borderRadius: RADIUS.md, borderWidth: 1.5 },
  targetLetter: { ...mono('bold'), fontSize: 20 },
  targetScore: { ...mono('bold'), fontSize: 10.5, marginTop: 2 },

  resultCard: { marginTop: SP.md },
  resultHead: { justifyContent: 'space-between', alignItems: 'center' },
  resultFigures: { alignItems: 'center', gap: SP.md, marginTop: SP.md },
  resultBig: { ...mono('bold'), fontSize: 44, letterSpacing: -1.5 },
  resultMax: { ...mono('bold'), fontSize: 22 },
  resultPctPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill },
  cutoffRow: { gap: 6, alignItems: 'center', marginTop: SP.md },

  stepperRow: { alignItems: 'center', gap: SP.md },
  whatIfValue: { ...mono('bold'), fontSize: 28, letterSpacing: -0.8, textAlign: 'center' },
  presetRow: { gap: SP.sm, marginTop: SP.lg },
  preset: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1 },
  whatIfResult: { flexDirection: 'row', alignItems: 'center', gap: SP.md, borderRadius: RADIUS.md, padding: SP.md + 2, marginTop: SP.lg },
  whatIfGradeRow: { alignItems: 'center', gap: SP.sm, marginTop: 4 },
  whatIfPct: { ...mono('bold'), fontSize: 26, letterSpacing: -0.8 },
  whatIfGrade: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  whatIfGradeText: { color: '#fff', ...mono('bold'), fontSize: 18 },
});
