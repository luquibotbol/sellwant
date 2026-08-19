import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import Text from '@/components/ui/Text';
import Input from '@/components/ui/Input';
import { colors, radius, space } from '@/constants/theme';
import { CITIES, City, matchCities, toCity } from '@/lib/cities';

interface Props {
  label?: string;
  /** The committed city, or null when nothing valid is chosen yet. */
  value: City | null;
  onChange: (next: City | null) => void;
  /** Shown under the field when the listing predates cities. */
  legacyValue?: string | null;
  error?: string;
}

/**
 * Pick a city. Type to narrow, but the value only ever comes from the list.
 *
 * Deliberately not free text with suggestions, which is what the venue field
 * it replaces was: a filter can only be trusted if every value in the column
 * is one the filter knows about, and one person typing "ATX" quietly splits a
 * city in two. So typing filters, and selecting commits -- half-typed text is
 * discarded on blur rather than saved.
 */
export function CityField({ label = 'City', value, onChange, legacyValue, error }: Props) {
  const [query, setQuery] = useState(value ?? '');
  const [focused, setFocused] = useState(false);

  // The edit screen loads its listing after the first render, so the field has
  // to follow a value that arrives late.
  useEffect(() => {
    if (!focused) setQuery(value ?? '');
  }, [value, focused]);

  const matches = matchCities(query);
  const show = focused && matches.length > 0;

  const commit = (city: City) => {
    onChange(city);
    setQuery(city);
    setFocused(false);
  };

  return (
    <View style={styles.container}>
      <Input
        label={label}
        value={query}
        onChangeText={(next) => {
          setQuery(next);
          // Typing over a committed city clears it: what is on screen and what
          // will be saved must not disagree.
          const exact = toCity(next);
          if (exact) onChange(exact);
          else if (value) onChange(null);
        }}
        placeholder="Austin"
        autoCapitalize="words"
        autoCorrect={false}
        error={error}
        onFocus={() => setFocused(true)}
        // Delayed so a tap on an option registers before the list unmounts.
        onBlur={() =>
          setTimeout(() => {
            setFocused(false);
            // Whatever was half-typed is not a city, so show the truth again.
            setQuery(value ?? '');
          }, 150)
        }
        containerStyle={show ? styles.inputOpen : undefined}
      />

      {show && (
        <View style={styles.dropdown}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {matches.map((c) => (
              <Pressable
                key={c}
                onPress={() => commit(c)}
                style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              >
                <Text variant="small">{c}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Listings written before cities existed hold a venue here. Saying so
          beats silently dropping it the next time they touch the form. */}
      {!value && !!legacyValue && !focused && (
        <Text variant="caption" tone="muted" style={styles.legacy}>
          Was “{legacyValue}” — pick a city to make it findable.
        </Text>
      )}

      {!value && !legacyValue && !focused && (
        <Text variant="caption" tone="subtle" style={styles.legacy}>
          {CITIES.length} cities so far — ask us if yours is missing.
        </Text>
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
  legacy: { marginTop: -space[2], marginBottom: space[4] },
});

export default CityField;
