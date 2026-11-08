/** Scheduled, durable watcher. Database leases fence staging/completion; the
 * persisted operation key/payload make stale senders and process restarts safe.
 * Trading always uses the scoped capability and public anon transport, never
 * the service-role queue credential. Unknown sends retain the exact proposal.
 */
import {
  AgentFailure, agentConfiguration, agentJson, agentText, agentRpc, agentUuid, negotiationSchema,
  proposeNegotiation, type AgentAiEnv, type AgentConfig, type AgentTerms,
  type AgentDiagnostic, type PublicAgentOffer,
} from './ai';
import { scanActiveMarket } from './market';
import * as z from 'zod/v4';

/** Matches handleMcp's own RESPONSE_LIMIT, the most /mcp will ever send. */
const WATCH_REPLY_LIMIT = 1024 * 1024;

const operationSchema = z.strictObject({ operation_key: agentUuid, context_hash: z.string().regex(/^[0-9a-f]{64}$/),
  proposal: negotiationSchema.extend({ model: z.string().min(1).max(100), response_id: z.string().min(1).max(200) }) });
const jobSchema = z.strictObject({
  id: agentUuid, mandate_id: agentUuid, capability_id: agentUuid, expires_at: z.string(), lease_token: agentUuid,
  last_context_hash: z.string().nullable(), scan_cursor: z.string().nullable(), offer_cursor: z.string().nullable(), ciphertext: z.string(),
  pending: operationSchema.nullable(), own_offer_ids: z.array(agentUuid).max(100),
});
type Job = z.infer<typeof jobSchema>;
type Operation = z.infer<typeof operationSchema>;
type Service = { config: AgentConfig; key: string };
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unbase64(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function encryptionKey(env: AgentAiEnv) {
  try {
    const bytes = unbase64(env.AGENT_WATCHER_ENCRYPTION_KEY || '');
    if (bytes.byteLength !== 32) throw new Error();
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch { throw new AgentFailure('invalid_configuration'); }
}
export async function encryptAgentCapability(env: AgentAiEnv, token: string, mandateId: string, capabilityId: string): Promise<string> {
  if (!/^swcap_[0-9a-f]{64}$/.test(token)) throw new AgentFailure('invalid_input');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: new TextEncoder().encode(`${mandateId}:${capabilityId}`) }, await encryptionKey(env), new TextEncoder().encode(token));
  return `v1.${base64(iv)}.${base64(new Uint8Array(bytes))}`;
}
async function decryptCapability(env: AgentAiEnv, job: Job): Promise<string> {
  try {
    const parts = job.ciphertext.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') throw new Error();
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(parts[1]),
      additionalData: new TextEncoder().encode(`${job.mandate_id}:${job.capability_id}`) }, await encryptionKey(env), unbase64(parts[2]));
    const token = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!/^swcap_[0-9a-f]{64}$/.test(token)) throw new Error();
    return token;
  } catch { throw new AgentFailure('invalid_configuration'); }
}
function service(env: AgentAiEnv): Service {
  const key = env.SUPABASE_SECRET_KEY || '';
  try {
    if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) {
      const parts = key.split('.');
      if (parts.length !== 3 || JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role !== 'service_role') throw new Error();
    }
    return { config: agentConfiguration(env), key };
  } catch { throw new AgentFailure('invalid_configuration'); }
}
function queue(s: Service, name: string, payload: Record<string, unknown>) {
  return agentRpc(s.config, name, payload, { service: s.key, mutation: true });
}
async function finish(s: Service, job: Job, state: 'active' | 'finished' | 'blocked', options: {
  context?: string | null; cursor?: string | null; offerCursor?: string | null; operation?: Operation; result?: unknown;
  error?: AgentFailure['code']; diagnostic?: AgentDiagnostic;
} = {}) {
  const saved = await queue(s, 'finish_agent_watch', { p_watch_id: job.id, p_lease_token: job.lease_token, p_state: state,
    p_context_hash: options.context ?? null, p_scan_cursor: options.cursor ?? null,
    p_operation_key: options.operation?.operation_key ?? null, p_result: options.result ?? null, p_error: options.error ?? null,
    p_offer_cursor: options.offerCursor ?? null,p_advance_offer_cursor: 'offerCursor' in options,p_diagnostic: options.diagnostic ?? null });
  if (saved !== true) throw new AgentFailure('unknown');
  return true;
}
/** Public-offer discovery reuses the product MCP tool/whitelist. No service key
 * or human JWT is sent here. Stateless transport permits this bounded tool call. */
async function publicOffers(config: AgentConfig, token: string, listingId: string, cursor: string | null) {
  const requestId = crypto.randomUUID();
  const response = await fetch(`${config.origin}/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, origin: config.origin,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method: 'tools/call',
      // Sized from offers_message_bounded (500 chars): 51 rows of 4-byte text
      // fit the MCP page cap, and the reply (which carries the page twice)
      // fits WATCH_REPLY_LIMIT, so data users write cannot overflow either.
      params: { name: 'get_public_offers', arguments: { listing_id: listingId, page_size: 50, ...(cursor ? {cursor} : {}) } } }),
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new AgentFailure([401, 403].includes(response.status) ? 'denied' : 'unavailable'); }
  const type = response.headers.get('content-type')?.toLowerCase() || '';
  let data: unknown;
  if (type.startsWith('application/json')) data = await agentJson(response, WATCH_REPLY_LIMIT);
  else if (type.startsWith('text/event-stream')) {
    const events = (await agentText(response, WATCH_REPLY_LIMIT)).replace(/\r\n/g, '\n').split('\n\n');
    const results: unknown[] = [];
    for (const event of events) {
      const lines = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart());
      if (lines.length) results.push(JSON.parse(lines.join('\n')));
    }
    data = results.find(value => object(value) && value.id === requestId);
  } else throw new AgentFailure('unavailable');
  if (!object(data) || data.id !== requestId || !object(data.result) || data.result.isError || !object(data.result.structuredContent)) throw new AgentFailure('unavailable');
  const result = data.result.structuredContent.result;
  const offer = z.strictObject({ id: agentUuid, listing_id: agentUuid, parent_offer_id: agentUuid.nullable(),
    amount_cents: z.number().int().min(1).max(2147483647), message: z.string().nullable(), created_at: z.string(), is_poster: z.boolean() });
  const page = z.strictObject({ listing_id: agentUuid, status: z.enum(['active', 'not_found']),
    offers: z.array(offer).max(100), complete: z.boolean(), next_cursor: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/).nullable() }).parse(result);
  if (page.listing_id !== listingId || page.offers.some(o => o.listing_id !== listingId)) throw new AgentFailure('unavailable');
  if (page.complete ? page.next_cursor !== null : !page.next_cursor || page.next_cursor === cursor || page.offers.length === 0) throw new AgentFailure('unavailable');
  if (page.status === 'not_found' && (!page.complete || page.offers.length !== 0)) throw new AgentFailure('unavailable');
  return page;
}
async function terms(config: AgentConfig, token: string, job: Job): Promise<AgentTerms> {
  const raw = await agentRpc(config, 'agent_get_mandate', { p_token: token });
  if (!object(raw) || raw.id !== job.mandate_id || !object(raw.listing_snapshot)) throw new AgentFailure('denied');
  const shape = z.object({ id: agentUuid, listing_id: agentUuid, side: z.enum(['buy', 'sell']), bound_cents: z.number().int().positive(),
    currency: z.literal('USD'), status: z.string(), expires_at: z.string(), max_rounds: z.number().int(), rounds_used: z.number().int() });
  const value = shape.parse(raw);
  return { ...value, is_poster: value.side === (raw.listing_snapshot.type === 'sell' ? 'sell' : 'buy') };
}
async function hash(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Exact persisted proposal -> guarded action. Never regenerate a pending or
 * unknown mutation. Authority, expiry, rounds and participant roles revalidate
 * in agent_mandate_action, including after transactional lock waits. */
async function send(config: AgentConfig, token: string, operation: Operation) {
  const p = operation.proposal;
  const result = await agentRpc(config, 'agent_mandate_action', { p_token: token, p_operation_key: operation.operation_key,
    p_action: p.action, p_amount_cents: p.amount_cents, p_offer_id: p.offer_id, p_parent_offer_id: p.parent_offer_id,
    p_message: p.message, p_explanation: p.explanation, p_model: p.model }, { mutation: true });
  if (!object(result) || !['succeeded', 'rejected'].includes(result.status as string) || !agentUuid.safeParse(result.id).success) throw new AgentFailure('unknown');
  // Do not persist arbitrary upstream objects or SQL error text in job receipts.
  return { id: result.id, status: result.status,
    ...(agentUuid.safeParse(result.offer_id).success ? { offer_id: result.offer_id } : {}),
    ...(agentUuid.safeParse(result.deal_id).success ? { deal_id: result.deal_id } : {}),
    ...(result.status === 'rejected' ? { error: 'proposal_rejected_by_database' } : {}) };
}
async function runJob(env: AgentAiEnv, s: Service, job: Job): Promise<'finished' | 'deferred'> {
  let operation: Operation | undefined = job.pending || undefined;
  try {
    const token = await decryptCapability(env, job);
    if (!operation) {
      const mandate = await terms(s.config, token, job);
      if (mandate.status === 'consumed' || mandate.rounds_used >= mandate.max_rounds) {
        await finish(s, job, 'finished'); return 'finished';
      }
      if (mandate.status !== 'approved' || Date.parse(mandate.expires_at) <= Date.now()) throw new AgentFailure('denied');
      const market = await scanActiveMarket({ origin: s.config.origin, cursor: job.scan_cursor, pageSize: 100, maxPages: 2 });
      const listing = market.listings.find(l => l.id === mandate.listing_id);
      if (!listing) {
        // Persist continuation so inventory beyond a bounded batch is eventually
        // visited. Once a scan ends, the next scheduled run starts fresh.
        await finish(s, job, 'active', { cursor: market.next_cursor }); return 'deferred';
      }
      const page = await publicOffers(s.config, token, listing.id, job.offer_cursor);
      if (page.status !== 'active') { await finish(s, job, 'active'); return 'deferred'; }
      const context = await hash({ listing, offers: page.offers, complete: page.complete,
        own_offer_ids: job.own_offer_ids, mandate });
      if (context === job.last_context_hash) { await finish(s, job, 'active', { context, offerCursor: page.next_cursor }); return 'deferred'; }
      const generated = await proposeNegotiation(env, { terms: mandate, listing, offers: page.offers as PublicAgentOffer[],
        own_offer_ids: job.own_offer_ids, offers_complete: page.complete });
      if (generated.proposal.action === 'wait') { await finish(s, job, 'active', { context, offerCursor: page.next_cursor }); return 'deferred'; }
      const proposed = { operation_key: crypto.randomUUID(), context_hash: context,
        proposal: { ...generated.proposal, model: generated.model, response_id: generated.response_id } };
      // A lost stage response means no send. The next lease reads the durable
      // operation (if committed), or safely generates a new unsent proposal.
      operation = operationSchema.parse(await queue(s, 'stage_agent_watch_operation', {
        p_watch_id: job.id, p_lease_token: job.lease_token, p_operation_key: proposed.operation_key,
        p_context_hash: proposed.context_hash, p_proposal: proposed.proposal, p_next_offer_cursor: page.next_cursor }));
    }
    const result = await send(s.config, token, operation);
    const done = 'deal_id' in result;
    await finish(s, job, done ? 'finished' : 'active', { context: operation.context_hash, operation, result });
    return done ? 'finished' : 'deferred';
  } catch (error) {
    const failure = error instanceof AgentFailure ? error : new AgentFailure('unavailable');
    const blocked = ['denied', 'invalid_configuration', 'invalid_proposal', 'model_refused', 'account_required'].includes(failure.code);
    // A denied pending receipt cannot be read by a revoked/expired token. Keep
    // its operation and explicit unknown result for owner review; never bypass
    // capability checks using the service key or manufacture a replacement.
    await finish(s, job, blocked ? 'blocked' : 'active', {
      operation, error: failure.code as AgentFailure['code'], context: operation?.context_hash,diagnostic: failure.diagnostic,
    }).catch(() => { /* lease expiry is recovery; no local state claims success */ });
    return 'deferred';
  }
}
export async function runAgentWatchers(env: AgentAiEnv, options: { limit?: number } = {}) {
  if (env.AGENT_WATCHER_ENABLED !== 'true' || env.AGENT_AI_ENABLED !== 'true') return { claimed: 0, finished: 0, deferred: 0 };
  const s = service(env);
  const limit = options.limit ?? 4;
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new AgentFailure('invalid_input');
  const jobs = z.array(jobSchema).max(limit).parse(await queue(s, 'claim_agent_watches', { p_limit: limit }));
  // Parallel jobs avoid leases expiring while earlier model calls are running.
  const results = await Promise.all(jobs.map(job => runJob(env, s, job)));
  return { claimed: jobs.length, finished: results.filter(r => r === 'finished').length,
    deferred: results.filter(r => r === 'deferred').length };
}
