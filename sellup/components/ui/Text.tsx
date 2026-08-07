import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { colors, type as typeScale } from '@/constants/theme';

type Variant = keyof typeof typeScale;
type Tone = 'default' | 'muted' | 'subtle' | 'sell' | 'want' | 'destructive' | 'inverse';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
}

const tones: Record<Tone, string> = {
  default: colors.foreground,
  muted: colors.mutedForeground,
  subtle: colors.subtleForeground,
  sell: colors.sell,
  want: colors.want,
  destructive: colors.destructive,
  inverse: colors.primaryForeground,
};

/** All text goes through here so the type scale stays honest. */
export function Text({ variant = 'body', tone = 'default', style, ...rest }: TextProps) {
  return <RNText style={[typeScale[variant], { color: tones[tone] }, style]} {...rest} />;
}

export const textStyles = StyleSheet.create({});
export default Text;
