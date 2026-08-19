import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Redirect, router } from 'expo-router';
import {
  Text,
  Card,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  SegmentedFilter,
} from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { money, whenAndWhere } from '@/lib/format';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import {
  myListings,
  removeListing,
  ListingWithPoster,
  ListingStatus,
  ListingType,
} from '@/services/data';

const STATUS: Record<ListingStatus, { label: string; variant: 'outline' | 'want' | 'default' }> = {
  active: { label: 'LIVE', variant: 'outline' },
  locked: { label: 'DEAL IN PROGRESS', variant: 'want' },
  sold: { label: 'SOLD', variant: 'default' },
  cancelled: { label: 'TAKEN DOWN', variant: 'default' },
};

type Which = 'all' | ListingType;

export default function MyListingsScreen() {
  const session = useSession();
  const listings = useAsync(myListings, []);
  const [which, setWhich] = useState<Which>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (session === undefined) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (!session) return <Redirect href="/signin" />;

  const rows = listings.data ?? [];
  // Counts come from everything you posted, not the current filter -- a tab
  // that reads "(0)" is the reason to not bother tapping it.
  const counts = {
    all: rows.length,
    sell: rows.filter((l) => l.type === 'sell').length,
    ask: rows.filter((l) => l.type === 'ask').length,
  };
  const filtered = which === 'all' ? rows : rows.filter((l) => l.type === which);
  // Live first, then in-progress, then history.
  const rank = (s: ListingStatus) => (s === 'active' ? 0 : s === 'locked' ? 1 : 2);
  const sorted = [...filtered].sort((a, b) => rank(a.status) - rank(b.status));

  const remove = async (id: string) => {
    if (removing !== id) {
      setRemoving(id);
      return;
    }
    setBusy(id);
    setError(null);
    try {
      // Taken down rather than deleted when somebody has committed; the list
      // reloads either way and shows the status it ended up in.
      await removeListing(id);
      listings.reload();
    } catch (e: any) {
      setError(e?.message ?? 'Could not remove that');
    } finally {
      setBusy(null);
      setRemoving(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.frame}>
        {/* Same control and wording as the feed: these split the same two
            listing types, so they should not look like different ideas. */}
        <SegmentedFilter
          value={which}
          onChange={setWhich}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'sell', label: 'For sale', count: counts.sell },
            { value: 'ask', label: 'Wanted', count: counts.ask },
          ]}
          style={styles.filter}
        />

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
            onAction={() => router.navigate('/create-event')}
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
                  onPress={() => router.navigate(`/event/${l.id}` as never)}
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
                    <View style={styles.actions}>
                      <Button
                        title="Edit"
                        variant="secondary"
                        size="sm"
                        onPress={() => router.navigate(`/edit/${l.id}` as never)}
                      />
                      <Button
                        title={removing === l.id ? 'Tap again to delete' : 'Delete'}
                        variant="outline"
                        size="sm"
                        loading={busy === l.id}
                        onPress={() => remove(l.id)}
                      />
                    </View>
                  )}

                  {removing === l.id && (
                    <Text variant="caption" tone="destructive" style={styles.note}>
                      {l.offer_count > 0
                        ? `${l.offer_count} ${l.offer_count === 1 ? 'person has' : 'people have'} offered on this. Deleting ends that.`
                        : 'This removes the listing.'}
                    </Text>
                  )}

                  {/* Removing a sell listing frees its registered QR, so the
                      seller can list the same ticket again later without
                      colliding with themselves. Worth saying out loud. */}
                  {removing === l.id && selling && (
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
  filter: { marginHorizontal: space[5], marginTop: space[4], marginBottom: space[2] },
  frame: { flex: 1, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  centered: { alignItems: 'center', justifyContent: 'center', flexGrow: 1, padding: space[6] },
  error: { margin: space[5] },
  list: { padding: space[5], paddingBottom: space[16] },
  card: { marginBottom: space[3] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { marginTop: space[3] },
  offers: { marginTop: space[2] },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[4], flexWrap: 'wrap' },
  action: { marginTop: space[4], alignSelf: 'flex-start' },
  note: { marginTop: space[2] },
});
