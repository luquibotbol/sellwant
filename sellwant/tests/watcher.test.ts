import { afterEach, describe, expect, test } from 'bun:test';
import { encryptAgentCapability, runAgentWatchers } from '../worker/watcher';
import { type AgentTransport } from '../worker/ai';
import { env, ids, listing, modelResponse, offers, place, terms, token, wait } from './ai-fixtures';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
type RecordValue = Record<string, any>;

/** Fixture transport models lost replies and persistent receipts at the API
 * boundary. Real PostgreSQL lease/RLS/idempotency proof is a separate script. */
async function fixture(options: { loseSend?: boolean; loseStage?: boolean; rejectStage?: boolean; staleFinish?: boolean;
  providerQuota?: boolean; sse?: boolean; proposal?: unknown; publicPages?: RecordValue[] } = {}) {
  let pending: RecordValue | null = null;
  let lease = 0;
  let offerCursor: string | null = null;
  let loseSend = options.loseSend || false;
  let loseStage = options.loseStage || false;
  const calls: { endpoint: string; payload: RecordValue; headers: Headers }[] = [];
  const receipts = new Map<string, RecordValue>();
  let models = 0;
  let state = 'active';
  let lastContext: string | null = null;
  const ciphertext = await encryptAgentCapability(env, token, ids.mandate, ids.capability);
  const job = () => ({ id: ids.watch, mandate_id: ids.mandate, capability_id: ids.capability,
    expires_at: terms.expires_at, lease_token: lease % 2 ? ids.lease : ids.counter,
    last_context_hash: lastContext, scan_cursor: null, offer_cursor: offerCursor, ciphertext, pending,
    own_offer_ids: [...receipts.values()].filter(r => r.offer_id).map(r => r.offer_id),
  });
  globalThis.fetch = (async (target, init) => {
    const url = new URL(String(target));
    const payload = init?.body ? JSON.parse(String(init.body)) : {};
    const headers = new Headers(init?.headers);
    calls.push({ endpoint: url.origin + url.pathname, payload, headers });
    if (url.origin === 'https://api.openai.com') {
      models++;
      if (options.providerQuota) return Response.json({ error: { code: 'credit_balance_exhausted', type: 'insufficient_quota', message: 'Do not reflect this' } },
        { status: 429, headers: { 'x-request-id': 'req_fixture1234' } });
      return modelResponse(options.proposal || place);
    }
    if (url.pathname === '/api/listings.json') return Response.json({ listings: [listing], count: 1, has_more: false, next_cursor: null, next_url: null });
    if (url.pathname === '/mcp') {
      const cursor = payload.params.arguments.cursor;
      const page = options.publicPages?.[cursor ? 1 : 0] || { listing_id: ids.listing, status: 'active', offers, complete: true, next_cursor: null };
      const result = { jsonrpc: '2.0', id: payload.id, result: { content: [], structuredContent: { result: page } } };
      return options.sse ? new Response(`event: message\ndata: ${JSON.stringify(result)}\n\n`, { headers: { 'content-type': 'text/event-stream' } }) : Response.json(result);
    }
    if (url.pathname.endsWith('/claim_agent_watches')) {
      lease++; return Response.json(state === 'active' ? [job()] : []);
    }
    if (url.pathname.endsWith('/agent_get_mandate')) return Response.json({ ...terms,
      listing_snapshot: { type: 'sell', title: listing.title, raw_qr: 'PRIVATE_RAW_QR', private_contact: 'PRIVATE_CONTACT' } });
    if (url.pathname.endsWith('/stage_agent_watch_operation')) {
      if (options.rejectStage) return Response.json({ error: 'stale lease' }, { status: 403 });
      pending = { operation_key: payload.p_operation_key, context_hash: payload.p_context_hash, proposal: payload.p_proposal };
      offerCursor = payload.p_next_offer_cursor;
      if (loseStage) { loseStage = false; throw new Error('lost staged response'); }
      return Response.json(pending);
    }
    if (url.pathname.endsWith('/agent_mandate_action')) {
      let receipt = receipts.get(payload.p_operation_key);
      if (!receipt) {
        receipt = { id: ids.receipt, status: 'succeeded', offer_id: ids.own };
        receipts.set(payload.p_operation_key, receipt);
      }
      if (loseSend) { loseSend = false; throw new Error('lost committed action reply'); }
      return Response.json(receipt);
    }
    if (url.pathname.endsWith('/finish_agent_watch')) {
      if (options.staleFinish) return Response.json(false);
      if (payload.p_result) pending = null;
      state = payload.p_state;
      if (payload.p_context_hash) lastContext = payload.p_context_hash;
      if (payload.p_advance_offer_cursor) offerCursor = payload.p_offer_cursor;
      return Response.json(true);
    }
    throw new Error('Unexpected fixture endpoint');
  }) as AgentTransport;
  return { calls, receipts, models: () => models, pending: () => pending, state: () => state, cursor: () => offerCursor };
}

describe('durable watcher orchestration (fixture transport)', () => {
  test('disabled scheduler has no credential or network use', async () => {
    let calls = 0; globalThis.fetch = (async () => { calls++; throw new Error(); }) as unknown as AgentTransport;
    expect(await runAgentWatchers({})).toEqual({ claimed: 0, finished: 0, deferred: 0 }); expect(calls).toBe(0);
  });
  test('persisted operation precedes trade; service key stays only at queue endpoints', async () => {
    const f = await fixture(); await runAgentWatchers(env);
    const stage = f.calls.findIndex(c => c.endpoint.endsWith('/stage_agent_watch_operation'));
    const send = f.calls.findIndex(c => c.endpoint.endsWith('/agent_mandate_action'));
    expect(stage).toBeGreaterThan(0); expect(send).toBeGreaterThan(stage);
    expect(f.calls[send].payload.p_operation_key).toBe(f.calls[stage].payload.p_operation_key);
    for (const call of f.calls) {
      if (/claim_agent_watches|stage_agent_watch_operation|finish_agent_watch/.test(call.endpoint)) {
        expect(call.headers.get('apikey')).toBe(env.SUPABASE_SECRET_KEY!); expect(JSON.stringify(call.payload)).not.toContain(token);
      } else if (call.endpoint.includes('/rest/v1/')) {
        expect(call.headers.get('apikey')).toBe(env.SUPABASE_ANON_KEY!); expect(call.headers.get('authorization')).toBeNull();
      } else if (call.endpoint.endsWith('/mcp')) {
        expect(call.headers.get('authorization')).toBe(`Bearer ${token}`); expect(call.headers.get('apikey')).toBeNull();
      } else if (call.endpoint.includes('api.openai.com')) {
        const body = JSON.stringify(call.payload);
        for (const secret of [token, env.SUPABASE_SECRET_KEY!, 'PRIVATE_RAW_QR', 'PRIVATE_CONTACT']) expect(body).not.toContain(secret);
      }
    }
  });
  test('unknown committed send replays same proposal/key after a new lease without another model call', async () => {
    const f = await fixture({ loseSend: true });
    await runAgentWatchers(env); expect(f.pending()).not.toBeNull(); expect(f.receipts.size).toBe(1);
    const saved = JSON.stringify(f.pending());
    await runAgentWatchers(env);
    const sent = f.calls.filter(c => c.endpoint.endsWith('/agent_mandate_action'));
    expect(sent.length).toBe(2); expect(sent[1].payload).toEqual(sent[0].payload);
    expect(f.models()).toBe(1); expect(f.receipts.size).toBe(1); expect(f.pending()).toBeNull();
    expect(saved).toContain(sent[0].payload.p_operation_key);
  });
  test('lost staging response cannot send until next lease recovers the persisted operation', async () => {
    const f = await fixture({ loseStage: true }); await runAgentWatchers(env);
    expect(f.pending()).not.toBeNull(); expect(f.receipts.size).toBe(0);
    await runAgentWatchers(env); expect(f.receipts.size).toBe(1); expect(f.models()).toBe(1); expect(f.pending()).toBeNull();
  });
  test('stale lease staging rejection prevents all guarded trading', async () => {
    const f = await fixture({ rejectStage: true }); await runAgentWatchers(env);
    expect(f.calls.some(c => c.endpoint.endsWith('/agent_mandate_action'))).toBe(false); expect(f.receipts.size).toBe(0);
  });
  test('failed fence completion does not claim a finished job', async () => {
    const f = await fixture({ staleFinish: true }); const result = await runAgentWatchers(env);
    expect(result.finished).toBe(0); expect(result.deferred).toBe(1); expect(f.pending()).not.toBeNull();
  });
  test('SSE public MCP board is parsed and still precedes structured generation', async () => {
    const f = await fixture({ sse: true }); await runAgentWatchers(env);
    expect(f.models()).toBe(1); expect(f.receipts.size).toBe(1);
  });
  test('public offer continuation survives waits and reaches older offers', async () => {
    const next = 'opaque_next_page';
    const f = await fixture({ proposal: wait, publicPages: [
      { listing_id: ids.listing, status: 'active', offers, complete: false, next_cursor: next },
      { listing_id: ids.listing, status: 'active', offers: [{ ...offers[0], id: ids.counter }], complete: true, next_cursor: null },
    ] });
    await runAgentWatchers(env); expect(f.cursor()).toBe(next);
    await runAgentWatchers(env); expect(f.cursor()).toBeNull();
    const boards = f.calls.filter(c => c.endpoint.endsWith('/mcp'));
    expect(boards[1].payload.params.arguments.cursor).toBe(next); expect(f.models()).toBe(2); expect(f.receipts.size).toBe(0);
  });
  test('malformed public pagination cannot be mistaken for absence or sent to the model', async () => {
    const f = await fixture({ publicPages: [{ listing_id: ids.listing, status: 'active', offers, complete: false, next_cursor: null }] });
    await runAgentWatchers(env); expect(f.models()).toBe(0); expect(f.receipts.size).toBe(0);
  });
  test('quota account gate stops automated retries and persists safe diagnostics', async () => {
    const f = await fixture({ providerQuota: true }); await runAgentWatchers(env); await runAgentWatchers(env);
    expect(f.models()).toBe(1); expect(f.state()).toBe('blocked'); expect(f.receipts.size).toBe(0);
    const complete = f.calls.find(c => c.endpoint.endsWith('/finish_agent_watch'))!;
    expect(complete.payload.p_error).toBe('account_required'); expect(complete.payload.p_diagnostic.error_code).toBe('credit_balance_exhausted');
    expect(JSON.stringify(complete.payload)).not.toContain('Do not reflect this');
  });
  test('out-of-bound generated proposal cannot stage or trade', async () => {
    const f = await fixture({ proposal: { ...place, amount_cents: 1599 } }); await runAgentWatchers(env);
    expect(f.calls.some(c => /stage_agent_watch_operation|agent_mandate_action/.test(c.endpoint))).toBe(false); expect(f.state()).toBe('blocked');
  });
});
