import { describe, expect, test } from 'bun:test';
import { sideOf } from '../lib/offer-side';

const ME = 'me';
const THEM = 'them';
const offer = (listingOwner: string, type: 'sell' | 'ask') =>
  ({ listing: { user_id: listingOwner, type } }) as never;

/**
 * The truth table that makes the Buying/Selling filter mean anything. It is
 * easy to get backwards, because the same listing type puts you on opposite
 * sides depending on whether the listing is yours.
 */
describe('sideOf', () => {
  test('your sell listing: someone is buying from you, so you are selling', () => {
    expect(sideOf(offer(ME, 'sell'), ME)).toBe('selling');
  });

  test('your want listing: someone is selling to you, so you are buying', () => {
    expect(sideOf(offer(ME, 'ask'), ME)).toBe('buying');
  });

  test("their sell listing: you offered to buy", () => {
    expect(sideOf(offer(THEM, 'sell'), ME)).toBe('buying');
  });

  test('their want listing: you offered to sell', () => {
    expect(sideOf(offer(THEM, 'ask'), ME)).toBe('selling');
  });

  test('a deleted listing has no side rather than a wrong one', () => {
    expect(sideOf({ listing: null } as never, ME)).toBeNull();
  });
});
