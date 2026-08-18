import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';

/**
 * Shared shell for the terms and privacy pages.
 *
 * Plain prose, rendered in the app rather than hosted elsewhere, so the tone
 * matches the rest of the product and the pages stay indexable.
 */
export interface Section {
  heading: string;
  paragraphs: string[];
}

export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: Section[];
}) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text variant="display">{title}</Text>
      <Text variant="caption" tone="subtle" style={styles.updated}>
        Last updated {updated}
      </Text>
      <Text variant="body" tone="muted" style={styles.intro}>
        {intro}
      </Text>

      {sections.map((s) => (
        <View key={s.heading} style={styles.section}>
          <Text variant="heading">{s.heading}</Text>
          {s.paragraphs.map((p, i) => (
            <Text key={i} variant="small" tone="muted" style={styles.para}>
              {p}
            </Text>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: space[5],
    paddingBottom: space[16],
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  updated: { marginTop: space[2] },
  intro: { marginTop: space[5], lineHeight: 22 },
  section: { marginTop: space[8] },
  para: { marginTop: space[3], lineHeight: 21 },
});

export default LegalPage;
