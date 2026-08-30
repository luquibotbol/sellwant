import { describe, expect, test } from 'bun:test';
import { unsubSig, sameSig } from '../worker/index.js';

const SECRET = 'test-secret-value-at-least-32-bytes-long';
const USER = '11111111-2222-3333-4444-555555555555';

describe('unsubscribe signatures', () => {
  test('the same user and kind always sign the same', async () => {
    expect(await unsubSig(SECRET, USER, 'offer_received')).toBe(
      await unsubSig(SECRET, USER, 'offer_received')
    );
  });

  test('one person cannot unsubscribe another', async () => {
    const mine = await unsubSig(SECRET, USER, 'offer_received');
    const theirs = await unsubSig(SECRET, '99999999-2222-3333-4444-555555555555', 'offer_received');
    expect(mine).not.toBe(theirs);
  });

  test('a link for one kind does not work for another', async () => {
    expect(await unsubSig(SECRET, USER, 'offer_received')).not.toBe(
      await unsubSig(SECRET, USER, 'deal_advanced')
    );
  });

  test('the signature does not survive rotating the secret', async () => {
    expect(await unsubSig(SECRET, USER, 'offer_received')).not.toBe(
      await unsubSig(`${SECRET}x`, USER, 'offer_received')
    );
  });

  test('short enough to survive a mail client, long enough to matter', async () => {
    const sig = await unsubSig(SECRET, USER, 'offer_received');
    expect(sig).toMatch(/^[0-9a-f]{32}$/);
  });

  test('comparison rejects the empty and the truncated', async () => {
    const sig = await unsubSig(SECRET, USER, 'offer_received');
    expect(sameSig(sig, sig)).toBe(true);
    expect(sameSig(sig, sig.slice(0, 31))).toBe(false);
    expect(sameSig(sig, '')).toBe(false);
    // A missing ?s= arrives as null, and two absent values must not match.
    expect(sameSig(null, undefined)).toBe(false);
  });
});
