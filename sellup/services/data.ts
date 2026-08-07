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

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  profile_picture: string | null;
  accepted_payments: PaymentHandle[];
  /** Observed behaviour, not a rating. Written by trigger, never by a client. */
  completed_deals: number;
  is_suspended: boolean;
  created_at: string;
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
  'id' | 'full_name' | 'profile_picture' | 'completed_deals'> | null };

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

/** Only these columns are grantable to the client -- `completed_deals` and
 *  `is_suspended` are revoked at the database level on purpose. */
export async function updateMyProfile(patch: {
  full_name?: string;
  profile_picture?: string | null;
  accepted_payments?: PaymentHandle[];
}) {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', session.user.id);
  if (error) throw error;
}

// ---------------------------------------------------------------- listings

const LISTING_SELECT =
  '*, poster:profiles!listings_user_id_fkey(id, full_name, profile_picture, completed_deals)';

/** The feed: what's coming up, soonest first. Not a search box. */
export async function listActive(
  opts: { type?: ListingType } = {}
): Promise<ListingWithPoster[]> {
  let q = supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('status', 'active')
    .order('event_date', { ascending: true, nullsFirst: false });
  if (opts.type) q = q.eq('type', opts.type);
  const { data, error } = await q;
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
