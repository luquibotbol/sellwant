import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Redirect } from 'expo-router';
import Colors from '@/constants/colors';
import InputField from '@/components/InputField';
import Button from '@/components/Button';
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
        <ActivityIndicator color={Colors.accent} />
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
      // On web the magic link has to come back to this origin. The URL must
      // also be allow-listed in the Supabase dashboard or the link no-ops.
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
        <Text style={styles.logo}>SellUp</Text>
        <Text style={styles.tagline}>Buy what you want. Sell what you have.</Text>

        {sent ? (
          <View style={styles.sentBox}>
            <Text style={styles.sentTitle}>Check your email</Text>
            <Text style={styles.sentBody}>
              We sent a sign-in link to {email}. Open it on this device.
            </Text>
            <Button
              title="Use a different email"
              variant="outline"
              onPress={() => {
                setSent(false);
                setEmail('');
              }}
              style={styles.button}
            />
          </View>
        ) : (
          <>
            <InputField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@school.edu"
              keyboardType="email-address"
              autoCapitalize="none"
              error={error ?? undefined}
            />
            <Button
              title="Send me a sign-in link"
              onPress={handleSend}
              isLoading={sending}
              style={styles.button}
            />
            <Text style={styles.fine}>No password. We email you a link.</Text>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  inner: { flex: 1, justifyContent: 'center', padding: 24, maxWidth: 480, width: '100%', alignSelf: 'center' },
  logo: { color: Colors.accent, fontSize: 40, fontWeight: 'bold', textAlign: 'center' },
  tagline: { color: Colors.textSecondary, fontSize: 15, textAlign: 'center', marginTop: 8, marginBottom: 40 },
  button: { marginTop: 16 },
  fine: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 16 },
  sentBox: { backgroundColor: Colors.card, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: Colors.border },
  sentTitle: { color: Colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  sentBody: { color: Colors.textSecondary, fontSize: 15, lineHeight: 22 },
});
