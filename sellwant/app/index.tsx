import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from 'react-native';
import { Redirect } from 'expo-router';
import { Text, Wordmark, Button, Input, Card } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { authRedirect } from '@/lib/site-url';
import {
  getSession,
  onAuthChange,
  signInWithPassword,
  signUpWithPassword,
  resendVerification,
  sendPasswordReset,
  AuthProblem,
} from '@/services/data';

type Mode = 'signin' | 'signup';
/** What the screen is showing. The two "sent" states are dead ends until the
 *  person goes to their inbox, so they replace the form rather than sit under
 *  it -- a form you must not use again should not still be tappable. */
type View_ = 'form' | 'verify' | 'reset-sent';

const MIN_PASSWORD = 8;

export default function SignInScreen() {
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  const [mode, setMode] = useState<Mode>('signin');
  const [view, setView] = useState<View_>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when sign-in failed only because the address was never confirmed --
   *  that is the one failure with a fix we can offer inline. */
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState(false);

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

  const emailLooksReal = /\S+@\S+\.\S+/.test(email);

  const swap = (to: Mode) => {
    setMode(to);
    setError(null);
    setUnconfirmed(false);
    setPassword('');
  };

  const submit = async () => {
    setError(null);
    setUnconfirmed(false);
    if (!emailLooksReal) return setError('Enter a valid email address');
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      return setError(`Password must be at least ${MIN_PASSWORD} characters`);
    }
    if (!password) return setError('Enter your password');

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { needsVerification } = await signUpWithPassword(
          email,
          password,
          authRedirect('/auth/callback')
        );
        // If the project has confirmations off, signUp returns a live session
        // and onAuthChange has already redirected us. Only stop here when a
        // click is genuinely outstanding.
        if (needsVerification) setView('verify');
      } else {
        await signInWithPassword(email, password);
      }
    } catch (e) {
      const p = e as AuthProblem;
      setError(p?.message ?? 'Something went wrong. Try again.');
      if (p?.kind === 'unconfirmed') setUnconfirmed(true);
      if (p?.kind === 'exists') setMode('signin');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      await resendVerification(email, authRedirect('/auth/callback'));
      setResent(true);
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not resend. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setError(null);
    if (!emailLooksReal) {
      return setError('Enter your email address first, then tap this again');
    }
    setBusy(true);
    try {
      await sendPasswordReset(email, authRedirect('/auth/reset'));
      setView('reset-sent');
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not send the reset link.');
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setView('form');
    setResent(false);
    setError(null);
    setPassword('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Wordmark size="display" />
          <Text variant="small" tone="muted" style={styles.tagline}>
            Buy what you want. Sell what you have.
          </Text>
        </View>

        {view === 'verify' && (
          <Card>
            <Text variant="heading">Confirm your email</Text>
            <Text variant="small" tone="muted" style={styles.body}>
              We sent a link to {email}. Click it and you&apos;re in — after that
              you sign in with just your password.
            </Text>
            {resent ? (
              <Text variant="caption" tone="want" style={styles.body}>
                Sent again. Check spam if it still hasn&apos;t arrived.
              </Text>
            ) : (
              <Button
                title="Resend the email"
                variant="outline"
                block
                loading={busy}
                onPress={resend}
                style={styles.action}
              />
            )}
            <Button
              title="Use a different email"
              variant="ghost"
              block
              onPress={() => {
                startOver();
                setEmail('');
              }}
              style={styles.secondary}
            />
            {!!error && (
              <Text variant="small" tone="destructive" style={styles.body}>
                {error}
              </Text>
            )}
          </Card>
        )}

        {view === 'reset-sent' && (
          <Card>
            <Text variant="heading">Check your email</Text>
            <Text variant="small" tone="muted" style={styles.body}>
              If {email} has an account, a link to set a new password is on its
              way.
            </Text>
            <Button
              title="Back to sign in"
              variant="outline"
              block
              onPress={startOver}
              style={styles.action}
            />
          </Card>
        )}

        {view === 'form' && (
          <>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@gmail.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
            />

            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              secureTextEntry={!reveal}
              autoCapitalize="none"
              autoCorrect={false}
              // Tells the password manager to offer saving on sign-up and
              // filling on sign-in, instead of guessing and getting it wrong.
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              textContentType={mode === 'signup' ? 'newPassword' : 'password'}
              onSubmitEditing={submit}
              returnKeyType="go"
              error={error ?? undefined}
              containerStyle={styles.password}
            />

            <View style={styles.helpers}>
              {/* A hidden field you typed wrong locks you out until a reset,
                  so revealing it is cheaper than the recovery flow. */}
              <Pressable onPress={() => setReveal((r) => !r)} hitSlop={8}>
                <Text variant="caption" tone="muted">
                  {reveal ? 'Hide password' : 'Show password'}
                </Text>
              </Pressable>
              {mode === 'signin' && (
                <Pressable onPress={forgot} hitSlop={8}>
                  <Text variant="caption" tone="muted">
                    Forgot password?
                  </Text>
                </Pressable>
              )}
            </View>

            {unconfirmed && (
              <Button
                title="Resend confirmation email"
                variant="outline"
                block
                loading={busy}
                onPress={resend}
                style={styles.action}
              />
            )}

            <Button
              title={mode === 'signup' ? 'Create account' : 'Sign in'}
              onPress={submit}
              loading={busy}
              block
              style={styles.action}
            />

            <Pressable onPress={() => swap(mode === 'signup' ? 'signin' : 'signup')}>
              <Text variant="caption" tone="subtle" style={styles.fine}>
                {mode === 'signup'
                  ? 'Already have an account? Sign in'
                  : 'New here? Create an account'}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space[6],
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  brand: { marginBottom: space[10] },
  tagline: { marginTop: space[2] },
  body: { marginTop: space[2], lineHeight: 20 },
  password: { marginTop: space[4] },
  helpers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space[3],
  },
  action: { marginTop: space[5] },
  secondary: { marginTop: space[2] },
  fine: { textAlign: 'center', marginTop: space[5] },
});
