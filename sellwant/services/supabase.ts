import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly at import time. A missing key otherwise surfaces much later as
  // an opaque "Invalid API key" on the first query.
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy sellwant/.env.example to sellwant/.env and fill it in.'
  );
}

/**
 * Static web rendering executes this module in Node, where there is no window
 * and AsyncStorage throws. The client is inert during prerender and picks up
 * the real session once it hydrates in the browser.
 */
const hasWindow = typeof window !== 'undefined';

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: hasWindow ? AsyncStorage : undefined,
    autoRefreshToken: hasWindow,
    persistSession: hasWindow,
    // Only the web build returns from a magic link with the code in the URL.
    detectSessionInUrl: hasWindow && Platform.OS === 'web',
  },
});
