import { describe, expect, test } from 'bun:test';
import { offerEmail } from '../worker/index.js';

const UNSUB = 'https://sellwant.com/api/unsubscribe?u=u1&k=offer_received&s=abc';

const row = (payload: Record<string, unknown>, collapsed = 1) => ({
  id: 'row-1',
  kind: 'offer_received',
  to_email: 'someone@example.edu',
  to_profile: 'u1',
  listing_id: 'abc',
  payload: { listing_title: 'Kappa formal', listing_type: 'sell', amount_cents: 3000, ...payload },
  collapsed,
});

describe('offerEmail', () => {
  test('a single offer names the amount and the listing', () => {
    const { subject, text } = offerEmail(row({}), UNSUB);
    expect(subject).toContain('$30');
    expect(subject).toContain('Kappa formal');
    expect(text).toContain('$30');
  });

  test('a counter reads as a reply, not as news', () => {
    const { subject, text } = offerEmail(row({ is_counter: true }), UNSUB);
    expect(subject).toContain('back on');
    expect(text).toContain('countered');
  });

  test('a batch says how many, and calls the amount the latest one', () => {
    const { subject, text } = offerEmail(row({}, 3), UNSUB);
    expect(subject).toContain('3 new offers');
    // "latest", never "up to": the batch keeps the newest row, not the highest,
    // so any superlative here would be a number we invented.
    expect(subject).toContain('latest');
    expect(subject).not.toContain('up to');
    expect(text).toContain('3 new offers');
  });

  test('the offer message is included when there is one', () => {
    const { html, text } = offerEmail(row({ message: 'can you do 25?' }), UNSUB);
    expect(html).toContain('can you do 25?');
    expect(text).toContain('can you do 25?');
  });

  test('a title with markup in it cannot inject any', () => {
    const { html } = offerEmail(
      row({ listing_title: '<script>alert(1)</script>', message: '<b>hi</b>' }),
      UNSUB
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>hi</b>');
  });

  test('every email carries the link to the listing and the unsubscribe', () => {
    const { html, text } = offerEmail(row({}), UNSUB);
    expect(html).toContain('https://sellwant.com/event/abc');
    // Escaped in the href, which is what correct HTML looks like -- the browser
    // reverses it. The plain part carries the URL as typed.
    expect(html).toContain(UNSUB.replace(/&/g, '&amp;'));
    expect(text).toContain(UNSUB);
  });

  test('never implies SellWant is holding anything', () => {
    const { html, text } = offerEmail(row({}), UNSUB);
    for (const body of [html, text]) {
      expect(body).toContain('never holds the ticket or the money');
      expect(body.toLowerCase()).not.toContain('reserved');
      expect(body.toLowerCase()).not.toContain('secured');
    }
  });

  test('a missing amount does not render NaN at somebody', () => {
    const { subject } = offerEmail(
      { ...row({}), payload: { listing_title: 'x' } } as never,
      UNSUB
    );
    expect(subject).not.toContain('NaN');
  });
});
