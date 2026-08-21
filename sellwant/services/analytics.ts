import { Platform } from 'react-native';

/**
 * Page impressions.
 *
 * Deliberately tiny, and deliberately not a library. The whole module is a
 * queue and one `sendBeacon`, because the cost of measuring the site must not
 * be visible in the site.
 *
 * `sendBeacon` rather than `fetch`: the browser sends it in the background,
 * outside the page's own network priority, and it survives the page being
 * closed. Nothing here is awaited and nothing here can delay a render.
 *
 * What is sent is the path and, for a listing, its id. No cookie, no
 * fingerprint, no IP -- the worker sees the IP as every server does and does
 * not keep it. A visit is grouped by a random id kept for the tab only, which
 * is enough to tell "one person read four listings" from "four people read
 * one" and not enough to follow anybody between visits.
 */

const ENDPOINT = '/api/view';

/** Per-tab, regenerated on reload. Not stored, so there is nothing to link. */
const visit = Math.random().toString(36).slice(2, 12);

/** Coalesces bursts: a route change can fire twice as a screen settles. */
let last = '';
let timer: ReturnType<typeof setTimeout> | null = null;

export function trackView(path: string, listingId?: string): void {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return;
  if (path === last) return;
  last = path;

  if (timer) clearTimeout(timer);
  // A beat of debounce, so a redirect on arrival counts the destination
  // rather than both ends of it.
  timer = setTimeout(() => {
    const body = JSON.stringify({ path, listingId, visit });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      }
    } catch {
      // Measuring the site is never worth breaking it.
    }
  }, 300);
}
