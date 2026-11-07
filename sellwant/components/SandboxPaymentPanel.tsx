import React,{useState} from 'react';
import {View,StyleSheet,Linking} from 'react-native';
import {Card,Text,Button,Badge} from '@/components/ui';
import {colors,space} from '@/constants/theme';
import {money} from '@/lib/format';
import {paymentStage,availablePaymentActions,sandboxApprovalUrl,type SandboxPaymentResponse,type SandboxPaymentAction} from '@/lib/deal-payments';
import {sandboxPaymentAction} from '@/services/data';

const labels:Record<SandboxPaymentAction,string>={create:'Prepare sandbox checkout',authorize:'Verify approval and authorize hold',
  handoff:'Confirm my test handoff',capture:'Request sandbox capture',cancel:'Cancel sandbox payment',reconcile:'Reconcile payment status'};
const confirms:Partial<Record<SandboxPaymentAction,string>>={
  handoff:'Only confirm after you personally completed the simulated handoff. PayPal approval does not confirm a handoff.',
  capture:'Both people confirmed the test handoff. This requests PayPal capture of the exact locked amount.',
  cancel:'Cancellation releases the listing only after the backend verifies no captured funds and voids any hold.',
};
export default function SandboxPaymentPanel({dealId,meId,role,status,onChanged,onRefresh}:{
  dealId:string;meId:string;role:'buyer'|'seller';status:SandboxPaymentResponse;onChanged:()=>void;onRefresh:()=>void;
}) {
  const [busy,setBusy]=useState<SandboxPaymentAction|null>(null);
  const [pending,setPending]=useState<SandboxPaymentAction|null>(null);
  const [error,setError]=useState<string|null>(null);
  const p=status.payment;
  const stage=paymentStage(p);
  const actions=availablePaymentActions(p,role,status.eligible);
  const run=async(action:SandboxPaymentAction)=>{
    if(confirms[action] && pending!==action){setPending(action);return;}
    setBusy(action);setError(null);
    try {await sandboxPaymentAction(dealId,action,meId);onChanged();}
    catch(e){setError(e instanceof Error?e.message:'Payment status is unavailable. Refresh before trying again.');}
    finally{setBusy(null);setPending(null);}
  };
  return <Card style={styles.card} accent={p?.status==='captured'?'want':undefined}>
    <Badge label="PAYPAL SANDBOX" variant="outline" />
    <Text variant="heading" style={styles.gap} accessibilityRole="header">{stage.title}</Text>
    <Text variant="small" tone="muted" style={styles.gap} accessibilityLiveRegion="polite">{stage.body}</Text>
    {!!p && <>
      <View style={styles.amount}><Text variant="bodyMedium">Exact agreed price</Text><Text variant="bodyMedium">{money(p.amount_cents)} USD</Text></View>
      <View style={styles.rail}>
        {['Approval','Hold','Handoff','Capture'].map((label,index)=>{
          const complete=index===0?['authorized','captured'].includes(p.status):index===1?['authorized','captured'].includes(p.status)
            :index===2?!!(p.buyer_handoff_at&&p.seller_handoff_at):p.status==='captured';
          return <View key={label} style={[styles.stage,complete&&styles.complete]}><Text variant="caption" tone={complete?'want':'subtle'}>{label}</Text></View>;
        })}
      </View>
      {p.status==='authorized' && <Text variant="small" tone="muted" style={styles.gap}>
        Buyer handoff: {p.buyer_handoff_at?'confirmed':'waiting'} · Seller handoff: {p.seller_handoff_at?'confirmed':'waiting'}
      </Text>}
      {!['captured','cancelled'].includes(p.status) && <Text variant="caption" tone="subtle" style={styles.gap}>Payment deadline: {new Date(p.expires_at).toLocaleString()}</Text>}
    </>}
    {role==='buyer' && p?.status==='approval_required' && !!p.approval_url && <Button title="Open PayPal sandbox approval" block style={styles.gap}
      disabled={!!busy} onPress={()=>{setError(null);Linking.openURL(sandboxApprovalUrl(p.approval_url!)).catch(()=>setError('Could not open PayPal. Try the approval button again.'));}} />}
    {actions.map(action=><Button key={action} title={pending===action?'Tap again to confirm':labels[action]} block
      variant={action==='cancel'?'outline':action==='reconcile'?'ghost':'default'} loading={busy===action}
      disabled={!!busy} style={styles.gap} onPress={()=>run(action)} />)}
    {!!pending && <Text variant="small" tone="muted" style={styles.gap}>{confirms[pending]}</Text>}
    {!!error && <Text variant="small" tone="destructive" accessibilityRole="alert" style={styles.gap}>{error}</Text>}
    <Button title="Refresh payment status" variant="ghost" block disabled={!!busy} style={styles.gap} onPress={onRefresh}/>
    <Text variant="caption" tone="subtle" style={styles.gap}>Synthetic sandbox payment. Payment verification does not establish ticket authenticity. Human handoff and provider capture are separate facts.</Text>
  </Card>;
}
const styles=StyleSheet.create({card:{marginTop:space[6]},gap:{marginTop:space[3]},amount:{marginTop:space[4],flexDirection:'row',justifyContent:'space-between',gap:space[3]},
  rail:{marginTop:space[4],flexDirection:'row',gap:space[2]},stage:{flex:1,borderTopWidth:2,borderTopColor:colors.border,paddingTop:space[2]},complete:{borderTopColor:colors.want}});
