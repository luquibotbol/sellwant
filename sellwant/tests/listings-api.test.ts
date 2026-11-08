import { afterEach, describe, expect, test } from 'bun:test';
import worker from '../worker/index.js';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'public-anon-test',
  SUPABASE_SECRET_KEY: 'private-service-key-must-not-be-used',
};
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const id = (n: number) => `11111111-2222-3333-4444-${String(n).padStart(12, '0')}`;
const listing = (n = 1, overrides = {}) => ({
  id: id(n), title: `Ticket ${n}`, type: 'sell', status: 'active',
  price_cents: 1665, best_offer_cents: 1400, offer_count: 2,
  created_at: '2026-11-04T01:02:03.123456+00:00',
  event_date: '2026-11-12', location: 'Campus',
  ...overrides,
});

function hit(query = '', method = 'GET', config: object = env) {
  return worker.fetch(new Request(`https://sellwant.com/api/listings.json${query}`, { method }), config, {});
}

function stub(body: unknown = [], status = 200, range?: string | null) {
  const calls: { url: URL; headers: Headers }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
    const count = Array.isArray(body) ? body.length : 0;
    const contentRange = range === undefined ? (count ? `0-${count - 1}/${count}` : '*/0') : range;
    return new Response(JSON.stringify(body), {
      status, headers: contentRange === null ? {} : { 'content-range': contentRange },
    });
  }) as typeof fetch;
  return calls;
}

function cursor(created_at = listing().created_at, cursorId = id(1), v = 1) {
  return Buffer.from(JSON.stringify({ v, created_at, id: cursorId })).toString('base64url');
}

describe('/api/listings.json', () => {
  test('keeps existing fields, adds integer cents, and whitelists public output', async () => {
    const calls = stub([listing(1, {
      type: 'ask', user_id: 'private-owner', contact_details: 'private-contact',
      locked_price_cents: 99, qr_payload: 'private-ticket',
    })]);
    const response = await hit();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(body).toMatchObject({
      site: 'SellWant', docs: 'https://sellwant.com/llms.txt', count: 1,
      has_more: false, next_cursor: null, next_url: null,
    });
    expect(body.listings).toEqual([{
      id: id(1), url: `https://sellwant.com/event/${id(1)}`,
      title: 'Ticket 1', type: 'want', price_cents: 1665, going_rate_cents: 1400,
      currency: 'USD', going_rate_status: 'available', price_usd: 16.65,
      going_rate_usd: 14, offers: 2, event_date: '2026-11-12', location: 'Campus',
    }]);
    expect(JSON.stringify(body)).not.toContain('private-');
    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin).toBe(env.SUPABASE_URL);
    expect(calls[0].url.pathname).toBe('/rest/v1/listings');
    expect(calls[0].url.searchParams.get('status')).toBe('eq.active');
    expect(calls[0].url.searchParams.get('order')).toBe('created_at.desc,id.desc');
    expect(calls[0].url.searchParams.get('limit')).toBe('201');
    expect(calls[0].url.searchParams.get('select')?.split(',')).toEqual([
      'id', 'title', 'type', 'price_cents', 'event_date', 'location',
      'best_offer_cents', 'offer_count', 'status', 'created_at',
    ]);
    expect([...calls[0].headers]).toEqual([
      ['apikey', env.SUPABASE_ANON_KEY], ['prefer', 'count=exact'],
    ]);
  });

  test('an empty market is successful and distinct from unavailability', async () => {
    stub([]);
    const response = await hit();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      count: 0, listings: [], has_more: false, next_cursor: null, next_url: null,
    });
  });

  test('no offers means a null rate, with no invented price', async () => {
    stub([listing(1, { best_offer_cents: null, offer_count: 0, event_date: null, location: null })]);
    const body = await (await hit()).json();
    expect(body.listings[0]).toMatchObject({
      offers: 0, going_rate_cents: null, going_rate_usd: null, going_rate_status: 'no_offers',
    });
  });

  test.each([201, 75])('enumerates over 200 listings without loss under database cap %s', async databaseCap => {
    const source = Array.from({ length: 450 }, (_, i) => listing(i + 1, {
      created_at: `2026-11-04T01:02:03.${String(123454 + Math.floor(i / 150))}+00:00`,
    })).reverse();
    let requests = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      const url = new URL(String(input));
      expect(url.searchParams.get('status')).toBe('eq.active');
      expect(url.searchParams.get('order')).toBe('created_at.desc,id.desc');
      expect(new Headers(init?.headers).get('prefer')).toBe('count=exact');
      const filter = url.searchParams.get('or');
      let rows = source;
      if (filter) {
        const match = /^\(created_at\.lt\."(.+)",and\(created_at\.eq\."\1",id\.lt\.([a-f0-9-]+)\)\)$/.exec(filter);
        expect(match).not.toBeNull();
        const [, time, lastId] = match!;
        rows = rows.filter(row => row.created_at < time || (row.created_at === time && row.id < lastId));
      }
      const returned = rows.slice(0, Math.min(databaseCap, Number(url.searchParams.get('limit'))));
      return new Response(JSON.stringify(returned), {
        status: returned.length < rows.length ? 206 : 200,
        headers: { 'content-range': `0-${returned.length - 1}/${rows.length}` },
      });
    }) as typeof fetch;

    const seen: string[] = [];
    const counts: number[] = [];
    let url: string | null = 'https://sellwant.com/api/listings.json';
    while (url) {
      const response = await worker.fetch(new Request(url), env, {});
      expect(response.status).toBe(200);
      const body = await response.json();
      counts.push(body.count);
      seen.push(...body.listings.map((row: { id: string }) => row.id));
      expect(body.has_more).toBe(body.next_cursor !== null);
      if (body.next_cursor) {
        const position = JSON.parse(Buffer.from(body.next_cursor, 'base64url').toString());
        expect(position.created_at).toMatch(/\.12345[4-6]\+00:00$/);
        expect(position.id).toBe(body.listings.at(-1).id);
        expect(new URL(body.next_url).searchParams.get('cursor')).toBe(body.next_cursor);
      }
      url = body.next_url;
      expect(requests).toBeLessThanOrEqual(Math.ceil(source.length / Math.min(databaseCap, 200)));
    }
    expect(counts).toEqual(databaseCap === 201 ? [200, 200, 50] : [75, 75, 75, 75, 75, 75]);
    expect(seen).toEqual(source.map(row => row.id));
    expect(new Set(seen).size).toBe(450);
    expect(requests).toBe(Math.ceil(source.length / Math.min(databaseCap, 200)));
  });

  test('lookahead retains the last returned exact microsecond timestamp and URL-encodes offsets', async () => {
    const time = '2026-11-04T01:02:03.123457+05:30';
    stub([listing(3, { created_at: time }), listing(2, { created_at: time })]);
    const first = await (await hit('?limit=1')).json();
    const position = JSON.parse(Buffer.from(first.next_cursor, 'base64url').toString());
    expect(position).toEqual({ v: 1, created_at: time, id: id(3) });
    expect(new URL(first.next_url).searchParams.get('limit')).toBe('1');
    const calls = stub([listing(2, { created_at: time })]);
    const second = await (await hit(`?limit=1&cursor=${first.next_cursor}`)).json();
    expect(second.has_more).toBe(false);
    expect(calls[0].url.searchParams.get('or')).toBe(
      `(created_at.lt."${time}",and(created_at.eq."${time}",id.lt.${id(3)}))`
    );
    expect(calls[0].url.toString()).toContain('%2B05%3A30');
  });

  test('timestamp ordering preserves sub-millisecond differences and equivalent offsets', async () => {
    stub([
      listing(1, { created_at: '2026-11-04T01:02:03.123457Z' }),
      listing(3, { created_at: '2026-11-04T06:32:03.123456+05:30' }),
      listing(2, { created_at: '2026-11-04T01:02:03.123456Z' }),
    ]);
    expect((await hit()).status).toBe(200);
  });

  test.each(['', '0', '-1', '201', '1.5', '1e2', '01', 'Infinity', '9007199254740993', '1&limit=2'])(
    'rejects invalid limit %s without any network request', async value => {
      const calls = stub();
      const response = await hit(`?limit=${value}`);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('invalid_pagination');
      expect(calls).toHaveLength(0);
    }
  );

  test.each([
    '', 'not-a-cursor', 'a'.repeat(513), cursor(undefined, undefined, 2),
    cursor('2026-02-30T01:02:03Z'), cursor('2026-11-04T24:00:00Z'),
    cursor('2026-11-04T01:02:03.1234567Z'), cursor('2026-11-04T01:02:03Z),status.eq.sold'),
    cursor(undefined, `${id(1)}),status.eq.sold`), `${cursor()}=`,
    `${cursor()}&cursor=${cursor()}`,
    Buffer.from(JSON.stringify({ v: 1, created_at: listing().created_at, id: id(1), extra: true })).toString('base64url'),
  ])('rejects invalid cursor %s without any network request', async value => {
    const calls = stub();
    const response = await hit(`?cursor=${value}`);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test.each([401, 429, 500])('upstream %s returns a no-store 503 without exposing details', async status => {
    stub({ detail: 'private failure detail' }, status);
    const response = await hit();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.error).toBe('market_unavailable');
    expect(body.listings).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('private');
  });

  test('network failure and malformed JSON return 503', async () => {
    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect((await hit()).status).toBe(503);
    globalThis.fetch = (async () => new Response('not-json')) as unknown as typeof fetch;
    expect((await hit()).status).toBe(503);
  });

  test('missing configuration cannot masquerade as an empty market', async () => {
    const calls = stub();
    expect((await hit('', 'GET', { ...env, SUPABASE_URL: undefined })).status).toBe(503);
    expect((await hit('', 'GET', { ...env, SUPABASE_ANON_KEY: undefined })).status).toBe(503);
    expect((await hit('', 'GET', { ...env, SUPABASE_URL: 'not a URL' })).status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  for (const [range, received] of [
    [null, 1], ['0-0/*', 1], ['1-1/2', 1], ['0-1/2', 1], ['0-0/0', 1],
    ['0-0/9007199254740992', 1], ['0-0/1.5', 1], ['0-9007199254740992/9007199254740992', 1],
    [null, 0], ['*/1', 0], ['0-0/1', 0], ['*/9007199254740992', 0],
  ] as const) {
    test(`missing or contradictory exact range ${range} for ${received} rows returns 503`, async () => {
      stub(received ? [listing()] : [], 200, range);
      const response = await hit();
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe('market_unavailable');
    });
  }

  test.each(([
    {}, null, [null],
    [listing(1, { status: 'sold' })],
    [listing(1, { type: 'unknown' })],
    [listing(1, { price_cents: 16.65 })],
    [listing(1, { price_cents: Number.MAX_SAFE_INTEGER + 1 })],
    [listing(1, { price_cents: '1665' })],
    [listing(1, { price_cents: 0 })],
    [listing(1, { best_offer_cents: Number.MAX_SAFE_INTEGER + 1 })],
    [listing(1, { best_offer_cents: null })],
    [listing(1, { best_offer_cents: 1400, offer_count: 0 })],
    [listing(1, { offer_count: 0.5 })],
    [listing(1, { offer_count: Number.MAX_SAFE_INTEGER + 1 })],
    [listing(1, { created_at: null })],
    [listing(1, { event_date: '2026-02-30' })],
    [listing(1, { id: '../private' })],
    [listing(1), listing(1)],
    [listing(1), listing(2)],
  ] as unknown[]).map(body => ({ body })))('malformed or inactive upstream data fails closed: %j', async ({ body }) => {
    stub(body);
    expect((await hit()).status).toBe(503);
  });

  test("one owner-written row the API cannot show is skipped, not a 503 for everyone", async () => {
    // A year past 9999 is a legal Postgres date, written by the listing's owner.
    for (const bad of [{ event_date: '10000-01-01' }, { event_date: '0044-03-15 BC' }]) {
      stub([listing(2), listing(1, bad)]);
      const response = await hit();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.count).toBe(1);
      expect(body.listings.map((l: { id: string }) => l.id)).toEqual([id(2)]);
    }
  });

  test('the database must honor both the page size and cursor boundary', async () => {
    stub([listing(3), listing(2), listing(1)]);
    expect((await hit('?limit=1')).status).toBe(503);
    stub([listing(2)]);
    expect((await hit(`?cursor=${cursor(undefined, id(1))}`)).status).toBe(503);
  });

  test('HEAD shares GET status and headers with no body; write methods never fetch', async () => {
    const calls = stub([listing()]);
    const response = await hit('', 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
    expect(calls).toHaveLength(1);
    const invalidHead = await hit('?limit=0', 'HEAD');
    expect(invalidHead.status).toBe(400);
    expect(await invalidHead.text()).toBe('');
    for (const method of ['POST', 'DELETE', 'PATCH']) {
      const denied = await hit('', method);
      expect(denied.status).toBe(405);
      expect(denied.headers.get('allow')).toBe('GET, HEAD');
    }
    expect(calls).toHaveLength(1);
  });
});
