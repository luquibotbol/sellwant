import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, Pressable, Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  Text,
  Card,
  Badge,
  Avatar,
  Button,
  Separator,
  ErrorState,
  EmptyState,
} from '@/components/ui';
import { colors, space, radius, maxContentWidth } from '@/constants/theme';
import { money, whenAndWhere } from '@/lib/format';
import { payAction } from '@/lib/payments';
import { openPayment } from '@/lib/open-payment';
import { stepFor, PROGRESS, HandoffState, Role } from '@/lib/handoff';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import ReportSheet from '@/components/ReportSheet';
import {
  getDeal,
  advanceDeal,
  getCounterpartyContact,
  DealWithContext,
} from '@/services/data';

export default function DealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const deal = useAsync(() => getDeal(id), [id]);

  const me = session?.user.id ?? null;
  const d = deal.data;
  const role: Role | null = !d || !me ? null : d.buyer_id === me ? 'buyer' : 'seller';
  const otherId = !d || !role ? null : role === 'buyer' ? d.seller_id : d.buyer_id;

  const contact = useAsync(
    async () => (otherId ? getCounterpartyContact(otherId) : null),
    [otherId]
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  if (session === undefined || deal.loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (deal.error) {
    return (
      <View style={styles.container}>
        <ErrorState message={deal.error.message} onRetry={deal.reload} />
      </View>
    );
  }
  // RLS returns nothing to non-parties, so "not found" and "not yours" are the
  // same thing here -- deliberately, since confirming a deal exists would leak.
  if (!d || !role) {
    return (
      <View style={styles.container}>
        <EmptyState
          title="Deal not found"
          body="It may have been cancelled, or it isn't yours."
          actionLabel="Back to feed"
          onAction={() => router.replace('/feed')}
        />
      </View>
    );
  }

  const state = d.state as HandoffState;
  const step = stepFor(state, role);
  const other = role === 'buyer' ? d.seller : d.buyer;
  const selling = d.listing?.type === 'sell';
  const stageIndex = PROGRESS.indexOf(state);

  const run = async (to: HandoffState) => {
    setBusy(true);
    setError(null);
    try {
      await advanceDeal(d.id, to);
      deal.reload();
      contact.reload();
    } catch (e: any) {
      setError(e?.message ?? 'That did not work');
    } finally {
      setBusy(false);
      setPendingConfirm(null);
    }
  };

  const act = (a: NonNullable<typeof step.primary>) => {
    if (a.confirm && pendingConfirm !== a.to) {
      setPendingConfirm(a.to);
      return;
    }
    run(a.to);
  };

  const note = d.listing?.title ? `SellWant — ${d.listing.title}` : 'SellWant';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Progress. Cancelled is off-path so the rail is hidden entirely. */}
      {state !== 'cancelled' && (
        <View style={styles.rail}>
          {PROGRESS.map((s, i) => (
            <View key={s} style={styles.railItem}>
              <View
                style={[
                  styles.dot,
                  i <= stageIndex && styles.dotOn,
                  i === stageIndex && styles.dotNow,
                ]}
              />
              {i < PROGRESS.length - 1 && (
                <View style={[styles.bar, i < stageIndex && styles.barOn]} />
              )}
            </View>
          ))}
        </View>
      )}

      <View style={styles.head}>
        <Badge
          label={role === 'buyer' ? 'YOU’RE BUYING' : 'YOU’RE SELLING'}
          variant={role === 'buyer' ? 'want' : 'sell'}
        />
        {/* Colour follows YOUR side of this deal, not the listing type --
            otherwise "YOU'RE BUYING" (green) sat next to a red price. */}
        <Text variant="display" tone={role === 'buyer' ? 'want' : 'sell'}>
          {money(d.locked_price_cents)}
        </Text>
      </View>

      <Pressable onPress={() => d.listing && router.navigate(`/event/${d.listing.id}` as never)}>
        <Text variant="title" style={styles.title}>
          {d.listing?.title ?? 'Listing removed'}
        </Text>
        {!!d.listing && (
          <Text variant="small" tone="muted">
            {whenAndWhere(d.listing.event_date, d.listing.location) || 'No date set'}
          </Text>
        )}
      </Pressable>

      {/* The current step for this person, from the state x role table. */}
      <Card
        accent={step.waiting ? undefined : role === 'buyer' ? 'want' : 'sell'}
        style={styles.step}
      >
        <Text variant="heading">{step.title}</Text>
        <Text variant="small" tone="muted" style={styles.stepBody}>
          {step.body}
        </Text>

        {step.waiting && (
          <Text variant="caption" tone="subtle" style={styles.waiting}>
            Nothing for you to do right now.
          </Text>
        )}

        {step.primary && (
          <Button
            title={pendingConfirm === step.primary.to ? 'Tap again to confirm' : step.primary.label}
            variant={step.primary.variant}
            size="lg"
            block
            loading={busy}
            onPress={() => act(step.primary!)}
            style={styles.action}
          />
        )}

        {step.secondary && (
          <Button
            title={
              pendingConfirm === step.secondary.to
                ? 'Tap again to cancel the deal'
                : step.secondary.label
            }
            variant="outline"
            block
            onPress={() => act(step.secondary!)}
            style={styles.secondary}
          />
        )}

        {!!pendingConfirm && (
          <Text variant="caption" tone="muted" style={styles.confirmHint}>
            {(step.primary?.to === pendingConfirm
              ? step.primary?.confirm
              : step.secondary?.confirm) ?? ''}
          </Text>
        )}

        {!!error && (
          <Text variant="small" tone="destructive" style={styles.error}>
            {error}
          </Text>
        )}
      </Card>

      {/* Counterparty. RLS only returns their contact because a deal exists. */}
      <Card style={styles.who}>
        <View style={styles.whoTop}>
          <View style={styles.whoWho}>
            <Avatar uri={other?.profile_picture} name={other?.full_name} size={40} />
            <View>
              <Text variant="bodyMedium">{other?.full_name || 'Someone'}</Text>
              <Text variant="caption" tone="subtle">
                {other?.completed_deals ?? 0}{' '}
                {other?.completed_deals === 1 ? 'handoff' : 'handoffs'}
              </Text>
            </View>
          </View>
          {other?.instagram ? (
            <Badge label={`@${other.instagram}`} variant="outline" />
          ) : (
            <Badge label="NO INSTAGRAM" variant="default" />
          )}
        </View>

        {!!contact.data?.phone && (
          <>
            <Separator style={styles.divider} />
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(contact.data!.phone!);
                setCopied('phone');
              }}
              style={styles.contactRow}
            >
              <Text variant="small" tone="muted">
                Phone
              </Text>
              <Text variant="small">
                {contact.data.phone} {copied === 'phone' ? '· copied' : ''}
              </Text>
            </Pressable>
          </>
        )}
      </Card>

      {/* Payment handles only where paying is the actual next step. */}
      {step.showPayment && (
        <Card style={styles.pay}>
          <Text variant="bodyMedium">How to pay them</Text>
          {(contact.data?.accepted_payments ?? []).length === 0 ? (
            <Text variant="small" tone="muted" style={styles.stepBody}>
              They haven&apos;t added a payment handle. Message them on the number above
              and agree how to send it.
            </Text>
          ) : (
            (contact.data?.accepted_payments ?? []).map((h) => {
              const a = payAction(h, d.locked_price_cents, note);
              return (
                <View key={h.kind} style={styles.payRow}>
                  {a.kind === 'link' ? (
                    <Button
                      title={a.label}
                      variant="secondary"
                      block
                      onPress={() => openPayment(a)}
                    />
                  ) : (
                    <>
                      <Button
                        title={copied === h.kind ? 'Copied' : a.label}
                        variant="outline"
                        block
                        onPress={async () => {
                          await Clipboard.setStringAsync(a.value);
                          setCopied(h.kind);
                        }}
                      />
                      <Text variant="caption" tone="subtle" style={styles.payHint}>
                        {a.hint} — {a.value}
                      </Text>
                    </>
                  )}
                </View>
              );
            })
          )}
          <Text variant="caption" tone="subtle" style={styles.payHint}>
            SellWant never handles the money and can&apos;t verify a payment. If something
            goes wrong, we have no way to reverse it.
          </Text>
        </Card>
      )}

      {/* Anchored to this deal, so a moderator sees the transaction. */}
      {otherId && (
        <>
          <Button
            title="Something went wrong — report this"
            variant="ghost"
            block
            onPress={() => setReporting(true)}
            style={styles.report}
          />
          <ReportSheet
            visible={reporting}
            onClose={() => setReporting(false)}
            subjectId={otherId}
            subjectName={other?.full_name || 'them'}
            listingId={d.listing?.id}
            lockInId={d.id}
          />
        </>
      )}

      {selling && state !== 'confirmed' && state !== 'cancelled' && (
        <Card style={styles.safety}>
          <Text variant="bodyMedium">Meet at the door if you can</Text>
          <Text variant="small" tone="muted" style={styles.stepBody}>
            Bubbl codes can&apos;t be transferred, so the seller keeps a working copy.
            Scanning in together is the only way to be sure the ticket is yours.
          </Text>
        </Card>
      )}
    </ScrollView>
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
  rail: { flexDirection: 'row', alignItems: 'center', marginBottom: space[6] },
  railItem: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
  },
  dotOn: { backgroundColor: colors.want, borderColor: colors.want },
  dotNow: { width: 14, height: 14, borderRadius: 7 },
  bar: { flex: 1, height: 1, backgroundColor: colors.border, marginHorizontal: space[2] },
  barOn: { backgroundColor: colors.want },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { marginTop: space[4] },
  step: { marginTop: space[6] },
  stepBody: { marginTop: space[2], lineHeight: 20 },
  waiting: { marginTop: space[3] },
  action: { marginTop: space[5] },
  secondary: { marginTop: space[2] },
  confirmHint: { marginTop: space[3] },
  error: { marginTop: space[3] },
  who: { marginTop: space[3] },
  whoTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  whoWho: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  divider: { marginHorizontal: -space[4], marginTop: space[3] },
  contactRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: space[3] },
  pay: { marginTop: space[3] },
  payRow: { marginTop: space[3] },
  payHint: { marginTop: space[2] },
  safety: { marginTop: space[3] },
  report: { marginTop: space[5] },
});
