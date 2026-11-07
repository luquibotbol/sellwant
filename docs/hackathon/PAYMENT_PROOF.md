# PayPal sandbox proof

Latest provider reconciliation: November 6, 2026 (UTC). Sandbox only; no
production or marketplace mutation. Credentials, payer information and approval
links are excluded from this record.

## November 6: capture resource unavailable, buyer availability required

Performed one read-only reconciliation of both existing November 5 resources.

| Resource | Current provider evidence |
| --- | --- |
| Capture order `0M315443YG505872E` | At `2026-11-06T05:45:31.550Z`, GET returned HTTP 404, `INVALID_RESOURCE_ID`, debug `f159268a1ac17` |
| Void order `21V19307KS044112F` | At `2026-11-06T05:45:32.347Z`, order state `COMPLETED`; direct authorization read returned `14F6288189074490Y`, `VOIDED` |
| Void association / amount / receiver | Exact order, deal references, 1665 cents/USD and configured sandbox merchant verified; provider captures empty |
| Human test handoff | Absent from both private journals |

The capture order is no longer readable. Its current provider authorization or
capture state cannot be established by that 404; do not infer absence of funds
from an unreadable resource. The preserved private journal has no authorization
ID, capture ID or handoff, and its last successful provider read is recorded
below. No financial operation or unknown mutation was introduced by this check.

The capture journal's existing authorization key exceeded its five-hour retry
guard at `2026-11-06T00:08:38.552Z`. No authorization retry, request-ID rotation,
journal deletion or guard bypass was attempted. Any new experiment must retain
the old journals and account for the unavailable resource; it must not silently
replace an unknown financial operation.

Buyer availability remains unconfirmed. No new order or approval link was
generated and no approval, authorization, handoff, capture or void was performed.
The manager's buyer-availability question remains pending. Do not poll. A later
human handoff confirmation remains distinct from checkout approval.

The restricted invocation at `2026-11-06T05:45:15.232Z` could not reach OAuth
(`OAUTH_UNAVAILABLE`); the required network-permission rerun produced the results
above. These are executions of one reconciliation approach, not two distinct
technical-blocker attempts. No further provider attempt followed the 404.

All four journals remain unchanged, with directory mode `0700`, file mode `0600`
and no locks. No environment/configuration file was overwritten or secret printed.
The reconciliation command is terminal; no process or tool handle remains live.

## Historical November 5 capture read: awaiting the buyer

Read at `2026-11-05T23:30:27.546Z` using `PayPalSandbox.getOrder` and the existing
private journal's immutable expectation:

| Field | Verified result |
| --- | --- |
| Deal | `demo-capture-20261105-01` |
| Order | `0M315443YG505872E` |
| Provider order state | `PAYER_ACTION_REQUIRED` |
| Expected amount / currency | 1665 cents / USD |
| Association / receiver | Order ID, deal references, amount, currency and configured sandbox merchant matched |
| Provider authorizations / captures | None / none |
| Human test handoff | Absent |

Buyer checkout approval is required. Buyer availability is unconfirmed; no new
order or replacement approval link was generated. No authorization, handoff or
capture was attempted in this session. This is an unresolved human gate, not a
technical failure. Do not poll it.

After the buyer approves, re-read the provider, verify authorization, then obtain
an explicit human simulated-handoff confirmation before recording handoff or
capturing. Checkout approval does not attest handoff. Confirm final capture by
provider readback with the exact amount and order/authorization association.

The existing authorization operation key was recorded at
`2026-11-05T19:08:38.552Z`. The CLI's five-hour retry guard expires at
`2026-11-06T00:08:38.552Z`; preserve that key and reconcile before resuming.
Do not delete journals or rotate request IDs to bypass the guard.

## Historical November 5 void proof: verified

Executed from `sellwant/`:

```sh
bun --env-file=.env.paypal-sandbox run paypal:sandbox status --deal-id demo-void-20261105-01
```

The real provider reconciliation at `2026-11-05T23:30:46.588Z` returned `voided` for order
`21V19307KS044112F`, authorization `14F6288189074490Y`, 1665 cents/USD, with no
capture ID or handoff. The helper verifies the order's deal, amount, currency and
merchant, then reads the associated authorization and requires provider status
`VOIDED`. This command performed no financial mutation; it refreshed the existing
private journal. Earlier authorization/void operations were preserved.

## November 5 read approach and private state

1. Hypothesis: the sandboxed process can perform the read-only provider check.
   Action: load the existing private configuration and call `getOrder`.
   Observed: `PayPal network: OAUTH_UNAVAILABLE`; no financial request was made.
2. Hypothesis: restricted network access caused the OAuth failure.
   Action: rerun the same read outside the filesystem/network sandbox with tool
   escalation, retaining the same order and expectation.
   Observed: success and the verified capture-order result above. The technical
   network blocker is resolved. The subsequent void reconciliation also passed.

The permission-required rerun above belongs to the same read approach; it is not
a second genuinely different technical-blocker attempt.

All four existing journals were inspected through a field whitelist. The journal
directory is mode `0700`, files are `0600`, and no journal locks existed before
the reads. November 4 journals remain intact; their previously documented 404
orders were not retried or replaced. Only the current void journal was refreshed.
No credentials were printed, overwritten or committed. No provider mutation,
new order, buyer approval, agent handoff attestation or capture occurred.

M1 remains incomplete until buyer approval, verified authorization, explicit human
test handoff and provider-confirmed capture are proven. Integrated authenticated
payment/handoff behavior and a real two-user browser journey remain separate
unverified requirements.
