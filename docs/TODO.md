# SellWant — outstanding work

Everything known-but-not-done, most urgent first. Written 2026-08-16, after the
SellUp → SellWant rename.

**Done since this was written:** the seed-account password is out of the repo
(rotated in Supabase, moved to `SELLWANT_TEST_PASSWORD` in `.env` — see
`.env.example`), password reset shipped at `/auth/reset`, and the site is **live on
`https://sellwant.com`** via Cloudflare Workers.

---

## Blocks launch

### 1. Supabase URL configuration still points at localhost
Auth email links resolve against Supabase's **Site URL**, not the app. Until it
is changed, every confirmation and recovery email sent from production points
at `localhost`.

- Site URL → `https://sellwant.com`
- Redirect allowlist → `https://sellwant.com/**` and `http://localhost:8081/**`

### 2. Email Sending is not enabled on the Cloudflare account
Supabase is still on the built-in mailer: **2 messages per hour**, best-effort,
explicitly not for production. Every signup now needs an email, so this gates
launch.

**Decision: Cloudflare, on Workers Paid.** Email Sending is unavailable on the
Workers Free plan; Workers Paid is $5/month and includes 3,000 emails, then
$0.35 per 1,000. Resend would give the same 3,000 free, but keeping one vendor
and one bill was judged worth $5. Swapping later is four SMTP fields.

Order matters:

1. **Upgrade the account to Workers Paid.** Until then the Email Sending API
   returns `Authentication error [code: 10000]` even for a token that holds the
   `email_sending` scope — the gate is the plan, not the credential.
2. **Onboard `sellwant.com`** — Cloudflare dashboard → **Compute → Email
   Service → Email Sending → Onboard Domain**. No API path exists for the first
   onboarding. This writes the `cf-bounce` MX, SPF, DKIM and DMARC records.
3. Point Supabase → Authentication → SMTP Settings at:
   `smtp.mx.cloudflare.net:465`, username the literal `api_token`, password a
   Cloudflare API token with **Email Sending: Edit**.

Cloudflare's SMTP submission is beta. If it proves flaky for auth mail, Resend
is a drop-in: same host/port/user/pass shape, free for 3,000/month.

### 3. `www.sellwant.com` does not resolve
The apex works; `www` returns nothing at all. Needs a DNS record plus a Worker
route for the `www` hostname, or a redirect rule to the apex.

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

---

## Housekeeping

### 7. Local folder is still named `sellup`
Everything else migrated. Run with no session open:

```bash
mv ~/Documents/github/sellup ~/Documents/github/sellwant
```

### 8. Root `package.json` is dead weight
Full of **Firebase** dependencies from before the Supabase rewrite. Along with
the root `package-lock.json` and root `node_modules/`, it is pure confusion.

### 9. Untested paths
- The native QR camera scanner is written but has **never run on a device**.
- QR upload has never been exercised through a real file picker.

### 10. Link previews have no image
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
