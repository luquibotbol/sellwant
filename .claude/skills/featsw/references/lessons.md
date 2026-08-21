# Lessons

Appended to at the end of every `/featsw` run. Newest last.

Each entry: what surprised us, and the signal that would have caught it
sooner. Keep them short and keep them true — if one turns out to be wrong,
correct it rather than layering around it. When a lesson is a repeatable trap
rather than a one-off, add it to `pitfalls.md` as well.

---

### 2026-08-18 — Asking for a feature surfaced a hole in the one next to it

Building the edit screen meant looking at what a client could already write.
The answer was every column, including `best_offer_cents` and `status` — so a
seller could invent demand on their own listing, or reopen a locked one and
sell the same ticket twice, with the key that ships in the bundle.

**Signal:** any request that adds a write is a reason to enumerate the writes
that already exist. Nobody asked about the update policy; the feature just
happened to be adjacent to it.

---

### 2026-08-18 — The fix for the symptom left the door open

Offer stats had been "fixed" by excluding the poster's own rows from the
headline number. The row was still inserted and still rendered on the public
board under "Most anyone will pay". The seller could still post it; it just no
longer counted. Six weeks later the actual door — a parentless self-offer —
was still open.

**Signal:** when a fix filters a symptom out of a view, ask what still creates
the thing being filtered.

---

### 2026-08-18 — 78% of the live feed was test data

The suite's cleanup deleted listings it had created. Every one had a deal
attached by then, and the delete policy correctly refuses those. RLS filters
rather than throwing, so the cleanup reported success and removed nothing.

**Signal:** cleanup code that never checks what it removed is cleanup code
that might not be running at all. Count rows.

---

### 2026-08-19 — Half the request was already built

The feed already sorted soonest-first and search already covered titles and
descriptions server-side; both were asked for as new work. The genuinely
broken part — a trigram index that no query could use — was the part nobody
had thought to ask about.

**Signal:** vet before building. Check what exists, and run `EXPLAIN` rather
than trusting an index's name.

---

### 2026-08-19 — The feature shipped typechecking and unusable

The city picker rendered, filtered, matched substrings and typechecked. It
also cleared itself the moment anyone selected a city, because a deferred blur
handler restored a value captured before the selection. Every check passed
except the one where a person clicks the thing.

**Signal:** exercise the actual gesture in a browser. Typing into a field and
seeing the dropdown appear is not the same as selecting from it.

---

### 2026-08-19 — The cleanup fix made the leak worse

Replacing the test cleanup with an RPC call was correct, except the RPC did
not exist until the migration was applied by hand. Until then it deleted
nothing at all — whereas the plain `DELETE` it replaced still cleared every
fixture without a deal. Self-review caught it before merge.

**Signal:** when a change depends on a migration that a human has to apply,
work out what happens in the window before they do.

---

### 2026-08-19 — "The gallery isn't rendering" and "the image 404s" look identical

A new photo gallery appeared to render nothing: no `<img>` in the DOM, no
element with a `background-image`, the URL absent from the HTML entirely. The
component was fine. React Native Web's `Image` renders an empty box when the
source fails to load, and the source was failing because the storage bucket
does not exist until the migration is applied by hand.

**Signal:** when a component "doesn't render", measure the box before reading
the code — four elements at exactly the styled dimensions were sitting there
the whole time. A one-line debug probe settled in seconds what twenty minutes
of staring did not.

---

### 2026-08-19 — Three of three asks were partly already built

`image_urls` already existed on listings and was already writable. `BottomNav`
already had badge rendering nothing passed a value to. The offers screen
already computed the exact count the nav needed, in the exact `(n)` format
that was asked for.

**Signal:** grep for the field and the component before designing either. In
all three cases the useful work was smaller than the ask and sat somewhere
slightly different from where it looked.

---

### 2026-08-19 — A column can be writable long before anything writes to it

`listings.image_urls` had been client-writable with no cap and no validation
since it was created: any signed-in user could put a hundred entries in it
pointing anywhere on the internet, to be rendered wherever a listing renders.
Nothing wrote to it, so nothing had ever exercised it.

**Signal:** an unused column is not an unreachable one. When a feature finally
starts writing to a field, that is the moment to bound what anyone else can
write to it.

---

### 2026-08-19 — Deleting a file on removal breaks the listing that still points at it

The photo picker deleted from storage the moment you removed a photo. Remove
one while editing, leave without saving, and `image_urls` still references a
file that no longer exists -- an empty frame with no way to repair it. Caught
in self-review, not by any test.

**Signal:** when a form edits a draft, nothing it does should be irreversible
before the draft is saved. An orphaned file is cheaper than a broken record.

---

### 2026-08-19 — An effect in the nav costs a query on every screen

Recounting the tab badges keyed on `pathname` meant two queries per tap, so
browsing twenty listings cost forty requests to learn nothing had changed.

**Signal:** anything living in a component rendered on every screen pays its
cost on every navigation. Ask which screens can actually change the value, and
key on leaving those.

---

### 2026-08-19 — The fix for the cropped photo looked identical to no fix at all

A listing's single photo was cropped to a fixed 200px band. Sizing the box
from the image's own `onLoad` typechecked, ran, and rendered a page that
looked reasonable — but react-native-web does not populate
`nativeEvent.source`, so the ratio stayed null and every photo kept the
placeholder shape. The screenshot afterwards looks like a working fix; it is
only wrong if you know what the photo's real proportions are.

**Signal:** for a layout fix, assert the number rather than looking at it.
Comparing the computed `aspect-ratio` (`1.33333 / 1`) against the image's
natural size (555×900) settled it instantly, and would have caught it before
the first screenshot rather than after.

---

### 2026-08-19 — Bounding the bytes is not bounding the layout

The storage rules for listing photos cap count, file size and mime type, so
they read as though the field is fully constrained. Nothing caps *dimensions*:
a 1200×6000 screenshot is a legal 5MB upload, and once the box takes the
image's own ratio that is 1675px of photo at phone width, burying the seller
card and the whole offer board.

**Signal:** when a change makes layout depend on user data that was previously
ignored, ask what the most extreme legal value does to the page. The upload
limits had been reviewed; they just answered a different question.

---

### 2026-08-20 — The photo feature was half-wired for a day and nobody could tell

`PhotoField` was added to the create form and the edit screen in the same
change. Only the create form actually rendered it. The edit screen imported it,
kept its state, loaded `image_urls` into that state and wrote the same value
back on save — so nothing broke, nothing was lost, and the feature was simply
absent from half the places it was supposed to be. Found by opening the screen
while building something else entirely.

**Signal:** when one component is wired into two screens, open both. The
compiler cannot tell you a component is missing from a render, and a
round-trip that preserves data hides the gap completely.

---

### 2026-08-20 — Uniform framing beat per-image measurement

The first fix for a cropped photo measured each image and set the height from
its own aspect ratio, which shows the whole picture but makes every listing a
different height. The ask turned out to be the opposite: same frame everywhere,
whole picture inside it. `contain` in a fixed 4:3 box does both, needs no
measurement, and deleted the `Image.getSize` machinery it replaced.

**Signal:** "show the whole image" and "make them all look the same" sound like
the same request and are not. Ask which one is wanted before reaching for
measurement.

---

### 2026-08-20 — Three DOM probes lied; the screenshot was right every time

Verifying charts and photos, computed-style selectors reported `object-fit:
fill` on an image rendering `contain`, a 0-width frame on a visible photo, and
zero segments on a line that was on screen. Each time the screenshot showed the
truth, and each time a few minutes went into chasing a bug that did not exist.

**Signal:** on react-native-web, look before measuring. The DOM is for
confirming a number the picture already implies, not for deciding whether
something rendered.

---

### 2026-08-21 — The DNS in TODO.md had never existed

`docs/TODO.md` recorded `sellwant.com` as onboarded to Cloudflare Email Sending
with MX, SPF, DKIM and DMARC. Two public resolvers agree that the apex has **no
TXT record at all**, no MX, and DMARC at `p=reject` — a policy telling every
receiver to reject mail that has nothing to align against. This is precisely the
failure `wrangler.jsonc` already warns about for custom domains: an OAuth login
without DNS scope reports success and creates nothing.

**Signal:** `dig` the record before building on it. A written record of
infrastructure is a claim about the past, and the one thing that had been
written down was the one thing nobody had re-checked. Notably it may also mean
signup confirmation mail has been failing silently for some time.

---

### 2026-08-21 — libpg_query will parse a migration this session cannot apply

DDL is blocked here, so migrations normally ship read-but-unrun. `pip install
pglast` wraps the actual Postgres parser: `parse_sql` covers the statements and
`parse_plpgsql_json` covers the dollar-quoted function bodies the outer grammar
skips straight over. It caught nothing this time, but it turns "hand it over and
hope" into "syntax is proven, semantics are not".

**Signal:** when the blocker is that we cannot *run* something, check whether we
can still *parse* it. It is not the same guarantee and it is much better than
none.

---

### 2026-08-21 — A helper said "authorised" when handed two blanks

The constant-time comparison behind the unsubscribe link returned **true** for
empty against empty. Nothing reached it that way — the computed signature is
always 32 hex characters — so it was a latent hazard rather than a live bug, and
only a test that bothered to pass `(null, undefined)` found it.

**Signal:** for any comparison standing in for an authorisation check, test the
absent case explicitly. "Both sides missing" quietly resolving to "they match"
is the wrong default to leave under a link anyone can click.

---

### 2026-08-21 — The footer promised a screen that did not exist

The unsubscribe confirmation said "you can turn them back on from your profile".
There is no such control on the profile screen, and this change deliberately
added no client code at all. Self-review caught it; the fix was to make the undo
a working link on that same page rather than to go and build the screen.

**Signal:** read new user-facing copy as a promise and check each one resolves.
A sentence pointing at a feature is indistinguishable from a sentence
implementing one until somebody goes looking.
