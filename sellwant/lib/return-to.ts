/**
 * Where to send someone after they sign in.
 *
 * Only ever an internal path. Accepting a full URL here would turn the sign-in
 * screen into an open redirect: `/?returnTo=https://evil.example` would bounce
 * a freshly authenticated person off the site, which is the exact shape of a
 * credential-phishing flow -- and the link would look legitimate, because it
 * genuinely starts on sellwant.com.
 *
 * Rejects protocol-relative `//host` too. Browsers treat that as absolute, so
 * a naive "must start with /" check lets it straight through.
 */
export function safeReturnTo(raw: unknown): `/${string}` | null {
  if (typeof raw !== 'string') return null;
  const path = raw.trim();
  if (!path.startsWith('/')) return null;
  if (path.startsWith('//')) return null;
  // Backslashes are normalised to slashes by some browsers, so `/\evil.com`
  // can escape the same way `//evil.com` does.
  if (path.includes('\\')) return null;
  // The checks above guarantee the leading slash, so tell the type system --
  // callers that build redirect URLs require it, and a cast at each of those
  // would move the guarantee away from the code that enforces it.
  return path as `/${string}`;
}
