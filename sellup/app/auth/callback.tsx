import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import Colors from '@/constants/colors';
import Button from '@/components/Button';
import { getSession, onAuthChange } from '@/services/data';
import { router } from 'expo-router';

/**
 * Where the magic link lands on web. The Supabase client is configured with
 * detectSessionInUrl, so it exchanges the code in the URL on load -- this
 * screen just waits for that to resolve.
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
        if (cancelled) return;
        if (s) setState('done');
      })
      .catch(() => {});

    // If the exchange hasn't produced a session in a few seconds, the link was
    // expired, already used, or the redirect URL isn't allow-listed.
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
      {state === 'working' ? (
        <>
          <ActivityIndicator color={Colors.accent} />
          <Text style={styles.text}>Signing you in…</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>That link didn&apos;t work</Text>
          <Text style={styles.text}>
            It may have expired or already been used. Request a new one.
          </Text>
          <Button
            title="Back to sign in"
            onPress={() => router.replace('/')}
            style={styles.button}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: Colors.text, fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  text: { color: Colors.textSecondary, fontSize: 15, marginTop: 12, textAlign: 'center', lineHeight: 22 },
  button: { marginTop: 24 },
});
