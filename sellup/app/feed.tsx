import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import {
  Text,
  Card,
  Badge,
  Skeleton,
  EmptyState,
  ErrorState,
} from '@/components/ui';
import { colors, space, radius, maxContentWidth } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { getSession, listActive, ListingType, ListingWithPoster } from '@/services/data';

type Filter = 'all' | ListingType;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'sell', label: 'For sale' },
  { key: 'ask', label: 'Wanted' },
];

const money = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** "Fri · Sig Ep house" rather than an ISO date. */
function whenAndWhere(date: string | null, location: string | null) {
  const parts: string[] = [];
  if (date) {
    const d = new Date(`${date}T00:00:00`);
    const today = new Date();
    const days = Math.round((d.getTime() - new Date(today.toDateString()).getTime()) / 86400000);
    parts.push(
      days === 0 ? 'Tonight'
      : days === 1 ? 'Tomorrow'
      : days > 1 && days < 7 ? d.toLocaleDateString(undefined, { weekday: 'long' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    );
  }
  if (location) parts.push(location);
  return parts.join(' · ');
}

export default function FeedScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const session = useAsync(getSession, []);
  const listings = useAsync(
    () => listActive(filter === 'all' ? {} : { type: filter }),
    [filter]
  );

  if (session.loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (!session.data) return <Redirect href="/" />;

  return (
    <View style={styles.container}>
      <View style={styles.frame}>
        <View style={styles.header}>
          <Text variant="title">SellUp</Text>
          <Pressable onPress={() => router.push('/profile')} hitSlop={8}>
            <Text variant="small" tone="muted">
              Profile
            </Text>
          </Pressable>
        </View>

        <View style={styles.tabs}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text variant={active ? 'bodyMedium' : 'body'} tone={active ? 'default' : 'muted'}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {listings.error ? (
          <ErrorState message={listings.error.message} onRetry={listings.reload} />
        ) : listings.loading && !listings.data ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} style={styles.cardSkeleton} />
            ))}
          </View>
        ) : (
          <FlatList
            data={listings.data ?? []}
            keyExtractor={(l) => l.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={listings.loading}
                onRefresh={listings.reload}
                tintColor={colors.mutedForeground}
              />
            }
            ListEmptyComponent={
              <EmptyState
                title="Nothing here yet"
                body="Post a ticket you're selling, or ask for one you want."
                actionLabel="Post a listing"
                onAction={() => router.push('/create-event')}
              />
            }
            renderItem={({ item }: { item: ListingWithPoster }) => {
              const isSell = item.type === 'sell';
              return (
                <Card
                  accent={isSell ? 'sell' : 'want'}
                  onPress={() => router.push(`/event/${item.id}` as never)}
                  style={styles.card}
                >
                  <View style={styles.cardTop}>
                    <Badge
                      label={isSell ? 'FOR SALE' : 'WANTED'}
                      variant={isSell ? 'sell' : 'want'}
                    />
                    <Text variant="heading" tone={isSell ? 'sell' : 'want'}>
                      {money(item.price_cents)}
                    </Text>
                  </View>

                  <Text variant="bodyMedium" style={styles.cardTitle}>
                    {item.title}
                  </Text>

                  <Text variant="small" tone="muted">
                    {whenAndWhere(item.event_date, item.location) || 'No date set'}
                  </Text>

                  {item.poster && (
                    <Text variant="caption" tone="subtle" style={styles.poster}>
                      {item.poster.full_name || 'Someone'} · {item.poster.completed_deals}{' '}
                      {item.poster.completed_deals === 1 ? 'handoff' : 'handoffs'}
                    </Text>
                  )}
                </Card>
              );
            }}
          />
        )}
      </View>

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() => router.push('/create-event')}
      >
        <Text variant="title" tone="inverse" style={styles.fabPlus}>
          +
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  frame: { flex: 1, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[5],
    paddingTop: space[16],
    paddingBottom: space[4],
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: space[5],
    marginBottom: space[4],
    padding: 3,
    gap: 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space[2],
    borderRadius: radius.md,
  },
  tabActive: { backgroundColor: colors.muted },
  list: { paddingHorizontal: space[5], paddingBottom: space[16], gap: space[3] },
  card: { marginBottom: space[3] },
  cardSkeleton: { height: 116, borderRadius: radius.xl, marginBottom: space[3] },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { marginTop: space[3] },
  poster: { marginTop: space[3] },
  fab: {
    position: 'absolute',
    right: space[6],
    bottom: space[8],
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPressed: { opacity: 0.85 },
  fabPlus: { marginTop: -2 },
});
