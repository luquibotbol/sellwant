import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Text from '@/components/ui/Text';
import { toISODate, fromISODate, todayISO } from '@/lib/format';
import Button from '@/components/ui/Button';
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
   * Matters more here than on web: the platform picker has no way to clear
   * itself, so without this a native listing could never be posted without a
   * date at all.
   */
  allowNone?: boolean;
}


function pretty(s: string) {
  if (!s) return 'Choose a date';
  return fromISODate(s).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Native date field. Web resolves DateField.web.tsx instead, which uses the
 * browser's own date input.
 */
export function DateField({ label, value, onChange, error, hint, min, allowNone }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const none = allowNone && !value;

  return (
    <View style={styles.container}>
      {label && (
        <Text variant="small" tone="muted" style={styles.label}>
          {label}
        </Text>
      )}

      {none ? (
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
        <Pressable
          onPress={() => setOpen(true)}
          style={[styles.field, !!error && styles.errored]}
        >
          <Text variant="body" tone={value ? 'default' : 'subtle'}>
            {pretty(value)}
          </Text>
        </Pressable>
      )}

      {allowNone && !none && !open && (
        <Button
          title="No date"
          variant="ghost"
          size="sm"
          onPress={() => onChange('')}
          style={styles.noneButton}
        />
      )}

      {open && (
        <>
          <DateTimePicker
            value={fromISODate(value)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            minimumDate={min ? fromISODate(min) : undefined}
            themeVariant="dark"
            onChange={(event, date) => {
              // Android dismisses itself; iOS inline stays open until confirmed.
              if (Platform.OS !== 'ios') setOpen(false);
              if (event.type === 'dismissed') return;
              if (date) onChange(toISODate(date));
            }}
          />
          {Platform.OS === 'ios' && (
            <Button title="Done" variant="secondary" onPress={() => setOpen(false)} />
          )}
        </>
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
  field: {
    height: control.lg,
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: space[3],
  },
  errored: { borderColor: colors.destructive },
  noneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    minHeight: control.lg,
  },
  noneButton: { alignSelf: 'flex-start', marginTop: space[2] },
  helper: { marginTop: space[2] },
});

export default DateField;
