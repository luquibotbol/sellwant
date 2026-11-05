import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text, Button, Input, Badge } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { AGENT_CAPABILITY_TOOLS, AgentCapabilityTool, mandatePositiveInteger } from '@/lib/mandates';
import {
  AgentMandate, AgentCapability, IssuedAgentCapability,
  getAgentCapabilities, issueAgentCapability, revokeAgentCapability,
} from '@/services/data';

type AccessReview = { tools: AgentCapabilityTool[]; expiresAt: string };
const label = (id: AgentCapabilityTool) => AGENT_CAPABILITY_TOOLS.find(tool => tool.id === id)?.label ?? id;

/** Only metadata persists. The raw token stays in memory until hidden/unmounted. */
export default function AgentAccess({ mandate, revision, now }: {
  mandate: AgentMandate; revision: number; now: number;
}) {
  const [rows, setRows] = useState<AgentCapability[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [tools, setTools] = useState<AgentCapabilityTool[]>(['get_mandate', 'get_deal']);
  const [minutes, setMinutes] = useState('15');
  const [review, setReview] = useState<AccessReview | null>(null);
  const [issued, setIssued] = useState<IssuedAgentCapability | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  const listVersion = useRef(0);
  const canIssue = mandate.status === 'approved' && Date.parse(mandate.expires_at) > now;
  const canUse = (mandate.status === 'approved' || mandate.status === 'consumed') && Date.parse(mandate.expires_at) > now;
  const visibleToken = issued && canUse && Date.parse(issued.expires_at) > now &&
    !rows.find(row => row.id === issued.id)?.revoked_at ? issued : null;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; listVersion.current++; };
  }, []);

  const load = async (offset = 0) => {
    const version = ++listVersion.current;
    setLoading(true);
    setListError(null);
    try {
      const page = await getAgentCapabilities(mandate.id, offset);
      if (!alive.current || version !== listVersion.current) return;
      setRows(current => offset === 0 ? page.rows : [...new Map([...current, ...page.rows].map(row => [row.id, row])).values()]);
      setNextOffset(page.nextOffset);
      setLoaded(true);
    } catch (e) {
      if (alive.current && version === listVersion.current) {
        setListError((e as { message?: string })?.message ?? 'Could not load access tokens.');
      }
    } finally {
      if (alive.current && version === listVersion.current) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [mandate.id, revision]);
  useEffect(() => {
    if (!canIssue) { setEditing(false); setReview(null); }
    if (!canUse) { setIssued(null); setRevealed(false); setNotice(null); }
  }, [canIssue, canUse]);
  useEffect(() => {
    if (issued && !visibleToken) { setIssued(null); setRevealed(false); setNotice(null); }
  }, [issued, visibleToken]);

  const prepare = () => {
    setError(null);
    try {
      if (!tools.length) throw new Error('Select at least one permission.');
      const duration = mandatePositiveInteger(minutes, 10080, 'Minutes');
      const expiresAt = new Date(Math.min(Date.now() + duration * 60000, Date.parse(mandate.expires_at))).toISOString();
      if (Date.parse(expiresAt) <= Date.now()) throw new Error('This mandate has expired.');
      setReview({ tools: [...tools], expiresAt });
    } catch (e) { setError((e as Error).message); }
  };

  const issue = async () => {
    if (!review || busy) return;
    setBusy('issue'); setError(null); setIssued(null); setRevealed(false); setNotice(null);
    try {
      const result = await issueAgentCapability({ mandateId: mandate.id, ...review });
      if (!alive.current) return;
      setIssued(result); setReview(null); setEditing(false);
      await load();
    } catch {
      if (alive.current) setError('Token could not be displayed. Refresh and revoke any new access entry before trying again.');
    } finally { if (alive.current) setBusy(null); }
  };

  const revoke = async (id: string) => {
    if (busy) return;
    setBusy(id); setError(null);
    try {
      await revokeAgentCapability(id);
      if (!alive.current) return;
      if (issued?.id === id) { setIssued(null); setRevealed(false); setNotice(null); }
      await load();
    } catch (e) {
      if (alive.current) setError((e as { message?: string })?.message ?? 'Could not revoke access.');
    } finally { if (alive.current) setBusy(null); }
  };

  const copy = async () => {
    if (!visibleToken) return;
    setNotice(null);
    try {
      await Clipboard.setStringAsync(visibleToken.token);
      if (alive.current) setNotice('Token copied.');
    } catch { if (alive.current) setNotice('Copy failed. Reveal the token to copy it manually.'); }
  };

  return (
    <View style={styles.section}>
      <Text variant="bodyMedium">Agent access</Text>
      <Text variant="small" tone="muted" style={styles.gap}>
        Choose what an agent can do with this mandate. Access ends at the selected time or when you revoke it.
      </Text>
      {!!error && <Text variant="small" tone="destructive" accessibilityLiveRegion="polite" style={styles.gap}>{error}</Text>}
      {visibleToken && (
        <View style={styles.box}>
          <Text variant="bodyMedium">New access token</Text>
          <Text variant="small" tone="muted" style={styles.gap}>
            Copy it to the agent you choose. It cannot be shown again after you hide it. Treat it like a password.
          </Text>
          <Input label="Access token" accessibilityLabel="New agent access token" value={visibleToken.token}
            secureTextEntry={!revealed} editable={false} autoCorrect={false} autoCapitalize="none"
            autoComplete="off" textContentType="none" importantForAutofill="no" containerStyle={styles.gap} />
          <Button title="Copy token" onPress={copy} disabled={!!busy} block />
          <Button title={revealed ? 'Mask token' : 'Reveal token'} variant="ghost" onPress={() => setRevealed(value => !value)} block />
          <Button title="Hide token" variant="outline" onPress={() => { setIssued(null); setRevealed(false); setNotice(null); }} block />
          <Button title="Revoke this token" variant="ghost" onPress={() => revoke(visibleToken.id)} disabled={!!busy}
            loading={busy === visibleToken.id} block />
          {!!notice && <Text variant="caption" accessibilityLiveRegion="polite" style={styles.gap}>{notice}</Text>}
        </View>
      )}
      {rows.map(row => {
        const status = row.revoked_at ? 'REVOKED' : Date.parse(row.expires_at) <= now ? 'EXPIRED'
          : !canUse ? 'INACTIVE' : mandate.status === 'consumed' ? 'DEAL LOCKED' : 'ACTIVE';
        return (
          <View key={row.id} style={styles.box}>
            <Badge label={status} variant="outline" />
            <Text variant="small" style={styles.gap}>{row.tools.map(label).join(' · ')}</Text>
            <Text variant="caption" tone="muted" style={styles.gap}>Until {new Date(row.expires_at).toLocaleString()}</Text>
            <Text variant="caption" tone="subtle" selectable style={styles.gap}>Access {row.id}</Text>
            {!row.revoked_at && <Button title="Revoke access" variant="outline" loading={busy === row.id}
              disabled={!!busy || loading} onPress={() => revoke(row.id)} style={styles.gap} block />}
          </View>
        );
      })}
      {loading && <Text variant="caption" tone="muted" style={styles.gap}>Loading access…</Text>}
      {!!listError && <>
        <Text variant="caption" tone="destructive" accessibilityLiveRegion="polite" style={styles.gap}>{listError}</Text>
        <Button title="Retry access list" variant="ghost" onPress={() => load()} disabled={loading || !!busy} block />
      </>}
      {!loading && !listError && loaded && rows.length === 0 && <Text variant="caption" tone="subtle" style={styles.gap}>No access tokens issued.</Text>}
      {nextOffset !== null && !listError && <Button title="Load more access tokens" variant="ghost"
        onPress={() => load(nextOffset)} disabled={loading || !!busy} style={styles.gap} block />}
      {canIssue && !editing && <Button title="Create agent access" variant="outline" onPress={() => { setEditing(true); setError(null); }}
        disabled={!!busy || loading} style={styles.gap} block />}
      {canIssue && editing && (
        <View style={styles.box}>
          {review ? <>
            <Text variant="bodyMedium">Review access</Text>
            <Text variant="small" style={styles.gap}>{review.tools.map(label).join(' · ')}</Text>
            <Text variant="small" style={styles.gap}>Until {new Date(review.expiresAt).toLocaleString()}</Text>
            <Text variant="small" tone="muted" style={styles.gap}>
              Anyone holding this token can use these permissions within your approved limits. It cannot approve a mandate, payment or handoff.
            </Text>
            <Button title="Issue token" onPress={issue} loading={busy === 'issue'} disabled={!!busy} style={styles.gap} block />
            <Button title="Edit access" variant="ghost" onPress={() => setReview(null)} disabled={!!busy} block />
          </> : <>
            {AGENT_CAPABILITY_TOOLS.map(tool => {
              const checked = tools.includes(tool.id);
              return <Pressable key={tool.id} accessibilityRole="checkbox" accessibilityLabel={tool.label}
                accessibilityState={{ checked, disabled: !!busy }} disabled={!!busy}
                onPress={() => setTools(current => checked ? current.filter(id => id !== tool.id) : [...current, tool.id])}
                style={[styles.permission, checked && styles.selected]}>
                <View style={styles.permissionHead}>
                  <Text variant="small">{tool.label}</Text>
                  <Text variant="caption" tone="muted">{checked ? 'Enabled' : 'Off'}</Text>
                </View>
                <Text variant="caption" tone="muted" style={styles.gap}>{tool.description}</Text>
              </Pressable>;
            })}
            <Input label="Access duration (minutes)" accessibilityLabel="Agent access duration in minutes" value={minutes}
              onChangeText={setMinutes} keyboardType="number-pad" editable={!busy} containerStyle={styles.gap}
              hint="Ends no later than this mandate’s expiry." />
            <Button title="Review access" onPress={prepare} disabled={!!busy} block />
          </>}
          <Button title="Close" variant="ghost" disabled={!!busy} onPress={() => { setEditing(false); setReview(null); }} block />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space[4], paddingTop: space[3], borderTopWidth: 1, borderTopColor: colors.border },
  gap: { marginTop: space[3] },
  box: { marginTop: space[3], padding: space[3], borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
  permission: { padding: space[3], borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: space[2] },
  selected: { borderColor: colors.borderStrong, backgroundColor: colors.muted },
  permissionHead: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: space[2] },
});
