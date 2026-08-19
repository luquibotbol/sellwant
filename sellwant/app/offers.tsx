import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Redirect, router } from 'expo-router';
import {
  Text,
  Card,
  Badge,
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  SegmentedFilter,
} from '@/components/ui';
import { colors, space, radius, maxContentWidth } from '@/constants/theme';
import { sideOf, Side as OfferSide } from '@/lib/offer-side';
import { money } from '@/lib/format';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import {
  myOffers,
  offersOnMyListings,
  acceptOffer,
  declineOffer,
  withdrawOffer,
  OfferWithListing,
} from '@/services/data';

type Tab = 'received' | 'sent';
/** 'all' is a filter state; the other two come from lib/offer-side. */
type Side = 'all' | OfferSide;

const STATUS_VARIANT: Record<string, 'default' | 'want' | 'destructive' | 'outline'> = {
  open: 'outline',
  accepted: 'want',
  declined: 'destructive',
  withdrawn: 'default',
};

export default function OffersScreen() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>('received');
  const [side, setSide] = useState<Side>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const received = useAsync(offersOnMyListings, []);
  const sent = useAsync(myOffers, []);

  if (session === undefined) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (!session) return <Redirect href="/signin" />;

  const me = session.user.id;
  const active = tab === 'received' ? received : sent;
  const all = active.data ?? [];
  // Counted before filtering, so an empty side is visible without tapping it.
  const counts = {
    all: all.length,
    buying: all.filter((o) => sideOf(o, me) === 'buying').length,
    selling: all.filter((o) => sideOf(o, me) === 'selling').length,
  };
  const rows = side === 'all' ? all : all.filter((o) => sideOf(o, me) === side);
  const openReceived = (received.data ?? []).filter((o) => o.status === 'open').length;

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      received.reload();
      sent.reload();
    } catch (e: any) {
      setError(e?.message ?? 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.frame}>
        <View style={styles.tabs}>
          {(['received', 'sent'] as Tab[]).map((t) => {
            const on = tab === t;
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={[styles.tab, on && styles.tabActive]}
              >
                <Text variant={on ? 'bodyMedium' : 'body'} tone={on ? 'default' : 'muted'}>
                  {t === 'received'
                    ? `On your listings${openReceived ? ` (${openReceived})` : ''}`
                    : 'Your offers'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SegmentedFilter
          value={side}
          onChange={setSide}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'buying', label: 'Buying', count: counts.buying },
            { value: 'selling', label: 'Selling', count: counts.selling },
          ]}
          style={styles.sideFilter}
        />

        {!!error && (
          <Text variant="small" tone="destructive" style={styles.error}>
            {error}
          </Text>
        )}

        {active.error ? (
          <ErrorState message={active.error.message} onRetry={active.reload} />
        ) : active.loading && !active.data ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : rows.length === 0 ? (
          side !== 'all' && all.length > 0 ? (
            // There are offers here, just none on this side. Saying "no offers
            // yet" would be a lie, and hiding the way back out would be worse.
            <EmptyState
              title={`Nothing where you're ${side}`}
              body={`You have ${all.length} ${all.length === 1 ? 'offer' : 'offers'} on this tab, but none on that side of the trade.`}
              actionLabel="Show all"
              onAction={() => setSide('all')}
            />
          ) : (
            <EmptyState
              title={tab === 'received' ? 'No offers yet' : "You haven't offered on anything"}
              body={
                tab === 'received'
                  ? 'When someone offers on something you posted, it shows up here.'
                  : 'Find a ticket and name your price — offers are public, so everyone can see the going rate.'
              }
              actionLabel="Browse listings"
              onAction={() => router.navigate('/feed')}
            />
          )
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {rows.map((o: OfferWithListing) => {
              // Colour and wording follow YOUR side of this trade, not the
              // listing's type -- the same rule the deal header uses. On the
              // offers screen "am I buying or selling here" is the question,
              // and the listing type answers it differently depending on
              // whether the listing is yours.
              const mySide = sideOf(o, me);
              const buying = mySide === 'buying';
              const isOpen = o.status === 'open';
              const working = busy === o.id;

              return (
                <Card
                  key={o.id}
                  accent={buying ? 'want' : 'sell'}
                  style={styles.card}
                  onPress={
                    o.listing ? () => router.navigate(`/event/${o.listing!.id}` as never) : undefined
                  }
                >
                  <View style={styles.cardTop}>
                    <Text variant="bodyMedium" style={styles.cardTitle} numberOfLines={1}>
                      {o.listing?.title ?? 'Listing removed'}
                    </Text>
                    <Text variant="heading" tone={buying ? 'want' : 'sell'}>
                      {money(o.amount_cents)}
                    </Text>
                  </View>

                  <View style={styles.metaRow}>
                    {tab === 'received' ? (
                      <View style={styles.who}>
                        <Avatar uri={o.from?.profile_picture} name={o.from?.full_name} size={20} />
                        <Text variant="small" tone="muted">
                          {o.from?.full_name || 'Someone'}
                        </Text>
                      </View>
                    ) : (
                      <Text variant="small" tone="muted">
                        {o.listing ? `Listed at ${money(o.listing.price_cents)}` : ''}
                      </Text>
                    )}
                    <View style={styles.tail}>
                      {!!mySide && (
                        <Text variant="caption" tone="subtle">
                          {buying ? "You're buying" : "You're selling"}
                        </Text>
                      )}
                      <Badge
                        label={o.status.toUpperCase()}
                        variant={STATUS_VARIANT[o.status] ?? 'default'}
                      />
                    </View>
                  </View>

                  {!!o.message && (
                    <Text variant="small" tone="muted" style={styles.note}>
                      “{o.message}”
                    </Text>
                  )}

                  {/* A counter is an offer with a parent, so say so rather than
                      leaving it indistinguishable from an opening bid. */}
                  {!!o.parent_offer_id && (
                    <Text variant="caption" tone="subtle" style={styles.note}>
                      Counter-offer
                    </Text>
                  )}

                  {isOpen && (
                    <View style={styles.actions}>
                      {tab === 'received' ? (
                        <>
                          <Button
                            title="Accept"
                            variant="want"
                            size="sm"
                            loading={working}
                            onPress={() =>
                              run(o.id, async () => {
                                // acceptOffer returns the new lock-in id -- go
                                // straight to the handoff, which is the whole
                                // point of accepting.
                                const dealId = await acceptOffer(o.id);
                                router.navigate(`/deal/${dealId}` as never);
                              })
                            }
                          />
                          <Button
                            title="Decline"
                            variant="outline"
                            size="sm"
                            onPress={() => run(o.id, () => declineOffer(o.id))}
                          />
                          <Button
                            title="Counter"
                            variant="ghost"
                            size="sm"
                            onPress={() =>
                              o.listing && router.navigate(`/event/${o.listing.id}` as never)
                            }
                          />
                        </>
                      ) : (
                        <Button
                          title="Withdraw"
                          variant="outline"
                          size="sm"
                          loading={working}
                          onPress={() => run(o.id, () => withdrawOffer(o.id))}
                        />
                      )}
                    </View>
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
  tabs: {
    flexDirection: 'row',
    margin: space[5],
    padding: 3,
    gap: 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space[2], borderRadius: radius.md },
  tabActive: { backgroundColor: colors.muted },
  tail: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  sideFilter: { marginHorizontal: space[5], marginBottom: space[3] },
  error: { marginHorizontal: space[5], marginBottom: space[3] },
  list: { paddingHorizontal: space[5], paddingBottom: space[16] },
  card: { marginBottom: space[3] },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  cardTitle: { flex: 1 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space[3],
  },
  who: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  note: { marginTop: space[2] },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
});
