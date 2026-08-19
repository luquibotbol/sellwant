import React from 'react';
import { View, StyleSheet } from 'react-native';
import Text from '@/components/ui/Text';
import Button from '@/components/ui/Button';
import { todayISO } from '@/lib/format';
import { colors, radius, space, control } from '@/constants/theme';

export interface DateFieldProps {
  label?: string;
  /** ISO date, YYYY-MM-DD. */
  value: string;
  onChange: (next: string) => void;
  error?: string;
  hint?: string;
  min?: string;
  /**
   * Offer "No date" as an explicit choice.
   *
   * The field starts on today because that is the common case, which means
   * having no date is a thing you have to actively undo -- and on a bare date
   * input, undoing it means knowing you can clear it. A button says the option
   * exists.
   */
  allowNone?: boolean;
}

/**
 * Web date input.
 *
 * Uses the browser's own <input type="date">, which gives a real calendar on
 * desktop and the native wheel on iOS -- better than any calendar we would
 * hand-roll, and free. This file is web-only; Metro resolves DateField.tsx for
 * native, which uses the platform picker instead.
 */
export function DateField({ label, value, onChange, error, hint, min, allowNone }: DateFieldProps) {
  const none = allowNone && !value;
  return (
    <View style={styles.container}>
      {label && (
        <Text variant="small" tone="muted" style={styles.label}>
          {label}
        </Text>
      )}
      {none ? (
        // The empty input is hidden rather than shown blank: a date control
        // reading mm/dd/yyyy looks like something you forgot to fill in, and
        // this is a choice somebody made.
        <View style={styles.noneRow}>
          <Text variant="body" tone="subtle">
            No date
          </Text>
          <Button
            title="Add a date"
            variant="secondary"
            size="sm"
            onPress={() => onChange(min || todayISO())}
          />
        </View>
      ) : (
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
      )}

      {allowNone && !none && (
        <Button
          title="No date"
          variant="ghost"
          size="sm"
          onPress={() => onChange('')}
          style={styles.noneButton}
        />
      )}
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
  noneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    minHeight: control.lg,
  },
  noneButton: { alignSelf: 'flex-start', marginTop: space[2] },
});

export default DateField;
