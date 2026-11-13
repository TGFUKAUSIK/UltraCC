/**
 * ui.tsx — the UltraCC mobile design system: every shared building block the
 * screens compose from. It exposes five surface LEVELS (ink hero, elevated,
 * standard, muted, sunken), a full typography hierarchy, animated data-viz
 * primitives (progress, threshold gauge), timeline rails, chips, segmented
 * controls, native list rows and designed loading / empty / error states.
 *
 * Everything reads the active theme from context, so light and dark stay in sync
 * and no screen hard-codes a colour.
 */

import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../state/AppContext';
import {
  elevation,
  FONT,
  MONO,
  mono,
  PAGE,
  RADIUS,
  SP,
  TYPE,
  type ElevationLevel,
  type Theme,
} from '../theme';

export type IoniconName = keyof typeof Ionicons.glyphMap;

/* ---------------------------------- tones --------------------------------- */

export type Tone = 'accent' | 'secondary' | 'gold' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export interface ToneColor {
  fg: string;
  bg: string;
  border: string;
}

export function toneColors(theme: Theme, tone: Tone): ToneColor {
  switch (tone) {
    case 'accent': return { fg: theme.accent, bg: theme.accentSoft, border: theme.accent };
    case 'secondary': return { fg: theme.secondary, bg: theme.secondarySoft, border: theme.secondary };
    case 'gold': return { fg: theme.gold, bg: theme.goldSoft, border: theme.gold };
    case 'success': return { fg: theme.success, bg: theme.successSoft, border: theme.success };
    case 'warning': return { fg: theme.warning, bg: theme.warningSoft, border: theme.warning };
    case 'danger': return { fg: theme.danger, bg: theme.dangerSoft, border: theme.danger };
    case 'info': return { fg: theme.info, bg: theme.infoSoft, border: theme.info };
    case 'muted': return { fg: theme.textSecondary, bg: theme.surfaceMuted, border: theme.border };
  }
}

/** Convenience shadow for a card at a given level. */
export function cardShadow(theme: Theme, level: ElevationLevel = 1): ViewStyle {
  return elevation(theme, level) as ViewStyle;
}

/* ------------------------------- typography ------------------------------- */

type TextProps = { children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number };

function makeText(key: keyof typeof TYPE, defaultColor: (t: Theme) => string) {
  return function TypeText({ children, style, numberOfLines }: TextProps) {
    const { theme } = useApp();
    const t = TYPE[key];
    return (
      <Text numberOfLines={numberOfLines} style={[t, { color: defaultColor(theme) }, style]}>
        {children}
      </Text>
    );
  };
}

export const Display = makeText('display', (t) => t.text);
export const ScreenTitle = makeText('screenTitle', (t) => t.text);
export const CardTitle = makeText('cardTitle', (t) => t.text);
export const Body = makeText('body', (t) => t.textSecondary);
export const BodyStrong = makeText('bodyStrong', (t) => t.text);
export const Meta = makeText('meta', (t) => t.textMuted);
export const Caption = makeText('caption', (t) => t.textMuted);

/**
 * A figure — a time, a room, a slot, a course code, a mark, a percentage. The
 * board sets every one of those in JetBrains Mono with tabular figures, so a
 * column of them lines up; pass it a size and colour and it stays a figure.
 */
export function Num({ children, style, numberOfLines, weight = 'medium' }: TextProps & { weight?: keyof typeof MONO }) {
  const { theme } = useApp();
  return (
    <Text numberOfLines={numberOfLines} style={[mono(weight), { color: theme.text }, style]}>
      {children}
    </Text>
  );
}

/** Uppercase, letter-spaced section label with an optional trailing action. */
export function SectionTitle({ children, action, style }: { children: React.ReactNode; action?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  return (
    <View style={[styles.sectionHead, style]}>
      <Text style={[TYPE.sectionTitle, { color: theme.textMuted, textTransform: 'uppercase' }]}>{children}</Text>
      {action}
    </View>
  );
}

/* -------------------------------- surfaces -------------------------------- */

/** The standard raised content panel. */
export function Card({ children, style, level = 1, pad = SP.lg }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; level?: ElevationLevel; pad?: number }) {
  const { theme } = useApp();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, padding: pad }, cardShadow(theme, level), style]}>
      {children}
    </View>
  );
}

/** A recessed secondary block (muted surface, no shadow). */
export function MutedBlock({ children, style, pad = SP.md }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; pad?: number }) {
  const { theme } = useApp();
  return <View style={[styles.mutedBlock, { backgroundColor: theme.surfaceMuted, padding: pad }, style]}>{children}</View>;
}

/** The deepest well — used for tracks and insets. */
export function Sunken({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  return <View style={[styles.sunken, { backgroundColor: theme.surfaceSunken }, style]}>{children}</View>;
}

/**
 * The signature hero surface: a deep navy "ink" panel with light type and an
 * accent glow bar. Used for the single most important element of a screen so it
 * can never be mistaken for an ordinary card. `onPress` gives it native ripple.
 */
export function InkPanel({
  children,
  style,
  onPress,
  glow = 'accent',
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  glow?: Tone | 'none';
}) {
  const { theme } = useApp();
  const glowColor = glow === 'none' ? 'transparent' : toneColors(theme, glow).fg;
  const body = (
    <>
      <View style={[styles.inkGlow, { backgroundColor: glowColor }]} />
      <View style={styles.inkInner}>{children}</View>
    </>
  );
  const base = [styles.ink, { backgroundColor: theme.ink, borderColor: theme.inkBorder }, style] as StyleProp<ViewStyle>;
  if (onPress) {
    return (
      <Pressable onPress={onPress} android_ripple={{ color: 'rgba(255,255,255,0.08)' }} style={({ pressed }) => [base, { opacity: pressed ? 0.94 : 1 }]}>
        {body}
      </Pressable>
    );
  }
  return <View style={base}>{body}</View>;
}

/* ------------------------------ press feedback ----------------------------- */

/** A tappable wrapper with a subtle scale-down press animation + Android ripple. */
export function Tap({ children, onPress, disabled, style, rippleColor }: { children: React.ReactNode; onPress?: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; rippleColor?: string }) {
  const { theme } = useApp();
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 8 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30 }).start();
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled}
        android_ripple={{ color: rippleColor ?? theme.surfaceSunken }}
        style={({ pressed }) => [{ opacity: pressed && !onPress ? 0.7 : 1 }]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/* ---------------------------------- layout -------------------------------- */

export function Screen({ children, scroll, style, contentStyle }: { children: React.ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  if (scroll) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.background }, style]}>
        <ScrollView contentContainerStyle={[styles.pageContent, contentStyle]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    );
  }
  return <View style={[styles.flex, { backgroundColor: theme.background }, style]}>{children}</View>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  return <View style={[styles.divider, { backgroundColor: theme.border }, style]} />;
}

/* --------------------------------- badges --------------------------------- */

export function Badge({ children, tone = 'accent', style, numeric }: { children: React.ReactNode; tone?: Tone; style?: StyleProp<ViewStyle>; numeric?: boolean }) {
  const { theme } = useApp();
  const c = toneColors(theme, tone);
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }, style]}>
      <Text style={[TYPE.caption, numeric && mono('regular'), { color: c.fg, textTransform: numeric ? 'none' : 'uppercase' }]}>{children}</Text>
    </View>
  );
}

export function Pill({ icon, label, tone = 'muted', style }: { icon?: IoniconName; label: string; tone?: Tone; style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  const c = toneColors(theme, tone);
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }, style]}>
      {icon ? <Ionicons name={icon} size={13} color={c.fg} /> : null}
      <Text style={[TYPE.caption, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/** A small solid/ghost tag used on the ink hero (light-on-dark). */
export function InkTag({ icon, label, tone }: { icon?: IoniconName; label: string; tone?: 'live' | 'plain' }) {
  const { theme } = useApp();
  const live = tone === 'live';
  return (
    <View style={[styles.inkTag, { backgroundColor: live ? theme.success : 'rgba(255,255,255,0.12)', borderColor: live ? theme.success : 'rgba(255,255,255,0.18)' }]}>
      {live ? <View style={styles.liveDot} /> : null}
      {icon && !live ? <Ionicons name={icon} size={12} color={theme.onInk} /> : null}
      <Text style={[TYPE.caption, { color: theme.onInk }]}>{label}</Text>
    </View>
  );
}

/** A rounded icon tile with a soft tone background. */
export function IconBox({ name, tone = 'accent', size = 40, iconSize, style }: { name: IoniconName; tone?: Tone; size?: number; iconSize?: number; style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  const c = toneColors(theme, tone);
  return (
    <View style={[styles.iconBox, { width: size, height: size, borderRadius: size * 0.34, backgroundColor: c.bg }, style]}>
      <Ionicons name={name} size={iconSize ?? Math.round(size * 0.5)} color={c.fg} />
    </View>
  );
}

/* --------------------------------- buttons -------------------------------- */

export function Button({ label, onPress, variant = 'primary', tone = 'accent', disabled, icon, style }: { label: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'soft'; tone?: Tone; disabled?: boolean; icon?: IoniconName; style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  const c = toneColors(theme, tone);
  const bg = variant === 'primary' ? c.fg : variant === 'soft' ? c.bg : 'transparent';
  const fg = variant === 'primary' ? theme.onAccent : variant === 'soft' ? c.fg : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: variant === 'primary' ? 'rgba(255,255,255,0.2)' : theme.surfaceSunken }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'ghost' ? theme.borderStrong : 'transparent', borderWidth: variant === 'ghost' ? 1 : 0, opacity: disabled ? 0.45 : pressed ? 0.88 : 1 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={17} color={fg} style={{ marginRight: 7 }} /> : null}
      <Text style={[TYPE.bodyStrong, { color: fg, fontSize: 15 }]}>{label}</Text>
    </Pressable>
  );
}

/** A circular icon button (headers, notification action). */
export function IconButton({ name, onPress, tone, size = 40, onInk, disabled }: { name: IoniconName; onPress?: () => void; tone?: Tone; size?: number; onInk?: boolean; disabled?: boolean }) {
  const { theme } = useApp();
  const c = tone ? toneColors(theme, tone) : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: theme.surfaceSunken }}
      style={[styles.iconButton, { width: size, height: size, borderRadius: size / 2, backgroundColor: onInk ? 'rgba(255,255,255,0.12)' : c ? c.bg : theme.surfaceMuted, borderColor: onInk ? 'transparent' : theme.border, opacity: disabled ? 0.45 : 1 }]}
    >
      <Ionicons name={name} size={Math.round(size * 0.5)} color={onInk ? theme.onInk : c ? c.fg : theme.textSecondary} />
    </Pressable>
  );
}

/* -------------------------------- data viz -------------------------------- */

export function scoreTone(percent: number): Tone {
  if (percent >= 85) return 'success';
  if (percent >= 70) return 'accent';
  if (percent >= 50) return 'warning';
  return 'danger';
}

export function barColor(theme: Theme, percent: number): string {
  return toneColors(theme, scoreTone(percent)).fg;
}

/** An animated horizontal progress bar. Width eases in on mount / change. */
export function ProgressBar({ percent, tone, height = 8, track }: { percent: number; tone?: Tone; height?: number; track?: string }) {
  const { theme } = useApp();
  const clamped = Math.max(0, Math.min(100, percent));
  const fill = tone ? toneColors(theme, tone).fg : barColor(theme, clamped);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: clamped, duration: 650, useNativeDriver: false }).start();
  }, [clamped, anim]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'], extrapolate: 'clamp' });
  return (
    <View style={[styles.track, { backgroundColor: track ?? theme.surfaceSunken, height, borderRadius: height / 2 }]}>
      <Animated.View style={[styles.fill, { width, backgroundColor: fill, borderRadius: height / 2 }]} />
    </View>
  );
}

/**
 * A threshold gauge: a progress bar with a marker at a target percentage
 * (e.g. VIT's 75% attendance rule) so the student can see how much headroom
 * remains. Everything is derived from real values — nothing is invented.
 */
export function ThresholdGauge({ percent, threshold = 75, height = 10, tone }: { percent: number; threshold?: number; height?: number; tone?: Tone }) {
  const { theme } = useApp();
  const clamped = Math.max(0, Math.min(100, percent));
  const fill = tone ? toneColors(theme, tone).fg : barColor(theme, clamped);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: clamped, duration: 700, useNativeDriver: false }).start();
  }, [clamped, anim]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'], extrapolate: 'clamp' });
  return (
    <View>
      <View style={[styles.track, { backgroundColor: theme.surfaceSunken, height, borderRadius: height / 2 }]}>
        <Animated.View style={[styles.fill, { width, backgroundColor: fill, borderRadius: height / 2 }]} />
        <View style={[styles.thresholdMark, { left: `${threshold}%`, backgroundColor: theme.text, height: height + 6 }]} />
      </View>
      <View style={styles.thresholdLabels}>
        <Text style={[TYPE.caption, mono('regular'), { color: theme.textMuted }]}>0</Text>
        <Text style={[TYPE.caption, mono('regular'), { color: theme.textSecondary, position: 'absolute', left: `${threshold}%`, transform: [{ translateX: -14 }] }]}>
          {threshold}% req
        </Text>
        <Text style={[TYPE.caption, mono('regular'), { color: theme.textMuted }]}>100</Text>
      </View>
    </View>
  );
}

/** A compact big-number stat with a label — used across dashboards. */
export function StatBlock({ value, label, sub, tone, align = 'left', style }: { value: string; label: string; sub?: string; tone?: Tone; align?: 'left' | 'center'; style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  const c = tone ? toneColors(theme, tone) : null;
  return (
    <View style={[styles.statBlock, { alignItems: align === 'center' ? 'center' : 'flex-start' }, style]}>
      <Text style={[TYPE.stat, mono('bold'), { color: c ? c.fg : theme.text }]} numberOfLines={1}>{value}</Text>
      <Text style={[TYPE.caption, { color: theme.textMuted, marginTop: 3, textTransform: 'uppercase' }]}>{label}</Text>
      {sub ? <Text style={[TYPE.meta, mono('regular'), { color: theme.textSecondary, marginTop: 2 }]}>{sub}</Text> : null}
    </View>
  );
}

/* -------------------------------- timeline -------------------------------- */

/**
 * A vertical timeline rail: a node dot (state-coloured) plus the connector line
 * to the next node. Screens place their content beside it.
 */
export function TimelineNode({ state, isLast, children, style }: { state: 'done' | 'current' | 'future' | 'none'; isLast: boolean; children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  const dotColor = state === 'current' ? theme.accent : state === 'done' ? theme.borderStrong : theme.surface;
  const dotBorder = state === 'current' ? theme.accent : state === 'done' ? theme.borderStrong : theme.borderStrong;
  return (
    <View style={[styles.timelineRow, style]}>
      <View style={styles.timelineRail}>
        <View style={[styles.timelineDot, { backgroundColor: dotColor, borderColor: dotBorder }, state === 'current' && styles.timelineDotCurrent]} />
        {!isLast ? <View style={[styles.timelineLine, { backgroundColor: theme.border }]} /> : null}
      </View>
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

/* ------------------------------ screen header ----------------------------- */

export function ScreenHeader({ title, subtitle, right, compact }: { title: string; subtitle?: string; right?: React.ReactNode; compact?: boolean }) {
  const { theme } = useApp();
  return (
    <View style={[styles.header, compact && { marginBottom: 2 }]}>
      <View style={styles.flex}>
        <Text style={[TYPE.screenTitle, { color: theme.text }]}>{title}</Text>
        {subtitle ? <Text style={[TYPE.meta, { color: theme.textMuted, marginTop: 3 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/* ---------------------------- segmented control --------------------------- */

export interface SegOption<T extends string> {
  value: T;
  label: string;
  icon?: IoniconName;
}

export function SegmentedControl<T extends string>({ options, value, onChange, style }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.surfaceSunken }, style]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.segment, active && { backgroundColor: theme.surface }, active && cardShadow(theme, 1)]}
          >
            {opt.icon ? <Ionicons name={opt.icon} size={15} color={active ? theme.accent : theme.textMuted} /> : null}
            <Text style={[TYPE.body, { color: active ? theme.text : theme.textMuted, fontFamily: active ? FONT.bold : FONT.semibold }]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* --------------------------------- chips ---------------------------------- */

export function Chip({ label, selected, onPress, count }: { label: string; selected: boolean; onPress: () => void; count?: number }) {
  const { theme } = useApp();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.surfaceSunken }}
      style={[styles.chip, { backgroundColor: selected ? theme.accent : theme.surface, borderColor: selected ? theme.accent : theme.border }]}
    >
      <Text style={[TYPE.meta, { color: selected ? theme.onAccent : theme.textSecondary, fontFamily: selected ? FONT.bold : FONT.medium }]}>{label}</Text>
      {count !== undefined ? (
        <Text style={[TYPE.caption, { color: selected ? theme.onAccent : theme.textMuted, marginLeft: 5 }]}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

export function ChipRow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, style]}>
      {children}
    </ScrollView>
  );
}

/* ------------------------------- native rows ------------------------------ */

/** A native-style settings/list row: leading icon, title, optional value + control. */
export function SettingsRow({ icon, title, value, onPress, right, tone, last }: { icon?: IoniconName; title: string; value?: string; onPress?: () => void; right?: React.ReactNode; tone?: Tone; last?: boolean }) {
  const { theme } = useApp();
  const c = tone ? toneColors(theme, tone) : null;
  const content = (
    <View style={[styles.settingsRow, !last && styles.settingsRowBorder, { borderBottomColor: theme.border }]}>
      {icon ? (
        <View style={[styles.settingsIcon, { backgroundColor: c ? c.bg : theme.surfaceMuted }]}>
          <Ionicons name={icon} size={17} color={c ? c.fg : theme.textSecondary} />
        </View>
      ) : null}
      <View style={styles.flex}>
        <Text style={[TYPE.body, { color: theme.text, fontFamily: FONT.semibold }]}>{title}</Text>
        {value ? <Text style={[TYPE.meta, { color: theme.textMuted, marginTop: 2 }]} numberOfLines={1}>{value}</Text> : null}
      </View>
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={18} color={theme.textMuted} /> : null}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} android_ripple={{ color: theme.surfaceMuted }}>
        {content}
      </Pressable>
    );
  }
  return content;
}

/** Group a set of rows into one bordered, rounded container. */
export function RowGroup({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  return (
    <View style={[styles.rowGroup, { backgroundColor: theme.surface, borderColor: theme.border }, cardShadow(theme, 1), style]}>
      {children}
    </View>
  );
}

/* --------------------------------- states --------------------------------- */

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const { theme } = useApp();
  return (
    <View style={[styles.flex, styles.center]}>
      <ActivityIndicator color={theme.accent} size="large" />
      <Text style={[TYPE.meta, { color: theme.textMuted, marginTop: 14 }]}>{label}</Text>
    </View>
  );
}

/** Skeleton blocks that pulse — used instead of spinners for content shells. */
export function Skeleton({ width, height = 14, radius = 7, style }: { width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { theme } = useApp();
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ width: width ?? '100%', height, borderRadius: radius, backgroundColor: theme.skeleton, opacity }, style]} />;
}

/** A full-card skeleton used while a screen's first data is in flight. */
export function SkeletonCard({ lines = 3, height = 96 }: { lines?: number; height?: number }) {
  const { theme } = useApp();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, minHeight: height }]}>
      <Skeleton width="45%" height={16} radius={8} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={`${90 - i * 15}%`} height={11} radius={6} style={{ marginTop: 10 }} />
      ))}
    </View>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: IoniconName; title: string; hint?: string; action?: { label: string; onPress: () => void } }) {
  const { theme } = useApp();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
        <Ionicons name={icon} size={30} color={theme.textMuted} />
      </View>
      <Text style={[TYPE.cardTitle, { color: theme.text, marginTop: 16, textAlign: 'center' }]}>{title}</Text>
      {hint ? <Text style={[TYPE.meta, { color: theme.textMuted, textAlign: 'center', marginTop: 7, lineHeight: 19, paddingHorizontal: 12 }]}>{hint}</Text> : null}
      {action ? <Button label={action.label} onPress={action.onPress} style={{ marginTop: 22, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { theme } = useApp();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSoft, borderColor: 'transparent' }]}>
        <Ionicons name="cloud-offline-outline" size={28} color={theme.danger} />
      </View>
      <Text style={[TYPE.cardTitle, { color: theme.text, marginTop: 16, textAlign: 'center' }]}>Something went wrong</Text>
      <Text style={[TYPE.meta, { color: theme.textMuted, textAlign: 'center', marginTop: 7, lineHeight: 19, paddingHorizontal: 12 }]}>{message}</Text>
      {onRetry ? <Button label="Try again" onPress={onRetry} variant="soft" tone="danger" style={{ marginTop: 22, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  pageContent: { padding: PAGE, paddingBottom: SP.xxl + 16 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.xl, marginBottom: SP.md },

  card: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.lg },
  mutedBlock: { borderRadius: RADIUS.md },
  sunken: { borderRadius: RADIUS.md },

  ink: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  inkGlow: { position: 'absolute', top: -40, right: -30, width: 150, height: 150, borderRadius: 75, opacity: 0.28 },
  inkInner: { padding: SP.xl },

  divider: { height: StyleSheet.hairlineWidth, width: '100%' },

  badge: { borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 4, alignSelf: 'flex-start' },
  pill: { borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 4.5, flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  inkTag: { borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff' },

  iconBox: { alignItems: 'center', justifyContent: 'center' },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  button: { borderRadius: RADIUS.md, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },

  track: { overflow: 'visible', justifyContent: 'center' },
  fill: { height: '100%', position: 'absolute', left: 0, top: 0 },
  thresholdMark: { position: 'absolute', width: 2.5, top: -3, borderRadius: 2, opacity: 0.85 },
  thresholdLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },

  statBlock: { flex: 1 },

  timelineRow: { flexDirection: 'row', gap: SP.md },
  timelineRail: { width: 18, alignItems: 'center', paddingTop: 5 },
  timelineDot: { width: 11, height: 11, borderRadius: 5.5, borderWidth: 2 },
  timelineDotCurrent: { width: 14, height: 14, borderRadius: 7 },
  timelineLine: { width: 2, flex: 1, marginTop: 4, borderRadius: 1 },

  header: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.lg },

  segmented: { flexDirection: 'row', borderRadius: RADIUS.md, padding: 4, gap: 4 },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: RADIUS.sm },

  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.pill, borderWidth: 1 },
  chipRow: { flexDirection: 'row', gap: SP.sm, paddingRight: SP.sm },

  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.lg, paddingVertical: 13, minHeight: 54 },
  settingsRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth },
  settingsIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rowGroup: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64, paddingHorizontal: 28 },
  emptyIcon: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
