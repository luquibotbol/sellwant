import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Text, Card, Badge, Button, Input } from '@/components/ui';
import { colors, space } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { money } from '@/lib/format';
import { mandateBoundCents, mandatePositiveInteger } from '@/lib/mandates';
import {
  Listing, myAgentMandates, createAgentMandateDraft,
  approveAgentMandate, revokeAgentMandate, getAgentMandateActions,
} from '@/services/data';

/** Human controls only. Agent capabilities cannot call approval RPCs. */
export default function MandatePanel({ listing, meId }: { listing: Listing; meId: string }) {
  const mandates = useAsync(() => myAgentMandates(listing.id), [listing.id, meId]);
  const side = (listing.type === 'sell') === (listing.user_id === meId) ? 'sell' : 'buy';
  const [amount, setAmount] = useState((listing.price_cents / 100).toFixed(2));
  const [minutes, setMinutes] = useState('60');
  const [rounds, setRounds] = useState('4');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [activityRevision, setActivityRevision] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const refresh = async () => {
    await mandates.reload();
    setActivityRevision(value => value + 1);
  };

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try { await action(); await refresh(); }
    catch (e) { setError((e as { message?: string })?.message ?? 'Could not update the mandate.'); }
    finally { setBusy(null); setNow(Date.now()); }
  };

  const draft = () => run('draft', async () => {
    const boundCents = mandateBoundCents(amount);
    const duration = mandatePositiveInteger(minutes, 10080, 'Minutes');
    const maxRounds = mandatePositiveInteger(rounds, 100, 'Rounds');
    await createAgentMandateDraft({
      listingId: listing.id, side, boundCents, maxRounds,
      expiresAt: new Date(Date.now() + duration * 60000).toISOString(),
    });
    setEditing(false);
  });

  const rows = mandates.data ?? [];
  const canDraft = listing.status === 'active';
  const showForm = canDraft && (editing || (rows.length === 0 && !mandates.loading && !mandates.error));

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text variant="heading">Your agent mandate</Text>
        <Button title="Refresh" size="sm" variant="ghost" disabled={!!busy || mandates.loading} onPress={refresh} />
      </View>
      <Text variant="small" tone="muted" style={styles.intro}>
        Review a price limit for this ticket. Approval lets an agent negotiate and lock one deal within your terms.
      </Text>

      {mandates.loading && !mandates.data && <ActivityIndicator color={colors.mutedForeground} style={styles.gap} />}
      {!!mandates.error && <Text variant="small" tone="destructive" accessibilityLiveRegion="polite" style={styles.gap}>{mandates.error.message}</Text>}
      {!!error && <Text variant="small" tone="destructive" accessibilityLiveRegion="polite" style={styles.gap}>{error}</Text>}

      {rows.map(m => {
        const expired = Date.parse(m.expires_at) <= now;
        const status = expired && (m.status === 'draft' || m.status === 'approved') ? 'expired' : m.status;
        const actionable = !expired && (m.status === 'draft' || m.status === 'approved');
        return (
          <Card key={m.id} accent={m.side === 'buy' ? 'want' : 'sell'} style={styles.mandate}>
            <View style={styles.header}>
              <Text variant="heading" tone={m.side === 'buy' ? 'want' : 'sell'}>
                {m.side === 'buy' ? 'Maximum' : 'Minimum'} {money(m.bound_cents)} USD
              </Text>
              <Badge label={status.toUpperCase()} variant="outline" />
            </View>
            <Text variant="bodyMedium" style={styles.gap}>{m.listing_snapshot.title}</Text>
            {!!m.listing_snapshot.description && <Text variant="small" tone="muted" style={styles.smallGap}>{m.listing_snapshot.description}</Text>}
            <Text variant="small" tone="muted" style={styles.smallGap}>
              {m.listing_snapshot.event_date ?? 'Date not set'} · {m.listing_snapshot.location ?? 'Location not set'}
            </Text>
            <Text variant="caption" tone="subtle" selectable style={styles.smallGap}>Listing {m.listing_id}</Text>
            <Text variant="small" style={styles.gap}>Until {new Date(m.expires_at).toLocaleString()}</Text>
            <Text variant="small" tone="muted" style={styles.smallGap}>
              {m.rounds_used} of {m.max_rounds} negotiation rounds used · one deal
            </Text>
            {m.status === 'draft' && !expired && (
              <>
                <Text variant="small" tone="muted" style={styles.gap}>
                  Approve these exact terms. PayPal payment approval and your in-person handoff confirmation are separate steps.
                </Text>
                <Button title="Approve these terms" variant={m.side === 'buy' ? 'want' : 'sell'}
                  loading={busy === m.id} disabled={!!busy || !canDraft} style={styles.gap}
                  onPress={() => run(m.id, () => approveAgentMandate(m))} block />
              </>
            )}
            {m.status === 'approved' && !expired && (
              <Text variant="small" tone="muted" style={styles.gap}>
                Approved for an agent to use within these limits. Refresh to check for a locked deal.
              </Text>
            )}
            {actionable && (
              <Button title={m.status === 'draft' ? 'Discard draft' : 'Revoke mandate'} variant="outline"
                loading={busy === `revoke-${m.id}`} disabled={!!busy} style={styles.gap}
                onPress={() => run(`revoke-${m.id}`, () => revokeAgentMandate(m.id))} block />
            )}
            {!!m.deal_id && <Button title="Open locked deal" variant="secondary" style={styles.gap}
              onPress={() => router.navigate(`/deal/${m.deal_id}` as never)} block />}
            {m.status !== 'draft' && <MandateActivity mandateId={m.id} revision={activityRevision} />}
          </Card>
        );
      })}

      {showForm ? (
        <Card style={styles.mandate}>
          <Text variant="bodyMedium" style={styles.intro}>{side === 'buy' ? 'Buy this ticket' : 'Sell this ticket'}</Text>
          <Input label={side === 'buy' ? 'Maximum price (USD)' : 'Minimum price (USD)'}
            accessibilityLabel={side === 'buy' ? 'Maximum price in USD' : 'Minimum price in USD'}
            keyboardType="decimal-pad" value={amount} onChangeText={setAmount} editable={!busy} />
          <Input label="Expires in (minutes)" accessibilityLabel="Mandate duration in minutes"
            hint="1 to 10,080 minutes (7 days)." keyboardType="number-pad" value={minutes} onChangeText={setMinutes} editable={!busy} />
          <Input label="Maximum negotiation rounds" accessibilityLabel="Maximum negotiation rounds"
            hint="1 to 100 rounds." keyboardType="number-pad" value={rounds} onChangeText={setRounds} editable={!busy} />
          <Button title="Review draft" loading={busy === 'draft'} disabled={!!busy} onPress={draft} block />
          {rows.length > 0 && <Button title="Close" variant="ghost" disabled={!!busy} onPress={() => setEditing(false)} style={styles.smallGap} block />}
        </Card>
      ) : canDraft && !mandates.loading && !mandates.error && (
        <Button title="Set another mandate" variant="outline" disabled={!!busy} onPress={() => setEditing(true)} style={styles.gap} block />
      )}
      {rows.length > 0 && <Text variant="caption" tone="subtle" style={styles.gap}>
        Revoking stops future agent actions. Cancel a locked deal from the deal screen.
      </Text>}
    </View>
  );
}

function MandateActivity({ mandateId, revision }: { mandateId: string; revision: number }) {
  const activity = useAsync(() => getAgentMandateActions(mandateId), [mandateId, revision]);
  if (activity.loading && !activity.data) return null;
  if (activity.error) return <Text variant="caption" tone="destructive" style={styles.gap}>{activity.error.message}</Text>;
  return (
    <View style={styles.activity}>
      <Text variant="small" tone="muted">Recent agent actions</Text>
      {activity.data?.length ? activity.data.map(action => (
        <View key={action.id} style={styles.gap}>
          <Text variant="small">
            {action.status === 'rejected' ? 'Proposal rejected' : action.action === 'place_offer' ? 'Public offer posted' : 'Deal locked'}
          </Text>
          {!!action.explanation && <Text variant="small" tone="muted" style={styles.smallGap}>{action.explanation}</Text>}
          <Text variant="caption" tone="subtle" style={styles.smallGap}>{new Date(action.created_at).toLocaleString()}</Text>
        </View>
      )) : <Text variant="caption" tone="subtle" style={styles.smallGap}>No agent actions recorded.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: space[6], borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[5] },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  intro: { marginTop: space[2], marginBottom: space[4] },
  mandate: { marginTop: space[3] },
  gap: { marginTop: space[3] },
  smallGap: { marginTop: space[2] },
  activity: { marginTop: space[4], paddingTop: space[3], borderTopWidth: 1, borderTopColor: colors.border },
});
