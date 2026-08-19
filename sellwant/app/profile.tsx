import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Redirect, router } from 'expo-router';
import {
  Text,
  Card,
  Button,
  Input,
  Badge,
  Separator,
  ErrorState,
} from '@/components/ui';
import AvatarPicker from '@/components/AvatarPicker';
import { colors, space, radius, maxContentWidth } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import {
  getMyProfile,
  getMyContact,
  signOut,
  updateMyContact,
  updateMyProfile,
  PaymentHandle,
} from '@/services/data';

const KINDS: { key: PaymentHandle['kind']; label: string; hint: string }[] = [
  { key: 'venmo', label: 'Venmo', hint: '@your-handle' },
  { key: 'cashapp', label: 'Cash App', hint: '$yourcashtag' },
  { key: 'zelle', label: 'Zelle', hint: 'phone or email' },
  { key: 'paypal', label: 'PayPal', hint: 'paypal.me/you' },
];

export default function ProfileScreen() {
  const profile = useAsync(getMyProfile, []);
  const myContact = useAsync(getMyContact, []);
  const [kind, setKind] = useState<PaymentHandle['kind']>('venmo');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ig, setIg] = useState<string | null>(null);
  const [savingIg, setSavingIg] = useState(false);

  if (profile.loading || myContact.loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (profile.error) {
    return (
      <View style={styles.container}>
        <ErrorState message={profile.error.message} onRetry={profile.reload} />
      </View>
    );
  }
  if (!profile.data) return <Redirect href="/signin" />;

  const me = profile.data;
  const contact = myContact.data;
  const igValue = ig ?? me.instagram ?? '';
  const handles = contact?.accepted_payments ?? [];
  const activeKind = KINDS.find((k) => k.key === kind)!;

  const addHandle = async () => {
    if (!value.trim()) {
      setSaveError('Enter your handle');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateMyContact({
        accepted_payments: [
          ...handles.filter((h) => h.kind !== kind),
          { kind, value: value.trim() },
        ],
      });
      setValue('');
      myContact.reload();
    } catch (e: any) {
      setSaveError(e?.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const removeHandle = async (target: PaymentHandle) => {
    try {
      await updateMyContact({
        accepted_payments: handles.filter((h) => h.kind !== target.kind),
      });
      myContact.reload();
    } catch {
      /* surfaced on next load */
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.identity}>
        <AvatarPicker
          uri={me.profile_picture}
          name={me.full_name}
          size={72}
          onUploaded={async (url) => {
            await updateMyProfile({ profile_picture: url });
            profile.reload();
          }}
        />
        <View style={styles.identityText}>
          <Text variant="title">{me.full_name || 'No name yet'}</Text>
          <Text variant="small" tone="muted">
            {contact?.email ?? ''}
          </Text>
        </View>
      </View>

      {me.is_suspended && (
        <Badge label="SUSPENDED" variant="destructive" style={styles.suspended} />
      )}

      {/* Reputation is observed behaviour only -- no stars, no reviews. */}
      <Card style={styles.stats}>
        <View style={styles.stat}>
          <Text variant="display">{me.completed_deals}</Text>
          <Text variant="caption" tone="muted">
            completed {me.completed_deals === 1 ? 'handoff' : 'handoffs'}
          </Text>
        </View>
        <Separator style={styles.statDivider} />
        <View style={styles.stat}>
          {/* Full year, not '26 -- "Aug 26" next to a number reads as a date. */}
          <Text variant="display">
            {new Date(me.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
          </Text>
          <Text variant="caption" tone="muted">
            member since
          </Text>
        </View>
      </Card>

      {/* Public, and pushed when missing -- it is the cheapest signal a buyer
          has that a seller is a real student. */}
      <Card accent={me.instagram ? 'want' : undefined} style={styles.igCard}>
        <View style={styles.igHead}>
          <Text variant="bodyMedium">Instagram</Text>
          {!me.instagram && <Badge label="RECOMMENDED" variant="want" />}
        </View>
        <Text variant="small" tone="muted" style={styles.igBody}>
          {me.instagram
            ? 'Shown publicly next to everything you post.'
            : 'People are far more likely to buy from someone they can see is real. Shown publicly.'}
        </Text>
        <Input
          value={igValue}
          onChangeText={setIg}
          placeholder="@yourhandle"
          autoCapitalize="none"
          autoCorrect={false}
          containerStyle={styles.igInput}
        />
        <Button
          title={me.instagram ? 'Update Instagram' : 'Add Instagram'}
          variant={me.instagram ? 'secondary' : 'want'}
          block
          loading={savingIg}
          onPress={async () => {
            setSavingIg(true);
            try {
              await updateMyProfile({ instagram: igValue.replace(/^@/, '').trim() || null });
              profile.reload();
            } finally {
              setSavingIg(false);
            }
          }}
        />
      </Card>

      <Text variant="heading" style={styles.sectionTitle}>
        How you get paid
      </Text>
      <Text variant="small" tone="muted" style={styles.sectionBody}>
        Money moves directly between you and the other student. SellWant never
        touches it — we just pass along your handle.
      </Text>

      {handles.length > 0 && (
        <Card style={styles.handles}>
          {handles.map((h, i) => (
            <View key={h.kind}>
              {i > 0 && <Separator style={styles.handleDivider} />}
              <View style={styles.handleRow}>
                <View>
                  <Text variant="bodyMedium">
                    {KINDS.find((k) => k.key === h.kind)?.label ?? h.kind}
                  </Text>
                  <Text variant="small" tone="muted">
                    {h.value}
                  </Text>
                </View>
                <Pressable onPress={() => removeHandle(h)} hitSlop={8}>
                  <Text variant="small" tone="destructive">
                    Remove
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </Card>
      )}

      <Card style={styles.addCard}>
        <View style={styles.kinds}>
          {KINDS.map((k) => (
            <Pressable
              key={k.key}
              onPress={() => setKind(k.key)}
              style={[styles.kind, kind === k.key && styles.kindActive]}
            >
              <Text variant="small" tone={kind === k.key ? 'default' : 'muted'}>
                {k.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Input
          value={value}
          onChangeText={setValue}
          placeholder={activeKind.hint}
          autoCapitalize="none"
          autoCorrect={false}
          error={saveError ?? undefined}
          containerStyle={styles.addInput}
        />
        <Button
          title={handles.some((h) => h.kind === kind) ? `Update ${activeKind.label}` : `Add ${activeKind.label}`}
          onPress={addHandle}
          loading={saving}
          variant="secondary"
          block
        />
      </Card>

      <Button
        title="Your listings"
        variant="secondary"
        block
        style={styles.signOut}
        onPress={() => router.navigate('/my-listings')}
      />

      <Button
        title="Sign out"
        variant="outline"
        block
        style={styles.signOut}
        onPress={async () => {
          await signOut();
          router.replace('/signin');
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: space[5],
    paddingBottom: space[16],
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  centered: { alignItems: 'center', justifyContent: 'center' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space[5] },
  identityText: { flex: 1 },
  suspended: { marginTop: space[4] },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: space[6] },
  stat: { flex: 1, alignItems: 'center', gap: space[1] },
  statDivider: { width: 1, height: 40, backgroundColor: colors.border },
  igCard: { marginTop: space[6] },
  igHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  igBody: { marginTop: space[2], marginBottom: space[4] },
  igInput: { marginBottom: space[3] },
  sectionTitle: { marginTop: space[8] },
  sectionBody: { marginTop: space[2] },
  handles: { marginTop: space[4], paddingVertical: space[1] },
  handleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: space[3],
  },
  handleDivider: { marginHorizontal: -space[4] },
  addCard: { marginTop: space[3] },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  kind: {
    paddingHorizontal: space[3], paddingVertical: space[2],
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  kindActive: { backgroundColor: colors.muted, borderColor: colors.borderStrong },
  addInput: { marginBottom: space[3] },
  signOut: { marginTop: space[8] },
});
