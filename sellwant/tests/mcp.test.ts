import { afterEach, describe, expect, test } from 'bun:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { handleMcp, type McpEnv } from '../worker/mcp';
import worker from '../worker/index.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const ORIGIN = 'http://127.0.0.1:8197';
const DATABASE = 'http://127.0.0.1:55321';
const TOKEN = 'swcap_' + 'a'.repeat(64);
const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const anon = (role = 'anon') => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role }))}.synthetic`;
const ENV: McpEnv = { AGENT_MCP_ENABLED: 'true', AGENT_MCP_ORIGIN: ORIGIN,
  SUPABASE_URL: DATABASE, SUPABASE_ANON_KEY: anon() };
const ACCESS = { id: id(1), mandate_id: id(2), tools: ['get_mandate'], expires_at: new Date(Date.now() + 3600000).toISOString() };
type Calls = { name: string; body: Record<string, unknown>; init: RequestInit }[];
function backend(options: {
  tools?: string[]; access?: unknown; invalid?: boolean; failAction?: 'network' | '500' | '400' | 'malformed';
} = {}) {
  const calls: Calls = [];
  const receipts = new Map<string, unknown>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(DATABASE);
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('apikey')).toBe(ENV.SUPABASE_ANON_KEY!);
    const name = url.pathname.split('/').pop()!;
    const body = JSON.parse(String(init?.body));
    expect(body.p_token).toBe(TOKEN);
    calls.push({ name, body, init: init! });
    if (name === 'agent_get_access') return options.invalid ? Response.json({ error: TOKEN }, { status: 400 })
      : Response.json(options.access ?? { ...ACCESS, tools: options.tools ?? ACCESS.tools });
    if (name === 'agent_get_mandate') return Response.json({ id: id(2), bound_cents: 1800, listing_snapshot: { title: 'Synthetic' } });
    if (name === 'agent_get_deal') return Response.json(null);
    if (name === 'agent_revoke_mandate') return Response.json({ id: id(2), status: 'revoked', private: 'not returned' });
    if (name === 'agent_mandate_action') {
      if (options.failAction === 'network') throw new Error('private details ' + TOKEN);
      if (options.failAction === '500') return Response.json({ private: TOKEN }, { status: 500 });
      if (options.failAction === '400') return Response.json({ private: TOKEN }, { status: 400 });
      if (options.failAction === 'malformed') return Response.json({ token: TOKEN });
      const key = String(body.p_operation_key);
      if (!receipts.has(key)) receipts.set(key, { id: id(5), status: 'succeeded',
        ...(body.p_action === 'place_offer' ? { offer_id: id(6) } : { deal_id: id(7) }) });
      return Response.json(receipts.get(key));
    }
    throw new Error('Unexpected fixture RPC');
  }) as typeof fetch;
  return { calls, receipts };
}
function request(method = 'tools/list', params: unknown = {}, headers: Record<string, string> = {}, body?: string) {
  return new Request(ORIGIN + '/mcp', { method: 'POST', headers: {
    authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...headers,
  }, body: body ?? JSON.stringify({ jsonrpc: '2.0', id: 3, method, params }) });
}
async function decoded(response: Response): Promise<any> {
  const text = await response.text();
  expect(text).not.toContain(TOKEN);
  if (response.headers.get('content-type')?.startsWith('text/event-stream')) {
    const lines = text.split('\n').filter(line => line.startsWith('data: '));
    return JSON.parse(lines[lines.length - 1].slice(6));
  }
  return text ? JSON.parse(text) : null;
}
type Discovery = (request: Request, env: McpEnv, url: URL) => Promise<Response>;
const unavailableMarket: Discovery = async () => new Response('unavailable', { status: 503 });
async function run(req = request(), env = ENV, discovery: Discovery = unavailableMarket) {
  return handleMcp(req, env, discovery);
}
async function call(name: string, args: unknown = {}, discovery: Discovery = unavailableMarket) {
  return decoded(await run(request('tools/call', { name, arguments: args }), ENV, discovery));
}
const publicRow = (n: number) => ({ id: id(n), url: ORIGIN + '/event/' + id(n), title: 'Synthetic ' + n,
  type: 'sell', price_cents: 1800, currency: 'USD', going_rate_cents: null, going_rate_status: 'no_offers',
  offers: 0, event_date: null, location: null });
const openOffer = (n: number, poster = false) => ({ id: id(n), listing_id: id(20), parent_offer_id: null,
  amount_cents: 1665, message: 'Synthetic public offer', created_at: '2026-11-05T18:00:00.123456+00:00',
  from_user: poster ? id(21) : id(22), status: 'open', private_contact: 'not returned' });
function offersBackend(pages: { rows: unknown[]; total: number }[], active = true) {
  backend();
  const rpcFetch = globalThis.fetch;
  const reads: URL[] = [];
  let page = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/rest/v1/rpc/')) return rpcFetch(input, init);
    reads.push(url);
    expect(url.origin).toBe(DATABASE);
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    const headers = new Headers(init?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.get('apikey')).toBe(ENV.SUPABASE_ANON_KEY!);
    expect(headers.get('prefer')).toBe('count=exact');
    expect(String(input)).not.toContain(TOKEN);
    if (url.pathname === '/rest/v1/listings') {
      expect(url.searchParams.get('status')).toBe('eq.active');
      expect(url.searchParams.get('id')).toBe('eq.' + id(20));
      return Response.json(active ? [{ id: id(20), user_id: id(21), status: 'active' }] : [], {
        headers: { 'content-range': active ? '0-0/1' : '*/0' },
      });
    }
    expect(url.pathname).toBe('/rest/v1/offers');
    expect(url.searchParams.get('listing_id')).toBe('eq.' + id(20));
    expect(url.searchParams.get('status')).toBe('eq.open');
    expect(url.searchParams.get('order')).toBe('created_at.desc,id.desc');
    expect(url.searchParams.get('select')).not.toContain('*');
    const result = pages[page++];
    return Response.json(result.rows, { headers: { 'content-range': result.rows.length ? `0-${result.rows.length - 1}/${result.total}` : '*/0' } });
  }) as typeof fetch;
  return reads;
}

describe('scoped stateless product MCP', () => {
  test('is disabled by default and never falls through to assets or DB', async () => {
    let touched = false;
    globalThis.fetch = (async () => { touched = true; throw new Error(); }) as unknown as typeof fetch;
    const response = await worker.fetch(request(), { ASSETS: { fetch: () => { touched = true; } } }, {});
    expect(response.status).toBe(404);
    expect(touched).toBe(false);
  });
  test('refuses production bindings, insecure URLs and non-anonymous credentials', async () => {
    for (const change of [
      { AGENT_MCP_ORIGIN: 'https://sellwant.com' }, { SUPABASE_URL: 'https://gguzeafbwsqkhggmcjjl.supabase.co' },
      { SUPABASE_URL: 'http://remote.example' }, { SUPABASE_URL: 'https://user:pass@dev.example' },
      { AGENT_MCP_ORIGIN: ORIGIN + '/private' }, { SUPABASE_ANON_KEY: anon('service_role') },
      { SUPABASE_ANON_KEY: anon('authenticated') }, { SUPABASE_ANON_KEY: 'sb_secret_private' },
    ]) expect((await run(request(), { ...ENV, ...change })).status).toBe(503);
  });
  test('requires exact origin and host and rejects token/query transport', async () => {
    const invalidHeaders: Record<string, string>[] = [{ origin: 'https://evil.example' }, { origin: 'null' }, { host: 'evil.example' }];
    for (const headers of invalidHeaders) {
      expect((await run(request('tools/list', {}, headers))).status).toBe(403);
    }
    const query = new Request(ORIGIN + '/mcp?token=' + TOKEN, request());
    expect((await run(query)).status).toBe(400);
    expect((await run(new Request('http://evil.example/mcp', request()))).status).toBe(403);
  });
  test('requires opaque capability bearer, never a human JWT', async () => {
    for (const authorization of ['', anon('authenticated'), 'Bearer ' + anon('authenticated'), 'Bearer swcap_bad', 'Basic ' + TOKEN]) {
      expect((await run(request('tools/list', {}, { authorization }))).status).toBe(401);
    }
  });
  test('introspection failure is generic and reveals no upstream body', async () => {
    backend({ invalid: true });
    const response = await run();
    expect(response.status).toBe(401);
    expect(await decoded(response)).toEqual({ error: 'invalid_capability' });
  });
  test('malformed introspection is unavailable; expired authority is unauthenticated', async () => {
    for (const access of [{ ...ACCESS, owner_id: id(9) }, { ...ACCESS, tools: ['approve_mandate'] },
      { ...ACCESS, tools: [] }]) {
      backend({ access });
      expect((await run()).status).toBe(503);
    }
    backend({ access: { ...ACCESS, expires_at: new Date(0).toISOString() } });
    expect((await run()).status).toBe(401);
  });
  test('access timeout and provider failures do not masquerade as invalid credentials', async () => {
    for (const status of [429, 500, 503]) {
      globalThis.fetch = (async () => Response.json({ private: TOKEN }, { status })) as unknown as typeof fetch;
      const response = await run();
      expect(response.status).toBe(503);
      expect(await decoded(response)).toEqual({ error: 'mcp_unavailable' });
    }
    globalThis.fetch = (async () => { throw new Error(TOKEN); }) as unknown as typeof fetch;
    expect((await run()).status).toBe(503);
  });
  test('lists exactly granted scopes plus public discovery, no financial/human tools', async () => {
    for (const scope of ['get_mandate', 'get_deal', 'place_offer', 'accept_offer', 'revoke_mandate']) {
      backend({ tools: [scope] });
      const response = await run();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await decoded(response);
      expect(body.result.tools.map((t: any) => t.name).sort()).toEqual([scope, 'search_listings', 'get_going_rate', 'get_public_offers'].sort());
      expect(JSON.stringify(body)).not.toContain('p_token');
      expect(JSON.stringify(body)).not.toContain('service_role');
    }
  });
  test('dispatch cannot bypass absent scope and introspects every request', async () => {
    const { calls } = backend({ tools: ['get_deal'] });
    const denied = await call('place_offer', { operation_key: id(8), amount_cents: 1700 });
    expect(denied.error ?? denied.result?.isError).toBeTruthy();
    await call('get_deal');
    expect(calls.map(c => c.name)).toEqual(['agent_get_access', 'agent_get_access', 'agent_get_deal']);
  });
  test('strict tool inputs reject extra token/owner/approval fields and invalid money before writes', async () => {
    const { calls } = backend({ tools: ['place_offer'] });
    for (const args of [
      { operation_key: id(8), amount_cents: 1665, token: 'no' },
      { operation_key: id(8), amount_cents: 1665, owner_id: id(9) },
      { operation_key: id(8), amount_cents: 16.65 }, { operation_key: 'replacement', amount_cents: 1665 },
      { operation_key: id(8), amount_cents: 0 }, { operation_key: id(8), amount_cents: 2147483648 },
      { operation_key: id(8), amount_cents: 1665, message: TOKEN },
    ]) {
      const body = await call('place_offer', args);
      expect(body.error ?? body.result?.isError).toBeTruthy();
    }
    expect(calls.every(c => c.name === 'agent_get_access')).toBe(true);
  });
  test('mutations preserve exact cents, original operation key and public proposal provenance', async () => {
    const { calls, receipts } = backend({ tools: ['place_offer', 'accept_offer'] });
    const args = { operation_key: id(8), amount_cents: 1665, explanation: 'Synthetic proposal', model: 'synthetic' };
    const first = await call('place_offer', args);
    expect(first.result.structuredContent.result).toEqual({ id: id(5), status: 'succeeded', offer_id: id(6), operation_key: id(8) });
    expect(await call('place_offer', args)).toEqual(first);
    expect(receipts.size).toBe(1);
    expect(calls.find(c => c.name === 'agent_mandate_action')?.body).toMatchObject({ p_amount_cents: 1665,
      p_operation_key: id(8), p_action: 'place_offer', p_explanation: 'Synthetic proposal' });
    const accepted = await call('accept_offer', { operation_key: id(9), offer_id: id(6) });
    expect(accepted.result.structuredContent.result.deal_id).toBe(id(7));
  });
  test('unknown mutation outcomes retain original key, never retry or invent replacement', async () => {
    for (const failAction of ['network', '500', 'malformed'] as const) {
      const { calls } = backend({ tools: ['place_offer'], failAction });
      const response = await call('place_offer', { operation_key: id(8), amount_cents: 1665 });
      expect(response.result.structuredContent.result).toMatchObject({ status: 'unknown', operation_key: id(8), error: 'reconciliation_required' });
      expect(calls.filter(c => c.name === 'agent_mandate_action')).toHaveLength(1);
    }
  });
  test('authoritative SQL rejection remains generic and is not reported unknown', async () => {
    backend({ tools: ['place_offer'], failAction: '400' });
    const body = await call('place_offer', { operation_key: id(8), amount_cents: 1665 });
    expect(body.result.structuredContent.result).toEqual({ error: 'not_authorized_or_rejected', operation_key: id(8) });
  });
  test('revoke-only response remains minimal even if upstream adds private fields', async () => {
    backend({ tools: ['revoke_mandate'] });
    const body = await call('revoke_mandate', { operation_key: id(8) });
    expect(body.result.structuredContent.result).toEqual({ id: id(2), status: 'revoked', operation_key: id(8) });
  });
  test('public search is active-only whitelisted/resumable and does not forward bearer or secret env', async () => {
    backend();
    let pages = 0;
    const discovery = async (request: Request, env: McpEnv, url: URL) => {
      expect(request.headers.get('authorization')).toBeNull();
      expect(Object.keys(env).sort()).toEqual(['SUPABASE_ANON_KEY', 'SUPABASE_URL']);
      pages++;
      const next = pages === 1 ? 'next_page' : null;
      return Response.json({ count: 1, listings: [{ ...publicRow(pages), private_contact: 'hidden', completed_price: 9999 }],
        has_more: !!next, next_cursor: next, next_url: next ? `${ORIGIN}/api/listings.json?limit=1&cursor=${next}` : null });
    };
    const first = (await call('search_listings', { page_size: 1 }, discovery)).result.structuredContent.result;
    expect(first).toMatchObject({ complete: false, next_cursor: 'next_page', scanned_count: 1 });
    expect(first.listings[0]).toEqual(publicRow(1));
    const later = (await call('search_listings', { page_size: 1, cursor: first.next_cursor }, discovery)).result.structuredContent.result;
    expect(later).toMatchObject({ complete: true, next_cursor: null });
    expect(later.listings[0].id).toBe(id(2));
  });
  test('going rate preserves no-offers and never reports absence from an incomplete scan', async () => {
    backend();
    const discovery = async () => Response.json({ count: 1, listings: [publicRow(6)], has_more: true,
      next_cursor: 'next_page', next_url: `${ORIGIN}/api/listings.json?limit=50&cursor=next_page` });
    const found = await call('get_going_rate', { listing_id: id(6) }, discovery);
    expect(found.result.structuredContent.result).toMatchObject({ status: 'no_offers', rate_cents: null, currency: 'USD' });
    const missing = await call('get_going_rate', { listing_id: id(99) }, discovery);
    expect(missing.result.structuredContent.result).toMatchObject({ status: 'incomplete', next_cursor: 'next_page' });
  });
  test('public offer discovery exposes exact safe fields and resumes a listing-bound stable cursor', async () => {
    const reads = offersBackend([{ rows: [openOffer(9), openOffer(8, true)], total: 3 },
      { rows: [openOffer(8, true), openOffer(7)], total: 2 }, { rows: [openOffer(7)], total: 1 }]);
    const first = (await call('get_public_offers', { listing_id: id(20), page_size: 1 })).result.structuredContent.result;
    expect(first).toMatchObject({ listing_id: id(20), status: 'active', complete: false });
    expect(first.offers).toEqual([{ id: id(9), listing_id: id(20), parent_offer_id: null, amount_cents: 1665,
      message: 'Synthetic public offer', created_at: openOffer(9).created_at, is_poster: false }]);
    const second = (await call('get_public_offers', { listing_id: id(20), page_size: 1, cursor: first.next_cursor })).result.structuredContent.result;
    expect(second.offers[0]).toMatchObject({ id: id(8), is_poster: true });
    expect(second.complete).toBe(false);
    expect(reads.filter(url => url.pathname.endsWith('/offers'))[1].searchParams.get('or')).toBe(
      `(created_at.lt."${openOffer(9).created_at}",and(created_at.eq."${openOffer(9).created_at}",id.lt.${id(9)}))`);
    const third = (await call('get_public_offers', { listing_id: id(20), page_size: 1, cursor: second.next_cursor })).result.structuredContent.result;
    expect(third).toMatchObject({ complete: true, next_cursor: null });
    expect(third.offers[0].id).toBe(id(7));
    expect(JSON.stringify([first, second, third])).not.toContain('from_user');
    expect(JSON.stringify([first, second, third])).not.toContain('private_contact');
  });
  test('public offer count handles database row caps and distinguishes inactive from no offers', async () => {
    offersBackend([{ rows: [openOffer(9)], total: 2 }]);
    const capped = (await call('get_public_offers', { listing_id: id(20), page_size: 100 })).result.structuredContent.result;
    expect(capped.complete).toBe(false);
    expect(capped.next_cursor).toBeString();
    offersBackend([{ rows: [], total: 0 }]);
    expect((await call('get_public_offers', { listing_id: id(20) })).result.structuredContent.result).toEqual({
      listing_id: id(20), status: 'active', offers: [], complete: true, next_cursor: null,
    });
    const reads = offersBackend([], false);
    expect((await call('get_public_offers', { listing_id: id(20) })).result.structuredContent.result).toEqual({
      listing_id: id(20), status: 'not_found', offers: [], complete: true, next_cursor: null,
    });
    expect(reads).toHaveLength(1);
  });
  test('public offer discovery rejects cross-listing cursors and malformed/closed/out-of-order upstream rows', async () => {
    const reads = offersBackend([]);
    const cursor = btoa(JSON.stringify({ v: 1, listing_id: id(30), id: id(9), created_at: openOffer(9).created_at }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect((await call('get_public_offers', { listing_id: id(20), cursor })).result.structuredContent.result).toEqual({ error: 'invalid_cursor' });
    expect(reads).toHaveLength(0);
    for (const rows of [[{ ...openOffer(9), amount_cents: 16.65 }], [{ ...openOffer(9), status: 'accepted' }],
      [openOffer(8), openOffer(9)], [{ ...openOffer(9), created_at: '2026-02-30T18:00:00Z' }]]) {
      offersBackend([{ rows, total: rows.length }]);
      expect((await call('get_public_offers', { listing_id: id(20) })).result.structuredContent.result.error).toBe('market_unavailable');
    }
  });
  test('bounds public upstream bytes before parsing through the actual Worker adapter', async () => {
    backend();
    const rpcFetch = globalThis.fetch;
    let cancelled = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname !== '/rest/v1/listings') return rpcFetch(input, init);
      expect(url.searchParams.get('status')).toBe('eq.active');
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      expect(init?.redirect).toBe('error');
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1).fill(32)); },
        cancel() { cancelled = true; },
      });
      return new Response(body, { headers: { 'content-type': 'application/json', 'content-length': '1', 'content-range': '0-0/1' } });
    }) as typeof fetch;
    const response = await worker.fetch(request('tools/call', { name: 'search_listings', arguments: {} }), ENV, {});
    const body = await decoded(response);
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.result).toEqual({ error: 'market_unavailable', retry_cursor: null });
    expect(cancelled).toBe(true);
  });
  test('bounds alternate discovery responses before the market parser', async () => {
    backend();
    const body = await call('search_listings', {}, async () => Response.json({ listings: [
      { ...publicRow(4), title: 'x'.repeat(256 * 1024) },
    ], count: 1, has_more: false, next_cursor: null, next_url: null }));
    expect(body.result.structuredContent.result).toEqual({ error: 'market_unavailable', retry_cursor: null });
  });
  test('SDK owns content negotiation, unsupported verbs and malformed JSON', async () => {
    backend();
    expect((await run(request('tools/list', {}, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await run(request('tools/list', {}, { accept: 'text/plain' }))).status).toBe(406);
    expect((await run(request('tools/list', {}, {}, '{'))).status).toBe(400);
    expect((await run(new Request(ORIGIN + '/mcp', { method: 'GET', headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream' } }))).status).toBe(405);
  });
  test('SDK bounds declared and actually streamed request bytes', async () => {
    backend({ tools: ['place_offer'] });
    expect((await run(request('tools/list', {}, { 'content-length': '999999' }))).status).toBe(413);
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(33000))); controller.close();
    } });
    const response = await run(new Request(ORIGIN + '/mcp', { method: 'POST', headers: {
      authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    }, body, duplex: 'half' } as RequestInit));
    expect(response.status).toBe(413);
  });
  test('null-body SDK notifications retain private response headers', async () => {
    backend();
    const response = await run(request('notifications/initialized', {}, {}, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Authorization, Origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
  test('no capability string survives SDK errors that echo unknown names', async () => {
    backend();
    await decoded(await run(request('tools/call', { name: TOKEN, arguments: {} })));
  });
  test('official current SDK client negotiates, lists and calls through fresh per-request servers', async () => {
    backend({ tools: ['get_deal'] });
    const client = new Client({ name: 'SellWant offline fixture', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(ORIGIN + '/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` }, redirect: 'error' },
      fetch: async (input, init) => run(new Request(input, init)),
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(t => t.name)).toContain('get_deal');
      const answer = await client.callTool({ name: 'get_deal', arguments: {} });
      expect(answer.structuredContent).toEqual({ result: null });
    } finally { await client.close(); }
  });
});
