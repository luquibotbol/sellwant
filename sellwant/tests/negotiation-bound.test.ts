import { describe, expect, test } from 'bun:test';
import { mentionsAmount, proposeNegotiation, publicOfferMessage, validateNegotiation, type AgentTransport } from '../worker/ai';
import { env, listing, modelResponse, offers, place, terms } from './ai-fixtures';

/**
 * The owner's private bound sits in the model's context beside offer text a
 * counterparty wrote. The model's own message is never published: the posted
 * text is a template built from the offer amount. The lexical check stays as
 * a second line, so a proposal that names the bound is still refused.
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

  test('the published message is a template, never model text', async () => {
    // Spelled-out and non-ASCII forms slip past any lexical check, so the
    // model's message must not be what gets posted.
    for (const message of ['sixteen dollars is my floor', 'floor is １６００', 'floor 1.6e3 cents']) {
      const out = await proposeNegotiation(env, { terms, listing, offers, own_offer_ids: [], offers_complete: true },
        (async () => modelResponse({ ...place, message })) as unknown as AgentTransport);
      expect(out.proposal.message).toBe(publicOfferMessage(place.amount_cents as number));
    }
  });

  test('the matcher reads dollars, cents and separators', () => {
    expect(mentionsAmount('$16.5', 1650)).toBe(true);
    expect(mentionsAmount('2 tickets for 20', 1600)).toBe(false);
    expect(mentionsAmount('1,600.00', 160000)).toBe(true);
  });
});
