# Making SellWant legible to machines

Layer one of the agent thesis: be readable and quotable by any model or
crawler, with no authentication and nothing to get wrong. Actions come later.

## Why this first

The naming decision already bet on this. `SellWant` was chosen over
`SplitStub` partly because nothing in it says "ticket", leaving room for a
marketplace where agents transact. This is the cheapest possible down payment
on that: no auth, no money, no new failure modes, and it improves ordinary
search visibility on the way past.

It also forces the JSON shape a read API would expose, so none of it is thrown
away when layer two arrives.

## What agents see today

Measured against production, not assumed:

    body text on a listing page   9 characters — "Listing"
    JSON-LD blocks                0
    llms.txt                      404
    sitemap.xml                   404
    robots.txt                    present, but every line is a comment

The app renders client-side, so a crawler receives an empty shell. The `og:`
work made link previews rich, but a model reading `/event/<id>` learns one
word.

There is also an **accidental public API**: the anon key ships in the bundle,
so anyone can already query Supabase's REST endpoint directly for active
listings. It works, and it is undocumented, unversioned, unrate-limited, and
welds the public contract to Supabase's URL shape. Part of this work is
replacing it with a surface we actually own.

## Capabilities this delivers

| | Today | After |
| --- | --- | --- |
| A model asked "what tickets are for sale at X?" | nothing to read | reads the listing, price, date, venue |
| Google rich results | ineligible | Event + Offer markup |
| An agent enumerating the market | must guess Supabase's schema | one documented sitemap + feed |
| "Is this site OK to ground on?" | unanswered | stated in robots.txt and llms.txt |
| A developer pointing an agent at us | no entry point | `/llms.txt` explains the whole model |

## The work

### 1. Real content in the body

The single highest-value change. The Worker already intercepts `/event/<id>`
and already fetches the listing for previews, so it injects a small semantic
block into `<body>`: heading, price, type, date, venue, description.

This is not SEO decoration — it is the page's actual content, rendered server
side for clients that do not run JavaScript. The app hydrates over it.

Must match what the app displays. Server text that disagrees with the rendered
page is cloaking, and is treated as such.

### 2. JSON-LD, using both halves of the vocabulary

`schema.org` models the duality directly, which is a happy accident:

- **sell listing** → `Event` with `offers: Offer` — someone is offering a
  ticket at a price.
- **want listing** → `Event` with `Demand` — schema.org's own type for "the
  announcement by a person to seek a certain type of goods". Same properties
  as `Offer`, opposite direction.

Emitting the correct one is what lets a model distinguish supply from demand
without parsing prose. Nearly every marketplace flattens both into `Offer`;
being precise here is cheap and is exactly the distinction the product is
built on.

Includes price, `priceCurrency`, availability, `validThrough` (the event date
— a ticket to a past party is not an offer), location, and canonical URL.

### 3. Change the injection from crawler-gated to cached-for-everyone

Currently the preview tags are only injected for known crawler user agents,
which keeps the Supabase round-trip off the path real people take.

That should change, for two reasons. Serving different metadata to crawlers
than to browsers is the definition of cloaking, and it will eventually be
judged that way. And the crawler list is a guess that silently fails for any
agent not on it — which, for a plan whose entire purpose is being readable by
unknown agents, is the wrong default.

Instead: inject for every request and cache the assembled HTML at the edge,
keyed by listing id, for ~60 seconds. One Supabase read per listing per
location per minute, and everyone gets identical markup.

Prices change, so the TTL stays short and a settled deal must evict.

### 4. `/llms.txt`

Per the convention: an H1, a blockquote summary, then H2 link sections. Small
enough to sit in a context window, with detail behind the links.

It should explain the things a model cannot infer from a listing page:

- there are two listing types, and `want` is not a typo for a product page
- money never moves through the platform, so "buy" means "agree to meet"
- the handoff is physical, so an agent can negotiate but cannot complete
- where the feed and per-listing data live

That last point is the one that matters commercially. A model that understands
the model can represent someone in it.

### 5. `/sitemap.xml`, generated

Static routes plus every active listing, built by the Worker from the same
query, cached. Sold and cancelled listings are excluded — the same rule the
public feed follows, so trade history stays private.

### 6. `robots.txt` with actual directives

Today it is Cloudflare's explainer boilerplate with no rules. It needs:

- `Allow: /` and a `Sitemap:` line
- `Disallow: /deal/`, `/u/`, `/offers`, `/deals`, `/my-listings`, `/profile`
  — private surfaces that should never be indexed even though they redirect
- content signals: `search=yes` and `ai-input=yes` are the point of this
  exercise. **`ai-train` is a business decision, not a technical one** —
  allowing models to train on the corpus is a different question from allowing
  them to read it live, and it should be answered deliberately.

## What this does not do

- **No writes, no auth, no money.** Nothing here lets an agent act.
- **It cannot complete a trade.** The handoff is two people at a door. An
  agent can find, compare and negotiate; someone still has to turn up.
- **It does not create demand.** An empty marketplace with excellent metadata
  convinces nobody. This is worth doing when there are listings worth finding.

## Risks

**Cloaking.** Mitigated by serving identical markup to everyone (item 3) and
by keeping injected text identical to what the app renders (item 1).

**Publishing more than intended.** Everything here is already public to a
logged-out visitor, and the same active-only rule applies. The failure mode to
guard is a future field being added to the listing query without asking
whether it should be in a sitemap.

**Cache staleness.** A price that changed a minute ago is fine. A sold listing
still advertised as available is not — settlement must evict.

## Order

1. robots.txt, llms.txt — static, no dependencies, done in an hour
2. JSON-LD + body content + move to cached-for-everyone — one change, one test pass
3. sitemap.xml — needs the cached query from 2

Then layer two, if this proves out: a versioned read API, and only after that
an MCP server, where authentication and spending limits become the whole
problem rather than a footnote.
