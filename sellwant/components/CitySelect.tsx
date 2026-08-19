import React, { useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { CITIES, City } from '@/lib/cities';

interface Props {
  value: City | null;
  onChange: (next: City | null) => void;
}

/**
 * The city filter for the feed.
 *
 * A pill beside the search box rather than a second row of tabs: category
 * already occupies a horizontal nav, and two of those stacked read as one
 * control split in half. This collapses to its current value when closed, so
 * the filter that is on is always legible without spending a row on it.
 */
export function CitySelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const pick = (next: City | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
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
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {[null, ...CITIES].map((c) => {
              const selected = value === c;
              return (
                <Pressable
                  key={c ?? 'all'}
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
                    {c ?? 'All cities'}
                  </Text>
                </Pressable>
              );
            })}
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
    minWidth: 170,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  scroll: { maxHeight: 260 },
  item: { paddingHorizontal: space[4], paddingVertical: space[3] },
  itemSelected: { backgroundColor: colors.muted },
  itemPressed: { backgroundColor: colors.muted },
});

export default CitySelect;
