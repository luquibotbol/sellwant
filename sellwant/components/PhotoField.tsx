import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from '@/components/ui';
import PhotoCarousel from '@/components/PhotoCarousel';
import { space } from '@/constants/theme';
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

      {/* The same carousel the listing page uses, so what you are looking at
          while posting is what a buyer will see -- including the letterboxing
          on a tall photo, which is worth discovering before you publish and
          not after. */}
      <PhotoCarousel urls={value} onRemove={remove} />

      {remaining > 0 && (
        <Button
          title={value.length ? `Add another (${remaining} left)` : 'Add photos'}
          variant="secondary"
          loading={busy}
          onPress={add}
          style={styles.add}
        />
      )}

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
  add: { marginTop: space[4] },
  hint: { marginTop: space[3], lineHeight: 16 },
});

export default PhotoField;
