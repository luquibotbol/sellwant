import { Capture, Order, PaymentExpectation, PayPalSandbox } from '../worker/paypal';

export const sandboxEnv = {
  PAYPAL_ENVIRONMENT: 'SANDBOX', PAYPAL_CLIENT_ID: 'fixture-client',
  PAYPAL_CLIENT_SECRET: 'fixture-secret', PAYPAL_MERCHANT_ID: 'MERCHANT12345',
};
export const expected: PaymentExpectation = {
  dealId: 'synthetic-deal-001', amountCents: 1665, currency: 'USD', merchantId: sandboxEnv.PAYPAL_MERCHANT_ID,
};
export const orderId = 'ORDER123456789012';
export const authorizationId = 'AUTH1234567890123';
export const captureId = 'CAPTURE1234567890';
export const requestId = 'f7f9708c-23bc-4ddd-a38b-a1ee79877d97';
export const money = { currency_code: 'USD', value: '16.65' };
export const response = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

export function captureFixture(): Capture {
  return {
    id: captureId, status: 'COMPLETED', amount: { ...money }, final_capture: true,
    supplementary_data: { related_ids: { order_id: orderId, authorization_id: authorizationId } },
  };
}

export function orderFixture(): Order {
  return {
    id: orderId, intent: 'AUTHORIZE', status: 'APPROVED',
    purchase_units: [{
      reference_id: expected.dealId, custom_id: expected.dealId,
      payee: { merchant_id: expected.merchantId }, amount: { ...money },
    }],
    links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` }],
  };
}

/** Provider protocol fixtures, never a live payment proof. */
export function fakePayPal() {
  const state = {
    approved: false, authorized: false, authorizationStatus: 'CREATED', captured: false,
    captureStatus: 'COMPLETED', tokenCalls: 0, createCalls: 0, authorizeCalls: 0, captureCalls: 0, voidCalls: 0,
  };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const delays: number[] = [];
  const order = () => {
    const value = orderFixture();
    value.status = state.authorized ? 'COMPLETED' : state.approved ? 'APPROVED' : 'PAYER_ACTION_REQUIRED';
    value.purchase_units[0].payments = {
      ...(state.authorized ? { authorizations: [{ id: authorizationId, amount: { ...money }, status: state.authorizationStatus }] } : {}),
      ...(state.captured ? { captures: [{ ...captureFixture(), status: state.captureStatus }] } : {}),
    };
    return value;
  };
  let intercept: ((url: string, init: RequestInit) => Response | undefined) | undefined;
  const transport = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (!url.startsWith('https://api-m.sandbox.paypal.com/')) throw new Error('Non-sandbox URL');
    const override = intercept?.(url, init);
    if (override) return override;
    if (url.endsWith('/v1/oauth2/token')) {
      state.tokenCalls++;
      return response({ access_token: 'fixture-token', expires_in: 300 });
    }
    if (url.endsWith('/v1/notifications/verify-webhook-signature')) return response({ verification_status: 'SUCCESS' });
    if (url.endsWith('/v2/checkout/orders') && init.method === 'POST') { state.createCalls++; return response(order(), 201); }
    if (url.endsWith(`/orders/${orderId}`) && init.method === 'GET') return response(order());
    if (url.endsWith(`/orders/${orderId}/authorize`)) {
      state.authorized = true; state.authorizeCalls++;
      return response(order(), 201);
    }
    if (url.endsWith(`/authorizations/${authorizationId}`) && init.method === 'GET') {
      return response({ id: authorizationId, status: state.authorizationStatus, amount: { ...money } });
    }
    if (url.endsWith(`/authorizations/${authorizationId}/capture`)) {
      state.captureCalls++; state.captured = true; state.authorizationStatus = 'CAPTURED';
      return response({ ...captureFixture(), status: state.captureStatus }, 201);
    }
    if (url.endsWith(`/captures/${captureId}`) && init.method === 'GET') return response({ ...captureFixture(), status: state.captureStatus });
    if (url.endsWith(`/authorizations/${authorizationId}/void`)) {
      state.voidCalls++; state.authorizationStatus = 'VOIDED'; return response(null, 204);
    }
    throw new Error(`Unexpected fixture request: ${init.method} ${url}`);
  };
  return {
    state, calls, delays, order, transport,
    intercept: (handler: typeof intercept) => { intercept = handler; },
    client: (now?: () => number) => new PayPalSandbox(sandboxEnv, { transport, now, sleep: async ms => { delays.push(ms); } }),
  };
}
