# SellWant

**Buy what you want. Sell what you have.**
Live at **https://sellwant.com** · written 2026-10-24, with every number in it
measured that day against production.

---

## 1. What it is

A free two-sided marketplace for event tickets — student parties, formals,
concerts. Two things make it different from every other ticket site:

**Both sides post.** Most marketplaces only let sellers list. Here a listing is
either:

| Type | Meaning | Marked up as |
|---|---|---|
| `sell` | "I have a ticket, here's my price" | `schema.org/Offer` |
| `ask` (shown as *want*) | "I need a ticket, here's what I'll pay" | `schema.org/Demand` |

A *want* is not an out-of-stock product page. It is a standing request, and
answering it means offering to sell.

**Offers are public.** Every offer and counter-offer on a listing is visible, so
the going rate is known before anyone commits. The headline figure on a listing
is the **going rate**: the highest offer on a `sell`, the lowest on an `ask`. A
counter from the person who posted the listing is displayed but excluded from
that figure — it is their own asking price, not evidence of demand.

**It is free, and it is free because we never touch the money.** The two people
agree a price and pay each other directly, usually Venmo or Zelle. There is no
listing fee, seller fee, buyer fee or processing cut, because there is nothing to
take a cut of.

### The settled product constraints

These are decisions, not preferences. They are not up for relitigation in a PR,
and the code and the copy both depend on them:

1. **No Stripe, no in-app checkout, no escrow.** Money moves between the two
   people, off-platform.
2. **We never hold the ticket, and never imply we do.** We store only
   `sha256(normalised QR payload)` — enough to catch the same code listed twice,
   never enough to redeem. Copy that suggests a ticket is "safely held" is wrong.
3. **The handoff is physical.** Most of these tickets are static QRs that cannot
   be transferred, so the seller keeps a working copy and the two people scan in
   together. There is no digital delivery.
4. **Deal states record what someone *said*, never what we verified.** The copy
   says "marked as paid", never "paid" as a fact.
5. **Reports stay private and free-text.** No public callouts, no ratings UI. A
   public accusation against a named private individual is defamation per se, and
   a structured category list would forfeit Section 230 protection.
6. **No `.edu` requirement.** Anyone can post or buy.
7. **Don't scrape or probe Bubbl, Posh or any third-party platform.**
8. **Nothing is pushed to `main` without Lucas asking.** `main` auto-deploys.

---

## 2. The flow, end to end

```
post a listing ──► offers come in (public) ──► poster accepts one
                                                     │
                                                     ▼
                                           a lock_in ("deal") is created
                                           the listing flips to `locked`
                                                     │
            ┌────────────────────────────────────────┴───────────────┐
            │  pending_payment → buyer pays off-platform, marks paid │
            │  paid            → buyer confirms they got the ticket  │
            │  confirmed       → done, completed_deals++ on both     │
            │  cancelled       → listing goes back on sale           │
            └────────────────────────────────────────────────────────┘
```

The whole state machine lives as a **table**, not nested conditionals, in
[lib/handoff.ts](../sellwant/lib/handoff.ts) — four states × two roles = eight
cells, all visible at once and testable without rendering anything. State is
advanced **only** through the `advance_deal()` RPC; `lock_ins` has deliberately
no `UPDATE` policy, so no client can skip a step or act in the other side's role.

`code_released` exists in the database check constraint and is dead: we decided
SellWant never holds the ticket, so there is nothing to release.

Contact details (phone, Instagram, payment handles) become visible to each other
**only** once a deal exists between the two people.

---

## 3. Architecture

```
                   ┌─────────────────────────────────────────┐
  browser ────────►│  Cloudflare Worker (sellwant.com)       │
                   │  • serves the static Expo web export    │
                   │  • rewrites /event/<id> → [id].html     │
                   │  • injects per-listing OG + JSON-LD     │
                   │  • injects the live feed into / and     │
                   │    /feed for crawlers, edge-cached 60s  │
                   │  • /sitemap.xml, /api/listings.json     │
                   │  • /api/view  (impression beacon)       │
                   │  • www → apex 301                       │
                   └───────────┬─────────────────────────────┘
                               │ anon key, REST
                               ▼
                   ┌─────────────────────────────────────────┐
                   │  Supabase (Postgres)                    │
                   │  RLS on every table                     │
                   │  SECURITY DEFINER RPCs for every write  │
                   │  that has a rule attached to it         │
                   │  Storage: listing-photos, avatars       │
                   │  Auth: password + Google, custom SMTP   │
                   └─────────────────────────────────────────┘
```

### Stack

| Layer | Choice |
|---|---|
| App | Expo SDK 52, React Native 0.76.7, expo-router 4, React 18.3 |
| Web | `web.output: "static"` → `expo export -p web`, rendered through react-native-web |
| Hosting | Cloudflare Workers + static assets, `run_worker_first: true`, `not_found_handling: "none"` |
| Data | Supabase — Postgres, RLS, RPCs, triggers, `pg_trgm` |
| Fonts | Geist, imported **per weight** (`@expo-google-fonts/geist/Geist_400Regular`) |
| State | `zustand` where needed; mostly local state + a thin service layer |
| Runtime/test | Bun 1.3.14 |
| CI/CD | GitHub Actions — checks on PR, deploy on push to `main` |

One codebase, three targets in principle (web/iOS/Android). **Only web is
shipped.** The native build compiles but has never been run on a device.

### Why a Worker and not just static hosting

Two things a static host cannot do:

1. `expo export` emits dynamic routes as files with literal brackets —
   `dist/event/[id].html`. No browser asks for that; they ask for
   `/event/9f2c`. Without a rewrite every listing, deal, profile and edit link
   404s — and those are exactly the URLs people paste into a group chat.
2. That one file is shared by every listing, so its `<meta>` tags can only
   describe the site in general. A preview that says "SellWant" instead of
   "ñuna — $14, Sunday at luna night club" wastes the share. The Worker rewrites
   the listing's own tags into the shared template, for everyone, crawler or not
   (serving crawlers different markup is what cloaking means).

The Worker runs **first** on every request, fetches the asset itself, and only
falls through to the rewrite on a miss — so the common path costs nothing. The
rewrite is capped at exactly two path segments, so a URL we never generated 404s
instead of rendering an empty screen.

### Deploy pipeline

`push to main` → typecheck → `bun run test` → `expo export -p web` →
**verify the bundle actually carries its Supabase config** → `wrangler deploy` →
**smoke test five live URLs** (`/`, `/feed`, `/offers`, `/deal/smoke-test`,
`/u/smoke-test`) and fail the run on anything but a 200.

Both guards exist because of real failures: `EXPO_PUBLIC_*` vars are inlined at
build time, so a missing secret ships an app that cannot reach Supabase **with no
build error**; and `/edit/<id>` once 404'd in production only, because the
Worker's rewrite map did not know the route existed.

One deploy at a time (`concurrency: deploy-main`, `cancel-in-progress: false`) —
two racing runs could publish an older build over a newer one.

---

## 4. Data model

28 users, 11 listings, 12 offers, 5 deals, 613 page views as of today. Small
numbers; the shapes are what matter.

| Table | Rows | What it holds |
|---|---|---|
| `profiles` | 28 | Public identity: name, picture, Instagram, `completed_deals`, `is_suspended`, `onboarded_at`. FK to `auth.users`. |
| `contact_details` | 28 | Phone, email, `accepted_payments` (jsonb). Visible only to a counterparty in a deal. |
| `listings` | 11 | `type` (`ask`/`sell`), title, description, `price_cents`, `location` (a city from a fixed list), `event_date` (nullable — "no date" is a real state), `image_urls[]`, `status`, `best_offer_cents`, `offer_count`. |
| `offers` | 12 | `amount_cents`, `message`, `status`, `parent_offer_id` for counters. |
| `lock_ins` | 5 | Deals. `locked_price_cents`, `state`, who cancelled and from where, `paid_at`, `confirmed_at`. |
| `ticket_codes` | 0 | `sha256(normalised payload)` + `is_live`. One per listing, unique. |
| `code_collisions` | 1 | Audit trail of a QR offered twice, and whether it was the same seller. |
| `reports` | 0 | Private free-text reports, min 10 chars, with `reviewed_at`/`outcome`. |
| `page_views` | 613 | path, optional `listing_id`, per-tab `visit_id`, `day`. |
| `admins` | 3 | Who can see `/admin`. |
| `categories` | 5 | Preset categories. |

### Everything with a rule attached goes through an RPC

RLS decides who can *see* rows. Anything with a **rule** — a sequence, a role, a
derived counter — is a `SECURITY DEFINER` function, because a policy can only say
yes or no to a whole statement:

`accept_offer` · `advance_deal` · `cancel_listing` · `register_ticket_code` ·
`record_view` · `refresh_offer_stats` · `admin_stats` · `admin_view_stats` ·
`admin_reports` · `admin_review_report` · `admin_set_suspended` ·
`purge_test_listing` · `is_admin` · `is_suspended` · `shares_lock_in` ·
`offer_parent_ok`

Triggers hold the invariants: `offers_touch_stats` (recompute the going rate),
`offers_freeze_amount` (an offer's amount is immutable once made),
`offers_supersede_previous`, `lock_in_locks_listing`, `deal_settled`
(bump `completed_deals`), `sync_ticket_code_liveness`, `handle_new_user`.

### Security boundaries that are actually enforced

- A client may write **only** the columns it has business writing. Sellers once
  could forge `best_offer_cents` and `status` on their own listings — i.e. invent
  demand. Fixed by column-level grants plus the stats trigger.
- A seller cannot rewrite someone else's offer amount; an offer's amount is
  frozen by trigger.
- No bare self-offers on your own listing (`offer_parent_ok`).
- `image_urls` is capped at 3 and **every entry must live in our own storage
  bucket** — otherwise it is an arbitrary-URL field that renders wherever a
  listing renders, which is a tracking pixel at best. Enforced by a CHECK calling
  an `IMMUTABLE` function, because a CHECK may not contain a subquery.
- `lock_ins` has no `UPDATE` policy at all.
- `page_views` is insert-only for `anon` **through the RPC only**; reading it
  requires `is_admin()`.
- `/admin` is enforced in the database, not in the client. The route is just a
  screen; `admin_*` RPCs return `null` to a non-admin.

**The rule that makes this repo dangerous:** *RLS filters, it does not throw.* A
blocked write returns `200` with an empty array. A `DELETE` nothing is allowed to
delete looks exactly like a successful one. Every boundary here is proven by
signing in as a fixture account over plain HTTP and asserting the failure — never
by reading the policy.

---

## 5. Page impressions

Added 2026-08-20. The entire client side is **one module, 126 bytes per view and
26 bytes of bundle**:

- `navigator.sendBeacon` to `/api/view` — background priority, outside the page's
  own network budget, survives the page closing. Nothing is awaited; nothing can
  delay a render.
- A `visit_id` that is `Math.random()`, held in memory for one tab, regenerated
  on every reload. **No cookie, no fingerprint, no stored id, no IP.** The Worker
  sees the IP as every server does and does not keep it.
- 300 ms debounce, so a redirect on arrival counts the destination rather than
  both ends of it.

The Worker drops non-humans before writing anything — generic crawlers, AI
agents, and crucially the **link previewers** (`facebookexternalhit`, WhatsApp,
Telegram, Discord, Slack, Twitter, LinkedIn). On a product that spreads by being
pasted into group chats those are plausibly the most common non-human request
there is, and a generic `/bot/` test passes every one of them through. An empty
user-agent counts as not-a-person too — a browser always sends one.

`UNIQUE (visit_id, path, day)` is the load-bearing part: a row is *one tab seeing
one path on one day*, which is both the number that answers "how many people saw
this" and a floor under how much noise one visitor can add by holding down F5.

**These are views, not unique visitors**, and deliberately so: distinguishing
people requires a cookie. "3 views of /feed" may be one person reloading three
times or three different people, and there is no way to tell them apart.

The privacy policy states exactly this, and it has to stay true.

**Live today:** 613 views over 455 distinct tab-visits, 2026-08-21 → 2026-10-23.

---

## 6. The founders' dashboard — `/admin`

Two tabs, both gated in the database.

**Overview** — the funnel in absolute counts (not percentages: Lucas asked for
"number of people that got there"), signups over time as a line chart with
day/week/month buckets and per-point hover, outcome mixes, plus the original
stats block and the moderation queue (read a report, set an outcome, suspend an
account).

**Impressions** — daily views split feed vs listings, the feed/listings
composition, the ten most-viewed listings, and "últimas vistas" grouped by path
with the count in front over the last 200 views.

Charts are hand-rolled Views (no chart library — it would cost the whole
marketplace's bundle to draw four shapes). The four-colour series palette was
validated for deuteranopia and protanopia ΔE before being used.

Traffic data is aggregated **in Postgres**, not pulled to the client: unlike
signups, `page_views` grows with traffic rather than with users, and it is the one
query on that screen whose row count is not naturally small. The impressions tab
only fetches while it is open.

---

## 7. Design system

Ported tokens, not an installed package: shadcn/ui's dark `zinc` scale plus
Vercel's visual language, as values in
[constants/theme.ts](../sellwant/constants/theme.ts) — shadcn itself cannot run
here, since it is Radix + Tailwind + DOM and this renders through
react-native-web.

- Near-black background `#09090B`, cards `#0C0C0E` — surfaces separated by
  **hairlines**, not fills or shadows.
- **Market semantics follow trading convention**: sell is red `#EF4444`, want
  is green `#4ADE80`, used only as small marks — badges, prices, thin borders —
  never large fills. That restraint is the aesthetic.
- Destructive shares the sell hue, so every error state must carry an icon and
  text — never colour alone.
- Primary action is white-on-black, not a colour.
- 4px space scale, shadcn's radius steps, Geist at four weights, a small tight
  type scale with negative tracking at display sizes.

No screen defines its own colour.

---

## 8. Performance

Speed is treated as a **requirement**, not a nice-to-have — fast for everyone,
always, with the cost budgeted while designing rather than measured afterwards.

Measured today against production:

| | |
|---|---|
| Entry bundle | **1.39 MB raw**, 293 KB at max-quality brotli, **359 KB as the edge actually serves it** |
| HTML shell | **8.6–8.9 KB brotli** (30 KB raw) |
| Lazy chunk | jsQR, 127 KB — fetched only when someone picks an image |
| TTFB `/feed` | 0.24 s (edge `HIT`) |
| TTFB `/`, `/deals`, `/offers`, `/admin` | 0.41–0.48 s |
| `/api/listings.json` | 2.5 KB for the whole active market |
| Static assets | `immutable`, 1 year, content-hashed by Metro |

The bundle is the number to watch: one file every visitor downloads on a phone,
and it grows silently — a dependency added for one screen ships to everyone.

Two mechanisms are in use and worth reaching for again:

- **`await import('x')` inside the function that needs it.** Metro emits a
  separate chunk. This is how jsQR (250 KB) left the entry bundle. It needed
  `"module": "esnext"` + `"moduleResolution": "bundler"` in `tsconfig.json` —
  Expo's base config leaves `module` unset, which means commonjs, which rejects
  `import()`.
- **A `.web.tsx` stub that renders `null`.** Metro resolves it on web and the
  native module never enters the graph. That is how `expo-camera` (52 KB) left;
  `DateField.web.tsx` is the older example.

Together those cut 31 KB brotli off what every visitor downloads.

The cautionary tale: importing the Geist package root cost **1.66 MB** to use
four weights. And guessing which dependency is heavy does not work — the answer
here was jsQR, which nobody would have picked. Measure with
`expo export -p web --source-maps` and read the map's `sourcesContent`.

**Known, not done:** `@supabase/realtime-js` + phoenix are ~153 KB of bundle for
a feature we do not use (there are no realtime subscriptions anywhere). Removing
them means hand-assembling the client from `auth-js` + `postgrest-js` +
`storage-js`. It is the next big win and was deliberately left out of the perf PR.

---

## 9. Legibility to crawlers and agents

The distribution model is links pasted into group chats and, increasingly,
questions asked of models. So:

- Every listing page carries its own OG/Twitter tags and `Event` JSON-LD with
  either `Offer` or `Demand`.
- `/` and `/feed` get the live market injected into their prerendered body
  (they render client-side otherwise, so their crawlable body was one character).
- `/sitemap.xml` and `/api/listings.json` are generated from the same query, so
  they can never describe different markets.
- [`/llms.txt`](../sellwant/public/llms.txt) explains the model in prose,
  including what an agent **cannot** do: there is no write API and no MCP server,
  so an agent can find, compare and draft an offer, but someone has to turn up at
  a door. Any flow ending in "purchased" is wrong.
- `robots.txt` carries deliberately different answers to three questions:
  `search=yes, ai-input=yes, ai-train=no` — listings are other people's plans and
  prices, posted to trade this weekend; grounding a live answer on them helps
  everyone, keeping them permanently in a model helps nobody here and is not ours
  to grant on their behalf.
- Only **active** listings are exposed anywhere. A completed trade's price
  belongs to the two people who made it.
- Private surfaces (`/deal/`, `/u/`, `/offers`, `/admin`, …) are `Disallow`ed as
  well as session-gated.

---

## 10. Testing

81 unit tests in `sellwant/tests/` (`bun test`) plus three script-based suites
for QR normalisation and decoding:

| File | Cases | What it pins |
|---|---|---|
| `advance-deal.test.ts` | 23 | The deal state machine against the live database |
| `handoff.test.ts` | 19 | All eight role × state cells |
| `structured-data.test.ts` | 9 | JSON-LD and OG output |
| `clean-router-url.test.ts` | 7 | Stripping `?__EXPO_ROUTER_key=…` from shared URLs |
| `relative-time.test.ts` | 6 | Time formatting |
| `offer-side.test.ts` | 5 | Which side an offer is on |
| `bot-filter.test.ts` | 4 | Who counts as a person |
| `canonical-host.test.ts` | 3 | www → apex |
| `return-to.test.ts` | 3 | Post-sign-in redirects |
| `qr-lazy-import.test.ts` | 2 | That jsQR stays out of the entry bundle |

**They hit the real Supabase project.** They create their own listings and delete
them afterwards, and the CI concurrency group stops two runs colliding — but they
are not hermetic. A red run can mean the shared database moved, not that the code
broke. The suite once leaked 18 test listings into the live feed, because its
cleanup `DELETE` was silently filtered by RLS and reported success.

---

## 11. Repo layout

```
docs/                        plans, design system, TODO, this file
.claude/skills/featsw/       the repo's own feature workflow (below)
.github/workflows/deploy.yml checks on PR, deploy on push to main
sellwant/
  app/                       expo-router screens; [id].tsx are dynamic routes
  components/                UI; components/ui/ is the primitive layer
  services/data.ts           the single data seam — every query and mutation
  services/analytics.ts      the 126-byte beacon
  services/qr.ts             hashing + the lazy jsQR import
  lib/                       pure helpers; where unit-testable logic lives
  worker/index.js            everything a crawler or a pasted link sees
  supabase/migrations/       SQL Lucas applies by hand
  tests/                     bun test
  constants/theme.ts         the design tokens
  public/                    robots.txt, llms.txt, _headers, icons, og.png
```

`services/data.ts` is 1,242 lines and deliberately the only place that talks to
Supabase. `worker/index.js` is 708 lines and deliberately the only place that
knows what a crawler sees.

The root `package.json` is **dead weight** — Firebase dependencies from before
the Supabase rewrite. So is the local folder name (`github/sellup`).

### `/featsw` — the repo's own workflow

Eight phases: plan → vet (does this make sense at all?) → build → test and fix →
open the PR → review it properly → merge and verify production → record what was
learned. It carries three reference files that grow over time:

- `repo-map.md` — where things live, the perf baseline, the test fixtures, how to
  prove a permission boundary, and what Claude cannot do here.
- `pitfalls.md` — the repo's invisible failure modes.
- `lessons.md` — 16 recorded lessons, each one a real mistake.

The reason it exists: the failure modes in this repo are mostly **invisible**.
RLS filtering instead of throwing. An index that is never used because it was
built on an expression the query doesn't match. A route that 404s only in
production. Zero-width layout collapse. A column grant PostgREST rejects while
Postgres accepts it. None of these announce themselves.

The hardest-won lesson: **my own verification harnesses lie.** Over one week, DOM
probes reported `object-fit: fill` on an image rendering `contain`, a 0-width
frame on a visible photo, and zero segments on a line that was on screen.
Screenshots were ground truth every single time. On react-native-web: look
first, measure second.

---

## 12. What exists today

Shipped and live, in order:

**Marketplace core** — two-sided listings, public offers and counters, the going
rate, accept → lock-in → handoff, cancellation that returns a listing to sale,
`completed_deals` on both profiles.

**Accounts** — password auth with email verification, Google sign-in, password
reset, onboarding, profiles, payment handles, public profile pages at `/u/<id>`.
Custom SMTP through Cloudflare Email Sending (MX/SPF/DKIM/DMARC on the domain),
which lifted Supabase's built-in 2-emails-per-hour cap.

**Listings** — create, edit, delete (with a take-down fallback when a deal
exists), up to 3 optional photos in a carousel with one uniform frame and the
whole picture visible, a refusal to accept a ticket screenshot as a photo, city
from a fixed list of 380 cities (typeable, pick-from-list), event date or an explicit
"no date" button, QR registration that catches the same code listed twice.

**Browsing** — feed paging at 20 + "Show more", search across every title and
description (trigram-indexed, so it is not loading the market to filter it),
filter by city and by date, filter your own listings by type and your offers by
side, a better deals view with tabs and `Deals (n)` counters in the nav.

**Trust and safety** — private free-text reports, a moderation queue in `/admin`,
account suspension, terms and privacy pages.

**Distribution** — per-listing link previews, JSON-LD, sitemap,
`/api/listings.json`, `llms.txt`, content signals, www → apex, clean shareable
URLs with the expo-router key stripped.

**Instrumentation** — the admin charts, and page impressions end to end.

**Real numbers today:** 28 accounts (2 of them test fixtures), 22 onboarded,
11 listings of which 7 are active (4 sells and 7 asks in all), 12 offers, 5 deals, 0
confirmed handoffs, 613 views across 455 visits since 2026-08-21.

That last pair is the honest headline: **the market is instrumented, legible and
fast, and nobody has completed a handoff on it yet.**

---

## 13. What is not built

Roughly in the order it matters.

1. **Notifications do not exist.** The largest gap by a distance, and unblocked
   now that SMTP works. Nothing tells anyone anything — offer received, offer
   accepted, deal advanced, deal cancelled — unless they reopen the app. On a
   marketplace where the ticket expires when the party starts, silence kills
   deals that would otherwise close. Best sent from Postgres via a trigger
   calling an Edge Function, so delivery does not depend on anyone's app being
   open. Cloudflare includes 3,000 emails/month, then $0.35 per 1,000.
2. **Deals can hang forever.** A buyer who locks a listing and never confirms
   leaves it locked permanently. No timeout, no seller recovery. Accepted
   knowingly, but it is a real denial of service on someone else's listing.
3. **A bug/idea report form** that surfaces in `/admin` — item 4 of Lucas's
   `todo.txt`, the only one of the four not shipped.
4. **Account deletion does not honour the privacy policy.** It still cascades
   through `lock_ins.buyer_id`/`seller_id` and `reports.subject_id`.
5. **No `og:image` on link previews.** Title and description render; there is no
   artwork. The entire distribution model is pasted links.
6. **~153 KB of unused bundle** (`realtime-js` + phoenix) — see §8.
7. **The native app has never run on a device.** The QR camera scanner and the
   file-picker upload path are both written and both unexercised on real
   hardware.
8. **CI is not hermetic** (§10), and the root `package.json` is dead Firebase
   weight.
9. **"Not set" / "No date set" / "No date"** are three phrasings of one state
   across the listing page, the feed card and the form.
10. **One observation worth checking:** `/feed` came back today with
    `cache-control: public, max-age=14400, s-maxage=60`, while the Worker sets
    `max-age=0, s-maxage=60`. If a browser really holds that shell for four
    hours, the injected SEO markup can go stale for a returning visitor. The app
    hydrates and refetches, so people see live data either way — but it is not
    what the code intends.

11. **A seller could write the going rate when creating a listing** (found
    2026-11-04). `best_offer_cents` and `offer_count` were protected on `UPDATE`
    by column grants, but not on `INSERT`, where the table-level grant wins.
    Confirmed against production, then deleted. Fixed in
    `20261104_listings_insert_no_forged_stats.sql`, **pending: Lucas applies it
    by hand.** `status` and `created_at` are writable on insert by the same
    mechanism; they cannot manufacture demand, but are worth tightening.

---

## 14. Operating notes

Things only Lucas can do, and why:

- **Apply migrations.** DDL is blocked for Claude in auto mode. Migrations are
  written to `sellwant/supabase/migrations/` and handed over as SQL. There is a
  live trap here: a change that depends on an unapplied migration may be *worse*
  than the code it replaced in the window before it is applied.
- **Write to `auth.users`**, including confirming an email. Dashboard only. Test
  fixtures use `@example.edu`, which is IANA-reserved and cannot receive mail, so
  a recreated fixture always needs **Auto Confirm** ticked.
- **Cloudflare DNS.** The OAuth token lacks DNS scope, so `wrangler` reports a
  custom domain attached and silently creates no record. Verify after a deploy.

Fixture accounts: `maya@example.edu` (buyer) and `deshawn@example.edu` (seller),
password in `SELLWANT_TEST_PASSWORD` in `sellwant/.env`.

```bash
cd sellwant && npx tsc --noEmit    # typecheck
cd sellwant && bun run test        # full suite — hits production
```
