import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuthChange } from '@/services/data';

/** `undefined` while loading, `null` when signed out. */
export type SessionState = Session | null | undefined;

/**
 * Reactive session.
 *
 * Reading the session once is not enough: when a token turns out to be revoked
 * mid-session the data layer signs you out, and a screen holding a stale copy
 * would keep rendering "something went wrong" instead of returning you to the
 * sign-in page. Subscribing means that sign-out redirects immediately.
 */
export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>(undefined);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const s = await getSession();
        if (alive) setSession(s);
      } catch {
        if (alive) setSession(null);
      }
    };
    read();
    return onAuthChange(() => {
      void read();
    });
  }, []);

  return session;
}
