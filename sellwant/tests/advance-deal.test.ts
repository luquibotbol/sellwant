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

/**
 * Ids are resolved at sign-in, not hardcoded.
 *
 * They used to be literals, and when the deshawn fixture was deleted and
 * recreated the whole suite failed on a stale uuid rather than on anything
 * real. The JWT already carries the id of whoever just signed in, so ask it.
 */
const BUYER = { email: 'maya@example.edu', id: '' };
const SELLER = { email: 'deshawn@example.edu', id: '' };

/** The `sub` claim, which is the user's id. */
function idFromToken(tok: string): string {
  const [, payload] = tok.split('.');
  const json = JSON.parse(
    Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
  );
  return json.sub as string;
}
/**
 * From the environment, never the source. This repo is public, and once the
 * web build ships, the Supabase URL and anon key are readable in the bundle --
 * a password committed alongside them would be a working login for anyone.
 * Deliberately not EXPO_PUBLIC_, so it can never be inlined into the client.
 */
const PASSWORD = process.env.SELLWANT_TEST_PASSWORD!;

let buyerTok = '';
let sellerTok = '';
const madeListings: string[] = [];
/**
 * Reputation is a trigger side effect, and deleting the listing afterwards
 * does NOT decrement it -- so without restoring these, every test run
 * permanently inflates both profiles in the shared dev database.
 */
let baseline: Record<string, number> = {};

async function signIn(email: string): Promise<string> {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await r.json();
  if (!j.access_token) {
    throw new Error(
      `sign-in failed for ${email}: ${JSON.stringify(j)}\n` +
        'If the account is missing, recreate it in Supabase > Authentication > ' +
        'Users with "Auto Confirm" and the SELLWANT_TEST_PASSWORD from .env.'
    );
  }
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
  // Without this the sign-ins below fail as "Invalid login credentials", which
  // reads like a broken test rather than a missing variable.
  if (!PASSWORD) {
    throw new Error('Missing SELLWANT_TEST_PASSWORD — see .env.example');
  }
  buyerTok = await signIn(BUYER.email);
  sellerTok = await signIn(SELLER.email);
  BUYER.id = idFromToken(buyerTok);
  SELLER.id = idFromToken(sellerTok);
  baseline = {
    [BUYER.id]: await dealsCount(BUYER.id),
    [SELLER.id]: await dealsCount(SELLER.id),
  };
});

afterAll(async () => {
  // Every listing here has a lock_in by now, and owners may not delete those
  // -- that is the point of the policy. A plain DELETE is filtered by RLS
  // rather than rejected, so it reports success, removes nothing, and leaves
  // the rows active and public: that is how 18 test listings ended up in the
  // live feed. purge_test_listing is the fixture-only path that can.
  let leaked = 0;
  for (const id of madeListings) {
    const r = await fetch(`${URL}/rest/v1/rpc/purge_test_listing`, {
      method: 'POST',
      headers: hdrs(sellerTok),
      body: JSON.stringify({ p_id: id }),
    });
    if (r.ok) continue;

    // The function only exists once the migration has been applied by hand,
    // and until then this must not be worse than what it replaced: a plain
    // DELETE still removes every listing without a lock_in, which is all of
    // the offer-stats fixtures. Dropping straight to `leaked` here would leak
    // those too, for no reason.
    const fallback = await rest(sellerTok, `listings?id=eq.${id}`, { method: 'DELETE' });
    // RLS filters rather than rejecting, so a blocked delete looks like a
    // successful one -- an empty representation is how it admits to that.
    if (!Array.isArray(fallback.body) || fallback.body.length === 0) leaked += 1;
  }
  if (leaked) {
    // Loud on purpose. Silent cleanup failure is what caused this.
    console.error(
      `\n!! ${leaked}/${madeListings.length} test listings could not be removed ` +
        `and are live on the public feed.\n` +
        `   Apply supabase/migrations/20260819_test_fixture_cleanup.sql.\n`
    );
  }
  // completed_deals is not client-writable by design, so the restore goes
  // through the same admin path the trigger uses. Without it the counters
  // ratchet up forever and the number stops meaning anything.
  await fetch(`${URL}/rest/v1/rpc/reset_completed_deals`, {
    method: 'POST',
    headers: hdrs(buyerTok),
    body: JSON.stringify({ p_counts: baseline }),
  });
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

/**
 * "Top offer" is the number that tells a stranger what a ticket actually goes
 * for. It only means that if it counts offers from the *other* side.
 *
 * The bug this locks down: refresh_offer_stats took max()/min() across every
 * open offer with no filter on who posted it, so a seller countering their own
 * listing was scored as a buyer bidding that much. The headline number then
 * advertised demand that did not exist.
 */
describe('offer stats — only the other side counts', () => {
  /** A listing with no lock-in, so it stays `active` and accepts offers. */
  async function freshListing(type: 'sell' | 'ask', price: number): Promise<string> {
    const l = await rest(sellerTok, 'listings', {
      method: 'POST',
      body: JSON.stringify({
        user_id: SELLER.id,
        type,
        title: `Offer stats ${Date.now()}-${Math.round(performance.now())}`,
        price_cents: price,
        platform: 'bubbl',
      }),
    });
    const id = l.body[0].id;
    madeListings.push(id);
    return id;
  }

  const offer = (tok: string, listingId: string, who: string, cents: number) =>
    rest(tok, 'offers', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId, from_user: who, amount_cents: cents }),
    });

  const stats = async (id: string) =>
    (await rest(buyerTok, `listings?select=best_offer_cents,offer_count&id=eq.${id}`)).body[0];

  test("a seller's own counter is not counted as a bid", async () => {
    const id = await freshListing('sell', 3500);
    await offer(buyerTok, id, BUYER.id, 3000);
    expect(await stats(id)).toMatchObject({ best_offer_cents: 3000, offer_count: 1 });

    // The seller counters higher than the buyer. Naive max() would report
    // 3200 as the "top offer" -- the seller's own asking price.
    await offer(sellerTok, id, SELLER.id, 3200);
    expect(await stats(id)).toMatchObject({ best_offer_cents: 3000, offer_count: 1 });
  });

  test("a buyer's own counter is not counted on an ask listing", async () => {
    // Mirror image: on an ask the stat is a min(), so the poster undercutting
    // themselves would drag the advertised price down.
    const id = await freshListing('ask', 2000);
    await offer(buyerTok, id, BUYER.id, 2600);
    expect(await stats(id)).toMatchObject({ best_offer_cents: 2600, offer_count: 1 });

    await offer(sellerTok, id, SELLER.id, 2100);
    expect(await stats(id)).toMatchObject({ best_offer_cents: 2600, offer_count: 1 });
  });

  test('the counter is still stored and visible, just not scored', async () => {
    const id = await freshListing('sell', 3500);
    await offer(buyerTok, id, BUYER.id, 3000);
    await offer(sellerTok, id, SELLER.id, 3200);
    const rows = (await rest(buyerTok, `offers?select=amount_cents,from_user&listing_id=eq.${id}&status=eq.open`)).body;
    // Both rows exist -- the board shows the negotiation, the stat shows demand.
    expect(rows.length).toBe(2);
    expect(rows.some((r: { from_user: string }) => r.from_user === SELLER.id)).toBe(true);
  });
});

/**
 * The admin boundary.
 *
 * These functions are SECURITY DEFINER -- they read across every table,
 * bypassing the RLS that protects one user's data from another. The only thing
 * standing between that and any signed-in person is a membership check on the
 * first line of each. Asserting it in JS would prove nothing; these call the
 * real RPCs as a real, non-admin user.
 *
 * Maya is deliberately not an admin.
 */
describe('admin functions — only admins', () => {
  const rpc = async (tok: string | null, fn: string, body: Record<string, unknown> = {}) => {
    const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: tok
        ? hdrs(tok)
        : { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };

  test('a signed-in non-admin gets nothing from admin_stats', async () => {
    const res = await rpc(buyerTok, 'admin_stats');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toMatch(/not authorised/i);
  });

  test('a signed-in non-admin cannot read the report queue', async () => {
    const res = await rpc(buyerTok, 'admin_reports');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toMatch(/not authorised/i);
  });

  test('a signed-in non-admin cannot suspend anyone', async () => {
    const res = await rpc(buyerTok, 'admin_set_suspended', {
      p_user: SELLER.id,
      p_suspended: true,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    // And it must not have happened.
    const p = (await rest(buyerTok, `profiles?select=is_suspended&id=eq.${SELLER.id}`)).body[0];
    expect(p.is_suspended).toBe(false);
  });

  test('a signed-in non-admin cannot close a report', async () => {
    const res = await rpc(buyerTok, 'admin_review_report', {
      p_id: '00000000-0000-4000-8000-000000000000',
      p_outcome: 'nope',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('anonymous gets nothing either', async () => {
    const res = await rpc(null, 'admin_stats');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('the admin roster is not readable by a non-admin', async () => {
    // Empty rather than an error: the policy hides the rows, and revealing
    // who the admins are is itself information.
    const res = await rest(buyerTok, 'admins?select=id');
    expect(res.body).toEqual([]);
  });
});
