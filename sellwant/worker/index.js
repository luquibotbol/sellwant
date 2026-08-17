/**
 * Static host for the Expo web export, plus the one thing a static host can't do.
 *
 * `expo export -p web` emits each dynamic route as a file with literal brackets
 * in its name — dist/deal/[id].html. No browser ever asks for that path; they
 * ask for /deal/9f2c. Without a rewrite, every deal, listing and profile link
 * 404s, and those are precisely the URLs people paste into a group chat.
 *
 * This script only runs when no asset matched (not_found_handling is "none" and
 * assets are served before the Worker), so the common path costs nothing.
 */

/** URL prefix -> the file Expo actually emitted for it. */
const DYNAMIC = {
  deal: '/deal/[id].html',
  event: '/event/[id].html',
  u: '/u/[id].html',
};

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: (req: Request | URL) => Promise<Response> } }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const [, head, tail, ...rest] = url.pathname.split('/');

    // Exactly two segments. A third means a path we never generated, so let it
    // fall through to the 404 rather than serving a template that will render
    // an empty screen.
    if (rest.length === 0 && tail && Object.hasOwn(DYNAMIC, head)) {
      // The URL constructor percent-encodes the brackets, which is how the
      // asset manifest is keyed.
      const target = new URL(DYNAMIC[head], url.origin);
      const hit = await env.ASSETS.fetch(new Request(target, { headers: request.headers }));

      if (hit.ok) {
        // Serve the template under the URL the user actually requested: the app
        // reads the id off location, and rewriting it would break the route.
        // Status is forced to 200 — this is a real page, not a fallback.
        return new Response(hit.body, { status: 200, headers: hit.headers });
      }
    }

    const missing = await env.ASSETS.fetch(new URL('/+not-found.html', url.origin));
    return new Response(missing.body, {
      status: 404,
      headers: missing.headers,
    });
  },
};
