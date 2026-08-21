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
  edit: '/edit/[id].html',
  event: '/event/[id].html',
  u: '/u/[id].html',
};

/**
 * Only listings get rich previews. Deals and profiles are private -- their
 * templates are served, but nothing about them is ever described to a scraper.
 */
const PREVIEWABLE = 'event';

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

/** HTML-escape. Used where we genuinely build markup, which -- unlike setting
 *  an attribute -- has no escaping of its own. */
const esc = (t) =>
  String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * schema.org for one listing.
 *
 * The two listing types get genuinely different types, which is the whole
 * point: `Offer` announces a ticket for sale, `Demand` announces someone
 * seeking one. schema.org has both, and flattening a want listing into an
 * Offer would tell every reader the opposite of the truth.
 *
 * validThrough is the event date: a ticket to a party that has happened is no
 * longer an offer, and saying so stops stale listings being quoted as live.
 */
export function jsonLd(listing, url) {
  const selling = listing.type === 'sell';
  const terms = {
    '@type': selling ? 'Offer' : 'Demand',
    price: (listing.price_cents / 100).toFixed(2),
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
    url,
    ...(listing.event_date ? { validThrough: listing.event_date } : {}),
  };

  const doc = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: plain(listing.title, 120) || 'Ticket',
    url,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(listing.event_date ? { startDate: listing.event_date } : {}),
    ...(listing.location
      ? { location: { '@type': 'Place', name: plain(listing.location, 120) } }
      : {}),
    // Offer and Demand are both valid under `offers`; the @type inside says
    // which direction this listing points.
    offers: terms,
  };

  // A literal </script> inside a JSON string would close the block early.
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}

/**
 * The listing as plain HTML, for readers that do not run JavaScript.
 *
 * In <noscript> on purpose. The page is client-rendered, so without this a
 * crawler receives nine characters of shell. Putting it in the live DOM
 * instead would duplicate the content for anyone using a screen reader and
 * fight React on hydration; <noscript> says exactly what it means -- here is
 * the content if you are not running scripts -- and matches what the app
 * renders, so it is not cloaking.
 */
export function bodySummary(listing, url) {
  const selling = listing.type === 'sell';
  const price = money(listing.price_cents);
  const rows = [
    listing.event_date ? `<li>When: ${esc(pretty(listing.event_date))}</li>` : '',
    listing.location ? `<li>Where: ${esc(plain(listing.location, 120))}</li>` : '',
    `<li>${selling ? 'Asking' : 'Offering'}: ${esc(price)}</li>`,
    listing.best_offer_cents != null
      ? `<li>${selling ? 'Top offer' : 'Lowest ask'}: ${esc(money(listing.best_offer_cents))}</li>`
      : '',
  ].filter(Boolean).join('');

  return (
    `<noscript><article>` +
    `<h1>${esc(plain(listing.title, 120))}</h1>` +
    `<p>${selling ? 'For sale on SellWant.' : 'Wanted on SellWant.'}</p>` +
    `<ul>${rows}</ul>` +
    (listing.description ? `<p>${esc(plain(listing.description, 400))}</p>` : '') +
    `<p>Money is paid directly between the two people; SellWant never holds it. ` +
    `The handoff happens in person.</p>` +
    `<p><a href="${esc(url)}">${esc(url)}</a></p>` +
    `</article></noscript>`
  );
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
function withListingData(response, listing, url) {
  const card = cardFor(listing, url);
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
    // Machine-readable listing, and a human-readable fallback for anything
    // that does not run the bundle.
    .on('head', {
      element(el) {
        el.append(
          `<script type="application/ld+json">${jsonLd(listing, url)}</script>`,
          { html: true }
        );
        el.append(`<link rel="canonical" href="${esc(url)}"/>`, { html: true });
      },
    })
    .on('body', {
      element(el) {
        el.prepend(bodySummary(listing, url), { html: true });
      },
    })
    .transform(response);
}

/**
 * Per-route metadata.
 *
 * Applied here rather than by each screen because expo-router keeps the
 * initial route mounted underneath every other one, so its <Head> wins and a
 * per-screen override is silently discarded. The Worker knows the path for
 * certain.
 */
const ROUTE_META = {
  '/signin': {
    title: 'Sign in — SellWant',
    description:
      'Sign in to make offers and post tickets on SellWant. Browsing is free and needs no account.',
    canonical: '/signin',
  },
};

function withRouteMeta(response, meta, origin) {
  const set = (v) => ({ element(el) { el.setAttribute('content', v); } });
  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(meta.title); } })
    .on('meta[name="description"]', set(meta.description))
    .on('meta[property="og:title"]', set(meta.title))
    .on('meta[property="og:description"]', set(meta.description))
    .on('meta[name="twitter:title"]', set(meta.title))
    .on('meta[name="twitter:description"]', set(meta.description))
    .on('link[rel="canonical"]', {
      element(el) { el.setAttribute('href', `${origin}${meta.canonical}`); },
    })
    .transform(response);
}

/** Every active listing, newest first. Shared by the feed injection and the
 *  JSON endpoint so they can never describe different markets. */
async function fetchActive(env, limit = 100) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return [];
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/listings` +
        `?select=id,title,type,price_cents,event_date,location,best_offer_cents,offer_count` +
        `&status=eq.active&order=created_at.desc&limit=${limit}`,
      { headers: { apikey: env.SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * The feed as plain HTML and as an ItemList.
 *
 * The homepage is the page most likely to be crawled and was the emptiest --
 * one character of body text, because the app renders client-side. Without
 * this, a search engine or model knows the site exists and nothing about what
 * is on it.
 */
function feedInjection(rows, origin) {
  const items = rows.slice(0, 40);

  const html =
    `<noscript><section><h1>Tickets on SellWant</h1>` +
    `<p>A free marketplace for event tickets. People post tickets they are ` +
    `selling and tickets they are looking for. No fees and no commission -- ` +
    `SellWant never handles the money.</p>` +
    (items.length
      ? `<ul>` +
        items
          .map((l) => {
            const selling = l.type === 'sell';
            const bits = [
              esc(plain(l.title, 100)),
              selling ? 'for sale' : 'wanted',
              esc(money(l.price_cents)),
              l.event_date ? esc(pretty(l.event_date)) : '',
              l.location ? esc(plain(l.location, 80)) : '',
            ].filter(Boolean);
            return `<li><a href="${origin}/event/${esc(l.id)}">${bits.join(' — ')}</a></li>`;
          })
          .join('') +
        `</ul>`
      : `<p>No live listings right now.</p>`) +
    `</section></noscript>`;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Active ticket listings on SellWant',
    numberOfItems: items.length,
    itemListElement: items.map((l, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${origin}/event/${l.id}`,
      name: plain(l.title, 100),
    })),
  };

  // Identity for the site itself, so a model can attribute what it reads.
  const site = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        url: `${origin}/`,
        name: 'SellWant',
        description:
          'A free two-sided marketplace for event tickets. Buy what you want, sell what you have.',
        inLanguage: 'en',
      },
      {
        '@type': 'Organization',
        '@id': `${origin}/#org`,
        name: 'SellWant',
        url: `${origin}/`,
        logo: `${origin}/og.png`,
      },
    ],
  };

  return {
    html,
    ld: [JSON.stringify(site), JSON.stringify(itemList)]
      .map((j) => j.replace(/</g, '\\u003c'))
      .join('</script><script type="application/ld+json">'),
  };
}

function withFeedData(response, rows, origin) {
  const { html, ld } = feedInjection(rows, origin);
  return new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(`<script type="application/ld+json">${ld}</script>`, { html: true });
      },
    })
    .on('body', { element(el) { el.prepend(html, { html: true }); } })
    .transform(response);
}

/**
 * Every active listing as JSON.
 *
 * Documented in llms.txt so an agent has one stable place to read the market,
 * rather than reverse-engineering Supabase's REST shape from the bundle --
 * which works today and would tie the public contract to our database.
 */
async function listingsJson(env, origin) {
  const rows = await fetchActive(env, 200);
  const body = JSON.stringify(
    {
      site: 'SellWant',
      docs: `${origin}/llms.txt`,
      note: 'Read-only. Posting and offering require a signed-in account.',
      count: rows.length,
      listings: rows.map((l) => ({
        id: l.id,
        url: `${origin}/event/${l.id}`,
        title: l.title,
        // "sell" means someone has a ticket; "want" means someone needs one.
        type: l.type === 'sell' ? 'sell' : 'want',
        price_usd: l.price_cents / 100,
        going_rate_usd: l.best_offer_cents == null ? null : l.best_offer_cents / 100,
        offers: l.offer_count ?? 0,
        event_date: l.event_date,
        location: l.location,
      })),
    },
    null,
    2
  );
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=60',
      // Public data, so let a browser-based agent read it cross-origin.
      'access-control-allow-origin': '*',
    },
  });
}

/**
 * Every active listing as a sitemap.
 *
 * Same active-only rule as the feed, so sold and cancelled listings stay out --
 * a completed trade's price belongs to the two people who made it.
 */
async function sitemap(env, origin) {
  const urls = ['/', '/feed', '/terms', '/privacy'];
  let rows = [];
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/listings?select=id,created_at&status=eq.active&limit=5000`,
      { headers: { apikey: env.SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) rows = await res.json();
  } catch {
    // A sitemap of the static routes still beats a 500.
  }
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    urls.map((u) => `<url><loc>${origin}${u}</loc></url>`).join('') +
    (Array.isArray(rows) ? rows : [])
      .map(
        (r) =>
          `<url><loc>${origin}/event/${esc(r.id)}</loc>` +
          // created_at, because listings have no updated_at. Close enough for
          // lastmod: the row's text does not change, only its offers do.
          (r.created_at ? `<lastmod>${esc(String(r.created_at).slice(0, 10))}</lastmod>` : '') +
          `</url>`
      )
      .join('') +
    `</urlset>`;

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=600',
    },
  });
}

/** The one hostname everything should be reachable at. */
const CANONICAL = 'sellwant.com';

/**
 * Where a request should be redirected to reach the canonical host, or null
 * if it is already there.
 *
 * Pulled out as a pure function because `wrangler dev` rewrites the request
 * host to the first configured route, so the redirect cannot be exercised
 * locally through an actual HTTP call -- the only honest way to cover it is
 * to test the decision directly.
 */
export function canonicalTarget(rawUrl, canonical = CANONICAL) {
  const url = new URL(rawUrl);
  if (url.hostname !== `www.${canonical}`) return null;
  url.hostname = canonical;
  // Path, query and hash ride along: someone opening a shared listing on www
  // must land on that listing, not the homepage.
  return url.toString();
}


/**
 * Is this user agent something other than a person reading the page?
 *
 * Exported so it can be tested directly. Checking it by parsing this file with
 * a regex was tried and lied twice -- an apostrophe in a comment was enough to
 * shift the whole list -- which is the same reason canonicalTarget is exported.
 *
 * The link previewers matter most here and are the easiest to forget: this
 * product spreads by somebody pasting a listing into a group chat, and every
 * one of those pastes makes WhatsApp or iMessage or Discord fetch the page. A
 * generic /bot/ misses facebookexternalhit entirely, which on a site like this
 * is probably the most common non-human hit there is.
 */
const NOT_A_PERSON = [
  // Generic crawlers and tooling.
  'bot', 'crawl', 'spider', 'slurp', 'scrape', 'monitor', 'lighthouse',
  'headless', 'curl', 'wget', 'python', 'node-fetch', 'okhttp', 'axios',
  // Link previewers.
  'facebookexternalhit', 'whatsapp', 'telegram', 'skypeuripreview',
  'discord', 'slack', 'linkedin', 'pinterest', 'redditbot', 'twitterbot',
  'embedly', 'vkshare', 'applebot', 'bingpreview', 'yandex', 'preview',
  // Agents reading on behalf of a person, which the llms.txt work invites.
  'gptbot', 'chatgpt', 'claude', 'anthropic', 'perplexity', 'ccbot',
  'google-extended', 'cohere', 'bytespider', 'amazonbot',
];

export function isAgent(userAgent) {
  const ua = String(userAgent || '').trim().toLowerCase();
  // No agent at all is not a browser. Every browser sends one, so an absent
  // header is either tooling or somebody who noticed that omitting it was the
  // cheapest way to make a listing look popular.
  if (!ua) return true;
  return NOT_A_PERSON.some((needle) => ua.includes(needle));
}

/**
 * A page impression, posted by the client as a beacon.
 *
 * The endpoint lives here rather than the client writing to Supabase directly
 * so that three things stay true: the request is 131 bytes with no auth
 * headers and can be a sendBeacon, the IP is seen by a server that does not
 * keep it, and crawlers can be dropped before they reach the table.
 *
 * Always answers 204, whatever happens. A beacon has nobody listening for the
 * reply, and a failure to count a view must never be visible to the person
 * being counted.
 */
async function recordView(request, env, ctx) {
  const done = new Response(null, { status: 204 });
  if (request.method !== 'POST') return done;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return done;

  // Crawlers, previewers and agents are traffic, but they are not people
  // looking at a listing, and mixing them in makes every number a guess.
  //
  // The link previewers matter most here and are the easiest to forget: this
  // product spreads by someone pasting a listing into a group chat, and every
  // one of those pastes makes WhatsApp or iMessage or Discord fetch the page.
  // A generic /bot/ misses facebookexternalhit entirely -- the single most
  // common non-human hit on a site like this -- so they are named.
  const ua = request.headers.get('user-agent');
  if (isAgent(ua)) return done;

  let body;
  try {
    body = await request.json();
  } catch {
    return done;
  }

  const path = typeof body?.path === 'string' ? body.path.slice(0, 200) : '';
  const visit = typeof body?.visit === 'string' ? body.visit.slice(0, 64) : '';
  if (!path.startsWith('/') || visit.length < 4) return done;

  // Only a real uuid becomes a listing reference; anything else is just a path.
  const listingId =
    typeof body?.listingId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.listingId)
      ? body.listingId
      : null;

  // Not awaited: the response goes back immediately and the write finishes
  // after it. waitUntil is what keeps the worker alive long enough to do that.
  ctx.waitUntil(
    fetch(`${env.SUPABASE_URL}/rest/v1/page_views`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        // A repeat view from the same tab on the same day hits the unique
        // constraint; that is the intended outcome, not an error to report.
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({ path, visit_id: visit, listing_id: listingId }),
    }).catch(() => {})
  );

  return done;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // One canonical host. Serving the app on both www and the apex would split
    // every shared link between two URLs, and -- more concretely -- Supabase's
    // Site URL and redirect allow-list name the apex only, so signing in on www
    // would fail in a way that looks like an app bug.
    //
    // 301 rather than 302: this is permanent, and browsers and scrapers cache
    // it, so the redirect stops costing anything after the first hit.
    const canonical = canonicalTarget(request.url);
    if (canonical) return Response.redirect(canonical, 301);

    // Generated, not static files: both describe live listings.
    if (url.pathname === '/sitemap.xml') return sitemap(env, url.origin);
    if (url.pathname === '/api/listings.json') return listingsJson(env, url.origin);
    if (url.pathname === '/api/view') return recordView(request, env, ctx);

    // With run_worker_first the platform no longer tries assets before us, so
    // do it here. Anything that matches a real file -- every page, script,
    // font and image -- is served exactly as before; only a miss falls through
    // to the rewrite below. not_found_handling is "none", so a miss is a 404.
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) {
      // The feed renders client-side, so its prerendered body is one
      // character -- and it is the page most likely to be crawled. Inject the
      // current market into it, cached like the listing pages.
      if (url.pathname === '/' || url.pathname === '/feed') {
        const key = new Request(`${url.origin}/__feed_seo${url.pathname}`, { method: 'GET' });
        const hitCache = await caches.default.match(key);
        if (hitCache) return hitCache;

        const rows = await fetchActive(env, 100);
        // With nothing to say, say nothing rather than an empty list.
        if (!rows.length) return asset;

        const enriched = withFeedData(asset, rows, url.origin);
        const out = new Response(enriched.body, {
          status: 200,
          headers: enriched.headers,
        });
        out.headers.set('cache-control', 'public, max-age=0, s-maxage=60');
        ctx.waitUntil(caches.default.put(key, out.clone()));
        return out;
      }
      const meta = ROUTE_META[url.pathname];
      if (meta) {
        const out = withRouteMeta(asset, meta, url.origin);
        return new Response(out.body, { status: 200, headers: out.headers });
      }
      return asset;
    }

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
        if (head !== PREVIEWABLE) return page;

        // Everyone gets the same markup, crawler or not.
        //
        // This was gated on a user-agent allowlist to keep the database read
        // off the path real people take. Two things were wrong with that:
        // serving crawlers different metadata is what cloaking means, and an
        // allowlist silently fails for exactly the unlisted agents this is
        // meant to be legible to. The edge cache buys the latency back without
        // telling anyone a different story.
        // Path only, deliberately. expo-router appends __EXPO_ROUTER_key to
        // in-app navigations, so the URL people copy out of the address bar
        // and paste to a friend carries a value unique to their session.
        // Keyed on the full URL, every share missed the cache and re-read the
        // database for a page identical to the cached one; used as og:url and
        // canonical, it told crawlers that one listing was an unbounded number
        // of near-duplicate pages.
        const shareUrl = `${url.origin}${url.pathname}`;
        const key = new Request(shareUrl, { method: 'GET' });
        const cached = await caches.default.match(key);
        if (cached) return cached;

        const listing = await fetchListing(env, tail);
        if (!listing) return page;

        const enriched = withListingData(page, listing, shareUrl);
        const out = new Response(enriched.body, { status: 200, headers: enriched.headers });
        // Short, because prices move and a settled listing must stop being
        // advertised as available. s-maxage keeps it at the edge without
        // pinning a stale copy in anyone's browser.
        out.headers.set('cache-control', 'public, max-age=0, s-maxage=60');
        ctx.waitUntil(caches.default.put(key, out.clone()));
        return out;
      }
    }

    const missing = await env.ASSETS.fetch(new URL('/+not-found.html', url.origin));
    return new Response(missing.body, { status: 404, headers: missing.headers });
  },
};
