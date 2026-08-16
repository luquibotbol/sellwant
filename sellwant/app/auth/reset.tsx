import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Text, Button, Input, Card } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { getSession, onAuthChange, updatePassword } from '@/services/data';

const MIN_PASSWORD = 8;

/**
 * Where a password-reset link lands.
 *
 * The recovery link carries a token that the Supabase client exchanges for a
 * real session on load (detectSessionInUrl). That session is the only proof
 * the person owns the address, so the form waits for it rather than trusting
 * the URL -- and without it there is nothing to update.
 */
export default function ResetPasswordScreen() {
  const [ready, setReady] = useState<'waiting' | 'ok' | 'expired'>('waiting');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthChange((signedIn) => {
      if (!cancelled && signedIn) setReady('ok');
    });

    getSession()
      .then((s) => {
        if (!cancelled && s) setReady('ok');
      })
      .catch(() => {});

    // Recovery links are single-use and short-lived. No session after a few
    // seconds means it was already spent, expired, or this origin is missing
    // from Supabase's redirect allow-list.
    const timer = setTimeout(() => {
      if (!cancelled) setReady((r) => (r === 'waiting' ? 'expired' : r));
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const save = async () => {
    setError(null);
    if (password.length < MIN_PASSWORD) {
      return setError(`Password must be at least ${MIN_PASSWORD} characters`);
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not set the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        {ready === 'waiting' && (
          <>
            <ActivityIndicator color={colors.mutedForeground} />
            <Text variant="small" tone="muted" style={styles.centeredText}>
              Checking your link…
            </Text>
          </>
        )}

        {ready === 'expired' && (
          <Card style={styles.card}>
            <Text variant="title">That link didn&apos;t work</Text>
            <Text variant="small" tone="muted" style={styles.body}>
              Reset links can only be used once, and they expire. Ask for a new
              one and open it straight away.
            </Text>
            <Button
              title="Back to sign in"
              variant="outline"
              block
              onPress={() => router.replace('/')}
              style={styles.action}
            />
          </Card>
        )}

        {ready === 'ok' && !done && (
          <Card style={styles.card}>
            <Text variant="title">Set a new password</Text>
            <Text variant="small" tone="muted" style={styles.body}>
              Next time you sign in, use this.
            </Text>
            <Input
              label="New password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              secureTextEntry={!reveal}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              onSubmitEditing={save}
              returnKeyType="go"
              error={error ?? undefined}
              containerStyle={styles.field}
            />
            <Pressable onPress={() => setReveal((r) => !r)} hitSlop={8}>
              <Text variant="caption" tone="muted" style={styles.reveal}>
                {reveal ? 'Hide password' : 'Show password'}
              </Text>
            </Pressable>
            <Button
              title="Save password"
              block
              loading={busy}
              onPress={save}
              style={styles.action}
            />
          </Card>
        )}

        {done && (
          <Card style={styles.card}>
            <Text variant="title">Password saved</Text>
            <Text variant="small" tone="muted" style={styles.body}>
              You&apos;re signed in on this device already.
            </Text>
            <Button
              title="Go to the feed"
              block
              onPress={() => router.replace('/feed')}
              style={styles.action}
            />
          </Card>
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
  card: { width: '100%' },
  centeredText: { marginTop: space[3], textAlign: 'center' },
  body: { marginTop: space[2], lineHeight: 20 },
  field: { marginTop: space[5] },
  reveal: { marginTop: space[2] },
  action: { marginTop: space[5] },
});
