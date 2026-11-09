# Submission copy and recording draft

Release review: November 8, 2026 UTC. Draft only. No video has been
recorded/uploaded and no entry has been submitted by the release role.
Use claims below only after their corresponding end-to-end proof is recorded in
[VERIFICATION_DEMO.md](VERIFICATION_DEMO.md) and the authoritative tracker.
The live Devpost form has not been inspected; these are prepared content fields,
not a claim that its current field labels or length limits have been verified.
Access, rules and human gates: [RELEASE_READINESS.md](RELEASE_READINESS.md).

## Project fields

**Title:** SellWant: bounded ticket agents, PayPal handoff

**Pitch:** Review your ticket-trading limits, let AI negotiate public offers,
then authorize PayPal sandbox payment and capture only after both people confirm
the test handoff.

**Problem:** Ticket buyers and sellers repeat the same price negotiation across
messages, while checkout approval, ticket delivery and actual payment are easy
to confuse.

**Product:** SellWant keeps public offers in the marketplace. An AI translates a
person's instruction into a draft for review, then proposes negotiation actions
within an immutable approved price, expiry and round budget. Database
transactions enforce those limits and create one deal. Payment approval,
verified authorization, each person's test handoff and verified capture are
separate steps. Unknown outcomes remain locked for reconciliation.

**New hackathon work:** Recovered and verified the existing database contract;
added immutable mandates and scoped revocable agent access, persistent bounded
negotiation, product MCP, structured AI proposals, durable watcher jobs and the
integrated sandbox payment ledger/UI/recovery/outbox path. The underlying ticket
marketplace predates the hackathon; describe it separately in the final entry.

**Technology:** Existing Expo/React Native app, Supabase/PostgreSQL, Cloudflare
Worker, OpenAI Responses with structured outputs, authenticated MCP and PayPal
sandbox Orders/Payments APIs. List only integrations demonstrated in the final
recording. Mocked transport tests are engineering evidence, not payment proof.

**Inspiration:** Ticket trading repeats the same question: can these two people
agree within their own price limits? We extend an existing public-offer
marketplace so AI can handle that negotiation while each person keeps control
of their terms, checkout and handoff.

**How we built it:** The existing Expo app and Worker share guarded PostgreSQL
operations. Structured OpenAI output proposes terms and negotiation actions;
transactions enforce approved amounts, expiry, revocation, rounds and roles.
Leased watcher jobs persist their operation and result. A separate sandbox
payment ledger binds the locked deal to PayPal resources and records approval,
authorization, both handoffs, capture and reconciliation separately.

**Challenges:** Preserving an inherited database contract; separating a model's
proposal from a person's authority; resuming an interrupted action without
duplicating a trade; and keeping an uncertain payment locked until provider
reconciliation.

**What we learned:** A successful API request, browser return and completed
payment are different observations. The UI and database must preserve those
differences. Database and mocked-provider checks help establish invariants, but
the complete demo still needs genuine human and remote-provider evidence.

**Current limitations:** Sandbox only. No production merchant onboarding or
ticket-authenticity guarantee. Actual integrated capture, two-person browser
approvals, notification receipt, clean judge access and final video remain
unverified at this draft checkpoint. Replace this sentence only when the
tracker records stronger evidence.

**Next:** Finish the verified end-to-end sandbox journey and independent judge
setup, then evaluate production merchant onboarding and operational monitoring.

**Project links:**

- Source candidate: <https://github.com/luquibotbol/sellwant>. Connector access
  returns 404. Authenticated GitHub CLI confirms this repository is private;
  anonymous access returns 404. Public source publication remains required.
- Current work branch: `hackathon/paypal-ai-2026`. Pin the final verified
  release commit after manager publication; do not submit an unpublished SHA.
- Developer runtime target: `http://127.0.0.1:8788`. This is not a hosted judge URL.
- Judge instructions: pending public bootstrap and clean-browser verification.
- Video: pending genuine recording, review and public YouTube URL.
- Entry: pending authorized Devpost session and required human attestations.

## Recording narration

Target 2:40 including the human checkout/handoff clips. Record live evidence
first; edit out waiting without changing the actual order of transitions. Do
not narrate an unverified path as complete.
Clip inventory and assembly: [VIDEO_ASSEMBLY.md](VIDEO_ASSEMBLY.md).

| Segment | Planned narration and screen |
| --- | --- |
| 0:00–0:20 | “SellWant helps ticket buyers and sellers agree on a price. This demo uses disposable local accounts and PayPal sandbox.” Show the synthetic listing and two sessions. |
| 0:20–0:55 | “AI proposes the terms. Each person checks the event, exact price limit, expiry and rounds, then approves those terms.” Show actual model output and the two human approvals. |
| 0:55–1:25 | “The watcher negotiates through public offers. These database checks enforce both people's limits. A restart resumes the same durable operation, and one deal locks at the agreed price.” Show offer history, explanation, operation ID, restart and single deal. |
| 1:25–1:45 | “The buyer approves checkout in PayPal sandbox. The backend separately verifies the authorization hold for this exact deal, amount and merchant.” Show human approval and verified hold. |
| 1:45–2:10 | “Checkout does not confirm delivery. Each person confirms the simulated handoff. Only then can the backend request capture and verify the completed payment.” Show both timestamps and actual provider capture/app state. |
| 2:10–2:30 | “A separate authorized deal is cancelled and voided. The listing reopens. Retrying a completed operation cannot create another trade or payment; an unknown outcome remains locked for reconciliation.” Show the independent void and retry evidence. |
| 2:30–2:40 | “The source and isolated setup instructions document the new hackathon work, its tests and the sandbox-only limitations.” Show the final source/setup/judge-access links. |

## Required fields still to fill

| Artifact | Status / final evidence |
| --- | --- |
| Public repository URL and source commit | Candidate above is private; authenticated metadata confirms MIT; anonymous access returns 404 |
| Judge URL or complete runnable setup | No isolated hosted URL found; private schema exports are still required by current bootstrap, so clean-checkout instructions are incomplete |
| Human-approved buyer/seller journey | Pending real browser/human steps |
| Integrated authorization/handoff/capture | Pending real sandbox/human proof |
| Independent cancel/void and timeout/unknown recovery | Local ledger tests pass; integrated provider journey still pending |
| Watcher after interactive client closes | Local leases/action replay pass; actual supervised runtime demonstration still pending |
| Public YouTube URL, under-three-minute final video | Not recorded or uploaded |
| Team names, eligibility, ownership and final entry text | Human review pending |
| Submission confirmation / entry URL | Not submitted |

## Final entry procedure

Once the remaining evidence and human attestations exist, use the authorized
Devpost account to inspect the actual required fields and limits, enter the
verified copy and links, attach genuine images, and review the saved draft.
Confirm the final repository and video from a logged-out browser, verify the
judge instructions without administrator access, then submit under the user's
existing authorization. Record the resulting entry URL and explicit submission
confirmation; a saved portfolio draft is not proof of hackathon entry.

Recheck current official rules before publishing. Remove login details,
credentials, capabilities, contacts and ticket codes from all public artifacts.
Do not replace actual approval or capture evidence with a staged status label.
