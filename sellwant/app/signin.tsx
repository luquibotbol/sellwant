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
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Text, Wordmark, Button, Input, Card } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { authRedirect } from '@/lib/site-url';
import { safeReturnTo } from '@/lib/return-to';
import {
  getSession,
  onAuthChange,
  signInWithPassword,
  signUpWithPassword,
  resendVerification,
  sendPasswordReset,
  signInWithGoogle,
  AuthProblem,
} from '@/services/data';

type Mode = 'signin' | 'signup';
/** What the screen is showing. The two "sent" states are dead ends until the
 *  person goes to their inbox, so they replace the form rather than sit under
 *  it -- a form you must not use again should not still be tappable. */
type View_ = 'form' | 'verify' | 'reset-sent';

const MIN_PASSWORD = 8;

export default function SignInScreen() {
  // Set when a visitor was sent here by an action on a public page. Validated,
  // because an unchecked value would let a crafted link bounce someone off the
  // site the moment they authenticate.
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = safeReturnTo(params.returnTo);
  /**
   * Only the visible copy may navigate. Expo Router keeps screens mounted
   * behind the top of the stack, so a backgrounded sign-in screen reacting to
   * an auth change would redirect out from under whatever the person is
   * actually looking at.
   */
  const isFocused = useIsFocused();

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

  // Back to whatever they were looking at, not a generic feed -- landing
  // somewhere unrelated after signing up loses the thing they came for.
  if (signedIn && isFocused) return <Redirect href={(returnTo ?? '/feed') as never} />;

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
          // Carried through the email round-trip. Without it, someone who
          // signs up from a listing confirms their address and lands on a
          // feed, having lost the ticket they came for.
          authRedirect(
            returnTo
              ? `/auth/callback?returnTo=${encodeURIComponent(returnTo)}`
              : '/auth/callback'
          )
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

  const google = async () => {
    setBusy(true);
    setError(null);
    try {
      // Comes back to wherever they were headed, same as the password path.
      await signInWithGoogle(authRedirect(returnTo ?? '/feed'));
      // Redirects away; nothing after this runs on success.
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not start Google sign-in.');
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
        {/* The only screen that animates. People arrive here cold and with
            nothing to wait for; on the feed it would replay on every
            navigation and wear out by the second day. */}
        <View style={styles.brand}>
          <Wordmark size="display" animate />
          <Text variant="small" tone="muted" style={styles.tagline}>
            Buy what you want. Sell what you have.
          </Text>
          {!!returnTo && (
            <Text variant="caption" tone="subtle" style={styles.context}>
              You need an account to make offers and message people. Browsing
              stays free — we&apos;ll take you back to what you were looking at.
            </Text>
          )}
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
            <Button
              title="Continue with Google"
              variant="secondary"
              block
              loading={busy}
              onPress={google}
            />
            <Text variant="caption" tone="subtle" style={styles.or}>
              or use an email and password
            </Text>

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

            {mode === 'signup' && (
              <Text variant="caption" tone="subtle" style={styles.legal}>
                By creating an account you confirm you are 18 or over and agree
                to our{' '}
                <Text
                  variant="caption"
                  tone="muted"
                  onPress={() => router.navigate('/terms' as never)}
                >
                  Terms
                </Text>{' '}
                and{' '}
                <Text
                  variant="caption"
                  tone="muted"
                  onPress={() => router.navigate('/privacy' as never)}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            )}

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
  context: { marginTop: space[4], lineHeight: 18 },
  body: { marginTop: space[2], lineHeight: 20 },
  password: { marginTop: space[4] },
  helpers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space[3],
  },
  action: { marginTop: space[5] },
  secondary: { marginTop: space[2] },
  or: { textAlign: 'center', marginTop: space[4], marginBottom: space[4] },
  legal: { marginTop: space[4], lineHeight: 17 },
  fine: { textAlign: 'center', marginTop: space[5] },
});
