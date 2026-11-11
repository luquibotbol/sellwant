import { describe, expect, test } from 'bun:test';
import {
  PayPalError, PayPalSandbox, approvalUrl, sandboxConfig, usdValue,
  validateExpectation, verifyAuthorization, verifyCapture, verifyOrder,
} from '../worker/paypal';
import { authorizationId, captureFixture, captureId, expected, fakePayPal, orderFixture, orderId, requestId, response, sandboxEnv } from './paypal-fixtures';

const recordFixtureCapture = async (_id: string) => {};

describe('sandbox boundaries and exact money', () => {
  test('production or missing configuration fails before network access', () => {
    expect(() => sandboxConfig({ ...sandboxEnv, PAYPAL_ENVIRONMENT: 'PRODUCTION' })).toThrow('SANDBOX');
    expect(() => sandboxConfig({ ...sandboxEnv, PAYPAL_CLIENT_SECRET: '' })).toThrow('PAYPAL_CLIENT_SECRET');
    expect(() => sandboxConfig({ ...sandboxEnv, PAYPAL_CLIENT_SECRET: 'bad\nsecret' })).toThrow('Invalid');
  });

  test('decimal formatting preserves cents and rejects fractional, zero or unsafe amounts', () => {
    expect(usdValue(1)).toBe('0.01');
    expect(usdValue(1665)).toBe('16.65');
    expect(usdValue(1800)).toBe('18.00');
    for (const value of [0, -1, 16.65, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => usdValue(value)).toThrow();
    expect(() => validateExpectation({ ...expected, currency: 'EUR' } as never)).toThrow('USD');
  });

  test('wrong amount, currency, receiver, intent, deal or resource cannot verify', () => {
    const bad: Array<(order: ReturnType<typeof orderFixture>) => void> = [
      order => { order.purchase_units[0].amount.value = '16.66'; },
      order => { order.purchase_units[0].amount.value = '16.650'; },
      order => { order.purchase_units[0].amount.currency_code = 'EUR'; },
      order => { order.purchase_units[0].payee.merchant_id = 'ATTACKER'; },
      order => { order.purchase_units[0].custom_id = 'other-deal'; },
      order => { order.purchase_units[0].reference_id = 'other-deal'; },
      order => { order.intent = 'CAPTURE'; },
      order => { order.id = 'OTHERORDER'; },
      order => { order.purchase_units.push(order.purchase_units[0]); },
    ];
    for (const tamper of bad) {
      const order = orderFixture(); tamper(order);
      expect(() => verifyOrder(order, expected, orderId)).toThrow();
    }
    expect(verifyOrder(orderFixture(), expected, orderId).id).toBe(orderId);
  });

  test('approval links stay on the sandbox PayPal origin', () => {
    expect(approvalUrl(orderFixture())).toContain('https://www.sandbox.paypal.com/');
    for (const href of ['https://www.paypal.com/checkout', 'https://www.sandbox.paypal.com.attacker.test/', 'javascript:alert(1)', 'https://user:password@www.sandbox.paypal.com/']) {
      expect(() => approvalUrl({ ...orderFixture(), links: [{ rel: 'approve', href }] })).toThrow();
    }
  });

  test('capture evidence must match amount, order and authorization and be final', () => {
    const good = captureFixture();
    expect(verifyCapture(good, expected, orderId, authorizationId)).toBe(good);
    expect(() => verifyCapture(good, expected, 'OTHER', authorizationId)).toThrow();
    expect(() => verifyCapture(good, expected, orderId, 'OTHER')).toThrow();
    expect(() => verifyCapture({ ...good, final_capture: false }, expected, orderId, authorizationId)).toThrow();
    expect(() => verifyCapture({ ...good, amount: { currency_code: 'USD', value: '16.64' } }, expected, orderId, authorizationId)).toThrow();
    expect(() => verifyAuthorization({ id: authorizationId, amount: good.amount, status: 'MADE_UP' }, expected)).toThrow();
  });
});

describe('provider transport and lifecycle', () => {
  test('create requests AUTHORIZE for the locked price/payee with the caller key', async () => {
    const f = fakePayPal();
    await f.client().createOrder(expected, requestId);
    const call = f.calls.find(call => call.url.endsWith('/v2/checkout/orders'))!;
    const body = JSON.parse(call.init.body as string);
    expect(body.intent).toBe('AUTHORIZE');
    expect(body.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '16.65' });
    expect(body.purchase_units[0].payee.merchant_id).toBe(expected.merchantId);
    expect(new Headers(call.init.headers).get('PayPal-Request-Id')).toBe(requestId);
    expect(call.init.redirect).toBe('manual');
  });

  test('mutations require persisted request IDs and cannot select another merchant', async () => {
    const f = fakePayPal(); const client = f.client();
    await expect(client.createOrder(expected, '')).rejects.toThrow('persisted UUID');
    await expect(client.createOrder({ ...expected, merchantId: 'OTHER' }, requestId)).rejects.toThrow('configured');
    expect(f.calls).toHaveLength(0);
  });

  test('OAuth token is shared between concurrent calls and refreshed before expiry', async () => {
    const f = fakePayPal(); let now = 0; const client = f.client(() => now);
    await Promise.all([client.getOrder(orderId, expected), client.getOrder(orderId, expected)]);
    expect(f.state.tokenCalls).toBe(1);
    now = 241000;
    await client.getOrder(orderId, expected);
    expect(f.state.tokenCalls).toBe(2);
  });

  test('buyer approval is required; an existing authorization is reused', async () => {
    const f = fakePayPal(); const client = f.client();
    await expect(client.authorize(orderId, expected, requestId)).rejects.toThrow('Buyer must approve');
    expect(f.state.authorizeCalls).toBe(0);
    f.state.approved = true;
    expect((await client.authorize(orderId, expected, requestId)).id).toBe(authorizationId);
    await client.authorize(orderId, expected, requestId);
    expect(f.state.authorizeCalls).toBe(1);
    expect(f.state.captureCalls).toBe(0);
  });

  test('handoff and a matching uncaptured authorization are required to capture', async () => {
    const f = fakePayPal(); const client = f.client(); f.state.authorized = true;
    await expect(client.capture(orderId, authorizationId, expected, requestId, false, recordFixtureCapture)).rejects.toThrow('handoff');
    expect(f.calls).toHaveLength(0);
    await expect(client.capture(orderId, 'OTHER', expected, requestId, true, recordFixtureCapture)).rejects.toThrow('belong');
    f.state.authorizationStatus = 'VOIDED';
    await expect(client.capture(orderId, authorizationId, expected, requestId, true, recordFixtureCapture)).rejects.toThrow('available');
    f.state.authorizationStatus = 'CREATED';
    expect((await client.capture(orderId, authorizationId, expected, requestId, true, recordFixtureCapture)).status).toBe('COMPLETED');
    expect(f.state.captureCalls).toBe(1);
  });

  test('an expired authorization cannot be captured', async () => {
    const f = fakePayPal(); f.state.authorized = true;
    f.intercept((url, init) => url.endsWith(`/authorizations/${authorizationId}`) && init.method === 'GET'
      ? response({ id: authorizationId, status: 'CREATED', amount: { currency_code: 'USD', value: '16.65' }, expiration_time: '2000-01-01T00:00:00Z' }) : undefined);
    await expect(f.client().capture(orderId, authorizationId, expected, requestId, true, recordFixtureCapture)).rejects.toThrow('expired');
    expect(f.state.captureCalls).toBe(0);
  });

  test('a minimal capture receipt is recorded before verifying its separate GET', async () => {
    const f = fakePayPal(); f.state.authorized = true;
    let savedId: string | undefined;
    f.intercept((url, init) => {
      if (url.endsWith(`/captures/${captureId}`) && init.method === 'GET') expect(savedId).toBe(captureId);
      return undefined;
    });
    const capture = await f.client().capture(orderId, authorizationId, expected, requestId, true, async id => { savedId = id; });
    expect(capture.status).toBe('COMPLETED');
    expect(savedId).toBe(captureId);
    expect(f.state.captureCalls).toBe(1);
    expect(f.calls.filter(call => call.url.endsWith(`/captures/${captureId}`))).toHaveLength(1);
  });

  test('capture cannot start without a durable receipt recorder', async () => {
    const f = fakePayPal(); f.state.authorized = true;
    await expect(f.client().capture(orderId, authorizationId, expected, requestId, true, undefined as never)).rejects.toThrow('recorder');
    expect(f.calls).toHaveLength(0);
  });

  test('a successful capture POST cannot conceal mismatched GET payment evidence', async () => {
    for (const tamper of [
      (capture: ReturnType<typeof captureFixture>) => { capture.amount.value = '16.66'; },
      (capture: ReturnType<typeof captureFixture>) => { capture.amount.currency_code = 'EUR'; },
      (capture: ReturnType<typeof captureFixture>) => { capture.supplementary_data!.related_ids!.order_id = 'OTHERORDER'; },
      (capture: ReturnType<typeof captureFixture>) => { capture.supplementary_data!.related_ids!.authorization_id = 'OTHERAUTH'; },
      (capture: ReturnType<typeof captureFixture>) => { capture.final_capture = false; },
    ]) {
      const f = fakePayPal(); f.state.authorized = true;
      const invalid = captureFixture(); tamper(invalid);
      let savedId: string | undefined;
      f.intercept((url, init) => url.endsWith(`/captures/${captureId}`) && init.method === 'GET' ? response(invalid) : undefined);
      await expect(f.client().capture(orderId, authorizationId, expected, requestId, true, async id => { savedId = id; })).rejects.toThrow();
      expect(savedId).toBe(captureId);
      expect(f.state.captureCalls).toBe(1);
    }
  });

  test('void is checked with GET, repeat void does not repeat mutation, captured cannot void', async () => {
    const f = fakePayPal(); f.state.authorized = true; const client = f.client();
    expect((await client.void(orderId, authorizationId, expected, requestId)).status).toBe('VOIDED');
    await client.void(orderId, authorizationId, expected, requestId);
    expect(f.state.voidCalls).toBe(1);
    f.state.authorizationStatus = 'CAPTURED';
    await expect(client.void(orderId, authorizationId, expected, requestId)).rejects.toThrow('uncaptured');
  });

  test('transient retries preserve the mutation key; a lost response cannot mint another operation', async () => {
    const f = fakePayPal(); let attempts = 0;
    f.intercept((url, init) => {
      if (url.endsWith('/v2/checkout/orders') && init.method === 'POST' && attempts++ < 2) return response({ name: 'INTERNAL_SERVER_ERROR', debug_id: 'debug123' }, 503);
    });
    await f.client().createOrder(expected, requestId);
    const posts = f.calls.filter(call => call.url.endsWith('/v2/checkout/orders'));
    expect(posts).toHaveLength(3);
    expect(posts.map(call => new Headers(call.init.headers).get('PayPal-Request-Id'))).toEqual([requestId, requestId, requestId]);
    expect(f.delays).toEqual([250, 500]);
  });

  test('instrument decline is not retried and error text omits secret provider fields', async () => {
    const f = fakePayPal();
    f.intercept(url => url.endsWith('/v2/checkout/orders') ? response({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED', description: 'private fixture-secret' }], debug_id: 'debug123', payer: 'private' }, 422) : undefined);
    try { await f.client().createOrder(expected, requestId); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(PayPalError);
      expect((error as PayPalError).issue).toBe('INSTRUMENT_DECLINED');
      expect(String(error)).not.toContain('fixture-secret');
      expect((error as PayPalError).debugId).toBe('debug123');
    }
    expect(f.calls.filter(call => call.url.endsWith('/v2/checkout/orders'))).toHaveLength(1);
  });

  test('long Retry-After is surfaced; short rate limits are respected', async () => {
    for (const seconds of [1, 60]) {
      const f = fakePayPal(); let count = 0;
      f.intercept(url => url.endsWith('/v2/checkout/orders') && count++ === 0 ? response({ name: 'RATE_LIMIT_REACHED' }, 429, { 'retry-after': String(seconds) }) : undefined);
      if (seconds === 1) { await f.client().createOrder(expected, requestId); expect(f.delays).toEqual([1000]); }
      else { await expect(f.client().createOrder(expected, requestId)).rejects.toThrow('RATE_LIMIT'); expect(f.delays).toEqual([]); }
    }
  });

  test('one 401 refreshes OAuth and retries with the same request UUID', async () => {
    const f = fakePayPal(); let failed = false;
    f.intercept(url => {
      if (url.endsWith('/v2/checkout/orders') && !failed) { failed = true; return response({ name: 'AUTHENTICATION_FAILURE' }, 401); }
    });
    await f.client().createOrder(expected, requestId);
    expect(f.state.tokenCalls).toBe(2);
    expect(f.calls.filter(call => call.url.endsWith('/v2/checkout/orders')).map(call => new Headers(call.init.headers).get('PayPal-Request-Id'))).toEqual([requestId, requestId]);
  });

  test('missing webhook headers never reach provider; only SUCCESS verifies', async () => {
    const f = fakePayPal(); const client = f.client();
    expect(await client.verifyWebhook(new Headers(), {}, 'WEBHOOK123', requestId)).toBe(false);
    expect(f.calls).toHaveLength(0);
    const headers = new Headers(Object.fromEntries(['auth-algo', 'cert-url', 'transmission-id', 'transmission-sig', 'transmission-time'].map(key => [`paypal-${key}`, 'fixture'])));
    expect(await client.verifyWebhook(headers, { id: 'EVENT123' }, 'WEBHOOK123', requestId)).toBe(true);
    f.intercept(url => url.endsWith('verify-webhook-signature') ? response({ verification_status: 'FAILURE' }) : undefined);
    expect(await client.verifyWebhook(headers, { id: 'EVENT123' }, 'WEBHOOK123', requestId)).toBe(false);
  });

  test('no capture is inferred from a pending capture response', async () => {
    const f = fakePayPal(); f.state.authorized = true; f.state.captureStatus = 'PENDING';
    expect((await f.client().capture(orderId, authorizationId, expected, requestId, true, recordFixtureCapture)).status).toBe('PENDING');
    expect((await f.client().getCapture(captureId, orderId, authorizationId, expected)).status).toBe('PENDING');
  });
});
