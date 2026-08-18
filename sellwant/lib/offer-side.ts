/**
 * Which side of a trade an offer puts you on.
 *
 * Lives here rather than in the screen because the screen imports
 * react-native, which bun cannot parse -- the same reason handoff.ts and
 * payments.ts are separate modules. Being testable is the point: the table
 * below is easy to get backwards.
 *
 * Not the same question as received-versus-sent, and it cuts across it. On a
 * `sell` listing the poster is selling and the offerer is buying; on an `ask`
 * listing it is reversed. So both of these mean you are buying: someone
 * offering to sell you the ticket you asked for, and you offering to buy
 * someone else's.
 *
 *   listing is yours   type    you are
 *   ----------------   ----    -------
 *   yes                sell    selling
 *   yes                ask     buying
 *   no                 sell    buying
 *   no                 ask     selling
 */
export type Side = 'buying' | 'selling';

/** Only the fields the decision needs, so this stays independent of the
 *  Supabase row shape. */
interface OfferLike {
  listing: { user_id: string; type: string } | null;
}

export function sideOf(offer: OfferLike, meId: string): Side | null {
  const listing = offer.listing;
  // A deleted listing has no side. Guessing one would mislabel the row.
  if (!listing) return null;
  const yours = listing.user_id === meId;
  const sellListing = listing.type === 'sell';
  return yours === sellListing ? 'selling' : 'buying';
}
