import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Text, Button, Input } from '@/components/ui';
import { colors, space } from '@/constants/theme';
import { money } from '@/lib/format';
import { mandatePositiveInteger } from '@/lib/mandates';
import {
  type AgentMandate, type AgentDraftGeneration, type AgentDraftSuggestion, type AgentWatch,
  requestAgentDraft, issueAgentCapability, revokeAgentCapability,
  getAgentWatch, startAgentWatch, stopAgentWatch, resumeAgentWatch,
} from '@/services/data';

/** Generated terms are editable suggestions. Saving/approving remains in the
 * existing immutable mandate panel with the signed-in human's explicit click. */
export default function AgentDraft({ listingId, side, disabled, onUse }: {
  listingId: string; side: 'buy' | 'sell'; disabled: boolean;
  onUse: (proposal: AgentDraftSuggestion) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [generated, setGenerated] = useState<AgentDraftGeneration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  useEffect(() => () => { version.current++; }, []);
  if (process.env.EXPO_PUBLIC_AGENT_AI_ENABLED !== 'true') return null;
  const generate = async () => {
    if (busy || disabled) return;
    const current = ++version.current;
    setBusy(true); setError(null); setGenerated(null);
    try {
      const result = await requestAgentDraft({ listingId, side, instruction });
      if (current === version.current) setGenerated(result);
    } catch (e) {
      if (current === version.current) setError((e as Error).message);
    } finally { if (current === version.current) setBusy(false); }
  };
  return <View style={styles.section}>
    <Text variant="bodyMedium">Describe your terms</Text>
    <Text variant="small" tone="muted" style={styles.gap}>AI suggests a limit and duration for you to review. Include your exact USD limit. Keep contacts and ticket codes out.</Text>
    <Input label="Your request" value={instruction} multiline maxLength={1000} editable={!disabled && !busy}
      placeholder={side === 'buy' ? 'Buy for at most $18, for one hour, up to four rounds.' : 'Sell for at least $16, for one hour, up to four rounds.'}
      onChangeText={value => { setInstruction(value); setGenerated(null); }} containerStyle={styles.gap} />
    <Button title="Suggest terms with AI" onPress={generate} loading={busy} disabled={disabled || !instruction.trim()} variant="outline" block />
    {!!error && <Text variant="small" tone="destructive" accessibilityLiveRegion="polite" style={styles.gap}>{error}</Text>}
    {generated && <View style={styles.gap}>
      <Text variant="small">{generated.proposal.explanation}</Text>
      {!!generated.proposal.clarification && <Text variant="small" tone="muted" style={styles.gap}>{generated.proposal.clarification}</Text>}
      {generated.proposal.status === 'ready' && generated.proposal.bound_cents !== null && <>
        <Text variant="bodyMedium" style={styles.gap}>{side === 'buy' ? 'Maximum' : 'Minimum'} {money(generated.proposal.bound_cents)} USD</Text>
        <Text variant="small" tone="muted" style={styles.gap}>{generated.proposal.duration_minutes} minutes; {generated.proposal.max_rounds} rounds. Review and approve separately.</Text>
        <Button title="Use these suggested terms" variant="secondary" style={styles.gap} disabled={disabled}
          onPress={() => onUse(generated.proposal)} block />
      </>}
    </View>}
  </View>;
}

type WatchReview = { enrollmentKey: string; expiresAt: string };
/** A dedicated, short-lived capability is issued only after the human reviews
 * the exact approved mandate, scopes and watch deadline. It remains in memory
 * until encrypted by the service; no token is stored/logged by this component. */
export function AgentWatchControl({ mandate, revision, now, onChange }: {
  mandate: AgentMandate; revision: number; now: number; onChange: () => Promise<unknown>;
}) {
  const [watch, setWatch] = useState<AgentWatch | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<WatchReview | null>(null);
  const [minutes, setMinutes] = useState('60');
  const [uncertain, setUncertain] = useState(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const enabled = process.env.EXPO_PUBLIC_AGENT_WATCHER_ENABLED === 'true';
  const load = async () => {
    const current = ++sequence.current;
    try {
      const result = await getAgentWatch(mandate.id);
      if (alive.current && current === sequence.current) { setWatch(result); setLoaded(true); }
    } catch (e) {
      if (alive.current && current === sequence.current) setError((e as Error).message);
    }
  };
  useEffect(() => { if (enabled) void load(); }, [mandate.id, revision, enabled]);
  if (!enabled) return null;
  const available = mandate.status === 'approved' && Date.parse(mandate.expires_at) > now;
  const prepare = () => {
    setError(null);
    try {
      const duration = mandatePositiveInteger(minutes, 10080, 'Minutes');
      const expiresAt = new Date(Math.min(Date.now() + duration * 60000, Date.parse(mandate.expires_at))).toISOString();
      if (Date.parse(expiresAt) <= Date.now()) throw new Error('The approved mandate has expired.');
      setReview({ enrollmentKey: Crypto.randomUUID(), expiresAt });
    } catch (e) { setError((e as Error).message); }
  };
  const start = async () => {
    if (!review || busy || !available || uncertain) return;
    setBusy(true); setError(null);
    let issuedId: string | null = null;
    try {
      const issued = await issueAgentCapability({ mandateId: mandate.id,
        tools: ['get_mandate', 'get_deal', 'place_offer', 'accept_offer'], expiresAt: review.expiresAt });
      issuedId = issued.id;
      if (!alive.current) { await revokeAgentCapability(issued.id); return; }
      await startAgentWatch({ mandateId: mandate.id, capability: issued.token,
        enrollmentKey: review.enrollmentKey, expiresAt: review.expiresAt });
      if (alive.current) { setReview(null); await load(); await onChange(); }
    } catch {
      // Unknown enrollment may have committed. Revoke its dedicated token
      // first, then refresh metadata; never issue another blind replacement.
      let revoked = false;
      if (issuedId) try { await revokeAgentCapability(issuedId); revoked = true; } catch { /* owner review required */ }
      if (alive.current) {
        setUncertain(true); setReview(null);
        setError(revoked ? 'Watch setup was interrupted. Its new access was revoked. Refresh the mandate and review watch status.' :
          'Watch setup is uncertain. Refresh and revoke any newly issued access below before trying again.');
        await load(); await onChange();
      }
    } finally { if (alive.current) setBusy(false); }
  };
  const change = async (action: 'stop' | 'resume') => {
    if (!watch || busy) return;
    setBusy(true); setError(null);
    try {
      await (action === 'stop' ? stopAgentWatch(watch.id) : resumeAgentWatch(watch.id));
      if (alive.current) { await load(); await onChange(); }
    } catch (e) { if (alive.current) { setError((e as Error).message); await load(); } }
    finally { if (alive.current) setBusy(false); }
  };
  return <View style={styles.section}>
    <Text variant="bodyMedium">Background negotiation</Text>
    {!!error && <Text variant="small" tone="destructive" accessibilityLiveRegion="polite" style={styles.gap}>{error}</Text>}
    {watch ? <>
      <Text variant="small" style={styles.gap}>Watch {watch.state === 'active' && Date.parse(watch.expires_at) <= now ? 'expired' : watch.state}; until {new Date(watch.expires_at).toLocaleString()}.</Text>
      {!!watch.last_error && <Text variant="small" tone="muted" style={styles.gap}>
        {watch.last_error === 'account_required' ? 'The AI provider account requires attention. Resume after it is ready.' :
          watch.last_error === 'unknown' ? 'An action outcome is unknown. Its original operation is preserved for reconciliation.' :
          'The watcher needs review. Check the mandate, access and recent agent actions.'}
      </Text>}
      {watch.state === 'active' && <Button title="Stop this watch and revoke its access" variant="outline" style={styles.gap}
        loading={busy} onPress={() => change('stop')} block />}
      {watch.state === 'blocked' && available && Date.parse(watch.expires_at) > now && <>
        <Text variant="small" tone="muted" style={styles.gap}>Resume the same approved limit, permissions and deadline. Any uncertain action keeps its original operation.</Text>
        <Button title="Resume this reviewed watch" variant="outline" style={styles.gap} loading={busy} onPress={() => change('resume')} block />
        <Button title="Stop this watch and revoke its access" variant="ghost" style={styles.gap} disabled={busy} onPress={() => change('stop')} block />
      </>}
    </> : loaded && available && !uncertain ? <>
      <Input label="Watch duration (minutes)" value={minutes} keyboardType="number-pad" editable={!busy && !review}
        onChangeText={setMinutes} hint="Never later than this mandate's expiry." containerStyle={styles.gap} />
      {review ? <>
        <Text variant="small">{mandate.side === 'buy' ? 'Maximum' : 'Minimum'} {money(mandate.bound_cents)} USD; {mandate.max_rounds - mandate.rounds_used} rounds remain.</Text>
        <Text variant="small" tone="muted" style={styles.gap}>Allow this watch to read this mandate and its deal, post public offers and accept offers within these approved terms. Until {new Date(review.expiresAt).toLocaleString()}.</Text>
        <Text variant="small" tone="muted" style={styles.gap}>PayPal approval and both people's handoff confirmations stay separate human actions.</Text>
        <Button title="Start this reviewed watch" style={styles.gap} onPress={start} loading={busy} block />
        <Button title="Back" variant="ghost" style={styles.gap} onPress={() => setReview(null)} disabled={busy} block />
      </> : <Button title="Review background watch" variant="outline" onPress={prepare} disabled={busy} block />}
    </> : null}
    <Button title="Refresh watch status" variant="ghost" size="sm" style={styles.gap} onPress={load} disabled={busy} />
  </View>;
}
const styles = StyleSheet.create({
  section: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: space[4], paddingTop: space[4] },
  gap: { marginTop: space[3] },
});
