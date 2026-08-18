import React from 'react';
import { View, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Text from '@/components/ui/Text';
import { colors, space, radius } from '@/constants/theme';

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Shown in parentheses, including when zero -- knowing a bucket is empty
   *  before tapping it is the point. Omit entirely where a count is noise. */
  count?: number;
}

interface Props<T extends string> {
  options: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle;
}

/**
 * The pill row the feed already uses to switch between everything, for sale
 * and wanted.
 *
 * Extracted so the same control can filter your listings and your offers.
 * Three copies of the same styles would have drifted apart, and these rows do
 * the same job in the same place on the screen -- looking different would
 * imply they behave differently.
 */
export function SegmentedFilter<T extends string>({
  options,
  value,
  onChange,
  style,
}: Props<T>) {
  return (
    <View style={[styles.row, style]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.item, on && styles.itemOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text variant={on ? 'bodyMedium' : 'body'} tone={on ? 'default' : 'muted'}>
              {o.label}
              {o.count === undefined ? '' : ` (${o.count})`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space[2],
    borderRadius: radius.md,
  },
  itemOn: { backgroundColor: colors.muted },
});

export default SegmentedFilter;
