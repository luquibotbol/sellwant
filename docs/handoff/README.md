# Handoff: the database, and what is *not* here

This folder lets you stand up your own copy of SellWant's database and check
that it enforces the same rules as production. It deliberately does **not** give
you access to production, and you should not ask for it: everything you need to
build against is reproducible here, and a shared database is how a prototype
ends up deleting someone's listing.

| File | What it is |
|---|---|
| [`schema.sql`](schema.sql) | The whole schema: tables, constraints, indexes, 25 functions (`accept_offer`, `advance_deal` among them), 7 triggers, every RLS policy, the grants, both storage buckets. One transaction. |
| [`seed.sql`](seed.sql) | Fake data: two accounts, four listings, three offers, a deal mid-handoff, 21 days of traffic. No real person. |
| [`verify.sql`](verify.sql) | 25 self-checking cases. Signs in as each role and tries things that must fail and things that must work. Exits non-zero on any disagreement. |
| [`stub-supabase.sql`](stub-supabase.sql) | Stand-in for Supabase's own `auth`/`storage`/roles, **only** for running on plain Postgres. Never run it on Supabase. |
| [`../../sellwant/supabase/migrations/20261104_listings_insert_no_forged_stats.sql`](../../sellwant/supabase/migrations/20261104_listings_insert_no_forged_stats.sql) | A security fix **not yet applied to production**. Apply it on top of `schema.sql`. |

## 1. Get an isolated database

Pick one. They are ordered by how much of the real thing you get.

**A. `supabase start` (local, needs Docker).** Closest to production: real
GoTrue, real PostgREST, so the app and `bun run test` can talk to it. Free,
unlimited, and nothing you do can touch anyone else.

**B. A second hosted Supabase project of your own.** Create it under *your*
account. Don't ask for a seat in Lucas's org to do this.
Branching (Supabase's built-in dev copies) is a paid-plan feature, and the
SellWant org is on the free plan, so it is not an option. As of Supabase's
published terms a free account may hold two active projects and pauses one after
about a week idle; check your dashboard rather than trusting that line.

**C. Plain Postgres 14+ with `stub-supabase.sql`.** No Docker, no Supabase. You
get the schema, the seed and `verify.sql`, which is enough to work on the
database rules, but there is no auth server or REST API, so the app cannot run
against it.

## 2. Load it, in this order

```bash
export DB_URL="postgresql://postgres:…@…/postgres"   # yours, never production's

# Option C only. Skip on A and B: Supabase already has all of this.
psql "$DB_URL" -v ON_ERROR_STOP=1 -f docs/handoff/stub-supabase.sql

psql "$DB_URL" -v ON_ERROR_STOP=1 -f docs/handoff/schema.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f sellwant/supabase/migrations/20261104_listings_insert_no_forged_stats.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f docs/handoff/seed.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f docs/handoff/verify.sql      # want: passed 25, failed 0
```

On a hosted project you can paste each file into the SQL editor instead. The
editor runs a file as a single transaction, which `schema.sql` is written for:
if the last statement fails, **nothing** is applied, and it will look as though
you ran nothing. That is also how to read an error: look at the last statement
first.

Seed accounts, both with password `devpass123`:
`maya@example.edu` (buyer, and an admin, so `/admin` renders) and
`deshawn@example.edu` (seller).

## 3. Point the app at it

In `sellwant/.env` (gitignored; start from `.env.example`):

```bash
EXPO_PUBLIC_SUPABASE_URL=<your project>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your anon key>
SELLWANT_TEST_PASSWORD=devpass123
```

**Never put production's URL there.** `bun run test` runs against whatever that
file names, creates real listings, and cleans up after itself. Against a dev
database that is a hermetic suite. Against production it leaks test rows into
the live feed, which has happened. Production's URL and anon key are public (they
ship in the JS bundle and sit in `wrangler.jsonc`), so nothing stops you pasting
them in by accident. Check the file.

And never use a `service_role` key anywhere near an `EXPO_PUBLIC_` variable: it
bypasses RLS entirely and would be readable by every visitor.

## 4. What this is, and what it isn't

**Reconstructed, not dumped.** `schema.sql` was written by reading production's
catalogs (`pg_proc`, `pg_policies`, `pg_trigger`, `pg_constraint`, …). Only six
migrations exist in the repo; the rest of the schema was built in the Supabase
dashboard, so there was no source of truth to copy. If you want the canonical
text, this produces it:

```bash
npx supabase db dump --db-url "$PROD_DB_URL" -f schema.sql   # needs the DB password: ask Lucas
```

**What was actually checked, and how.** Loaded into a scratch Postgres 14.19 it
produces the same object counts as production: 11 tables, 25 functions, 7
triggers, 32 policies (24 public + 8 storage), RLS on all 11 tables. Before the
fix, the export reproduced a real hole present in production (see below);
after it, the hole closed; `verify.sql` goes 25/25, and goes red when the
migration is left out or a policy is deliberately opened. So the file demonstrably
behaves like production on the rules that matter.

**What was not checked.**
- It has not been run on a real Supabase (local or hosted), only on plain
  Postgres with the stub. `create extension pg_trgm` lands in `public` there
  because that is what production has; if your Supabase puts extensions
  elsewhere, the three `gin_trgm_ops` indexes will complain.
- `seed.sql` inserts into `auth.users` directly, which GoTrue tolerates but does
  not promise. If it errors, create the two users in the dashboard
  (Authentication → Add user, tick *Auto Confirm*) and swap their UUIDs into the
  file. `example.edu` is a reserved domain that can never receive mail, so
  confirmation emails will never arrive: Auto Confirm is mandatory.
- The suite (`bun run test`) has not been run against a seeded dev database.
  It resolves user ids from the JWT and creates its own listings, so it should
  work, but "should" is the honest word.
- Table-level grants are the effective ones, not a transcript. Production still
  carries Supabase's default `grant all` leftovers that RLS neutralises. The
  behaviour is verified; the text is tidier than the original.

**Not in the export at all:** data, Auth settings (Google sign-in, SMTP,
redirect URLs), Storage objects, Realtime, Edge Functions (there are none), and
the Cloudflare Worker's configuration beyond `wrangler.jsonc`.

## 5. The one open security item

Found while writing this export, on 2026-11-04: a signed-in seller could insert
a listing carrying `best_offer_cents` and `offer_count` of their choosing. The
column grants that stop this on `UPDATE` don't apply on `INSERT`, because the
table keeps a table-level `INSERT` grant. Confirmed against production with a
fixture account; the row was deleted immediately.

The fix is a one-clause change to a policy, in
`20261104_listings_insert_no_forged_stats.sql`. **It has not been applied to
production**: DDL can't be run from the tooling this was built with, so Lucas
applies it by hand. Until then `verify.sql` against production-shaped data fails
cases 2 and 3 — which is correct, and is the check working.

## 6. The MCP prototype

**There is nothing to hand over.** No `sellwant-mcp` repository exists (checked
every repo on the account) and no branch of this one mentions it.
`sellwant/public/llms.txt` already says so in public: *"There is no MCP server
yet. One is intended."*

What does exist to build on:

- `GET /api/listings.json` and `/sitemap.xml`: public, read-only, active
  listings only (id, url, type, price, going rate, offer count, date, location).
  About 2.5 KB for the whole market.
- Everything else goes through Supabase with a user's JWT, under RLS.

Constraints that are decided, not up for design:

- **An agent can find, compare and draft. It cannot complete a trade.** The
  handoff is physical: two people meet and scan in together. Any flow that ends
  in "purchased" is wrong; the honest end state is "a price is agreed and a
  meeting is arranged".
- **Anything that commits money needs that person's explicit approval.** The
  counterparty is a stranger and the payment is irreversible.
- Only **active** listings are exposed anywhere. A settled trade's price belongs
  to the two people who made it.
- Don't scrape or probe Bubbl, Posh or any other third-party platform.

If you add a write tool, it is a user-scoped call through `services/data.ts`'s
RPCs (`accept_offer`, `advance_deal`, …), not a service-role shortcut. The rules
live in Postgres precisely so that no caller, human or agent, can skip them.

## 7. PayPal

**Nothing is configured, and nobody but Lucas can configure it.** A sandbox
needs a PayPal developer account: a REST app plus separate sandbox *business*
(seller) and *personal* (buyer) accounts, created at developer.paypal.com. Those
credentials belong to him, and they must not be committed to this repo or sent
through a `EXPO_PUBLIC_` variable.

What exists today is only a payment *handle*: `paypal` is one of five kinds
(`venmo`, `cashapp`, `zelle`, `paypal`, `other`) a person can list, and
`lib/payments.ts` turns it into a `paypal.me/<handle>/<amount>` link that opens
on their phone. No API, no webhook, no keys.

A caution that is a product decision, not a technicality: **SellWant's position
is that money never touches the platform.** No in-app checkout, no escrow, no
holding. A PayPal sandbox flow that creates orders, captures, or pays out from a
server is the opposite of that. If the prototype is meant to test an agent
*arranging* a payment, it should stay a deep link plus a reference. If it is
meant to test the platform moving money, that is a decision to take with Lucas
first, not to discover in a PR.

## 8. What to ask Lucas for

- **GitHub collaborator access**, so your PRs run CI with the repo's secrets.
  A PR from a fork gets none of them and the test job fails for reasons that
  have nothing to do with your code.
- The **PayPal sandbox** credentials, if the prototype needs them.
- For him to **apply the 20261104 migration** to production.
- Nothing else. Not production DB access, not the service-role key, not his
  Cloudflare token.
