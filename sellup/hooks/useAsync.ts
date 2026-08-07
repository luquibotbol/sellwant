import { useCallback, useEffect, useState } from 'react';

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
      setError(e instanceof Error ? e : new Error(String(e)));
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
