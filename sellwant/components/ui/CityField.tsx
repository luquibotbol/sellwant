import React, { useEffect, useRef, useState } from 'react';
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

  // Blur is deferred so a tap on an option lands first, which means the
  // callback runs after the tap has already changed `value`. Reading `value`
  // from the closure there gives the value from before the selection, and the
  // field cleared itself the instant you picked a city. The ref is always the
  // committed one; the timer handle lets a selection cancel the reset it no
  // longer needs.
  const committed = useRef<City | null>(value);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    committed.current = value;
  }, [value]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  // The edit screen loads its listing after the first render, so the field has
  // to follow a value that arrives late.
  useEffect(() => {
    if (!focused) setQuery(value ?? '');
  }, [value, focused]);

  const matches = matchCities(query);
  const show = focused && matches.length > 0;

  const commit = (city: City) => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
    committed.current = city;
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
        onBlur={() => {
          blurTimer.current = setTimeout(() => {
            setFocused(false);
            // Whatever was half-typed is not a city, so show the truth again.
            setQuery(committed.current ?? '');
          }, 150);
        }}
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
          Start typing — {CITIES.length.toLocaleString()} US cities.
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
