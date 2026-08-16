import React from 'react';
import { View, StyleSheet } from 'react-native';
import Text from '@/components/ui/Text';
import { colors, radius, space, control } from '@/constants/theme';

export interface DateFieldProps {
  label?: string;
  /** ISO date, YYYY-MM-DD. */
  value: string;
  onChange: (next: string) => void;
  error?: string;
  hint?: string;
  min?: string;
}

/**
 * Web date input.
 *
 * Uses the browser's own <input type="date">, which gives a real calendar on
 * desktop and the native wheel on iOS -- better than any calendar we would
 * hand-roll, and free. This file is web-only; Metro resolves DateField.tsx for
 * native, which uses the platform picker instead.
 */
export function DateField({ label, value, onChange, error, hint, min }: DateFieldProps) {
  return (
    <View style={styles.container}>
      {label && (
        <Text variant="small" tone="muted" style={styles.label}>
          {label}
        </Text>
      )}
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: control.lg,
          width: '100%',
          boxSizing: 'border-box',
          backgroundColor: colors.card,
          border: `1px solid ${error ? colors.destructive : colors.border}`,
          borderRadius: radius.lg,
          padding: `0 ${space[3]}px`,
          color: colors.foreground,
          // 16px keeps iOS Safari from zooming the page on focus.
          fontSize: 16,
          fontFamily: 'Geist_400Regular',
          outline: 'none',
          // Renders the picker and its calendar glyph dark instead of a white
          // icon-on-white box.
          colorScheme: 'dark',
        }}
      />
      {!!error && (
        <Text variant="caption" tone="destructive" style={styles.helper}>
          {error}
        </Text>
      )}
      {!error && !!hint && (
        <Text variant="caption" tone="subtle" style={styles.helper}>
          {hint}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: space[4] },
  label: { marginBottom: space[2] },
  helper: { marginTop: space[2] },
});

export default DateField;
