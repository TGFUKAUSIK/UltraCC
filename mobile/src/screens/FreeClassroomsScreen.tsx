/**
 * FreeClassroomsScreen.tsx — which rooms and labs are empty at a chosen
 * day × period, answered on the phone exactly as the web answers it.
 *
 * Occupancy is computed by utils/roomAvailability.ts from two things the app
 * ships with: the authoritative Chennai FFCS slot grid (periods and slot→time,
 * theory AND lab slots) and the FFCS course catalogue (every VENUE + SLOT pair
 * the semester schedules). The student's own synced timetable is unioned on top.
 * The parity of that engine with the web's is enforced by
 * src/lib/__tests__/mobileRoomAvailability.test.ts, so a room cannot read free
 * here and busy there.
 *
 * It is a planning guide, not a room sensor: a room with no scheduled class can
 * still be occupied, and the copy says so.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  Row,
  ScreenHeader,
  SectionTitle,
} from '../components/ui';
import {
  allKnownRooms,
  catalogueOccupiedRooms,
  currentPeriodIndex,
  isLabRoom,
  occupiedRoomsForPeriod,
  periodsForDay,
  roomBlock,
  ROOM_DAYS,
  type RoomDay,
} from '../utils/roomAvailability';
import { PAGE, RADIUS, SP, TYPE, mono, FONT } from '../theme';

/** Today as a grid day id, in the phone's own timezone. */
function todayId(): string {
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return names[new Date().getDay()];
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function FreeClassroomsScreen() {
  const { theme, data } = useApp();
  const timetable = data?.timetable ?? [];

  const today = todayId();
  const scheduledToday = ROOM_DAYS.some((d) => d.id === today);

  const [day, setDay] = useState<RoomDay>((scheduledToday ? today : 'mon') as RoomDay);
  const [periodIdx, setPeriodIdx] = useState<number>(() => {
    const idx = scheduledToday ? currentPeriodIndex(today as RoomDay, nowMinutes()) : -1;
    return idx >= 0 ? idx : 0;
  });
  const [block, setBlock] = useState('All');
  const [query, setQuery] = useState('');
  const [clock, setClock] = useState(nowMinutes);

  // Keep the "now" marker honest while the screen is open.
  useEffect(() => {
    const t = setInterval(() => setClock(nowMinutes()), 60_000);
    return () => clearInterval(t);
  }, []);

  const periods = useMemo(() => periodsForDay(day), [day]);
  const period = periods[periodIdx];

  const rooms = useMemo(() => allKnownRooms(timetable.map((s) => s.venue || '')), [timetable]);

  const { occupied, freeByBlock } = useMemo(() => {
    const busy = new Set<string>();
    if (period) {
      for (const r of occupiedRoomsForPeriod(timetable.map((s) => ({ slot: s.slot, venue: s.venue })), day, periodIdx)) busy.add(r);
      for (const r of catalogueOccupiedRooms(day, periodIdx)) busy.add(r);
    }
    const free: Record<string, string[]> = {};
    for (const room of rooms) {
      if (busy.has(room)) continue;
      const b = roomBlock(room);
      (free[b] ??= []).push(room);
    }
    for (const b of Object.keys(free)) free[b].sort((a, b2) => a.localeCompare(b2, undefined, { numeric: true }));
    return { occupied: busy, freeByBlock: free };
  }, [rooms, timetable, day, periodIdx, period]);

  const allFree = useMemo(() => Object.values(freeByBlock).flat(), [freeByBlock]);
  const totalFree = allFree.length;
  const freeLabs = allFree.filter((r) => isLabRoom(r)).length;

  const blocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = Object.keys(freeByBlock).sort();
    if (block !== 'All') list = list.filter((b) => b === block);
    if (q) list = list.filter((b) => freeByBlock[b].some((r) => r.toLowerCase().includes(q)));
    return list;
  }, [freeByBlock, block, query]);

  const jumpToNow = () => {
    const d = todayId() as RoomDay;
    const mins = nowMinutes();
    setClock(mins);
    if (ROOM_DAYS.some((x) => x.id === d)) {
      setDay(d);
      const idx = currentPeriodIndex(d, mins);
      setPeriodIdx(idx >= 0 ? idx : 0);
    }
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Free classrooms"
          subtitle={period ? `${ROOM_DAYS.find((d) => d.id === day)?.label} · ${period.start}–${period.end}` : 'Pick a day and period'}
          right={scheduledToday ? (
            <Pressable onPress={jumpToNow} hitSlop={6} style={[styles.nowBtn, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="locate-outline" size={15} color={theme.accent} />
              <Text style={[TYPE.caption, { color: theme.accentInk, fontFamily: FONT.extrabold }]}>Now</Text>
            </Pressable>
          ) : undefined}
        />

        <InkPanel glow="success" style={styles.hero}>
          <Caption style={{ color: theme.onInkMuted }}>Rooms free in this period</Caption>
          <Row style={styles.heroRow}>
            <Text style={[styles.heroNum, { color: theme.onInk }]}>{totalFree}</Text>
            <View style={styles.heroStats}>
              <HeroLine label="Theory rooms" value={totalFree - freeLabs} theme={theme} />
              <HeroLine label="Labs" value={freeLabs} theme={theme} />
              <HeroLine label="Busy this period" value={occupied.size} theme={theme} />
            </View>
          </Row>
        </InkPanel>

        <SectionTitle>Day</SectionTitle>
        <ChipRow>
          {ROOM_DAYS.map((d) => (
            <Chip
              key={d.id}
              label={d.label.slice(0, 3) + (d.id === today ? ' · today' : '')}
              selected={d.id === day}
              onPress={() => { setDay(d.id); setPeriodIdx(0); }}
            />
          ))}
        </ChipRow>

        {periods.length === 0 ? (
          <Card style={styles.emptyPeriods}>
            <Meta>No periods are published for this day, so there is nothing to plan against.</Meta>
          </Card>
        ) : (
          <>
            <SectionTitle>Period</SectionTitle>
            <ChipRow>
              {periods.map((p, i) => {
                const isNow = day === today && clock >= p.startMin && clock <= p.endMin;
                return (
                  <Chip
                    key={p.idx}
                    label={isNow ? `${p.start}–${p.end} · now` : `${p.start}–${p.end}`}
                    selected={i === periodIdx}
                    onPress={() => setPeriodIdx(i)}
                  />
                );
              })}
            </ChipRow>
          </>
        )}

        <View style={styles.searchWrap}>
          <View style={[styles.searchBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="search-outline" size={17} color={theme.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              placeholder="Search a room, e.g. 203 or COMPLAB"
              placeholderTextColor={theme.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={17} color={theme.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <ChipRow style={styles.blockChips}>
          {['All', ...Object.keys(freeByBlock).sort()].map((b) => (
            <Chip
              key={b}
              label={b}
              count={b === 'All' ? totalFree : freeByBlock[b]?.length}
              selected={b === block}
              onPress={() => setBlock(b)}
            />
          ))}
        </ChipRow>

        {!rooms.length ? (
          <EmptyState
            icon="business-outline"
            title="No room data"
            hint="The room list ships with the FFCS catalogue, so this only happens if the app resources did not load. Reopen the screen, then sync again."
          />
        ) : blocks.length === 0 ? (
          <EmptyState
            icon="business-outline"
            title="Nothing free in this slot"
            hint="Every room matching this filter has a class scheduled. Try another period or clear the search."
            action={{ label: 'Reset filters', onPress: () => { setBlock('All'); setQuery(''); } }}
          />
        ) : (
          blocks.map((b) => {
            const q = query.trim().toLowerCase();
            const inBlock = q ? freeByBlock[b].filter((r) => r.toLowerCase().includes(q)) : freeByBlock[b];
            if (!inBlock.length) return null;
            return (
              <Card key={b} style={styles.blockCard}>
                <Row style={styles.blockHead}>
                  <View style={styles.flex}>
                    <Text style={[styles.blockName, { color: theme.text }]}>{b}</Text>
                    <Meta>{b === 'Other' ? 'No building prefix' : 'Academic block'}</Meta>
                  </View>
                  <Badge tone="success">{inBlock.length} free</Badge>
                </Row>
                <View style={styles.roomWrap}>
                  {inBlock.map((room) => (
                    <Text
                      key={room}
                      style={[styles.roomChip, { backgroundColor: theme.successSoft, color: theme.success }]}
                    >
                      {isLabRoom(room) ? `${room.replace(`${b}-`, '')} · lab` : room.replace(`${b}-`, '')}
                    </Text>
                  ))}
                </View>
              </Card>
            );
          })
        )}

        {occupied.size > 0 && period ? (
          <>
            <SectionTitle>Busy right now · {occupied.size}</SectionTitle>
            <View style={styles.occWrap}>
              {[...occupied].sort().map((room) => (
                <Text key={room} style={[styles.occChip, { backgroundColor: theme.surfaceMuted, color: theme.textSecondary }]}>
                  {room}
                </Text>
              ))}
            </View>
          </>
        ) : null}

        <View style={[styles.footNote, { backgroundColor: theme.surfaceMuted }]}>
          <Caption>What this is, and what it is not</Caption>
          <Meta style={{ marginTop: 4, lineHeight: 19 }}>
            A room shows free when no class is scheduled in it for that period — across the whole FFCS course catalogue plus your own timetable. There is no sensor on the door, so a room can still be in use. The 13:25–14:00 lunch break has no classes at all.
          </Meta>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HeroLine({ label, value, theme }: { label: string; value: number; theme: ReturnType<typeof useApp>['theme'] }) {
  return (
    <Row style={styles.heroLine}>
      <Text style={[TYPE.caption, { color: theme.onInkMuted, flex: 1 }]}>{label}</Text>
      <Text style={[TYPE.bodyStrong, { color: theme.onInk }]}>{value}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },

  nowBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: '#e2e8ff' },

  hero: { marginTop: SP.xs },
  heroRow: { alignItems: 'center', gap: SP.lg, marginTop: SP.xs },
  heroNum: { ...mono('bold'), fontSize: 54, letterSpacing: -2, lineHeight: 60 },
  heroStats: { flex: 1, gap: SP.sm },
  heroLine: { gap: SP.sm, alignItems: 'center' },

  emptyPeriods: { marginTop: SP.md },

  searchWrap: { marginTop: SP.lg },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  searchInput: { flex: 1, fontFamily: FONT.semibold, fontSize: 14, paddingVertical: 2 },

  blockChips: { marginTop: SP.md },

  blockCard: { marginTop: SP.sm },
  blockHead: { gap: SP.md, alignItems: 'center', marginBottom: SP.md },
  blockName: { fontFamily: FONT.extrabold, fontSize: 15, letterSpacing: -0.3 },

  roomWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  roomChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.xs, fontSize: 12.5, fontFamily: FONT.bold },

  occWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SP.sm },
  occChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: RADIUS.xs, fontSize: 11.5, fontFamily: FONT.semibold },

  footNote: { borderRadius: RADIUS.md, padding: SP.lg, marginTop: SP.xl },
});
