import { describe, expect, test, afterEach } from 'bun:test';
import worker, { unsubSig } from '../worker/index.js';

const SECRET = 'test-secret-value-at-least-32-bytes-long';
const USER = '11111111-2222-3333-4444-555555555555';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  RESEND_API_KEY: 're_test',
  MAIL_FROM: 'SellWant <offers@notify.sellwant.com>',
  UNSUB_SECRET: SECRET,
  ASSETS: { fetch: async () => new Response('', { status: 404 }) },
};

const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

type Call = { name: string; body: any };

/**
 * Stand in for PostgREST. `subscribed` is what get_email_pref answers, so a
 * test can start from either state.
 */
function stub(opts: { subscribed?: boolean; status?: number } = {}) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const name = url.split('/rpc/')[1];
    calls.push({ name, body: JSON.parse(String(init?.body ?? '{}')) });
    if (opts.status && opts.status !== 200) return new Response('{}', { status: opts.status });
    if (name === 'get_email_pref') {
      return new Response(JSON.stringify(opts.subscribed ?? true), { status: 200 });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return calls;
}

const sig = () => unsubSig(SECRET, USER, 'offer_received');
const hit = async (method: string, extra = '') =>
  worker.fetch(
    new Request(
      `https://sellwant.com/api/unsubscribe?u=${USER}&k=offer_received&s=${await sig()}${extra}`,
      { method }
    ),
    env,
    { waitUntil: () => {} }
  );

const writes = (c: Call[]) => c.filter((x) => x.name === 'set_email_pref');

describe('/api/unsubscribe', () => {
  test('GET reads the setting and writes nothing — scanners open every link', async () => {
    const calls = stub({ subscribed: true });
    const res = await hit('GET');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Stop emailing you about offers?');
    expect(writes(calls)).toHaveLength(0);
  });

  test('someone already unsubscribed is not asked to unsubscribe again', async () => {
    stub({ subscribed: false });
    const body = await (await hit('GET')).text();
    expect(body).toContain('Offer emails are off');
    expect(body).toContain('Turn them back on');
    expect(body).not.toContain('Stop emailing you about offers?');
  });

  test('POST turns them off', async () => {
    const calls = stub();
    const res = await hit('POST');
    expect(res.status).toBe(200);
    expect(writes(calls)[0].body).toEqual({
      p_profile: USER, p_kind: 'offer_received', p_on: false,
    });
    expect(await res.text()).toContain('no more offer emails');
  });

  test('the way back is on the page, not gone — this is not a one-way door', async () => {
    stub();
    const offBody = await (await hit('POST')).text();
    expect(offBody).toContain('Turn them back on');
    expect(offBody).toContain('on=1');

    const calls = stub();
    const backBody = await (await hit('POST', '&on=1')).text();
    expect(writes(calls)[0].body).toMatchObject({ p_on: true });
    expect(backBody).toContain('back on');
  });

  test('the link stays good after use, in both directions', async () => {
    // The same URL, opened later, reflects reality rather than repeating itself.
    stub({ subscribed: false });
    expect(await (await hit('GET')).text()).toContain('Turn them back on');
    stub({ subscribed: true });
    expect(await (await hit('GET')).text()).toContain('Yes, stop these emails');
  });

  test('a bad signature never reaches the database', async () => {
    const calls = stub();
    const res = await worker.fetch(
      new Request(
        `https://sellwant.com/api/unsubscribe?u=${USER}&k=offer_received&s=${'0'.repeat(32)}`,
        { method: 'POST' }
      ),
      env,
      { waitUntil: () => {} }
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('a failed save says so rather than claiming success', async () => {
    stub({ status: 500 });
    const res = await hit('POST');
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('did not save');
  });

  test('a failed read says so rather than guessing the state', async () => {
    stub({ status: 500 });
    const res = await hit('GET');
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('did not load');
  });

  test('with no secrets it is unavailable, not silently broken', async () => {
    const calls = stub();
    const res = await worker.fetch(
      new Request('https://sellwant.com/api/unsubscribe?u=x&k=offer_received&s=y'),
      { ...env, UNSUB_SECRET: undefined },
      { waitUntil: () => {} }
    );
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});
