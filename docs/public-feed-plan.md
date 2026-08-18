# Public feed, gated interaction — plan

Anyone can browse. Acting requires an account.

## Why this is worth doing

Distribution is a link pasted into a group chat. Today that link hits a sign-in
wall, so the twenty-nine people who did not already have an account see a
password box instead of the ticket. A public listing page turns every share
into a shop window, and the sign-up ask arrives *after* someone has decided
they want the thing.

## The finding that shapes everything

Anonymous reads currently return **zero rows on every table** — verified
against the live project with the shipped anon key:

    listings 0 · profiles 0 · offers 0 · contact_details 0
    lock_ins 0 · reports 0 · ticket_codes 0 · categories 0

So the gate is real, not cosmetic, and opening the feed means deliberately
granting the `anon` role read access. That is a security change, and the anon
key is public — **anything `anon` can read, anyone can scrape.** Treat every
grant below as publishing that data on the open web, because that is what it
is.

## What becomes public

| | Anonymous | Signed in |
| --- | --- | --- |
| Feed, search, categories | yes | yes |
| Listing detail | yes | yes |
| Price, date, place, title | yes | yes |
| Top offer / lowest ask *number* | yes | yes |
| Who posted it | no | yes |
| Who made an offer | no | yes |
| Phone, payment handles | no | counterparty only |
| Profiles `/u/[id]` | no | yes |
| Offering, countering, buying | no | yes |
| Deals, offers inbox, your listings | no | yes |

The going-rate number stays public on purpose: it is the single most
persuasive thing on the page and it carries no personal data. Names do not.

## How identity stays hidden without a second code path

`profiles` simply stays closed to `anon`. The feed already asks for the poster
as an embedded join:

    listings?select=*,poster:profiles(...)

When the embedded table is unreadable, PostgREST returns `poster: null`, which
every card already handles — it renders "Someone". No parallel query, no view,
no column-level grants. **To verify during implementation:** confirm PostgREST
returns null rather than erroring or dropping the row.

Same trick for offers: the amount is on `offers`, the name comes from an embed,
so anonymous sees "$10" attributed to nobody.

## Work

### 1. Database — the security boundary

Grant `anon` SELECT on exactly three tables:

- `listings` — only `status = 'active'`. Cancelled and sold rows stay private;
  a sold listing's price is nobody's business and leaks trade history.
- `categories` — static reference data.
- `offers` — only rows whose listing is active. Amounts only in practice, since
  the poster embed is closed.

Everything else stays shut: `profiles`, `contact_details`, `lock_ins`,
`reports`, `ticket_codes`.

Requires the Supabase MCP (currently disconnected) or the SQL editor.

### 2. Client — let the shell render logged out

- `feed.tsx`, `event/[id].tsx`: drop the redirect, render for `session === null`.
- Skip the onboarding redirect when there is no session.
- `BottomNav`: anonymous sees Browse plus a **Sign in** action, not Deals /
  Offers / You — tabs that would only ever redirect.
- Keep the redirect on `/deals`, `/offers`, `/my-listings`, `/profile`,
  `/deal/[id]`, `/u/[id]`, `/create-event`.

### 3. The conversion moment

Anonymous taps **Buy now**, **Make an offer** or **Counter** -> sign-in, then
back to the listing they came from.

That return trip matters: bouncing someone to an empty feed after they sign in
loses the thing they wanted. Needs a `returnTo` param on `/` carried through
`/auth/callback`, and it must only accept internal paths — an open redirect
that bounces to an arbitrary URL after login is a real phishing vector.

Prefer disabled controls with "Sign in to offer" over hiding them. A visible
locked action tells people what the site is for; a hidden one tells them
nothing.

### 4. Copy

The sign-in screen currently assumes you arrived deliberately. Someone landing
from a group chat needs one line explaining what SellWant is before being asked
for an email.

## Deliberately out of scope

- **`og:image`.** Public links make preview cards worth much more, but it is a
  separate piece of work.
- **Search-engine indexing.** Public listings become crawlable. Probably good,
  but it means real names would be indexed if identity were ever exposed — one
  more reason to keep `profiles` shut.
- **Rate limiting.** Anyone can now page through every active listing via the
  anon key. Acceptable for a proof of concept; not forever.

## Risks

**Anything granted is scrapeable.** Not a bug to fix later — the reason the
grants are three tables and not "public read".

**Hiding names costs trust.** "DeShawn Kelly · 3 handoffs" is reassuring;
"Someone" is not. The bet is that curiosity converts. If browse-to-signup is
weak, the first thing to try is showing reputation without identity —
"Seller · 3 handoffs" — which needs a view, since it is column-level.

**Sold listings must stay private.** The easiest mistake here is granting
`anon` all of `listings` and quietly publishing everyone's completed trades.
