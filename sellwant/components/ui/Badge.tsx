import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Text from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';

export type BadgeVariant = 'default' | 'outline' | 'sell' | 'want' | 'destructive';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
}

/**
 * Small semantic mark. Sell/want colour lives here and in prices -- never as a
 * large fill, which is what keeps the palette from shouting.
 */
export function Badge({ label, variant = 'default', style }: BadgeProps) {
  const tone =
    variant === 'sell' ? 'sell'
    : variant === 'want' ? 'want'
    : variant === 'destructive' ? 'destructive'
    : 'muted';

  return (
    <View style={[styles.base, styles[variant], style]}>
      <Text variant="caption" tone={tone} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  label: { fontSize: 11, letterSpacing: 0.3 },
  default: { backgroundColor: colors.muted, borderColor: colors.border },
  outline: { backgroundColor: colors.transparent, borderColor: colors.border },
  sell: { backgroundColor: colors.sellMuted, borderColor: 'rgba(239, 68, 68, 0.3)' },
  want: { backgroundColor: colors.wantMuted, borderColor: 'rgba(74, 222, 128, 0.3)' },
  destructive: { backgroundColor: colors.destructiveMuted, borderColor: 'rgba(239, 68, 68, 0.3)' },
});

export default Badge;
