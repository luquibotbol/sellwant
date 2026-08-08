import React, { useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Text, Avatar } from '@/components/ui';
import { colors, space, radius } from '@/constants/theme';
import { pickAvatar, uploadAvatar } from '@/services/avatar';

interface Props {
  /** Current picture, if any. */
  uri: string | null;
  name?: string | null;
  /** Fires with the uploaded public URL. */
  onUploaded: (url: string) => void;
  size?: number;
  label?: string;
}

export function AvatarPicker({ uri, name, onUploaded, size = 96, label }: Props) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    try {
      const picked = await pickAvatar();
      if (!picked) return;
      // Show the local file immediately; the upload can take a moment on a
      // phone connection and a blank circle looks like a failure.
      setPreview(picked.uri);
      setBusy(true);
      onUploaded(await uploadAvatar(picked.base64));
    } catch (e: any) {
      setPreview(null);
      setError(e?.message ?? 'Could not upload that photo');
    } finally {
      setBusy(false);
    }
  };

  const shown = preview ?? uri;

  return (
    <View style={styles.wrap}>
      <Pressable onPress={choose} disabled={busy} style={styles.target}>
        <Avatar uri={shown} name={name} size={size} />
        {busy && (
          <View style={[styles.overlay, { width: size, height: size }]}>
            <ActivityIndicator color={colors.foreground} />
          </View>
        )}
        {!shown && !busy && (
          <View style={[styles.plus, { width: size, height: size }]}>
            <Text variant="display" tone="muted" style={styles.plusGlyph}>
              +
            </Text>
          </View>
        )}
      </Pressable>

      <Pressable onPress={choose} disabled={busy} hitSlop={8}>
        <Text variant="small" tone={shown ? 'muted' : 'want'} style={styles.label}>
          {busy ? 'Uploading…' : shown ? 'Change photo' : (label ?? 'Add a photo')}
        </Text>
      </Pressable>

      {!!error && (
        <Text variant="caption" tone="destructive" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  target: { position: 'relative' },
  overlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
  },
  plus: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  // The glyph sits high in its line box at display size.
  plusGlyph: { lineHeight: 40, marginTop: -2 },
  label: { marginTop: space[3] },
  error: { marginTop: space[2], textAlign: 'center' },
});

export default AvatarPicker;
