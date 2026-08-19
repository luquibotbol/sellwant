/**
 * Keeps expo-router's bookkeeping out of the address bar.
 *
 * expo-router tags stack entries with __EXPO_ROUTER_key so it can tell two
 * visits to the same route apart, and on web that tag lands in the URL. Ours
 * arrived as `__EXPO_ROUTER_key=undefined-vjsfET3...`, which is what people
 * then copied and pasted to a friend. For a marketplace whose distribution is
 * a link in a group chat, the address bar is a product surface.
 *
 * Using navigate() instead of push() stops the app creating them, but that
 * only covers the calls we write -- anything expo-router does internally, and
 * any push() added later, would put it back. Patching the two history methods
 * that can change the URL closes it off at the last point before the browser:
 * whatever asks, the parameter does not make it into the bar.
 *
 * Only the URL is rewritten. The state object expo-router passes is forwarded
 * untouched, so its own routing is unaffected -- it never reads its stack back
 * out of the query string.
 */
const PARAM = '__EXPO_ROUTER_key';

/** A URL with the router's key removed, or the input if it had none. */
export function stripRouterKey(href: string, base?: string): string {
  // Relative URLs are legal in pushState, hence the base.
  const url = new URL(href, base ?? 'http://localhost');
  if (!url.searchParams.has(PARAM)) return href;
  url.searchParams.delete(PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

type HistoryFn = (state: unknown, unused: string, url?: string | URL | null) => void;

/** Idempotent: repeated calls (fast refresh, remounts) patch once. */
let patched = false;

export function installUrlCleaner() {
  if (patched || typeof window === 'undefined' || !window.history) return;
  patched = true;

  const wrap = (original: HistoryFn): HistoryFn =>
    function (this: History, state, unused, url) {
      if (url == null) return original.call(this, state, unused, url);
      return original.call(
        this,
        state,
        unused,
        stripRouterKey(String(url), window.location.href)
      );
    };

  window.history.pushState = wrap(window.history.pushState.bind(window.history));
  window.history.replaceState = wrap(window.history.replaceState.bind(window.history));

  // A link opened with the parameter already on it -- a stale one someone
  // shared before this existed -- is cleaned on arrival, without adding a
  // history entry that the back button would have to step through.
  const now = stripRouterKey(window.location.href, window.location.href);
  if (now !== window.location.href) {
    window.history.replaceState(window.history.state, '', now);
  }
}
