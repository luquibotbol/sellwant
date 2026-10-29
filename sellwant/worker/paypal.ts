/** Server-only sandbox integration. Nothing in app/ or services/ imports this.
 * A PayPal approval, an authorization and a capture are different facts. */
export interface SandboxEnvironment {
  PAYPAL_ENVIRONMENT?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MERCHANT_ID?: string;
}

export interface PaymentExpectation {
  dealId: string;
  amountCents: number;
  currency: 'USD';
  merchantId: string;
}

interface Money { currency_code: string; value: string }
export interface Authorization {
  id: string;
  status: string;
  amount: Money;
  expiration_time?: string;
}
export interface Capture {
  id: string;
  status: string;
  amount: Money;
  final_capture?: boolean;
  supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string } };
}
export interface Order {
  id: string;
  intent: string;
  status: string;
  purchase_units: Array<{
    reference_id: string;
    custom_id: string;
    payee: { merchant_id: string };
    amount: Money;
    payments?: { authorizations?: Authorization[]; captures?: Capture[] };
  }>;
  links?: Array<{ rel: string; href: string }>;
}

type Transport = (url: string, init: RequestInit) => Promise<Response>;
const BASE = 'https://api-m.sandbox.paypal.com';
const RESOURCE_ID = /^[A-Za-z0-9]{1,64}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PaymentVerificationError extends Error {
  constructor(message: string) { super(message); this.name = 'PaymentVerificationError'; }
}

/** Deliberately excludes raw provider bodies, payer information and credentials. */
export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly issue: string,
    readonly debugId: string,
    readonly uncertain: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(`PayPal ${status || 'network'}: ${issue}${debugId ? ` (debug ${debugId})` : ''}`);
    this.name = 'PayPalError';
  }
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new PaymentVerificationError(message);
}

export function sandboxConfig(env: SandboxEnvironment) {
  ensure(env.PAYPAL_ENVIRONMENT === 'SANDBOX', 'PAYPAL_ENVIRONMENT must be SANDBOX');
  const required = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID'] as const;
  for (const key of required) ensure(env[key]?.trim(), `Missing ${key}`);
  ensure(!/[\r\n]/.test(env.PAYPAL_CLIENT_ID! + env.PAYPAL_CLIENT_SECRET!), 'Invalid PayPal credentials');
  resourceId(env.PAYPAL_MERCHANT_ID!);
  return { clientId: env.PAYPAL_CLIENT_ID!, secret: env.PAYPAL_CLIENT_SECRET!, merchantId: env.PAYPAL_MERCHANT_ID! };
}

export function usdValue(cents: number): string {
  ensure(Number.isSafeInteger(cents) && cents > 0, 'Amount must be positive integer cents');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function validateExpectation(expected: PaymentExpectation) {
  ensure(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(expected.dealId), 'Invalid deal ID');
  ensure(expected.currency === 'USD', 'Sandbox milestone supports USD only');
  usdValue(expected.amountCents);
  resourceId(expected.merchantId);
}

function resourceId(id: string) {
  ensure(typeof id === 'string' && RESOURCE_ID.test(id), 'Invalid PayPal resource ID');
  return id;
}

function verifyMoney(money: Money | undefined, expected: PaymentExpectation) {
  ensure(money?.currency_code === expected.currency, 'PayPal currency does not match deal');
  // Parse the provider's decimal without floating-point multiplication.
  const match = /^(0|[1-9]\d*)\.(\d{2})$/.exec(money?.value ?? '');
  ensure(match, 'Invalid PayPal USD amount');
  const cents = Number(match[1]) * 100 + Number(match[2]);
  ensure(Number.isSafeInteger(cents) && cents === expected.amountCents, 'PayPal amount does not match deal');
}

export function verifyOrder(order: Order, expected: PaymentExpectation, orderId?: string): Order {
  validateExpectation(expected);
  resourceId(order?.id);
  ensure(!orderId || order.id === orderId, 'PayPal order ID does not match deal');
  ensure(order.intent === 'AUTHORIZE', 'Expected AUTHORIZE order');
  ensure(Array.isArray(order.purchase_units) && order.purchase_units.length === 1, 'Expected one purchase unit');
  const unit = order.purchase_units[0];
  ensure(unit.reference_id === expected.dealId && unit.custom_id === expected.dealId, 'PayPal deal reference does not match');
  ensure(unit.payee?.merchant_id === expected.merchantId, 'PayPal receiver does not match seller');
  verifyMoney(unit.amount, expected);
  return order;
}

export function verifyAuthorization(auth: Authorization, expected: PaymentExpectation, id?: string) {
  resourceId(auth?.id);
  ensure(!id || auth.id === id, 'PayPal authorization ID does not match');
  verifyMoney(auth.amount, expected);
  ensure(['CREATED', 'CAPTURED', 'PARTIALLY_CAPTURED', 'VOIDED', 'PENDING', 'DENIED', 'EXPIRED'].includes(auth.status), 'Unknown authorization status');
  return auth;
}

export function verifyCapture(capture: Capture, expected: PaymentExpectation, orderId: string, authorizationId: string) {
  resourceId(capture?.id);
  verifyMoney(capture.amount, expected);
  const related = capture.supplementary_data?.related_ids;
  ensure(related?.order_id === orderId && related?.authorization_id === authorizationId, 'Capture does not belong to expected order/authorization');
  ensure(capture.final_capture === true, 'Expected a final capture');
  ensure(['COMPLETED', 'PENDING', 'DECLINED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(capture.status), 'Unknown capture status');
  return capture;
}

export function approvalUrl(order: Order): string {
  const href = order.links?.find(l => l.rel === 'approve' || l.rel === 'payer-action')?.href;
  ensure(href, 'No buyer approval link returned');
  const url = new URL(href);
  ensure(url.protocol === 'https:' && url.hostname === 'www.sandbox.paypal.com' && !url.username && !url.password && !url.port, 'Unexpected PayPal approval URL');
  return url.toString();
}

export class PayPalSandbox {
  private config: ReturnType<typeof sandboxConfig>;
  private transport: Transport;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private cachedToken?: { value: string; expiresAt: number };
  private tokenPromise?: Promise<string>;

  constructor(env: SandboxEnvironment, options: { transport?: Transport; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
    this.config = sandboxConfig(env);
    this.transport = options.transport ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  async accessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > this.now()) return this.cachedToken.value;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      let response: Response;
      try {
        response = await this.transport(`${BASE}/v1/oauth2/token`, {
          method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Basic ${btoa(`${this.config.clientId}:${this.config.secret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials',
        });
      } catch { throw new PayPalError(0, 'OAUTH_UNAVAILABLE', '', false); }
      const data = await response.json().catch(() => null);
      if (!response.ok) throw this.error(response, data, false);
      ensure(typeof data?.access_token === 'string' && data.access_token.length > 0 && Number.isFinite(data.expires_in) && data.expires_in > 0, 'Invalid OAuth response');
      this.cachedToken = { value: data.access_token, expiresAt: this.now() + Math.max(0, data.expires_in - 60) * 1000 };
      return this.cachedToken.value;
    })();
    try { return await this.tokenPromise; }
    finally { this.tokenPromise = undefined; }
  }

  private error(response: Response, data: unknown, uncertain: boolean): PayPalError {
    const value = data as { name?: string; debug_id?: string; details?: Array<{ issue?: string }> } | null;
    const safe = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : '';
    const issue = safe(value?.details?.[0]?.issue) || safe(value?.name) || 'REQUEST_FAILED';
    const retry = response.headers.get('retry-after');
    const seconds = retry == null ? undefined : /^\d+$/.test(retry) ? Number(retry) : Math.max(0, Math.ceil((Date.parse(retry) - this.now()) / 1000));
    return new PayPalError(response.status, issue, safe(value?.debug_id), uncertain, Number.isFinite(seconds) ? seconds : undefined);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, requestId?: string, retryable = true): Promise<T> {
    if (method === 'POST') ensure(REQUEST_ID.test(requestId ?? ''), 'A persisted UUID request ID is required');
    let token = await this.accessToken();
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.transport(`${BASE}${path}`, {
          method, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        if (retryable && attempt < 2) { await this.sleep(250 * 2 ** attempt); continue; }
        throw new PayPalError(0, 'NETWORK_OUTCOME_UNKNOWN', '', method === 'POST');
      }
      if (response.status === 401 && !refreshed) {
        this.cachedToken = undefined;
        token = await this.accessToken();
        refreshed = true;
        continue;
      }
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        try { return await response.json() as T; }
        catch { throw new PayPalError(response.status, 'INVALID_RESPONSE', '', method === 'POST'); }
      }
      const error = this.error(response, await response.json().catch(() => null), method === 'POST' && response.status >= 500);
      if (retryable && attempt < 2 && (response.status === 429 || response.status >= 500)) {
        const delay = error.retryAfterSeconds == null ? 250 * 2 ** attempt : error.retryAfterSeconds * 1000;
        // Long rate limits are surfaced to the durable job runner, never ignored.
        if (delay <= 5000) { await this.sleep(delay); continue; }
      }
      throw error;
    }
  }

  private expected(expected: PaymentExpectation) {
    validateExpectation(expected);
    ensure(expected.merchantId === this.config.merchantId, 'Seller is not the configured sandbox merchant');
  }

  async createOrder(expected: PaymentExpectation, requestId: string): Promise<Order> {
    this.expected(expected);
    const order = await this.request<Order>('POST', '/v2/checkout/orders', {
      intent: 'AUTHORIZE',
      purchase_units: [{
        reference_id: expected.dealId, custom_id: expected.dealId, invoice_id: expected.dealId,
        amount: { currency_code: expected.currency, value: usdValue(expected.amountCents) },
        payee: { merchant_id: expected.merchantId },
      }],
      payment_source: { paypal: { experience_context: {
        shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
        return_url: 'http://127.0.0.1:8789/return', cancel_url: 'http://127.0.0.1:8789/cancel',
      } } },
    }, requestId);
    return verifyOrder(order, expected);
  }

  async getOrder(orderId: string, expected: PaymentExpectation): Promise<Order> {
    this.expected(expected);
    return verifyOrder(await this.request<Order>('GET', `/v2/checkout/orders/${resourceId(orderId)}`), expected, orderId);
  }

  async authorize(orderId: string, expected: PaymentExpectation, requestId: string): Promise<Authorization> {
    const before = await this.getOrder(orderId, expected);
    const existing = before.purchase_units[0].payments?.authorizations ?? [];
    ensure(existing.length <= 1, 'Unexpected multiple authorizations');
    if (existing.length) return verifyAuthorization(existing[0], expected);
    ensure(before.status === 'APPROVED', 'Buyer must approve the PayPal order first');
    const result = verifyOrder(await this.request<Order>('POST', `/v2/checkout/orders/${resourceId(orderId)}/authorize`, {}, requestId), expected, orderId);
    const auths = result.purchase_units[0].payments?.authorizations ?? [];
    ensure(auths.length === 1, 'Expected one authorization');
    return verifyAuthorization(auths[0], expected);
  }

  async getAuthorization(id: string, expected: PaymentExpectation) {
    this.expected(expected);
    return verifyAuthorization(await this.request<Authorization>('GET', `/v2/payments/authorizations/${resourceId(id)}`), expected, id);
  }

  private async boundAuthorization(orderId: string, authorizationId: string, expected: PaymentExpectation) {
    const order = await this.getOrder(orderId, expected);
    const auths = order.purchase_units[0].payments?.authorizations ?? [];
    ensure(auths.length === 1 && auths[0].id === authorizationId, 'Authorization does not belong to order');
    verifyAuthorization(auths[0], expected, authorizationId);
    return this.getAuthorization(authorizationId, expected);
  }

  async capture(orderId: string, authorizationId: string, expected: PaymentExpectation, requestId: string, handoffConfirmed: boolean): Promise<Capture> {
    // The product caller must supply an authenticated, persisted human attestation.
    // The isolated CLI supplies only a local test attestation, never user authority.
    ensure(handoffConfirmed, 'Human handoff confirmation is required before capture');
    const auth = await this.boundAuthorization(orderId, authorizationId, expected);
    ensure(auth.status === 'CREATED', 'Authorization is not available for capture; reconcile before retrying');
    if (auth.expiration_time) ensure(Date.parse(auth.expiration_time) > this.now(), 'Authorization has expired');
    const capture = await this.request<Capture>('POST', `/v2/payments/authorizations/${resourceId(authorizationId)}/capture`, {
      amount: { currency_code: expected.currency, value: usdValue(expected.amountCents) },
      invoice_id: expected.dealId, final_capture: true,
    }, requestId);
    return verifyCapture(capture, expected, orderId, authorizationId);
  }

  async getCapture(captureId: string, orderId: string, authorizationId: string, expected: PaymentExpectation): Promise<Capture> {
    this.expected(expected);
    const capture = verifyCapture(await this.request<Capture>('GET', `/v2/payments/captures/${resourceId(captureId)}`), expected, orderId, authorizationId);
    ensure(capture.id === captureId, 'Capture ID does not match');
    return capture;
  }

  async void(orderId: string, authorizationId: string, expected: PaymentExpectation, requestId: string): Promise<Authorization> {
    const auth = await this.boundAuthorization(orderId, authorizationId, expected);
    if (auth.status === 'VOIDED') return auth;
    ensure(auth.status === 'CREATED', 'Only an uncaptured authorization can be voided');
    // Void's specification does not promise request-ID retention. Reconcile by
    // GET after interruption rather than blindly retrying a mutation.
    await this.request('POST', `/v2/payments/authorizations/${resourceId(authorizationId)}/void`, {}, requestId, false);
    const after = await this.getAuthorization(authorizationId, expected);
    ensure(after.status === 'VOIDED', 'Void not confirmed by PayPal; reconciliation required');
    return after;
  }

  async verifyWebhook(headers: Headers, event: unknown, webhookId: string, requestId: string): Promise<boolean> {
    resourceId(webhookId);
    const fields = ['auth-algo', 'cert-url', 'transmission-id', 'transmission-sig', 'transmission-time'];
    const values = fields.map(field => headers.get(`paypal-${field}`));
    if (values.some(value => !value)) return false;
    const [auth_algo, cert_url, transmission_id, transmission_sig, transmission_time] = values;
    const result = await this.request<{ verification_status?: string }>('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo, cert_url, transmission_id, transmission_sig, transmission_time,
      webhook_id: webhookId, webhook_event: event,
    }, requestId);
    return result.verification_status === 'SUCCESS';
  }
}
