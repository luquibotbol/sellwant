import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Text, Button } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { getSession, onAuthChange, getMyProfile } from '@/services/data';
import { safeReturnTo } from '@/lib/return-to';

/**
 * Where the email-confirmation link lands on web. The Supabase client runs
 * with detectSessionInUrl, so it exchanges the code on load; this screen
 * waits. Password resets land on /auth/reset instead, because they need a
 * form rather than a redirect.
 */
export default function AuthCallback() {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = safeReturnTo(params.returnTo);
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  /** Null until known. A fresh account has no name yet, and an offer from a
   *  nameless profile is worse than a short detour through onboarding. */
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let resolved = false;

    // The session can arrive either from getSession (already exchanged) or
    // from onAuthChange (exchanged a moment later). Both funnel through here,
    // because setting `done` without also resolving onboarding would leave the
    // redirect condition permanently unmet and the spinner running forever.
    const resolve = async () => {
      if (cancelled || resolved) return;
      resolved = true;
      try {
        const me = await getMyProfile();
        if (!cancelled) setNeedsOnboarding(!me?.onboarded_at);
      } catch {
        // Treat an unreadable profile as "already onboarded": sending someone
        // round the loop again is worse than a missing name.
        if (!cancelled) setNeedsOnboarding(false);
      }
      if (!cancelled) setState('done');
    };

    const unsubscribe = onAuthChange((signedIn) => {
      if (signedIn) void resolve();
    });

    getSession()
      .then((s) => {
        if (s) void resolve();
      })
      .catch(() => {});

    // No session after a few seconds means the link expired, was already used,
    // or this origin isn't in Supabase's redirect allow-list.
    const timer = setTimeout(() => {
      if (!cancelled) setState((s) => (s === 'working' ? 'failed' : s));
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  if (state === 'done' && needsOnboarding !== null) {
    const onward = returnTo ?? '/feed';
    const href = needsOnboarding
      ? `/onboarding?returnTo=${encodeURIComponent(onward)}`
      : onward;
    return <Redirect href={href as never} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        {state === 'working' ? (
          <>
            <ActivityIndicator color={colors.mutedForeground} />
            <Text variant="small" tone="muted" style={styles.text}>
              Signing you in…
            </Text>
          </>
        ) : (
          <>
            <Text variant="title">That link didn&apos;t work</Text>
            <Text variant="small" tone="muted" style={styles.text}>
              Confirmation links expire and can only be used once. Sign in and
              we&apos;ll send you a fresh one.
            </Text>
            <Button
              title="Back to sign in"
              variant="outline"
              onPress={() => router.replace('/')}
              style={styles.button}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[6],
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  text: { marginTop: space[3], textAlign: 'center' },
  button: { marginTop: space[6] },
});
