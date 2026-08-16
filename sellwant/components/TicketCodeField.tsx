import React, { useState } from 'react';
import { View, StyleSheet, Platform, Pressable } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Text, Card, Button, Badge } from '@/components/ui';
import QrScannerModal from '@/components/QrScannerModal';
import { colors, space, radius } from '@/constants/theme';
import { decodeQrFromImageWeb, hashPayload, maskCode } from '@/services/qr';

interface Props {
  /** Called with the sha256 of the normalised payload, or null when cleared. */
  onCode: (hash: string | null, preview: string | null) => void;
  hash: string | null;
  preview: string | null;
  /** Set when the registry rejected this code. */
  rejection?: { sameSeller: boolean } | null;
}

/**
 * Captures the seller's ticket QR.
 *
 * The raw payload never leaves this component -- it is hashed here and only the
 * digest is passed up. Web decodes an uploaded screenshot with jsQR; native
 * scans with the camera, since students already have the ticket on the phone.
 */
export function TicketCodeField({ onCode, hash, preview, rejection }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const web = Platform.OS === 'web';

  /** Hash the payload here so the raw code never leaves this component. */
  const accept = async (payload: string) => {
    onCode(await hashPayload(payload), maskCode(payload));
  };

  const pickAndDecode = async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
      });
      if (picked.canceled) return;

      const payload = await decodeQrFromImageWeb(picked.assets[0].uri);
      if (!payload) {
        setError('No QR code found in that image. Try a clearer screenshot.');
        return;
      }
      await accept(payload);
    } catch (e: any) {
      setError(e?.message ?? 'Could not read that image');
    } finally {
      setBusy(false);
    }
  };

  const handleScanned = async (payload: string) => {
    setScanning(false);
    setError(null);
    try {
      await accept(payload);
    } catch (e: any) {
      setError(e?.message ?? 'Could not read that code');
    }
  };

  if (hash && !rejection) {
    return (
      <Card accent="want" style={styles.card}>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Badge label="TICKET ADDED" variant="want" />
            <Text variant="small" tone="muted" style={styles.masked}>
              {preview}
            </Text>
          </View>
          <Pressable onPress={() => onCode(null, null)} hitSlop={8}>
            <Text variant="small" tone="destructive">
              Remove
            </Text>
          </Pressable>
        </View>
        <Text variant="caption" tone="subtle" style={styles.note}>
          We store a fingerprint of this code, never the code itself.
        </Text>
      </Card>
    );
  }

  return (
    <Card accent={rejection ? 'sell' : undefined} style={styles.card}>
      <Text variant="bodyMedium">Ticket QR</Text>
      <Text variant="small" tone="muted" style={styles.help}>
        Upload a screenshot of your Bubbl ticket. We check it against every other
        listing so the same code can&apos;t be sold twice.
      </Text>

      {rejection && (
        <View style={styles.reject}>
          <Text variant="bodyMedium" tone="destructive">
            {rejection.sameSeller
              ? 'You already have this ticket listed'
              : 'This ticket is already listed by someone else'}
          </Text>
          <Text variant="small" tone="muted" style={styles.rejectBody}>
            {rejection.sameSeller
              ? 'Cancel your other listing first, or upload a different ticket.'
              : 'Someone is already offering this exact code. If you believe this is a mistake, contact us — otherwise the ticket you were sent may not be genuine.'}
          </Text>
        </View>
      )}

      {/* On a phone the ticket is usually on the same device, so scanning is
          the primary path there; on web there is no camera worth using and the
          screenshot upload is. */}
      {web ? (
        <Button
          title="Upload ticket screenshot"
          variant="secondary"
          block
          loading={busy}
          onPress={pickAndDecode}
          style={styles.button}
        />
      ) : (
        <Button
          title="Scan ticket QR"
          variant="secondary"
          block
          onPress={() => {
            setError(null);
            setScanning(true);
          }}
          style={styles.button}
        />
      )}

      {!!error && (
        <Text variant="caption" tone="destructive" style={styles.note}>
          {error}
        </Text>
      )}

      {!web && (
        <QrScannerModal
          visible={scanning}
          onClose={() => setScanning(false)}
          onScanned={handleScanned}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  help: { marginTop: space[2] },
  button: { marginTop: space[4] },
  note: { marginTop: space[3] },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  grow: { flex: 1 },
  masked: { marginTop: space[2] },
  reject: {
    marginTop: space[4],
    padding: space[3],
    borderRadius: radius.lg,
    backgroundColor: colors.destructiveMuted,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  rejectBody: { marginTop: space[1] },
});

export default TicketCodeField;
