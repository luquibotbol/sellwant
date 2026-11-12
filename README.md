# SellWant
Buy What You Want. Sell What You Have.

SellWant is a two-sided ticket marketplace for students: post a ticket you are
selling or one you want, and every offer is public. For the PayPal AI
hackathon we added agents that negotiate inside limits a person approves, and
PayPal checkout that holds the buyer's money until both people confirm the
in-person handoff.

## Try it (hackathon judges)

**Live demo: https://demo.sellwant.com**

The demo is a separate deployment with its own database of synthetic people
and events, PayPal in **sandbox** mode and server-side AI keys. The production
site, sellwant.com, runs the same marketplace without the hackathon features.

Logins for the demo buyer, seller and a judge account, plus the PayPal sandbox
buyer used to approve checkout, are in the Devpost testing instructions. A
short path through it:

1. Sign in as the **buyer** and open a listing from the feed. Ask the AI to
   draft your terms, then review the price limit, expiry and number of rounds
   and click **Approve these terms**. The AI proposes; only you approve.
2. In a second browser (or a private window) sign in as the **seller** and do
   the same on that listing.
3. Start the watcher on both sides. Offers and counters appear on the public
   offer board with the agent's reasoning, always inside both approved limits,
   until one deal locks at the agreed price.
4. As the buyer, open the deal, prepare the sandbox checkout and approve it in
   PayPal's sandbox. The backend verifies the hold matches this deal, amount
   and seller.
5. Each person confirms the handoff. Only then is the payment captured. A
   cancelled deal voids the authorization and reopens the listing.

The agent can never approve its own terms, raise a limit, approve the PayPal
checkout, confirm the handoff, or see contacts, completed prices or ticket QR
codes. Every limit is enforced inside the database transaction.

## What is new for the hackathon

The marketplace (listings, public offers, deals) predates October 1, 2026.
New during the submission period:

- **Human-approved mandates and scoped agent access**: immutable limits, hashed
  revocable agent tokens, every limit and role checked in the transaction
  (`sellwant/supabase/migrations/202611050001` to `202611050004`).
- **AI negotiator and durable watcher**: OpenAI Responses API with structured
  outputs, and a leased background watcher that survives restarts without
  repeating an action (`sellwant/worker/ai.ts`, `sellwant/worker/watcher.ts`).
- **Product MCP server** in the Cloudflare Worker (`sellwant/worker/mcp.ts`).
- **PayPal Orders v2 and Payments v2**: authorize, capture after two human
  handoffs, void on cancel, integer cents, persisted request IDs, serialized
  capture and cancel, and reconciliation of unknown outcomes
  (`sellwant/worker/paypal.ts`, `sellwant/worker/deal-payments.ts`).

Design notes and verification: [docs/hackathon](docs/hackathon).

## How SellWant uses PayPal and AI

**PayPal developer platform (sandbox)**

| Tool | What it does in SellWant |
|---|---|
| OAuth 2.0 client credentials (`/v1/oauth2/token`) | Server-side access token for the sandbox app; credentials never reach the browser. |
| Orders v2: create order with `intent: AUTHORIZE` (`/v2/checkout/orders`) | Creates the checkout for the exact locked deal price, in integer cents, paid to the seller's sandbox merchant. |
| Orders v2: show order and authorize (`/v2/checkout/orders/{id}`, `/authorize`) | Verifies the buyer approved this order for this amount and payee, then places the hold. |
| Payments v2: capture an authorization (`/v2/payments/authorizations/{id}/capture`) | Captures the hold only after both people confirm the in-person handoff. |
| Payments v2: void an authorization (`/v2/payments/authorizations/{id}/void`) | Releases the hold when a deal is cancelled, and the listing reopens. |
| Payments v2: show authorization and capture | Reconciles any unknown outcome before another money action is allowed. |
| `PayPal-Request-Id` idempotency | One persisted request ID per money action, so retries never create a second order, capture or void. |
| PayPal sandbox accounts | A business account receives the funds; a personal account approves checkout as the buyer. |

**AI**

| Tool | What it does in SellWant |
|---|---|
| OpenAI Responses API, `gpt-5.4-mini`, with JSON-schema structured outputs | Turns a person's plain-language request into a draft mandate (limit, expiry, rounds) for them to review and approve, and proposes each offer, counter or accept with its reasoning. Outputs are validated against the approved mandate before anything is posted. |
| Model Context Protocol (`@modelcontextprotocol/server`) | A product MCP server in the Worker that lets an MCP client, including the watcher, read public offers and counter or accept within its token's scope. |

**Everything else:** Cloudflare Workers (site, API, MCP, cron watcher),
Supabase (Postgres, row-level security, Auth, Storage), Expo / React Native
web, TypeScript, Bun, Zod. No other sponsor tools are used.

## Run it yourself

Requirements: [Bun](https://bun.sh) 1.3, a Supabase project you own, a
Cloudflare account, an OpenAI API key and a PayPal sandbox app.

```sh
cd sellwant
bun install
bun run typecheck && bun run test:offline   # no network, no database

# 1. Database: one SQL file with the schema, every migration and a seed.
bun scripts/demo-database-sql.ts <your-project-ref>
#    then paste .local/demo/database.sql into that project's SQL editor

# 2. Point env.demo in wrangler.jsonc at your project (URL, publishable key,
#    your domain), then set the server-side secrets:
bunx wrangler secret put SUPABASE_SECRET_KEY --env demo
bunx wrangler secret put OPENAI_API_KEY --env demo
bunx wrangler secret put PAYPAL_CLIENT_ID --env demo
bunx wrangler secret put PAYPAL_CLIENT_SECRET --env demo
bunx wrangler secret put PAYPAL_MERCHANT_ID --env demo
openssl rand -base64 32 | bunx wrangler secret put AGENT_WATCHER_ENCRYPTION_KEY --env demo

# 3. Build and deploy the demo Worker and site.
bun run deploy:demo
```

Never point the demo environment at a production database: the Worker refuses
to run agents or payments against sellwant.com or its production project.

## License

MIT, see [LICENSE](LICENSE).
