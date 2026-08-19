import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Platform,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import Head from 'expo-router/head';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Text,
  Wordmark,
  Avatar,
  Card,
  Badge,
  Input,
  Skeleton,
  EmptyState,
  ErrorState,
} from '@/components/ui';
import { colors, space, radius, maxContentWidth } from '@/constants/theme';
import { money, whenAndWhere } from '@/lib/format';
import CitySelect from '@/components/CitySelect';
import { City } from '@/lib/cities';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import {
  getMyProfile,
  listActive,
  FEED_PAGE_SIZE,
  listCategories,
  ListingType,
  ListingWithPoster,
} from '@/services/data';

type Filter = 'all' | ListingType;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'sell', label: 'For sale' },
  { key: 'ask', label: 'Wanted' },
];

export default function FeedScreen() {
  // Real insets rather than a hardcoded top pad -- with viewport-fit=cover the
  // background runs under the notch, so content has to be told where safe is.
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<City | null>(null);
  const [debounced, setDebounced] = useState('');

  // Search runs in Postgres, so debounce rather than firing per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const session = useSession();
  const me = useAsync(getMyProfile, []);
  const categories = useAsync(listCategories, []);
  const listings = useAsync(
    () =>
      listActive({
        type: filter === 'all' ? undefined : filter,
        q: debounced || undefined,
        categoryId: categoryId ?? undefined,
        city: city ?? undefined,
      }),
    [filter, debounced, categoryId, city]
  );

  // Pages after the first. useAsync owns page one and refetches it whenever a
  // filter changes; these accumulate on top and reset with it.
  const [more, setMore] = useState<ListingWithPoster[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setMore([]);
    setExhausted(false);
  }, [filter, debounced, categoryId, city]);

  const rows = useMemo(
    () => [...(listings.data ?? []), ...more],
    [listings.data, more]
  );

  const loadMore = async () => {
    // A short first page means there is no second one; asking again on every
    // bounce of a scroll would be a request per frame.
    if (loadingMore || exhausted || listings.loading) return;
    if ((listings.data?.length ?? 0) < FEED_PAGE_SIZE) return setExhausted(true);

    setLoadingMore(true);
    try {
      const next = await listActive({
        type: filter === 'all' ? undefined : filter,
        q: debounced || undefined,
        categoryId: categoryId ?? undefined,
        city: city ?? undefined,
        offset: rows.length,
      });
      if (next.length < FEED_PAGE_SIZE) setExhausted(true);
      // Filters can change mid-flight; dropping duplicates is cheaper than
      // cancelling, and a repeated key is what makes a list flicker.
      setMore((prev) => {
        const seen = new Set([...(listings.data ?? []), ...prev].map((l) => l.id));
        return [...prev, ...next.filter((l) => !seen.has(l.id))];
      });
    } catch {
      // A failed page is not a failed screen: what is already listed stays.
      setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const searching = !!debounced || categoryId !== null || city !== null;

  // The site's default metadata, not just the feed's. expo-router keeps the
  // initial route mounted beneath every screen, so this Head wins everywhere
  // -- which is why per-route overrides are applied by the Worker instead of
  // by each screen, where they would silently lose this fight.
  const head = (
    <Head>
      <title>Buy and sell event tickets — SellWant</title>
      <meta
        name="description"
        content="Free marketplace for student event tickets. Browse what people are selling, post what you're looking for, and see the going rate before you commit. No fees, no commission."
      />
      {/* `/` and `/feed` render the same screen. Pointing both at the apex
          stops them competing as duplicates. */}
      <link rel="canonical" href="https://sellwant.com/" />
    </Head>
  );

  if (session === undefined || me.loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        {head}
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  // Logged out is a normal state here: the feed is the shop window, and a link
  // pasted into a group chat has to open for people who have never heard of us.
  // Everything that acts on a listing still asks for an account.
  const anon = !session;
  // Everyone trades under a real name, so the profile has to be finished first.
  if (session && me.data && !me.data.onboarded_at) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <View style={styles.container}>
      {head}
      <View style={styles.frame}>
        <View style={[styles.header, { paddingTop: insets.top + space[4] }]}>
          <Wordmark size="title" animate />
          {/* Navigation moved to the bottom bar -- three text links crowded
              the wordmark on a phone and got worse with every screen. */}
        </View>

        <View style={styles.searchRow}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name"
            autoCapitalize="none"
            autoCorrect={false}
            containerStyle={styles.search}
          />
          <CitySelect value={city} onChange={setCity} />
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

        {/* Category is a secondary axis to the buy/sell filter above, so it
            reads as a quiet underline nav rather than a second row of pills --
            two bordered control groups at equal weight was visual noise. */}
        {/* A horizontal ScrollView is still a flex child of a column, so without
            flexGrow:0 it stretches to fill the remaining height -- which pushed
            the list down and left its scrollbar floating mid-screen. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoriesScroll}
          contentContainerStyle={styles.categories}
        >
          {[{ id: null as number | null, name: 'All' }, ...(categories.data ?? [])].map(
            (c) => {
              const active = categoryId === c.id;
              return (
                <Pressable
                  key={c.id ?? 'all'}
                  onPress={() => setCategoryId(c.id)}
                  style={[styles.category, active && styles.categoryActive]}
                >
                  <Text
                    variant={active ? 'bodyMedium' : 'body'}
                    tone={active ? 'default' : 'subtle'}
                  >
                    {c.name}
                  </Text>
                </Pressable>
              );
            }
          )}
        </ScrollView>

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
            data={rows}
            onEndReached={loadMore}
            // Half a screen early, so the next page is usually already there.
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator color={colors.mutedForeground} style={styles.footer} />
              ) : null
            }
            keyExtractor={(l) => l.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            // Pull-to-refresh is a touch gesture. On web RNW still reserves
            // space for the spinner, which left a gap and a stray dash above
            // the list.
            refreshControl={
              Platform.OS === 'web' ? undefined : (
                <RefreshControl
                  refreshing={listings.loading}
                  onRefresh={listings.reload}
                  tintColor={colors.mutedForeground}
                />
              )
            }
            ListEmptyComponent={
              searching ? (
                // A search with no hits is a different situation from an empty
                // marketplace, and offering "post a listing" here would be a
                // non-sequitur.
                <EmptyState
                  title="No matches"
                  body={
                    debounced
                      ? `Nothing matches “${debounced}”.`
                      : 'Nothing in this category yet.'
                  }
                  actionLabel="Clear filters"
                  onAction={() => {
                    setQuery('');
                    setCity(null);
                    setCategoryId(null);
                  }}
                />
              ) : (
                <EmptyState
                  title="Nothing here yet"
                  body="Post a ticket you're selling, or ask for one you want."
                  actionLabel={anon ? 'Sign in to post' : 'Post a listing'}
                  onAction={() =>
                    router.navigate(anon ? '/signin?returnTo=%2Fcreate-event' : '/create-event')
                  }
                />
              )
            }
            renderItem={({ item }: { item: ListingWithPoster }) => {
              const isSell = item.type === 'sell';
              return (
                <Card
                  accent={isSell ? 'sell' : 'want'}
                  // navigate, not push: push mints a new stack entry every
                  // time and expo-router stamps the URL with a key to tell
                  // them apart, so the address people copy out of the bar and
                  // paste to a friend carried __EXPO_ROUTER_key=undefined-...
                  onPress={() => router.navigate(`/event/${item.id}` as never)}
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

                  {/* The going rate, not the wish price. On a sell listing
                      that's the most anyone will pay; on an ask, the least
                      anyone will take. */}
                  {item.best_offer_cents != null && (
                    <Text variant="caption" tone={isSell ? 'sell' : 'want'} style={styles.offerLine}>
                      {isSell ? 'Top offer' : 'Lowest ask'} {money(item.best_offer_cents)}
                      {item.offer_count > 1 ? ` · ${item.offer_count} offers` : ''}
                    </Text>
                  )}

                  {item.poster && (
                    <View style={styles.poster}>
                      <Avatar
                        uri={item.poster.profile_picture}
                        name={item.poster.full_name}
                        size={22}
                      />
                      <Text variant="caption" tone="subtle">
                        {item.poster.full_name || 'Someone'} · {item.poster.completed_deals}{' '}
                        {item.poster.completed_deals === 1 ? 'handoff' : 'handoffs'}
                      </Text>
                    </View>
                  )}
                </Card>
              );
            }}
          />
        )}
      </View>

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() =>
          router.navigate(anon ? '/signin?returnTo=%2Fcreate-event' : '/create-event')
        }
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
    paddingBottom: space[4],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    marginHorizontal: space[5],
    marginBottom: space[3],
    // The dropdown is absolutely positioned inside CitySelect, so this row has
    // to sit above the list it overlaps.
    zIndex: 20,
  },
  search: { flex: 1, marginBottom: 0 },
  categoriesScroll: { flexGrow: 0, flexShrink: 0 },
  categories: { paddingHorizontal: space[5], gap: space[5], paddingBottom: space[3] },
  category: {
    paddingBottom: space[2],
    borderBottomWidth: 1.5,
    borderBottomColor: colors.transparent,
  },
  categoryActive: { borderBottomColor: colors.foreground },
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
  footer: { paddingVertical: space[6] },
  list: { paddingHorizontal: space[5], paddingBottom: space[16], gap: space[3] },
  card: { marginBottom: space[3] },
  cardSkeleton: { height: 116, borderRadius: radius.xl, marginBottom: space[3] },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { marginTop: space[3] },
  offerLine: { marginTop: space[2] },
  poster: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[3] },
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
