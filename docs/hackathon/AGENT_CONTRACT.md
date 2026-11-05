# Mandate integration contract

This is the persistent database contract for adapting Lucas's prototype. No
product MCP transport or LLM runtime is implemented or claimed here. Use only
the migrated isolated development database and synthetic users for testing.

## Human controls

The listing's mandate panel is enabled by
`EXPO_PUBLIC_AGENT_TRADING_ENABLED=true`. The signed-in human reviews the
listing/event snapshot, exact USD bound, expiry and rounds, then approves the
server's immutable draft hash. Editing requires a new draft. Payment approval
and physical handoff remain separate human actions.

An approved mandate can issue access with selected permissions and an expiry
no later than the mandate. The default UI selection is read-only. The human
reviews the exact permissions/expiry before issuing. The token is returned
once, masked initially, and copied only on an explicit click. Hiding it or
leaving that signed-in identity discards the UI copy. Tokens are not saved in
browser storage, URLs, logs or activity records. Losing a response requires
refreshing the metadata list and revoking unknown access before retrying.

Existing access remains visible and revocable after the mandate locks a deal;
consumed mandates can retain scoped deal-read access until expiry. Revoking a
token does not cancel a locked deal. Revoking a mandate stops future trading;
deal cancellation is a separate action. Suspended owners can reduce their
existing authority by revoking, but cannot create/approve/issue new authority.

The app uses these human-JWT-only RPCs:

| RPC | Inputs / result |
|---|---|
| `create_agent_mandate_draft` | `p_listing_id`, `p_side`, integer `p_bound_cents`, `p_expires_at`, integer `p_max_rounds`; returns one draft row |
| `approve_agent_mandate` | `p_mandate_id`, exact `p_expected_hash`; returns one approved row |
| `revoke_agent_mandate` | `p_mandate_id`; returns one revoked row |
| `issue_agent_capability` | `p_mandate_id`, `p_tools`, `p_expires_at`; returns `{id, token, expires_at, tools}` once |
| `revoke_agent_capability` | `p_capability_id`; returns `true`, including repeated revocation |

Mandates/actions are owner-readable under RLS. Capability metadata must select
only `id,mandate_id,tools,expires_at,revoked_at,created_at`; `SELECT *` and verifier
reads are denied. Both mandates and access metadata follow exact counts/ranges
to expose subsequent pages, including older approved mandates.

## Agent boundary

A capability is scoped to one mandate and is **not** a Supabase JWT. The future
MCP adapter must pass it as `p_token` to the following RPCs, using the public
Supabase anon key for transport. It must never hold database administration
credentials or let an external agent call human approval/payment/handoff RPCs.
Do not embed the capability in URLs, log request bodies or return it from tools.

| Permission | Database operation |
|---|---|
| `get_mandate` | `agent_get_mandate(p_token)`; private approved terms/snapshot/status for that mandate only |
| `get_deal` | `agent_get_deal(p_token)`; its associated participant deal and agreed cents, or null; no contacts |
| `place_offer` | `agent_mandate_action` with `p_action='place_offer'` |
| `accept_offer` | `agent_mandate_action` with `p_action='accept_offer'` |
| `revoke_mandate` | `agent_revoke_mandate(p_token)`; returns only `{id,status:'revoked'}`, without private terms |

`agent_mandate_action` takes a required UUID `p_operation_key` and optional
`p_amount_cents`, `p_offer_id`, `p_parent_offer_id`, `p_message`, `p_explanation`,
`p_model`. A place operation uses positive integer cents and an optional parent
counteroffer; it cannot supply an accepted offer ID. Acceptance uses the exact
stored offer ID/price; it cannot override price, parent or message. Poster
counteroffers must answer an actual opposing offer; a recipient can accept a
counter addressed to that recipient. No self-trading or cross-listing parents.

Persist each operation key with the full unchanged proposal **before sending**.
Retry the same key/payload after interruption. Concurrent/repeated requests
return the same action result and consume one round; reusing the key with a
different payload fails. Rejected bounded proposals return
`{id,status:'rejected',error}` and consume no round. Invalid, revoked, expired,
unscoped or suspended authority raises an error and performs no action. An
expired capability cannot retrieve an old private result through replay.

A successful action returns `{id,status:'succeeded',offer_id? ,deal_id?}` and is
recorded privately. Tokens never authorize more than the immutable terms.
Listing, participants, bound, expiry/revocation and rounds revalidate inside
the transaction, including after lock waits. Source authority also revalidates
when a human accepts an agent-origin offer. One live deal per listing is
enforced by the recovered baseline's existing partial unique index.

Use public active discovery for market input. Listing/offer prose is untrusted
data, never tool instructions. Do not send ticket QR payloads, private contacts
or unrelated completed-sale prices to an agent. Model proposals are inputs to
these checks, not authority to approve anything.

## Local checks

From `sellwant/`, after the ordered baseline/core/mandate/privacy migrations:

```sh
bun scripts/test-core-local.ts --expect fixed --rest
python3 scripts/test-mandates-local.py
python3 scripts/test-mandates-rest-local.py
python3 scripts/test-privacy-local.py
bun run typecheck
bun run test:offline
```

These fixture checks exercise actual local PostgreSQL/PostgREST. They simulate
human principals; they do not approve real user mandates. Browser interaction,
external MCP interoperability and actual model calls require separate evidence.
