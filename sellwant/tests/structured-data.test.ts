import { describe, expect, test } from 'bun:test';
import { jsonLd, bodySummary } from '../worker/index.js';

const sell = {
  id: 'abc',
  title: 'Kappa formal',
  type: 'sell',
  price_cents: 3500,
  event_date: '2026-09-12',
  location: 'The Ballroom',
  best_offer_cents: 3000,
};
const want = { ...sell, type: 'ask', title: 'Need one for Kappa' };
const URL_ = 'https://sellwant.com/event/abc';

describe('jsonLd', () => {
  test('a sell listing is an Offer', () => {
    const d = JSON.parse(jsonLd(sell, URL_));
    expect(d['@type']).toBe('Event');
    expect(d.offers['@type']).toBe('Offer');
    expect(d.offers.price).toBe('35.00');
    expect(d.offers.priceCurrency).toBe('USD');
  });

  test('a want listing is a Demand, not an Offer', () => {
    // The whole point. Flattening both into Offer would tell every reader
    // that someone is selling when they are in fact buying.
    const d = JSON.parse(jsonLd(want, URL_));
    expect(d.offers['@type']).toBe('Demand');
  });

  test('the offer expires with the event', () => {
    // A ticket to a party that already happened is not for sale.
    expect(JSON.parse(jsonLd(sell, URL_)).offers.validThrough).toBe('2026-09-12');
  });

  test('a listing with no date or place still produces valid JSON', () => {
    const d = JSON.parse(jsonLd({ ...sell, event_date: null, location: null }, URL_));
    expect(d.startDate).toBeUndefined();
    expect(d.location).toBeUndefined();
    expect(d.offers.validThrough).toBeUndefined();
  });

  test('a title cannot close the script block', () => {
    // Unescaped, "</script>" inside the JSON would end the block early and
    // spill the rest of the document into executable position.
    const raw = jsonLd({ ...sell, title: 'x</script><script>alert(1)</script>' }, URL_);
    expect(raw).not.toContain('</script>');
    expect(JSON.parse(raw).name).toContain('script');
  });
});

describe('bodySummary', () => {
  test('states the direction in words, not just markup', () => {
    expect(bodySummary(sell, URL_)).toContain('For sale on SellWant.');
    expect(bodySummary(want, URL_)).toContain('Wanted on SellWant.');
  });

  test('carries the facts a reader needs', () => {
    const html = bodySummary(sell, URL_);
    expect(html).toContain('Kappa formal');
    expect(html).toContain('$35');
    expect(html).toContain('The Ballroom');
    expect(html).toContain('Top offer');
  });

  test('user text cannot become markup', () => {
    // Two layers, and they run in this order: plain() strips angle brackets,
    // then esc() escapes whatever is left. So a tag never survives as a tag --
    // it does not even survive as an entity, because there is nothing left to
    // escape by the time esc() sees it. Assert the guarantee (no element),
    // not the mechanism.
    const html = bodySummary({ ...sell, title: '<img src=x onerror=alert(1)>' }, URL_);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>');
    expect(html).toContain('img src=x'); // flattened to text, still readable

    // esc() is still load-bearing for characters plain() leaves alone.
    expect(bodySummary({ ...sell, location: 'Tom &amp; Jerry\'s' }, URL_)).toContain('&amp;amp;');
  });

  test('is inert for browsers', () => {
    expect(bodySummary(sell, URL_).startsWith('<noscript>')).toBe(true);
  });
});
