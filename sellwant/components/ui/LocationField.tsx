import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import Text from '@/components/ui/Text';
import Input from '@/components/ui/Input';
import { colors, radius, space } from '@/constants/theme';

interface Props {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  /** Known places, most common first. */
  suggestions: string[];
  placeholder?: string;
  error?: string;
}

/**
 * Free-text place with suggestions drawn from places already used on SellWant.
 *
 * Not a geocoder: campus venues ("Sig Ep house") are not in any maps database,
 * and the same party is easier to find when everyone spells the venue the same
 * way -- which suggestions encourage and a map lookup would not.
 */
export function LocationField({
  label = 'Where',
  value,
  onChange,
  suggestions,
  placeholder = 'Sig Ep house',
  error,
}: Props) {
  const [focused, setFocused] = useState(false);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = suggestions.filter((s) => s.toLowerCase() !== q);
    if (!q) return pool.slice(0, 5);
    return pool.filter((s) => s.toLowerCase().includes(q)).slice(0, 5);
  }, [value, suggestions]);

  const show = focused && matches.length > 0;

  return (
    <View style={styles.container}>
      <Input
        label={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        autoCapitalize="words"
        autoCorrect={false}
        error={error}
        onFocus={() => setFocused(true)}
        // Delayed so a tap on a suggestion registers before the list unmounts.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        containerStyle={show ? styles.inputOpen : undefined}
      />

      {show && (
        <View style={styles.dropdown}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {matches.map((s) => (
              <Pressable
                key={s}
                onPress={() => {
                  onChange(s);
                  setFocused(false);
                }}
                style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              >
                <Text variant="small">{s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', zIndex: 10 },
  inputOpen: { marginBottom: space[1] },
  dropdown: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    marginBottom: space[4],
    overflow: 'hidden',
  },
  scroll: { maxHeight: 180 },
  item: { paddingHorizontal: space[3], paddingVertical: space[3] },
  itemPressed: { backgroundColor: colors.muted },
});

export default LocationField;
