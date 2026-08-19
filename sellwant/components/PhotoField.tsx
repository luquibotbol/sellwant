import React, { useState } from 'react';
import { View, StyleSheet, Image, Pressable, ActivityIndicator } from 'react-native';
import { Text } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import {
  MAX_LISTING_PHOTOS,
  pickListingPhotos,
  uploadListingPhoto,
  TicketPhotoRejected,
} from '@/services/listing-photos';

interface Props {
  /** Public URLs already attached to the listing. */
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * Optional photos for a listing, up to three.
 *
 * Optional in the real sense: most listings are a wristband and a date, and a
 * required photo would just produce three hundred pictures of the same club.
 * It earns its place on the ones where the seat matters, or where a stranger
 * is deciding whether this person is real.
 *
 * The one thing it is firm about is not accepting a picture of the ticket.
 * That is checked, not merely asked -- see services/listing-photos.ts.
 */
export function PhotoField({ value, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = MAX_LISTING_PHOTOS - value.length;

  const add = async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await pickListingPhotos(remaining);
      if (!picked.length) return;
      const urls: string[] = [];
      for (const p of picked) urls.push(await uploadListingPhoto(p.base64));
      // Re-slice rather than trusting the picker: the limit is the product
      // rule, and the column enforces it too.
      onChange([...value, ...urls].slice(0, MAX_LISTING_PHOTOS));
    } catch (e) {
      const message = (e as Error)?.message ?? '';
      setError(
        e instanceof TicketPhotoRejected
          ? e.message
          : // Until 20260819_listing_photos.sql is applied there is no bucket
            // to upload into, and Supabase says so in its own words.
            /bucket/i.test(message)
            ? 'Photo uploads aren’t switched on yet.'
            : message || 'Could not add that photo'
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = (url: string) => {
    // Only detached, never deleted from storage. Removing a photo while
    // editing and then leaving without saving would otherwise destroy a file
    // the listing still points at, and the listing would show an empty frame
    // with no way to fix it. An orphaned file in a size-capped bucket costs
    // far less than a listing nobody can repair.
    onChange(value.filter((u) => u !== url));
  };

  return (
    <View style={styles.container}>
      <Text variant="small" tone="muted" style={styles.label}>
        Photos <Text variant="small" tone="subtle">— optional, up to {MAX_LISTING_PHOTOS}</Text>
      </Text>

      <View style={styles.row}>
        {value.map((url) => (
          <View key={url} style={styles.thumbWrap}>
            <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
            <Pressable
              onPress={() => remove(url)}
              style={styles.removeBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
            >
              <Text variant="caption" tone="inverse">✕</Text>
            </Pressable>
          </View>
        ))}

        {remaining > 0 && (
          <Pressable
            onPress={add}
            disabled={busy}
            style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
          >
            {busy ? (
              <ActivityIndicator color={colors.mutedForeground} />
            ) : (
              <Text variant="title" tone="subtle">+</Text>
            )}
          </Pressable>
        )}
      </View>

      {/* Said plainly, because the check cannot catch everything: a photo of a
          ticket at an angle, or a barcode rather than a QR, may still get
          through, and the consequence is somebody else scanning in first. */}
      <Text variant="caption" tone="subtle" style={styles.hint}>
        Show the event, the venue, or your seats. Never a photo of the ticket
        itself — these are public, and a code in one can be used by anyone.
      </Text>

      {!!error && (
        <Text variant="caption" tone="destructive" style={styles.hint}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: space[5] },
  label: { marginBottom: space[2] },
  row: { flexDirection: 'row', gap: space[3], flexWrap: 'wrap' },
  thumbWrap: { position: 'relative' },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: radius.lg,
    backgroundColor: colors.muted,
  },
  removeBtn: {
    position: 'absolute',
    top: -space[2],
    right: -space[2],
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    width: 84,
    height: 84,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPressed: { backgroundColor: colors.muted },
  hint: { marginTop: space[3], lineHeight: 16 },
});

export default PhotoField;
