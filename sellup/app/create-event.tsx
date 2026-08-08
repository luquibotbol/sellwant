import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { Text, Card, Button, Input, DateField, LocationField } from '@/components/ui';
import TicketCodeField from '@/components/TicketCodeField';
import { colors, space, radius, control, maxContentWidth } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import {
  createListing,
  listCategories,
  listLocationSuggestions,
  registerTicketCode,
  cancelListing,
  ListingType,
} from '@/services/data';

/** Local date, not toISOString() -- that shifts the day west of UTC. */
function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function CreateListingScreen() {
  const categories = useAsync(listCategories, []);
  const places = useAsync(listLocationSuggestions, []);

  const [type, setType] = useState<ListingType>('sell');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  // Most listings are for tonight or this weekend, so today is the right
  // default -- an empty date field made the common case extra work.
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const [codeHash, setCodeHash] = useState<string | null>(null);
  const [codePreview, setCodePreview] = useState<string | null>(null);
  const [rejection, setRejection] = useState<{ sameSeller: boolean } | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selling = type === 'sell';
  const parsedPrice = parseFloat(price);
  const hasPrice = price.trim() !== '' && Number.isFinite(parsedPrice) && parsedPrice > 0;

  const validate = () => {
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = 'Give it a title';
    const cents = Math.round(parseFloat(price) * 100);
    if (!price.trim()) next.price = selling ? 'What are you asking?' : "What will you pay?";
    else if (!Number.isFinite(cents) || cents <= 0) next.price = 'Enter a valid amount';
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) next.date = 'Use YYYY-MM-DD';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    setFormError(null);
    setRejection(null);
    if (!validate()) return;

    setSubmitting(true);
    let created: { id: string } | null = null;
    try {
      created = await createListing({
        type,
        title: title.trim(),
        price_cents: Math.round(parseFloat(price) * 100),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        event_date: date.trim() || undefined,
        category_id: categoryId ?? undefined,
      });

      // Register the code only after the listing exists, then roll the listing
      // back if the registry rejects it -- a sell listing whose code was refused
      // must not survive as an unprotected listing.
      if (selling && codeHash) {
        const result = await registerTicketCode(created.id, codeHash);
        if (!result.ok) {
          await cancelListing(created.id);
          setRejection({ sameSeller: result.sameSeller });
          return;
        }
      }

      router.replace('/feed');
    } catch (e: any) {
      if (created) await cancelListing(created.id).catch(() => {});
      setFormError(e?.message ?? 'Could not post that listing');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Direction first -- it changes what the rest of the form means. */}
        <View style={styles.toggle}>
          <Pressable
            onPress={() => setType('sell')}
            style={[styles.toggleItem, selling && styles.toggleSell]}
          >
            <Text variant="bodyMedium" tone={selling ? 'sell' : 'muted'}>
              I&apos;m selling
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setType('ask')}
            style={[styles.toggleItem, !selling && styles.toggleWant]}
          >
            <Text variant="bodyMedium" tone={!selling ? 'want' : 'muted'}>
              I&apos;m looking for
            </Text>
          </Pressable>
        </View>

        <Input
          label="What is it?"
          value={title}
          onChangeText={setTitle}
          placeholder={selling ? 'Sig Ep Darty — 1 wristband' : 'Want 1 for Sig Ep Darty'}
          error={errors.title}
        />

        {/* Plain apostrophe in the label: it's a JS string prop, not JSX text,
            so an HTML entity would render literally. */}
        <View style={styles.priceRow}>
          <View style={styles.priceInput}>
            <Input
              label={selling ? 'Your price' : "What you'll pay"}
              value={price}
              onChangeText={setPrice}
              placeholder="20"
              keyboardType="numeric"
              error={errors.price}
              hint="US dollars"
            />
          </View>
          {/* Live echo of the amount in the market colour, so the direction of
              the trade is visible while you type rather than only at submit.
              Reads as a running total, so it starts at $0 rather than a dash. */}
          <View
            style={[
              styles.pricePreview,
              hasPrice && (selling ? styles.pricePreviewSell : styles.pricePreviewWant),
            ]}
          >
            <Text variant="title" tone={hasPrice ? (selling ? 'sell' : 'want') : 'subtle'}>
              {(() => {
                // Guard the decimals off `shown`, not `parsedPrice` -- NaN % 1
                // is NaN, which is never 0, so an empty field read as "$0.00".
                const shown = hasPrice ? parsedPrice : 0;
                return `$${shown.toFixed(shown % 1 === 0 ? 0 : 2)}`;
              })()}
            </Text>
          </View>
        </View>

        <Text variant="small" tone="muted" style={styles.label}>
          Category
        </Text>
        <View style={styles.chips}>
          {(categories.data ?? []).map((c) => {
            const active = categoryId === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCategoryId(active ? null : c.id)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text variant="small" tone={active ? 'default' : 'muted'}>
                  {c.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <LocationField
          value={location}
          onChange={setLocation}
          suggestions={places.data ?? []}
        />

        <DateField
          label="When"
          value={date}
          onChange={setDate}
          error={errors.date}
          min={todayISO()}
        />

        <Input
          label="Anything else?"
          value={description}
          onChangeText={setDescription}
          placeholder={selling ? 'Meet at the door, scan in together.' : 'Need it before 10pm.'}
          multiline
        />

        {selling ? (
          <TicketCodeField
            hash={codeHash}
            preview={codePreview}
            rejection={rejection}
            onCode={(h, p) => {
              setCodeHash(h);
              setCodePreview(p);
              setRejection(null);
            }}
          />
        ) : (
          <Card style={styles.askNote}>
            <Text variant="small" tone="muted">
              You&apos;re posting a want-ad. Sellers with a matching ticket can
              respond, and their code gets checked against the registry then.
            </Text>
          </Card>
        )}

        {!!formError && (
          <Text variant="small" tone="destructive" style={styles.formError}>
            {formError}
          </Text>
        )}

        <Button
          title={selling ? 'Post ticket for sale' : 'Post want-ad'}
          onPress={submit}
          loading={submitting}
          variant={selling ? 'sell' : 'want'}
          size="lg"
          block
          style={styles.submit}
        />

        {selling && !codeHash && (
          <Text variant="caption" tone="subtle" style={styles.warn}>
            Without a ticket QR, buyers get no duplicate protection on this listing.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
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
  toggle: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
    marginBottom: space[6],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  toggleItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.transparent,
  },
  toggleSell: { backgroundColor: colors.sellMuted, borderColor: 'rgba(239,68,68,0.35)' },
  toggleWant: { backgroundColor: colors.wantMuted, borderColor: 'rgba(74,222,128,0.35)' },
  priceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  priceInput: { flex: 1 },
  pricePreview: {
    minWidth: 92,
    height: control.lg,
    marginTop: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  pricePreviewSell: { backgroundColor: colors.sellMuted, borderColor: 'rgba(239,68,68,0.3)' },
  pricePreviewWant: { backgroundColor: colors.wantMuted, borderColor: 'rgba(74,222,128,0.3)' },
  label: { marginBottom: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  chip: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.muted, borderColor: colors.borderStrong },
  askNote: { marginBottom: space[4] },
  formError: { marginBottom: space[3] },
  submit: { marginTop: space[2] },
  warn: { textAlign: 'center', marginTop: space[3] },
});
