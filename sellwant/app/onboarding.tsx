import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { safeReturnTo } from '@/lib/return-to';
import { Text, Wordmark, Card, Button, Input, Badge } from '@/components/ui';
import AvatarPicker from '@/components/AvatarPicker';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { getMyProfile, completeOnboarding } from '@/services/data';

/** Loose on purpose -- students type numbers many ways and we don't verify. */
const PHONE_RE = /^[0-9+()\-.\s]{7,}$/;

export default function OnboardingScreen() {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const onward = safeReturnTo(params.returnTo) ?? '/feed';
  const profile = useAsync(getMyProfile, []);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [instagram, setInstagram] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (profile.loading) return <View style={styles.container} />;
  if (!profile.data) return <Redirect href="/signin" />;
  // Already done -- don't trap people here on a refresh.
  if (profile.data.onboarded_at) return <Redirect href={onward as never} />;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (fullName.trim().length < 2) next.fullName = 'Enter your full name';
    else if (!fullName.trim().includes(' ')) next.fullName = 'First and last name, please';
    if (!PHONE_RE.test(phone.trim())) next.phone = 'Enter a phone number people can reach you on';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setFormError(null);
    try {
      await completeOnboarding({
        full_name: fullName,
        phone,
        instagram: instagram.replace(/^@/, '').trim() || null,
        profile_picture: photo,
      });
      router.replace(onward as never);
    } catch (e: any) {
      setFormError(e?.message ?? 'Could not save your details');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Wordmark size="display" />
        <Text variant="small" tone="muted" style={styles.intro}>
          Set up your profile before you start trading. People are handing money
          to a stranger — knowing who you are is what makes that feel safe.
        </Text>

        {/* Optional, like Instagram -- encouraged with a reason rather than
            enforced, so a curious student isn't blocked at the door. */}
        <View style={styles.avatarBlock}>
          <AvatarPicker
            uri={photo}
            name={fullName}
            size={104}
            label="Add a photo"
            onUploaded={setPhoto}
          />
          <Text variant="caption" tone="subtle" style={styles.photoHint}>
            Optional — but people are readier to meet someone they can recognise.
          </Text>
        </View>

        <Input
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Maya Rodriguez"
          autoCapitalize="words"
          autoCorrect={false}
          error={errors.fullName}
          hint="Shown publicly on everything you post."
        />

        <Input
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          placeholder="(512) 555-0142"
          keyboardType="phone-pad"
          error={errors.phone}
          hint="Private. Only shared once you lock in a deal with someone."
        />

        {/* Optional, but the whole point is that people add it -- so it gets a
            card, a reason, and a badge rather than a quiet placeholder. */}
        <Card accent="want" style={styles.igCard}>
          <View style={styles.igHead}>
            <Text variant="bodyMedium">Instagram</Text>
            <Badge label="RECOMMENDED" variant="want" />
          </View>
          <Text variant="small" tone="muted" style={styles.igBody}>
            Optional — but people are far more likely to buy from someone they
            can see is a real student. It shows publicly next to your listings.
          </Text>
          <Input
            value={instagram}
            onChangeText={setInstagram}
            placeholder="@yourhandle"
            autoCapitalize="none"
            autoCorrect={false}
            containerStyle={styles.igInput}
          />
        </Card>

        {!!formError && (
          <Text variant="small" tone="destructive" style={styles.formError}>
            {formError}
          </Text>
        )}

        <Button title="Start trading" onPress={submit} loading={saving} size="lg" block />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: space[6],
    paddingTop: space[16],
    paddingBottom: space[16],
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  intro: { marginTop: space[3], marginBottom: space[8], lineHeight: 20 },
  avatarBlock: { alignItems: 'center', marginBottom: space[8] },
  photoHint: { marginTop: space[2], textAlign: 'center', maxWidth: 260 },
  igCard: { marginBottom: space[6] },
  igHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  igBody: { marginTop: space[2], marginBottom: space[4] },
  igInput: { marginBottom: 0 },
  formError: { marginBottom: space[3] },
});
