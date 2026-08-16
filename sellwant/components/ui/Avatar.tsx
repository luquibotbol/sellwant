import React from 'react';
import { View, Image, StyleSheet, ViewStyle, ImageStyle, StyleProp } from 'react-native';
import Text from '@/components/ui/Text';
import { colors, radius } from '@/constants/theme';

interface Props {
  uri?: string | null;
  name?: string | null;
  size?: number;
  style?: ViewStyle;
}

function initials(name?: string | null) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Falls back to initials so a missing picture never renders as a broken image. */
export function Avatar({ uri, name, size = 40, style }: Props) {
  const box = { width: size, height: size, borderRadius: radius.full };

  if (uri) {
    // ViewStyle and ImageStyle differ only in `overflow`, which we never set.
    return (
      <Image
        source={{ uri }}
        style={[styles.base, box, style as StyleProp<ImageStyle>]}
        resizeMode="cover"
      />
    );
  }

  return (
    <View style={[styles.base, styles.fallback, box, style]}>
      <Text variant={size >= 56 ? 'heading' : 'small'}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});

export default Avatar;
