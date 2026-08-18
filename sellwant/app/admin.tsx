import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import Head from 'expo-router/head';
import { Text, Card, Badge, Button, Separator, EmptyState } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { money, relativeTime } from '@/lib/format';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import {
  adminStats,
  adminReports,
  adminReviewReport,
  adminSetSuspended,
  AdminReport,
} from '@/services/data';

/** A percentage of the previous funnel step, which is the number that shows
 *  where people give up. */
const pct = (n: number, of: number) => (of === 0 ? '—' : `${Math.round((n / of) * 100)}%`);

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
export default function AdminScreen() {
  const session = useSession();
  const stats = useAsync(adminStats, []);
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

      {/* Funnel — the most useful thing on the page -------------------- */}
      <Text variant="heading" style={styles.section}>
        Where people stop
      </Text>
      <Card>
        {[
          { label: 'Signed up', n: f.signed_up, of: f.signed_up },
          { label: 'Finished onboarding', n: f.onboarded, of: f.signed_up },
          { label: 'Posted a listing', n: f.posted, of: f.onboarded },
          { label: 'Made an offer', n: f.offered, of: f.onboarded },
          { label: 'Agreed a deal', n: f.in_a_deal, of: f.onboarded },
          { label: 'Completed a handoff', n: f.confirmed, of: f.in_a_deal },
        ].map((step, i) => (
          <View key={step.label}>
            {i > 0 && <Separator style={styles.divider} />}
            <View style={styles.funnelRow}>
              <Text variant="small" tone="muted">
                {step.label}
              </Text>
              <View style={styles.funnelRight}>
                <Text variant="bodyMedium">{step.n}</Text>
                {i > 0 && (
                  <Text variant="caption" tone="subtle">
                    {pct(step.n, step.of)} of previous
                  </Text>
                )}
              </View>
            </View>
          </View>
        ))}
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
  section: { marginTop: space[8], marginBottom: space[3] },
  statRow: { flexDirection: 'row', alignItems: 'center' },
  statRowStacked: { flexDirection: 'row', alignItems: 'center', marginTop: space[3] },
  stat: { flex: 1, alignItems: 'center', gap: space[1] },
  statSub: { textAlign: 'center' },
  vline: { width: 1, height: 44, backgroundColor: colors.border },
  divider: { marginHorizontal: -space[4] },
  funnelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space[3],
  },
  funnelRight: { alignItems: 'flex-end' },
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
