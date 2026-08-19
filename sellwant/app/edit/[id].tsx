import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import {
  Text,
  Card,
  Badge,
  Button,
  Input,
  DateField,
  CityField,
  EmptyState,
  ErrorState,
} from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { money } from '@/lib/format';
import { City, toCity } from '@/lib/cities';
import PhotoField from '@/components/PhotoField';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/hooks/useSession';
import { getListing, updateListing, listLocationSuggestions } from '@/services/data';

/**
 * Edit a listing.
 *
 * Deliberately not the create form in a second mode. Creating registers a
 * ticket code and picks a listing type; neither can change afterwards, and
 * threading "is this an edit" through all of that would leave one screen doing
 * two jobs badly.
 *
 * The fields here are exactly the columns the database will accept from a
 * client. If a field is not on this screen, it is because a client cannot
 * write it -- not because we forgot.
 */
export default function EditListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const listing = useAsync(() => getListing(id), [id]);

  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [city, setCity] = useState<City | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  // What the listing held before cities existed, so the field can say what is
  // about to be replaced instead of silently dropping it.
  const [originalLocation, setOriginalLocation] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fill the form once, when the listing arrives. Keyed on `ready` rather than
  // the data, so a background reload cannot overwrite what someone is typing.
  useEffect(() => {
    const l = listing.data;
    if (!l || ready) return;
    setTitle(l.title);
    setPrice(String(l.price_cents / 100));
    setCity(toCity(l.location));
    setPhotos(l.image_urls ?? []);
    setOriginalLocation(l.location);
    setDate(l.event_date ?? '');
    setDescription(l.description ?? '');
    setReady(true);
  }, [listing.data, ready]);

  if (session === undefined || listing.loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (!session) return <Redirect href="/signin" />;
  if (listing.error) {
    return (
      <View style={styles.container}>
        <ErrorState message={listing.error.message} onRetry={listing.reload} />
      </View>
    );
  }

  const l = listing.data;
  if (!l) {
    return (
      <View style={styles.container}>
        <EmptyState title="Listing not found" body="It may have been taken down." />
      </View>
    );
  }
  if (l.user_id !== session.user.id) {
    return (
      <View style={styles.container}>
        <EmptyState title="Not yours to edit" body="You can only edit listings you posted." />
      </View>
    );
  }
  // The policy refuses edits once a listing leaves the market, so say why
  // rather than letting someone type into a form that will be rejected.
  if (l.status !== 'active') {
    return (
      <View style={styles.container}>
        <EmptyState
          title="This listing is closed"
          body={
            l.status === 'locked'
              ? "Someone's mid-handoff on this. Changing the price now would be changing the deal after the handshake."
              : `It is ${l.status}, so it can no longer be edited.`
          }
          actionLabel="Back to your listings"
          onAction={() => router.replace('/my-listings')}
        />
      </View>
    );
  }

  const selling = l.type === 'sell';

  const save = async () => {
    const cents = Math.round(parseFloat(price) * 100);
    if (!title.trim()) return setError('Give it a title');
    if (!Number.isFinite(cents) || cents <= 0) return setError('Enter a price');

    setBusy(true);
    setError(null);
    try {
      await updateListing(l.id, {
        title: title.trim(),
        price_cents: cents,
        location: city,
        image_urls: photos,
        event_date: date || null,
        description: description.trim() || null,
      });
      router.replace('/my-listings');
    } catch (e: any) {
      setError(e?.message ?? 'Could not save that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <Badge label={selling ? 'FOR SALE' : 'WANTED'} variant={selling ? 'sell' : 'want'} />
        <Text variant="caption" tone="subtle">
          listed at {money(l.price_cents)}
        </Text>
      </View>

      {/* Changing the going rate under people who have already bid is worth a
          word of warning, not a block. */}
      {l.offer_count > 0 && (
        <Card accent={selling ? 'sell' : 'want'} style={styles.notice}>
          <Text variant="small" tone="muted">
            {l.offer_count} {l.offer_count === 1 ? 'person has' : 'people have'} already
            offered on this. They will see the new price, and their offers stay as they are.
          </Text>
        </Card>
      )}

      <Input
        label="What is it"
        value={title}
        onChangeText={setTitle}
        placeholder="Kappa formal — 1 spot"
        containerStyle={styles.field}
      />
      <Input
        label={selling ? "What you're asking" : "What you'll pay"}
        value={price}
        onChangeText={setPrice}
        placeholder="35"
        keyboardType="numeric"
        containerStyle={styles.field}
      />
      <View style={styles.field}>
        <CityField
          value={city}
          onChange={setCity}
          legacyValue={originalLocation}
        />
      </View>
      <View style={styles.field}>
        {/* No `min` here, unlike creating: an existing listing may legitimately
            be for a date already past, and refusing to render it would trap
            the owner out of fixing the title. */}
        <DateField label="When" value={date} onChange={setDate} allowNone />
      </View>
      <Input
        label="Anything else"
        value={description}
        onChangeText={setDescription}
        placeholder="Optional"
        multiline
        containerStyle={styles.field}
      />

      {!!error && (
        <Text variant="small" tone="destructive" style={styles.error}>
          {error}
        </Text>
      )}

      <Button
        title="Save changes"
        variant={selling ? 'sell' : 'want'}
        block
        loading={busy}
        onPress={save}
        style={styles.save}
      />
      <Button
        title="Cancel"
        variant="ghost"
        block
        onPress={() => router.back()}
        style={styles.back}
      />
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notice: { marginTop: space[4] },
  field: { marginTop: space[4] },
  error: { marginTop: space[4] },
  save: { marginTop: space[6] },
  back: { marginTop: space[2] },
});
