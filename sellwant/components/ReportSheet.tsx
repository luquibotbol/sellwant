import React, { useState } from 'react';
import { View, Modal, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Card, Button, Input } from '@/components/ui';
import { colors, space, maxContentWidth } from '@/constants/theme';
import { fileReport } from '@/services/data';

interface Props {
  visible: boolean;
  onClose: () => void;
  subjectId: string;
  subjectName: string;
  listingId?: string;
  lockInId?: string;
}

/**
 * Report someone.
 *
 * A single free-text box, deliberately. No category dropdown: offering the
 * accusations ("scammer", "fake ticket") would make SellWant the author of them
 * rather than a conduit, which is the line Section 230 protection turns on.
 * The copy also has to be honest that nothing visible happens immediately --
 * reports feed suspension decisions, they are not a public flag.
 */
export function ReportSheet({
  visible,
  onClose,
  subjectId,
  subjectName,
  listingId,
  lockInId,
}: Props) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const close = () => {
    setBody('');
    setError(null);
    setSent(false);
    onClose();
  };

  const submit = async () => {
    if (body.trim().length < 10) {
      setError('Tell us what happened — a sentence or two is enough.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fileReport({ subjectId, body, listingId, lockInId });
      setSent(true);
    } catch (e: any) {
      setError(e?.message ?? 'Could not send that report');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} transparent={false}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {sent ? (
            <Card accent="want">
              <Text variant="heading">Report sent</Text>
              <Text variant="small" tone="muted" style={styles.body}>
                Thanks. We read every one. You won&apos;t see anything change on
                {' '}{subjectName}&apos;s profile — reports are private, and we act on them by
                suspending accounts, not by labelling people publicly.
              </Text>
              <Button title="Done" block onPress={close} style={styles.action} />
            </Card>
          ) : (
            <>
              <Text variant="title">Report {subjectName}</Text>
              <Text variant="small" tone="muted" style={styles.body}>
                Tell us what happened in your own words. This goes only to us — it is never
                shown publicly and never shown to them.
              </Text>

              <Input
                value={body}
                onChangeText={setBody}
                placeholder="They took my Venmo and never sent the ticket…"
                multiline
                error={error ?? undefined}
                containerStyle={styles.input}
              />

              <Text variant="caption" tone="subtle" style={styles.fine}>
                We can&apos;t recover money — payments happen off SellWant and we never see them.
                What we can do is stop someone using the app.
              </Text>

              <Button
                title="Send report"
                variant="destructive"
                block
                loading={busy}
                onPress={submit}
                style={styles.action}
              />
              <Button title="Cancel" variant="ghost" block onPress={close} style={styles.cancel} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: space[6],
    paddingTop: space[16],
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  body: { marginTop: space[3], lineHeight: 20 },
  input: { marginTop: space[6] },
  fine: { marginBottom: space[6], lineHeight: 18 },
  action: { marginTop: space[2] },
  cancel: { marginTop: space[2] },
});

export default ReportSheet;
