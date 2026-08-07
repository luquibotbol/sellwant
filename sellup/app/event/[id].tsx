import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, Card, Badge, Button, Separator, ErrorState, EmptyState } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { getListing, getSession, createLockIn } from '@/services/data';

const money = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useAsync(() => getListing(id), [id]);
  const session = useAsync(getSession, []);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  if (listing.loading || session.loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (listing.error) {
    return (
      <View style={styles.container}>
        <ErrorState message={listing.error.message} onRetry={listing.reload} />
      </View>
    );
  }
  if (!listing.data) {
    return (
      <View style={styles.container}>
        <EmptyState
          title="Listing not found"
          body="It may have been sold or taken down."
          actionLabel="Back to feed"
          onAction={() => router.replace('/feed')}
        />
      </View>
    );
  }

  const l = listing.data;
  const selling = l.type === 'sell';
  const mine = session.data?.user.id === l.user_id;

  const lockIn = async () => {
    setLockError(null);
    setLocking(true);
    try {
      await createLockIn(l);
      // The handoff flow is the next sub-project; for now confirm and return.
      router.replace('/feed');
    } catch (e: any) {
      setLockError(e?.message ?? 'Could not lock this in');
    } finally {
      setLocking(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <Badge label={selling ? 'FOR SALE' : 'WANTED'} variant={selling ? 'sell' : 'want'} />
        <Text variant="display" tone={selling ? 'sell' : 'want'}>
          {money(l.price_cents)}
        </Text>
      </View>

      <Text variant="title" style={styles.title}>
        {l.title}
      </Text>

      {!!l.description && (
        <Text variant="body" tone="muted" style={styles.description}>
          {l.description}
        </Text>
      )}

      <Card style={styles.details}>
        <Row label="When" value={l.event_date ?? 'Not set'} />
        <Separator style={styles.divider} />
        <Row label="Where" value={l.location ?? 'Not set'} />
        {l.platform && (
          <>
            <Separator style={styles.divider} />
            <Row label="Platform" value={l.platform === 'bubbl' ? 'Bubbl' : l.platform} />
          </>
        )}
      </Card>

      {l.poster && (
        <Card style={styles.poster}>
          <Text variant="bodyMedium">{l.poster.full_name || 'Someone'}</Text>
          <Text variant="small" tone="muted" style={styles.posterMeta}>
            {l.poster.completed_deals}{' '}
            {l.poster.completed_deals === 1 ? 'completed handoff' : 'completed handoffs'}
          </Text>
        </Card>
      )}

      {/* Bubbl QRs are static -- the seller keeps a working copy after sending
          one. We can guarantee the code is unique here, not that it is safe, so
          the honest instruction is to meet and scan in immediately. */}
      {selling && (
        <Card style={styles.safety}>
          <Text variant="bodyMedium">Meet at the door</Text>
          <Text variant="small" tone="muted" style={styles.safetyBody}>
            Bubbl codes can&apos;t be transferred, so the seller keeps a copy.
            Pay when you meet, then scan in straight away.
          </Text>
        </Card>
      )}

      {!!lockError && (
        <Text variant="small" tone="destructive" style={styles.lockError}>
          {lockError}
        </Text>
      )}

      {mine ? (
        <Text variant="small" tone="subtle" style={styles.mine}>
          This is your listing.
        </Text>
      ) : (
        <Button
          title={selling ? `Lock in at ${money(l.price_cents)}` : 'I have one — respond'}
          onPress={lockIn}
          loading={locking}
          block
          style={styles.action}
        />
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="small" tone="muted">
        {label}
      </Text>
      <Text variant="small">{value}</Text>
    </View>
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { marginTop: space[4] },
  description: { marginTop: space[3] },
  details: { marginTop: space[6], paddingVertical: space[1] },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space[3] },
  divider: { marginHorizontal: -space[4] },
  poster: { marginTop: space[3] },
  posterMeta: { marginTop: space[1] },
  safety: { marginTop: space[3] },
  safetyBody: { marginTop: space[2] },
  lockError: { marginTop: space[4] },
  action: { marginTop: space[6] },
  mine: { marginTop: space[6], textAlign: 'center' },
});
