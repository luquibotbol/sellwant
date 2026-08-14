/**
 * The authorization boundary, against the real database.
 *
 * These are the tests that matter. `advance_deal` is the only thing standing
 * between "reputation means something" and "a seller can award themselves
 * handoffs." That rule lives in Postgres, so asserting it in JS would prove
 * nothing -- these call the real RPC as real users.
 *
 * Needs the same .env the app uses. Each test creates its own listing and deal
 * and cleans up after itself, so runs don't collide.
 */
import { beforeAll, afterAll, describe, expect, test } from 'bun:test';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const BUYER = { email: 'maya@example.edu', id: 'aaaa1111-0000-4000-8000-000000000001' };
const SELLER = { email: 'deshawn@example.edu', id: 'aaaa1111-0000-4000-8000-000000000002' };
const PASSWORD = 'sellup-dev-only';

let buyerTok = '';
let sellerTok = '';
const madeListings: string[] = [];

async function signIn(email: string): Promise<string> {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

const hdrs = (tok: string) => ({
  apikey: KEY,
  Authorization: `Bearer ${tok}`,
  'Content-Type': 'application/json',
});

async function rest(tok: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...hdrs(tok), Prefer: 'return=representation', ...(init.headers ?? {}) },
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

/** Returns the RPC's message on failure, or the new state on success. */
async function advance(tok: string, dealId: string, to: string): Promise<string> {
  const r = await fetch(`${URL}/rest/v1/rpc/advance_deal`, {
    method: 'POST',
    headers: hdrs(tok),
    body: JSON.stringify({ p_lock_in_id: dealId, p_to: to }),
  });
  const j = await r.json();
  return j?.message ?? j?.state ?? JSON.stringify(j);
}

/** A fresh listing + deal, so tests never fight over the same row. */
async function freshDeal(price = 2000): Promise<{ dealId: string; listingId: string }> {
  const l = await rest(sellerTok, 'listings', {
    method: 'POST',
    body: JSON.stringify({
      user_id: SELLER.id,
      type: 'sell',
      title: `Test ticket ${Date.now()}-${Math.round(performance.now())}`,
      price_cents: price,
      platform: 'bubbl',
    }),
  });
  const listingId = l.body[0].id;
  madeListings.push(listingId);

  const d = await rest(buyerTok, 'lock_ins', {
    method: 'POST',
    body: JSON.stringify({
      listing_id: listingId,
      buyer_id: BUYER.id,
      seller_id: SELLER.id,
      locked_price_cents: price,
    }),
  });
  return { dealId: d.body[0].id, listingId };
}

const listingStatus = async (id: string) =>
  (await rest(buyerTok, `listings?select=status&id=eq.${id}`)).body[0].status;

const dealsCount = async (id: string) =>
  (await rest(buyerTok, `profiles?select=completed_deals&id=eq.${id}`)).body[0].completed_deals;

beforeAll(async () => {
  if (!URL || !KEY) throw new Error('Missing EXPO_PUBLIC_SUPABASE_* — run via `bun run test`');
  buyerTok = await signIn(BUYER.email);
  sellerTok = await signIn(SELLER.email);
});

afterAll(async () => {
  // Cascades to lock_ins and offers.
  for (const id of madeListings) {
    await rest(sellerTok, `listings?id=eq.${id}`, { method: 'DELETE' });
  }
});

describe('advance_deal — who may do what', () => {
  test('the seller cannot mark a deal paid', async () => {
    const { dealId } = await freshDeal();
    expect(await advance(sellerTok, dealId, 'paid')).toMatch(/only the buyer/i);
  });

  test('the seller cannot confirm a deal', async () => {
    const { dealId } = await freshDeal();
    await advance(buyerTok, dealId, 'paid');
    expect(await advance(sellerTok, dealId, 'confirmed')).toMatch(/only the buyer/i);
  });

  test('the buyer can walk the happy path', async () => {
    const { dealId } = await freshDeal();
    expect(await advance(buyerTok, dealId, 'paid')).toBe('paid');
    expect(await advance(buyerTok, dealId, 'confirmed')).toBe('confirmed');
  });

  test('confirming without paying first is refused', async () => {
    const { dealId } = await freshDeal();
    expect(await advance(buyerTok, dealId, 'confirmed')).toMatch(/mark the deal paid first/i);
  });

  test('a settled deal accepts nothing further', async () => {
    const { dealId } = await freshDeal();
    await advance(buyerTok, dealId, 'paid');
    await advance(buyerTok, dealId, 'confirmed');
    expect(await advance(buyerTok, dealId, 'cancelled')).toMatch(/already confirmed/i);
  });

  test('an unknown target state is rejected', async () => {
    const { dealId } = await freshDeal();
    expect(await advance(buyerTok, dealId, 'code_released')).toMatch(/unknown target state/i);
  });
});

describe('advance_deal — idempotency and races', () => {
  test('marking paid twice succeeds silently', async () => {
    // A double-tapped button must not read as broken.
    const { dealId } = await freshDeal();
    expect(await advance(buyerTok, dealId, 'paid')).toBe('paid');
    expect(await advance(buyerTok, dealId, 'paid')).toBe('paid');
  });

  test('concurrent confirm and cancel resolve to one winner', async () => {
    const { dealId } = await freshDeal();
    await advance(buyerTok, dealId, 'paid');
    const [a, b] = await Promise.all([
      advance(buyerTok, dealId, 'confirmed'),
      advance(sellerTok, dealId, 'cancelled'),
    ]);
    // FOR UPDATE serialises them: exactly one lands, the other is told why not.
    const settled = [a, b].filter((r) => r === 'confirmed' || r === 'cancelled');
    expect(settled.length).toBe(1);
  });
});

describe('advance_deal — settlement side effects', () => {
  test('confirming credits both parties and marks the listing sold', async () => {
    const { dealId, listingId } = await freshDeal();
    const beforeBuyer = await dealsCount(BUYER.id);
    const beforeSeller = await dealsCount(SELLER.id);

    await advance(buyerTok, dealId, 'paid');
    await advance(buyerTok, dealId, 'confirmed');

    expect(await dealsCount(BUYER.id)).toBe(beforeBuyer + 1);
    expect(await dealsCount(SELLER.id)).toBe(beforeSeller + 1);
    expect(await listingStatus(listingId)).toBe('sold');
  });

  test('cancelling puts the listing back on the market', async () => {
    const { dealId, listingId } = await freshDeal();
    expect(await listingStatus(listingId)).toBe('locked');
    expect(await advance(sellerTok, dealId, 'cancelled')).toBe('cancelled');
    expect(await listingStatus(listingId)).toBe('active');
  });

  test('cancelling records who did it and from which state', async () => {
    // A cancel out of `paid` is the shape a scam takes; out of
    // `pending_payment` it is usually a flake. Moderation needs to tell them
    // apart after the fact.
    const { dealId } = await freshDeal();
    await advance(buyerTok, dealId, 'paid');
    await advance(sellerTok, dealId, 'cancelled');
    const d = (await rest(sellerTok, `lock_ins?select=cancelled_by,cancelled_from&id=eq.${dealId}`))
      .body[0];
    expect(d.cancelled_from).toBe('paid');
    expect(d.cancelled_by).toBe(SELLER.id);
  });

  test('cancelling does NOT award reputation', async () => {
    const { dealId } = await freshDeal();
    const before = await dealsCount(SELLER.id);
    await advance(buyerTok, dealId, 'paid');
    await advance(buyerTok, dealId, 'cancelled');
    expect(await dealsCount(SELLER.id)).toBe(before);
  });
});
