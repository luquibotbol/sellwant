import React from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Text, Card, Badge, Avatar, EmptyState, ErrorState } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { money, whenAndWhere } from '@/lib/format';
import { stepFor, HandoffState, Role } from '@/lib/handoff';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import { myDeals, DealWithContext } from '@/services/data';

const STATE_BADGE: Record<HandoffState, { label: string; variant: 'want' | 'sell' | 'outline' | 'default' }> = {
  pending_payment: { label: 'AWAITING PAYMENT', variant: 'outline' },
  paid: { label: 'MARKED PAID', variant: 'want' },
  confirmed: { label: 'DONE', variant: 'default' },
  cancelled: { label: 'CANCELLED', variant: 'default' },
};

export default function DealsScreen() {
  const session = useSession();
  const deals = useAsync(myDeals, []);

  if (session === undefined) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (!session) return <Redirect href="/" />;

  const me = session.user.id;
  const rows = deals.data ?? [];
  // Live deals first -- a settled one is history, a live one may need action.
  const sorted = [...rows].sort(
    (a, b) =>
      Number(['confirmed', 'cancelled'].includes(a.state)) -
      Number(['confirmed', 'cancelled'].includes(b.state))
  );

  return (
    <View style={styles.container}>
      <View style={styles.frame}>
        {deals.error ? (
          <ErrorState message={deals.error.message} onRetry={deals.reload} />
        ) : deals.loading && !deals.data ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : sorted.length === 0 ? (
          <EmptyState
            title="No deals yet"
            body="When you agree a price with someone, the handoff shows up here."
            actionLabel="Browse listings"
            onAction={() => router.push('/feed')}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {sorted.map((d: DealWithContext) => {
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
                  onPress={() => router.push(`/deal/${d.id}` as never)}
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
  list: { padding: space[5], paddingBottom: space[16] },
  card: { marginBottom: space[3] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { marginTop: space[3] },
  who: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[3] },
  turn: { marginTop: space[2] },
});
