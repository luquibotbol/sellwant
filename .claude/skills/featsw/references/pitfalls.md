# Pitfalls that have actually shipped here

Read this before building, and again as a checklist against your own diff.
Every entry is something that passed typecheck, passed review, and was wrong.

## Postgres and RLS

**RLS filters; it does not throw.** A blocked `DELETE` or `UPDATE` returns
success having changed nothing. `deleteListing` reported "done" while removing
zero rows, and 192 test listings piled up in the public feed before anyone
noticed. Always ask for the affected count and check it:

```ts
const { count } = await supabase.from('x').delete({ count: 'exact' }).eq(...);
if (!count) { /* it was blocked — say so */ }
```

**RLS cannot restrict columns.** A policy says *which rows*, never *which
fields*. `listings_update_own` checked only ownership, so a seller could
`PATCH {"best_offer_cents": 99999}` and manufacture demand on their own
listing. Restricting columns is a `GRANT`:

```sql
revoke update on public.t from authenticated;
grant update (col_a, col_b) on public.t to authenticated;
```

**A policy with no `WITH CHECK` on `UPDATE` reuses its `USING` clause.** That
let a seller rewrite the amount on someone else's offer, since the row still
belonged to their listing afterwards. Write both clauses.

**A policy that queries its own table recurses** (`42P17`). Break the loop
with a `SECURITY DEFINER` helper — and then actually use it. This has been
written correctly and then not used, twice.

**Expression indexes only match the same expression.** A trigram index on
`title || location || description` is invisible to a query that filters the
three columns separately. It sat unused for months, costing a write on every
insert. Confirm with `EXPLAIN (ANALYZE, BUFFERS)` rather than assuming an
index named after the feature is serving it.

**Cascades erase the other person's records.** Deleting a profile cascades
through `lock_ins.buyer_id`/`seller_id` and `reports.subject_id` — so removing
one account destroys the counterparty's record of a completed trade, and a
reported user can erase the reports about them by leaving. Before adding a
cascade, ask whose data is downstream.

## Pagination and queries

**Offset pagination needs a total order.** Ordering by `event_date` alone,
where ties are the common case, lets Postgres return a row at position 19 in
one page and 20 in the next: it comes back twice, and whatever displaced it is
never returned at all. End every paged sort with a unique tiebreaker (`id`).

**An unbounded query is capped silently.** PostgREST truncates at its
max-rows. Past that ceiling listings simply stop existing, and nothing in the
response says rows were dropped. Always `.range()`.

**`onEndReached` fires when the list is shorter than the screen.** A first page
that doesn't fill the viewport immediately fetches a second, which defeats the
point of paging. If the intent is "don't load everything", use an explicit
button.

## expo-router and the worker

**A new bracket route 404s in production** until `worker/index.js` knows about
it. `expo export` emits `dist/edit/[id].html`, which no browser ever requests.
Add the prefix to `DYNAMIC`. It works locally either way — that's the trap.

**Use `router.navigate`, not `router.push`.** `push` mints a stack entry and
expo-router stamps `__EXPO_ROUTER_key=undefined-…` into the URL, which is then
what people copy and paste. `lib/clean-router-url.ts` patches the history
methods as a backstop, but don't rely on it.

**The initial route stays mounted underneath every screen**, so a per-screen
`<Head>` loses to the feed's. Per-route titles and canonicals live in the
worker's `ROUTE_META`.

**Don't put a query string in a canonical or cache key.** The worker once used
the full URL for both, so every share missed the cache, re-read the database,
and told crawlers one listing was an unbounded number of near-duplicate pages.

## React

**Deferred handlers capture stale values.** `CityField` deferred blur by 150ms
so a tap on an option could land first — which meant the timer held the value
from *before* the selection and wiped it. Selecting a city cleared the field.
When a timeout outlives a state change, read the value from a ref and cancel
the timer when the change makes it unnecessary.

**A `catch` that disables the UI is worse than the error.** Setting
`exhausted` on a failed page removed the "Show more" button permanently, so
one dropped request made the rest of the feed unreachable.

**Confirm-on-second-tap needs the other confirmations disarmed**, or two armed
destructive buttons sit side by side.

## Testing

**The suite runs against production.** A single failure may be a dropped
request; re-run before believing it. And the suite leaks rows — check and
clean up.

**A test that fails after a migration may be asserting the hole it closed.**
One offer-stats test had the poster posting a bare offer on their own listing.
The migration correctly rejected it. The fix was to the test.

**Don't verify with synthetic `.click()`.** React Native Web's Pressables often
ignore it. Use real mouse events at real coordinates.

## Web listeners

**Use the capture phase for outside-click and Escape.** A focused text input
consumes Escape before it reaches `document`, and handlers underneath can stop
propagation. The first version of the city dropdown's Escape handler did
nothing for exactly this reason.
