# SellWant

**Buy what you want. Sell what you have.** Live at <https://sellwant.com>.

A free marketplace for event tickets (student parties, formals, concerts). Two
kinds of listing: tickets people are **selling**, and tickets people **want**.
Offers are public, so the going rate is visible before anyone commits. The two
people agree a price, meet, scan in together, and pay each other directly.
SellWant never touches the money and never holds the ticket.

The full picture (architecture, data model, what exists, what doesn't) is in
[`docs/SELLWANT.md`](docs/SELLWANT.md). This file is the part you need before
your first commit.

## Rules that are already decided

Don't relitigate these in a PR; the code and the copy both lean on them.

- **No Stripe, no in-app checkout, no escrow.** Money moves between the two
  people, off-platform.
- **We never hold a ticket, and never imply we do.** A QR is stored only as
  `sha256(normalised payload)`: enough to catch the same code listed twice,
  never enough to redeem. No copy may suggest a ticket is "safely held".
- **Deal states record what someone *said*, not what we verified.** "Marked as
  paid", never "paid".
- **Reports are private and free-text.** No public callouts, no ratings UI.
- **Don't scrape or probe Bubbl, Posh or any third-party platform.**
- **Fast for everyone, always.** The people using this are students on phones,
  arriving from a link in a group chat. See [Performance](#performance).
- **Never push to `main`.** It deploys to production on every push.

## Run it

```bash
cd sellwant
cp .env.example .env        # then fill it in; see below
bun install
bun run web                 # http://localhost:8081
```

Use **your own** Supabase project, not production's: [`docs/handoff/`](docs/handoff/README.md)
has the schema, a seed, and a script that checks your database enforces the
rules. Put its URL and anon key in `.env`, and `SELLWANT_TEST_PASSWORD=devpass123`.

```bash
bun run typecheck           # tsc --noEmit
bun run test                # unit tests + the suite that talks to the database in .env
bun run build               # expo export -p web  -> dist/
```

`bun run test` creates real listings in whatever database `.env` names. Against
your dev database that is fine. Against production it leaks rows into the live
feed. Check the file before you run it.

You don't deploy. Merging to `main` does: CI typechecks, tests, builds, checks
the bundle carries its Supabase config, runs `wrangler deploy`, then smoke-tests
five live URLs.

## The map

| Where | What it owns |
|---|---|
| `sellwant/services/data.ts` | **The only place that talks to Supabase.** Every query and mutation. |
| `sellwant/worker/index.js` | **The only place that knows what a crawler or a pasted link sees**: route rewrites, per-listing OG tags and JSON-LD, the feed injected for crawlers, the sitemap, `/api/listings.json`, `/api/view`, www → apex. |
| `sellwant/app/` | expo-router screens. `[id].tsx` files are dynamic routes. |
| `sellwant/components/` | UI. `components/ui/` is the primitive layer. |
| `sellwant/constants/theme.ts` | Every colour, space and type size. **No screen defines its own colour.** |
| `sellwant/lib/` | Pure helpers. The easiest things to unit-test, and where logic worth pinning lives. |
| `sellwant/supabase/migrations/` | SQL that Lucas applies **by hand**. |
| `sellwant/tests/` | `bun test`. |
| `sellwant/public/` | `robots.txt`, `llms.txt`, `_headers`, icons. |
| `docs/` | Plans, the design system, and the overview. |
| `.claude/skills/featsw/` | This repo's own feature workflow and its record of mistakes. |

Stack: Expo SDK 52 / React Native 0.76 / expo-router 4, exported to **static
web** and served by a Cloudflare Worker; Supabase for Postgres, auth and
storage. Only the web build ships. The native build compiles but has never run
on a device.

## How we work

1. **Branch.** `git switch -c what-this-does`.
2. **Read [`lessons.md`](.claude/skills/featsw/references/lessons.md) and
   [`pitfalls.md`](.claude/skills/featsw/references/pitfalls.md) first.** Both
   are short. Every entry is something that passed typecheck, passed review, and
   was wrong, and they will save you more time than anything in this README.
3. **Check whether it already works.** A real fraction of requests here are
   already done, half-done, or aimed at the wrong layer. `grep` for the field
   and the component before you design either.
4. **Build, then prove it.** Typecheck passing means almost nothing here. Open
   the screen and use it; for anything touching permissions, sign in as a test
   user and *try the thing that must fail*.
5. **PR.** Commit messages are prose: lead with what was wrong and why the fix
   takes the shape it does. The PR body leads with whatever a reviewer would most
   regret missing, usually a risk or something Lucas must do by hand.
6. **Review your own diff** as someone who didn't write it, against `pitfalls.md`.
   This step has caught a feature that was completely broken.

If you use Claude Code, the whole of that is the `/featsw` skill and it loads
from `.claude/skills/featsw/`. If you don't, `SKILL.md` there reads fine as a
checklist.

Comments in this repo explain *why*, usually by naming the concrete failure that
motivated the line. Match that. A comment that restates the code is worse than
none.

### Migrations are files, not actions

Write SQL to `sellwant/supabase/migrations/<yyyymmdd>_<name>.sql`, commit it, and
say plainly in the PR what stays broken until Lucas runs it. Then work out what
the code does in the window *before* he does: a change that depends on an
unapplied migration can be worse than the code it replaced.

## The traps that matter most

The full list is in `pitfalls.md`. The ones that have bitten hardest:

- **RLS filters; it doesn't throw.** A blocked `DELETE` or `UPDATE` returns
  success having changed nothing. Ask for the affected count and check it.
- **RLS can't restrict columns, and column grants don't apply to `INSERT`.**
  A policy picks rows. To limit fields on `UPDATE`, revoke and grant by column;
  on `INSERT`, put it in the policy's `WITH CHECK`. Do **not** move `INSERT` to
  column grants: PostgREST decides insertability from the *table* privilege and
  will 401 every request while Postgres accepts the grant.
- **A new bracket route 404s in production** until `worker/index.js`'s `DYNAMIC`
  map knows it. It works locally either way.
- **A policy that queries its own table recurses.** Break the loop with a
  `SECURITY DEFINER` helper, and then use it.
- **Anything with a rule goes in an RPC, not a policy.** A policy can only say
  yes or no to a whole statement. Sequence, role, derived counters: a function.
- **`router.navigate`, not `router.push`**, or `__EXPO_ROUTER_key=…` ends up in
  the URLs people paste to each other.
- **On react-native-web, look before you measure.** DOM probes have reported
  `object-fit: fill` on an image rendering `contain`, and zero segments on a
  chart that was plainly on screen. Take the screenshot first.
- **The tests run against a real database.** One failure may be a dropped
  request; re-run before believing it.

## Performance

Measured against production, 2026-11-04:

| | |
|---|---|
| Entry bundle | 1.39 MB raw / ~359 KB as the edge serves it |
| HTML shell | ~8.7 KB brotli |
| `/feed` TTFB | ~0.24 s (edge cache hit) |
| `/api/listings.json` | 2.5 KB for the whole active market |

The bundle is the number to watch. It is one file every visitor downloads, and
it grows silently: a dependency added for one screen ships to everyone. Measure
before and after adding one: `expo export -p web --source-maps`, then read the
map. Guessing which package is heavy doesn't work; the answer here was `jsqr` at
250 KB, which nobody would have picked.

Two mechanisms already in use, worth reaching for again: `await import('x')`
inside the function that needs it (Metro emits a separate chunk), and a
`.web.tsx` stub that renders `null` (the native module never enters the web
graph). If a change makes something slower, say so with a number.

## Privacy is a promise, not a setting

Page views are counted with no cookie, no IP, no user id and no stored id; a
random id lives in one browser tab and dies on reload. The privacy page says so,
and it has to stay true. If a change would store something new about a visitor,
the policy changes in the same PR, or the change doesn't ship.

`sellwant/public/llms.txt` is likewise a public statement about what the product
does and what an agent can and cannot do with it. Keep it true.

## Where to go next

- [`docs/SELLWANT.md`](docs/SELLWANT.md): what it is, architecture, data model, what exists and what doesn't
- [`docs/handoff/README.md`](docs/handoff/README.md): your own dev database, the MCP and PayPal status
- [`docs/design-system.md`](docs/design-system.md): the visual language
- [`docs/TODO.md`](docs/TODO.md): known and not done
- [`.claude/skills/featsw/`](.claude/skills/featsw/SKILL.md): the workflow, the lessons, the pitfalls
