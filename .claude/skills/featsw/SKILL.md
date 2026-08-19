---
name: featsw
description: The end-to-end feature workflow for the SellWant repo — plan, vet, build, test and fix, open a PR, review it, merge it, verify production, and record what was learned. Use this whenever work on this repo goes beyond a one-line edit: a new feature, a change to the feed, listings, offers, deals, auth or the worker, a bug that needs a real fix, or anything that will end in a pull request. Also use it when Lucas says /featsw, "ship this", "build and merge this", or describes a feature and expects it to end up live on sellwant.com. Prefer it over ad-hoc editing even when the change looks small, because the failure modes in this repo are mostly invisible ones — silent RLS filtering, unused indexes, routes that 404 only in production — and this skill is where the list of them lives.
---

# Shipping a feature on SellWant

SellWant is a free two-sided ticket marketplace: people list tickets they're
selling and tickets they want, meet in person, and pay each other directly.
Money never touches the platform. The product's whole distribution is a link
pasted into a group chat, and its whole credibility is one number — the going
rate on a listing. Both of those are easy to break invisibly, which is what
this workflow is built around.

**Read `references/lessons.md` before you plan.** It is the record of what has
actually gone wrong here, appended to after every run. It is the most valuable
file in this skill, and it is worth more than anything you'll infer from the
code, because most of it describes things the code looks fine without.
`references/repo-map.md` has the architecture and the commands.

Work the phases in order. Skipping ahead is how the bugs in `lessons.md` got
written.

## 1. Plan

Understand what's actually being asked before you touch anything. Then:

- **Check it against the product's fixed constraints** (in `repo-map.md`).
  Some things are settled: no Stripe or in-app checkout, never imply a ticket
  is safely held, reports stay private, don't probe third-party platforms.
- **Find the seam.** Almost everything data-shaped goes through
  `services/data.ts`. Anything a crawler, a scraper or a pasted link sees goes
  through `worker/index.js`. If your change doesn't touch one of those, check
  again whether you've found the right layer.
- **Ask only what would change the work.** A question whose answers all lead
  to the same code is a question to answer yourself. A question that changes
  the schema is worth stopping for.

## 2. Vet — make sure it makes sense before building it

This phase exists because a real fraction of requests here are already done,
half-done, or aimed at the wrong layer. Twenty minutes of checking has
repeatedly replaced a day of building.

- **Check whether it already works.** The feed already sorted soonest-first;
  search already covered titles and descriptions server-side. Both were asked
  for. Say so instead of rebuilding them.
- **Verify against the live database, not the code.** Read the actual policy,
  the actual grants, the actual `EXPLAIN` output. A trigram index existed for
  months and was never once used, and the code read as though it were.
- **Look for the adjacent hole.** If the ask touches writes, ask what else a
  client can write. The edit screen request surfaced that owners could write
  *every* column, including the going rate on their own listing.
- **Prefer the smaller shape.** One button that always works beats two buttons
  where one is usually wrong.

Report what you found before building. If the ask rests on a wrong premise,
say so in a sentence or two, then build the version that makes sense.

## 3. Build

Branch first — `main` is deployed automatically, and pushing to it without
Lucas asking is out of bounds.

Match the surrounding code. This repo's comments explain *why*, usually by
naming the concrete failure that motivated the line ("without this, the tab
and every pasted link went untitled"). Comments that restate the code are
worse than none. Keep that voice.

Then walk `references/pitfalls.md` for the specific traps: bracket routes that
404 in production, `router.navigate` vs `push`, column-level grants, policies
that recurse, cascades that erase someone else's records. Read it — it is
short, and every entry is something that has already shipped broken here.

**Migrations are files, not actions.** DDL cannot be applied from this
session; the classifier blocks it. Write the SQL to
`sellwant/supabase/migrations/<date>_<name>.sql`, commit it, and tell Lucas it
needs running by hand. Say plainly what stays broken until he does.

## 4. Test, and fix what it finds

```bash
cd sellwant && npx tsc --noEmit && bun run test
```

The suite runs against the **live production database** using two fixture
accounts. That has three consequences worth holding in mind:

- A dropped request fails a test. Re-run before believing a single failure.
- The suite creates real listings and can leak them into the public feed.
  Check afterwards, and clean up (see `repo-map.md`).
- A test that starts failing after a migration may be asserting the hole the
  migration closed. Read it before you "fix" it — that has happened, and the
  right change was to the test.

Then verify in the browser, because typechecks pass on things nobody can use.
Start the preview, exercise the actual path a person takes, and read the
console. The city picker typechecked, rendered, filtered correctly, and
cleared itself the instant anyone selected a city; only clicking it found
that.

For anything touching permissions, prove the boundary as a non-privileged
user — sign in as a fixture account and try the thing that should fail. Do not
infer from the policy text. `repo-map.md` has the probe pattern.

## 5. Open the PR

Commit messages here are prose that explains the reasoning, not a changelog.
Lead with what was wrong and why the fix takes the shape it does. End with
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

The PR body should lead with whatever a reviewer would most regret missing —
usually a risk, a behaviour change, or something that needs Lucas to act. If a
migration needs applying, that goes at the top, not the bottom.

## 6. Review the PR — properly

Review your own diff as a senior engineer who did not write it. This is not
ceremony: this step has caught a feature that was completely broken (selecting
a city cleared the field), a pagination bug that silently dropped listings,
and a "fix" that made the leak it targeted strictly worse.

Read `references/pitfalls.md` again, now as a checklist against the diff. For
each finding, write the concrete failure — inputs, then wrong result. If you
can't, it isn't a finding.

**Fix what you find before merging.** A reported-but-unfixed bug in your own
PR is just a bug. Then re-run the tests and re-verify in the browser.

## 7. Merge and verify production

Merge only with CI green. Merging to `main` deploys to sellwant.com
automatically, so the job isn't done at merge:

- Wait for the deploy run to finish, and check it succeeded.
- Hit the live URLs the change touches. New routes especially — a bracket
  route that works locally 404s in production until the worker knows it.
- Clean up any test listings the run leaked into the public feed.

## 8. Record what you learned

This is the step that makes the skill worth more next time than it was this
time. Append to `references/lessons.md`:

- what surprised you, in one or two sentences
- the signal that would have caught it earlier
- if it's a repeatable trap, add it to `references/pitfalls.md` too

Write the lesson so it helps someone who wasn't here. "RLS filters rather than
throwing, so a blocked delete returns success with nothing removed" is useful
forever. "Fixed the delete bug" helps nobody.

Keep both files honest: if an entry turns out to be wrong or obsolete, correct
it rather than layering around it.
