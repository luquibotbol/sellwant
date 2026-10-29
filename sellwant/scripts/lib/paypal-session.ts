import {
  PayPalSandbox, PaymentExpectation, PaymentVerificationError, approvalUrl,
  validateExpectation, verifyAuthorization,
} from '../../worker/paypal';

export type SandboxState = 'new' | 'approval_pending' | 'authorized' | 'capture_pending' | 'captured' | 'void_pending' | 'voided' | 'reconciliation_required';
type Operation = 'create' | 'authorize' | 'capture' | 'void';
export interface SandboxJournal {
  version: 1;
  expected: PaymentExpectation;
  createdAt: string;
  updatedAt: string;
  state: SandboxState;
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
  approvalUrl?: string;
  handoffConfirmedAt?: string;
  operations: Partial<Record<Operation, { requestId: string; startedAt: string }>>;
}

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new PaymentVerificationError(message);
}

export function newJournal(expected: PaymentExpectation, now = Date.now()): SandboxJournal {
  validateExpectation(expected);
  const time = new Date(now).toISOString();
  return { version: 1, expected: { ...expected }, createdAt: time, updatedAt: time, state: 'new', operations: {} };
}

/** A local integration-proof journal, not a substitute for product auth/DB.
 * Its caller holds an exclusive file lock for the full command, including I/O. */
export class SandboxSession {
  constructor(
    readonly journal: SandboxJournal,
    private paypal: PayPalSandbox,
    private persist: (journal: SandboxJournal) => Promise<void>,
    private now = Date.now,
  ) {
    requireThat(journal.version === 1 && journal.operations && typeof journal.operations === 'object', 'Invalid sandbox journal');
    validateExpectation(journal.expected);
  }

  private async save() {
    this.journal.updatedAt = new Date(this.now()).toISOString();
    await this.persist(this.journal);
  }

  private async operation(name: Operation, state?: SandboxState): Promise<string> {
    const existing = this.journal.operations[name];
    if (existing) {
      // Orders guarantee 6-hour request-ID storage. Do not recreate an unknown
      // payment after that window with either an old key or a new one.
      const age = this.now() - Date.parse(existing.startedAt);
      requireThat(Number.isFinite(age) && age >= 0 && age < 5 * 60 * 60 * 1000, 'Retry window exhausted; reconcile this operation in the sandbox dashboard');
    } else {
      this.journal.operations[name] = { requestId: crypto.randomUUID(), startedAt: new Date(this.now()).toISOString() };
    }
    if (state) this.journal.state = state;
    // A failed save must prevent the remote mutation, not merely lose its key.
    await this.save();
    return this.journal.operations[name]!.requestId;
  }

  async reconcile(): Promise<SandboxState> {
    const j = this.journal;
    if (!j.orderId) return j.state;
    const order = await this.paypal.getOrder(j.orderId, j.expected);
    const payments = order.purchase_units[0].payments;
    const authorizations = payments?.authorizations ?? [];
    const captures = payments?.captures ?? [];
    requireThat(authorizations.length <= 1 && captures.length <= 1, 'Multiple payment resources require manual reconciliation');
    if (authorizations.length) {
      const auth = verifyAuthorization(authorizations[0], j.expected, j.authorizationId);
      j.authorizationId = auth.id;
    }
    if (captures.length) {
      requireThat(!j.captureId || j.captureId === captures[0].id, 'Capture ID changed');
      j.captureId = captures[0].id;
    }
    if (j.captureId) {
      requireThat(j.authorizationId, 'Capture without expected authorization');
      const capture = await this.paypal.getCapture(j.captureId, j.orderId, j.authorizationId, j.expected);
      j.state = capture.status === 'COMPLETED' ? 'captured' : capture.status === 'PENDING' ? 'capture_pending' : 'reconciliation_required';
    } else if (j.authorizationId) {
      const auth = await this.paypal.getAuthorization(j.authorizationId, j.expected);
      if (auth.status === 'VOIDED') j.state = 'voided';
      else if (auth.status === 'CREATED') {
        // Preserve an interrupted mutation: CREATED alone does not prove a
        // concurrent provider operation is finished or safe to replace.
        if (j.state !== 'capture_pending' && j.state !== 'void_pending') j.state = 'authorized';
      } else j.state = 'reconciliation_required';
    } else {
      j.state = 'approval_pending';
      if (!j.approvalUrl && order.links?.some(link => link.rel === 'approve' || link.rel === 'payer-action')) j.approvalUrl = approvalUrl(order);
    }
    await this.save();
    return j.state;
  }

  async create() {
    if (this.journal.orderId) { await this.reconcile(); return; }
    const id = await this.operation('create');
    const order = await this.paypal.createOrder(this.journal.expected, id);
    this.journal.orderId = order.id;
    this.journal.state = 'approval_pending';
    // Save the order association before processing an optional approval link.
    await this.save();
    this.journal.approvalUrl = approvalUrl(order);
    await this.save();
  }

  async authorize() {
    const j = this.journal;
    requireThat(j.orderId, 'Create an order first');
    await this.reconcile();
    if (j.authorizationId) return;
    const id = await this.operation('authorize');
    const auth = await this.paypal.authorize(j.orderId, j.expected, id);
    j.authorizationId = auth.id;
    await this.save();
    await this.reconcile();
  }

  async handoff() {
    await this.reconcile();
    const j = this.journal;
    requireThat(j.state === 'authorized' && j.authorizationId, 'A verified authorization is required before the test handoff');
    const auth = await this.paypal.getAuthorization(j.authorizationId, j.expected);
    requireThat(auth.status === 'CREATED', 'Authorization unavailable');
    if (auth.expiration_time) requireThat(Date.parse(auth.expiration_time) > this.now(), 'Authorization expired');
    j.handoffConfirmedAt ??= new Date(this.now()).toISOString();
    await this.save();
  }

  async capture() {
    const j = this.journal;
    requireThat(j.handoffConfirmedAt && Number.isFinite(Date.parse(j.handoffConfirmedAt)), 'Record the human test handoff before capture');
    requireThat(j.orderId && j.authorizationId, 'Authorize the order first');
    await this.reconcile();
    if (j.state === 'captured') return;
    requireThat(!j.operations.void && j.state !== 'voided', 'A void has been requested; capture is forbidden');
    requireThat(!j.captureId, 'Capture already exists; use status to reconcile it');
    const id = await this.operation('capture', 'capture_pending');
    await this.paypal.capture(j.orderId, j.authorizationId, j.expected, id, true, async captureId => {
      j.captureId = captureId;
      await this.save();
    });
    const state = await this.reconcile();
    requireThat(state === 'captured', 'Capture is not completed; use status for reconciliation');
  }

  async void() {
    const j = this.journal;
    requireThat(j.orderId && j.authorizationId, 'An authorization is required for the void proof');
    await this.reconcile();
    if (j.state === 'voided') return;
    requireThat(!j.operations.capture && !j.captureId, 'Capture was attempted; reconcile it before any cancellation');
    const id = await this.operation('void', 'void_pending');
    await this.paypal.void(j.orderId, j.authorizationId, j.expected, id);
    const state = await this.reconcile();
    requireThat(state === 'voided', 'Void not confirmed');
  }
}
