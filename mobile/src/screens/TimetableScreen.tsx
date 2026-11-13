/**
 * TimetableScreen.tsx — a real mobile schedule, not a list of cards.
 *
 * A horizontal day picker drives a vertical timeline for the selected day. The
 * class in session right now is rendered on the ink hero surface and dominates;
 * finished classes are dimmed; a 2-period lab visibly occupies more vertical
 * space than a 1-period theory class (its height is derived from the real
 * duration). Compact metadata carries course, title, slot, venue and type.
 *
 * Lab-session combining already happened upstream in the data layer.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../state/AppContext';
import {
  Badge,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  InkPanel,
  InkTag,
  Meta,
  Pill,
  Row,
} from '../components/ui';
import { isLabSession, sessionDurationMinutes, slotTimeToMinutes } from '../utils/labSessions';
import { PAGE, RADIUS, SP, TYPE, mono, FONT } from '../theme';
import type { TimetableSlot, Weekday } from '../types';

const DAY_ORDER: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT: Record<string, string> = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };

type SlotState = 'past' | 'current' | 'future';

export function TimetableScreen() {
  const { theme, data } = useApp();
  const slots = data?.timetable ?? [];

  const now = new Date();
  const today = DAY_ORDER[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const byDay = useMemo(() => {
    const map = new Map<Weekday, TimetableSlot[]>();
    for (const day of DAY_ORDER) {
      const list = slots
        .filter((s) => s.day === day)
        .sort((a, b) => (slotTimeToMinutes(a.startTime) ?? 0) - (slotTimeToMinutes(b.startTime) ?? 0));
      if (list.length) map.set(day, list);
    }
    return map;
  }, [slots]);

  const [day, setDay] = useState<Weekday>(() => (byDay.has(today) ? today : (byDay.keys().next().value as Weekday) ?? today));
  const list = byDay.get(day) ?? [];

  const stateOf = (slot: TimetableSlot): SlotState => {
    if (day !== today) return 'future';
    const start = slotTimeToMinutes(slot.startTime) ?? 0;
    const end = slotTimeToMinutes(slot.endTime) ?? 0;
    if (start <= nowMin && nowMin < end) return 'current';
    if (end <= nowMin) return 'past';
    return 'future';
  };

  if (!slots.length) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        <EmptyState icon="calendar-outline" title="No timetable yet" hint="Sync from the home screen to load your class schedule." />
      </SafeAreaView>
    );
  }

  const activeDays = DAY_ORDER.filter((d) => byDay.has(d));

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.picker}>
        <ChipRow>
          {DAY_ORDER.map((d) => {
            const has = byDay.has(d);
            const selected = d === day;
            return (
              <View key={d} style={[!has && styles.dimChip]}>
                <Chip
                  label={has || selected ? SHORT[d] : SHORT[d]}
                  selected={selected}
                  count={d === today ? undefined : byDay.get(d)?.length}
                  onPress={() => setDay(d)}
                />
              </View>
            );
          })}
        </ChipRow>
      </View>

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Row style={styles.dayHead}>
          <Text style={[TYPE.screenTitle, { color: theme.text, fontSize: 22 }]}>{day}</Text>
          {day === today ? <Badge tone="accent">Today</Badge> : <Meta>{list.length} classes</Meta>}
        </Row>

        {list.length === 0 ? (
          <EmptyState icon="cafe-outline" title="No classes" hint={`Nothing scheduled on ${day}.`} />
        ) : (
          list.map((slot, i) => {
            const state = stateOf(slot);
            const minutes = sessionDurationMinutes(slot) ?? 50;
            const isLab = isLabSession(slot);
            const railHeight = Math.max(58, Math.round((minutes / 50) * 58));
            const last = i === list.length - 1;

            if (state === 'current') {
              return (
                <View key={slot.id} style={styles.node}>
                  <TimeGutter slot={slot} accent />
                  <View style={styles.railCol}>
                    <View style={[styles.railDot, { backgroundColor: theme.accent, borderColor: theme.accent, width: 14, height: 14, borderRadius: 7 }]} />
                    {!last ? <View style={[styles.railLine, { backgroundColor: theme.accent, height: railHeight }]} /> : null}
                  </View>
                  <View style={styles.flex}>
                    <InkPanel glow={isLab ? 'info' : 'accent'} style={styles.inkCard}>
                      <Row style={styles.inkTop}>
                        <InkTag tone="live" label="In session" />
                        <Text style={[TYPE.caption, { color: theme.onInkMuted }]}>{slot.startTime} – {slot.endTime}</Text>
                      </Row>
                      <Text style={[styles.inkTitle, { color: theme.onInk }]} numberOfLines={2}>{slot.courseTitle}</Text>
                      <Row style={styles.inkMeta}>
                        <Ionicons name="location-outline" size={14} color={theme.onInkMuted} />
                        <Text style={[TYPE.meta, { color: theme.onInkMuted }]}>{slot.venue || slot.building || 'Venue TBA'}</Text>
                      </Row>
                      <Row style={styles.inkTags}>
                        <View style={[styles.inkPill, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
                          <Text style={[TYPE.caption, { color: theme.onInk }]}>{slot.courseCode}</Text>
                        </View>
                        <View style={[styles.inkPill, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
                          <Text style={[TYPE.caption, { color: theme.onInk }]}>Slot {slot.slot}</Text>
                        </View>
                        <View style={[styles.inkPill, { backgroundColor: isLab ? theme.info : 'rgba(255,255,255,0.12)' }]}>
                          <Text style={[TYPE.caption, { color: theme.onInk }]}>{isLab ? 'Lab' : 'Theory'}</Text>
                        </View>
                      </Row>
                    </InkPanel>
                  </View>
                </View>
              );
            }

            const dim = state === 'past';
            return (
              <View key={slot.id} style={[styles.node, dim && styles.dimNode]}>
                <TimeGutter slot={slot} />
                <View style={styles.railCol}>
                  <View style={[styles.railDot, { backgroundColor: dim ? theme.borderStrong : theme.surface, borderColor: dim ? theme.borderStrong : theme.borderStrong }]} />
                  {!last ? <View style={[styles.railLine, { backgroundColor: theme.border, height: railHeight }]} /> : null}
                </View>
                <View style={styles.flex}>
                  <Card style={[styles.classCard, isLab && { borderLeftWidth: 3, borderLeftColor: theme.info }]}>
                    <Row style={styles.classHead}>
                      <Text style={[styles.classTitle, { color: theme.text }]} numberOfLines={1}>{slot.courseTitle}</Text>
                      {isLab ? <Pill label="Lab" tone="info" icon="flask-outline" /> : null}
                    </Row>
                    <Meta numberOfLines={1}>{slot.courseCode} · Slot {slot.slot}</Meta>
                    {slot.venue || slot.building ? (
                      <Row style={styles.venueRow}>
                        <Ionicons name="location-outline" size={13} color={theme.textMuted} />
                        <Text style={[TYPE.meta, { color: theme.textMuted }]} numberOfLines={1}>{slot.venue || slot.building}</Text>
                      </Row>
                    ) : null}
                  </Card>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TimeGutter({ slot, accent }: { slot: TimetableSlot; accent?: boolean }) {
  const { theme } = useApp();
  return (
    <View style={styles.gutter}>
      <Text style={[styles.gutterStart, { color: accent ? theme.accent : theme.text }]}>{slot.startTime}</Text>
      <Text style={[styles.gutterEnd, { color: theme.textMuted }]}>{slot.endTime}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingTop: SP.lg, paddingBottom: SP.xxl + 16 },
  picker: { paddingTop: SP.md, paddingBottom: SP.xs },
  dimChip: { opacity: 0.45 },

  dayHead: { justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.lg },

  node: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.sm },
  dimNode: { opacity: 0.5 },
  gutter: { width: 50, paddingTop: 2, alignItems: 'flex-end' },
  gutterStart: { ...mono('bold'), fontSize: 13.5, letterSpacing: -0.2 },
  gutterEnd: { ...mono('regular'), fontSize: 11, marginTop: 1 },
  railCol: { width: 16, alignItems: 'center', paddingTop: 4 },
  railDot: { width: 11, height: 11, borderRadius: 5.5, borderWidth: 2 },
  railLine: { width: 2, marginTop: 3, borderRadius: 1 },

  classCard: { paddingVertical: SP.md, borderRadius: RADIUS.md },
  classHead: { justifyContent: 'space-between', gap: SP.sm, marginBottom: 3 },
  classTitle: { fontFamily: FONT.bold, fontSize: 15, flexShrink: 1, letterSpacing: -0.2 },
  venueRow: { gap: 5, marginTop: 5 },

  inkCard: { marginTop: 0 },
  inkTop: { justifyContent: 'space-between', marginBottom: SP.md },
  inkTitle: { fontFamily: FONT.extrabold, fontSize: 19, letterSpacing: -0.4, lineHeight: 24 },
  inkMeta: { gap: 6, marginTop: SP.sm },
  inkTags: { gap: SP.sm, marginTop: SP.md, flexWrap: 'wrap' },
  inkPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: RADIUS.pill },
});
