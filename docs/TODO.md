# SellWant — outstanding work

Everything known-but-not-done, most urgent first. Started 2026-08-16 after the
SellUp → SellWant rename; kept current as things land.

**No launch blockers remain.** The site is live, signup works end to end, and
pushes to `main` deploy themselves.

## Done

- **Renamed** SellUp → SellWant. `sellwant.com` plus `.app`, `.co`, `.net`.
- **Live** on Cloudflare Workers at `https://sellwant.com`, apex bound and
  serving, including the `/deal/…` and `/u/…` rewrites a static host 404s.
- **Password auth with email verification**, proven end to end on the real
  domain. Password reset at `/auth/reset`.
- **Supabase Site URL** pointed at `sellwant.com`, so auth links no longer
  resolve to localhost.
- **Cloudflare Email Sending** on Workers Paid, `sellwant.com` onboarded with
  MX/SPF/DKIM/DMARC, Supabase SMTP pointed at `smtp.mx.cloudflare.net:465`.
  Confirmed by the rate limiter dropping its `2/1h` built-in-mailer cap the
  moment custom SMTP took effect.
- **Seed password out of the repo** — rotated in Supabase, now
  `SELLWANT_TEST_PASSWORD` in `.env` (see `.env.example`).
- **CI deploys on push to main**, with a bundle-config check and a live smoke
  test. PRs run checks only.
- **Offer stats fixed** — the poster's own counter no longer counts as
  counterparty demand.

---

## Should do before real users

### 1. Notifications do not exist
The largest remaining gap, and now unblocked — SMTP works.

Nothing tells anyone anything. Offer received, offer accepted, deal advanced,
counterparty acted: all invisible unless the person reopens the app. On a
marketplace where the ticket expires when the party starts, silence kills
deals that would otherwise close.

Suggested events: offer received, offer accepted, deal advanced by the other
party, deal cancelled. Best sent from Postgres via a trigger calling an Edge
Function, so delivery does not depend on anyone's app being open.

Budget note: Cloudflare includes 3,000 emails/month, then $0.35 per 1,000.
That is ~100/day sustained — signup confirmations and notifications share it.

### 2. No moderation surface
Reports are captured correctly and RLS keeps them private, but **nothing can
read them** and `is_suspended` has no path to being set to true. You would be
blind on the first bad actor. Decide: an admin-gated page, or querying
Supabase directly at first.

### 3. Deals can hang forever
A buyer who locks a listing and never confirms leaves it locked permanently —
no timeout, no seller recovery. Accepted knowingly (D11), but it is a real
denial-of-service on someone else's listing.

### 4. `www.sellwant.com` does not resolve
The apex works; `www` returns nothing at all. Needs a DNS record plus a Worker
route for the `www` hostname, or a redirect rule to the apex. Cheap, and
people do type it.

---

## Housekeeping

### 5. Local folder is still named `sellup`
Everything else migrated. Run with no session open:

```bash
mv ~/Documents/github/sellup ~/Documents/github/sellwant
```

### 6. Root `package.json` is dead weight
Full of **Firebase** dependencies from before the Supabase rewrite. Along with
the root `package-lock.json` and root `node_modules/`, it is pure confusion.

### 7. CI tests are not hermetic
They run against the real Supabase project — creating listings and offers, then
deleting them. The concurrency group stops runs colliding, but a red run can
mean the shared database moved rather than the code breaking. Worth knowing
before debugging the wrong thing.

### 8. `gh` token lacks the `workflow` scope
The remote is SSH, which works. But pushing workflow edits over HTTPS from
another machine will be refused; `gh auth refresh -s workflow` fixes it there.

### 9. Untested paths
- The native QR camera scanner is written but has **never run on a device**.
- QR upload has never been exercised through a real file picker.

### 10. Link previews have no image
Title and description render, but there is no `og:image`. The whole
distribution model is links pasted into group chats — a preview card with
artwork is worth building.

---

## Optional

- **Trademark clearance.** "SellWant" is a compound like StubHub and OfferUp,
  which are both registered — but no search has been run.
- **Counter on every row.** The offers board offers "Counter" against another
  buyer's bid, which is not really a thing. Cosmetic.
- **`sellup.ar` / `sellup.party`** were available and rejected (`.ar` needs an
  Argentine CUIT; `.party` hurts email deliverability). Only ever revisit as a
  short-link domain, never as the brand.
