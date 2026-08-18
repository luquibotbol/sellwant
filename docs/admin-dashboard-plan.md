# Admin dashboard — plan

One page, for the two founders, answering "is this working?" and "is anyone
misbehaving?"

## Why

Right now there is no way to see how SellWant is doing without opening the
Supabase table editor and writing SQL. That is fine for one person who wrote
the schema and useless for a cofounder.

It also closes a real gap. Reports are captured correctly and kept private by
RLS, but **nothing can read them and `is_suspended` has no path to being set**.
The schema already has `reviewed_at` and `outcome` on `reports`, so the
moderation workflow was anticipated and never built. This is where it lands.

## Security model

This is the part worth getting right, because it is the first surface that
deliberately shows one person data about everyone else.

**Admin is a separate table, not a column on `profiles`.** The profiles table
is readable by every signed-in user, so an `is_admin` column there would
publish the list of admins to anyone who looked. A dedicated `admins` table,
readable only by admins, does not.

**The boundary is a SECURITY DEFINER function, not the client.** The dashboard
calls one RPC that checks `auth.uid()` is an admin and then computes
aggregates. A non-admin calling it directly gets an error, not data. The
client never queries the underlying tables, so there is no way to widen access
by editing the page.

**Aggregates, not exports.** The stats view returns counts and rates, never
lists of users with their contact details. There is no reason for a founder
dashboard to hand back a spreadsheet of everyone's phone numbers, and if it
never returns them a bug cannot leak them.

**A non-admin sees "not found", not "forbidden".** Confirming the route exists
tells someone there is something worth attacking.

**`/admin` is disallowed in robots.txt** and excluded from the sitemap.

## What it shows

### Growth
- Signups: total, last 7 days, last 24 hours
- How many completed onboarding, and how many of those posted anything
- Sign-in method split, now that Google exists

### The funnel
The number that matters is where people stop:

    signed up -> onboarded -> posted or offered -> agreed a deal -> confirmed

Each step as a count and as a percentage of the one before. A cliff between
two steps is the thing to fix next, and it is invisible in a table editor.

### Market
- Listings: active, locked, sold, cancelled; split sell vs want
- Offers: total, open, accepted, declined
- Deals: in progress, confirmed, cancelled -- and cancellation rate
- Value of confirmed deals. Money never moves through SellWant, so this is not
  revenue; it is the size of the market being cleared, which is the number an
  investor will ask for.
- Median days from listing to deal, when there is enough data to mean anything

### Trust and safety
- Open reports, with the ability to mark one reviewed and record an outcome
- Suspend or unsuspend an account
- Duplicate ticket-code attempts from `code_collisions`, which is the closest
  thing to a fraud signal the product has

## Build

1. `admins` table plus RLS so only admins can read it. Seeded with the two
   founder accounts by email.
2. `admin_stats()` -- SECURITY DEFINER, admin-checked, returns one JSON object.
   One round trip, so the page cannot half-load.
3. `admin_reports()`, `admin_review_report()`, `admin_set_suspended()` -- same
   check, the moderation actions.
4. `/admin` screen: stat cards, funnel, report queue.
5. robots.txt disallow.
6. Tests: a non-admin must get nothing from every one of those functions. That
   is the assertion that matters, and it goes in the live-database suite next
   to the `advance_deal` authorization tests.

## What this is not

- **Not analytics.** No event tracking, no sessions, no retention cohorts. It
  reads the tables that already exist. If real product analytics is wanted
  later that is a different tool.
- **Not real-time.** It loads when you open it.
- **Not a support console.** No impersonation, no editing someone's listing,
  no reading private contact details.
