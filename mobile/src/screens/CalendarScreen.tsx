/**
 * CalendarScreen.tsx — the VIT academic calendar rendered as a month-grouped
 * timeline. Each day shows its instructional status, day order and holiday
 * label straight from VTOP; today is highlighted. Nothing is invented.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import {
  Badge,
  Card,
  EmptyState,
  ScreenHeader,
  SectionTitle,
} from '../components/ui';
import { istDateLabel } from '../utils/examUtils';
import { PAGE, RADIUS, SP, TYPE, FONT } from '../theme';
import type { CalendarDay } from '../types';

export function CalendarScreen() {
  const { theme, data } = useApp();
  const calendar = data?.calendar;
  const today = istDateLabel();

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarDay[]>();
    for (const day of calendar?.days ?? []) {
      const month = day.date.slice(0, 7);
      const list = map.get(month) ?? [];
      list.push(day);
      map.set(month, list);
    }
    return map;
  }, [calendar]);

  if (!calendar || !calendar.available || !calendar.days.length) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        <EmptyState icon="today-outline" title="No calendar data" hint="The academic calendar appears here once synced." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Calendar" subtitle="Academic instructional days" />

        {[...grouped.entries()].map(([month, days]) => (
          <View key={month}>
            <SectionTitle>{monthLabel(month)}</SectionTitle>
            <Card pad={0}>
              {days.map((day, i) => {
                const isToday = day.date === today;
                const isHoliday = !day.instructional;
                const dot = isToday ? theme.accent : isHoliday ? theme.warning : theme.success;
                return (
                  <View
                    key={day.date}
                    style={[
                      styles.row,
                      { borderBottomColor: theme.border },
                      i === days.length - 1 && { borderBottomWidth: 0 },
                      isToday && { backgroundColor: theme.accentSoft },
                    ]}
                  >
                    <View style={styles.dateCol}>
                      <Text style={[TYPE.stat, { color: isToday ? theme.accent : theme.text, fontSize: 18 }]}>{day.date.slice(8)}</Text>
                      <Text style={[TYPE.caption, { color: theme.textMuted }]}>{weekday(day.date)}</Text>
                    </View>
                    <View style={[styles.rail, { alignSelf: 'stretch' }]}>
                      <View style={[styles.dot, { backgroundColor: dot }, isToday && styles.dotToday]} />
                      {i < days.length - 1 ? <View style={[styles.line, { backgroundColor: theme.border }]} /> : null}
                    </View>
                    <View style={styles.flex}>
                      <Text style={[TYPE.body, { color: theme.text, fontFamily: isToday ? FONT.bold : FONT.semibold }]} numberOfLines={1}>
                        {day.label || (day.instructional ? 'Instructional day' : 'Holiday')}
                      </Text>
                      {day.dayOrder ? <Text style={[TYPE.meta, { color: theme.textMuted, marginTop: 2 }]}>{day.dayOrder}</Text> : null}
                    </View>
                    {isToday ? <Badge tone="accent">Today</Badge> : isHoliday ? <Badge tone="warning">Holiday</Badge> : null}
                  </View>
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function monthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function weekday(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.md, paddingHorizontal: SP.lg, borderBottomWidth: StyleSheet.hairlineWidth, gap: SP.md },
  dateCol: { width: 34, alignItems: 'center' },
  rail: { width: 16, alignItems: 'center' },
  dot: { width: 9, height: 9, borderRadius: 4.5, marginTop: 6 },
  dotToday: { width: 12, height: 12, borderRadius: 6 },
  line: { width: 2, flex: 1, marginTop: 3, borderRadius: 1 },
});
