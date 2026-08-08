import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Card, Avatar, Button, Input, Separator } from '@/components/ui';
import { colors, space, radius } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import {
  listOffers,
  makeOffer,
  withdrawOffer,
  acceptOffer,
  Listing,
  Offer,
} from '@/services/data';

const money = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

interface Props {
  listing: Listing;
  meId: string | null;
  /** Called after accept, so the parent can reload the deal state. */
  onSettled: () => void;
}

/**
 * Public offers and counter-offers.
 *
 * The reason this exists: on a sell listing the asking price is a wish, and
 * everyone haggles privately in a group chat, so nobody learns what a ticket
 * actually goes for. Making offers visible turns that into a price.
 */
export function OfferBoard({ listing, meId, onSettled }: Props) {
  const selling = listing.type === 'sell';
  const offers = useAsync(() => listOffers(listing.id, listing.type), [listing.id]);

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [replyTo, setReplyTo] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = meId === listing.user_id;
  const rows = offers.data ?? [];

  const submit = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter an amount');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await makeOffer({
        listingId: listing.id,
        amountCents: cents,
        message: note,
        parentOfferId: replyTo?.id,
      });
      setAmount('');
      setNote('');
      setReplyTo(null);
      offers.reload();
      onSettled();
    } catch (e: any) {
      setError(e?.message ?? 'Could not post that offer');
    } finally {
      setBusy(false);
    }
  };

  const accept = async (offer: Offer) => {
    setBusy(true);
    setError(null);
    try {
      await acceptOffer(offer.id);
      offers.reload();
      onSettled();
    } catch (e: any) {
      setError(e?.message ?? 'Could not accept that offer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text variant="heading">Offers</Text>
        <Text variant="small" tone="muted">
          {rows.length === 0
            ? 'None yet'
            : selling
              ? 'Most anyone will pay'
              : 'Least anyone will take'}
        </Text>
      </View>

      {listing.best_offer_cents != null && (
        <Card accent={selling ? 'sell' : 'want'} style={styles.bestCard}>
          <Text variant="small" tone="muted">
            {selling ? 'Highest offer' : 'Lowest asking'}
          </Text>
          <View style={styles.bestRow}>
            <Text variant="display" tone={selling ? 'sell' : 'want'}>
              {money(listing.best_offer_cents)}
            </Text>
            <Text variant="small" tone="subtle">
              vs {money(listing.price_cents)} listed
            </Text>
          </View>
        </Card>
      )}

      {rows.length > 0 && (
        <Card style={styles.list}>
          {rows.map((o, i) => {
            const mine = o.from_user === meId;
            return (
              <View key={o.id}>
                {i > 0 && <Separator style={styles.divider} />}
                <View style={styles.row}>
                  <Avatar uri={o.from?.profile_picture} name={o.from?.full_name} size={32} />
                  <View style={styles.rowBody}>
                    <View style={styles.rowTop}>
                      <Text variant="bodyMedium">
                        {mine ? 'You' : o.from?.full_name || 'Someone'}
                      </Text>
                      <Text variant="bodyMedium" tone={selling ? 'sell' : 'want'}>
                        {money(o.amount_cents)}
                      </Text>
                    </View>
                    {!!o.message && (
                      <Text variant="small" tone="muted" style={styles.note}>
                        {o.message}
                      </Text>
                    )}
                    <View style={styles.actions}>
                      {isOwner && !mine && (
                        <Pressable onPress={() => accept(o)} disabled={busy} hitSlop={6}>
                          <Text variant="small" tone="want">
                            Accept
                          </Text>
                        </Pressable>
                      )}
                      {!mine && (
                        <Pressable
                          onPress={() => {
                            setReplyTo(o);
                            setAmount(String(o.amount_cents / 100));
                          }}
                          hitSlop={6}
                        >
                          <Text variant="small" tone="muted">
                            Counter
                          </Text>
                        </Pressable>
                      )}
                      {mine && (
                        <Pressable
                          onPress={async () => {
                            await withdrawOffer(o.id);
                            offers.reload();
                            onSettled();
                          }}
                          hitSlop={6}
                        >
                          <Text variant="small" tone="destructive">
                            Withdraw
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      )}

      {/* Once a deal is struck the listing leaves the market, and the insert
          policy rejects new offers -- so don't offer a form that cannot work. */}
      {listing.status !== 'active' ? (
        <Card style={styles.form}>
          <Text variant="small" tone="muted">
            {listing.status === 'locked'
              ? 'This one is spoken for — a deal is in progress.'
              : 'This listing is closed.'}
          </Text>
        </Card>
      ) : (
      <Card style={styles.form}>
        {replyTo && (
          <View style={styles.replyBanner}>
            <Text variant="caption" tone="muted">
              Countering {replyTo.from?.full_name || 'their'} offer of{' '}
              {money(replyTo.amount_cents)}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={6}>
              <Text variant="caption" tone="muted">
                Cancel
              </Text>
            </Pressable>
          </View>
        )}
        <Input
          label={selling ? "What you'll pay" : "What you'll take"}
          value={amount}
          onChangeText={setAmount}
          placeholder={String(Math.round(listing.price_cents / 100))}
          keyboardType="numeric"
          error={error ?? undefined}
          containerStyle={styles.amountInput}
        />
        <Input
          value={note}
          onChangeText={setNote}
          placeholder="Optional — say why"
          containerStyle={styles.noteInput}
        />
        <Button
          title={replyTo ? 'Send counter' : 'Make an offer'}
          onPress={submit}
          loading={busy}
          variant={selling ? 'sell' : 'want'}
          block
        />
      </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space[8] },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  bestCard: { marginTop: space[3] },
  bestRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[3], marginTop: space[1] },
  list: { marginTop: space[3], paddingVertical: space[1] },
  divider: { marginHorizontal: -space[4] },
  row: { flexDirection: 'row', gap: space[3], paddingVertical: space[3] },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  note: { marginTop: space[1] },
  actions: { flexDirection: 'row', gap: space[4], marginTop: space[2] },
  form: { marginTop: space[3] },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space[2],
    marginBottom: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.muted,
  },
  amountInput: { marginBottom: space[3] },
  noteInput: { marginBottom: space[4] },
});

export default OfferBoard;
