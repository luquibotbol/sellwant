/**
 * The handoff, tested as pure data.
 *
 * The state x role table is the thing that decides which button each person
 * sees. Getting a cell wrong shows a seller an "I paid" button, which the
 * database then refuses -- so the user sees an error they cannot act on. That
 * is worth asserting without spinning up a renderer.
 */
import { describe, expect, test } from 'bun:test';
import { HANDOFF, PROGRESS, stepFor, type HandoffState, type Role } from '../lib/handoff';
import { payAction } from '../lib/payments';
import { money, todayISO, relativeDate, whenAndWhere, toISODate } from '../lib/format';

const STATES: HandoffState[] = ['pending_payment', 'paid', 'confirmed', 'cancelled'];
const ROLES: Role[] = ['buyer', 'seller'];

describe('handoff step map', () => {
  test('every state x role cell exists', () => {
    for (const s of STATES) {
      for (const r of ROLES) {
        const step = stepFor(s, r);
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.body.length).toBeGreaterThan(0);
      }
    }
  });

  test('only the buyer is ever offered a forward action', () => {
    for (const s of STATES) {
      // The seller has no primary action in any state -- D5 made the handoff
      // buyer-driven, so a seller-side primary button would be a bug.
      expect(stepFor(s, 'seller').primary).toBeUndefined();
    }
  });

  test('buyer forward actions follow the sequence, and only there', () => {
    expect(stepFor('pending_payment', 'buyer').primary?.to).toBe('paid');
    expect(stepFor('paid', 'buyer').primary?.to).toBe('confirmed');
    // Terminal states offer nothing.
    expect(stepFor('confirmed', 'buyer').primary).toBeUndefined();
    expect(stepFor('cancelled', 'buyer').primary).toBeUndefined();
  });

  test('either party can cancel while open, nobody once settled', () => {
    for (const r of ROLES) {
      expect(stepFor('pending_payment', r).secondary?.to).toBe('cancelled');
      expect(stepFor('paid', r).secondary?.to).toBe('cancelled');
      expect(stepFor('confirmed', r).secondary).toBeUndefined();
      expect(stepFor('cancelled', r).secondary).toBeUndefined();
    }
  });

  test('cancelling asks for confirmation first', () => {
    expect(stepFor('pending_payment', 'buyer').secondary?.confirm).toBeTruthy();
  });

  test('payment handles are shown only where paying is the next step', () => {
    expect(stepFor('pending_payment', 'buyer').showPayment).toBe(true);
    expect(stepFor('pending_payment', 'seller').showPayment).toBeFalsy();
    expect(stepFor('paid', 'buyer').showPayment).toBeFalsy();
  });

  test('whoever is not acting is marked as waiting', () => {
    expect(stepFor('pending_payment', 'seller').waiting).toBe(true);
    expect(stepFor('pending_payment', 'buyer').waiting).toBe(false);
    expect(stepFor('paid', 'seller').waiting).toBe(true);
    expect(stepFor('paid', 'buyer').waiting).toBe(false);
  });

  test('copy never claims SellUp verified or holds anything', () => {
    // Money moves off-platform. Language implying we checked it, or that we
    // are holding a ticket, is the exact overclaim the product must not make.
    const forbidden = [
      /\bwe (?:have |are )?(?:verified|confirmed|hold|holding)\b/i,
      /\bpayment (?:is )?(?:verified|secured|guaranteed)\b/i,
      /\bwe(?:'ll| will) (?:hold|release) (?:the |your )?ticket\b/i,
      /\bsafely held\b/i,
      /\bprotected by SellUp\b/i,
    ];
    for (const s of STATES) {
      for (const r of ROLES) {
        const text = `${stepFor(s, r).title} ${stepFor(s, r).body}`;
        for (const re of forbidden) {
          expect(text).not.toMatch(re);
        }
      }
    }
  });

  test('progress rail covers the happy path and excludes cancelled', () => {
    expect(PROGRESS).toEqual(['pending_payment', 'paid', 'confirmed']);
    expect(PROGRESS).not.toContain('cancelled');
  });

  test('the table has exactly the states the database allows', () => {
    expect(Object.keys(HANDOFF).sort()).toEqual([...STATES].sort());
  });
});

describe('payment links', () => {
  const note = 'SellUp — Kappa formal';

  test('venmo gets a deep link with the amount prefilled', () => {
    const a = payAction({ kind: 'venmo', value: '@maya-r' }, 3000, note);
    expect(a.kind).toBe('link');
    if (a.kind !== 'link') throw new Error('unreachable');
    expect(a.url).toContain('venmo.com/maya-r');
    expect(a.url).toContain('amount=30.00');
  });

  test('a leading @ or $ is not doubled up', () => {
    const v = payAction({ kind: 'venmo', value: '@maya-r' }, 100, note);
    const c = payAction({ kind: 'cashapp', value: '$deshawnk' }, 100, note);
    if (v.kind !== 'link' || c.kind !== 'link') throw new Error('unreachable');
    expect(v.url).not.toContain('@@');
    expect(v.url).not.toContain('%40');
    expect(c.url).toContain('/$deshawnk/');
    expect(c.url).not.toContain('$$');
  });

  test('cash app puts the amount in the path', () => {
    const a = payAction({ kind: 'cashapp', value: 'deshawnk' }, 1850, note);
    if (a.kind !== 'link') throw new Error('unreachable');
    expect(a.url).toBe('https://cash.app/$deshawnk/18.50');
  });

  test('zelle degrades to copy — it has no deep link', () => {
    // Zelle lives inside the bank's own app and is addressed by phone/email.
    // Rendering a button that opens nothing is worse than saying so.
    const a = payAction({ kind: 'zelle', value: 'deshawn@example.edu' }, 3000, note);
    expect(a.kind).toBe('copy');
    if (a.kind !== 'copy') throw new Error('unreachable');
    expect(a.value).toBe('deshawn@example.edu');
    expect(a.hint).toMatch(/bank/i);
  });

  test('an unknown handle kind still yields something usable', () => {
    const a = payAction({ kind: 'other', value: 'apple cash 555', label: 'Apple Cash' }, 100, note);
    expect(a.kind).toBe('copy');
  });
});

describe('formatters', () => {
  test('money drops cents only when there are none', () => {
    expect(money(2000)).toBe('$20');
    expect(money(1850)).toBe('$18.50');
    expect(money(1)).toBe('$0.01');
  });

  test('dates use local time, not UTC', () => {
    // toISOString() converts to UTC first, so anywhere west of Greenwich
    // reports yesterday all evening -- which is when tickets get posted.
    const d = new Date(2026, 7, 15, 23, 30);
    expect(toISODate(d)).toBe('2026-08-15');
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('near dates read relatively', () => {
    expect(relativeDate(todayISO())).toBe('Tonight');
    const t = new Date();
    t.setDate(t.getDate() + 1);
    expect(relativeDate(toISODate(t))).toBe('Tomorrow');
  });

  test('whenAndWhere tolerates either half missing', () => {
    expect(whenAndWhere(null, 'Sig Ep house')).toBe('Sig Ep house');
    expect(whenAndWhere(null, null)).toBe('');
    expect(whenAndWhere(todayISO(), 'Sig Ep house')).toBe('Tonight · Sig Ep house');
  });
});
