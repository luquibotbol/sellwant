# SellWant — outstanding work

Everything known-but-not-done, most urgent first. Written 2026-08-16, after the
SellUp → SellWant rename.

---

## Blocks launch

### 1. Seed-account password is live in a public repo
`sellwant/tests/advance-deal.test.ts:19` hardcodes `sellup-dev-only` — the real
Supabase password for `maya@example.edu` and `deshawn@example.edu`.

Harmless today: signing in also needs the project URL and anon key, which live
only in the untracked `.env`. **Exploitable the moment you deploy** — `expo
export -p web` inlines every `EXPO_PUBLIC_*` var into the JS bundle, so both
become readable in devtools. Anyone could then sign in as Maya, and Maya is the
account the `reset_completed_deals` RPC trusts.

Fix: move it to `SELLWANT_TEST_PASSWORD` in `.env`, read via `process.env` in
the test, and rotate both account passwords in Supabase.

### 2. Supabase URL configuration still points at localhost
Auth email links resolve against Supabase's **Site URL**, not the app. Until it
is changed, every confirmation and recovery email sent from production points
at `localhost`.

- Site URL → `https://sellwant.com`
- Redirect allowlist → `https://sellwant.com/**` and `http://localhost:8081/**`

### 3. Deploy config is stale and contradictory
`sellwant/vercel.json` exists, but there is no `wrangler.jsonc` and no worker
directory, despite a note claiming this deploys to Cloudflare Workers. Nothing
in `package.json` has a `deploy` script. Decide the target and wire it.

---

## Should do before real users

### 4. Notifications do not exist
Nothing tells anyone anything. Offer received, offer accepted, deal advanced,
counterparty acted — all invisible unless you reopen the app. Needs an email
provider (Resend is the easy one) and its API key.

Deliverability note: this is a reason the brand sits on `.com` and not
`.party`.

### 5. No moderation surface
Reports are captured correctly and RLS keeps them private, but **nothing can
read them** and `is_suspended` has no path to being set to true. Decide: an
admin-gated page, or querying Supabase directly at first.

### 6. Deals can hang forever
A buyer who locks a listing and never confirms leaves it locked permanently —
no timeout, no seller recovery. Accepted knowingly (D11), but it is a real
denial-of-service on a seller's listing.

### 7. Password reset
Once password sign-in ships, an account with a forgotten password is a dead
end. `resetPasswordForEmail` + a `/reset` screen.

---

## Housekeeping

### 8. Local folder is still named `sellup`
Everything else migrated. Run with no session open:

```bash
mv ~/Documents/github/sellup ~/Documents/github/sellwant
```

### 9. Root `package.json` is dead weight
Full of **Firebase** dependencies from before the Supabase rewrite. Along with
the root `package-lock.json` and root `node_modules/`, it is pure confusion.

### 10. Untested paths
- The native QR camera scanner is written but has **never run on a device**.
- QR upload has never been exercised through a real file picker.

### 11. Link previews have no image
Title and description now render (fixed during the rename), but there is no
`og:image`. Your entire distribution is links pasted into group chats — a
preview card with artwork is worth building.

---

## Optional

- **Buy the defensive domains** if not already: `sellwant.app`, `.co`, `.net`
  were all free at rename time.
- **Trademark clearance.** "SellWant" is a compound like StubHub and OfferUp,
  which are both registered — but no search has been run.
- **`sellup.ar` / `sellup.party`** were available and rejected (`.ar` needs an
  Argentine CUIT; `.party` hurts email deliverability). Revisit only as a
  short-link domain, never as the brand.
