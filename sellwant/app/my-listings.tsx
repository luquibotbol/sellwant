import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Text, Card, Badge, Button, EmptyState, ErrorState } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { money, whenAndWhere } from '@/lib/format';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import { myListings, cancelListing, ListingWithPoster, ListingStatus } from '@/services/data';

const STATUS: Record<ListingStatus, { label: string; variant: 'outline' | 'want' | 'default' }> = {
  active: { label: 'LIVE', variant: 'outline' },
  locked: { label: 'DEAL IN PROGRESS', variant: 'want' },
  sold: { label: 'SOLD', variant: 'default' },
  cancelled: { label: 'TAKEN DOWN', variant: 'default' },
};

export default function MyListingsScreen() {
  const session = useSession();
  const listings = useAsync(myListings, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (session === undefined) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (!session) return <Redirect href="/" />;

  const rows = listings.data ?? [];
  // Live first, then in-progress, then history.
  const rank = (s: ListingStatus) => (s === 'active' ? 0 : s === 'locked' ? 1 : 2);
  const sorted = [...rows].sort((a, b) => rank(a.status) - rank(b.status));

  const takeDown = async (id: string) => {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setBusy(id);
    setError(null);
    try {
      await cancelListing(id);
      listings.reload();
    } catch (e: any) {
      setError(e?.message ?? 'Could not take that down');
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.frame}>
        {!!error && (
          <Text variant="small" tone="destructive" style={styles.error}>
            {error}
          </Text>
        )}

        {listings.error ? (
          <ErrorState message={listings.error.message} onRetry={listings.reload} />
        ) : listings.loading && !listings.data ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : sorted.length === 0 ? (
          <EmptyState
            title="You haven't posted anything"
            body="Sell a ticket you can't use, or ask for one you want."
            actionLabel="Post a listing"
            onAction={() => router.push('/create-event')}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {sorted.map((l: ListingWithPoster) => {
              const selling = l.type === 'sell';
              const badge = STATUS[l.status];
              const live = l.status === 'active';

              return (
                <Card
                  key={l.id}
                  accent={selling ? 'sell' : 'want'}
                  style={styles.card}
                  onPress={() => router.push(`/event/${l.id}` as never)}
                >
                  <View style={styles.top}>
                    <Badge label={badge.label} variant={badge.variant} />
                    <Text variant="heading" tone={selling ? 'sell' : 'want'}>
                      {money(l.price_cents)}
                    </Text>
                  </View>

                  <Text variant="bodyMedium" style={styles.title} numberOfLines={1}>
                    {l.title}
                  </Text>
                  <Text variant="small" tone="muted">
                    {whenAndWhere(l.event_date, l.location) || 'No date set'}
                  </Text>

                  {l.offer_count > 0 && (
                    <Text
                      variant="caption"
                      tone={selling ? 'sell' : 'want'}
                      style={styles.offers}
                    >
                      {l.offer_count} open {l.offer_count === 1 ? 'offer' : 'offers'}
                      {l.best_offer_cents != null &&
                        ` · ${selling ? 'top' : 'lowest'} ${money(l.best_offer_cents)}`}
                    </Text>
                  )}

                  {live && (
                    <Button
                      title={confirming === l.id ? 'Tap again to take it down' : 'Take down'}
                      variant="outline"
                      size="sm"
                      loading={busy === l.id}
                      onPress={() => takeDown(l.id)}
                      style={styles.action}
                    />
                  )}

                  {/* Taking a sell listing down frees its registered QR, so the
                      seller can list the same ticket again later without
                      colliding with themselves. Worth saying out loud. */}
                  {confirming === l.id && selling && (
                    <Text variant="caption" tone="subtle" style={styles.note}>
                      This frees the ticket code, so you can post it again later.
                    </Text>
                  )}

                  {l.status === 'locked' && (
                    <Text variant="caption" tone="subtle" style={styles.note}>
                      Someone's mid-handoff on this. Cancel from the deal if it falls through.
                    </Text>
                  )}
                </Card>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  frame: { flex: 1, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  centered: { alignItems: 'center', justifyContent: 'center', flexGrow: 1, padding: space[6] },
  error: { margin: space[5] },
  list: { padding: space[5], paddingBottom: space[16] },
  card: { marginBottom: space[3] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { marginTop: space[3] },
  offers: { marginTop: space[2] },
  action: { marginTop: space[4], alignSelf: 'flex-start' },
  note: { marginTop: space[2] },
});
