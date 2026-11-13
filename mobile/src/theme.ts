/**
 * theme.ts — the UltraCC mobile design system.
 *
 * This is the foundation every screen composes from. It defines a full
 * typography hierarchy, a spacing scale, a radius scale, elevation levels and a
 * semantic colour set. Crucially it models SURFACE LEVELS — not one flat card
 * colour — so a hero, an important panel, ordinary content and recessed/secondary
 * content each read differently. The signature move is the "ink" hero surface: a
 * deep navy panel used for the single most important element on a screen, in BOTH
 * light and dark mode, which is what stops the app looking like a field of
 * identical pastel cards.
 *
 * Dark mode is designed, not inverted: it uses lifted surfaces, hairline borders
 * and brighter accents rather than flipping the light palette.
 */

export type ThemeMode = 'light' | 'dark';

/* ------------------------------- type scale ------------------------------- */

/* One family per weight. React Native has no font stack, so a face is named
 * exactly rather than asked for by weight — the web board's two families are
 * loaded in App.tsx under these keys and nothing else should spell them. */
export const FONT = {
  medium: 'BricolageGrotesque_500Medium',
  semibold: 'BricolageGrotesque_600SemiBold',
  bold: 'BricolageGrotesque_700Bold',
  extrabold: 'BricolageGrotesque_800ExtraBold',
} as const;

/* Times, codes, rooms, dates, percentages and every other figure on the board.
 * Tabular figures so a column of numbers lines up down its decimal point. */
export const MONO = {
  regular: 'JetBrainsMono_400Regular',
  medium: 'JetBrainsMono_500Medium',
  bold: 'JetBrainsMono_700Bold',
} as const;

/** The mono style a screen spreads onto a time, code, room or number. */
export function mono(weight: keyof typeof MONO = 'medium'): { fontFamily: string; fontVariant: ['tabular-nums'] } {
  return { fontFamily: MONO[weight], fontVariant: ['tabular-nums'] };
}

export type FontVariant = 'tabular-nums' | 'proportional-nums';

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700' | '800';
  letterSpacing: number;
  lineHeight: number;
  fontVariant?: FontVariant[];
}

/** The full typographic hierarchy, from the largest number down to a caption. */
export const TYPE: Record<
  'display' | 'screenTitle' | 'sectionTitle' | 'cardTitle' | 'body' | 'bodyStrong' | 'meta' | 'caption' | 'stat' | 'statLg',
  TypeStyle
> = {
  display: { fontFamily: FONT.extrabold, fontSize: 40, fontWeight: '800', letterSpacing: -1.4, lineHeight: 44 },
  screenTitle: { fontFamily: FONT.extrabold, fontSize: 26, fontWeight: '800', letterSpacing: -0.6, lineHeight: 31 },
  sectionTitle: { fontFamily: FONT.extrabold, fontSize: 11.5, fontWeight: '800', letterSpacing: 1.3, lineHeight: 15 },
  cardTitle: { fontFamily: FONT.bold, fontSize: 16, fontWeight: '700', letterSpacing: -0.2, lineHeight: 21 },
  body: { fontFamily: FONT.medium, fontSize: 14, fontWeight: '500', letterSpacing: 0, lineHeight: 20 },
  bodyStrong: { fontFamily: FONT.bold, fontSize: 14, fontWeight: '700', letterSpacing: 0, lineHeight: 20 },
  meta: { fontFamily: FONT.medium, fontSize: 12.5, fontWeight: '500', letterSpacing: 0.1, lineHeight: 17 },
  caption: { fontFamily: FONT.bold, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, lineHeight: 14 },
  stat: { fontFamily: FONT.extrabold, fontSize: 24, fontWeight: '800', letterSpacing: -0.6, lineHeight: 27, fontVariant: ['tabular-nums'] },
  statLg: { fontFamily: FONT.extrabold, fontSize: 32, fontWeight: '800', letterSpacing: -1, lineHeight: 35, fontVariant: ['tabular-nums'] },
};

/* ------------------------------ spacing scale ----------------------------- */

export const SP = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Horizontal page margin used by every scrollable screen. */
export const PAGE = 18;

/* ------------------------------- radius scale ----------------------------- */

export const RADIUS = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

/* --------------------------------- colour --------------------------------- */

export interface Theme {
  mode: ThemeMode;
  dark: boolean;

  /* surfaces — five distinct levels, not one card colour */
  background: string;
  /** The signature deep hero panel (navy in both modes). */
  ink: string;
  inkBorder: string;
  onInk: string;
  onInkMuted: string;
  /** A raised standard panel (primary content). */
  surface: string;
  /** An even-more-raised panel for pressed / floating elements. */
  surfaceElevated: string;
  /** A recessed panel for secondary blocks, tracks and chips. */
  surfaceMuted: string;
  /** The deepest well — progress tracks, insets. */
  surfaceSunken: string;

  border: string;
  borderStrong: string;

  /* text hierarchy */
  text: string;
  textSecondary: string;
  textMuted: string;

  /* brand + semantic */
  accent: string;
  accentSoft: string;
  accentInk: string;
  onAccent: string;
  secondary: string;
  secondarySoft: string;
  gold: string;
  goldSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;

  shadow: string;
  skeleton: string;
}

export const ACCENT = '#2d5bff';

const light: Theme = {
  mode: 'light',
  dark: false,

  background: '#eceef5',
  ink: '#101a38',
  inkBorder: '#1b294d',
  onInk: '#f4f7ff',
  onInkMuted: '#9fb0dd',

  surface: '#ffffff',
  surfaceElevated: '#ffffff',
  surfaceMuted: '#f3f5fa',
  surfaceSunken: '#e5e9f2',

  border: '#e3e7f0',
  borderStrong: '#d3d9e7',

  text: '#0d1424',
  textSecondary: '#4c5872',
  textMuted: '#8490a8',

  accent: '#2d5bff',
  accentSoft: '#e2e8ff',
  accentInk: '#1c3fd6',
  onAccent: '#ffffff',
  secondary: '#0d9f9a',
  secondarySoft: '#d5f2f0',
  gold: '#c2820a',
  goldSoft: '#fbeed2',
  success: '#0f8a5f',
  successSoft: '#d6f2e5',
  warning: '#c2760b',
  warningSoft: '#fcecd2',
  danger: '#d63a3d',
  dangerSoft: '#fbdcdc',
  info: '#1c74d6',
  infoSoft: '#dceafa',

  shadow: '#0d1424',
  skeleton: '#e4e8f1',
};

const dark: Theme = {
  mode: 'dark',
  dark: true,

  background: '#080c17',
  ink: '#141d38',
  inkBorder: '#26324f',
  onInk: '#eaf0ff',
  onInkMuted: '#93a2cc',

  surface: '#111827',
  surfaceElevated: '#182136',
  surfaceMuted: '#151d2e',
  surfaceSunken: '#0c1220',

  border: '#20293c',
  borderStrong: '#2c3852',

  text: '#e8edf9',
  textSecondary: '#a8b4cc',
  textMuted: '#75819b',

  accent: '#6e8bff',
  accentSoft: '#1b2a52',
  accentInk: '#8aa1ff',
  onAccent: '#060a16',
  secondary: '#2dd4bf',
  secondarySoft: '#123330',
  gold: '#f0c15a',
  goldSoft: '#33290f',
  success: '#37d99a',
  successSoft: '#0f3327',
  warning: '#f5b942',
  warningSoft: '#33280f',
  danger: '#ff7a7d',
  dangerSoft: '#3a1b21',
  info: '#5bc0ff',
  infoSoft: '#102c44',

  shadow: '#000000',
  skeleton: '#1b2437',
};

export function themeFor(mode: ThemeMode): Theme {
  return mode === 'dark' ? dark : light;
}

/* ------------------------------- elevation -------------------------------- */

export type ElevationLevel = 0 | 1 | 2 | 3;

/**
 * Depth. In light mode this is a real, layered drop shadow; in dark mode shadows
 * disappear and hairline borders + lifted surfaces do the work instead.
 */
export function elevation(theme: Theme, level: ElevationLevel) {
  if (theme.dark) return {};
  switch (level) {
    case 0:
      return {};
    case 1:
      return { shadowColor: theme.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 };
    case 2:
      return { shadowColor: theme.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 3 };
    case 3:
      return { shadowColor: theme.shadow, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.12, shadowRadius: 22, elevation: 8 };
  }
}

/* --------------------------------- grades --------------------------------- */

/** VIT's absolute grade bands, for colouring grades. */
export const GRADE_BAND_COLORS: Record<string, string> = {
  S: '#0f9d6a',
  A: '#2d5bff',
  B: '#0d9f9a',
  C: '#c2820a',
  D: '#e08a12',
  E: '#d63a3d',
  F: '#a11d1d',
};

/** The three attendance risk categories and their tones. */
export type RiskTone = 'success' | 'warning' | 'danger';

export function riskTone(category: string | undefined): RiskTone {
  const c = (category || '').toUpperCase();
  if (c === 'SAFE') return 'success';
  if (c === 'WARNING') return 'warning';
  if (c === 'CRITICAL') return 'danger';
  return 'success';
}
