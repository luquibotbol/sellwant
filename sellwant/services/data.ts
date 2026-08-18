/**
 * The single data seam. Every screen calls this module.
 *
 * No screen should ever import `supabase` directly -- keeping the client behind
 * this boundary is what lets the registry and handoff logic change without
 * touching UI code.
 */
import { supabase } from '@/services/supabase';

/**
 * An expired or revoked token should log you out, not render "something went
 * wrong". Clearing the session makes onAuthChange fire, and the screens'
 * existing redirects take it from there.
 */
async function fail(error: unknown): Promise<never> {
  const e = error as { code?: string; status?: number; message?: string };
  const isAuth =
    e?.code === 'PGRST301' ||
    e?.status === 401 ||
    /jwt|token is expired|invalid claim/i.test(e?.message ?? '');
  if (isAuth) await supabase.auth.signOut().catch(() => {});
  throw error;
}

// ---------------------------------------------------------------- types

export type ListingType = 'ask' | 'sell';
export type ListingStatus = 'active' | 'locked' | 'sold' | 'cancelled';
export type LockInState =
  | 'pending_payment'
  | 'paid'
  | 'code_released'
  | 'confirmed'
  | 'cancelled';

/** A P2P payment destination. We store handles and build deep links; money
 *  never moves through SellWant. */
export interface PaymentHandle {
  kind: 'venmo' | 'cashapp' | 'zelle' | 'paypal' | 'other';
  value: string;
  label?: string;
}

/**
 * Public identity. Everything here is readable by any signed-in user, so
 * nothing private may be added to this type -- see ContactDetails.
 */
export interface Profile {
  id: string;
  full_name: string;
  profile_picture: string | null;
  /** Public on purpose: it can only build trust if buyers can check it
   *  before committing to a deal. */
  instagram: string | null;
  /** Observed behaviour, not a rating. Written by trigger, never by a client. */
  completed_deals: number;
  is_suspended: boolean;
  onboarded_at: string | null;
  created_at: string;
}

/**
 * Private. Readable only by the owner and by someone who has a lock-in with
 * them -- enforced by RLS on contact_details, not by this client.
 */
export interface ContactDetails {
  profile_id: string;
  phone: string | null;
  email: string | null;
  accepted_payments: PaymentHandle[];
}

export interface Listing {
  id: string;
  user_id: string;
  category_id: number | null;
  type: ListingType;
  title: string;
  description: string | null;
  price_cents: number;
  image_urls: string[];
  tags: string[];
  location: string | null;
  event_date: string | null;
  platform: 'bubbl' | null;
  status: ListingStatus;
  /**
   * The going rate, maintained by trigger.
   * On a sell listing this is the HIGHEST anyone will pay; on an ask it is the
   * LOWEST anyone will take. Null when nobody has offered.
   */
  best_offer_cents: number | null;
  offer_count: number;
  created_at: string;
}

export type OfferStatus = 'open' | 'withdrawn' | 'accepted' | 'declined';

export interface Offer {
  id: string;
  listing_id: string;
  from_user: string;
  amount_cents: number;
  message: string | null;
  status: OfferStatus;
  parent_offer_id: string | null;
  created_at: string;
  from: Pick<Profile, 'id' | 'full_name' | 'profile_picture' | 'instagram' | 'completed_deals'> | null;
}

export interface LockIn {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  locked_price_cents: number;
  state: LockInState;
  locked_at: string;
}

/** A listing joined with the profile of whoever posted it. */
export type ListingWithPoster = Listing & { poster: Pick<Profile,
  'id' | 'full_name' | 'profile_picture' | 'instagram' | 'completed_deals'> | null };

// ---------------------------------------------------------------- auth

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) await fail(error);
  return data.session;
}

export function onAuthChange(cb: (signedIn: boolean) => void) {
  const { data } = supabase.auth.onAuthStateChange((_e, session) =>
    cb(!!session)
  );
  return () => data.subscription.unsubscribe();
}

/**
 * Why these don't go through `fail()`.
 *
 * `fail()` exists for a session that died mid-use -- it signs you out so the
 * screens redirect. A wrong password is the opposite situation: there is no
 * session to lose, and signing out would be noise. These throw an AuthProblem
 * instead, carrying a `kind` the sign-in screen can branch on.
 */
export type AuthFailure =
  | 'credentials'
  | 'unconfirmed'
  | 'exists'
  | 'weak'
  | 'rate'
  | 'other';

export class AuthProblem extends Error {
  constructor(message: string, readonly kind: AuthFailure) {
    super(message);
    this.name = 'AuthProblem';
  }
}

/** Supabase's auth errors are written for developers. These are the ones a
 *  normal person can actually trigger, rewritten as something actionable. */
function authProblem(error: unknown): AuthProblem {
  const m = (error as { message?: string })?.message ?? '';
  if (/invalid login credentials/i.test(m))
    return new AuthProblem('That email and password don’t match.', 'credentials');
  if (/not confirmed/i.test(m))
    return new AuthProblem('Confirm your email first — check your inbox.', 'unconfirmed');
  if (/already registered|already exists/i.test(m))
    return new AuthProblem('That email already has an account. Sign in instead.', 'exists');
  if (/password should be at least|weak password/i.test(m))
    return new AuthProblem('Use at least 8 characters.', 'weak');
  if (/rate limit|too many requests|after \d+ seconds/i.test(m))
    return new AuthProblem('Too many tries. Wait a minute and try again.', 'rate');
  return new AuthProblem(m || 'Something went wrong. Try again.', 'other');
}

/**
 * Creates the account and mails the confirmation link.
 *
 * With "Confirm email" enabled, Supabase returns no session here -- the person
 * is not signed in until they click the link. `needsVerification` reports that
 * honestly rather than pretending they're in.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  redirectTo?: string
): Promise<{ needsVerification: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
  });
  if (error) throw authProblem(error);
  return { needsVerification: !data.session };
}

/**
 * Google sign-in.
 *
 * Worth having beyond convenience: a Google account is already verified, so
 * this path sends no confirmation email at all. That removes the slowest step
 * in signing up and takes load off an SMTP service that is still in beta and
 * metered.
 *
 * Redirects away from the page, so nothing after this call runs. The provider
 * returns to `redirectTo`, which must be in Supabase's allow-list.
 */
export async function signInWithGoogle(redirectTo?: string) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      ...(redirectTo ? { redirectTo } : {}),
      // Ask for the profile photo as well as the name, so onboarding has
      // something to prefill rather than an empty form.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw authProblem(error);
}

/** The everyday path: no email round-trip, just credentials. */
export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw authProblem(error);
}

/** Re-sends the confirmation email, for links that expired or never arrived. */
export async function resendVerification(email: string, redirectTo?: string) {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
  });
  if (error) throw authProblem(error);
}

/**
 * Starts password recovery.
 *
 * Supabase resolves this even for an address with no account, and we surface
 * it the same way either — telling a stranger whether an email is registered
 * here would leak who has an account.
 */
export async function sendPasswordReset(email: string, redirectTo?: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    redirectTo ? { redirectTo } : undefined
  );
  if (error) throw authProblem(error);
}

/** Sets a new password for the recovery session the reset link created. */
export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw authProblem(error);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) await fail(error);
}

// ---------------------------------------------------------------- profiles

export async function getMyProfile(): Promise<Profile | null> {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) await fail(error);
  return data as Profile | null;
}

export async function getProfile(id: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) await fail(error);
  return data as Profile | null;
}

/** Public fields only. `completed_deals` and `is_suspended` are not
 *  client-writable, so reputation cannot be self-served. */
export async function updateMyProfile(patch: {
  full_name?: string;
  profile_picture?: string | null;
  instagram?: string | null;
}) {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', session.user.id);
  if (error) await fail(error);
}

// ------------------------------------------------- contact (private)

export async function getMyContact(): Promise<ContactDetails | null> {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('contact_details')
    .select('*')
    .eq('profile_id', session.user.id)
    .maybeSingle();
  if (error) await fail(error);
  return data as ContactDetails | null;
}

export async function updateMyContact(patch: {
  phone?: string | null;
  accepted_payments?: PaymentHandle[];
}) {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  const { error } = await supabase
    .from('contact_details')
    .upsert({ profile_id: session.user.id, ...patch, updated_at: new Date().toISOString() });
  if (error) await fail(error);
}

/**
 * The other party's phone and payment handles.
 *
 * Returns null unless a lock-in exists between the two of you -- that rule
 * lives in the RLS policy, so this cannot be bypassed by calling it directly.
 */
export async function getCounterpartyContact(
  profileId: string
): Promise<ContactDetails | null> {
  const { data, error } = await supabase
    .from('contact_details')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) await fail(error);
  return data as ContactDetails | null;
}

/** Full name and phone are required; Instagram is optional but pushed hard. */
export async function completeOnboarding(input: {
  full_name: string;
  phone: string;
  instagram?: string | null;
  profile_picture?: string | null;
}) {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');

  const { error: pErr } = await supabase
    .from('profiles')
    .update({
      full_name: input.full_name.trim(),
      instagram: input.instagram?.trim() || null,
      profile_picture: input.profile_picture ?? null,
      onboarded_at: new Date().toISOString(),
    })
    .eq('id', session.user.id);
  if (pErr) throw pErr;

  await updateMyContact({ phone: input.phone.trim() });
}

// ---------------------------------------------------------------- listings

const LISTING_SELECT =
  '*, poster:profiles!listings_user_id_fkey(id, full_name, profile_picture, instagram, completed_deals)';

export interface Category {
  id: number;
  name: string;
  image_url: string | null;
}

/**
 * Places students have already used, most common first.
 *
 * Deliberately sourced from our own listings rather than a maps API: the venues
 * that matter here are "Sig Ep house" and "the annex", which no geocoder knows,
 * and this costs nothing and needs no API key. A Places provider can be layered
 * on top later for real addresses.
 */
export async function listLocationSuggestions(): Promise<string[]> {
  const { data, error } = await supabase
    .from('listings')
    .select('location')
    .not('location', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) await fail(error);

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { location: string | null }[]) {
    const name = row.location?.trim();
    if (!name) continue;
    // Case-insensitive grouping, but keep the first spelling seen.
    const key = name.toLowerCase();
    const existing = [...counts.keys()].find((k) => k.toLowerCase() === key);
    const label = existing ?? name;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/**
 * Categories are a fixed list that changes about never, but the feed refetched
 * them on every visit -- a round trip a student pays for on 4G each time they
 * open the app. Memoised for the session; a reload picks up any change.
 */
let categoryCache: Category[] | null = null;

export async function listCategories(): Promise<Category[]> {
  if (categoryCache) return categoryCache;
  const { data, error } = await supabase.from('categories').select('*').order('id');
  if (error) await fail(error);
  categoryCache = (data ?? []) as Category[];
  return categoryCache;
}

/** PostgREST `or` needs commas and parens escaped or they break the filter. */
function escapeForOr(term: string) {
  return term.replace(/[,()]/g, ' ').trim();
}

/**
 * The feed, and search. Soonest first.
 *
 * Search runs in Postgres against a trigram index rather than filtering an
 * already-fetched page, so it keeps working once there are more listings than
 * fit in one request.
 */
export async function listActive(
  opts: { type?: ListingType; q?: string; categoryId?: number } = {}
): Promise<ListingWithPoster[]> {
  let query = supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('status', 'active')
    .order('event_date', { ascending: true, nullsFirst: false });

  if (opts.type) query = query.eq('type', opts.type);
  if (opts.categoryId) query = query.eq('category_id', opts.categoryId);

  const term = escapeForOr(opts.q ?? '');
  if (term) {
    query = query.or(
      `title.ilike.%${term}%,location.ilike.%${term}%,description.ilike.%${term}%`
    );
  }

  const { data, error } = await query;
  if (error) await fail(error);
  return (data ?? []) as ListingWithPoster[];
}

export async function getListing(id: string): Promise<ListingWithPoster | null> {
  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) await fail(error);
  return data as ListingWithPoster | null;
}

/** Everything you've posted, any status, newest first. */
export async function myListings(): Promise<ListingWithPoster[]> {
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false });
  if (error) await fail(error);
  return (data ?? []) as ListingWithPoster[];
}

/** Someone else's public identity. Contact details are never included. */
export async function getPublicProfile(id: string): Promise<Profile | null> {
  return getProfile(id);
}

/** A person's active listings, for their public profile. */
export async function listingsBy(userId: string): Promise<ListingWithPoster[]> {
  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('event_date', { ascending: true, nullsFirst: false });
  if (error) await fail(error);
  return (data ?? []) as ListingWithPoster[];
}

export async function createListing(input: {
  type: ListingType;
  title: string;
  price_cents: number;
  description?: string;
  location?: string;
  event_date?: string;
  category_id?: number;
  image_urls?: string[];
  tags?: string[];
}): Promise<Listing> {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('listings')
    .insert({
      ...input,
      user_id: session.user.id,
      platform: input.type === 'sell' ? 'bubbl' : null,
    })
    .select()
    .single();
  if (error) await fail(error);
  return data as Listing;
}

export type RegistryResult =
  | { ok: true }
  | { ok: false; sameSeller: boolean };

/**
 * Submit a ticket code hash to the registry.
 *
 * Goes through a security-definer function because `ticket_codes` has no RLS
 * policies at all -- clients can neither read nor write it directly, so a
 * leaked key cannot enumerate the registry. The unique index, not this call,
 * is what actually guarantees uniqueness; collisions are recorded server-side.
 */
export async function registerTicketCode(
  listingId: string,
  codeHash: string
): Promise<RegistryResult> {
  const { data, error } = await supabase.rpc('register_ticket_code', {
    p_listing_id: listingId,
    p_code_hash: codeHash,
  });
  if (error) await fail(error);
  const result = data as { ok: boolean; same_seller?: boolean };
  return result.ok ? { ok: true } : { ok: false, sameSeller: !!result.same_seller };
}

export async function cancelListing(id: string) {
  const { error } = await supabase
    .from('listings')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) await fail(error);
}

// ---------------------------------------------------------------- lock-ins

/**
 * Commit to a listing. Who calls this depends on the listing type:
 *   sell -> the buyer locks in on someone's ticket
 *   ask  -> a seller responds to someone's want-ad
 * The database policy pins both roles against the listing, so the caller
 * cannot forge the counterparty.
 */
export async function createLockIn(listing: Listing): Promise<LockIn> {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  const me = session.user.id;
  const { data, error } = await supabase
    .from('lock_ins')
    .insert({
      listing_id: listing.id,
      buyer_id: listing.type === 'sell' ? me : listing.user_id,
      seller_id: listing.type === 'sell' ? listing.user_id : me,
      locked_price_cents: listing.price_cents,
    })
    .select()
    .single();
  if (error) await fail(error);
  return data as LockIn;
}

export async function getLockIn(id: string): Promise<LockIn | null> {
  const { data, error } = await supabase
    .from('lock_ins')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) await fail(error);
  return data as LockIn | null;
}

// ---------------------------------------------------------------- offers

const OFFER_SELECT =
  '*, from:profiles!offers_from_user_fkey(id, full_name, profile_picture, instagram, completed_deals)';

/**
 * Every offer on a listing, best first.
 *
 * Sorted by which side of the market it is: on a sell listing the buyer paying
 * most is at the top, on an ask the seller charging least is.
 */
export async function listOffers(
  listingId: string,
  type: ListingType
): Promise<Offer[]> {
  const { data, error } = await supabase
    .from('offers')
    .select(OFFER_SELECT)
    .eq('listing_id', listingId)
    .eq('status', 'open')
    .order('amount_cents', { ascending: type === 'ask' });
  if (error) await fail(error);
  return (data ?? []) as Offer[];
}

export async function makeOffer(input: {
  listingId: string;
  amountCents: number;
  message?: string;
  /** Set when answering someone else's offer, so it reads as a counter. */
  parentOfferId?: string;
}): Promise<Offer> {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('offers')
    .insert({
      listing_id: input.listingId,
      from_user: session.user.id,
      amount_cents: input.amountCents,
      message: input.message?.trim() || null,
      parent_offer_id: input.parentOfferId ?? null,
    })
    .select(OFFER_SELECT)
    .single();
  if (error) await fail(error);
  return data as Offer;
}

const openFirst = (rows: OfferWithListing[]) =>
  [...rows].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));

/** An offer carrying the listing it belongs to, for the offers inbox. */
export type OfferWithListing = Offer & {
  listing: Pick<Listing, 'id' | 'title' | 'type' | 'price_cents' | 'status' | 'event_date' | 'location' | 'user_id'> | null;
};

const OFFER_WITH_LISTING =
  '*, from:profiles!offers_from_user_fkey(id, full_name, profile_picture, instagram, completed_deals),' +
  ' listing:listings(id, title, type, price_cents, status, event_date, location, user_id)';

/**
 * Offers you have made.
 *
 * Withdrawn offers are hidden: superseding your own bid marks the old row
 * withdrawn, so showing them would bury the live offer under your own history.
 * Open ones float to the top -- they are the only actionable rows.
 */
export async function myOffers(): Promise<OfferWithListing[]> {
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await supabase
    .from('offers')
    .select(OFFER_WITH_LISTING)
    .eq('from_user', session.user.id)
    .neq('status', 'withdrawn')
    .order('created_at', { ascending: false });
  if (error) await fail(error);
  return openFirst((data ?? []) as unknown as OfferWithListing[]);
}

/**
 * Offers other people have made on your listings.
 * `!inner` makes the embedded listing a join rather than a left join, so the
 * user_id filter actually restricts rows.
 */
export async function offersOnMyListings(): Promise<OfferWithListing[]> {
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await supabase
    .from('offers')
    .select(OFFER_WITH_LISTING.replace('listing:listings(', 'listing:listings!inner('))
    .eq('listing.user_id', session.user.id)
    .neq('from_user', session.user.id)
    .neq('status', 'withdrawn')
    .order('created_at', { ascending: false });
  if (error) await fail(error);
  return openFirst((data ?? []) as unknown as OfferWithListing[]);
}

export async function declineOffer(id: string) {
  const { error } = await supabase.from('offers').update({ status: 'declined' }).eq('id', id);
  if (error) await fail(error);
}

export async function withdrawOffer(id: string) {
  const { error } = await supabase
    .from('offers')
    .update({ status: 'withdrawn' })
    .eq('id', id);
  if (error) await fail(error);
}

/**
 * Settle at the offered price. Creates the lock-in, declines the rest and
 * takes the listing off the market in one transaction, so two offers can never
 * both be accepted. Returns the lock-in id.
 */
export async function acceptOffer(offerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_offer', { p_offer_id: offerId });
  if (error) await fail(error);
  return data as string;
}

// ---------------------------------------------------------------- deals

/** A deal with everything the handoff screen needs, in one round trip. */
export type DealWithContext = LockIn & {
  listing: Pick<
    Listing,
    'id' | 'title' | 'type' | 'price_cents' | 'event_date' | 'location' | 'platform' | 'status'
  > | null;
  buyer: Pick<Profile, 'id' | 'full_name' | 'profile_picture' | 'instagram' | 'completed_deals'> | null;
  seller: Pick<Profile, 'id' | 'full_name' | 'profile_picture' | 'instagram' | 'completed_deals'> | null;
};

const DEAL_SELECT =
  '*, listing:listings(id, title, type, price_cents, event_date, location, platform, status),' +
  ' buyer:profiles!lock_ins_buyer_id_fkey(id, full_name, profile_picture, instagram, completed_deals),' +
  ' seller:profiles!lock_ins_seller_id_fkey(id, full_name, profile_picture, instagram, completed_deals)';

/** RLS restricts this to the two parties, so a stranger gets null, not a 403. */
export async function getDeal(id: string): Promise<DealWithContext | null> {
  const { data, error } = await supabase
    .from('lock_ins')
    .select(DEAL_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) await fail(error);
  return data as unknown as DealWithContext | null;
}

export async function myDeals(): Promise<DealWithContext[]> {
  const { data, error } = await supabase
    .from('lock_ins')
    .select(DEAL_SELECT)
    .order('locked_at', { ascending: false });
  if (error) await fail(error);
  return (data ?? []) as unknown as DealWithContext[];
}

/** The deal for a listing, if one exists and you're party to it. */
export async function getDealForListing(listingId: string): Promise<DealWithContext | null> {
  const { data, error } = await supabase
    .from('lock_ins')
    .select(DEAL_SELECT)
    .eq('listing_id', listingId)
    .neq('state', 'cancelled')
    .maybeSingle();
  if (error) await fail(error);
  return data as unknown as DealWithContext | null;
}

/**
 * The only way a deal moves. Role and sequence are enforced by the RPC, not
 * here -- this just surfaces whatever the database decides.
 *
 * Idempotent server-side: re-sending the current state succeeds silently.
 */
export async function advanceDeal(
  id: string,
  to: Exclude<LockInState, 'code_released'>
): Promise<LockIn> {
  const { data, error } = await supabase.rpc('advance_deal', {
    p_lock_in_id: id,
    p_to: to,
  });
  if (error) await fail(error);
  return data as LockIn;
}

// ---------------------------------------------------------------- reports

/**
 * File a private report about someone.
 *
 * Free-text on purpose. Offering a list of accusation categories would make
 * SellWant a co-author of the accusation rather than a conduit for it, which is
 * the distinction Section 230 turns on. Reports are never shown publicly and
 * never shown to their subject.
 */
export async function fileReport(input: {
  subjectId: string;
  body: string;
  listingId?: string;
  lockInId?: string;
}): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  if (input.subjectId === session.user.id) throw new Error('You cannot report yourself');

  const { error } = await supabase.from('reports').insert({
    reporter_id: session.user.id,
    subject_id: input.subjectId,
    listing_id: input.listingId ?? null,
    lock_in_id: input.lockInId ?? null,
    body: input.body.trim(),
  });
  if (error) await fail(error);
}

/** Reports YOU filed. RLS makes it impossible to read anyone else's. */
export async function myReports(): Promise<
  { id: string; subject_id: string; body: string; created_at: string; outcome: string | null }[]
> {
  const { data, error } = await supabase
    .from('reports')
    .select('id, subject_id, body, created_at, outcome')
    .order('created_at', { ascending: false });
  if (error) await fail(error);
  return (data ?? []) as never;
}

export async function myLockIns(): Promise<LockIn[]> {
  const { data, error } = await supabase
    .from('lock_ins')
    .select('*')
    .order('locked_at', { ascending: false });
  if (error) await fail(error);
  return (data ?? []) as LockIn[];
}
