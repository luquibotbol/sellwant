import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Text, Button } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { getSession, onAuthChange } from '@/services/data';

/**
 * Where the email-confirmation link lands on web. The Supabase client runs
 * with detectSessionInUrl, so it exchanges the code on load; this screen
 * waits. Password resets land on /auth/reset instead, because they need a
 * form rather than a redirect.
 */
export default function AuthCallback() {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthChange((signedIn) => {
      if (!cancelled && signedIn) setState('done');
    });

    getSession()
      .then((s) => {
        if (!cancelled && s) setState('done');
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

  if (state === 'done') return <Redirect href="/feed" />;

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
