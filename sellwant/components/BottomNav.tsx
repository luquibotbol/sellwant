import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import { usePathname, router } from 'expo-router';
import { useSession } from '@/hooks/useSession';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '@/components/ui/Text';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { pendingCounts } from '@/services/data';

/**
 * Primary navigation.
 *
 * Replaces a row of text links in the feed header, which on a 375px phone left
 * the wordmark competing with three targets and got worse with every screen
 * added. A bottom bar is where a thumb already is, and it makes the app's
 * shape obvious: browse, your deals, your offers, you.
 *
 * Hidden on the screens where navigating away is the wrong affordance --
 * sign-in, onboarding, and the auth callback.
 */
const TABS = [
  { href: '/feed', label: 'Browse', match: ['/', '/feed', '/event'] },
  { href: '/deals', label: 'Deals', match: ['/deals', '/deal'] },
  { href: '/offers', label: 'Offers', match: ['/offers'] },
  { href: '/profile', label: 'You', match: ['/profile', '/my-listings', '/u'] },
] as const;

/**
 * Logged out, three of those four tabs lead straight back to a sign-in screen.
 * Offering them is a menu of dead ends, so a visitor gets the one thing they
 * can do and the one thing we want them to do.
 */
const ANON_TABS = [
  { href: '/feed', label: 'Browse', match: ['/', '/feed', '/event'] },
  { href: '/signin', label: 'Sign in', match: ['/signin'] },
] as const;

const HIDDEN_ON = [
  '/signin',
  '/onboarding',
  '/auth/callback',
  '/auth/reset',
  '/create-event',
];

/** Nine is where a count stops being a number and becomes "a lot". */
const MAX_SHOWN = 9;

export function BottomNav() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const [counts, setCounts] = useState<{ deals: number; offers: number }>({
    deals: 0,
    offers: 0,
  });

  /**
   * Recounted on every navigation.
   *
   * The number has to be right just after you act, and acting always ends in
   * a navigation -- confirming a deal, replying to an offer. Polling would be
   * both slower to reflect that and more expensive. A failure leaves the
   * previous counts rather than flashing them to zero, since a tab that loses
   * its badge reads as "you already dealt with it".
   */
  useEffect(() => {
    if (!session) {
      setCounts({ deals: 0, offers: 0 });
      return;
    }
    let cancelled = false;
    pendingCounts()
      .then((next) => {
        if (!cancelled) setCounts(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, pathname]);

  if (HIDDEN_ON.includes(pathname)) return null;
  // undefined means "still checking" -- rendering the anonymous bar first and
  // swapping a beat later would flash "Sign in" at someone already signed in.
  if (session === undefined) return null;

  const tabs = session ? TABS : ANON_TABS;

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space[2]) }]}>
      <View style={styles.inner}>
        {tabs.map((t) => {
          // Longest-prefix match so /deal/123 lights up Deals, not Browse.
          const active = t.match.some(
            (m) => pathname === m || pathname.startsWith(`${m}/`)
          );
          const waiting =
            t.href === '/deals' ? counts.deals : t.href === '/offers' ? counts.offers : 0;

          return (
            <Pressable
              key={t.href}
              onPress={() => router.replace(t.href as never)}
              style={styles.tab}
              hitSlop={6}
            >
              <View style={styles.labelRow}>
                <Text
                  variant={active ? 'bodyMedium' : 'body'}
                  tone={active ? 'default' : 'subtle'}
                >
                  {/* The count rides in the label rather than a pill: it only
                      ever means "these are yours to answer", and a bare number
                      floating beside a word is easy to read as unread mail. */}
                  {waiting > 0
                    ? `${t.label} (${waiting > MAX_SHOWN ? `${MAX_SHOWN}+` : waiting})`
                    : t.label}
                </Text>
              </View>
              <View style={[styles.marker, active && styles.markerOn]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingTop: space[2],
    // Sits above content on web where there's no native tab bar behaviour.
    ...Platform.select({ web: { position: 'sticky' as never, bottom: 0 }, default: {} }),
  },
  inner: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: space[3],
  },
  tab: { flex: 1, alignItems: 'center', gap: space[2], paddingVertical: space[1] },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  marker: { height: 2, width: 20, borderRadius: 1, backgroundColor: colors.transparent },
  markerOn: { backgroundColor: colors.foreground },
});

export default BottomNav;
