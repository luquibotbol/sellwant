/** Read-only market input shared by future watcher/MCP consumers.
 * Pagination is resumable, not a transaction snapshot or permission to trade.
 * Every write must recheck the listing and mandate inside its transaction. */
export interface MarketListing {
  id: string;
  url: string;
  title: string;
  type: 'sell' | 'want';
  price_cents: number;
  currency: 'USD';
  going_rate_cents: number | null;
  going_rate_status: 'available' | 'no_offers';
  offers: number;
  event_date: string | null;
  location: string | null;
}

export interface MarketScan {
  listings: MarketListing[];
  pages: number;
  complete: boolean;
  next_cursor: string | null;
}

type Transport = (url: string, init: RequestInit) => Promise<Response>;
export interface MarketScanOptions {
  /** Trusted configured app origin, never an LLM-provided URL. */
  origin: string;
  cursor?: string | null;
  pageSize?: number;
  /** A bounded batch can resume next run; it must not claim the market is empty. */
  maxPages?: number;
  fetch?: Transport;
}

export class MarketReadError extends Error {
  constructor(
    readonly code: 'invalid_options' | 'unavailable' | 'invalid_response',
    /** Restart the whole batch here: rows preceding the failed page were not returned. */
    readonly retry_cursor: string | null,
  ) {
    super(`Market read failed: ${code}`);
    this.name = 'MarketReadError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;
const PATH = '/api/listings.json';
type RecordValue = Record<string, unknown>;

function object(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function sourceOrigin(input: string): string {
  try {
    const url = new URL(input);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new MarketReadError('invalid_options', null);
  }
}

function listing(value: unknown, origin: string, cursor: string | null): MarketListing {
  const invalid = () => new MarketReadError('invalid_response', cursor);
  if (!object(value) || typeof value.id !== 'string' || !UUID.test(value.id) ||
      typeof value.title !== 'string' ||
      (value.type !== 'sell' && value.type !== 'want') ||
      !positiveCents(value.price_cents) || value.currency !== 'USD' ||
      typeof value.offers !== 'number' || !Number.isSafeInteger(value.offers) || value.offers < 0 ||
      !(value.event_date === null || typeof value.event_date === 'string') ||
      !(value.location === null || typeof value.location === 'string')) throw invalid();

  if (value.offers === 0) {
    if (value.going_rate_cents !== null || value.going_rate_status !== 'no_offers') throw invalid();
  } else if (!positiveCents(value.going_rate_cents) || value.going_rate_status !== 'available') {
    throw invalid();
  }

  // Deliberately pick public fields; never forward arbitrary response objects
  // into prompts. User-authored titles/locations remain untrusted data.
  const id = value.id.toLowerCase();
  return {
    id, url: `${origin}/event/${id}`, title: value.title, type: value.type,
    price_cents: value.price_cents, currency: 'USD',
    going_rate_cents: value.going_rate_cents as number | null,
    going_rate_status: value.going_rate_status as MarketListing['going_rate_status'],
    offers: value.offers, event_date: value.event_date, location: value.location,
  };
}

/** Follow the public API's keyset cursor without trusting a supplied next URL.
 * A page budget returns an explicit continuation. Upstream failures, malformed
 * money, duplicate rows and cursor cycles fail closed rather than look empty. */
export async function scanActiveMarket(options: MarketScanOptions): Promise<MarketScan> {
  const origin = sourceOrigin(options.origin);
  const pageSize = options.pageSize ?? 200;
  const maxPages = options.maxPages ?? 5;
  let cursor = options.cursor ?? null;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200 ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20 ||
      !(cursor === null || (typeof cursor === 'string' && CURSOR.test(cursor)))) {
    throw new MarketReadError('invalid_options', null);
  }
  const retryCursor = cursor;
  const failure = (code: MarketReadError['code']) => new MarketReadError(code, retryCursor);

  const transport = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const cursors = new Set<string>();
  const ids = new Set<string>();
  if (cursor !== null) cursors.add(cursor);
  const listings: MarketListing[] = [];

  for (let pages = 1; pages <= maxPages; pages++) {
    const url = new URL(PATH, origin);
    url.searchParams.set('limit', String(pageSize));
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    let body: unknown;
    try {
      const response = await transport(url.toString(), {
        method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 200) throw failure('unavailable');
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        throw failure('invalid_response');
      }
      try { body = await response.json(); }
      catch { throw failure('invalid_response'); }
    } catch (error) {
      if (error instanceof MarketReadError) throw error;
      throw failure('unavailable');
    }

    if (!object(body) || !Array.isArray(body.listings) || body.count !== body.listings.length ||
        body.listings.length > pageSize || typeof body.has_more !== 'boolean') {
      throw failure('invalid_response');
    }
    for (const value of body.listings) {
      const row = listing(value, origin, retryCursor);
      if (ids.has(row.id)) throw failure('invalid_response');
      ids.add(row.id);
      listings.push(row);
    }
    if (!body.has_more) {
      if (body.next_cursor !== null || body.next_url !== null) throw failure('invalid_response');
      return { listings, pages, complete: true, next_cursor: null };
    }
    if (body.listings.length === 0 || typeof body.next_cursor !== 'string' ||
        !CURSOR.test(body.next_cursor) || cursors.has(body.next_cursor) || typeof body.next_url !== 'string') {
      throw failure('invalid_response');
    }
    try {
      const next = new URL(body.next_url);
      if (next.origin !== origin || next.pathname !== PATH || next.username || next.password || next.hash ||
          next.searchParams.get('cursor') !== body.next_cursor ||
          next.searchParams.get('limit') !== String(pageSize) ||
          [...next.searchParams.keys()].sort().join(',') !== 'cursor,limit') throw new Error();
    } catch { throw failure('invalid_response'); }
    cursor = body.next_cursor;
    cursors.add(cursor);
    if (pages === maxPages) return { listings, pages, complete: false, next_cursor: cursor };
  }
  // maxPages is validated above, so the loop always returns or throws.
  throw new MarketReadError('invalid_options', null);
}
