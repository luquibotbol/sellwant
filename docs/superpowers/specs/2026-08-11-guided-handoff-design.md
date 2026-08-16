# Guided Handoff — Design & Implementation Plan

**Date:** 2026-08-11
**Status:** Reviewed (`/plan-eng-review`, outside voice: Codex gpt-5.5)
**Depends on:** `2026-08-06-spine-design.md`

---

## 1. What this is

What happens after two people agree a price. Today `accept_offer` creates a
`lock_ins` row, reveals each party's phone and payment handles, and stops. The
row sits at `pending_payment` forever.

**SellWant never touches the ticket.** We keep only `sha256(normalised QR)`. The
two parties exchange the ticket themselves — in person, or over WhatsApp. The
handoff is coordination and record-keeping, not custody or escrow.

That single decision (D2) removes the `code_released` state and most of the
liability. It also means **the state machine records claims, not facts.** The
copy has to say so.

## 2. State machine

```
   accept_offer ─┐
                 ├─► pending_payment ─────────────────► cancelled
   createLockIn ─┘         │  buyer: "I paid"              ▲
                           ▼                               │ either party,
                         paid ──────────────────────────────┘ while open
                           │  buyer: "I got the ticket"
                           ▼
                       confirmed  (terminal)
                           │
                           ├─► both profiles: completed_deals += 1
                           └─► listing.status = 'sold'
```

| From | To | Who | Notes |
|---|---|---|---|
| `pending_payment` | `paid` | **buyer only** | Records a claim, not a verified payment |
| `paid` | `confirmed` | **buyer only** | Terminal. Fires reputation + sold |
| `pending_payment` | `cancelled` | either | Reopens listing |
| `paid` | `cancelled` | either | Reopens listing. **Records origin state** |
| `confirmed` | anything | nobody | Terminal |

Re-calling a transition already applied is a **no-op returning success**, not an
error (D13) — a double-tapped button must not look broken.

## 3. Decisions

| # | Decision |
|---|---|
| D2 | Never store or deliver the ticket. Parties exchange it themselves. `code_released` dropped |
| D3 | `advance_deal()` security-definer RPC owns all transitions; direct `UPDATE` on `lock_ins` revoked |
| D4 | Cancel reopens the listing to `active`; declined offers stay declined; who cancelled is recorded |
| D5 | Buyer alone marks paid and confirms. Confirm bumps **both** parties' `completed_deals` |
| D6 | *(revised)* Buy-now button always shown, with the top offer displayed beside it |
| D7 | Extract `lib/format.ts` first — `money()` is copy-pasted in 4 files |
| D8 | Handoff screen uses a declarative step map keyed by state × role |
| D9 | `bun test` (runtime built-in) — unit tests for the step map, live-DB tests for the auth matrix |
| D10 | Add reversed `(seller_id, buyer_id)` index for `shares_lock_in()` |
| D11 | **Accepted risk:** a buyer who never confirms strands the listing. No timeout, no seller recovery |
| D13 | Fold in idempotency, row locking, cancel provenance, migration sequencing, honest copy |

## 4. What already exists

| Exists | Reused or rebuilt |
|---|---|
| `lock_ins` table + 5-state check constraint | **Reused.** `code_released` becomes dead but stays in the constraint |
| `lock_in_locks_listing` trigger | **Reused**, extended to handle the reverse on cancel |
| `sync_ticket_code_liveness` | **Reused unchanged.** Only fires on `cancelled`; verified it does *not* free the hash on `locked` |
| `lock_ins_one_open_per_listing_idx` | **Reused unchanged.** Already partial `WHERE state <> 'cancelled'`, so a cancelled deal doesn't block a new one |
| `contact_details` + `shares_lock_in()` RLS | **Reused.** Already reveals phone/payment handles to the counterparty |
| `accept_offer()` RPC | **Reused.** Already creates the lock-in at the agreed price |
| `register_ticket_code()` | **Pattern reused** — `advance_deal()` copies its security-definer + role-check shape |
| `Card` / `Badge` / `Button` / `Avatar` | **Reused.** No new primitives needed |

Nothing here is rebuilt. The handoff is mostly wiring that already-present pieces
into a sequence.

## 5. Not in scope

| Deferred | Why |
|---|---|
| Notifications | Needs an email/push provider. The single biggest gap — a seller currently has no idea an offer was accepted |
| Reporting & moderation | No escalation path when a handoff goes wrong. `is_suspended` still has nothing that can set it |
| Deal expiry / auto-confirm | Needs `pg_cron`. Explicitly accepted as a risk in D11 |
| Seller-side "I was paid" | Ruled out by D5 — buyer-attested only |
| Disputes | `disputed` state stays reserved and undriven |
| Identity verification | Open email signup. Reputation remains farmable with two accounts |
| Ticket custody / delivery | D2. Not a deferral — a deliberate permanent no |

## 6. Failure modes

| # | Failure | Test? | Handled? | User sees |
|---|---|---|---|---|
| F1 | Seller calls a buyer-only transition | ✅ integration | ✅ RPC rejects | Clear error |
| F2 | Non-party calls `advance_deal` | ✅ integration | ✅ RPC rejects | Clear error |
| F3 | Buyer double-taps "I paid" | ✅ unit + integration | ✅ idempotent no-op | Nothing — succeeds |
| F4 | Simultaneous cancel + confirm | ✅ integration | ✅ `FOR UPDATE` row lock | One wins, other gets a clear message |
| F5 | Deal cancelled while other party's screen is open | ✅ integration | ✅ RPC rejects, screen reloads | "This deal was cancelled" |
| F6 | **Buyer never confirms** | ❌ | ❌ | **Silent. Listing locked forever** |
| F7 | Counterparty has no payment handles | ✅ unit | ✅ falls back to phone only | "No payment handle set" |
| F8 | Zelle handle (no deep link exists) | ✅ unit | ✅ copy-to-clipboard, not a dead button | Tap to copy |
| F9 | Deploy revokes UPDATE before RPC live | — | ✅ migration sequencing (D13) | N/A |

**F6 is a critical gap and is being shipped knowingly** (D11). It has no test, no
handling, and fails silently. It is also the most likely way a *successful* deal
ends. Revisit before any real pilot.

## 7. Implementation

### Migration order (D13 — sequencing matters)

```
1. lib/format.ts extraction          ← no DB change, ship first
2. CREATE advance_deal() + triggers + reversed index
3. Deploy app code that calls advance_deal()
4. ONLY THEN: revoke UPDATE on lock_ins
```

Reversing 3 and 4 leaves a window where nobody can advance a deal.

### Diagrams to embed in code

- `advance_deal()` — the transition table as an ASCII comment above the function
- `app/deal/[id].tsx` — the state × role matrix above the step map
- `lock_in_locks_listing` — the lock/reopen pairing, since the two halves live apart

## 8. Implementation Tasks

Synthesized from this review's findings. Each derives from a specific finding.

- [ ] **T1 (P2, human: ~30min / CC: ~5min)** — shared — Extract `lib/format.ts`
  - Surfaced by: Code Quality D7 — `money()` verbatim in 4 files; `todayISO`/`toISODate` duplicated
  - Files: `lib/format.ts`, `app/feed.tsx`, `app/event/[id].tsx`, `app/offers.tsx`, `components/OfferBoard.tsx`, `app/create-event.tsx`, `components/ui/DateField*.tsx`
  - Verify: `bun run typecheck`; grep shows one `money(`

- [ ] **T2 (P1, human: ~3h / CC: ~25min)** — db — `advance_deal()` RPC + transition table
  - Surfaced by: Architecture D3 — `lock_ins_update_parties` permits any column by either party
  - Files: migration
  - Verify: integration tests F1–F5 pass

- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — db — Confirm trigger: `completed_deals` +1 both, listing → sold
  - Surfaced by: Architecture D5 — no trigger exists; reputation frozen
  - Files: migration
  - Verify: confirm a deal, assert both profiles increment and listing is `sold`

- [ ] **T4 (P1, human: ~1h / CC: ~10min)** — db — Cancel trigger: listing → `active`, record origin state
  - Surfaced by: Architecture D4 + D13 — nothing reopens a locked listing
  - Files: migration
  - Verify: cancel from `paid`, assert listing back in feed and origin recorded

- [ ] **T5 (P2, human: ~10min / CC: ~2min)** — db — Reversed `(seller_id, buyer_id)` index
  - Surfaced by: Performance D10 — `shares_lock_in()` second OR branch unindexed
  - Files: migration
  - Verify: `EXPLAIN` shows index scan for the seller-side lookup

- [ ] **T6 (P1, human: ~4h / CC: ~35min)** — app — `app/deal/[id].tsx` + step map
  - Surfaced by: Code Quality D8 — 4 states × 2 roles = 8 cells
  - Files: `app/deal/[id].tsx`, `components/HandoffSteps.tsx`, `app/_layout.tsx`
  - Verify: unit test asserts all 8 cells yield a legal action

- [ ] **T7 (P2, human: ~1h / CC: ~10min)** — app — Payment deep links with graceful degradation
  - Surfaced by: Failure modes F7/F8 — Zelle has no deep link
  - Files: `lib/payments.ts`, `app/deal/[id].tsx`
  - Verify: unit test per handle kind; Zelle renders copy-to-clipboard

- [ ] **T8 (P2, human: ~2h / CC: ~15min)** — app — Route accepted offers and lock-ins to the deal screen
  - Surfaced by: Architecture D6 — two entry points, neither currently lands anywhere
  - Files: `app/offers.tsx`, `app/event/[id].tsx`
  - Verify: accept an offer, land on `/deal/[id]`

- [ ] **T9 (P2, human: ~30min / CC: ~5min)** — app — Buy-now always visible, top offer beside it
  - Surfaced by: Cross-model tension D12 — a lowball must not suppress full-price purchase
  - Files: `app/event/[id].tsx`
  - Verify: with an open $5 offer on a $45 listing, both are visible

- [ ] **T10 (P1, human: ~4h / CC: ~30min)** — tests — `bun test` harness + auth matrix
  - Surfaced by: Test review D9 — 0/20 paths covered; 5 are the authorization boundary
  - Files: `tests/advance-deal.test.ts`, `tests/step-map.test.ts`, `package.json`
  - Verify: `bun test` green; seller cannot advance a buyer-only transition

- [ ] **T11 (P2, human: ~1h / CC: ~10min)** — copy — Claim-not-fact wording throughout
  - Surfaced by: Outside voice D13 — a formal transaction UI implies verification we never do
  - Files: `app/deal/[id].tsx`, `components/HandoffSteps.tsx`
  - Verify: no string implies SellWant verified payment or holds a ticket

## 9. Parallelization

| Step | Modules | Depends on |
|---|---|---|
| T1 format extraction | `lib/`, `app/`, `components/` | — |
| T2–T5 migrations | database | — |
| T6, T7, T9, T11 screen | `app/`, `components/` | T1, T2 |
| T8 routing | `app/` | T6 |
| T10 tests | `tests/` | T2, T6 |

```
Lane A: T1 → (blocks screen work; touches many app files)
Lane B: T2 → T3 → T4 → T5   (sequential, all one migration chain)
Lane C: T6 → T7 → T9 → T11 → T8   (sequential, shared app/deal screen)
Lane D: T10   (needs B and C)

Launch A and B in parallel. Merge A before starting C.
```

**Conflict flag:** Lane A touches `app/` files that Lane C also edits. Merge A
first rather than running them concurrently.
