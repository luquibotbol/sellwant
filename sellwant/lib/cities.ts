/**
 * The cities SellWant covers.
 *
 * A fixed list rather than a geocoder or a self-building one. A geocoder costs
 * money and a key to answer a question with eight possible answers, and letting
 * the list grow from what people type is what produced a listing whose location
 * is "halloween" -- a filter is only worth having if its values are known.
 *
 * Ordered by where the students are, not alphabetically: this is a dropdown
 * people scan, and Austin should not sit below College Station because of a
 * spelling accident. Extend it as the map grows; nothing else needs changing.
 */
export const CITIES = [
  'Austin',
  'Dallas',
  'Houston',
  'San Antonio',
  'College Station',
  'Fort Worth',
  'Lubbock',
  'Waco',
] as const;

export type City = (typeof CITIES)[number];

const canon = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The canonical city for a stored value, or null.
 *
 * Listings written before cities existed hold venues ("Sig Ep house") and worse
 * ("halloween"), so every read has to cope with a value that is not a city.
 * Returning null rather than guessing keeps those out of city filters instead
 * of filing them under whichever city looks closest.
 */
export function toCity(value: string | null | undefined): City | null {
  if (!value) return null;
  const q = canon(value);
  return CITIES.find((c) => canon(c) === q) ?? null;
}

/** Cities matching what has been typed so far, for a picker. */
export function matchCities(query: string): City[] {
  const q = canon(query);
  if (!q) return [...CITIES];
  const starts = CITIES.filter((c) => canon(c).startsWith(q));
  // "san" should offer San Antonio before it offers nothing; "worth" should
  // still find Fort Worth. Prefix matches rank first because that is what
  // someone typing a city name is doing.
  const contains = CITIES.filter(
    (c) => !canon(c).startsWith(q) && canon(c).includes(q)
  );
  return [...starts, ...contains];
}
