/**
 * Ticket code handling.
 *
 * SellWant never stores a raw QR payload -- only sha256 of its normalised form.
 * A dump of the database must not be a pile of usable tickets.
 *
 * The normalisation rules live in ./normalise so they carry no platform imports
 * and can be tested directly.
 */
import * as Crypto from 'expo-crypto';
import jsQR from 'jsqr';
import { normalisePayload } from '@/services/normalise';

export { normalisePayload, maskCode } from '@/services/normalise';

/** sha256 of the normalised payload. This is the only form we persist. */
export async function hashPayload(raw: string): Promise<string> {
  const normalised = normalisePayload(raw);
  if (!normalised) throw new Error('Empty QR payload');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, normalised);
}

/**
 * Decode a QR from an image on web, via canvas pixel data.
 * Native scans with the camera instead (see QrScannerModal) -- decoding a JPEG
 * to raw pixels on device would mean shipping a decoder for no benefit when a
 * camera is right there.
 */
export async function decodeQrFromImageWeb(uri: string): Promise<string | null> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = uri;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  return result?.data ?? null;
}
