import React from 'react';
import { View, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, space } from '@/constants/theme';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  /** Tints the left edge to mark which side of the market a row belongs to. */
  accent?: 'sell' | 'want';
}

/**
 * Surface primitive. Separated from the page by a hairline border rather than a
 * shadow or a lighter fill -- that border-first treatment is the core of the
 * Vercel look.
 */
export function Card({ children, onPress, style, accent }: CardProps) {
  const accentStyle = accent
    ? { borderLeftWidth: 2, borderLeftColor: accent === 'sell' ? colors.sell : colors.want }
    : null;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          accentStyle,
          pressed && styles.pressed,
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[styles.card, accentStyle, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: space[4],
  },
  pressed: { backgroundColor: colors.muted, borderColor: colors.borderStrong },
});

export default Card;
