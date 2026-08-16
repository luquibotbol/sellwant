/**
 * Payload normalisation for the ticket registry.
 *
 * Kept free of platform imports (no expo-crypto, no DOM) so it can be run and
 * tested directly. Correctness here is a security property: if normalisation is
 * too loose, unrelated tickets collide and honest sellers get blocked; too
 * strict, and a forwarded link slips past the duplicate check.
 */

/** Params that change when a link is forwarded but do not identify the ticket. */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'igshid', 'ref', 'referrer', 'share', 'from', 's',
];

/**
 * Reduce a payload to the thing that actually identifies the ticket.
 *
 * A ticket forwarded through iMessage picks up `?utm_source=imessage`; without
 * this it would hash differently from the original and the registry would miss
 * the duplicate. Params are stripped and the remainder sorted, so reordering
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

    if (url.pathname.endsWith('/') && url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    // Not a URL -- many QR payloads are opaque tokens. Normalise whitespace
    // only; case can be significant in a token, so it is left alone.
    return trimmed.replace(/\s+/g, ' ');
  }
}

/** For display only -- never show a seller's full code to anyone else. */
export function maskCode(raw: string): string {
  const s = raw.trim();
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}
