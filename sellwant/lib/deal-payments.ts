/** Public client contract. No provider credentials or agent capability belongs here. */
export type SandboxPaymentAction = 'create' | 'authorize' | 'handoff' | 'capture' | 'cancel' | 'reconcile';
export interface SandboxPayment {
  deal_id: string;
  status: 'creating' | 'approval_required' | 'authorized' | 'captured' | 'cancelled' | 'unknown';
  amount_cents: number;
  currency: 'USD';
  approval_url: string | null;
  provider_status: string | null;
  authorization_expires_at: string | null;
  buyer_handoff_at: string | null;
  seller_handoff_at: string | null;
  capture_requested_at: string | null;
  expires_at: string;
  updated_at: string;
}
export interface SandboxPaymentResponse { payment: SandboxPayment | null; eligible: boolean }
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions:SandboxPaymentAction[]=['create','authorize','handoff','capture','cancel','reconcile'];
export function sandboxApprovalUrl(value:string):string {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.hostname!=='www.sandbox.paypal.com' || url.username || url.password || url.port)
    throw new Error('Unexpected sandbox approval link');
  return url.toString();
}
export function paymentStage(payment:SandboxPayment|null):{title:string;body:string} {
  switch(payment?.status) {
    case 'creating':return {title:'Preparing sandbox checkout',body:'The order is being verified. Refresh its status before trying another action.'};
    case 'approval_required':return {title:'Buyer approval required',body:'The buyer approves the exact agreed price in PayPal sandbox. Approval alone does not place a hold or capture funds.'};
    case 'authorized':return {title:'Sandbox hold verified',body:'PayPal verified an authorization. Both people must confirm their test handoff, then request capture. Funds have not been captured.'};
    case 'captured':return {title:'Sandbox capture verified',body:'PayPal confirmed the exact agreed payment. The deal is complete.'};
    case 'cancelled':return {title:'Sandbox payment cancelled',body:'No funds were captured. Any authorization was verified voided or expired before the listing was released.'};
    case 'unknown':return {title:'Payment verification pending',body:'The provider outcome is uncertain. Keep this deal locked and reconcile its existing order before continuing.'};
    default:return {title:'Pay with PayPal sandbox',body:'This test checkout uses the locked deal price and the configured demo seller. It requires buyer approval, a verified hold and separate human handoff confirmations.'};
  }
}
export function availablePaymentActions(p:SandboxPayment|null,role:'buyer'|'seller',eligible:boolean):SandboxPaymentAction[] {
  if(!p)return eligible && role==='buyer'?['create']:[];
  if(['captured','cancelled'].includes(p.status))return [];
  if(p.status==='unknown' || p.status==='creating')return ['reconcile'];
  if(p.status==='approval_required')return role==='buyer'?['authorize','cancel','reconcile']:['cancel','reconcile'];
  const own=role==='buyer'?p.buyer_handoff_at:p.seller_handoff_at;
  const handoffs=!!(p.buyer_handoff_at && p.seller_handoff_at);
  return [...(!own?['handoff' as const]:[]),...(handoffs?['capture' as const]:[]),'cancel','reconcile'];
}
export async function fetchSandboxPayment(
  apiOrigin:string,accessToken:string,dealId:string,action?:SandboxPaymentAction,
  transport:typeof fetch=fetch,
):Promise<SandboxPaymentResponse> {
  if(!UUID.test(dealId) || !accessToken || action && !actions.includes(action))throw new Error('Invalid payment request');
  const base=new URL(apiOrigin);
  if(base.username || base.password || base.search || base.hash || base.pathname!=='/' ||
    !['https:','http:'].includes(base.protocol))throw new Error('Invalid payment service');
  const response=await transport(`${base.origin}/api/deal-payments/${dealId}`,{
    method:action?'POST':'GET',headers:{Authorization:`Bearer ${accessToken}`,...(action?{'content-type':'application/json'}:{})},
    ...(action?{body:JSON.stringify({action})}:{}),cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(60000),
  });
  if(!response.ok) {
    const errors:Record<string,string>={payment_busy:'Another payment action is running. Refresh after two minutes.',
      reconciliation_required:'Reconcile the existing payment before another action.',human_sign_in_required:'Sign in again to continue.',
      payment_action_rejected:'This action is unavailable for your role or the current payment state.',
      sandbox_payment_not_configured:'Sandbox checkout is unavailable.'};
    const data=await response.json().catch(()=>null);
    throw new Error(errors[data?.error] ?? 'Payment status is unavailable. Refresh before trying again.');
  }
  const data=await response.json();
  if(!data || typeof data.eligible!=='boolean' || !(data.payment===null || data.payment?.deal_id===dealId &&
      Number.isSafeInteger(data.payment.amount_cents) && data.payment.amount_cents>0 && data.payment.currency==='USD' &&
      ['creating','approval_required','authorized','captured','cancelled','unknown'].includes(data.payment.status)))
    throw new Error('Payment status is unavailable');
  if(data.payment?.approval_url)sandboxApprovalUrl(data.payment.approval_url);
  return data;
}
