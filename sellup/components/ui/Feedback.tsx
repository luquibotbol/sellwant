import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import Text from '@/components/ui/Text';
import Button from '@/components/ui/Button';
import { colors, radius, space } from '@/constants/theme';

/** Loading placeholder. Pulses rather than spins, matching shadcn's Skeleton. */
export function Skeleton({ style }: { style?: ViewStyle }) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return <Animated.View style={[styles.skeleton, { opacity: pulse }, style]} />;
}

export function Separator({ style }: { style?: ViewStyle }) {
  return <View style={[styles.separator, style]} />;
}

/**
 * Empty and error states. These are one component because the failure mode we
 * are guarding against is showing them identically -- previously a rejected
 * query and an empty feed both rendered as a blank list.
 */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.state}>
      <Text variant="heading">{title}</Text>
      {!!body && (
        <Text variant="small" tone="muted" style={styles.stateBody}>
          {body}
        </Text>
      )}
      {actionLabel && onAction && (
        <Button title={actionLabel} onPress={onAction} style={styles.stateAction} />
      )}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.state}>
      <View style={styles.errorRow}>
        <View style={styles.errorDot} />
        <Text variant="heading" tone="destructive">
          Something went wrong
        </Text>
      </View>
      <Text variant="small" tone="muted" style={styles.stateBody}>
        {message}
      </Text>
      {onRetry && (
        <Button title="Try again" variant="outline" onPress={onRetry} style={styles.stateAction} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: colors.muted, borderRadius: radius.md },
  separator: { height: 1, backgroundColor: colors.border },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: space[16], paddingHorizontal: space[6] },
  stateBody: { textAlign: 'center', marginTop: space[2], maxWidth: 340 },
  stateAction: { marginTop: space[5] },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  errorDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.destructive },
});
