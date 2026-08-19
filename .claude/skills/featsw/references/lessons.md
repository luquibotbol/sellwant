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
