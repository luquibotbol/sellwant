# SellWant × PayPal execution plan

Authoritative tracker. Started October 28, updated October 29, 2026. Branch `hackathon/paypal-ai-2026`; baseline `618a3a01`. [Verified baseline and setup](BASELINE.md).

User's current request authorizes milestone implementation. Work one coherent milestone at a time. No production deployment, data modification or main push/merge. Preserve existing marketplace behavior. A milestone requiring a real external integration is incomplete until that integration is demonstrated.

## Scope and schedule

| Milestone | Target | Codex engineering estimate | Human setup/review, excluding waiting | Deliverable / checkpoint |
|---|---|---|---|---|
| M0 audit/baseline | Oct 29 (done) | 3–5 hours | 15–30 minutes | Architecture, baseline checks, official tooling research and this plan |
| M1 payment feasibility | Oct 30 | 1–2 working days | 30–60 minutes sandbox setup and two buyer approvals | Isolated real create → approve → authorize → handoff → capture, plus independent authorize → void; verified exact receiver/price |
| M2 persistent authorized trading | Nov 3 | 2–3 days | 30–60 minutes schema recovery/dev DB setup | Human-approved mandates, persistent public negotiation, atomic deal lock, authenticated product MCP |
| M3 useful AI and completed journey | Nov 8 | 3–4 days | 30–60 minutes provider/mail/demo review | LLM drafts reviewed mandates/proposes negotiation; durable watcher; integrated sandbox payment/handoff/cancel; outbox notifications |
| M4 hardening and submission | Nov 11 | 2–3 days | 1–2 hours demo recording, account/judge access and submission | Two-user browser journey and void path, failure/concurrency hardening, video by Nov 10, submit Nov 11 |

Feature freeze November 8. Official deadline November 12 at noon PST / 20:00 UTC; contingency only. [Official rules](https://paypalaihackathon.devpost.com/rules). Account-access waiting is separate from engineering estimates and can consume the schedule; escalate genuine access blockers early.

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
| M1 adapter, harness and local safety checks | Verified locally; external gate still blocked | Server-only sandbox adapter, private resumable journal/lock, CLI; 29 new tests, 116 total offline tests; typecheck/build pass |
| M1 actual sandbox authorize/capture/void | Blocked | No PayPal app/merchant/buyer credentials available |
| M2 database/prototype integration | Planned; dependencies missing | Need actual base schema and prototype source/commit, dev DB |
| M3 AI/watcher/notifications/full handoff | Planned | Follows M2 and provider/dev service access |
| M4 hardened demo/submission | Planned | Feature freeze Nov 8; video Nov 10; submit Nov 11 |

## M1 runbook and milestone evidence

**What existed:** manual payment links and buyer claims; no API integration. **What changed:** sandbox Orders/Payments adapter, exact amount/payee/deal checks, OAuth cache, bounded retries with durable operation IDs, verified status reads, local process lock, human test handoff gate, signature verification client, safe offline CI. **Expected behavior:** buyer approval produces an authorization/hold; only the explicit test handoff enables capture; a second authorization can be voided; restarting/repeating commands reconciles the same resources. Existing marketplace screens and production Worker routes are unchanged.

**Verification environment:** original checkout has recurring iCloud file evictions/read stalls. Final verification runs in `/private/tmp/sellwant-verify-20261029`, fetched at `618a3a01` with byte-identical task changes. This is a verification checkout, not a replacement project or a production deployment.

| Check | Actual result, October 29 |
|---|---|
| Frozen install | Passed in stable verification checkout; no lockfile change |
| `bun run typecheck` | Passed after correcting new TypeScript errors found by the first stable run |
| `bun run test:offline` | Passed: 116 tests across 16 files, 0 failures, 384 assertions; includes 29 new payment/session/CLI cases |
| `bun scripts/test-normalise.ts`, QR generation and `test-decode.ts` | Passed: 13 normalization/mask + 5 PNG/hash checks |
| Web export with local placeholder config | Passed: 21 static routes, entry 1.42 MB, lazy jsQR 130 kB; runtime DB not tested |
| CLI no-credentials smoke | Expected rejection: `PAYPAL_ENVIRONMENT must be SANDBOX`; no provider call |
| Bundle and setup checks | Server/test PayPal markers absent from both frontend bundles; optional MCP TOML parses with all account tools disabled; Git diff whitespace check passed |
| Real sandbox buyer approval/authorize/capture/void | NOT RUN; blocked on app/merchant/buyer access |
| Actual database/RLS, browser buyer/seller, deployed webhook/email, CI Bun 1.3.14 | NOT RUN; not claimed passing |

The first cloud-backed post-change suite hit a QR file-read timeout; another saw empty Worker exports. Those failures were resolved for verification by using the stable exact-commit checkout, not by weakening assertions or extending timeouts. Focused provider tests use mocks and cannot prove account eligibility, API response compatibility or money movement.

All 17 task files were compared byte for byte with the stable verified checkout. The original branch diff contains only the three intended modifications plus the new milestone files; the user's brief remains untracked and preserved. No push or merge was performed.

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

**Remaining M1 gate:** obtain sandbox access, run both real paths, record sanitized IDs/statuses and the seller account model. M1 remains incomplete until then. Next substantial milestone is M2; schema export and Lucas's prototype are needed before adapting persistence/auth/RPC contracts.
