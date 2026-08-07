# SellUp Spine — Design Spec

**Date:** 2026-08-06
**Status:** Approved for planning
**Sub-project:** 1 of 5 ("Spine")

---

## 1. Why this document exists

The handoff brief describes a Next.js 16 + Supabase web app under `web/`, with a QR
registry, a deal state machine, `.edu` auth, and RLS already built. **That codebase does
not exist in this repository, on any branch.** Verified: no `web/` on `main`; the `web/`
on the `v0` branch is an unrelated v0.dev-generated NextAuth + Prisma app; no `qr.ts`,
`data.ts`, `schema.sql`, `CLAUDE.md`, or `AGENTS.md` anywhere; no `nextjs-webapp` branch.

What exists is `sellup/` — an Expo / React Native app (Expo 52, expo-router 4,
RN 0.76, zustand, nativewind), roughly 6,000 lines, running entirely on mock data.

This spec covers retrofitting the trust model onto that Expo app, starting with the
foundation.

## 2. Decisions taken (2026-08-06)

These supersede the handoff brief where they conflict. Each was an explicit call by
Lucas during design.

| # | Decision | Supersedes |
|---|---|---|
| D1 | Build on the existing Expo app, not a new Next.js app | Brief's `web/` architecture |
| D2 | Web-first delivery — a link pasted into a GroupMe, via `expo export -p web` to Vercel | — |
| D3 | Bubbl only (static QR). Registry + meet-at-the-door handoff | Brief's dual-platform matrix |
| D4 | Approach B: keep the shell and component library, rebuild the core, delete the rest | — |
| D5 | Delete the card/payment-method screens; store P2P payment *handles* (Venmo, CashApp, Zelle, other) | — |
| D6 | Fresh Supabase project, not the one in the untracked `services/.env` | — |
| D7 | Anyone can create events. No want-ads — sell listings only | Brief's dual listing system |
| D8 | **No `.edu` gate.** Accounts with any email domain | Brief's "closed verified network" rule |
| D9 | One global feed. No `schools` table | — |
| D10 | Free proof-of-concept. No monetization of any kind | (consistent with brief) |

### 2.1 Consequence of D8, recorded deliberately

Dropping `.edu` verification does **not** weaken the registry: code-uniqueness is
enforced by a database index and does not care who the seller is. A duplicate Bubbl QR
is caught either way.

It does weaken **enforcement**. With `.edu`, a suspended scammer needs another
university inbox to return. With open email they register a new Gmail in thirty seconds.
Therefore `is_suspended`, the report flow, and `completed_deals` are **advisory, not
binding**, for the duration of the POC.

Product copy must not claim a closed or verified network. `.edu` can return later as a
profile *badge* rather than a gate at the door — that is an additive change, not a
rewrite.

### 2.2 Rules from the brief that still hold

Unchanged and not up for renegotiation during implementation:

- Money never touches the platform. No Stripe, no escrow, no resale take rate. We store
  payment handles and build deep links; funds move directly between students.
- Never store a raw QR payload in a form a database leak could exploit — only
  `sha256(normalised payload)`. (Sub-project 2.)
- Never ship copy implying a Bubbl ticket is "safely held". The seller keeps a working
  copy forever; the honest flow is meet-at-the-door, pay, scan in first.
- Reputation is behavioral only. No stars, no user-written reviews, no public callouts.
  Reports are private and free-text. There is no `rating` column in this schema, by design.

## 3. Scope

**Spine ships when:** two students, on two different devices, sign in with email and see
the same party in the same feed, with real identities and payment handles.

**In scope:** domain model, Supabase project + schema + RLS, magic-link auth, the
`services/data.ts` seam, feed / event / create-event / profile / payment-handle screens,
error states, and an RLS verification script.

**Explicitly deferred:** `ticket_codes`, `code_collisions` (sub-project 2); `deals` and
the handoff state machine (3); reports (4); moderation and notifications (5).

Tables for deferred work are **not** defined now. Designing columns before designing the
flow that uses them is how schemas go wrong.

## 4. Domain model

The current `Event` type conflates the party with one person's ticket — it carries
`seller`, `price`, and `type` on the same row. Three sellers at one darty produce three
"Summer Night Party" rows in the feed. Splitting them is what makes an event page
possible at all.

```sql
create table profiles (
  id              uuid primary key references auth.users on delete cascade,
  handle          text not null unique,
  display_name    text not null,
  completed_deals integer not null default 0,
  is_suspended    boolean not null default false,
  created_at      timestamptz not null default now()
);

create table payment_handles (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  kind       text not null check (kind in ('venmo','cashapp','zelle','other')),
  value      text not null,
  label      text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table events (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  venue      text,
  starts_at  timestamptz not null,
  platform   text not null default 'bubbl' check (platform in ('bubbl')),
  image_url  text,
  created_by uuid not null references profiles,
  created_at timestamptz not null default now()
);

create table listings (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events on delete cascade,
  seller_id  uuid not null references profiles,
  price_cents integer not null check (price_cents > 0),
  status     text not null default 'active'
             check (status in ('active','locked','sold','cancelled')),
  note       text,
  created_at timestamptz not null default now()
);

create index on events (starts_at);
create index on listings (event_id, status);
```

### 4.1 Rationale for each change from the current model

1. **`events` / `listings` split** — see above.
2. **`price_cents integer`** — current mock data uses `45.99` as a float. Money in floats
   produces $19.999999 tickets.
3. **`payment_handles` as a child table** — `kind` is a text check constraint rather than
   an enum, so adding Apple Cash later is a data change, not a migration. `label` carries
   the display name when `kind = 'other'`.
4. **`seller.contact` removed** — currently a raw phone number, public on every listing.
   Contact happens inside a deal, not in the feed.
5. **No `rating` column** — the reputation rule expressed structurally. There is nothing
   to accidentally start writing to.
6. **`platform` check accepts only `'bubbl'`** — D3. Widening it is one line when a
   second platform is designed.

### 4.2 Handle generation

A `security definer` trigger on `auth.users` insert creates the matching `profiles` row,
deriving `handle` from the email local part plus a short random suffix to satisfy the
unique constraint without a retry loop. Users cannot edit their handle in Spine; that
lands with the profile-editing work in sub-project 4.

## 5. Row-level security

With school-scoping gone (D9), cross-tenant reads are no longer the risk. Two things are.

| Table | Select | Insert | Update / Delete |
|---|---|---|---|
| `profiles` | any authenticated | trigger only | own row, restricted columns |
| `payment_handles` | **own rows only** | own | own |
| `events` | any authenticated | authenticated and not suspended | `created_by` only |
| `listings` | any authenticated | authenticated and not suspended | `seller_id` only |

Two mechanisms carry the weight:

**`payment_handles` is owner-only.** It is now the most sensitive table in the schema. In
sub-project 3 this widens to "the counterparty in an active deal with you" — that narrow
grant and nothing broader. A public profile page must never expose a payment handle.

**`completed_deals` is not client-writable.** Enforced with a column-level grant, not a
policy:

```sql
revoke update on profiles from authenticated;
grant update (display_name) on profiles to authenticated;
```

Without this, reputation is self-serve — any user can PATCH their own completed-deal
count. RLS policies alone do not restrict *which columns* an update touches, which is the
trap here.

`is_suspended` is likewise not client-writable, and is checked in the insert policies for
`events` and `listings` so a suspended user cannot post.

## 6. Authentication

Supabase magic link (email OTP), any domain (D8). No passwords — this also removes the
fake password comparison currently in `mockApi.auth.signIn`.

**Web callback.** The magic link redirects to `/auth/callback` on the deployed origin.
This is the fiddliest part of Spine and must be verified against a real email, not
assumed: `vercel.json` rewrites every path to `/`, and `expo export -p web` produces a
single-page bundle, so `/auth/callback` is resolved client-side by expo-router while the
browser URL is preserved. Supabase's `detectSessionInUrl` then exchanges the code.
`emailRedirectTo` must be set explicitly and the URL added to Supabase's allow-list.

**Session storage.** AsyncStorage on native, `localStorage` on web, via the supabase-js
storage adapter. AsyncStorage is already a dependency.

### 6.1 Environment variables — security critical

```
EXPO_PUBLIC_SUPABASE_URL        → client bundle, safe
EXPO_PUBLIC_SUPABASE_ANON_KEY   → client bundle, safe (RLS is the protection)
SUPABASE_SERVICE_ROLE_KEY       → verification script ONLY, never EXPO_PUBLIC_
```

**Anything prefixed `EXPO_PUBLIC_` is inlined into the shipped JavaScript bundle.** The
service role key bypasses RLS entirely. If it is ever given that prefix, every row in the
database becomes publicly readable and writable by anyone who opens devtools. It lives in
a non-prefixed variable, read only by the Node verification script.

**`.gitignore` gap (must fix first):** the current file ignores `.env*.local` but not
plain `.env`. `sellup/services/.env` — which holds a real Supabase URL and anon key for
the old project `erkxuqrlhnurdkrmtcof` — is untracked only by luck and would be committed
by any `git add -A`. Add `.env` to `.gitignore` before anything else.

## 7. Data layer

A single module, `services/data.ts`. Every screen calls it. **No screen ever imports the
Supabase client.** That seam is what makes sub-projects 2 and 3 cheap, and it is the one
piece of the original brief's architecture worth keeping verbatim.

**Removed:**

- `store/eventStore.ts` — deleted. Its AsyncStorage persistence is now actively harmful:
  it caches a marketplace to the device, so a listing someone else marks sold stays
  "available" on your phone until you clear storage.
- `store/authStore.ts` — reduced to a thin session wrapper over Supabase's own
  persistence. Loses `PaymentMethod` and the mock sign-in.
- `services/mockApi.ts`, `services/api.ts`, `services/apiClient.ts`,
  `constants/mockData.ts` — deleted. Three competing API layers, none reaching a server:
  `api.ts` points at `https://your-api-url.com`, `apiClient.ts` at `localhost:3000`, and
  `mockApi` is the only one the stores actually import.

**No new state library.** `data.ts` plus a ~30-line `useAsync` helper covers every screen
in the pilot. Adding React Query to an app whose caching bug we are deleting would be
backwards.

**New dependencies:** `@supabase/supabase-js`, and `react-native-url-polyfill` if
supabase-js requires it under RN 0.76 (verify; do not add speculatively).

## 8. Screens

**Build (7):** `login`, `auth/callback`, `index` (feed — tonight & this weekend, ordered
by `starts_at`, not a search box), `event/[id]`, `create-event` (rewritten, open to all),
`profile` + `u/[handle]`, payment-handle management.

**Keep:** `constants/colors.ts`, `Button`, `InputField`, `NavBar`, `EventCard`,
`FloatingButton`, `error-boundary.tsx`, the expo-router setup, `vercel.json`.

**Delete — 20 files, 2,677 lines:** `concerts`, `sports`, `theater`, `phones`,
`mens-clothing`, `parties`, `categories` (seven near-identical category pages, 484 lines);
`payment-methods`, `add-payment-method` (D5, 578 lines); `personal-info`, `settings`,
`history`, `modal` (731 lines); the unused `(tabs)/` template group (76 lines — verified
that `app/_layout.tsx` contains no reference to it, so removal is safe);
`manage-listings`, `my-buy-listings`, `my-sell-listings` (686 lines) — these three return
in sub-project 3, designed against real deals; `components/CategoryCard`,
`components/SocialButton` (122 lines).

A further **965 lines** go with the data layer rewrite: `store/eventStore.ts` (145),
`services/mockApi.ts` (371), `services/api.ts` (124), `services/apiClient.ts` (195),
`constants/mockData.ts` (130). Total removal: **3,642 lines.**

Root `package.json` additionally lists Firebase and react-navigation dependencies that
nothing in `sellup/` imports; clean up.

## 9. Error states

The current app has none of these. `eventStore` swallows every failure into an error
string and renders an empty list, so "the database rejected you" and "no parties tonight"
look identical to the user. Four distinct states:

| State | Behaviour |
|---|---|
| Signed out | Redirect to `login` |
| Suspended | Blocked screen; posting disabled server-side regardless |
| RLS-denied / network failure | Explicit error with retry — never a silent empty list |
| Genuinely empty feed | "No parties yet" with a create-event call to action |

## 10. Verification

The brief listed "confirm RLS actually holds" as task 4, *after* building on top of it.
RLS is the entire privacy model — if it is wrong, every payment handle is readable by
every user, and that is not something to discover late. Verification ships **with** Spine.

**`scripts/verify-rls.ts`** — creates two users against the real database via the service
role key, then asserts as each user:

1. User B cannot read User A's `payment_handles` (expect 0 rows, not an error — RLS
   filters rather than throws, so an empty result is the correct assertion).
2. User B cannot update or delete User A's `listings`.
3. User B cannot update User A's `events`.
4. User B cannot increment their own `completed_deals` (the column grant).
5. User B cannot set their own `is_suspended` to false.
6. A suspended user cannot insert an `event` or a `listing`.

Exits non-zero on any failure. Runs against a real Supabase instance, not a mock — a
uniqueness or authorization check against an in-memory store proves nothing.

**Manual:** two browsers (one normal, one private), two accounts, one creates a party and
a listing, the other sees both. This is the actual Spine acceptance test.

**Typecheck:** `npx tsc --noEmit` currently fails with **8 errors** — 7 in
`store/authStore.ts` (`PaymentMethod` type mismatch) and 1 in `services/mockApi.ts`
(dynamic import flag). Both files are on the deletion list, so the gate is not "stays
green" but "no new errors outside the doomed files, and green by Stage 7."

## 11. Staged execution plan

Ordering principle: **build the new layer alongside the old, migrate screens onto it, and
delete only at the end.** The app boots at the end of every stage. Deletion is never
interleaved with construction, because a half-migrated screen importing a half-deleted
store is exactly how this breaks.

Work happens on a feature branch off `main`. `main` is not touched without Lucas's say-so.

| Stage | Work | App state | Gate |
|---|---|---|---|
| **0** | Branch. Add `.env` to `.gitignore`. Record baseline (8 tsc errors; confirm `expo start` boots and `expo export -p web` succeeds). | Untouched | Baseline recorded |
| **1** | Create fresh Supabase project (Lucas, via dashboard). Apply schema + RLS + triggers + column grants. **No app code changes.** | Runs on mocks | SQL applies cleanly |
| **2** | Write and run `scripts/verify-rls.ts`. Fix policies until all six assertions pass. | Runs on mocks | Script exits 0 |
| **3** | Add `@supabase/supabase-js`, client config, `services/data.ts`, session context, `useAsync`. **Nothing imports them yet.** | Unchanged, runs on mocks | Still boots; no new tsc errors |
| **4** | Build `login` + `auth/callback`. Verify a real magic link end-to-end on a deployed preview. | Old screens still on mocks | Real login works on web |
| **5** | Migrate `index` (feed) and `event/[id]` onto `data.ts`. | Mixed; both paths work | Two devices see one feed |
| **6** | Build `create-event`, `profile`, `u/[handle]`, payment handles. | New flows live | Manual two-account test passes |
| **7** | Delete the 16 screens, the stores, the three API layers, `mockData.ts`. Clean root `package.json`. | Fully migrated | `tsc` **green**; web export succeeds |
| **8** | Deploy to Vercel. Manual two-browser acceptance test. | Shipped | Acceptance test passes |

**Stage 1 depends on Lucas** — creating the Supabase project requires dashboard signup,
which cannot be automated. Everything from Stage 2 on is blocked until the project exists
and its keys are in `.env`.

**Highest-risk stage: 4.** The magic-link web callback interacts with the Vercel catch-all
rewrite, the Expo single-page web output, and Supabase's redirect allow-list. It is
verified against a real email on a real deployed preview before Stage 5 begins, because
discovering it late would strand every subsequent stage.

### 11.1 Rollback

Each stage is one commit. Stages 0–6 are additive or isolated, so rollback is
`git revert`. Stage 7 is the only destructive one, and by then the new path is already
proven by the Stage 6 manual test. Deleted files remain recoverable in git history.

Database changes are forward-only in Spine (there is no production data to lose — the
project is created empty in Stage 1).

## 12. Open questions

1. **Login-to-browse.** Lucas chose accounts-required for browsing. For a link pasted
   into a GroupMe, a sign-in wall sits between a curious student and the feed;
   browse-anonymously / sign-in-to-post would convert better. This is a one-line policy
   change later (a public select policy on `events` and `listings`), not a rewrite.
   Recorded, not blocking.
2. **Duplicate events.** Open event creation (D7) means two students will create
   "Sig Ep Darty" twice and split the listings across them. Accepted for the POC;
   dedup or merge is a sub-project 2 concern once we see how bad it gets.
3. **Old Supabase project** `erkxuqrlhnurdkrmtcof` is superseded by D6. Its `.env` should
   be deleted from disk once the new project is live.
