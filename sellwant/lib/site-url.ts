import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

/**
 * Where an auth email should send someone back to.
 *
 * On web this is always the origin the browser is currently on, so one build
 * works unchanged on localhost, a preview URL and sellwant.com. Nothing here
 * is hardcoded, and nothing needs rebuilding when the domain changes.
 *
 * THE LOCALHOST TRAP: Supabase only honours this URL when it matches the
 * project's redirect allow-list. When it doesn't match, it does not error --
 * it quietly substitutes the project's Site URL. So a project still pointed at
 * localhost mails out localhost links from production and looks like an app
 * bug. The allow-list lives in Supabase → Authentication → URL Configuration
 * and must carry every origin the app is served from.
 */
export function authRedirect(path: `/${string}`): string | undefined {
  if (Platform.OS === 'web') {
    // `origin` already carries the port, so :8081 in dev survives.
    return `${window.location.origin}${path}`;
  }
  // Native resolves through the app's scheme (`sellwant://`), or the Expo Go
  // tunnel while developing. Linking.createURL handles both.
  return Linking.createURL(path);
}
