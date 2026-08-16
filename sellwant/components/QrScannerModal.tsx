import React, { useRef, useState } from 'react';
import { View, Modal, StyleSheet, Pressable } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Text, Button } from '@/components/ui';
import { colors, space, radius, maxContentWidth } from '@/constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Fires once with the raw payload. The caller hashes it. */
  onScanned: (payload: string) => void;
}

/**
 * Native QR capture.
 *
 * Web uploads a screenshot and decodes it with jsQR; on a phone the ticket is
 * usually on the same device, so scanning is both easier and avoids shipping an
 * image decoder. The payload is handed straight to the caller and hashed there
 * -- it is never stored or sent anywhere raw.
 */
export function QrScannerModal({ visible, onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  // onBarcodeScanned fires continuously while the code is in frame.
  const handled = useRef(false);

  const handleScan = ({ data }: { data: string }) => {
    if (handled.current || !data) return;
    handled.current = true;
    onScanned(data);
  };

  const close = () => {
    handled.current = false;
    setTorch(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.container}>
        {!permission ? (
          <View style={styles.centre}>
            <Text variant="small" tone="muted">
              Checking camera…
            </Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.centre}>
            <Text variant="title">Camera access needed</Text>
            <Text variant="small" tone="muted" style={styles.body}>
              SellWant reads the QR on your ticket to check it hasn&apos;t already
              been listed. The image never leaves your phone.
            </Text>
            {permission.canAskAgain ? (
              <Button title="Allow camera" onPress={requestPermission} style={styles.action} />
            ) : (
              <Text variant="caption" tone="subtle" style={styles.body}>
                Enable camera access for SellWant in your device settings.
              </Text>
            )}
            <Button title="Cancel" variant="ghost" onPress={close} style={styles.action} />
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleScan}
            />

            {/* Aiming frame. Purely a cue -- the scanner reads the whole frame. */}
            <View style={styles.overlay} pointerEvents="box-none">
              <View style={styles.reticle} />
              <Text variant="small" tone="default" style={styles.hint}>
                Point at the QR on your ticket
              </Text>
            </View>

            <View style={styles.controls} pointerEvents="box-none">
              <Pressable onPress={() => setTorch((t) => !t)} style={styles.control}>
                <Text variant="small">{torch ? 'Torch off' : 'Torch on'}</Text>
              </Pressable>
              <Pressable onPress={close} style={styles.control}>
                <Text variant="small">Cancel</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[6],
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  body: { textAlign: 'center', marginTop: space[3] },
  action: { marginTop: space[5] },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reticle: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: colors.foreground,
    borderRadius: radius['2xl'],
    backgroundColor: 'transparent',
  },
  hint: { marginTop: space[5] },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space[10],
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space[3],
  },
  control: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
  },
});

export default QrScannerModal;
