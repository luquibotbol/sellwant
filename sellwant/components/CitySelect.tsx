import React, { useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text, Input } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { City, matchCities } from '@/lib/cities';

interface Props {
  value: City | null;
  onChange: (next: City | null) => void;
}

/**
 * The city filter for the feed.
 *
 * A pill beside the search box rather than a second row of tabs: category
 * already occupies a horizontal nav, and two of those stacked read as one
 * control split in half. Collapsed to its value when closed, so the filter
 * that is on is always legible without spending a row on it.
 *
 * The list is 380 cities, so it opens onto a search box and the eight biggest
 * rather than a scroll bar with 380 stops in it. Typing is the primary way
 * through; scrolling is for the handful of people who live in New York.
 */
export function CitySelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const matches = matchCities(query);

  const pick = (next: City | null) => {
    onChange(next);
    setQuery('');
    setOpen(false);
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => {
          setQuery('');
          setOpen((o) => !o);
        }}
        style={({ pressed }) => [
          styles.pill,
          value != null && styles.pillActive,
          pressed && styles.pillPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={value ? `City: ${value}` : 'Filter by city'}
      >
        <Text variant="small" tone={value ? 'default' : 'subtle'} numberOfLines={1}>
          {value ?? 'All cities'}
        </Text>
        <Text variant="caption" tone="subtle">
          {open ? '▲' : '▼'}
        </Text>
      </Pressable>

      {open && (
        <View style={styles.dropdown}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Find a city"
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
            containerStyle={styles.search}
          />
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {/* Clearing the filter has to stay reachable while searching, so it
                sits above the results rather than inside them. */}
            <Pressable
              onPress={() => pick(null)}
              style={({ pressed }) => [
                styles.item,
                value === null && styles.itemSelected,
                pressed && styles.itemPressed,
              ]}
            >
              <Text
                variant={value === null ? 'bodyMedium' : 'small'}
                tone={value === null ? 'default' : 'subtle'}
              >
                All cities
              </Text>
            </Pressable>

            {matches.map((c) => {
              const selected = value === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => pick(c)}
                  style={({ pressed }) => [
                    styles.item,
                    selected && styles.itemSelected,
                    pressed && styles.itemPressed,
                  ]}
                >
                  <Text
                    variant={selected ? 'bodyMedium' : 'small'}
                    tone={selected ? 'default' : 'subtle'}
                  >
                    {c}
                  </Text>
                </Pressable>
              );
            })}

            {query.trim() !== '' && matches.length === 0 && (
              <Text variant="caption" tone="muted" style={styles.empty}>
                No city by that name yet.
              </Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the list, or the dropdown renders behind the first few cards.
  container: { position: 'relative', zIndex: 20 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
  },
  pillActive: { borderColor: colors.borderStrong },
  pillPressed: { backgroundColor: colors.muted },
  dropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: space[2],
    minWidth: 210,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  search: { margin: space[3], marginBottom: space[2] },
  scroll: { maxHeight: 260 },
  item: { paddingHorizontal: space[4], paddingVertical: space[3] },
  itemSelected: { backgroundColor: colors.muted },
  itemPressed: { backgroundColor: colors.muted },
  empty: { paddingHorizontal: space[4], paddingVertical: space[3] },
});

export default CitySelect;
