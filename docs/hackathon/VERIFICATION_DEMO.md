# Verification and demo

Independent verification role. Updated November 8, 2026 UTC. The authoritative
milestone status remains [EXECUTION_PLAN.md](EXECUTION_PLAN.md). Synthetic test
principals and provider receipts do not prove human approval or PayPal funds.

## November 8 browser preparation checkpoint

At 04:38 UTC, a fresh guarded `demo-setup-local.py status` read verified three
synthetic accounts, both intended listings active, and zero deals, payments or
active watches. Credentials remain in ignored mode-0600
`sellwant/.local/demo/session.json`; none were copied to this document. The
status command made no provider calls or human approvals.

The CUA browser host is unavailable. Native Chrome and Brave remain accessible.
Chrome Incognito and a separate Brave Private window were visibly created and
verified. No app login or two-user browser journey is claimed by this checkpoint.
The healthy isolated runtime rendered actual anonymous discovery in Chrome
Incognito at approximately 04:45 UTC: two active synthetic listings and the
**Sign in** control were observed through CUA accessibility state. Concurrent
desktop input then opened an unrelated local app in that same private window.
No login credentials were entered and no unrelated tab was closed or navigated.
No existing personal tab was navigated. No screenshots or footage of personal
browser content are part of the demo evidence.

Visual audit rejected the attempted discovery screenshot: a concurrent tab
switch captured the unrelated app between the accessibility read and capture.
It is quarantined, private and explicitly excluded in
`sellwant/.local/demo/browser-evidence/manifest.json`. Usable screenshots and
video remain zero. No browser closure or watcher persistence is established by
this browser record.

Two browser-control paths were checked: native CUA was interrupted repeatedly
by actual desktop changes; a separate hidden in-app browser creation failed
immediately with **The browser access host is unavailable**. Fresh browser
inventory also reported no browser provider. Native input stopped pending a
safe dedicated surface. QuickTime inspection timed out once; no recording was
started. No application defect or account-switch failure was reproduced, and
no app source was changed.

Human review destinations after the isolated runtime starts:

- Capture listing: `http://127.0.0.1:8788/event/8322a1b8-d57d-4eb3-9d23-52fae121119d`
- Cancellation listing: `http://127.0.0.1:8788/event/d0c26668-3da6-43b9-9621-06bb91448ace`

Each identity must review the actual draft before personally choosing
**Approve these terms**. Intended buyer/seller values are maximum 1800/minimum
1600 cents, 60 minutes and four rounds. After approval, **Review background
watch** leads to the separate **Start this reviewed watch** human access gate.
No agent will perform those approvals, PayPal approval or either handoff.

## Reproducible local checks

Run from `sellwant/` after the manager reviews and applies the recovered baseline,
the historical email-outbox prerequisite and whole migrations 001–007 to the
isolated stack. These scripts never apply
migrations, accept hosted targets or call OpenAI/PayPal. The shared helper reuses
`schema-baseline-local.py::Local`: fixed project/image/network, healthy local
container, unlinked CLI config, API `127.0.0.1:55321`, DB port `55322`.

```sh
bun run typecheck
bun run test:offline
python3 scripts/test-deal-payments-local.py
python3 scripts/test-ai-watcher-local.py
python3 scripts/test-schema-replay-local.py
```

Both new suites accept only `--section all|sql|rest|races`; no credential/URL or
`--apply` option exists. Ordinary SQL cases roll back. Committed REST/race cases
use random synthetic identities/listings; cleanup checks their marker and exact
three-user ownership before deleting only their dependencies. Failure details
stay in ignored mode-0600 `.local/verification/` files. No token, API key,
Authorization header, arbitrary provider body or QR payload is printed.

The watcher suite refuses a global queue claim if unrelated active watches
exist. Run it before persistent demo enrollment, or stop those watches first.
Do not run the repository's full `bun run test` against shared infrastructure.

| Coverage | Authoritative evidence required |
| --- | --- |
| Payment roles and privacy | Real SQL/REST rejects outsiders, anon/agent human controls, direct writes and internal-column selection |
| Exact payment association | Ledger persists locked integer cents, USD, configured synthetic merchant and full immutable create payload before provider IO |
| Human handoff | Unverified, false, outsider and missing-expiry handoffs fail; two distinct participants remain required |
| Capture/cancel | Actual concurrent SQL claim grants one financial lease; stale completion cannot unlock; unknown capture permits reconciliation only |
| Recovery and notifications | Stable operation/request IDs survive expired leases; verified void unlocks; repeated status/handoff calls produce one outbox row per event and recipient |
| Watcher authority | Enrollment expiry equals capability expiry; scoped owner authority is mandatory; Stop revokes; blocked resume cannot expand authority |
| Durable queue | Concurrent claims lease once; stage payload is immutable; stale stage/finish are fenced; a lost actual action reply reuses one operation and consumes one round |
| Expiry during a race | Confirmed PostgreSQL row-lock wait crosses watch/capability expiry; actual guarded action produces no additional offer or consumed round |
| Watcher privacy and pagination | Owner-only proposal history, denied ciphertext/lease/diagnostic reads, persisted public-offer continuation |

## Synthetic two-person journey

The fixture is available through the guarded local-only setup script:

```sh
python3 scripts/demo-setup-local.py create
python3 scripts/demo-setup-local.py status
```

`create` is resumable/idempotent using IDs and passwords persisted before Auth
requests. It verifies existing ownership and each real password login, then
creates two active listings through the seller's RLS context. The private
mode-0600 `.local/demo/session.json` contains credentials. Only nonsecret IDs,
listing URLs and counts print. The setup creates no mandates, agent access,
offers, deals, watchers, payments or approvals. `cleanup` refuses any payment
association or active watch; it preserves financial journals. Cleanup
removes owned outbox rows before listings can clear their foreign-key references.

Fresh setup: three local `@sellwant.test` accounts, two active listings and zero
deals/payments/watches. A running integrated local app/Worker and the human steps
below are still required. Do not substitute this setup or an offline passing
suite for the journey. Its acceptance contract is:

1. Create two disposable local email/password identities, a separate outsider
   and an active synthetic sell listing at 2000 cents. Keep login credentials
   private. Map only the synthetic seller to the configured sandbox merchant.
2. Serve the app and Worker against local Supabase, with agent/payment feature
   flags enabled, server-only provider keys and a stable local callback origin.
   Set `EXPO_PUBLIC_HACKATHON_API_ORIGIN` to the exact Worker origin if separate
   from the frontend. Browser keys must be the local public anon key only.
3. In separate buyer/seller sessions, request AI terms: buyer maximum 1800 cents,
   seller minimum 1600 cents, one-hour duration, four rounds. A person reviews
   the event, integer amounts, defaults and expiry, then clicks **Approve these
   terms** for each identity. Agents do not perform either approval.
4. Each person explicitly enrolls a watcher using a capability that expires
   exactly with its watch. Public offers/counters remain within both immutable
   bounds. Record real model response IDs, the single locked deal and exact
   agreed cents. No contacts, unrelated completed prices or QR data enters AI.
5. Close the interactive client/manager and restart the local Worker. A separately
   supervised scheduler must continue the durable jobs. Verify a second process
   can reconcile the same staged operation; no second trade/round appears.
6. Buyer chooses **Prepare sandbox checkout**, opens **Open PayPal sandbox
   approval** and personally approves as the separate synthetic PayPal buyer.
   Backend **Verify approval and authorize hold** verifies the exact receiver,
   USD amount, order and authorization. Callback return alone proves nothing.
7. Each person personally clicks **Confirm my test handoff** after an explicit
   simulated handoff. Their two timestamps are separate from checkout approval.
   **Request sandbox capture** may then run. Verify the provider capture resource
   is `COMPLETED`, associated with that authorization/order and exact locked USD
   cents. Check final app state and repeated capture produces no new mutation.
8. Repeat with a second listing/deal for cancellation: approve/authorize, cancel,
   verify `VOIDED`, no capture and listing active again. Also cross a short local
   deadline and interrupt a provider response; unknown results stay locked until
   authoritative reconciliation. Never manufacture a replacement operation.
9. Outsider sees only public active marketplace data, cannot read either private
   mandate/payment/activity, cannot attest handoff and cannot issue agent access.
10. Restore/revoke all demo authority and clean only owned local fixtures after
    preserving necessary private financial journals. No production deployment.

Existing standalone sandbox proof and human gates are tracked in
[PAYMENT_PROOF.md](PAYMENT_PROOF.md). That historical CLI order is not an
integrated product-deal association.

## Browser status and evidence

Fresh CUA read on November 6: native Google Chrome is controllable at its profile
picker, with Guest mode available. The browser/tab provider inventory was empty.
No user profile was selected and no app flow was executed. Use CUA for all UI
interaction. Screenshots and observed behavior must demonstrate actual separate
buyer/seller sessions; test-created SQL principals are not browser proof.

| Browser checkpoint | Status |
| --- | --- |
| Native Chrome control | Verified read-only profile-picker access |
| Local login and identity switching/private-cache teardown | Not run |
| Human-approved buyer and seller mandates/access enrollment | Not run; human steps |
| Real generated draft/negotiation shown in the app | Not run |
| Hold/handoff/capture/cancel screens and read-only callback | Not run |
| Payment/mandate outsider and expired/revoked UI paths | Not run |

## Video and submission deliverables

These remain incomplete independently of implementation/tests. Verify current
official rules again before publication or submission; the baseline records a
public YouTube demo shorter than three minutes, public licensed source and
functional judge access or complete runnable instructions.

[Submission copy and recording narration](DEMO_SUBMISSION_DRAFT.md) are prepared
as drafts with explicit missing evidence and links.

Proposed recording sequence, total 2:40:

| Time | Show | Proof |
| --- | --- | --- |
| 0:00–0:20 | Synthetic event and buyer/seller goal | Existing marketplace context and new hackathon scope |
| 0:20–0:55 | Real AI drafts and two people reviewing exact limits | AI proposes; human approval establishes authority |
| 0:55–1:25 | Public bounded negotiation, restart and one locked deal | Persistent watcher/action IDs and exact agreed cents |
| 1:25–2:10 | Buyer checkout, verified hold, separate handoffs, capture | Actual sandbox provider resource and app state |
| 2:10–2:30 | Separate cancel/void and retry | No capture, listing unlocked, no duplicate trading/payment |
| 2:30–2:40 | Source, setup and judge access | Runnable submission with clear remaining limitations |

Before publishing: remove provider credentials, login details, capability tokens,
private contacts and ticket codes from video/screenshots. Keep provider evidence
IDs in the private verification bundle where needed. Confirm that the public
repository's MIT license applies to the new work, document new work separately
from the pre-existing marketplace, prepare runnable local instructions, confirm
judge access lasts through judging, and obtain the human's final video/submission
decision. No upload or submission has been performed by this role.

## Current verification record

- Payment suite: 39 actual local SQL, 22 REST/cleanup and 3 race/cleanup checks
  passed after migration 005. Provider receipts and human principals are
  synthetic test fixtures. All owned fixtures were removed.
- Watcher suite: 42 actual local SQL, 17 REST/cleanup and 6 race/cleanup checks
  passed after migrations 006/007. It reproduced an invalid PostgreSQL repetition
  bound in both cursor CHECKs; manager's additive 007 fixed it. Maximum 1024,
  overlong 1025, empty and invalid-character cursor cases now pass. A confirmed
  live row-lock wait crossed actual capability expiry; the guarded action
  created no offer and consumed no round. All owned fixtures were removed.
- Native Chrome availability and local demo Auth/listing setup are verified as
  described above. No user Chrome profile was selected during the control check.
- No independent real-model, browser journey, integrated PayPal capture,
  background scheduler survival, email delivery, video or submission proof is
  claimed by this document.
