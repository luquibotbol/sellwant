/**
 * The single data seam. Every screen calls this module.
 *
 * No screen should ever import `supabase` directly -- keeping the client behind
 * this boundary is what lets the registry and handoff logic change without
 * touching UI code.
 */
import { supabase } from '@/services/supabase';

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
 *  never moves through SellUp. */
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
  created_at: string;
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
  if (error) throw error;
  return data.session;
}

export function onAuthChange(cb: (signedIn: boolean) => void) {
  const { data } = supabase.auth.onAuthStateChange((_e, session) =>
    cb(!!session)
  );
  return () => data.subscription.unsubscribe();
}

/** Sends a magic link. `redirectTo` matters on web -- it must be an origin
 *  allow-listed in the Supabase dashboard or the link silently fails. */
export async function signInWithEmail(email: string, redirectTo?: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
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
  if (error) throw error;
  return data as Profile | null;
}

export async function getProfile(id: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
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
  if (error) throw error;
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
  if (error) throw error;
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
  if (error) throw error;
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
  if (error) throw error;
  return data as ContactDetails | null;
}

/** Full name and phone are required; Instagram is optional but pushed hard. */
export async function completeOnboarding(input: {
  full_name: string;
  phone: string;
  instagram?: string | null;
}) {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');

  const { error: pErr } = await supabase
    .from('profiles')
    .update({
      full_name: input.full_name.trim(),
      instagram: input.instagram?.trim() || null,
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
  if (error) throw error;

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

export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('*').order('id');
  if (error) throw error;
  return (data ?? []) as Category[];
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
  if (error) throw error;
  return (data ?? []) as ListingWithPoster[];
}

export async function getListing(id: string): Promise<ListingWithPoster | null> {
  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as ListingWithPoster | null;
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
  if (error) throw error;
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
  if (error) throw error;
  const result = data as { ok: boolean; same_seller?: boolean };
  return result.ok ? { ok: true } : { ok: false, sameSeller: !!result.same_seller };
}

export async function cancelListing(id: string) {
  const { error } = await supabase
    .from('listings')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw error;
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
  if (error) throw error;
  return data as LockIn;
}

export async function getLockIn(id: string): Promise<LockIn | null> {
  const { data, error } = await supabase
    .from('lock_ins')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as LockIn | null;
}

export async function myLockIns(): Promise<LockIn[]> {
  const { data, error } = await supabase
    .from('lock_ins')
    .select('*')
    .order('locked_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as LockIn[];
}
