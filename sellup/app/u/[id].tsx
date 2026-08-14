import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  Text,
  Card,
  Badge,
  Avatar,
  Button,
  Separator,
  EmptyState,
  ErrorState,
} from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { money, whenAndWhere } from '@/lib/format';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import ReportSheet from '@/components/ReportSheet';
import { getPublicProfile, listingsBy, ListingWithPoster } from '@/services/data';

/**
 * Someone else's profile.
 *
 * Public identity only — name, photo, Instagram, observed counts. Phone,
 * email and payment handles live in contact_details and are revealed by RLS
 * only to a counterparty in a deal, so they cannot appear here even by
 * mistake.
 */
export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const [reporting, setReporting] = useState(false);
  const profile = useAsync(() => getPublicProfile(id), [id]);
  const listings = useAsync(() => listingsBy(id), [id]);

  if (profile.loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (profile.error) {
    return (
      <View style={styles.container}>
        <ErrorState message={profile.error.message} onRetry={profile.reload} />
      </View>
    );
  }
  if (!profile.data) {
    return (
      <View style={styles.container}>
        <EmptyState title="No such person" body="This account may have been removed." />
      </View>
    );
  }

  const p = profile.data;
  const rows = listings.data ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.identity}>
        <Avatar uri={p.profile_picture} name={p.full_name} size={72} />
        <View style={styles.identityText}>
          <Text variant="title">{p.full_name || 'No name set'}</Text>
          {p.instagram ? (
            <Badge label={`@${p.instagram}`} variant="outline" style={styles.ig} />
          ) : (
            <Badge label="NO INSTAGRAM" variant="default" style={styles.ig} />
          )}
        </View>
      </View>

      {p.is_suspended && (
        <Card accent="sell" style={styles.suspended}>
          <Text variant="bodyMedium" tone="destructive">
            This account is suspended
          </Text>
          <Text variant="small" tone="muted" style={styles.suspendedBody}>
            They can&apos;t post or start new deals.
          </Text>
        </Card>
      )}

      {/* Observed facts only. No stars, no reviews -- there is deliberately no
          rating column to render. */}
      <Card style={styles.stats}>
        <View style={styles.stat}>
          <Text variant="display">{p.completed_deals}</Text>
          <Text variant="caption" tone="muted">
            completed {p.completed_deals === 1 ? 'handoff' : 'handoffs'}
          </Text>
        </View>
        <Separator style={styles.statDivider} />
        <View style={styles.stat}>
          <Text variant="display">
            {new Date(p.created_at).toLocaleDateString(undefined, {
              month: 'short',
              year: 'numeric',
            })}
          </Text>
          <Text variant="caption" tone="muted">
            member since
          </Text>
        </View>
      </Card>

      {p.completed_deals === 0 && (
        <Text variant="caption" tone="subtle" style={styles.newNote}>
          No completed handoffs yet. That doesn&apos;t mean anything bad — it just
          means SellUp has nothing to tell you either way.
        </Text>
      )}

      <Text variant="heading" style={styles.sectionTitle}>
        {rows.length === 0 ? 'Nothing listed right now' : 'Currently listed'}
      </Text>

      {rows.map((l: ListingWithPoster) => {
        const selling = l.type === 'sell';
        return (
          <Card
            key={l.id}
            accent={selling ? 'sell' : 'want'}
            style={styles.card}
            onPress={() => router.push(`/event/${l.id}` as never)}
          >
            <View style={styles.cardTop}>
              <Badge label={selling ? 'FOR SALE' : 'WANTED'} variant={selling ? 'sell' : 'want'} />
              <Text variant="heading" tone={selling ? 'sell' : 'want'}>
                {money(l.price_cents)}
              </Text>
            </View>
            <Text variant="bodyMedium" style={styles.cardTitle} numberOfLines={1}>
              {l.title}
            </Text>
            <Text variant="small" tone="muted">
              {whenAndWhere(l.event_date, l.location) || 'No date set'}
            </Text>
          </Card>
        );
      })}

      {/* Reporting is available from a profile, but never on yourself. */}
      {session && session.user.id !== p.id && (
        <>
          <Button
            title={`Report ${p.full_name || 'this person'}`}
            variant="ghost"
            block
            onPress={() => setReporting(true)}
            style={styles.report}
          />
          <ReportSheet
            visible={reporting}
            onClose={() => setReporting(false)}
            subjectId={p.id}
            subjectName={p.full_name || 'this person'}
          />
        </>
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
  identity: { flexDirection: 'row', alignItems: 'center', gap: space[5] },
  identityText: { flex: 1, gap: space[2] },
  ig: { marginTop: space[1] },
  suspended: { marginTop: space[4] },
  suspendedBody: { marginTop: space[1] },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: space[6] },
  stat: { flex: 1, alignItems: 'center', gap: space[1] },
  statDivider: { width: 1, height: 40, backgroundColor: colors.border },
  newNote: { marginTop: space[3], textAlign: 'center' },
  sectionTitle: { marginTop: space[8], marginBottom: space[3] },
  card: { marginBottom: space[3] },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { marginTop: space[3] },
  report: { marginTop: space[6] },
});
