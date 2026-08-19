/**
 * Photos on a listing.
 *
 * The interesting part is what we refuse to upload. A listing photo is public
 * -- that is the point of it -- and a Bubbl QR is a bearer token: anyone who
 * can see the picture can scan it in. Somebody photographing "the ticket" to
 * illustrate their listing is the obvious mistake to make, and it hands their
 * ticket to the first person who screenshots the page.
 *
 * So every picked image is decoded before it is uploaded, and one that
 * contains a scannable code is rejected with an explanation rather than a
 * shrug. The decoder is the same one the ticket field uses.
 */
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { supabase } from '@/services/supabase';
import { getSession } from '@/services/data';
import { decodeQrFromImageWeb } from '@/services/qr';

/** Product limit, mirrored by a CHECK constraint on the column. */
export const MAX_LISTING_PHOTOS = 3;

const BUCKET = 'listing-photos';

/** Manual base64 decode: atob is not reliably present in the RN runtime. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(((clean.length * 3) / 4) | 0);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      (B64.indexOf(clean[i + 2]) << 6) |
      B64.indexOf(clean[i + 3]);
    bytes[p++] = (n >> 16) & 255;
    if (clean[i + 2] !== undefined) bytes[p++] = (n >> 8) & 255;
    if (clean[i + 3] !== undefined) bytes[p++] = n & 255;
  }
  return bytes.subarray(0, p);
}

export interface PickedPhoto {
  /** Local preview URI, shown while the upload is in flight. */
  uri: string;
  base64: string;
}

export class TicketPhotoRejected extends Error {
  constructor() {
    super(
      'That looks like a ticket. Listing photos are public, and a scannable ' +
        'code in one can be used by anyone who sees it — post a photo of the ' +
        'event or the venue instead.'
    );
    this.name = 'TicketPhotoRejected';
  }
}

/**
 * Pick up to `remaining` images, refusing any that carry a scannable code.
 *
 * The check only runs on web, because jsQR needs a canvas; native has no
 * decoder here. That is a real gap rather than a hidden one -- the field says
 * so in its own words, and native is not where this app is mostly used.
 */
export async function pickListingPhotos(remaining: number): Promise<PickedPhoto[]> {
  if (remaining <= 0) return [];

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: true,
    selectionLimit: remaining,
    quality: 0.7,
    base64: true,
  });
  if (picked.canceled) return [];

  const out: PickedPhoto[] = [];
  for (const asset of picked.assets.slice(0, remaining)) {
    if (!asset.base64) throw new Error('Could not read that image');

    if (Platform.OS === 'web') {
      // A decodable code is the signal. Failing to decode is not proof the
      // image is safe, only that we could not read one -- which is why the
      // copy in the field still asks rather than relying on this alone.
      const payload = await decodeQrFromImageWeb(asset.uri).catch(() => null);
      if (payload) throw new TicketPhotoRejected();
    }

    out.push({ uri: asset.uri, base64: asset.base64 });
  }
  return out;
}

/**
 * Uploads to listing-photos/<uid>/<name>.jpg and returns the public URL.
 *
 * The folder is the caller's id because that is what the storage policy pins
 * to. Listings get their photos before they have an id -- creating is one form
 * submission -- so the file name is random rather than derived from a listing.
 */
export async function uploadListingPhoto(base64: string): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');

  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const path = `${session.user.id}/${name}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, base64ToBytes(base64), { contentType: 'image/jpeg' });
  if (error) throw error;

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
