/**
 * Static host for the Expo web export, plus the two things a static host can't do.
 *
 * 1. `expo export -p web` emits each dynamic route as a file with literal
 *    brackets in its name — dist/event/[id].html. No browser ever asks for
 *    that path; they ask for /event/9f2c. Without a rewrite, every listing,
 *    deal and profile link 404s, and those are exactly the URLs people paste
 *    into a group chat.
 *
 * 2. That same file is shared by every listing, so its <meta> tags can only
 *    ever describe the site in general. For a marketplace spread by pasted
 *    links, a preview that says "SellWant" instead of "ñuna — $14, Sunday at
 *    luna night club" wastes the share. Below, a crawler fetching a listing
 *    gets the listing's own tags rewritten into that shared template.
 *
 * This script only runs when no asset matched, so the common path costs nothing.
 */

/** URL prefix -> the file Expo actually emitted for it. */
const DYNAMIC = {
  deal: '/deal/[id].html',
  event: '/event/[id].html',
  u: '/u/[id].html',
};

/**
 * Only listings get rich previews. Deals and profiles are private -- their
 * templates are served, but nothing about them is ever described to a scraper.
 */
const PREVIEWABLE = 'event';

/**
 * Social scrapers, which never run JavaScript.
 *
 * Gating on this keeps the Supabase round-trip off the path real visitors
 * take: a person loading a listing gets the template immediately and the app
 * fills in the real data, so there is nothing to gain from making them wait
 * for tags they will never look at. The page itself is identical either way --
 * only the metadata differs -- so this is not cloaking.
 */
const CRAWLER =
  /(facebookexternalhit|Twitterbot|Slackbot|Discordbot|WhatsApp|TelegramBot|LinkedInBot|Pinterest|redditbot|Googlebot|bingbot|DuckDuckBot|Applebot|iMessage|SkypeUriPreview|vkShare|W3C_Validator|embedly|Iframely|GroupMe)/i;

/**
 * User text, flattened for a preview card.
 *
 * HTMLRewriter's setAttribute already escapes quotes, and a browser keeps
 * angle brackets inert inside a quoted attribute -- verified against a real
 * parser, not assumed. This is not the security boundary. It is here because
 * scrapers are not all as strict as browsers, and because a card reading
 * "<script>alert(1)</script>" looks broken even when it is harmless.
 *
 * Also caps length: most platforms truncate a description around 200
 * characters, and truncating deliberately beats truncating mid-word.
 */
function plain(text, max) {
  const flat = String(text ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const money = (cents) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** "2026-08-23" -> "Sunday 23 August". Parsed as parts, not Date(string),
 *  because a bare date string is treated as UTC and can slip a day. */
function pretty(date) {
  if (!date) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * One active listing, or null.
 *
 * Uses the anon key, so this can only ever see what a logged-out visitor
 * could: active listings, no poster identity. A scraper cannot be told
 * anything the public feed would not already show.
 */
async function fetchListing(env, id) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  // A crawler waiting on us is a crawler that gives up. Better a generic card
  // than a timed-out one.
  const abort = AbortSignal.timeout(2500);
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/listings` +
        `?select=id,title,type,price_cents,event_date,location,best_offer_cents` +
        `&id=eq.${encodeURIComponent(id)}&status=eq.active&limit=1`,
      { headers: { apikey: env.SUPABASE_ANON_KEY }, signal: abort }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    // Network error, timeout, malformed id -- all mean "no rich preview".
    return null;
  }
}

function cardFor(listing, url) {
  const selling = listing.type === 'sell';
  const price = money(listing.price_cents);
  const name = plain(listing.title, 70) || 'A ticket';
  const title = selling ? `${name} — ${price}` : `Wanted: ${name} — ${price}`;

  const when = pretty(listing.event_date);
  const where = plain(listing.location, 60);
  const bits = [];
  if (when && where) bits.push(`${when} · ${where}.`);
  else if (when || where) bits.push(`${when || where}.`);

  if (listing.best_offer_cents != null) {
    bits.push(
      selling
        ? `Top offer ${money(listing.best_offer_cents)}.`
        : `Lowest ask ${money(listing.best_offer_cents)}.`
    );
  }
  bits.push(
    selling ? 'Buy it, or make an offer on SellWant.' : 'Got one? Name your price on SellWant.'
  );

  return { title, description: plain(bits.join(' '), 200), url };
}

/**
 * Rewrites the shared template's tags in place.
 *
 * HTMLRewriter rather than string replacement: it streams, and setAttribute
 * escapes for us. Listing titles are user input, so hand-built markup here
 * would be an injection into every scraped preview.
 */
function withCard(response, card) {
  const set = (value) => ({
    element(el) {
      el.setAttribute('content', value);
    },
  });
  return new HTMLRewriter()
    // react-helmet emits a data-rh title first, and the first title wins.
    .on('title', { element(el) { el.setInnerContent(card.title); } })
    .on('meta[property="og:title"]', set(card.title))
    .on('meta[name="twitter:title"]', set(card.title))
    .on('meta[property="og:description"]', set(card.description))
    .on('meta[name="twitter:description"]', set(card.description))
    .on('meta[name="description"]', set(card.description))
    .on('meta[property="og:url"]', set(card.url))
    .on('meta[property="og:type"]', set('product'))
    .transform(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const [, head, tail, ...rest] = url.pathname.split('/');

    // Exactly two segments. A third means a path we never generated, so let it
    // fall through to the 404 rather than serving a template that will render
    // an empty screen.
    if (rest.length === 0 && tail && Object.hasOwn(DYNAMIC, head)) {
      const target = new URL(DYNAMIC[head], url.origin);
      const hit = await env.ASSETS.fetch(new Request(target, { headers: request.headers }));

      if (hit.ok) {
        // Serve the template under the URL the visitor actually requested: the
        // app reads the id off location, and rewriting it would break routing.
        // Status is forced to 200 -- this is a real page, not a fallback.
        const page = new Response(hit.body, { status: 200, headers: hit.headers });

        if (head === PREVIEWABLE && CRAWLER.test(request.headers.get('user-agent') || '')) {
          const listing = await fetchListing(env, tail);
          if (listing) return withCard(page, cardFor(listing, url.toString()));
        }
        return page;
      }
    }

    const missing = await env.ASSETS.fetch(new URL('/+not-found.html', url.origin));
    return new Response(missing.body, { status: 404, headers: missing.headers });
  },
};
