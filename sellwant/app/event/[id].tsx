import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, Card, Badge, Avatar, Button, Separator, ErrorState, EmptyState } from '@/components/ui';
import OfferBoard from '@/components/OfferBoard';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { money } from '@/lib/format';
import { useAsync } from '@/hooks/useAsync';
import {
  getListing,
  getSession,
  createLockIn,
  getCounterpartyContact,
} from '@/services/data';

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useAsync(() => getListing(id), [id]);
  const session = useAsync(getSession, []);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  // Returns null unless a lock-in already exists between us, so this doubles
  // as the check for whether the deal is live.
  //
  // Skipped when the listing is your own: RLS quite correctly lets you read
  // your own contact row, so without this guard your own listing rendered
  // "You're locked in — here's how to reach them" with your own number.
  const posterId = listing.data?.user_id;
  const myId = session.data?.user.id ?? null;
  const contact = useAsync(
    async () =>
      posterId && myId && posterId !== myId ? getCounterpartyContact(posterId) : null,
    [posterId, myId]
  );

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
  const mine = myId === l.user_id;

  const lockIn = async () => {
    setLockError(null);
    setLocking(true);
    try {
      const created = await createLockIn(l);
      // Straight to the handoff -- the deal screen is where everything the
      // buyer needs now lives.
      router.push(`/deal/${created.id}` as never);
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
        <Card style={styles.poster} onPress={() => router.push(`/u/${l.user_id}` as never)}>
          <View style={styles.posterHead}>
            <View style={styles.posterWho}>
              <Avatar uri={l.poster.profile_picture} name={l.poster.full_name} size={36} />
              <Text variant="bodyMedium">{l.poster.full_name || 'Someone'}</Text>
            </View>
            {l.poster.instagram ? (
              <Badge label={`@${l.poster.instagram}`} variant="outline" />
            ) : (
              <Badge label="NO INSTAGRAM" variant="default" />
            )}
          </View>
          <Text variant="small" tone="muted" style={styles.posterMeta}>
            {l.poster.completed_deals}{' '}
            {l.poster.completed_deals === 1 ? 'completed handoff' : 'completed handoffs'}
          </Text>
        </Card>
      )}

      {/* Contact appears only after a lock-in exists. The rule is enforced by
          RLS on contact_details -- this just renders whatever it is allowed
          to see. */}
      {contact.data && (
        <Card accent="want" style={styles.contact}>
          <Text variant="bodyMedium">You&apos;re locked in — here&apos;s how to reach them</Text>
          {!!contact.data.phone && (
            <Text variant="small" style={styles.contactRow}>
              {contact.data.phone}
            </Text>
          )}
          {contact.data.accepted_payments.map((p) => (
            <Text key={p.kind} variant="small" tone="muted" style={styles.contactRow}>
              {p.kind}: {p.value}
            </Text>
          ))}
          <Text variant="caption" tone="subtle" style={styles.contactNote}>
            Pay them directly. SellWant never handles the money.
          </Text>
        </Card>
      )}

      <OfferBoard
        listing={l}
        meId={myId}
        onSettled={() => {
          listing.reload();
          contact.reload();
        }}
      />

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
        <View style={styles.action}>
          <Button
            title={selling ? `Buy now at ${money(l.price_cents)}` : 'I have one — respond'}
            onPress={lockIn}
            loading={locking}
            block
          />
          {/* D12: the button is always available -- one lowball must not be able
              to suppress a full-price sale -- but the going rate sits beside it
              so nobody pays sticker without seeing it. */}
          {l.best_offer_cents != null && (
            <Text variant="caption" tone="subtle" style={styles.actionNote}>
              {selling ? 'Top offer' : 'Lowest ask'} is {money(l.best_offer_cents)}
              {l.offer_count > 1 ? ` across ${l.offer_count} offers` : ''} — you can offer instead.
            </Text>
          )}
        </View>
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
  posterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  posterWho: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  posterMeta: { marginTop: space[2] },
  contact: { marginTop: space[3] },
  contactRow: { marginTop: space[2] },
  contactNote: { marginTop: space[3] },
  safety: { marginTop: space[3] },
  safetyBody: { marginTop: space[2] },
  lockError: { marginTop: space[4] },
  action: { marginTop: space[6] },
  actionNote: { marginTop: space[3], textAlign: 'center' },
  mine: { marginTop: space[6], textAlign: 'center' },
});
