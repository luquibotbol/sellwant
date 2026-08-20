# SellWant: the map

## What it is

A free two-sided college ticket marketplace. People post tickets they're
selling and tickets they want. They agree a price, meet, and pay each other
directly. Money never touches the platform.

## Fixed product constraints

These are settled decisions, not preferences. Don't relitigate them in a PR:

- **No Stripe, no in-app checkout, no escrow.** Money moves between the two
  people directly.
- **Never imply a ticket is safely held by us.** We store only
  `sha256(normalised payload)` of a QR — enough to catch the same code listed
  twice, never enough to redeem. Copy that suggests otherwise is wrong.
- **Reports stay private and free-text.** No public callouts, no ratings UI.
- **Don't scrape or probe Bubbl, Posh or any third-party platform.**
- **Don't push to `main` unless Lucas has asked.** `main` auto-deploys.

## Stack

- **Expo SDK 52 / React Native 0.76 / expo-router 4**, exported to static web
  (`web.output: "static"`) and served by a Cloudflare Worker.
- **Supabase** — Postgres, RLS, `SECURITY DEFINER` RPCs, column-level GRANTs,
  triggers, `pg_trgm`.
- **Cloudflare Workers** with static assets and `run_worker_first`.
- **GitHub Actions** — checks on PR, deploy on push to `main`.

## Where things live

| Path | What it owns |
|---|---|
| `sellwant/services/data.ts` | The single data seam. Every query and mutation. |
| `sellwant/worker/index.js` | Anything a crawler or a pasted link sees: bracket-route rewrites, per-listing OG tags + JSON-LD, sitemap, `/api/listings.json`, `ROUTE_META`, www→apex redirect. |
| `sellwant/app/` | expo-router screens. `[id].tsx` files are dynamic routes. |
| `sellwant/lib/` | Pure helpers — the easiest things to unit-test, and where tests live for logic worth pinning. |
| `sellwant/supabase/migrations/` | SQL that Lucas applies by hand. |
| `sellwant/tests/` | `bun test`, run against the live database. |

## Commands

```bash
cd sellwant && npx tsc --noEmit          # typecheck
cd sellwant && bun run test              # full suite, hits production
```

Browser verification uses the preview tools with the launch config named
`sellwant-web` (port 8081). Never start a dev server with Bash.

## Performance baseline

Measured on production, 2026-08-20. These are the numbers a change should be
compared against, not a target that has been met:

| | |
|---|---|
| Web bundle | **415 KB** brotli / 1.57 MB raw — every visitor pays this before anything works |
| HTML shell | ~8.9 KB |
| TTFB `/admin` | 0.34 s (static asset, edge HIT) |
| TTFB `/feed` | 0.61 s |
| TTFB `/` | 0.93 s — the worker reads listings to inject the feed's markup |
| Static assets | `cache-control: immutable`, 1 year, `cf-cache-status: HIT` |

The bundle is the number to watch. It is one file that everyone downloads on a
phone, and it grows silently: a dependency added for one screen ships to every
visitor. Check it before and after adding one — `expo export -p web` then look
at `dist/_expo/static/js/web/`. The Geist subpath import in `app/_layout.tsx`
exists because importing the package root cost 1.66 MB to use four weights.

## Test fixtures

Two confirmed accounts, both `@example.edu`, password in `SELLWANT_TEST_PASSWORD`
in `sellwant/.env`:

- `maya@example.edu` — the buyer in most tests
- `deshawn@example.edu` — the seller

`example.edu` is IANA-reserved and cannot receive mail, so a recreated fixture
always needs **Auto Confirm** ticked in the Supabase dashboard. Tests resolve
user ids from the JWT `sub` claim rather than hardcoding them, so a new UUID is
fine.

### Cleaning up leaked test data

The suite creates listings named `Test ticket …` and `Offer stats …`. Ones with
a `lock_in` attached cannot be deleted by their owner — that policy is
deliberate — so they can leak into the public feed. Check after a run:

```sql
select count(*) filter (where l.title like 'Test ticket%') as test_ticket,
       count(*) filter (where l.title like 'Offer stats%') as offer_stats,
       count(*) filter (where l.status = 'active')          as active
from listings l join auth.users u on u.id = l.user_id
where u.email like '%@example.edu';
```

`purge_test_listing(uuid)` removes one safely — it refuses any listing whose
owner isn't a fixture account, and requires the caller to be one too.

## Proving a permission boundary

Never conclude a boundary holds by reading the policy. Sign in as a fixture
account over plain HTTP and attempt the thing that must fail:

```bash
cd sellwant && set -a && . ./.env && set +a
TOK=$(curl -s "$EXPO_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"maya@example.edu\",\"password\":\"$SELLWANT_TEST_PASSWORD\"}" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
```

Then POST/PATCH/DELETE with `apikey` and `Authorization: Bearer $TOK`, and
assert the failure. A `200` with an empty array is a *blocked* write, not a
successful one — see `pitfalls.md`.

## Shell notes (zsh)

- `UID` is read-only. Naming a variable `UID` fails with "failed to change
  user ID".
- zsh does **not** word-split unquoted variables. `for x in $LIST` iterates
  once over the whole string. Write to a file and loop with `while read`.

## What Claude cannot do here

- **Apply DDL / migrations.** Blocked by the auto-mode classifier. Write the
  SQL to a migration file and hand it over.
- **Write to `auth.users`.** Including confirming an email. That is a Supabase
  dashboard action.
- Both blocks are consistent and shape-independent. Don't try to route around
  them; say what's needed and let Lucas do it.
