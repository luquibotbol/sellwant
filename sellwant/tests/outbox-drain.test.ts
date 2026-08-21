import { describe, expect, test, afterEach } from 'bun:test';
import worker from '../worker/index.js';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  RESEND_API_KEY: 're_test',
  MAIL_FROM: 'SellWant <offers@notify.sellwant.com>',
  UNSUB_SECRET: 'test-secret-value-at-least-32-bytes-long',
};

const row = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'offer_received',
  to_email: 'maya@example.edu',
  to_profile: '11111111-2222-3333-4444-555555555555',
  listing_id: 'abc',
  payload: { listing_title: 'Kappa formal', listing_type: 'sell', amount_cents: 3000 },
  collapsed: 1,
  ...over,
});

const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

type Call = { url: string; body: any; headers: Record<string, string> };

/** PostgREST and Resend, both faked, both recording. */
function stub(opts: { rows?: unknown[]; resendStatus?: number } = {}) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>)
    );
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')), headers });
    if (url.includes('/rpc/claim_email_batch')) {
      return new Response(JSON.stringify(opts.rows ?? []), { status: 200 });
    }
    if (url.includes('api.resend.com')) {
      return new Response('{"id":"x"}', { status: opts.resendStatus ?? 200 });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return calls;
}

/** Run the cron and wait for the work it handed to waitUntil. */
async function runCron() {
  const pending: Promise<unknown>[] = [];
  await worker.scheduled({}, env, { waitUntil: (p: Promise<unknown>) => pending.push(p) });
  await Promise.all(pending);
}

const rpcNames = (c: Call[]) =>
  c.filter((x) => x.url.includes('/rpc/')).map((x) => x.url.split('/rpc/')[1]);

describe('the outbox drain', () => {
  test('an empty queue sends nothing and asks nothing further', async () => {
    const calls = stub({ rows: [] });
    await runCron();
    expect(rpcNames(calls)).toEqual(['claim_email_batch']);
  });

  test('a claimed row is sent and then marked sent', async () => {
    const calls = stub({ rows: [row()] });
    await runCron();
    const mail = calls.find((c) => c.url.includes('resend'))!;
    expect(mail.body.to).toEqual(['maya@example.edu']);
    expect(mail.body.subject).toContain('$30');
    expect(rpcNames(calls)).toEqual(['claim_email_batch', 'mark_email_sent']);
  });

  test('the idempotency key is the row id, so a retry cannot double-send', async () => {
    const calls = stub({ rows: [row()] });
    await runCron();
    const mail = calls.find((c) => c.url.includes('resend'))!;
    expect(mail.headers['Idempotency-Key']).toBe('00000000-0000-4000-8000-000000000001');
  });

  test('every email carries one-click unsubscribe headers', async () => {
    const calls = stub({ rows: [row()] });
    await runCron();
    const mail = calls.find((c) => c.url.includes('resend'))!;
    expect(mail.body.headers['List-Unsubscribe']).toMatch(/^<https:\/\/sellwant\.com\/api\/unsubscribe\?/);
    expect(mail.body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  test('a rejected send is recorded as failed, not as sent', async () => {
    const calls = stub({ rows: [row()], resendStatus: 422 });
    await runCron();
    expect(rpcNames(calls)).toEqual(['claim_email_batch', 'mark_email_failed']);
    const failed = calls.find((c) => c.url.includes('mark_email_failed'))!;
    expect(failed.body.p_error).toContain('resend 422');
  });

  test('a deleted account is retired rather than mailed', async () => {
    const calls = stub({ rows: [row({ to_profile: null })] });
    await runCron();
    expect(calls.some((c) => c.url.includes('resend'))).toBe(false);
    expect(rpcNames(calls)).toEqual(['claim_email_batch', 'mark_email_sent']);
  });

  test('one bad row does not strand the rest of the batch', async () => {
    const rows = [row({ to_profile: null }), row({ id: '00000000-0000-4000-8000-000000000002' })];
    const calls = stub({ rows });
    await runCron();
    expect(calls.filter((c) => c.url.includes('resend'))).toHaveLength(1);
  });

  test('a collapsed batch says how many, and sends one email', async () => {
    const calls = stub({ rows: [row({ collapsed: 4 })] });
    await runCron();
    const mail = calls.filter((c) => c.url.includes('resend'));
    expect(mail).toHaveLength(1);
    expect(mail[0].body.subject).toContain('4 new offers');
  });

  test('with no secrets it never touches the database', async () => {
    const calls = stub({ rows: [row()] });
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({}, { ...env, RESEND_API_KEY: undefined }, {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    await Promise.all(pending);
    expect(calls).toHaveLength(0);
  });
});
