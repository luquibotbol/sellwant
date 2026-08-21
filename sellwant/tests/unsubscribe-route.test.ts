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

/** Stand in for PostgREST, recording what the worker asked it to do. */
function stubRpc(status = 204) {
  const calls: { name: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ name: url.split('/rpc/')[1], body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(status === 204 ? null : '{}', { status });
  }) as typeof fetch;
  return calls;
}

const hit = (method: string, qs: string) =>
  worker.fetch(
    new Request(`https://sellwant.com/api/unsubscribe?${qs}`, { method }),
    env,
    { waitUntil: () => {} }
  );

describe('/api/unsubscribe', () => {
  test('GET confirms and changes nothing — scanners open every link in an email', async () => {
    const calls = stubRpc();
    const sig = await unsubSig(SECRET, USER, 'offer_received');
    const res = await hit('GET', `u=${USER}&k=offer_received&s=${sig}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Stop emailing you about offers?');
    expect(calls).toHaveLength(0);
  });

  test('POST turns the emails off', async () => {
    const calls = stubRpc();
    const sig = await unsubSig(SECRET, USER, 'offer_received');
    const res = await hit('POST', `u=${USER}&k=offer_received&s=${sig}`);
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { name: 'set_email_pref', body: { p_profile: USER, p_kind: 'offer_received', p_on: false } },
    ]);
  });

  test('the undo on that page turns them back on, and is offered', async () => {
    const sig = await unsubSig(SECRET, USER, 'offer_received');
    stubRpc();
    const body = await (await hit('POST', `u=${USER}&k=offer_received&s=${sig}`)).text();
    expect(body).toContain('turn them back on');
    // The promise the page makes has to be a link that works, not a screen
    // that does not exist yet.
    expect(body).toContain('on=1');

    const calls = stubRpc();
    await hit('POST', `u=${USER}&k=offer_received&s=${sig}&on=1`);
    expect(calls[0].body).toMatchObject({ p_on: true });
  });

  test('a bad signature never reaches the database', async () => {
    const calls = stubRpc();
    const res = await hit('POST', `u=${USER}&k=offer_received&s=${'0'.repeat(32)}`);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('a failed save says so rather than claiming success', async () => {
    stubRpc(500);
    const sig = await unsubSig(SECRET, USER, 'offer_received');
    const res = await hit('POST', `u=${USER}&k=offer_received&s=${sig}`);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('did not save');
  });

  test('with no secrets set it is unavailable, not silently broken', async () => {
    const calls = stubRpc();
    const res = await worker.fetch(
      new Request('https://sellwant.com/api/unsubscribe?u=x&k=offer_received&s=y'),
      { ...env, UNSUB_SECRET: undefined },
      { waitUntil: () => {} }
    );
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});
