import { describe, expect, test } from 'bun:test';
import { newJournal, SandboxJournal, SandboxSession } from '../scripts/lib/paypal-session';
import { expected, fakePayPal } from './paypal-fixtures';

function setup() {
  const fixture = fakePayPal();
  let saved = newJournal(expected);
  const persist = async (value: SandboxJournal) => { saved = structuredClone(value); };
  return { fixture, persist, saved: () => structuredClone(saved), session: () => new SandboxSession(structuredClone(saved), fixture.client(), persist) };
}

describe('resumable sandbox payment proof', () => {
  test('new processes resume create, approval, authorization, handoff and verified capture once', async () => {
    const f = setup();
    await f.session().create();
    await f.session().create();
    expect(f.fixture.state.createCalls).toBe(1);
    expect(f.saved().state).toBe('approval_pending');
    f.fixture.state.approved = true;
    await f.session().authorize();
    await f.session().authorize();
    expect(f.saved().state).toBe('authorized');
    expect(f.fixture.state.authorizeCalls).toBe(1);
    await expect(f.session().capture()).rejects.toThrow('handoff');
    expect(f.fixture.state.captureCalls).toBe(0);
    await f.session().handoff();
    await f.session().capture();
    await f.session().capture();
    expect(f.fixture.state.captureCalls).toBe(1);
    expect(f.saved().state).toBe('captured');
  });

  test('an independent order can be voided exactly once and cannot then capture', async () => {
    const f = setup(); await f.session().create(); f.fixture.state.approved = true;
    await f.session().authorize(); await f.session().handoff();
    await f.session().void(); await f.session().void();
    expect(f.saved().state).toBe('voided');
    expect(f.fixture.state.voidCalls).toBe(1);
    await expect(f.session().capture()).rejects.toThrow('void');
    expect(f.fixture.state.captureCalls).toBe(0);
  });

  test('journal write failure prevents the first payment mutation', async () => {
    const f = fakePayPal();
    const session = new SandboxSession(newJournal(expected), f.client(), async () => { throw new Error('Disk full'); });
    await expect(session.create()).rejects.toThrow('Disk full');
    expect(f.calls).toHaveLength(0);
  });

  test('a lost void response is recovered by GET without repeating the mutation', async () => {
    const f = setup(); await f.session().create(); f.fixture.state.approved = true;
    await f.session().authorize();
    f.fixture.intercept((url, init) => {
      if (url.endsWith('/void') && init.method === 'POST') {
        f.fixture.state.authorizationStatus = 'VOIDED';
        f.fixture.state.voidCalls++;
        throw new Error('Void completed but response lost');
      }
      return undefined;
    });
    await expect(f.session().void()).rejects.toThrow('NETWORK_OUTCOME_UNKNOWN');
    expect(f.saved().state).toBe('void_pending');
    f.fixture.intercept(undefined);
    await f.session().void();
    expect(f.saved().state).toBe('voided');
    expect(f.fixture.state.voidCalls).toBe(1);
  });

  test('crash after remote capture but before saving its ID reconciles without a second capture', async () => {
    const f = setup(); await f.session().create(); f.fixture.state.approved = true;
    await f.session().authorize(); await f.session().handoff();
    const interrupted = new SandboxSession(f.saved(), f.fixture.client(), async journal => {
      if (journal.captureId) throw new Error('Simulated disk interruption');
      await f.persist(journal);
    });
    await expect(interrupted.capture()).rejects.toThrow('disk interruption');
    expect(f.saved().state).toBe('capture_pending');
    expect(f.saved().operations.capture?.requestId).toBeTruthy();
    expect(f.saved().captureId).toBeUndefined();
    await f.session().capture();
    expect(f.saved().state).toBe('captured');
    expect(f.fixture.state.captureCalls).toBe(1);
  });

  test('uncertain capture blocks void and preserves its idempotency key', async () => {
    const f = setup(); await f.session().create(); f.fixture.state.approved = true;
    await f.session().authorize(); await f.session().handoff();
    f.fixture.intercept((url, init) => {
      if (url.endsWith('/capture') && init.method === 'POST') throw new Error('Network interrupted');
      return undefined;
    });
    await expect(f.session().capture()).rejects.toThrow('NETWORK_OUTCOME_UNKNOWN');
    const key = f.saved().operations.capture?.requestId;
    await expect(f.session().void()).rejects.toThrow('Capture was attempted');
    expect(f.fixture.state.voidCalls).toBe(0);
    f.fixture.intercept(undefined);
    await f.session().capture();
    expect(f.saved().operations.capture?.requestId).toBe(key);
    expect(f.saved().state).toBe('captured');
  });

  test('pending capture remains pending until PayPal confirms COMPLETED', async () => {
    const f = setup(); await f.session().create(); f.fixture.state.approved = true;
    await f.session().authorize(); await f.session().handoff();
    f.fixture.state.captureStatus = 'PENDING';
    await expect(f.session().capture()).rejects.toThrow('not completed');
    expect(f.saved().state).toBe('capture_pending');
    await expect(f.session().capture()).rejects.toThrow('already exists');
    expect(f.fixture.state.captureCalls).toBe(1);
    f.fixture.state.captureStatus = 'COMPLETED';
    await f.session().reconcile();
    expect(f.saved().state).toBe('captured');
  });

  test('an unknown create is never repeated beyond provider key retention', async () => {
    const f = setup();
    f.fixture.intercept((url, init) => {
      if (url.endsWith('/orders') && init.method === 'POST') throw new Error('Unknown result');
      return undefined;
    });
    await expect(f.session().create()).rejects.toThrow('NETWORK_OUTCOME_UNKNOWN');
    const old = f.saved();
    const restarted = new SandboxSession(old, f.fixture.client(), f.persist, () => Date.parse(old.operations.create!.startedAt) + 6 * 60 * 60 * 1000);
    const count = f.fixture.calls.length;
    await expect(restarted.create()).rejects.toThrow('Retry window exhausted');
    expect(f.fixture.calls).toHaveLength(count);
  });
});
