import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Redirect } from 'expo-router';
import { Text, Wordmark, Button, Input, Card } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { getSession, onAuthChange, signInWithEmail } from '@/services/data';

export default function SignInScreen() {
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSession()
      .then((s) => setSignedIn(!!s))
      .catch(() => setSignedIn(false))
      .finally(() => setChecking(false));
    return onAuthChange(setSignedIn);
  }, []);

  if (checking) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  if (signedIn) return <Redirect href="/feed" />;

  const handleSend = async () => {
    setError(null);
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError('Enter a valid email address');
      return;
    }
    setSending(true);
    try {
      const redirectTo =
        Platform.OS === 'web' ? `${window.location.origin}/auth/callback` : undefined;
      await signInWithEmail(email, redirectTo);
      setSent(true);
    } catch (e: any) {
      setError(e?.message ?? 'Could not send the link. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <View style={styles.brand}>
          <Wordmark size="display" />
          <Text variant="small" tone="muted" style={styles.tagline}>
            Buy what you want. Sell what you have.
          </Text>
        </View>

        {sent ? (
          <Card>
            <Text variant="heading">Check your email</Text>
            <Text variant="small" tone="muted" style={styles.sentBody}>
              We sent a sign-in link to {email}. Open it on this device.
            </Text>
            <Button
              title="Use a different email"
              variant="outline"
              block
              onPress={() => {
                setSent(false);
                setEmail('');
              }}
              style={styles.action}
            />
          </Card>
        ) : (
          <>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@gmail.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              error={error ?? undefined}
            />
            <Button
              title="Send me a sign-in link"
              onPress={handleSend}
              loading={sending}
              block
            />
            <Text variant="caption" tone="subtle" style={styles.fine}>
              No password. We email you a link.
            </Text>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  inner: {
    flex: 1,
    justifyContent: 'center',
    padding: space[6],
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  brand: { marginBottom: space[10] },
  tagline: { marginTop: space[2] },
  sentBody: { marginTop: space[2] },
  action: { marginTop: space[5] },
  fine: { textAlign: 'center', marginTop: space[4] },
});
