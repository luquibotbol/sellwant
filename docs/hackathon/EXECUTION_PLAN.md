# SellWant × PayPal execution plan

Authoritative tracker. Started October 28, updated November 5, 2026. Branch `hackathon/paypal-ai-2026`; baseline `618a3a01`. [Verified baseline and setup](BASELINE.md).

User's current request authorizes milestone implementation. Work one coherent milestone at a time. No production deployment, data modification or main push/merge. Preserve existing marketplace behavior. A milestone requiring a real external integration is incomplete until that integration is demonstrated.

## Scope and schedule

| Milestone | Target | Codex engineering estimate | Human setup/review, excluding waiting | Deliverable / checkpoint |
|---|---|---|---|---|
| M0 audit/baseline | Oct 29 (done) | 3–5 hours | 15–30 minutes | Architecture, baseline checks, official tooling research and this plan |
| M1 payment feasibility | Nov 4 (revised) | 1–2 working days | 30–60 minutes sandbox setup and two buyer approvals | Isolated real create → approve → authorize → handoff → capture, plus independent authorize → void; verified exact receiver/price |
| M2 persistent authorized trading | Nov 5 (revised) | 2–3 days | 30–60 minutes schema recovery/dev DB setup | Human-approved mandates, persistent public negotiation, atomic deal lock, authenticated product MCP |
| M3 useful AI and completed journey | Nov 8 | 3–4 days | 30–60 minutes provider/mail/demo review | LLM drafts reviewed mandates/proposes negotiation; durable watcher; integrated sandbox payment/handoff/cancel; outbox notifications |
| M4 hardening and submission | Nov 11 | 2–3 days | 1–2 hours demo recording, account/judge access and submission | Two-user browser journey and void path, failure/concurrency hardening, video by Nov 10, submit Nov 11 |

Feature freeze November 8. Official deadline November 12 at noon PST / 20:00 UTC; contingency only. [Official rules](https://paypalaihackathon.devpost.com/rules). Account-access waiting is separate from engineering estimates and can consume the schedule; escalate genuine access blockers early.

November 3 replan: original M1/M2 targets were missed while access was unavailable. Revised dates require sandbox credentials and readable schema by November 4 and remain at risk until verified. Continue schema work independently of buyer approval; retain the core mandate/payment/handoff journey and defer the optional items below.

November 5 direction: user permits parallel subagents for independent work and does not want schedule concerns to interrupt implementation. Dates above remain planning targets; continue testable milestones. Parallel work cannot replace human mandate/payment/handoff approval or missing account access. Schema and deal-boundary reviews ran independently during local setup; one owner coordinates core SQL changes.

**Must have:** one approved buy/sell mandate each, public bounded offers, persistent lock, actual AI reasoning visible as proposals, sandbox buyer approval/authorization, physical handoff attestation, verified capture, cancellation/void/unlock, access/privacy tests, runnable demonstration.

**Useful if time:** scheduled approved bounds, richer meetup/reminder controls, webhook reconciliation beyond polling, broader seller onboarding and saved-search UI.

**Deferred:** generic multi-agent framework, five independent LLM services, new marketplace idea, external scraping, ratings/callouts, raw ticket delivery, broad UI redesign, dashboards/search sponsors, production payments. Scheduled minimum changes require explicit human approval of the whole schedule, never LLM invention; defer from minimum submission.

## Design and boundaries

### Mandates and human approval

Add `agent_mandates`: UUID, owner, side buy/sell, concrete listing/event scope, `bound_cents` integer, currency (USD first), expiry, max rounds, status, immutable approved version/hash, approved_at/approved_by, revoked_at, rounds_used. A structured draft is not authority. User edits then approves through an authenticated human UI endpoint; external agent token cannot invoke approval or manufacture `approved_by`. Changed scope/price/expiry/round limit requires a new approval. Each mandate is one ticket/one deal for the minimum demo.

Seller mandates must refer to their owned listing; buyer scope pins the intended listing or an explicitly reviewed event identity. Do not match fuzzy titles as though they identify the same event. Validate ownership, suspension, active listing, currency, safe integer price, expiry, revocation, rounds and opposite-party identity in the transaction that posts/accepts. Lock mandates in UUID order, then listing/offer in a consistent order. Partial unique active-deal constraint is a backstop. Do not rely on JS or LLM checks for authorization.

`mandate_actions` stores actor, proposal, sanitized explanation, validation outcome, public offer/deal ID, operation key, timestamps and model identifier. Unique `(mandate_id, operation_key)` prevents repeated watcher jobs consuming rounds or duplicating offers. Store approved private bounds separately from public offers. No self-trading, spoofed user IDs or product MCP service-role credentials.

### Product MCP and persistence

Inspect Lucas's prototype before deciding its adaptation. Reported tools are unverified: `search_listings`, `get_going_rate`, `get_deal`, `create_mandate`, `place_offer`, `auto_trade`, `advance_deal`, `revoke_mandate`, `draft_paypal_order`. In-memory offers/deals, if confirmed, must become database operations. A draft payment tool must never claim payment happened.

Proposed Worker `/mcp`: official SDK Streamable HTTP, stateless transport with database persistence. Register route before static assets. [Cloudflare remote MCP guidance](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/). No Durable Object/framework requirement merely to expose tools. Inspect library compatibility with Worker build before adding dependencies.

Use narrow, random, hashed-at-rest agent capability tokens issued by signed-in humans, scoped to user/approved mandate/tool set, expiry and revocation. Validate every request and recheck mandate inside DB writes. Expose tool discovery/read-only active discovery, private participant `get_deal`, draft mandate requests, bounded offer/accept/revoke actions. Agents cannot approve a mandate, confirm physical handoff, authorize a PayPal buyer payment or capture funds directly. OAuth is an interoperability enhancement after scoped tokens; do not claim general OAuth discovery until implemented. Admin MCP and product MCP remain separate.

### Useful AI and durable watching

Want Agent = natural-language → strict schema draft → human review/approval. Negotiation Agent = LLM proposes offer/counter/accept with explanation using a sanitized active listing and public offer history; deterministic engine rejects unsafe/out-of-bounds/stale actions. Do not present midpoint arithmetic as AI reasoning. Treat listing prose as untrusted data, never instructions to tools.

No provider exists in this checkout. Reuse prototype provider if supplied; otherwise choose a supported provider only when project credentials/model are available. Configurable model and server-side key; schema refusal/invalid output/timeout means no action. Record proposal and reason without secrets/contacts/QRs.

Market Watcher = existing minute cron plus durable `agent_jobs`: next_run, lease_until, attempt count, dedupe key, last action. Bounded batches with `FOR UPDATE SKIP LOCKED`, lease expiry/retry, unique action keys. Running after Codex closes is an acceptance condition. Revalidate market immediately before writes; active-only discovery can be cached but acceptance cannot trust cache. Going rate is max open non-poster offer on sell / min on ask, null + explicit `no_offers` when empty. Query all eligible pages; current public feed's 200-item cap is not complete market coverage.

### Payments, handoff and recovery

Keep `lock_ins` and existing RPC contracts for manual deals. Add a payment association for sandbox deals with expected amount/currency/payee from the locked deal, not client input. Direct-merchant demo limits seller to configured sandbox merchant; arbitrary third-party payees need verified partner/onboarding arrangements.

Proposed `deal_payments`: unique deal, provider environment, expected merchant/currency/cents, unique order/authorization/capture IDs, persistent operation IDs, payment status, retry/reconciliation metadata. Separate `handoff_confirmed_at/by` and cancellation_requested_at from financial state. Statuses: approval_pending, authorized, capture_pending, captured, void_pending, voided, failed/reconciliation_required. Never map buyer redirect or handoff to captured.

Sequence: atomic locked price → backend creates AUTHORIZE order → buyer approves at PayPal → backend refetches/validates order and authorizes → participants arrange meetup → authenticated buyer confirms they scanned in together → backend captures exact authorized amount → verified COMPLETED capture marks financial completion. Seller's optional meetup acknowledgment is distinct. Existing legacy `paid` remains a claim; sandbox screen shows verified hold separately. Existing `advance_deal(...confirmed)` cannot bypass capture for a sandbox-linked deal; add an SQL guard/wrapper only after recovering the actual function. Explain/test both callers before changing contracts.

Each server action authenticates actor/role and verifies deal/order association, amount, currency, merchant and remote resource IDs. Use single full/final capture; no partial captures or automatic reauthorization for minimum demo. Stable request UUID per operation is persisted before network I/O. Ambiguous failures reconcile by GET before retry; never mint a new capture operation because a response was lost. A payment-side in-flight lease serializes capture vs cancellation.

Cancellation/timeout: reserve cancellation against capture, stop agent work, void uncaptured authorization, verify void, then cancel/unlock through existing deal mechanism. Unapproved orders need no void; late approval cannot activate a cancelled deal. Unknown void/capture outcome stays visibly pending reconciliation; do not reopen a listing while payment outcome is unknown. Captured payments cannot be voided; expose support/refund-required state, not false cancellation success. Preserve handoff attestation on failed capture and present recovery. Independent application deadline (e.g. 30-minute approval window and reviewed meetup deadline under 3 days) triggers durable cleanup; PayPal's own expiry is insufficient.

Webhook path if enabled: verify provider signature against configured sandbox webhook ID; persist event once, then acknowledge only after durable enqueue. Unsupported, forged, duplicate and out-of-order events cannot regress state. Refetch order/payment and use the same reconciliation path as browser callbacks and cron; events are notifications, not trusted payment amounts. Polling reconciliation remains necessary for interrupted callbacks. M1 adds signature verification client support; durable webhook ingestion belongs to integration milestones.

### Notifications and minimal screens

Reuse outbox/Resend; add typed offer/deal-locked, approval-needed, authorized, meetup-reminder, handoff, capture-failed/captured, cancel/timeout messages. Unique `(recipient, deal, kind, state_version)` keys, retry leases, narrow payloads; keep existing offer preferences and distinguish essential transactional updates. Dev links derive from isolated app origin, not hard-coded production `SITE`.

Minimal UI: listing/want mandate draft/review/approve and revoke, private activity log, existing offers board with agent attribution, deal payment status/approval action, meetup details, human scanned-in confirmation, cancel/recovery. Labels distinguish claims, holds, handoff, pending capture, captured and failed payment. Never claim ticket authenticity or escrow. Update zero-fee/approval-per-offer copy in sandbox-enabled surfaces before demo, keeping manual marketplace accurate.

## M1 — payment feasibility

**Existing → new:** paypal.me link and buyer's unsupported claim → isolated server-side sandbox adapter and resumable test harness. Example: synthetic buyer approves $16.65 to configured synthetic seller; authorization is a hold; capture requires explicit local test handoff attestation. Separate order demonstrates void.

**Implementation sequence/files:** native-fetch `worker/paypal.ts` with strict USD/cents/resource checks, OAuth caching, bounded retries, persisted caller-supplied request IDs, signature verification; `scripts/paypal-sandbox.ts` with private on-disk operation journal/lock; focused mock-transport failure tests; offline test runner; sandbox env example; repo instructions and tool config examples. Keep it outside frontend imports and production routes. No base schema dependency for isolated proof.

**Dependency/ownership:** Codex owns adapter/harness/tests. User supplies sandbox app, merchant and buyer access. Lucas confirms seller/partner route and provides schema/prototype independently. M1 must not be marked verified solely from mock transports.

**Acceptance:** two actual orders; exact immutable cents/USD/deal/payee; separate buyer approval; server authorization; no capture before handoff; one verified capture; one verified void; repeat commands cannot duplicate side effects; wrong order/payee/amount/currency fail closed; lost response and concurrent local invocation covered; secrets excluded from output/git. Journal survives process exit. Capture status checked with GET, not redirect.

**Try:** follow the M1 runbook below. **Done gate:** record sanitized provider IDs/status evidence and buyer browser approval for both paths. **Risk/cut:** account/seller gating; restrict to one configured sandbox seller. Do not substitute invoice payment without acknowledging altered handoff sequence. Disable/remove isolated harness to roll back; existing marketplace unchanged.

## M2 — authorized persistent trading

**Existing → new:** people manually post/accept public offers → approved buyer max $18 and seller min $15 allow public agent offers/deal within $15–18 without repeated human approvals. $16.65 is illustrative, never hard-coded.

**Sequence:** recover schema and prototype → isolated database reproducibility → additive mandate/action/token/job/payment-association schema and RLS → human draft/approve/revoke API → transactional offer/accept validation reusing existing deal mechanism → product MCP tools → minimal review/activity UI. Likely `services/data.ts`, new `worker/agent-*` modules, `/mcp` router, migrations, `app/event/[id].tsx` and small mandate screen/component. SQL stays reviewable files; owner applies to isolated database under repo workflow.

**Ownership:** Codex schema/RPC/auth checks; Lucas prototype compatibility and any parallel MCP client work only against agreed tool/schema contracts. Avoid simultaneous edits to core RPCs; treat schema export as integration baseline.

**Acceptance/tests:** human-only approval, ownership/role/outsider/anon tests, 1799 vs 1800 vs 1801 buy bounds, seller floor, decimals/invalid currency, revocation/expiry checked at commit, round budget, no self-trade, cross-listing parents rejected, two simultaneous acceptances produce one deal, duplicate operation consumes one round. Both manual buy-now and manual offer acceptance remain functional. Restart MCP and read same mandates/deals. Private bounds/contacts/completed prices absent from anonymous/MCP discovery.

**Try:** synthetic buyer/seller review and approve mandates; connect scoped agent token; list tools, post/counter/accept; revoke then prove rejected action. **Done:** isolated DB tests and browser approval checks pass. **Next:** actual LLM and deployed watcher. **Rollback:** disable agent routes/jobs, keep additive tables; no rewriting existing marketplace. Cut scheduled bounds and general OAuth, not approval or transaction checks.

## M3 — AI, watching, payment and handoff

**Existing → new:** no AI/runtime watcher; offer-only emails → user instruction becomes reviewed mandate, real model proposes public negotiation, cron acts within limits, locked deal reaches real sandbox hold, human meetup/handoff releases capture. No active Codex session needed.

**Sequence:** prototype provider/schema adapter → prompt-injection-resistant proposal generation → leased scheduled matcher → action activity UI → authenticated payment endpoints binding adapter to deal → split financial/handoff UI and legacy RPC bypass guard → transactional outbox events → timeout/void/reopen reconciliation. Files: Worker entrypoint/new runtime modules, data seam, existing deal page/handoff helper, new additive migrations and isolated Wrangler config. Reuse existing UI primitives; no redesign.

**Ownership/dependencies:** provider access, isolated DB/Worker deployment, sandbox credentials and dev sender supplied by owners. Codex connects/test boundaries; Lucas reviews actual negotiated behavior/demo event identity. Account waiting is not coding progress.

**Acceptance/tests:** genuine model-generated draft and negotiation proposal visible; malformed/refused/out-of-bound output produces no write; zero-offer rate stays empty; cron after session restart acts once; repeated jobs/email events dedupe. Buyer max $18/seller min $15 reaches a valid deal; buyer approves exact order; unauthorized actors cannot create/authorize/capture/handoff; physical confirmation precedes capture; provider failure shows pending/failure; cancel/timeout voids and recovers listing; manual deals retain honest claim labels.

**Try:** two synthetic signed-in sessions and one shared synthetic event, enter natural-language limits, approve, close client, wait for deployed cron, then approve PayPal and confirm scan-in; repeat with cancellation. **Done:** full journey and cancellation witnessed. **Next:** hardening/submission. **Rollback:** dev feature switch and stop watcher; drain/reconcile existing holds before cancelling tests. Cut reminders/rich meetup fields before cutting actual AI or verified payment.

## M4 — reliability and submission

**Sequence:** two-browser buyer/seller automated journey → concurrency/payment retry/event fault injection → anonymous/privacy checks and stale-cache behavior → secret scan/dependency review → reproducible seed/setup and licensed source → under-3-minute public demo video → submission Nov 11. Add browser fixtures only against dev database and sandbox, never existing production fixture suite by default.

**Acceptance:** one real authorize/capture and one cancel/void browser flow; user/agent attempts to bypass roles denied; parallel lock/cancel/capture safe; duplicate/out-of-order webhook and lost callback converge; expired watcher cannot trade; failed notification doesn't fail deal. Record exact commands/results; distinguish mocks from remote evidence. Review license/assets and public source visibility, judge demo access through judging, English instructions and no secrets. Necessary submission only; cut sponsor extras.

**Try:** clean checkout + documented commands + synthetic seed, or isolated hosted demo with judge access instructions. **Done:** functional build, evidence/video/source links, completed submission; no main deployment implied. **Rollback:** restore prior hackathon build/config, keep payment reconciliation available. Submission/publishing requiring account login stays owner action until access is provided.

## Progress tracker

States: planned = design only; implemented = code exists; verified = stated checks actually passed; blocked = exact external dependency prevents the named gate.

| Work | State | Evidence / remaining gate |
|---|---|---|
| M0 repo audit and branch | Verified | Baseline commit, isolated branch, existing untracked brief preserved |
| M0 tooling and deadline research | Verified documentation | Official URLs/setup matrix; Codex local subcommands checked; no new account connection claimed |
| M0 local baseline | Verified with limits | 87 offline tests, normalization/PNG checks, typecheck and placeholder web build pass; DB/browser/payment not run |
| M1 adapter, harness and local safety checks | Verified locally; external gate still blocked | Server-only sandbox adapter, private resumable journal/lock, CLI; 33 payment tests, 120 total offline tests; pinned Bun 1.3.14 passes; typecheck/build evidence below |
| M1 actual sandbox authorize/capture/void | Partially verified; fresh buyer approvals required | Real OAuth, two $16.65 AUTHORIZE orders and exact amount/USD/payee/deal checks passed November 4. Both then required payer action. The capture-case order GET returned 404 on November 5; the second order was not reread in that failed sequence. No authorization/capture/void occurred. Create fresh orders when the buyer is ready; human approval and simulated test handoff remain required |
| M2 database/prototype integration | Schema input recovered; local restoration next | User supplied `Supabase Snippet Untitled query (1).csv`: all 17 expected sections parse, including column/sequence ACLs, ownership, signup trigger/storage metadata and exact bigint maximum. Source PostgreSQL 17.6; local 17.11. Restore/compare the isolated baseline and test permissions next; mandate persistence remains unimplemented. Prototype source is still missing for the later MCP adaptation step. Existing discovery checks pass; no new Supabase plugin/browser access is needed to ingest these files |
| M3 AI/watcher/notifications/full handoff | Planned; market input foundation implemented | Public cursor discovery and bounded market reader verified offline. No actual LLM, durable watcher, notification extension or integrated financial/handoff journey yet; follows M2 and provider/dev service access |
| M4 hardened demo/submission | Planned | End-to-end/concurrency/privacy checks, reproducible demo, video and submission remain; dates are planning targets, not a reason to stop implementation |

## M1 runbook and milestone evidence

**What existed:** manual payment links and buyer claims; no API integration. **What changed:** sandbox Orders/Payments adapter, exact amount/payee/deal checks, OAuth cache, bounded retries with durable operation IDs, verified status reads, local process lock, human test handoff gate, signature verification client, safe offline CI. **Expected behavior:** buyer approval produces an authorization/hold; only the explicit test handoff enables capture; a second authorization can be voided; restarting/repeating commands reconciles the same resources. Existing marketplace screens and production Worker routes are unchanged.

**Verification environment:** original checkout has recurring iCloud file evictions/read stalls. Final verification runs in `/private/tmp/sellwant-verify-20261029`, fetched at `618a3a01` with byte-identical task changes. This is a verification checkout, not a replacement project or a production deployment.

| Check | Actual result, October 29 |
|---|---|
| Frozen install | Passed in stable verification checkout; no lockfile change |
| `bun run typecheck` | Passed after correcting new TypeScript errors found by the first stable run |
| Offline suite with pinned CI Bun 1.3.14 | Passed: 120 tests across 16 files, 0 failures, 420 assertions; includes 33 payment/session/CLI cases. Invoked the temporary 1.3.14 binary directly so nested tests use that runtime |
| `bun run test:paypal` with installed Bun 1.4.3 | Passed: 33 payment/session/CLI cases, 0 failures |
| `bun scripts/test-normalise.ts`, QR generation and `test-decode.ts` | Passed: 13 normalization/mask + 5 PNG/hash checks |
| Web export with local placeholder config | Passed: 21 static routes, entry 1.42 MB, lazy jsQR 130 kB; runtime DB not tested |
| CLI no-credentials smoke | Expected rejection: `PAYPAL_ENVIRONMENT must be SANDBOX`; no provider call |
| Bundle and setup checks | Server/test PayPal markers absent from both frontend bundles; optional MCP TOML parses with all account tools disabled; Git diff whitespace check passed |
| Real sandbox buyer approval/authorize/capture/void | NOT RUN; blocked on app/merchant/buyer access |
| Actual database/RLS, browser buyer/seller, deployed webhook/email, hosted Linux GitHub Actions | NOT RUN; not claimed passing |

The first cloud-backed post-change suite hit a QR file-read timeout; another saw empty Worker exports. Those failures were resolved for verification by using the stable exact-commit checkout, not by weakening assertions or extending timeouts. Focused provider tests use mocks and cannot prove account eligibility, API response compatibility or money movement.

All 17 task files were compared byte for byte with the stable verified checkout. The original branch diff contains only the three intended modifications plus the new milestone files; the user's brief remains untracked and preserved. No push or merge was performed.

### October 29 follow-up: provider response compatibility

**Existing M1 behavior:** capture tried to verify the POST response as a complete payment resource. PayPal's official examples omit `supplementary_data` from capture POST responses, including the full-representation example, so a legitimate capture could be rejected after funds had moved. [Payments v2 specification](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/payments_payment_v2.json).

**Changed:** the adapter requires a durable capture-ID recorder, saves the receipt ID first, then fetches the capture by ID to verify amount, currency, order, authorization, final-capture flag and status. The session stays `capture_pending` until verification succeeds. Later status/retry can recover by that ID even when the order response has no capture list; no second capture is issued. Replaced overly complete POST fixtures with the documented minimal shape and added verification/read-failure regression cases.

**Verified:** typecheck; 33 focused tests on Bun 1.4.3; all 120 offline tests plus 13 normalization/mask and 5 decode/hash checks on exact Bun 1.3.14, in the stable checkout. The changed server module has no frontend imports or dependency changes; the prior web export remains packaging evidence. Real PayPal calls are still untested.

**Access recheck:** no local credentials, no relevant populated environment names, no Supabase/PayPal development connector available, and no accessible prototype found through connected GitHub search or expected local paths. SQL history supplies no base schema. M1 still requires actual sandbox accounts; M2 still requires schema/dev access and prototype source. The active goal is not complete.

### November 3 access and setup update

**Existing:** Lucas's Supabase grant was previously unavailable to the user; this agent session had no database connection. **Changed:** user reports the grant is now available and can set up their own PayPal sandbox app. Supabase plugin discovery confirms it is available but not installed/connected; connecting it is the remaining account handoff before schema inspection. Inspect schema read-only first; account access alone does not verify database/RLS behavior or authorize production changes.

Prepared `sellwant/.env.paypal-sandbox` from the example with empty values, mode 0600, and confirmed Git ignores it. User fills client ID, client secret and merchant ID locally, retaining `PAYPAL_ENVIRONMENT=SANDBOX`. No credentials or real transactions were available during this update. No product code changed; prior passing code checks remain the evidence above.

**Quick PayPal setup:** use [Apps & Credentials](https://developer.paypal.com/api/rest/) in Sandbox mode; select/create a merchant app tied to a Business sandbox seller. Keep a separate Personal sandbox buyer from [Sandbox Accounts](https://developer.paypal.com/sandbox-testing/accounts). Find the seller's merchant ID by signing into `sandbox.paypal.com` as that Business account, then Account Settings → Business information → PayPal Merchant ID ([official instructions](https://developer.paypal.com/docs/multiparty/seller-onboarding/build-onboarding/)). Follow the existing runbook below after filling the local file. Lucas's PayPal account is not required for this isolated proof; arbitrary marketplace seller onboarding remains unverified.

Optional provisioning check could not inspect the Stripe Projects catalog because its CLI login has expired; no service was provisioned and no unrelated account login is required for the direct PayPal setup above.

### November 4 credential preparation

User confirmed sandbox seller/buyer accounts and supplied a client ID. Saved it in the private ignored env file; retained empty client-secret and merchant-ID fields for the user to fill locally. The supplied merchant-ID value contained password-like punctuation and was not saved as an ID. Account login passwords belong in the user's password manager and are not required by the server API. Verified file permissions 0600, Git exclusion and the two remaining empty fields; no provider calls or production writes occurred.

Supabase plugin discovery now confirms installation. User reports the connection is complete; actual database access remains unverified because no Supabase tools are exposed in this session yet. This supersedes the earlier uninstalled state; do not ask the user to install it again.

### November 4 real sandbox order checkpoint

**Existing:** local adapter/session tests passed but no provider credentials had been exercised. **Changed:** user filled all four local configuration fields. The local check passed; real OAuth and two order-create requests succeeded. Both orders were independently fetched and passed strict expected deal, amount, USD, AUTHORIZE intent and seller merchant checks. Repeating create on the first journal returned the same order ID rather than creating another. Private credentials and operation journals remain Git-ignored; credential file mode is 0600.

| Synthetic case | Provider order ID | Exact amount | Last verified provider status |
|---|---|---|---|
| `demo-capture-20261104-01` | `51V273657C331094L` | 1665 cents USD | `PAYER_ACTION_REQUIRED` |
| `demo-void-20261104-01` | `6TM7967596914393U` | 1665 cents USD | `PAYER_ACTION_REQUIRED` |

**Verified checks in the original checkout:** `bun run typecheck`; 120 offline tests, 0 failures, 420 assertions on installed Bun 1.4.3; 33 focused PayPal tests, 0 failures. An actual capture command before test handoff was rejected locally as expected. This supplements the earlier pinned Bun 1.3.14 evidence; hosted CI and product browser/database tests remain unrun.

Initial restricted-network OAuth and local callback binding attempts failed; approved host-network runs succeeded. Read-only callback is listening on `127.0.0.1:8789`. No authorization, capture or void has occurred. Buyer approval links were provided to the user; the separate Personal sandbox buyer must approve each order. A human must then confirm a simulated handoff for the isolated capture proof. Do not mark M1 complete until authorization/capture and authorization/void are actually verified. Do not interpret the callback as financial completion.

**Supabase recheck:** no callable Supabase tools are available in this session and local Codex has zero Supabase servers. A focused browser visit to the existing hosted project reached the sign-in page. The user's account grant/setup report is retained, but schema access has not been demonstrated. No production queries or writes occurred.

### November 4 schema recovery checkpoint

**Access verified:** the existing signed-in Brave profile can open the configured hosted project (dashboard name `sellup`, reference matches the app). A public REST-schema request returned HTTP 401; no API schema was recovered that way. Browser SQL Editor successfully ran a SELECT against `pg_catalog.pg_proc`/`pg_namespace` using built-in definition readers only. No application RPC or production data mutation was executed. SQL Editor automatically created a private query snippet.

**Recovered:** 56 public function definitions, including `accept_offer(p_offer_id uuid) RETURNS uuid` and `advance_deal(p_lock_in_id uuid, p_to text) RETURNS lock_ins`. The CSV is saved in the project root as `Supabase Snippet Untitled query.csv`, with an identical working copy at `sellwant/.local/schema/live-public-functions-20261104.csv`. Verified all 56 rows and both RPCs, byte-identical copies, mode 0600 and Git exclusion. The export includes extension functions and is not a complete runnable database baseline.

`accept_offer` checks open offer, listing owner and active listing, locks the listing, inserts the lock-in and relies on a trigger for other-offer/listing transitions. `advance_deal` locks the deal, checks participant roles and restricts paid/confirmed transitions to the buyer; its legacy paid/confirmed states do not verify PayPal. Recover the referenced triggers, table definitions, grants and RLS before changing these contracts or creating the sandbox payment association.

**Remaining recovery:** table/enum/constraint/index/trigger/policy/grant metadata and extension ownership. Isolated database is not ready: the Docker client exists but its initial server check could not connect to a daemon. Supabase account access is no longer the schema-inspection blocker; do not ask the user to reinstall or re-grant it based solely on absent agent tools. PayPal orders still awaited buyer action at the latest provider read; the user's instruction to continue did not change those provider statuses.

### November 5 local database and parallel review checkpoint

**What existed:** exported functions and incremental migrations, but no reproducible base schema or running local database. **Changed:** pinned Supabase CLI 3.0.0 in the app's dev dependencies; added local start/stop/status scripts and `supabase/config.toml` for project `sellwant-paypal-ai-2026`. API uses 55321, PostgreSQL 55322 and local mail 55324. No hosted project is linked. Automatic migrations/seeds are disabled because the checked-in patches lack the base schema and have duplicate date versions. Optional Studio, postgres-meta, analytics and Edge Runtime are excluded/disabled.

Docker's initial startup failed because the VM disk was full. Removed only this task's unused Studio/postgres-meta images, then trimmed unused build cache with `docker builder prune --force --keep-storage 15GB`; no other application images, containers or volumes were removed. A subsequent filesystem check showed 3.2 GB available. Retried startup successfully: database, auth, gateway, storage, realtime and local mail report healthy; REST is running. PostgreSQL reports 17.11. Public application tables are still absent: this proves local infrastructure, not schema recovery or product integration.

**Recovered metadata:** private project-root `SellWant Schema Metadata 20261104.csv` contains 12 sections: 11 tables, 83 columns, 52 constraints, 31 indexes, six triggers and 24 policies. All exported tables enable RLS; enforcement has not been tested. The 56 functions include 25 application routines and 31 extension-owned pg_trgm routines. Install the extension rather than replaying its routines. Browser JSON conversion rounded a bigint sequence maximum beyond int64 range, and the snapshot lacks column grants, sequence grants/ownership, auth signup trigger, storage configuration and exact hosted version. Do not restore from this incomplete snapshot or infer the missing values.

`scripts/inspect-schema.sql` now exports 17 sections, returning JSON as text to preserve integer precision. It includes the missing ACL/dependency/version fields, app-owned auth.users triggers, storage policies and only listing-photos bucket configuration (no object contents). The full query passed against local PostgreSQL with `default_transaction_read_only=on`; all sections parse. It has not yet run against the hosted project. Existing schema CSVs stay mode 0600 and Git-ignored in the project directory. Browser control was explicitly stopped, so exact hosted recovery requires it to be re-enabled or a manually downloaded result of this query; no cookie/token workaround is used.

**Checks:** frozen lockfile install (1,017 packages), typecheck and 120 offline tests/420 assertions passed in the stable copy `/private/tmp/sellwant-recovery-20261104/source/sellwant`, built from current HEAD plus current package/lock/config/query changes. The earlier October verification directory no longer exists. Local startup/status, container health, read-only query parsing and Git whitespace checks passed. Shared-database tests, baseline restore, browser journeys, live capture/void, LLM and notifications remain unverified.

**Parallel source review:** existing direct buy-now accepts client price/state without equivalent policy checks; offer acceptance rejects cancelled deal history despite listing reopening; offer status is read before acquiring the listing lock. `cancel_listing` has PUBLIC execution and a nullable ownership comparison without an explicit null-UID rejection. These are source-level defects/risks, not hosted exploit tests. Reproduce only after isolated baseline recovery, then fix and test alongside role checks, cancellation/reaccept, concurrency and sandbox bypass guards. Keep existing manual callers compatible.

**Next gate:** export exact hosted metadata, restore/compare the isolated baseline and test its permissions before modifying core RPCs. Lucas's prototype source/commit and LLM provider remain unavailable. M1 still needs fresh human buyer approvals and actual authorization/capture/void; M2–M4 remain unfinished. Parallel review does not mark these milestones complete.

### November 5 discovery foundation checkpoint (M2/M3 preparation)

**Existing → changed:** `/api/listings.json` silently stopped at 200 listings, exposed only dollar amounts and returned a successful empty list on database/configuration failure. It now supports validated opaque cursors and `limit=1..200`, ordered by exact `created_at` microseconds then UUID. Existing response fields remain; integer `price_cents`, `going_rate_cents`, USD and explicit `available`/`no_offers` status are additive. Anonymous active-only reads and a public field whitelist exclude owner/contact/ticket/deal fields. JSON errors are honest 400/503 responses; JSON discovery is `no-store`. SEO fallback behavior is unchanged.

PostgREST can return fewer rows than requested. The route requests `count=exact`, validates `Content-Range`, and continues even when a server row cap produces a short page; it never infers exhaustion from page length alone. This follows the [official pagination/count contract](https://docs.postgrest.org/en/stable/references/api/pagination_count.html). Cursor filters use [documented logical operators](https://docs.postgrest.org/en/stable/references/api/tables_views.html#logical-operators) and [quoted reserved characters](https://docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters).

`worker/market.ts` adds a read-only bounded consumer for the future watcher/MCP. Page-budget exhaustion returns `complete: false` plus a continuation; a failed batch returns its original retry cursor, so restarting cannot skip discarded earlier rows. It rejects malformed money, duplicate rows/cursor cycles and untrusted continuation links. It forwards only public fields and integer cents. Listing prose remains untrusted data. Pagination is a sequence of fresh reads, not a market snapshot or authority to trade; future writes still require transactional mandate/listing revalidation.

**Verified:** 67 route cases plus 14 reader/in-process route cases pass offline; the whole offline suite passes 201 tests/761 assertions. Fixtures enumerate 450 listings under both 201-row and 75-row database caps, and the reader follows 501 listings. Typecheck passes after correcting one new test-fixture fetch signature. Wrangler 4.123.0 dry-run bundles the Worker (32.10 KiB, gzip 10.18 KiB) using a temporary config with no account/routes/bindings; no deployment occurred. All seven implementation/test/script/package files match the stable verification copy. This is not hosted database, deployed watcher or completed M2 evidence.

**Real local protocol check:** added `scripts/test-market-local.ts` and `bun run test:market:local`. It validates the Unix Docker context, exact isolated project/DB/container/network/image identities and local URI target; creates an owned random fixture schema and disposable PostgREST 16.5 container with a real 75-row cap; then drives the Worker route and reader over loopback HTTP. It verifies 501 active rows exactly once in seven pages, four resumable batches, tied/microsecond cursors, integer/no-offer fields, actual anonymous fixture RLS/write denial, invalid-cursor rejection before database access, and an actual REVOKE causing 503 rather than empty success. The first run failed before fixture creation on an internal-char concatenation in the catalog snapshot query; the explicit text cast fixed it. The subsequent full run exited 0. Ownership-checked cleanup removed the fixture container/schema; independent checks found zero fixture containers/schemas and zero public app tables. These synthetic tables are protocol fixtures, not the recovered marketplace baseline; real core RLS/RPC tests remain blocked.

**Try from `sellwant/`:** `bun test --preload ./tests/offline-guard.ts tests/listings-api.test.ts tests/market.test.ts`. With the isolated local Supabase stack running, `bun run test:market:local` reproduces the real protocol check and cleans its own fixtures. In a development Worker running this branch, GET `/api/listings.json?limit=75` and follow `next_url`; errors remain distinguishable from zero inventory. The production endpoint has not been changed. Full schema recovery, approved mandate persistence, product MCP and actual AI remain the next product work.

**Current external gate:** browser control has remained stopped across repeated turns, and the exact hosted metadata needed for safe core work is still missing. Asked the user to re-enable the signed-in Brave session or export the canonical query to the project directory, and to provide Lucas's MCP prototype repository/archive plus commit/provider. No response grants browser control implicitly. M1 separately awaits fresh human sandbox buyer approvals. Independent discovery work is now implemented and checked; do not substitute additional disconnected mocks for these missing integration prerequisites.

### CSV supplied before session handoff

**The schema-export gate above is now cleared.** User downloaded `Supabase Snippet Untitled query (1).csv` into the project root. Validated CSV headers, all 17 expected/unique sections and JSON parsing with Python (not JavaScript number parsing). Counts: 11 relations, 83 columns, 52 constraints, 31 indexes, six triggers, 24 policies, 56 routine permissions, two sequences, six extensions, one schema ACL, six default ACLs, one database record, one app auth.users trigger, eight storage policies, two sequence ownership records and one listing-photo bucket. Column/sequence ACL fields are present. Bigint maximum is exactly 9223372036854775807; source reports PostgreSQL 17.6. Existing local PostgreSQL reports 17.11. The function definitions remain in the original `Supabase Snippet Untitled query.csv` (56 rows). The old `SellWant Schema Metadata 20261104.csv` is lossy and superseded; never restore from it.

Restricted the new export to mode 0600 and expanded the Git-ignore rule to cover numbered download filenames. No CSV data was committed. These validation checks prove the expected export content/precision, not a successful schema restoration. **Next action:** recover a faithful reproducible baseline from both current exports into isolated local Supabase, compare schema/ACLs and run role/concurrency tests before core fixes. Do not ask for another export or Supabase plugin installation unless ingestion reveals a concrete missing dependency. Browser control remains stopped and is unnecessary for this local step.

Lucas's MCP prototype and actual LLM provider/API access remain unresolved for later integration. They do not prevent local baseline recovery and mandate work. PayPal credentials already work; fresh buyer approvals are still required for two synthetic $16.65 sandbox cases: authorize then simulated handoff/capture, and independent authorize then void. Do not use old approval links, infer buyer approval from chat, or treat a callback as capture. Ask the human for a simulated handoff only after the capture-case authorization is verified. The user requested a new-session handoff; continue from these current facts, not older access-blocked paragraphs.

### Try the isolated proof

Run from `sellwant/`, preferably a fully downloaded checkout outside iCloud. Copy `.env.paypal-sandbox.example` to `.env.paypal-sandbox` and fill the four variables using the **synthetic seller's business sandbox app** and merchant ID. Keep the separate synthetic buyer login ready. No secrets in chat, Git or frontend variables.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run test:offline
bun --env-file=.env.paypal-sandbox run paypal:sandbox check
```

Start the read-only return page in a second terminal before buyer approval:

```sh
bun run paypal:sandbox callback
```

Capture path (fresh synthetic ID for each new experiment):

```sh
bun --env-file=.env.paypal-sandbox run paypal:sandbox create --deal-id demo-capture-001 --amount-cents 1665
```

Open the returned `buyerApprovalUrl`, sign in as the **separate sandbox buyer**, and approve. Returning to localhost is only a browser callback; it does not authorize or capture funds. Then:

```sh
bun --env-file=.env.paypal-sandbox run paypal:sandbox authorize --deal-id demo-capture-001
bun --env-file=.env.paypal-sandbox run paypal:sandbox handoff --deal-id demo-capture-001
bun --env-file=.env.paypal-sandbox run paypal:sandbox capture --deal-id demo-capture-001
bun --env-file=.env.paypal-sandbox run paypal:sandbox status --deal-id demo-capture-001
```

Expected final state: `captured`, exact 1665 cents/USD, provider order/authorization/capture IDs. `handoff` records only a local human TEST attestation; product-authenticated physical handoff is M3 work. Calling capture before handoff must reject without posting a capture. Confirm the same transaction in the sandbox dashboard.

Void path:

```sh
bun --env-file=.env.paypal-sandbox run paypal:sandbox create --deal-id demo-void-001 --amount-cents 1665
```

Approve this second order as buyer, then:

```sh
bun --env-file=.env.paypal-sandbox run paypal:sandbox authorize --deal-id demo-void-001
bun --env-file=.env.paypal-sandbox run paypal:sandbox void --deal-id demo-void-001
bun --env-file=.env.paypal-sandbox run paypal:sandbox status --deal-id demo-void-001
```

Expected state: `voided`, uncaptured. Repeat authorize/capture/status or void on the corresponding completed journals to demonstrate no second financial mutation. The harness caps synthetic amounts at $100; this is not a marketplace limit. Private journals are in `sellwant/.local/paypal-sandbox/`. Preserve them after errors. Unknown capture blocks void; use status/provider dashboard for reconciliation. Do not retry an unknown create beyond its 5-hour local safety window. A stale file lock after a killed process requires checking the provider outcome before manually removing that exact lock; never delete journals as cleanup.

**Remaining M1 gate:** sandbox API access is verified; obtain fresh human buyer approvals, run both real financial paths, and record sanitized IDs/statuses and the seller account model. M1 remains incomplete until then. M2 is underway at schema/local infrastructure preparation; exact schema recovery and Lucas's prototype are needed before adapting persistence/auth/RPC contracts.
