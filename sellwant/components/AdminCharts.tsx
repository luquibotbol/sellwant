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
        const fraction = top > 0 ? s.value / top : 0;
        return (
          <View key={s.label} style={styles.row}>
            <View style={styles.rowHead}>
              <Text variant="small" tone="muted">
                {s.label}
              </Text>
              {/* The count, and nothing else. A percentage of the previous
                  stage answers a different question than the one being asked
                  here, which is how many people reached this point. */}
              <Text variant="small">{s.value}</Text>
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
  plot: { position: 'relative', marginTop: space[4] },
  baseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: colors.border,
  },
  // 2px, per the mark spec: a line is a measurement, not a stroke of paint.
  segment: { position: 'absolute', height: 2, backgroundColor: FUNNEL_HUE, borderRadius: 1 },
  dot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: FUNNEL_HUE,
    // A ring of surface so a marker sitting on the line still reads as a point.
    borderWidth: 2,
    borderColor: colors.card,
  },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
  tsFoot: { marginTop: space[3] },
});

/**
 * Signups over time, as a line.
 *
 * Drawn from rotated Views: one absolutely-positioned segment per gap, each
 * rotated to the angle between its two points. There is no SVG library here,
 * and adding one to draw a polyline would be a dependency for a single screen.
 *
 * Positions are computed in pixels from a measured width rather than in
 * percentages. A percentage resolves against the parent's own size, and this
 * chart has already been bitten twice by that -- a percentage width inside a
 * horizontal scroller and a percentage height inside a content-sized column
 * both collapsed to zero. Measuring removes the question.
 */
export function TimeSeriesLine({ points }: { points: BucketPoint[] }) {
  const [width, setWidth] = React.useState(0);

  const peak = points.reduce((m, p) => Math.max(m, p.count), 0);
  const total = points.reduce((n, p) => n + p.count, 0);
  const latest = points[points.length - 1];
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  const H = 120;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  // A flat zero line sits on the floor rather than halfway up an invented axis.
  const y = (n: number) => (peak > 0 ? H - (n / peak) * H : H);
  const xy = points.map((p, i) => ({ x: i * step, y: y(p.count) }));

  const peakIndex = points.reduce((best, p, i) => (p.count > points[best].count ? i : best), 0);

  return (
    <View style={styles.block}>
      <View style={styles.tsHead}>
        <Text variant="display">{total}</Text>
        <Text variant="caption" tone="muted">
          in this range · peak {peak}
        </Text>
      </View>

      <View
        style={[styles.plot, { height: H }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {/* Baseline, so a run of zeroes reads as zero rather than as no data. */}
        <View style={styles.baseline} />

        {width > 0 &&
          xy.slice(0, -1).map((a, i) => {
            const b = xy[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return (
              <View
                key={points[i].start.getTime()}
                style={[
                  styles.segment,
                  {
                    left: a.x,
                    top: a.y,
                    width: len,
                    // Rotate about the left edge so the segment starts exactly
                    // on its point instead of centred on it.
                    transform: [{ translateY: -1 }, { rotateZ: `${angle}deg` }],
                    transformOrigin: 'left center',
                  },
                ]}
              />
            );
          })}

        {/* Markers only where they say something: the busiest bucket and the
            one still filling. A dot on all thirty is a dotted line. */}
        {width > 0 &&
          [peakIndex, points.length - 1].map((i) => (
            <View
              key={`dot-${points[i].start.getTime()}`}
              style={[styles.dot, { left: xy[i].x - 4, top: xy[i].y - 4 }]}
            />
          ))}
      </View>

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
