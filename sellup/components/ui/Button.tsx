import React from 'react';
import { Pressable, ActivityIndicator, StyleSheet, ViewStyle, View } from 'react-native';
import Text from '@/components/ui/Text';
import { colors, radius, space, control } from '@/constants/theme';

export type ButtonVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Fills the available width. Off by default, like shadcn. */
  block?: boolean;
  style?: ViewStyle;
  icon?: React.ReactNode;
}

export function Button({
  title,
  onPress,
  variant = 'default',
  size = 'md',
  loading = false,
  disabled = false,
  block = false,
  style,
  icon,
}: ButtonProps) {
  const inactive = disabled || loading;
  const tone =
    variant === 'default' ? 'inverse'
    : variant === 'destructive' ? 'destructive'
    : 'default';

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        { height: control[size] },
        styles[variant],
        block && styles.block,
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'default' ? colors.primaryForeground : colors.foreground}
        />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text variant="bodyMedium" tone={tone}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.transparent,
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  block: { alignSelf: 'stretch' },
  // Vercel's primary action is white on black, not a colour.
  default: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.muted },
  outline: { backgroundColor: colors.transparent, borderColor: colors.border },
  ghost: { backgroundColor: colors.transparent },
  destructive: { backgroundColor: colors.destructiveMuted, borderColor: 'rgba(239,68,68,0.3)' },
  pressed: { opacity: 0.85 },
  inactive: { opacity: 0.5 },
});

export default Button;
