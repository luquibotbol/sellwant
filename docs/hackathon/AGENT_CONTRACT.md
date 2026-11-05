# Mandate integration contract

This is the persistent database contract and in-repository MCP integration.
The user clarified that this repository is Lucas's handoff; no separate
prototype is required. Use only the migrated isolated development database and
synthetic users for testing. LLM runtime, durable watching and browser approval
verification remain separate work.

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

The Worker exposes `/mcp` using the official SDK's stateless Web Standard
transport. It is disabled unless `AGENT_MCP_ENABLED=true`, and requires the exact
`AGENT_MCP_ORIGIN` plus isolated `SUPABASE_URL`/`SUPABASE_ANON_KEY`. The known
production origin/database are rejected. Each HTTP request authenticates
`Authorization: Bearer <capability>` through `agent_get_access(p_token)`; only
`{id,mandate_id,tools,expires_at}` is returned. This context grants no new tool
scope or private mandate read. Revocation, expiry and suspension revalidate on
later requests and inside the existing action RPCs.

Use a Streamable HTTP client that can supply the Bearer header. General OAuth
discovery is not implemented. Request origins/hosts, input sizes and strict
tool schemas are checked; credentials and SQL errors are not reflected in
responses. A client must persist each mutation's operation UUID and unchanged
payload. An unknown result retains that UUID and requires reconciliation.

A capability is scoped to one mandate and is **not** a Supabase JWT. The MCP
transport passes it as `p_token` to the following RPCs, using the public
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

All valid capabilities also receive these public read tools. Responses never
include contacts, account IDs, mandate bounds or inactive offer prices.

| MCP tool | Public result |
|---|---|
| `search_listings` | Bounded active listing batch, optional title/type filters, `complete` and `next_cursor` |
| `get_going_rate` | Active listing's exact cents or explicit `no_offers`; incomplete scans return continuation rather than claiming absence |
| `get_public_offers` | Open offer IDs, listing/parent IDs, cents, message/time and `is_poster` for one active listing; stable listing-bound cursor |

`get_public_offers` takes `listing_id`, optional `page_size` (1–100) and optional
`cursor`. This lets an agent discover the actual IDs needed to counter or
accept. Only open offers on active listings are readable. The listing-owner
role is a boolean; underlying account IDs are not returned. Public upstream
JSON is streamed with byte bounds before parsing; exact counts prevent a
short PostgREST page from falsely ending discovery.

MCP mutation tools require `operation_key`; receipt/error results are JSON text
and `structuredContent.result`. Revoke returns only id/status plus the supplied
correlation key. A revoked token cannot authenticate a receipt retry, so an
unknown revoke outcome requires owner review. No agent tool approves human
terms, advances handoff, authorizes PayPal or captures payment.

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
python3 scripts/test-agent-access-local.py
python3 scripts/test-mcp-local.py
bun run typecheck
bun run test:offline
```

To connect a client to an isolated local endpoint:

```sh
python3 scripts/mcp-local-server.py
```

The launcher validates the fixed local Supabase project and prints a loopback
MCP endpoint. Create a capability through the human mandate panel and supply it
as the client's Bearer token. The launcher does not create/approve mandates,
start a model or deploy a watcher. Stop it with Ctrl-C.

These fixture checks exercise actual local PostgreSQL/PostgREST and an official
MCP client across a loopback Worker process restart. They simulate human
principals; they do not approve real user mandates. Browser interaction,
hosted external-client compatibility and actual model calls require separate
evidence.

Verified locally: 55 real access-context SQL/REST checks; 26 actual official
SDK-client/Worker/PostgREST groups, including public offer discovery, bounded
counter/accept, process restart, idempotency and revoked-read denial; 230 offline
tests; typecheck; and an isolated Worker dry-run. All owned SQL fixtures and
child listeners were cleaned. The local launcher was started, returned 401
without a capability, and stopped with its listener confirmed closed.
