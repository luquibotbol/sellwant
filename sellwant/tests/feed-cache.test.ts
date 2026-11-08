import { afterEach, describe, expect, test } from 'bun:test';
import worker from '../worker/index.js';

/**
 * The / and /feed pages are enriched once and cached under one key for every
 * visitor. They used to be built from the visitor's own request, so a HEAD, a
 * POST, or a browser revalidating with the ETag we sent it produced a
 * body-less asset response that was stored as an empty 200 -- a blank
 * homepage for everyone at that edge for a minute.
 *
 * The asset stand-in behaves like Cloudflare's asset worker: a matching
 * If-None-Match is a 304 with no body, HEAD has no body, other methods 405.
 */
const html = '<!doctype html><html><head><title>SellWant</title>' +
  '<meta name="description" content="x"></head><body><div id="root"></div></body></html>';
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'public-anon-test',
  ASSETS: {
    async fetch(request: Request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      if (request.headers.get('if-none-match') === '"v1"') return new Response(null, { status: 304, headers: { etag: '"v1"' } });
      return new Response(request.method === 'HEAD' ? null : html,
        { status: 200, headers: { 'content-type': 'text/html', etag: '"v1"' } });
    },
  },
};
const row = {
  id: '11111111-2222-3333-4444-000000000001', title: 'Synthetic Ticket', type: 'sell',
  price_cents: 1665, event_date: '2026-11-12', location: 'Campus', best_offer_cents: 1400, offer_count: 2,
};

const realFetch = globalThis.fetch;
const realCaches = (globalThis as { caches?: unknown }).caches;
afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { caches?: unknown }).caches = realCaches;
});

function edge() {
  const store = new Map<string, { body: string; headers: [string, string][] }>();
  (globalThis as { caches?: unknown }).caches = { default: {
    async match(r: Request) {
      const hit = store.get(r.url);
      return hit && new Response(hit.body, { headers: hit.headers });
    },
    async put(r: Request, res: Response) {
      store.set(r.url, { body: await res.text(), headers: [...res.headers] });
    },
  } };
  globalThis.fetch = (async () => new Response(JSON.stringify([row]))) as unknown as typeof fetch;
  return store;
}

async function send(path: string, init: RequestInit = {}) {
  const pending: Promise<unknown>[] = [];
  const response = await worker.fetch(new Request(`https://sellwant.com${path}`, init), env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p) });
  await Promise.all(pending);
  return response;
}

describe('the shared / and /feed cache entry', () => {
  for (const path of ['/', '/feed']) {
    for (const [name, init] of [
      ['HEAD', { method: 'HEAD' }],
      ['POST', { method: 'POST', body: 'x' }],
      ['a revalidation', { headers: { 'if-none-match': '"v1"' } }],
    ] as const) {
      test(`${name} on ${path} cannot leave a blank page for the next visitor`, async () => {
        edge();
        await send(path, init);
        const next = await send(path);
        expect(next.status).toBe(200);
        expect(await next.text()).toContain('Synthetic Ticket');
      });
    }
  }

  test('the enriched page does not carry the template ETag', async () => {
    edge();
    const first = await send('/');
    expect(await first.text()).toContain('Synthetic Ticket');
    expect(first.headers.get('etag')).toBeNull();
  });
});
