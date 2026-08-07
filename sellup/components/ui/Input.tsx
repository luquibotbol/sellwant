import React, { useState } from 'react';
import { View, TextInput, StyleSheet, TextInputProps, ViewStyle } from 'react-native';
import Text from '@/components/ui/Text';
import { colors, radius, space, type as typeScale, control } from '@/constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, hint, containerStyle, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text variant="small" tone="muted" style={styles.label}>
          {label}
        </Text>
      )}
      <TextInput
        placeholderTextColor={colors.subtleForeground}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          styles.input,
          focused && styles.focused,
          !!error && styles.errored,
          rest.multiline && styles.multiline,
        ]}
        {...rest}
      />
      {/* Errors carry text, never colour alone -- the error red is the same
          hue as the sell red, so colour by itself would be ambiguous. */}
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
  input: {
    height: control.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: space[3],
    color: colors.foreground,
    ...typeScale.body,
  },
  multiline: { height: 100, paddingTop: space[3], textAlignVertical: 'top' },
  focused: { borderColor: colors.borderStrong },
  errored: { borderColor: colors.destructive },
  helper: { marginTop: space[2] },
});

export default Input;
