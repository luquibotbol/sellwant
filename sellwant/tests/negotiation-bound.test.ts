import { describe, expect, test } from 'bun:test';
import { mentionsAmount, validateNegotiation } from '../worker/ai';
import { offers, place, terms } from './ai-fixtures';

/**
 * The owner's private bound sits in the model's context beside offer text a
 * counterparty wrote. The model's message is published as-is, so the check
 * that it does not name the bound has to be deterministic.
 */
describe('a public offer message never reveals the private bound', () => {
  const ctx = { terms, offers, own_offer_ids: [] as string[] };

  test('every common way of writing the bound is refused', () => {
    // terms.bound_cents is 1600 (a $16.00 floor)
    for (const message of ['My floor is 1600 cents.', 'I can go as low as $16.00', '$16 is my limit', '16 dollars, final', 'lowest is 1,600']) {
      expect(() => validateNegotiation({ ...place, message }, ctx)).toThrow();
    }
  });

  test("an ordinary message and the offer's own amount still pass", () => {
    expect(() => validateNegotiation(place, ctx)).not.toThrow();
    expect(() => validateNegotiation({ ...place, message: 'Happy to meet at $17.00 tonight.' }, ctx)).not.toThrow();
    // Offering exactly the bound publishes that amount anyway.
    expect(() => validateNegotiation({ ...place, amount_cents: 1600, message: 'Final: $16.00' }, ctx)).not.toThrow();
  });

  test('the matcher reads dollars, cents and separators', () => {
    expect(mentionsAmount('$16.5', 1650)).toBe(true);
    expect(mentionsAmount('2 tickets for 20', 1600)).toBe(false);
    expect(mentionsAmount('1,600.00', 160000)).toBe(true);
  });
});
