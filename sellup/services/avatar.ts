/**
 * Profile picture upload.
 *
 * Note on Instagram: there is no legitimate way to pull a student's Instagram
 * profile picture. The Basic Display API was shut down on 2024-12-04, and its
 * replacements (Instagram Graph API / Instagram Login) only support Business
 * and Creator accounts -- personal accounts, which is what students have, have
 * no official path at all. Anything that claims to fetch them scrapes
 * Instagram, which breaks Meta's terms. So we upload.
 */
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/services/supabase';
import { getSession } from '@/services/data';

/** Manual base64 decode: atob is not reliably present in the RN runtime. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array((clean.length * 3) / 4 | 0);
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

export interface PickedAvatar {
  /** Local preview URI, shown before the upload finishes. */
  uri: string;
  base64: string;
}

/** Square crop, downscaled -- a 12MP phone photo has no business being an avatar. */
export async function pickAvatar(): Promise<PickedAvatar | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
    base64: true,
  });
  if (picked.canceled) return null;

  const asset = picked.assets[0];
  if (!asset.base64) throw new Error('Could not read that image');
  return { uri: asset.uri, base64: asset.base64 };
}

/**
 * Uploads to avatars/<uid>/avatar.jpg and returns a public URL.
 * Storage policy pins the folder to the caller's own id, so one user cannot
 * overwrite another's picture.
 */
export async function uploadAvatar(base64: string): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');

  const path = `${session.user.id}/avatar.jpg`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, base64ToBytes(base64), {
      contentType: 'image/jpeg',
      upsert: true,
    });
  if (error) throw error;

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  // The path never changes, so bust the CDN cache or a new picture shows the
  // old one until the browser expires it.
  return `${data.publicUrl}?v=${Date.now()}`;
}
