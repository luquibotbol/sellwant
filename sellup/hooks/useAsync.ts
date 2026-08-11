import { useCallback, useEffect, useState } from 'react';

/**
 * Supabase and PostgREST reject with plain objects ({message, code, details,
 * hint}), not Error instances. String(obj) on those yields "[object Object]",
 * which is what users were shown instead of the reason.
 */
function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const msg =
      (o.message as string) ||
      (o.error_description as string) ||
      (o.error as string) ||
      (o.hint as string) ||
      JSON.stringify(o);
    const err = new Error(msg);
    if (o.code) err.name = String(o.code);
    return err;
  }
  return new Error(String(e));
}

/**
 * Minimal data-fetching hook. Deliberately not a caching library -- the app
 * previously cached the marketplace to the device and showed sold listings as
 * available. Every screen refetches.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fn());
    } catch (e) {
      // Surface it. A swallowed error rendering as an empty list makes
      // "the database rejected you" look identical to "nothing here yet".
      // eslint-disable-next-line no-console
      console.error('[useAsync]', e);
      setError(toError(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, error, loading, reload: run };
}
