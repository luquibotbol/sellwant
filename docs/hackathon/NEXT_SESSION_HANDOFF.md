# SellWant manager session handoff

You are the manager for completing the SellWant PayPal AI hackathon project in
`/Users/Doanh/Documents/Projects/sellwant`. Continue implementation and verify
the actual end-to-end trading logic. Coordinate native subagents; do not just
produce another plan. This request authorizes the four workstreams below.

Read `AGENTS.md`, `SellWant_Codex_Prompt.md`, `docs/hackathon/BASELINE.md`,
`docs/hackathon/EXECUTION_PLAN.md` and `docs/hackathon/AGENT_CONTRACT.md` first.
Inspect the current branch, worktree and runtime state. The execution tracker is
authoritative; its latest clarifications supersede older blocked notes.

## Current progress

- Branch: `hackathon/paypal-ai-2026`. Latest implementation checkpoint: `eb8f79ac`.
  Preserve the user's untracked `SellWant_Codex_Prompt.md`.
- This repository IS Lucas's handoff. No separate prototype repository is needed.
- The source schema was recovered faithfully into isolated local Supabase.
  Core authorization, human-approved immutable mandates, scoped capabilities,
  persistent bounded public negotiation and atomic deal locking are implemented.
- Product MCP is implemented in the existing Worker, disabled by default.
  Official SDK clients can discover public offers, counter, accept, resume after
  restart and obey token scopes/revocation. No agent payment/handoff approval.
- Last verification: typecheck, 230 offline tests, 55 real access-context checks,
  26 real MCP/Worker/PostgREST groups and an isolated Worker dry-run passed.
  Four migrations replay to 46 matching app functions; fixtures were cleaned.
- Private ignored credentials exist in `sellwant/.env.paypal-sandbox` and
  `sellwant/.env.llm`. OpenAI key authentication/model listing passed; no actual
  model-generated proposal or background watcher is implemented yet. The model
  field was left blank. Never print, overwrite or commit credentials.
- Actual sandbox order `21V19307KS044112F` was authorized as
  `14F6288189074490Y` for 1665 cents/USD and verified VOIDED. Repeated void was safe.
  Capture-test order `0M315443YG505872E` last required buyer approval. Reconcile
  current provider state and existing private journals before acting; IDs may
  become stale. No capture or simulated handoff has been confirmed.
- Browser mandate approval, hosted MCP compatibility, actual AI generation,
  durable watching and the integrated payment/handoff journey remain unverified.
  Browser control was previously stopped; do not assume it has been restored.

## Manager and worker responsibilities

Create four named worker roles. Check the available concurrency first: four
workers plus you need five slots. If fewer slots exist, keep four roles but
queue/rotate workers within the actual limit. Do not change global settings or
spawn recursive teams. Prefer native subagents over separate unmanaged sessions.

Before parallel edits, assign exclusive files and agree on API/schema contracts.
You own integration, shared-file coordination, migration ordering/application,
commits and the authoritative tracker. Workers propose shared-file changes to
you rather than editing the same files concurrently. Give each worker focused
context, acceptance criteria and dependencies. Reactivate completed agents with
the appropriate follow-up task control; do not assume a plain message restarts them.

1. **Payment proof worker:** reconcile the existing capture order and complete
   real sandbox buyer approval, verified authorization, explicit HUMAN simulated
   handoff confirmation and verified capture. Preserve journals and idempotency.
   Never infer handoff from checkout approval. Request replacement approval links
   only when the buyer is available. Report human gates immediately; do not poll
   endlessly or treat missing human approval as a coding defect.
2. **AI and watcher worker:** implement real OpenAI structured mandate drafts
   for human review and real negotiation proposals with explanations. Select a
   supported configurable model using current official docs and available access.
   Treat marketplace prose as untrusted. Reuse existing guarded RPCs/MCP and
   public discovery. Add durable leased/idempotent watching that works after the
   interactive session closes. Scripted arithmetic is not AI evidence.
3. **App integration worker:** connect locked deals to authenticated sandbox
   payment endpoints and minimal approval/hold/handoff/capture/cancel screens.
   Add persistent payment associations, serialized capture/cancel, reconciliation,
   timeout recovery and notifications through the existing outbox. Preserve
   manual marketplace behavior and distinguish payment claims from verified funds.
4. **Verification and demo worker:** independently test bounds, roles, revocation,
   expiry, races, duplicate jobs, unknown provider outcomes and privacy. Prepare
   a reproducible synthetic buyer/seller journey, browser tests once control is
   restored, isolated demo setup and video/submission materials. Start test
   design early; execute integrated scenarios as dependencies become available.

## Reporting and stopping rule

Workers report to you when they finish, encounter a blocker or reach a meaningful
checkpoint. Reports include changed files, exact evidence, remaining work and
attempt count. You review their diffs/results and independently verify critical
integration claims. Keep `EXECUTION_PLAN.md` current after each checkpoint.

Give me a consolidated report every 30 minutes of active work: each worker's
verified progress, current task, blockers, attempts and next action. Send urgent
human/account/safety blockers immediately; keep required interim updates brief.
Use wall-clock time and actual tool/process state. Do not promise timed delivery
while the session is unavailable or the goal is paused.

For one technical blocker, allow at most TWO genuinely different, evidence-based
attempts. Record the hypothesis, action and observed failure for each. Repeating
the same command or waiting for human approval is not a different attempt.

If both attempts fail, my standing instruction is to STOP ALL FOUR WORKERS at
safe checkpoints, preserve their work/logs and pause this goal using the available
goal controls. Reconcile in-flight financial operations where possible; if the
provider is unavailable, preserve explicit unknown state and IDs rather than
guessing or issuing replacement operations. Report the blocker, both
attempts, evidence, impact, two alternative approaches and your recommendation.
Wait for my decision before resuming. Do not mark unfinished work complete or
silently weaken requirements to pass tests.

## Constraints and completion evidence

Run commands in `sellwant/`. Never push/merge main, dispatch the existing
deployment workflow, deploy production or mutate production data. Use the
isolated local stack (API55321, DB55322), sandbox payments and synthetic users.
Use existing local target guards. Safe default checks are `bun run typecheck`
and `bun run test:offline`; full `bun run test` targets shared infrastructure.
Follow the tracker for focused local SQL/MCP/replay commands. Keep schema exports
private and parse them losslessly with Python if needed.

Keep integer cents, transaction-enforced limits/roles/expiry/revocation/rounds,
idempotent mutations, private contacts/completed prices and active-only discovery.
No raw ticket QR data reaches a model. Agents cannot approve mandates, expand
limits, approve PayPal checkout or attest physical handoff. Unknown remote outcomes
require reconciliation, not replacement payment operations.

Logic is verified only after real model proposals, human-approved buyer/seller
mandates, public bounded negotiation, one persistent deal, an actual sandbox
authorization followed by explicit human test handoff and confirmed capture,
plus cancel/void/unlock and timeout/failure recovery all pass. Prove the watcher
survives interactive-session closure and that retries cannot duplicate trading,
payments or notifications. Include a real two-user browser journey when available.
Distinguish local tests, hosted operation and unverified human/account gates.
Track demo, video and submission separately; do not call the whole project
finished while required deliverables remain missing. Complete authorized work
continuously until verified success or the stopping rule applies.
