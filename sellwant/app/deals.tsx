import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Redirect, router } from 'expo-router';
import {
  Text,
  Card,
  Badge,
  Avatar,
  Button,
  Input,
  EmptyState,
  ErrorState,
  SegmentedFilter,
} from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { money, whenAndWhere } from '@/lib/format';
import { stepFor, HandoffState, Role } from '@/lib/handoff';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import { myDeals, lastActionAt, DealWithContext } from '@/services/data';

const STATE_BADGE: Record<HandoffState, { label: string; variant: 'want' | 'sell' | 'outline' | 'default' }> = {
  pending_payment: { label: 'AWAITING PAYMENT', variant: 'outline' },
  paid: { label: 'MARKED PAID', variant: 'want' },
  confirmed: { label: 'DONE', variant: 'default' },
  cancelled: { label: 'CANCELLED', variant: 'default' },
};

/**
 * Three tabs, not the two that were asked for.
 *
 * "Active" and "Cancelled" leaves nowhere for a completed deal to go, and the
 * two are not the same kind of history at all: one is the thing that was
 * supposed to happen and the other is the thing that fell through. Filing them
 * together would bury every successful handoff among the failures.
 */
type Tab = 'active' | 'done' | 'cancelled';
type Side = 'all' | 'buying' | 'selling';

const LIVE: HandoffState[] = ['pending_payment', 'paid'];

const TABS = [
  { value: 'active' as Tab, label: 'Active' },
  { value: 'done' as Tab, label: 'Done' },
  { value: 'cancelled' as Tab, label: 'Cancelled' },
];

const SIDES = [
  { value: 'all' as Side, label: 'Everything' },
  { value: 'buying' as Side, label: 'Buying' },
  { value: 'selling' as Side, label: 'Selling' },
];

/** A page of deals. Small, because a live deal you can't see is a deal you forget. */
const PAGE = 5;

export default function DealsScreen() {
  const session = useSession();
  const deals = useAsync(myDeals, []);

  const [tab, setTab] = useState<Tab>('active');
  const [side, setSide] = useState<Side>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  const me = session?.user.id ?? '';
  const rows = deals.data ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((d) => {
        const inTab =
          tab === 'active'
            ? LIVE.includes(d.state as HandoffState)
            : tab === 'done'
              ? d.state === 'confirmed'
              : d.state === 'cancelled';
        if (!inTab) return false;

        const role: Role = d.buyer_id === me ? 'buyer' : 'seller';
        if (side === 'buying' && role !== 'buyer') return false;
        if (side === 'selling' && role !== 'seller') return false;

        if (!q) return true;
        // The two things anyone would search by: what it was, and who with.
        const other = role === 'buyer' ? d.seller : d.buyer;
        return (
          (d.listing?.title ?? '').toLowerCase().includes(q) ||
          (other?.full_name ?? '').toLowerCase().includes(q)
        );
      })
      // Most recently moved first. locked_at would sort by when the deal began,
      // which puts an old deal that just got paid below a new one nobody has
      // touched -- the opposite of what you opened this screen to find.
      .sort((a, b) => lastActionAt(b).localeCompare(lastActionAt(a)));
  }, [rows, tab, side, query, me]);

  // A page size that survived a filter change would show five rows of a list
  // the person has just replaced.
  useEffect(() => setShown(PAGE), [tab, side, query]);

  const filtering = side !== 'all' || query.trim() !== '';
  const visible = filtered.slice(0, shown);

  if (session === undefined) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (!session) return <Redirect href="/signin" />;

  return (
    <View style={styles.container}>
      <View style={styles.frame}>
        <View style={styles.controls}>
          <SegmentedFilter options={TABS} value={tab} onChange={setTab} />

          <View style={styles.searchRow}>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search by ticket or person"
              autoCapitalize="none"
              autoCorrect={false}
              containerStyle={styles.search}
            />
            {/* Only offered when there is something to clear -- a permanently
                visible Clear button reads as a filter that is always on. */}
            {filtering && (
              <Button
                title="Clear"
                variant="ghost"
                size="sm"
                onPress={() => {
                  setQuery('');
                  setSide('all');
                }}
              />
            )}
          </View>

          <SegmentedFilter
            options={SIDES}
            value={side}
            onChange={setSide}
            style={styles.sides}
          />
        </View>

        {deals.error ? (
          <ErrorState message={deals.error.message} onRetry={deals.reload} />
        ) : deals.loading && !deals.data ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : filtered.length === 0 ? (
          // An empty tab and an empty search are different problems, and
          // "browse listings" is useless advice for the second.
          filtering || rows.length ? (
            <EmptyState
              title="Nothing here"
              body={
                filtering
                  ? 'No deals match that. Try clearing the filters.'
                  : `You have no ${tab === 'active' ? 'deals in progress' : tab === 'done' ? 'completed deals' : 'cancelled deals'}.`
              }
              actionLabel={filtering ? 'Clear filters' : undefined}
              onAction={
                filtering
                  ? () => {
                      setQuery('');
                      setSide('all');
                    }
                  : undefined
              }
            />
          ) : (
            <EmptyState
              title="No deals yet"
              body="When you agree a price with someone, the handoff shows up here."
              actionLabel="Browse listings"
              onAction={() => router.navigate('/feed')}
            />
          )
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {visible.map((d: DealWithContext) => {
              const role: Role = d.buyer_id === me ? 'buyer' : 'seller';
              const other = role === 'buyer' ? d.seller : d.buyer;
              const state = d.state as HandoffState;
              const step = stepFor(state, role);
              const badge = STATE_BADGE[state];

              return (
                <Card
                  key={d.id}
                  accent={role === 'buyer' ? 'want' : 'sell'}
                  style={styles.card}
                  onPress={() => router.navigate(`/deal/${d.id}` as never)}
                >
                  <View style={styles.top}>
                    <Badge label={badge.label} variant={badge.variant} />
                    <Text variant="heading" tone={role === 'buyer' ? 'want' : 'sell'}>
                      {money(d.locked_price_cents)}
                    </Text>
                  </View>

                  <Text variant="bodyMedium" style={styles.title} numberOfLines={1}>
                    {d.listing?.title ?? 'Listing removed'}
                  </Text>
                  <Text variant="small" tone="muted">
                    {whenAndWhere(d.listing?.event_date ?? null, d.listing?.location ?? null) ||
                      'No date set'}
                  </Text>

                  <View style={styles.who}>
                    <Avatar uri={other?.profile_picture} name={other?.full_name} size={20} />
                    <Text variant="caption" tone="subtle">
                      {role === 'buyer' ? 'from' : 'to'} {other?.full_name || 'someone'}
                    </Text>
                  </View>

                  {/* Say whose turn it is, so the list is scannable for action. */}
                  {!['confirmed', 'cancelled'].includes(state) && (
                    <Text
                      variant="caption"
                      tone={step.waiting ? 'subtle' : role === 'buyer' ? 'want' : 'sell'}
                      style={styles.turn}
                    >
                      {step.waiting ? 'Waiting on them' : `Your turn — ${step.title.toLowerCase()}`}
                    </Text>
                  )}
                </Card>
              );
            })}

            {filtered.length > shown && (
              <Button
                title={`Show more (${filtered.length - shown})`}
                variant="outline"
                onPress={() => setShown((n) => n + PAGE)}
                style={styles.more}
              />
            )}
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
  controls: { paddingHorizontal: space[5], paddingTop: space[4], gap: space[3] },
  searchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  search: { flex: 1, marginBottom: 0 },
  sides: { marginBottom: space[1] },
  list: { padding: space[5], paddingBottom: space[16] },
  card: { marginBottom: space[3] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { marginTop: space[3] },
  who: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[3] },
  turn: { marginTop: space[2] },
  more: { marginTop: space[2] },
});
