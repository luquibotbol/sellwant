# Hackathon work

- Work on `hackathon/paypal-ai-2026`; never push/merge main or dispatch the existing deployment workflow.
- Brief: `SellWant_Codex_Prompt.md`. Facts/setup: `docs/hackathon/BASELINE.md`. Authoritative progress: `docs/hackathon/EXECUTION_PLAN.md`.
- Reuse `sellwant/services/data.ts`, public offers, existing deal RPCs and Worker. The checked-in migrations lack the base schema; recover it before modifying core functions.
- Run commands in `sellwant/`. Safe checks: `bun run typecheck`, `bun run test:offline`. Full `bun run test` mutates a shared database; never run against production.
- User approval creates authority. LLMs/agent tokens cannot approve mandates, expand limits, attest physical handoff or approve PayPal payment. Validate limits/revocation/expiry/rounds/roles inside the transaction.
- Keep money in integer cents, approval/authorization/handoff/capture distinct, mutations idempotent and capture/cancel serialized. Sandbox only. Unknown remote outcomes require reconciliation.
- Preserve RLS, private contacts and completed prices. Public discovery: active listings only. Never send raw ticket QR payloads to an agent; hashes do not establish authenticity.
- After each milestone, run relevant checks, update tracker, and state verified vs blocked accurately. Do not call mocked integrations complete.
- Responses must be short and direct, without icons or emojis.
