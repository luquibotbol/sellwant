# SellWant × PayPal execution plan

Authoritative tracker. Started October 28, updated November 5, 2026. Branch `hackathon/paypal-ai-2026`; baseline `618a3a01`. [Verified baseline and setup](BASELINE.md).

**Latest user clarification:** this repository is Lucas's handoff. No separate prototype repository is required; implement the missing product MCP here using the verified persistent trading boundaries. Earlier notes requesting a separate prototype are superseded. Private `sellwant/.env.llm` now exists (0600, Git-ignored). The user supplied an OpenAI key there; a read-only model-access request returned HTTP 200 and confirmed available candidates. Model selection/text generation and deployed secret configuration are not yet verified. The PayPal void checkout was approved, authorized and voided successfully; the capture checkout still awaits buyer approval and later explicit simulated handoff.

**Latest manager checkpoint, November 6 at 05:55 UTC:** real OpenAI drafting and an actual bounded acceptance proposal are verified. The existing outbox prerequisite and migrations `005`/`006`/`007` are applied only locally; 64 payment and 65 watcher SQL/REST/race checks pass. Ordered replay exactly matches all 66 app functions; typecheck and 291 offline tests pass. Runtime startup failed in two distinct approaches, triggering the handoff's required pause. The second failure is diagnosed: `git archive HEAD:sellwant` ran from the app subdirectory and returned an empty archive; a read-only repository-root comparison produces 185 files including `package.json`. All roles stopped and work/logs are preserved. No runtime, browser journey, human approval or integrated capture is claimed. Details below supersede the older funding pause.

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

The user clarified that this repository is Lucas's handoff. Implement product MCP here against the verified persistent database contract. Previously reported prototype tools remain unverified leads, not an extra repository dependency. Expose scoped read/offer/accept/revoke plus public active discovery; human approvals, payment and handoff transitions stay outside agent authority. A draft payment tool must never claim payment happened.

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
| M1 actual sandbox authorize/capture/void | Authorize/void verified; old capture order now unreadable | November 6 readback confirms authorization `14F6288189074490Y` VOIDED for 1665 cents/USD with no captures. Capture order `0M315443YG505872E` now returns HTTP 404 `INVALID_RESOURCE_ID`; its remote state is unverified and expired request key/journal are preserved. Buyer availability/disposition of this order gate fresh checkout. No handoff/capture is claimed |
| M2 database/prototype integration | Database and MCP verified locally; human browser journey incomplete | Existing 42 core, 65 mandate, 42 REST and 39 privacy checks pass. New capability context passes 55 real SQL/REST checks; official MCP client passes 26 real Worker/PostgREST groups including public offer discovery, counter/accept, restart/idempotency and revocation. All four migrations replay to 46 identical app definitions. Typecheck, 230 offline tests and isolated Worker dry-run pass. Human review UI remains disabled by default and browser-unverified; hosted MCP/client compatibility remains unverified. No separate Lucas repository is required |
| M3 AI/watcher/notifications/full handoff | Real model + local SQL verified; paused at runtime startup | Actual structured draft and correct 1665-cent acceptance proposal verified. Applied outbox +005/006/007; 129 independent payment/watcher checks and exact 66-function replay pass. UI/shared API/outbox/cron wiring exists. Durable service failed to start in two approaches; browser/human approval, real notifications and integrated payment/handoff remain unverified |
| M4 hardened demo/submission | Local reliability checks and demo setup verified; deliverables incomplete | Guarded repeatable setup produces three synthetic logins/two listings with private credentials; 291 offline tests and core/privacy/MCP regressions pass. Verification and submission narration drafts exist. Two-user browser journey, durable runtime proof, real capture, functional judge access, video and submission remain |

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

### November 5 restored baseline and authorization checkpoint

**Existing → changed:** exact private exports are now restored into isolated local Supabase. `scripts/schema-baseline-local.py` validates the private sources, rejects remote Docker contexts/hosted links/wrong project, restores an empty app schema transactionally, compares catalog metadata/function bodies and checks effective grants. Python preserves integer precision. All exported application objects/ACLs and 25 app definitions match. Source PostgreSQL is 17.6; local is 17.11. The three preinstalled platform extensions `pg_stat_statements`, `pgcrypto`, `uuid-ossp` have source owner `postgres` and local owner `supabase_admin`; their versions/schemas match. The explicit `--allow-local-extension-owners` flag acknowledges only these three differences. Strict comparison rejects them. No system catalog edits or source application rows were copied. Existing-schema restore is refused. Detailed comparison and generated SQL remain private/ignored; see `sellwant/scripts/SCHEMA_BASELINE.md`.

**Core fixes:** reproduced anonymous/no-UID authorization bypasses, forged one-cent/advanced-state buy-now, cancelled-history reacceptance failure and acceptance of a withdrawn offer against the faithful baseline. The recovered grants also exposed authenticated TRUNCATE privileges, which bypass RLS. `202611050001_core_trade_authorization.sql` removes those app-role grants, closes direct offer/deal writes and introduces canonical price/role-checked RPCs. Buy-now validates the displayed price against the authoritative locked listing. Offer insert/status/accept and deal transitions use consistent locks; existing `services/data.ts` function signatures remain. Manual sell/want/counteroffer and legacy buyer payment claims/confirmation remain usable, with private hooks for agent-origin offer authority.

**Mandates:** `202611050002_agent_mandates.sql` adds immutable listing/event-scoped drafts, exact-hash human approval/revocation, capability tokens returned once and stored hashed, owner-only private mandate/activity reads, and scoped offer/accept/read/revoke RPCs. Bounds, role, suspension, listing snapshot, expiry/revocation, rounds and idempotency are checked transactionally. Manual acceptance cannot bypass an agent offer's source mandate. The recovered baseline's existing partial unique index permits cancelled history while preventing multiple live deals. Lock-wait and trigger-wait expiry checks prevent stale authority; late-visible provenance is rejected instead of acquiring source locks out of order. These are database foundations, not a completed AI or MCP integration.

**UI:** listing pages now include private draft/review/approve/revoke, exact USD limits, expiry/rounds and recent action/deal controls when `EXPO_PUBLIC_AGENT_TRADING_ENABLED=true`. Default is false; use only the migrated isolated database. Review approval passes the server's immutable draft hash. Currency/decimal input never silently rounds. Browser control was explicitly stopped during verification, so no rendered/UI approval journey is claimed. The first Expo attempt was confirmed blocked in an iCloud dependency read; the downloaded verification copy subsequently started on localhost. No production UI was deployed.

**Verified:** lossless input validation; application schema/ACL comparison; 1,452 effective privilege checks before intentional changes; 14 baseline defect/control cases; 42 fixed real local core cases including REST composite return/profile embedding, direct-write denial, sell/want/counter roles, cancelled reacceptance and competing acceptance/confirm/cancel races. Final mandate suite passes 65 real PostgreSQL cases, including approval/privacy, bounds, source authority, idempotency and expiry/suspension while blocked on actual row/trigger/profile locks. Independent review found and closed an expired-capability replay-read gap; approval/draft clocks and suspension now recheck after lock waits. Eight additional real REST checks verify the human UI's composite `.single()` draft/approve/revoke contracts, owner-only mandate/activity reads, capability dispatch and duplicate/revoked behavior using synthetic approval fixtures. Typecheck and 204 offline tests/791 assertions pass. A web export with the feature enabled and local placeholder configuration passes all 21 routes in the downloaded verification copy, with the four frontend source files matched to this worktree; packaging evidence only. No shared-database suite ran. These tests simulate human principals, not approval of real user mandates.

**Local commands, from `sellwant/`:**

```sh
# For an empty, unlinked isolated stack only; refuses an already restored schema.
python3 scripts/schema-baseline-local.py validate
python3 scripts/schema-baseline-local.py restore --allow-local-extension-owners
python3 scripts/schema-baseline-local.py permissions

# Apply core once before mandates; never reapply core over installed mandate hooks.
bun scripts/test-core-local.ts --expect fixed --apply-core --rest
python3 scripts/test-mandates-local.py --apply
python3 scripts/test-privacy-local.py --apply
python3 scripts/test-agent-access-local.py --apply

# Subsequent verification of the migrated local database:
bun scripts/test-core-local.ts --expect fixed --rest
python3 scripts/test-mandates-local.py
python3 scripts/test-mandates-rest-local.py
python3 scripts/test-privacy-local.py
python3 scripts/test-agent-access-local.py
python3 scripts/test-mcp-local.py
bun run typecheck
bun run test:offline

# Optional ordered replay in a disposable database; current app remains intact.
python3 scripts/test-schema-replay-local.py
```

Baseline comparison/permission expectations refer to the recovered source, before intentional migrations. Comparing the migrated schema against the old export correctly reports differences. All committed multi-session test fixtures are ownership-checked and cleaned; ordinary cases roll back. Automatic legacy migrations remain disabled because their base schema/order is incomplete. No production migration or deployment occurred.

**PayPal checkpoint:** both old order IDs returned 404. Created fresh exact $16.65 USD AUTHORIZE orders `0M315443YG505872E` (capture case) and `21V19307KS044112F` (void case). Authorization checks returned “Buyer must approve the PayPal order first.” A real premature capture command was rejected locally before provider capture. The read-only localhost callback was started. Buyer approval at PayPal and a later explicit simulated handoff still gate the isolated proof; no handoff was inferred from checkout approval. Preserve all private journals.

**Remaining:** human browser review/approval journey, Lucas's prototype/source commit for product MCP adaptation and chosen provider/model/access for actual AI. M2 is incomplete until its full transport/browser criteria pass; M1 still needs actual authorize/capture/void. Watcher, integrated payment/handoff UI, notification extension and end-to-end hardening remain future work. Manual acceptance/listing cancellation repeats fail without repeating the mutation; they do not yet return receipt-style replay results. All test-owned core/mandate/REST and attempted UI fixtures were cleaned. These local results supersede older schema-access blocked notes.

### November 5 access delegation and privacy follow-up

**Existing → changed:** an approved mandate previously had no human UI for issuing/revoking its scoped tokens. `components/AgentAccess.tsx` now provides read-only default permissions, explicit scope/expiry review, one-time masked token display with user-triggered copy/reveal/hide, and revocation controls even for consumed mandates. Mandates and access metadata follow exact counts/ranges, so an older approved mandate and its revocation controls are reachable beyond the newest 50 drafts. Token verifiers cannot be selected. Raw tokens stay in component memory, never storage, URLs or logs. The listing screen remounts all listing/offer/contact/mandate/access caches when the signed-in identity changes. The session hook applies auth events directly and ignores a stale initial session read after such an event. Clipboard/rendered behavior remains browser-unverified.

**Privacy:** local reproduction found the inherited authenticated `offers_select USING(true)` policy exposed accepted offer amounts on completed listings to unrelated users. The fixture-only `purge_test_listing` RPC also interpolated a private owner email into an error available to authenticated callers. The additive `202611050003_agent_privacy.sql` restricts inactive offer reads to legitimate owners/authors/current noncancelled deal participants and makes fixture cleanup service-role maintenance only, with generic errors. Public active negotiation remains available. It also lets suspended owners revoke existing authority, denies their scoped private token reads, and rechecks owner suspension after issuance lock waits. Agent revocation now returns only `{id,status}` so a revoke-only token cannot retrieve private terms without read permission; human revocation still returns the owner's full row. These are isolated local schema changes; no hosted data was read or modified for exploit testing.

**Compatibility:** the excluded legacy shared-database test uses authenticated fixture cleanup; that cleanup call now intentionally fails. Do not run that suite against shared infrastructure. New isolated tests use verified local targets and owned fixture cleanup. Core RPCs and manual marketplace caller signatures remain unchanged. The recovered baseline already had `lock_ins_one_open_per_listing_idx`; the prior missing-index diagnosis was incorrect. Removed only the task's ownership/definition-checked redundant local index and its migration creation. Regression checks now validate index properties and actual duplicate rejection instead of requiring a new name. The development-only function refresh option was removed so it cannot replay older mandate definitions over newer privacy fixes.

**Verification:** 42 real local access REST groups pass, including explicit-column exact counts, tied-timestamp 57-token and 57-mandate lists paged 50+7 without omissions/duplicates, older approved access/revocation, private verifier denial and outsider count `*/0`. Sixteen privacy checks first reproduced inherited defects/control behavior; 39 fixed SQL/REST checks now pass, including scoped revoke receipts and issuance blocked on confirmed mandate/profile locks during suspension. The 42 core cases and 65 mandate cases pass after privacy hardening. Typecheck, 204 offline tests/791 assertions and a feature-enabled 21-route web export pass; six current frontend files match the downloaded verification copy. Owned fixtures were cleaned. No browser or actual MCP/model behavior is claimed.

**Try:** after the ordered local migrations, point the frontend only at `http://127.0.0.1:55321` with that local stack's public anon key, enable `EXPO_PUBLIC_AGENT_TRADING_ENABLED=true`, and run `bun run web`. Use synthetic signed-in accounts/listings. Review/approve a mandate, choose “Create agent access,” review permissions/expiry, issue/copy the token, then revoke it from the same mandate panel. [Agent integration contract](AGENT_CONTRACT.md) specifies the actual persistent RPCs for Lucas's adapter; it does not substitute for his missing prototype. Follow the local verification commands above and keep service-role/PayPal secrets out of frontend variables.

**Remaining:** actual buyer approval at PayPal (both current authorization checks still reject pending approval), a later explicit simulated handoff for capture, browser validation when control is restored, Lucas's prototype/source commit, and chosen LLM provider/model/access. No replacement order links were generated while buyer availability was unconfirmed. Product MCP, real model/watcher, integrated payment/handoff/notifications and end-to-end hardening remain incomplete.

### November 5 ordered migration replay

The privacy follow-up had been applied incrementally during development. `scripts/test-schema-replay-local.py` now verifies the complete baseline → 001 → 002 → 003 sequence in a random owned database inside the guarded local container. It copies platform schema only, with no rows or role/global definitions; removes app objects only in the disposable database; compares the restored baseline and its 25 app definitions; verifies 1,452 effective privileges; and applies each whole migration in order. The final catalog and all 45 application function definitions exactly match the working local database. The temporary database was removed and the original app catalog/functions remained unchanged. Private diagnostics include hashes of the exact applied migration bytes. Unknown CLI target overrides are rejected before database access.

This verifies application replay on the current local platform schemas/shared roles, not a fresh Supabase service bootstrap or source PostgreSQL 17.6 equivalence. No browser, MCP, model or real payment completion is implied. Both existing PayPal authorization checks still return “Buyer must approve the PayPal order first.” Expected local MCP prototype paths remain absent; the requested source/commit and provider/model/access are still required. No replacement orders or production changes occurred.

### November 5 in-repository MCP checkpoint

The user clarified this repository is the handoff; the separate prototype gate is removed. `/mcp` now uses the official split TypeScript SDK 2.4.0 stateless Web Standard transport, pinned with its matching client and Zod. It is disabled by default, rejects the known production origin/database, authenticates each request through the new minimal `agent_get_access` RPC and uses only the public Supabase key for transport. Exact origin/host checks, strict schemas, streamed request/upstream/response limits, secret redaction and generic errors protect the boundary. Upstream outages remain 503 instead of being mislabeled invalid credentials. No service-role key enters this route.

Only granted private read/offer/accept/revoke tools are advertised. All valid capabilities can discover active listings, exact going rates/no-offer state and open public offer IDs. Offer pages have exact counts and stable listing-bound cursors, omit author IDs and private fields, and disappear from public discovery when a listing locks. The real proof discovers counter/accept targets through that tool, rather than sharing IDs privately between clients. Operation UUIDs remain stable across retries; an unknown mutation preserves its UUID and requires reconciliation. Human approval/payment/handoff actions are not exposed.

**Verified:** 55 actual local access-context SQL/REST checks, including each single scope, expiry/revocation/suspension and confirmed lock waits; 26 official SDK-client → loopback Worker → real PostgREST groups, including public pagination, bounded offer/counter/accept, restart persistence, idempotency, participant-only deal reads and next-request revocation. The first pagination assertion used a replaced same-bidder offer; it was corrected to two independent bidders, with no ACL/Worker relaxation. All owned fixtures were cleaned. The four whole migrations reproduce all 46 app definitions and baseline 1,452 grants in a disposable database; the original catalog is unchanged. Typecheck and 230 offline tests/1,662 assertions pass. A clean isolated Wrangler dry-run compiled 729.44 KiB / gzip 149.11 KiB without bindings or deployment. The local launcher returned 401 without a capability, exited cleanly on Ctrl-C and its listener was confirmed closed.

**Try:** run `python3 scripts/test-mcp-local.py` for the isolated synthetic proof, or `python3 scripts/mcp-local-server.py` to start a loopback endpoint. Supply a human-issued mandate capability as a Streamable HTTP client's Bearer header. [Contract and commands](AGENT_CONTRACT.md). General OAuth, hosted external clients and human browser mandate approval remain unverified. OpenAI key authentication is verified only by a read-only model-list request; no model generation, durable watcher or integrated payment/handoff is claimed. The capture order still needs buyer checkout approval and a later explicit simulated handoff.

### Try the isolated proof

**Latest real payment result:** the user's `/return` screenshot is the expected read-only callback, not a checkout error. For void-test order `21V19307KS044112F`, backend authorization succeeded as `14F6288189074490Y` for exactly 1665 cents/USD and the configured sandbox seller. Void was confirmed by provider readback; repeating void retained the same VOIDED authorization with no capture or handoff. Capture-test order `0M315443YG505872E` still reports buyer approval required. The separate explicit simulated handoff remains mandatory after that order is authorized.

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

**Remaining M1 gate:** sandbox authorization/void are verified. The separate capture order still requires buyer approval, backend authorization, explicit simulated handoff and provider-confirmed capture. Generate replacement links only when the buyer is available. M1 remains incomplete until capture is proven. M2 has a verified recovered database and persistent bounded trading; product MCP is being implemented in this repository following the user's handoff clarification. Browser validation remains unverified while browser control is stopped.

### November 5 fresh manager session: preserved work and required pause

Read the handoff, brief, baseline, tracker, agent contract and repository rules;
verified branch `hackathon/paypal-ai-2026` at `ebb74250`. Preserved the user's
modified handoff and untracked brief. The isolated API55321/DB55322 stack is
running and healthy. Chrome browser inventory/control is available in this
session; no browser journey or human approval was performed. Read-only Wrangler
authentication check returned unauthenticated; no deployment occurred.

Four native worker roles were created within four total slots: payment, AI and
app ran first; verification rotated in after the others reached safe checkpoints.
Manager retained shared routes/data, migration application and this tracker.

| Role | Verified progress | Preserved implementation / remaining work | Attempts / stopped state |
|---|---|---|---|
| Payment proof | At 23:30:27 UTC the existing capture order still required buyer action, with exact deal/1665 cents/USD/merchant verified and no authorizations/captures. At 23:30:46 UTC the existing void authorization remained provider-confirmed VOIDED. [Evidence](PAYMENT_PROOF.md) | Buyer availability/approval and later explicit human simulated handoff remain required. No new order, approval link or financial mutation. Private journals preserved | Restricted OAuth failed; permission-required rerun succeeded. No live process, journal lock or unknown financial operation introduced. Stopped |
| AI and watcher | Initial worker typecheck passed; manager typecheck later passed after shared integration | `worker/ai.ts`, `worker/watcher.ts`, migration `006`, `scripts/prove-ai-local.ts`. Strict proposals, encrypted scoped capability storage, durable leases/operation keys are drafted. No successful generation, SQL test, UI enrollment or running watcher proven | Generation approach failed; stopped. No migration or financial operation |
| App integration | 24 focused fixture tests/94 assertions passed; subsequent manager full suite included the callback test and passed 255 tests | Payment ledger/API/UI, outbox event migration `005`, callback adapter extension and tests. Manager wired `services/data.ts`, Worker routes/cron/email dispatch. SQL, recovery races, browser, notifications and real payment journey remain unverified | No technical blocker attempts. No migration/provider operation or live process. Stopped |
| Verification and demo | Independently compared schema/model requirements and obtained decisive redacted HTTP 429 account evidence | Test design, integrated SQL/browser scenarios, reproducible demo, video and submission are still incomplete | Distinct diagnostic approach failed; no third attempt. Stopped |

Fresh baseline before new edits: typecheck and 230 offline tests/1,662 assertions
passed. After shared integration: typecheck and 255 offline tests/1,768 assertions
passed. Three further outbox integration cases passed in the focused 12-test,
24-assertion outbox suite; the complete suite was not rerun after those three
test-only additions. Final whitespace check passed. Provider fixtures do not
prove SQL transactions, real AI, live notifications or the integrated journey.

**Blocking condition and two distinct approaches:**

1. Hypothesis: configured Responses structured generation works with the supported
   configurable `gpt-5.4-mini` default. Ran
   `bun --env-file=.env.llm scripts/prove-ai-local.ts`. The sandbox invocation
   failed immediately; its required escalated rerun also failed with generic
   `AgentFailure: unavailable`. No successful generation journal was produced.
2. Hypothesis: the generic error masks a provider rejection rather than a schema
   failure. Verification inspected the strict schema offline, then injected a
   transport that records only status/code/type/request ID around one synthetic
   generation request. The sandbox needed network escalation; the escalated
   request returned HTTP 429, `credit_balance_exhausted`, `insufficient_quota`,
   request `req_2f8a37a615aa439ab95375454867f0bd`. Private 0600 evidence is
   `.local/ai/generation-diagnostic-1793921648007.json`. Permission reruns are
   recorded within their respective approach, not counted as extra attempts.

Both approaches failed to produce real generation. The handoff's explicit
two-attempt rule requires stopping all roles and pausing for the user's decision.
No new provider requests, migrations, deploys or model substitutions follow this
checkpoint. All source edits remain preserved in the worktree; no commit/push.

**Alternatives:** fund the existing OpenAI project, then resume the same proof;
or supply another authorized funded OpenAI project key and verify its model
access before generation. Recommendation: fund the current project to retain
the existing access/configuration. Never paste credentials into chat.

**Resume review gates:** persist the callback origin with the immutable PayPal
create payload before any same-key retry; bind watch expiry to capability expiry
or enforce watch expiry transactionally so a staged job cannot outlive enrollment;
independently review/apply `005` then `006` and extend ordered replay/tests;
finish AI draft/enrollment UI and verify true model proposals; establish a durable
isolated runtime and distinguish it from hosted Cloudflare operation. Capture
journal's existing authorization key safety window ends November 6 at 00:08:38 UTC;
preserve its ID and reconcile before resuming, without discarding the journal or
rotating IDs. Buyer checkout approval never attests handoff.

### November 6 resumed manager checkpoint and runtime stopping rule

User resumed at approximately 05:27 UTC. Current branch/worktree were rechecked;
the original user brief and modified handoff remain preserved. All four native
roles rotated within four total slots. No production changes, deployment, push,
real notification or financial mutation occurred.

| Role | Verified progress | Remaining / checkpoint state |
|---|---|---|
| Payment proof | Fresh read at 05:45:31 UTC: old capture order returns 404 `INVALID_RESOURCE_ID`; direct void authorization remains `VOIDED`, exact 1665 cents/USD, no captures. All journals unchanged/private/unlocked | Buyer availability and disposition of the unreadable order remain human gates. Expired key preserved; no replacement link/order or handoff. Role stopped with no live process |
| AI and watcher | Real structured draft and real acceptance proposal using `gpt-5.4-mini-2026-03-17`; 29 focused tests/typecheck. Human-reviewed draft/start/status/stop/resume UI implemented; 65 independent actual watcher SQL/REST/race checks pass after007 | `scripts/prove-watcher-local.py` is authored but unrun. No durable scheduler, browser approval or hosted proof. Role stopped |
| App integration | Full immutable PayPal create JSON/UUIDs, buyer authorize intent, known hold expiry, fixed deadlines, fenced capture/cancel/reconcile, typed deduped outbox and separate human handoffs implemented; 64 independent actual payment SQL/REST/race checks pass | Provider fixtures prove adapter logic only. Browser/account-switch behavior and actual integrated PayPal journey remain unverified. Role stopped |
| Verification/demo | Guarded SQL/REST/races found cursor defect and verified fix; seeded/repeated three local logins + two listings with zero approvals/deals/payments/watches. [Verification](VERIFICATION_DEMO.md), [submission draft](DEMO_SUBMISSION_DRAFT.md) | Native Chrome is available, browser-tab connector inventory is absent. No page journey, video, upload or submission. Role stopped |

**Actual AI evidence:** funding recheck succeeded with HTTP200 at 05:28 UTC.
A strict text validator initially misclassified a money explanation as a phone;
offline reproduction/regression fixed it. The next real output parsed correctly
but waited because the prompt ambiguously described poster counteroffers.
Clarified the existing RPC's actual accept-vs-counter rules; one corrected
negotiation-only call accepted supplied offer1665 within seller minimum1600.
The verified draft response is
`resp_02024a4823cd4b51016aed67d684ec87d09e0536cc40472e85`; negotiation response is
`resp_08c30707399c749d016aed687f73f887d082ea71b28b82aca0`.
Private `.local/ai/generation-proof-1793943679066.json` preserves synthetic model
outputs. The explanation imprecisely said the offer “exactly” met the floor;
the validated numbers are1665>=1600. No model action approved a mandate/payment
or attested handoff. Fixture proposals are separate from human UI approval.

**Applied and replayed locally:** the first005 attempt rolled back because the
recovered source lacks the not-yet-installed existing outbox. Reviewed/applied
`20260821_email_outbox.sql` in an explicit transaction, then005 and006. Actual
watcher staging exposed PostgreSQL error2201B for cursor regex `{1,1024}`.
Additive007 replaces that with separate character-length and charset checks;
006's applied bytes remain unchanged. Valid1024 and invalid1025/empty/charset
cases pass. `scripts/hackathon-migrations-local.py` guards the exact stack,
refuses reapplication and keeps private exact SQL/hash receipts.

Ordered baseline→001→002→003→004→outbox→005→006→007 replay passed: source baseline
and25 functions,1452 effective privileges, then exact final catalog and66 app
functions. Disposable DB removed, original catalog unchanged. Root reran42 core,
65 mandate,39 privacy,55 access-context,42 mandate REST and26 official MCP/Worker/
PostgREST groups; all passed and owned fixtures cleaned. Outbox-aware fixture
cleanup now removes owned notification rows before listing deletion. Typecheck
and291 offline tests/1932 assertions pass. Provider fixtures and SQL receipts
are explicitly not real PayPal proof.

**Runtime blocker — two distinct approaches, both failed:**

1. Hypothesis: current source/dependencies can export directly in the original
   iCloud-backed checkout. The guarded runtime launcher ran `bun run build` with
   local Supabase/public feature configuration. It exceeded180 seconds. The
   launcher and exact child PIDs89990/90033/90034 were subsequently confirmed
   absent; no service container was started. Private build directory:
   `.local/hackathon-runtime/build-ac612ec63e2f466db95e018bfffd39a1`.
2. Hypothesis: a downloaded temporary copy avoids the original checkout's
   historical file-read stalls. The launcher archived HEAD, overlaid current
   source and cloned downloaded dependencies before a frozen install. It failed
   immediately: `Bun could not find a package.json file to install from`.
   Private log: `.local/hackathon-runtime/build-09056c61b8d44565a2d79df14c84378e/install-stable.log`.
   Scratch copy: `/private/tmp/sellwant-hackathon-build-bb_3ld7h`.

Read-only follow-up diagnosis, not a third build: `git archive HEAD:sellwant`
from the app subdirectory exits0 with zero entries; the same read from repository
root yields185 entries and `package.json`. The overlay therefore contained only
changed files. Correct the archive working directory to `ROOT.parent` and assert
the manifest exists before dependency installation. This manager-authored
preparation bug remains unfixed because the two-attempt rule requires stopping
for the user's decision.

At stop, guarded status confirms `running:false,id:null` for the runtime and
outbox/005/006/007 applied with66 functions. No watcher proof fixture was prepared.
Intentional demo accounts/listings and all private logs/journals remain preserved;
generated Python cache/build files are uncommitted. All worker roles are terminal
with no live child processes or in-flight financial requests. No commit/push.

**Impact/alternatives/recommendation:** scheduler survival, live API/browser
journey and integrated checkout cannot be verified until runtime startup works.
Recommended: apply the confirmed repository-root archive correction plus manifest
preflight, then resume the downloaded-copy build and actual scheduled proof.
Alternative: overlay the exact current frontend onto the existing fully downloaded
verification checkout and build there with frozen current dependencies. Both
retain the existing Worker/Supabase design and all required tests. Pause under
the handoff's standing instruction; wait for the user's decision before another
build, provider request or implementation change.

### November 7 requested main publication checkpoint

The user explicitly requested pushing this checkpoint to `main`, authorizing an
exception to the earlier branch-publication restriction for this push. The
implementation goal remains paused with the runtime/browser/capture gates above
unfinished. This publishes preserved implementation and evidence; it does not
claim completion or authorize production migrations/payments.

The existing main-push workflow deploys production, so the publication commit
uses `[skip ci]` to preserve the earlier no-production-deployment instruction.
No workflow dispatch or deployment configuration change is requested. Private
credentials, operation journals, demo logins, schema exports, Python caches, the
untracked user brief and pre-existing handoff edits are excluded. Fresh offline
checks pass291 tests/1932 assertions plus13 normalization and5 QR decode checks.
Fresh typecheck also passed; its initial local file-read delay did not require a
source change. The known runtime archive-path bug remains recorded above.
