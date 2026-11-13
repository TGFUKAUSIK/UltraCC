/**
 * EventsScreen.tsx — the campus Event Hub, presented like an events app rather
 * than a list of academic cards. Posters dominate: the first event is a large
 * featured card with a dark scrim and overlaid title / date / venue, and the
 * rest are editorial poster-forward rows. Each opens the event's register URL in
 * the system browser. The public event-hub fetch and its envelope are unchanged.
 */

import React, { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../state/AppContext';
import {
  Caption,
  ErrorState,
  Meta,
  Pill,
  Row,
  ScreenHeader,
  SectionTitle,
  Skeleton,
  Tap,
} from '../components/ui';
import { fetchEvents } from '../lib/publicApi';
import { posterSources } from '../lib/eventPoster';
import { PAGE, RADIUS, SP, TYPE, FONT } from '../theme';
import type { HubEvent } from '../types';

/**
 * A poster that actually appears.
 *
 * `event.posterUrl` points at VIT's Event Hub host, which sends an incomplete
 * TLS chain — Android and iOS reject that chain outright, so a phone shows a
 * blank card where a laptop shows the poster. The event-hub function mirrors
 * every poster behind its own complete chain, and `posterSources` hands back
 * both addresses in the order to try them. Only when both fail does the card
 * fall back to the icon.
 */
function PosterImage({
  event,
  style,
  icon,
  iconSize,
}: {
  event: HubEvent;
  style: StyleProp<ViewStyle>;
  icon: keyof typeof Ionicons.glyphMap;
  iconSize: number;
}) {
  const { theme } = useApp();
  const sources = posterSources(event);
  // Failures are remembered by URL, not by position, so another event's poster
  // starting in this same slot begins from its own first address.
  const [failed, setFailed] = useState<string[]>([]);
  const uri = sources.find((url) => url && !failed.includes(url)) ?? '';
  return (
    <View style={[style, { backgroundColor: theme.surfaceMuted }]}>
      {uri ? (
        <Image
          key={uri}
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailed((list) => (list.includes(uri) ? list : [...list, uri]))}
        />
      ) : (
        <View style={styles.posterFallback}>
          <Ionicons name={icon} size={iconSize} color={theme.textMuted} />
        </View>
      )}
    </View>
  );
}

export function EventsScreen() {
  const { theme } = useApp();
  const [events, setEvents] = useState<HubEvent[] | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    setEvents(null);
    try {
      setEvents(await fetchEvents());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load events.');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (url: string) => Linking.openURL(url).catch(() => undefined);

  if (events === null && !error) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
        <ScrollView contentContainerStyle={styles.container}>
          <ScreenHeader title="Events" subtitle="Clubs, fests and workshops around campus" />
          <Skeleton width="100%" height={220} radius={RADIUS.xl} />
          <Skeleton width="60%" height={16} radius={8} style={{ marginTop: SP.xl }} />
          <Skeleton width="100%" height={92} radius={RADIUS.lg} style={{ marginTop: SP.md }} />
          <Skeleton width="100%" height={92} radius={RADIUS.lg} style={{ marginTop: SP.sm }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (error || !events?.length) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <View style={styles.emptyWrap}>
            <Ionicons name="ticket-outline" size={34} color={theme.textMuted} />
            <Text style={[TYPE.cardTitle, { color: theme.text, marginTop: SP.lg }]}>No events right now</Text>
            <Meta style={{ textAlign: 'center', marginTop: 6, paddingHorizontal: 32 }}>Check back later — clubs add events regularly.</Meta>
          </View>
        )}
      </SafeAreaView>
    );
  }

  const [featured, ...rest] = events;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Events" subtitle={`${events.length} on the campus board`} />

        {/* Featured */}
        <Tap onPress={() => open(featured.registerUrl)}>
          <View style={[styles.featured, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <PosterImage event={featured} style={styles.featuredPoster} icon="image-outline" iconSize={40} />
            <View style={styles.scrim} />
            <View style={styles.scrimBottom} />
            <View style={styles.featuredBody}>
              <Row style={styles.featuredTags}>
                <View style={styles.featuredBadge}>
                  <Text style={[TYPE.caption, { color: '#fff', textTransform: 'uppercase' }]}>Featured</Text>
                </View>
                {featured.type ? (
                  <View style={styles.featuredType}>
                    <Text style={[TYPE.caption, { color: '#fff' }]} numberOfLines={1}>{featured.type}</Text>
                  </View>
                ) : null}
              </Row>
              <Text style={styles.featuredTitle} numberOfLines={2}>{featured.title}</Text>
              <Row style={styles.featuredMeta}>
                <Ionicons name="calendar-outline" size={14} color="rgba(255,255,255,0.85)" />
                <Text style={styles.featuredMetaText} numberOfLines={1}>{featured.date}</Text>
                {featured.location ? (
                  <>
                    <Ionicons name="location-outline" size={14} color="rgba(255,255,255,0.85)" style={{ marginLeft: 10 }} />
                    <Text style={styles.featuredMetaText} numberOfLines={1}>{featured.location}</Text>
                  </>
                ) : null}
              </Row>
            </View>
          </View>
        </Tap>

        {/* Upcoming */}
        {rest.length ? (
          <>
            <SectionTitle>More events</SectionTitle>
            {rest.map((event) => (
              <Pressable
                key={event.eid}
                onPress={() => open(event.registerUrl)}
                android_ripple={{ color: theme.surfaceMuted }}
                style={[styles.eventRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <PosterImage event={event} style={styles.eventThumb} icon="ticket-outline" iconSize={22} />
                <View style={styles.eventBody}>
                  <Text style={[TYPE.bodyStrong, { color: theme.text }]} numberOfLines={2}>{event.title}</Text>
                  <Row style={styles.eventMetaRow}>
                    <Ionicons name="calendar-outline" size={12} color={theme.textMuted} />
                    <Caption numberOfLines={1}>{event.date}</Caption>
                  </Row>
                  {event.location ? (
                    <Row style={styles.eventMetaRow}>
                      <Ionicons name="location-outline" size={12} color={theme.textMuted} />
                      <Caption numberOfLines={1}>{event.location}</Caption>
                    </Row>
                  ) : null}
                  <Row style={styles.eventPills}>
                    {event.price ? <Pill label={event.price} tone="muted" /> : null}
                    {event.teamSize ? <Pill label={`Team ${event.teamSize}`} tone="muted" /> : null}
                  </Row>
                </View>
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },

  featured: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', height: 260 },
  featuredPoster: { width: '100%', height: '100%', overflow: 'hidden' },
  posterFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(6,10,22,0.25)' },
  scrimBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%', backgroundColor: 'rgba(6,10,22,0.55)' },
  featuredBody: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: SP.xl },
  featuredTags: { gap: SP.sm, marginBottom: SP.sm },
  featuredBadge: { backgroundColor: '#2d5bff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill },
  featuredType: { backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill, maxWidth: 180 },
  featuredTitle: { color: '#fff', fontFamily: FONT.extrabold, fontSize: 22, letterSpacing: -0.4, lineHeight: 27 },
  featuredMeta: { gap: 5, alignItems: 'center', marginTop: SP.sm },
  featuredMetaText: { color: 'rgba(255,255,255,0.85)', fontFamily: FONT.medium, fontSize: 12.5, flexShrink: 1 },

  eventRow: { flexDirection: 'row', gap: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.sm, marginBottom: SP.sm, overflow: 'hidden' },
  eventThumb: { width: 78, height: 92, borderRadius: RADIUS.md, overflow: 'hidden' },
  eventBody: { flex: 1, paddingVertical: 2, paddingRight: 4 },
  eventMetaRow: { gap: 5, alignItems: 'center', marginTop: 5 },
  eventPills: { gap: 6, marginTop: SP.sm, flexWrap: 'wrap' },
});
