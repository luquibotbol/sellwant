/**
 * SellWant design system.
 *
 * Values are ported from shadcn/ui's default dark theme (the `zinc` scale) and
 * Vercel's visual language. shadcn itself cannot run here -- its components are
 * Radix + Tailwind + DOM, and this app renders through react-native-web -- so
 * the design language is ported as tokens instead of installed as a package.
 *
 * Every screen consumes these. No screen defines its own colour.
 */

// ---------------------------------------------------------------- colour

export const colors = {
  /** Page background. shadcn dark `--background`, hsl(240 10% 3.9%). */
  background: '#09090B',
  /** Raised surfaces. Deliberately near-identical to the background --
   *  Vercel separates surfaces with borders, not fills or shadows. */
  card: '#0C0C0E',
  /** Hover / pressed / inert fills. `--secondary`, hsl(240 3.7% 15.9%). */
  muted: '#27272A',
  /** Hairlines. The primary tool for structure in this aesthetic. */
  border: '#27272A',
  /** Stronger hairline for focus and emphasis. */
  borderStrong: '#3F3F46',

  foreground: '#FAFAFA',
  /** Secondary copy. `--muted-foreground`, hsl(240 5% 64.9%). */
  mutedForeground: '#A1A1AA',
  /** Tertiary copy -- timestamps, counts, fine print. */
  subtleForeground: '#71717A',

  /**
   * Market semantics, following trading convention: the sell side is red and
   * the buy side is green. Used only as small marks -- badges, prices, thin
   * borders -- never as large fills, which is what keeps the UI restrained.
   */
  sell: '#EF4444',
  sellMuted: 'rgba(239, 68, 68, 0.12)',
  want: '#4ADE80',
  wantMuted: 'rgba(74, 222, 128, 0.12)',

  /** Destructive/error. Shares the sell hue, so error states must always carry
   *  an icon and text -- never colour alone. */
  destructive: '#EF4444',
  destructiveMuted: 'rgba(239, 68, 68, 0.12)',

  /** Primary action. Vercel's is white-on-black, not a colour. */
  primary: '#FAFAFA',
  primaryForeground: '#09090B',

  overlay: 'rgba(0, 0, 0, 0.8)',
  transparent: 'transparent',
} as const;

// ---------------------------------------------------------------- metrics

/** 4px base scale. */
export const space = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64,
} as const;

/** shadcn's `--radius: 0.5rem` and its derived steps. */
export const radius = {
  sm: 4, md: 6, lg: 8, xl: 12, '2xl': 16, full: 9999,
} as const;

export const fontFamily = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
} as const;

/**
 * Type scale. Small and tight -- Vercel leans on 12-14px body text with
 * negative tracking at display sizes.
 */
export const type = {
  display: { fontSize: 32, lineHeight: 36, fontFamily: fontFamily.bold, letterSpacing: -0.8 },
  title:   { fontSize: 22, lineHeight: 28, fontFamily: fontFamily.semibold, letterSpacing: -0.4 },
  heading: { fontSize: 17, lineHeight: 24, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },
  body:    { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.regular },
  bodyMedium: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.medium },
  small:   { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.regular },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.regular },
  mono:    { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.medium, letterSpacing: 0.2 },
} as const;

/** Control heights, matched to shadcn's `h-9` / `h-10`. */
export const control = { sm: 32, md: 36, lg: 44 } as const;

/** Content column cap. Keeps the web build from sprawling on desktop. */
export const maxContentWidth = 560;

export const theme = {
  colors, space, radius, type, fontFamily, control, maxContentWidth,
} as const;

export default theme;
