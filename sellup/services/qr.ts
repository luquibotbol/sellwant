/**
 * Ticket code handling.
 *
 * SellUp never stores a raw QR payload -- only sha256 of its normalised form.
 * A dump of the database must not be a pile of usable tickets.
 */
import * as Crypto from 'expo-crypto';
import jsQR from 'jsqr';

/** Params that change when a link is forwarded but do not change the ticket. */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'igshid', 'ref', 'referrer', 'share', 'from', 's',
];

/**
 * Reduce a payload to the thing that actually identifies the ticket.
 *
 * A ticket forwarded through iMessage picks up `?utm_source=imessage`; without
 * this it would hash differently from the original and the registry would miss
 * the duplicate. Params are stripped and the remainder sorted so ordering
 * cannot be used to dodge the check either.
 */
export function normalisePayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    url.protocol = url.protocol.toLowerCase();

    for (const p of TRACKING_PARAMS) url.searchParams.delete(p);

    const sorted = [...url.searchParams.entries()].sort(([a], [b]) =>
      a === b ? 0 : a < b ? -1 : 1
    );
    url.search = '';
    for (const [k, v] of sorted) url.searchParams.append(k, v);

    // Trailing slash on an otherwise-empty path is not meaningful.
    if (url.pathname.endsWith('/') && url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    // Not a URL -- many QR codes are opaque strings. Normalise whitespace only;
    // case can be significant in an opaque token, so it is left alone.
    return trimmed.replace(/\s+/g, ' ');
  }
}

/** sha256 of the normalised payload. This is the only form we persist. */
export async function hashPayload(raw: string): Promise<string> {
  const normalised = normalisePayload(raw);
  if (!normalised) throw new Error('Empty QR payload');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, normalised);
}

/** For display only -- never show a seller's full code to anyone else. */
export function maskCode(raw: string): string {
  const s = raw.trim();
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

/**
 * Decode a QR from an image on web, via canvas pixel data.
 * Native uses the camera scanner instead -- decoding a JPEG to raw pixels on
 * device would mean shipping a decoder for no benefit when a camera is present.
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
