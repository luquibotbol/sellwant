import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import Head from 'expo-router/head';
import { Text, Card, Badge, Button, Separator, EmptyState, SegmentedFilter } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { money, relativeTime } from '@/lib/format';
import { FunnelChart, CompositionBar, TimeSeriesLine } from '@/components/AdminCharts';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import {
  adminStats,
  adminViewStats,
  adminRecentViews,
  RECENT_VIEW_WINDOW,
  signupsOverTime,
  Bucket,
  adminReports,
  adminReviewReport,
  adminSetSuspended,
  AdminReport,
} from '@/services/data';

/** A percentage of the previous funnel step, which is the number that shows
 *  where people give up. */

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="display">{value}</Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      {!!sub && (
        <Text variant="caption" tone="subtle" style={styles.statSub}>
          {sub}
        </Text>
      )}
    </View>
  );
}

/**
 * The founders' view.
 *
 * Access is decided by the database, not here: every call is an RPC that
 * checks membership of `admins` first. This screen renders "not found" for
 * anyone else rather than "forbidden", because confirming the route exists
 * tells someone there is something here worth attacking.
 */
/** The two questions the dashboard answers, kept apart. */
type AdminTab = 'overview' | 'impressions';

export default function AdminScreen() {
  const session = useSession();
  const stats = useAsync(adminStats, []);
  const [bucket, setBucket] = useState<Bucket>('day');
  const views = useAsync(() => adminViewStats(30), []);
  const [tab, setTab] = useState<AdminTab>('overview');
  // Only fetched when the tab is open: nobody reading the funnel needs fifty
  // rows of page views loaded behind it.
  const recent = useAsync(
    () => (tab === 'impressions' ? adminRecentViews() : Promise.resolve([])),
    [tab]
  );
  const signups = useAsync(() => signupsOverTime(bucket), [bucket]);
  const [showReviewed, setShowReviewed] = useState(false);
  const reports = useAsync(() => adminReports(showReviewed), [showReviewed]);
  const [busy, setBusy] = useState<string | null>(null);

  if (session === undefined || stats.loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  // Null means the RPC refused us. Indistinguishable from a page that is not
  // there, on purpose.
  if (!stats.data) {
    return (
      <View style={styles.container}>
        <EmptyState title="Not found" body="There's nothing at this address." />
      </View>
    );
  }

  const s = stats.data;
  const f = s.funnel;
  const rows = reports.data ?? [];

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      reports.reload();
      stats.reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Head>
        <title>Admin — SellWant</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <Text variant="caption" tone="subtle">
        Updated {relativeTime(s.generated_at)}
      </Text>

      {/* Dos vistas, no una lista infinita. Las impresiones responden una
          pregunta distinta del resto del panel -- cuánta gente llega -- y
          mezclarlas obliga a scrollear por el embudo para verlas. */}
      <SegmentedFilter
        options={[
          { value: 'overview' as AdminTab, label: 'Overview' },
          { value: 'impressions' as AdminTab, label: 'Impressions' },
        ]}
        value={tab}
        onChange={setTab}
        style={styles.tabs}
      />

      {tab === 'overview' && (
        <>

      {/* Growth ------------------------------------------------------- */}
      <Text variant="heading" style={styles.sectionFirst}>
        People
      </Text>
      <Card style={styles.statRow}>
        <Stat label="signed up" value={s.users.total} sub={`${s.users.confirmed} confirmed`} />
        <Separator style={styles.vline} />
        <Stat label="last 7 days" value={s.users.last_7d} sub={`${s.users.last_24h} today`} />
        <Separator style={styles.vline} />
        <Stat label="active this week" value={s.users.active_7d} sub={`${s.users.via_google} via Google`} />
      </Card>

      {/* Signups over time ------------------------------------------- */}
      <Text variant="heading" style={styles.section}>
        New accounts
      </Text>
      <Card style={styles.chartCard}>
        <SegmentedFilter
          options={[
            { value: 'day' as Bucket, label: 'Daily' },
            { value: 'week' as Bucket, label: 'Weekly' },
            { value: 'month' as Bucket, label: 'Monthly' },
          ]}
          value={bucket}
          onChange={setBucket}
        />
        {signups.error ? (
          <Text variant="small" tone="destructive" style={styles.chartNote}>
            {signups.error.message}
          </Text>
        ) : signups.data ? (
          <TimeSeriesLine points={signups.data} />
        ) : (
          // Keeps the card's height while the next granularity loads, so
          // switching Daily/Weekly does not make the page jump.
          <View style={styles.chartLoading}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        )}
      </Card>

      {/* Funnel — the most useful thing on the page -------------------- */}
      <Text variant="heading" style={styles.section}>
        Where people stop
      </Text>
      <Card>
        <FunnelChart
          stages={[
            { label: 'Signed up', value: f.signed_up },
            { label: 'Finished onboarding', value: f.onboarded },
            { label: 'Posted a listing', value: f.posted },
            { label: 'Made an offer', value: f.offered },
            { label: 'Agreed a deal', value: f.in_a_deal },
            { label: 'Completed a handoff', value: f.confirmed },
          ]}
        />
      </Card>

      {/* Market -------------------------------------------------------- */}
      <Text variant="heading" style={styles.section}>
        Market
      </Text>
      <Card style={styles.statRow}>
        <Stat label="live listings" value={s.listings.active} sub={`${s.listings.total} ever`} />
        <Separator style={styles.vline} />
        <Stat label="for sale" value={s.listings.for_sale} sub={`${s.listings.wanted} wanted`} />
        <Separator style={styles.vline} />
        <Stat label="offers" value={s.offers.total} sub={`${s.offers.open} open`} />
      </Card>
      <Card style={styles.statRowStacked}>
        <Stat label="deals done" value={s.deals.confirmed} sub={`${s.deals.in_progress} in progress`} />
        <Separator style={styles.vline} />
        <Stat
          label="cancelled"
          value={s.deals.cancelled}
          sub={
            s.deals.cancelled_after_paying > 0
              ? `${s.deals.cancelled_after_paying} after paying`
              : 'none after paying'
          }
        />
        <Separator style={styles.vline} />
        {/* Not revenue. Money never moves through SellWant; this is the size
            of the market being cleared. */}
        <Stat label="value cleared" value={money(s.deals.value_confirmed_cents)} sub="not revenue" />
      </Card>

      {/* Three compositions, because each of these is a set of mutually
          exclusive outcomes that adds up to its total. The people numbers
          above stay as figures: confirmed, via-Google and active-this-week
          overlap, so stacking them would draw a bar longer than the number of
          people who exist. */}
      <Card style={styles.chartCard}>
        <Text variant="small" tone="muted">
          Listings by state
        </Text>
        <CompositionBar
          parts={[
            { label: 'Live', value: s.listings.active },
            { label: 'In a deal', value: s.listings.locked },
            { label: 'Sold', value: s.listings.sold },
            { label: 'Taken down', value: s.listings.cancelled },
          ]}
        />
      </Card>

      <Card style={styles.chartCard}>
        <Text variant="small" tone="muted">
          What happens to an offer
        </Text>
        <CompositionBar
          parts={[
            { label: 'Open', value: s.offers.open },
            { label: 'Accepted', value: s.offers.accepted },
            { label: 'Declined', value: s.offers.declined },
            { label: 'Withdrawn', value: s.offers.withdrawn },
          ]}
        />
      </Card>

      <Card style={styles.chartCard}>
        <Text variant="small" tone="muted">
          What happens to a deal
        </Text>
        <CompositionBar
          parts={[
            { label: 'In progress', value: s.deals.in_progress },
            { label: 'Completed', value: s.deals.confirmed },
            { label: 'Cancelled', value: s.deals.cancelled },
          ]}
        />
      </Card>

      {/* Trust and safety ---------------------------------------------- */}
      <Text variant="heading" style={styles.section}>
        Trust &amp; safety
      </Text>
      <Card style={styles.statRow}>
        <Stat label="open reports" value={s.safety.reports_open} sub={`${s.safety.reports_total} ever`} />
        <Separator style={styles.vline} />
        <Stat label="suspended" value={s.safety.suspended} />
        <Separator style={styles.vline} />
        <Stat
          label="duplicate codes"
          value={s.safety.duplicate_codes}
          sub={`${s.safety.duplicate_codes_other_seller} by another seller`}
        />
      </Card>

      {/* Report queue --------------------------------------------------- */}
      <View style={styles.reportsHead}>
        <Text variant="heading">Reports</Text>
        <Pressable onPress={() => setShowReviewed((v) => !v)} hitSlop={8}>
          <Text variant="caption" tone="muted">
            {showReviewed ? 'Open only' : 'Include reviewed'}
          </Text>
        </Pressable>
      </View>

      {rows.length === 0 ? (
        <Card>
          <Text variant="small" tone="muted">
            {showReviewed ? 'No reports at all.' : 'Nothing waiting. '}
          </Text>
        </Card>
      ) : (
        rows.map((r: AdminReport) => (
          <Card key={r.id} accent={r.reviewed_at ? undefined : 'sell'} style={styles.report}>
            <View style={styles.reportTop}>
              <Text variant="bodyMedium">
                {r.subject_name || 'Someone'}{' '}
                <Text variant="caption" tone="subtle">
                  · {r.subject_deals} handoffs
                </Text>
              </Text>
              {r.subject_suspended && <Badge label="SUSPENDED" variant="sell" />}
            </View>
            <Text variant="caption" tone="subtle">
              reported by {r.reporter_name || 'someone'} · {relativeTime(r.created_at)}
              {r.listing_title ? ` · ${r.listing_title}` : ''}
            </Text>
            {!!r.body && (
              <Text variant="small" tone="muted" style={styles.reportBody}>
                “{r.body}”
              </Text>
            )}
            {r.reviewed_at ? (
              <Text variant="caption" tone="want" style={styles.reportBody}>
                Reviewed — {r.outcome || 'no note'}
              </Text>
            ) : (
              <View style={styles.reportActions}>
                <Button
                  title={r.subject_suspended ? 'Unsuspend' : 'Suspend'}
                  variant={r.subject_suspended ? 'outline' : 'sell'}
                  loading={busy === r.id}
                  onPress={() =>
                    act(r.id, () => adminSetSuspended(r.subject_id, !r.subject_suspended))
                  }
                />
                <Button
                  title="No action"
                  variant="outline"
                  onPress={() => act(r.id, () => adminReviewReport(r.id, 'No action taken'))}
                />
                <Button
                  title="Actioned"
                  variant="secondary"
                  onPress={() => act(r.id, () => adminReviewReport(r.id, 'Actioned'))}
                />
              </View>
            )}
          </Card>
        ))
      )}
        </>
      )}

      {tab === 'impressions' && (
        <>

      {/* Traffic ------------------------------------------------------- */}
      <Text variant="heading" style={styles.section}>
        Who is looking
      </Text>
      <Card style={styles.chartCard}>
        <Text variant="small" tone="muted">
          Page views, last 30 days
        </Text>
        {views.data ? (
          <>
            <TimeSeriesLine
              points={views.data.daily.map((d) => {
                const start = new Date(`${d.day}T00:00:00`);
                return {
                  start,
                  label: start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
                  // The tooltip has room to break the total apart, which is
                  // the whole reason to hover a traffic chart.
                  full: `${start.toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })} · ${d.feed} feed · ${d.listings} listings`,
                  count: d.total,
                };
              })}
            />
            {/* The split matters more than the total: feed views are people
                arriving, listing views are people going somewhere. */}
            <CompositionBar
              parts={[
                { label: 'Feed', value: views.data.daily.reduce((n, d) => n + d.feed, 0) },
                { label: 'Listings', value: views.data.daily.reduce((n, d) => n + d.listings, 0) },
              ]}
            />
          </>
        ) : (
          <Text variant="caption" tone="subtle" style={styles.chartNote}>
            Nothing yet — this fills once the migration is applied.
          </Text>
        )}
      </Card>

      {!!views.data?.top_listings.length && (
        <Card style={styles.chartCard}>
          <Text variant="small" tone="muted">
            Most looked at
          </Text>
          <FunnelChart
            stages={views.data.top_listings.slice(0, 6).map((l) => ({
              label: l.title,
              value: l.views,
            }))}
          />
        </Card>
      )}


          {/* Los registros crudos. Un panel que solo muestra agregados no deja
              contestar "¿esto que acabo de hacer se contó?", que es la primera
              pregunta cuando un número parece raro. */}
          <Text variant="heading" style={styles.section}>
            Últimas vistas
          </Text>
          <Text variant="caption" tone="subtle">
            Agrupadas por ruta, sobre las últimas {RECENT_VIEW_WINDOW} vistas.
          </Text>
          <Card style={styles.chartCard}>
            {recent.loading && !recent.data ? (
              <ActivityIndicator color={colors.mutedForeground} />
            ) : !recent.data?.length ? (
              <Text variant="caption" tone="subtle">
                Todavía nada. Se llena en cuanto corras la migración.
              </Text>
            ) : (
              recent.data.map((v, i) => (
                <View key={v.path}>
                  {i > 0 && <Separator style={styles.rowLine} />}
                  <View style={styles.viewRow}>
                    <View style={styles.viewMain}>
                      <Text variant="small" numberOfLines={1}>
                        {v.title ?? v.path}
                      </Text>
                      {!!v.title && (
                        <Text variant="caption" tone="subtle" numberOfLines={1}>
                          {v.path}
                        </Text>
                      )}
                    </View>
                    {/* El conteo primero: es la razón por la que la fila está
                        arriba. La hora es contexto, no el dato. */}
                    <View style={styles.viewCount}>
                      <Text variant="small">{v.views}</Text>
                      <Text variant="caption" tone="subtle">
                        {relativeTime(v.last)}
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </Card>
        </>
      )}

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
  centered: { alignItems: 'center', justifyContent: 'center' },
  sectionFirst: { marginTop: space[5], marginBottom: space[3] },
  chartCard: { marginTop: space[3] },
  tabs: { marginBottom: space[2] },
  rowLine: { marginHorizontal: -space[4] },
  viewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    paddingVertical: space[3],
  },
  viewMain: { flex: 1 },
  viewCount: { alignItems: 'flex-end' },
  chartNote: { marginTop: space[4] },
  chartLoading: { height: 176, alignItems: 'center', justifyContent: 'center' },
  section: { marginTop: space[8], marginBottom: space[3] },
  statRow: { flexDirection: 'row', alignItems: 'center' },
  statRowStacked: { flexDirection: 'row', alignItems: 'center', marginTop: space[3] },
  stat: { flex: 1, alignItems: 'center', gap: space[1] },
  statSub: { textAlign: 'center' },
  vline: { width: 1, height: 44, backgroundColor: colors.border },
  reportsHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: space[8],
    marginBottom: space[3],
  },
  report: { marginBottom: space[3] },
  reportTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reportBody: { marginTop: space[2], lineHeight: 20 },
  reportActions: { flexDirection: 'row', gap: space[2], marginTop: space[4], flexWrap: 'wrap' },
});
