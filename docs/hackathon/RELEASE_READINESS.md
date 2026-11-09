# Release evidence and remaining access

Checked November 8, 2026 UTC. The [execution tracker](EXECUTION_PLAN.md) is
authoritative for implementation status. This document records release checks;
it does not establish a completed demo or submission.

## Current official requirements

The [official rules](https://paypalaihackathon.devpost.com/rules), read on
November 8, specify:

| Requirement | Verified rule / release action |
| --- | --- |
| Cutoff | November 12, 2026, noon PST: `2026-11-12T20:00:00Z` |
| Platform | Meaningful PayPal sandbox and AI integration; describe significant changes to an existing project |
| Working build | Hosted demo or complete repository setup/run instructions; static mockups do not qualify |
| Source | Public GitHub, GitLab or Bitbucket repository with all required code/assets/instructions and a detectable open-source license |
| Video | Public YouTube URL, under three minutes, showing the app functioning on its intended device; use permitted material |
| Language | English materials or English translations |
| Access duration | Free testing access through judging, ending December 15, 2026, 08:00 Pacific (`16:00Z`) |
| Human facts | Eligible participants, authorized team representative and required ownership/integration rights |

Plan: finish features November 8, record by November 10 and submit November 11.
The live submission form and authorized-account state remain uninspected.

## Source and license

The Git origin names <https://github.com/luquibotbol/sellwant>. Local
`LICENSE` is MIT, copyright 2025 Lucas Botbol. Read-only GitHub connector
`get_repo` and `fetch_file(LICENSE, ref=63d4c63)` both returned 404. A public-web
fetch yielded a cache miss. A subsequent authenticated `gh api
repos/luquibotbol/sellwant` resolved visibility: `private:true`,
`visibility:private`, default branch `main`, detected license `MIT`.
Anonymous HTTPS GET returned 404. The connected GitHub CLI identity has
pull/push permission and no admin permission. No repository settings or remote
files were changed.

Before entry, an authorized owner/admin must arrange public source publication.
Then obtain an anonymous successful repository/license read, pin a published
release SHA and confirm that it includes the final runnable work. Do not expose
private schema exports or silently change repository visibility.

## Email discovery and receipt gate

Only local names/presence were inspected; no secret values were printed.

| Configuration surface | Observed |
| --- | --- |
| App `.env`, `.env.local`, `.dev.vars` | Absent |
| `.env.paypal-sandbox`, `.env.llm` | Mode 0600; PayPal/OpenAI names only |
| Standard Wrangler credential files | Absent at `~/.wrangler/config/default.toml`, `~/.config/.wrangler/config/default.toml`, `~/Library/Preferences/.wrangler/config/default.toml` |
| Relevant process variables | No mail sender/key/recipient or Cloudflare token/account variables configured |
| Connected services | No mail, Resend or Cloudflare connector available |
| Checked-in Worker configuration | Production `sellwant.com` routes and production Supabase target; no isolated host configuration |

Worker `mailConfig` needs `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`RESEND_API_KEY`, `MAIL_FROM` and `UNSUB_SECRET`; `MAIL_ORIGIN` can bind links to
the isolated app. Its `sent` counter/`mark_email_sent` records HTTP acceptance,
not observed receipt. It does not retain the Resend response ID.

The [Resend send API](https://resend.com/docs/api-reference/emails/send-email)
returns a message ID. Its idempotency keys expire after 24 hours.
[Resend events](https://resend.com/docs/webhooks/event-types) distinguish
`email.sent` (successful API request) from `email.delivered` (recipient mail
server delivery). Neither substitutes for seeing the matching message in the
authorized recipient's mailbox when claiming actual receipt.

Required inputs: an existing authorized nonproduction sender/API key, exactly
one authorized recipient, and access to that recipient's test inbox or a human
receipt confirmation. No address is inferred from Git, PayPal or account files.
Do not reuse the production sender/key implicitly.

Proposed private file, after inputs exist: `sellwant/.env.email-sandbox`, mode
0600, already covered by `.env.*` ignore rules. Proposed names:
`RESEND_API_KEY`, `MAIL_FROM`, `MAIL_ORIGIN`, `SELLWANT_EMAIL_TEST_TO`.
The last name would be a new proof-harness allowlist input; the existing Worker
does not enforce it. Do not load this file into the general scheduler until an
exact-recipient guard and owned-row selection exist. Do not change demo Auth
emails to real addresses merely to drain a queue.

Verification sequence once configured:

1. Manager confirms the fixed isolated database and owned notification row,
   with only the authorized recipient eligible; unrelated rows remain untouched.
2. Preserve one row/request ID and exact rendered payload before sending.
   Record provider acceptance ID/time separately from delivery evidence.
3. Read provider status for that same message, then inspect the authorized
   inbox for the exact unique subject/body marker and record receipt time.
4. Verify the app link opens only the isolated origin and requires the intended
   account; keep recipient details, tokens and raw message private.
5. Repeat the owned operation within provider deduplication limits and verify
   one recipient message. An unknown response requires reconciliation first.

No email was sent; acceptance, delivery and receipt are all unverified.

## Hosting and complete setup

`wrangler.jsonc` and the existing deployment workflow point to production and
must not be used. The guarded runtime publishes only
`http://127.0.0.1:8788`, with local Supabase at `127.0.0.1:55321` and database
port `55322`. No authorized isolated hosted demo URL was discovered. A local
URL on this workstation does not provide remote judge access.

Current `schema-baseline-local.py::source()` requires two ignored private CSV
exports. Therefore the existing setup is not a complete public-checkout path.
`restore_sql()` can generate app DDL and the listing-photo bucket without
application rows; function bodies/defaults/ACL roles still need a privacy and
portability review before a public app baseline is written. No such export was
published by this role.

Manager path: create a reviewed canonical app-only baseline as source; exclude
private CSVs, account identifiers and application rows; preserve RLS, grants,
triggers and base RPC contracts. Bootstrap a genuinely fresh isolated Supabase
service from the public source, apply the documented baseline and ordered
001–004, outbox, 005–007 migrations, then seed disposable accounts. Existing
schema replay clones current platform schemas/shared roles and explicitly
does not establish that fresh-service bootstrap.

## Judge instructions to verify

These are a test itinerary, not a claim that public setup is complete.

1. Start from the final public release SHA with its complete bootstrap; supply
   dedicated server-side OpenAI and PayPal sandbox configuration through the
   documented private paths. No production or database-admin credentials belong
   in the browser or public submission.
2. Use separate clean browser sessions and disposable buyer/seller accounts;
   keep any required judge-only credentials in the approved testing field.
3. Discover the active synthetic ticket; request AI drafts; personally approve
   both users' exact limits and watcher enrollment. Observe public negotiation
   and the one locked price.
4. Close the interactive browser, reopen it and verify the persisted action;
   use independently recorded runtime evidence for scheduler continuity.
5. Buyer personally approves sandbox checkout; verify authorization; each user
   personally confirms the simulated handoff; request and verify capture.
6. Use the separate cancellation scenario for verified void/listing recovery.
   Review expiry/unknown-outcome evidence without inducing a new financial
   operation merely to match a video.
7. Open an outsider session and confirm private mandates/payment/activity are
   inaccessible. No administrator login or browser cache may supply access.

Browser worker owns this verification. Current result: not run. A developer
fixture login or HTTP 200 alone cannot establish judge usability.

## Exact human gates

| Gate | Required item / destination |
| --- | --- |
| Email | Authorized nonproduction sender/key in the private file above; one explicit recipient and receipt access |
| Submission account | Authorized signed-in account at <https://paypalaihackathon.devpost.com/>; inspect joined/draft state without accepting rules on the person's behalf |
| Team declarations | Names, eligible participant facts, representative authority, ownership and third-party permissions supplied by the human |
| Payment | Buyer checkout approval and each participant's separate test-handoff attestation, at the app/provider screens prepared by the other roles |
| Video | Genuine complete footage, human final review and authorized YouTube account for public publication |
| Source/access | Owner/admin-approved public source publication (current repository is private; connected identity lacks admin), anonymous source/license verification and a complete tested setup or authorized isolated hosted demo |

The user authorized final submission after these human facts are supplied.
No new broad permission request is needed; no missing attestation is inferred.
