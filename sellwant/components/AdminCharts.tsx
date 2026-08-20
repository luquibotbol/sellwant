import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@/components/ui';
import type { BucketPoint } from '@/services/data';
import { colors, radius, space } from '@/constants/theme';

/**
 * Charts for the founders' dashboard.
 *
 * Built from Views because there is no chart library here and adding one to an
 * Expo app to draw a dozen bars would cost more than it returns. Bars are the
 * only form these numbers need: every figure on this screen is a magnitude or
 * a share of one, and neither wants a line.
 *
 * The palette is deliberately NOT the app's sell-red and want-green. Those two
 * are 3.7 apart in OKLab under deuteranopia, where 8 is the floor -- for
 * roughly one man in twelve they are the same colour. That is survivable on a
 * badge that also says "FOR SALE", and not survivable as a chart's only
 * encoding. These four are validated: worst adjacent pair 8.4 under protanopia,
 * 19.8 for normal vision, all inside the dark lightness band, all above 3:1 on
 * the card surface.
 *
 * Every segment is also named and numbered in the legend beneath it, so the
 * colour is a convenience rather than the information.
 */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500'] as const;

/** Single-hue for the funnel: it is one measure at six stages, not six things. */
const FUNNEL_HUE = '#3987e5';

/**
 * A share, as a string.
 *
 * "<1%" rather than "0%" for anything non-zero: one listing in four hundred
 * rounds to zero, and a legend reading "In a deal 1  0%" says the opposite of
 * what the count beside it says.
 */
function share(n: number, of: number): string {
  if (of <= 0 || n <= 0) return '0%';
  const p = (n / of) * 100;
  return p < 1 ? '<1%' : `${Math.round(p)}%`;
}

/** Whole percent, for the funnel's stage-to-stage drop. */
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

interface FunnelStage {
  label: string;
  value: number;
}

/**
 * The funnel, as bars rather than six numbers in a row.
 *
 * Scaled against the first stage, not against each bar's own maximum, because
 * the question this answers is "where do people fall out" -- and a bar chart
 * that rescales per row hides exactly that.
 */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const top = stages[0]?.value ?? 0;

  return (
    <View style={styles.block}>
      {stages.map((s, i) => {
        const previous = i === 0 ? null : stages[i - 1].value;
        const fraction = top > 0 ? s.value / top : 0;
        return (
          <View key={s.label} style={styles.row}>
            <View style={styles.rowHead}>
              <Text variant="small" tone="muted">
                {s.label}
              </Text>
              <Text variant="small">
                {s.value}
                {previous !== null && (
                  <Text variant="caption" tone="subtle">
                    {'  '}
                    {pct(s.value, previous)}% of previous
                  </Text>
                )}
              </Text>
            </View>
            {/* The track makes an empty stage legible as zero rather than as a
                missing row. */}
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { backgroundColor: FUNNEL_HUE, width: `${Math.max(fraction * 100, s.value > 0 ? 1.5 : 0)}%` },
                ]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

interface Part {
  label: string;
  value: number;
}

/**
 * One bar split into its parts, for the sets that genuinely sum to a whole.
 *
 * Only used where the parts are mutually exclusive and add up -- listing
 * statuses, offer outcomes, deal outcomes. Stacking overlapping counts (users
 * who are confirmed, users who came via Google, users active this week) would
 * draw a bar longer than the number of people who exist, which is why the user
 * numbers on this screen stay as plain figures.
 */
export function CompositionBar({ parts }: { parts: Part[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);

  if (total === 0) {
    return (
      <View style={styles.block}>
        <View style={styles.track} />
        <Text variant="caption" tone="subtle" style={styles.empty}>
          Nothing yet.
        </Text>
      </View>
    );
  }

  const shown = parts.filter((p) => p.value > 0);

  return (
    <View style={styles.block}>
      <View style={styles.stack}>
        {shown.map((p, i) => (
          <View
            key={p.label}
            style={{
              flex: p.value,
              backgroundColor: SERIES[i % SERIES.length],
              // A 2px gap of surface between segments, so two adjacent fills
              // read as two things even when their hues are close.
              marginLeft: i === 0 ? 0 : 2,
              borderTopLeftRadius: i === 0 ? radius.sm : 0,
              borderBottomLeftRadius: i === 0 ? radius.sm : 0,
              borderTopRightRadius: i === shown.length - 1 ? radius.sm : 0,
              borderBottomRightRadius: i === shown.length - 1 ? radius.sm : 0,
            }}
          />
        ))}
      </View>

      {/* Always present, because with more than one series the colour alone is
          never allowed to carry identity. */}
      <View style={styles.legend}>
        {shown.map((p, i) => (
          <View key={p.label} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: SERIES[i % SERIES.length] }]} />
            <Text variant="caption" tone="muted">
              {p.label}
            </Text>
            <Text variant="caption">{p.value}</Text>
            <Text variant="caption" tone="subtle">
              {share(p.value, total)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: space[3] },
  row: { marginBottom: space[4] },
  rowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: space[2],
  },
  // Thin marks: the bar is a measurement, not a slab.
  track: {
    height: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.sm },
  stack: { flexDirection: 'row', height: 10, borderRadius: radius.sm },
  legend: { marginTop: space[3], gap: space[2] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  empty: { marginTop: space[2] },
  tsHead: { flexDirection: 'row', alignItems: 'baseline', gap: space[3] },
  // A fixed plot height: the chart is read as a shape, and a shape that
  // changes height with the data is not comparable between two views of it.
  plot: {
    flexDirection: 'row',
    // stretch, not flex-end: a column sized by its content has no height for
    // the bar's percentage to resolve against, so every bar came out zero --
    // the same collapse a percentage width hits inside a horizontal scroller.
    alignItems: 'stretch',
    height: 120,
    gap: 2,
    marginTop: space[4],
  },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
  tsFoot: { marginTop: space[3] },
});

/**
 * Signups per bucket, as columns.
 *
 * Columns rather than a line: a line between Tuesday and Wednesday draws a
 * value for the moment in between, and there is no such thing as half a
 * Tuesday's signups. Bars say "these are counts of separate periods", which is
 * what they are.
 *
 * Only three labels sit under the axis -- first, middle, last. Thirty dates
 * across a phone would overlap into a grey smear, and the shape is the point;
 * the exact date of one bar is not.
 */
export function TimeSeriesBars({ points }: { points: BucketPoint[] }) {
  const peak = points.reduce((m, p) => Math.max(m, p.count), 0);
  const total = points.reduce((n, p) => n + p.count, 0);
  const latest = points[points.length - 1];
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <View style={styles.block}>
      <View style={styles.tsHead}>
        <Text variant="display">{total}</Text>
        <Text variant="caption" tone="muted">
          in this range · peak {peak}
        </Text>
      </View>

      <View style={styles.plot}>
        {points.map((p, i) => (
          <View key={p.start.getTime()} style={styles.col}>
            {/* Anchored to the baseline, so height is the only thing carrying
                the value. A zero bucket keeps a 1px foot rather than vanishing:
                the gap in the row is the information. */}
            <View
              style={[
                styles.bar,
                {
                  height: peak > 0 ? `${Math.max((p.count / peak) * 100, p.count > 0 ? 4 : 0.8)}%` : '0.8%',
                  backgroundColor: p.count > 0 ? FUNNEL_HUE : colors.muted,
                  // The most recent bucket is the one being watched, and it is
                  // usually still filling up.
                  opacity: i === points.length - 1 ? 0.55 : 1,
                },
              ]}
            />
          </View>
        ))}
      </View>

      {/* Three labels on their own row, spread across the plot. Inside the
          columns they were clipped to "J…" -- a thirtieth of a phone is not
          wide enough for a date, and the column width is set by the data. */}
      <View style={styles.axis}>
        {ticks.map((t, i) => (
          <Text
            key={points[t]?.start.getTime() ?? i}
            variant="caption"
            tone="subtle"
            numberOfLines={1}
          >
            {points[t]?.label ?? ''}
          </Text>
        ))}
      </View>

      <Text variant="caption" tone="subtle" style={styles.tsFoot}>
        Newest on the right{latest ? ` · ${latest.count} so far in the latest one` : ''}
      </Text>
    </View>
  );
}
