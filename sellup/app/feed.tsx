import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import Colors from '@/constants/colors';
import Button from '@/components/Button';
import { useAsync } from '@/hooks/useAsync';
import { getSession, listActive, ListingType, ListingWithPoster } from '@/services/data';

type Filter = 'all' | ListingType;

const money = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

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
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }
  if (!session.data) return <Redirect href="/" />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Coming up</Text>
        <Pressable onPress={() => router.push('/profile')}>
          <Text style={styles.link}>Profile</Text>
        </Pressable>
      </View>

      <View style={styles.filters}>
        {(['all', 'sell', 'ask'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.chip, filter === f && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {f === 'all' ? 'Everything' : f === 'sell' ? 'For sale' : 'Wanted'}
            </Text>
          </Pressable>
        ))}
      </View>

      {listings.error ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Couldn&apos;t load the feed</Text>
          <Text style={styles.errorBody}>{listings.error.message}</Text>
          <Button title="Try again" onPress={listings.reload} style={styles.retry} />
        </View>
      ) : (
        <FlatList
          data={listings.data ?? []}
          keyExtractor={(l) => l.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={listings.loading}
              onRefresh={listings.reload}
              tintColor={Colors.accent}
            />
          }
          ListEmptyComponent={
            listings.loading ? null : (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>Nothing posted yet</Text>
                <Text style={styles.errorBody}>
                  Be the first — post a ticket you&apos;re selling, or ask for one you want.
                </Text>
                <Button
                  title="Post a listing"
                  onPress={() => router.push('/create-event')}
                  style={styles.retry}
                />
              </View>
            )
          }
          renderItem={({ item }: { item: ListingWithPoster }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/listing/${item.id}` as never)}
            >
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.badge,
                    item.type === 'ask' ? styles.badgeAsk : styles.badgeSell,
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {item.type === 'ask' ? 'WANTED' : 'FOR SALE'}
                  </Text>
                </View>
                <Text style={styles.price}>{money(item.price_cents)}</Text>
              </View>

              <Text style={styles.cardTitle}>{item.title}</Text>

              <Text style={styles.meta}>
                {[item.location, item.event_date].filter(Boolean).join(' · ') ||
                  'No date set'}
              </Text>

              {item.poster && (
                <Text style={styles.poster}>
                  {item.poster.full_name || 'Someone'} ·{' '}
                  {item.poster.completed_deals} completed
                </Text>
              )}
            </Pressable>
          )}
        />
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/create-event')}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 32, flexGrow: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12,
  },
  title: { color: Colors.text, fontSize: 28, fontWeight: 'bold' },
  link: { color: Colors.accent, fontSize: 15 },
  filters: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText: { color: Colors.textSecondary, fontSize: 14 },
  chipTextActive: { color: Colors.card, fontWeight: '600' },
  list: { padding: 20, gap: 12, flexGrow: 1 },
  card: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeSell: { backgroundColor: Colors.accent },
  badgeAsk: { backgroundColor: Colors.textSecondary },
  badgeText: { color: Colors.card, fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5 },
  price: { color: Colors.accent, fontSize: 20, fontWeight: 'bold' },
  cardTitle: { color: Colors.text, fontSize: 17, fontWeight: '600', marginTop: 10 },
  meta: { color: Colors.textSecondary, fontSize: 14, marginTop: 4 },
  poster: { color: Colors.textSecondary, fontSize: 13, marginTop: 8 },
  emptyTitle: { color: Colors.text, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  errorTitle: { color: Colors.error, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  errorBody: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: { marginTop: 20 },
  fab: {
    position: 'absolute', right: 24, bottom: 32, width: 56, height: 56,
    borderRadius: 28, backgroundColor: Colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  fabText: { color: Colors.card, fontSize: 30, fontWeight: '300', marginTop: -2 },
});
