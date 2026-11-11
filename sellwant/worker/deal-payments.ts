import {
  PayPalSandbox, PayPalError, PaymentVerificationError, approvalUrl,
  sandboxConfig, type SandboxEnvironment, type SandboxOrderPayload, type PaymentExpectation, type Order,
  type Authorization, type Capture,
} from './paypal';

export interface DealPaymentsEnv extends SandboxEnvironment {
  DEAL_PAYMENTS_ENABLED?: string;
  DEAL_PAYMENTS_ORIGIN?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  /** Explicit synthetic SellWant seller -> configured sandbox business. */
  PAYPAL_DEMO_SELLER_ID?: string;
}
type Config = { origin: string; database: string; anon: string; secret: string; seller: string; merchant: string };
type Action = 'create' | 'authorize' | 'capture' | 'cancel' | 'reconcile' | 'recover';
export interface PaymentLease {
  deal_id: string; buyer_id: string; seller_id: string; amount_cents: number; currency: 'USD'; merchant_id: string;
  status: string; order_id: string | null; authorization_id: string | null; capture_id: string | null;
  create_request_id: string; authorize_request_id: string; capture_request_id: string; void_request_id: string;
  create_payload:SandboxOrderPayload;
  pending_operation: Action; operation_started_at: string; lease_token: string; lease_until: string; lease_action: Action;
  buyer_handoff_at: string | null; seller_handoff_at: string | null; capture_requested_at: string | null;
  expires_at:string; authorization_expires_at:string|null;
}
export interface PaymentResult {
  status: 'approval_required' | 'authorized' | 'captured' | 'cancelled' | 'unknown';
  provider_status?: string;
  approval_url?: string;
  authorization_expires_at?: string;
}
export interface PaymentStore {
  record(kind: 'order' | 'authorization' | 'capture', id: string): Promise<void>;
  finish(result: PaymentResult): Promise<void>;
}
export type PaymentProvider = Pick<PayPalSandbox,
  'createOrderFromPayload' | 'getOrder' | 'authorize' | 'getAuthorization' | 'capture' | 'getCapture' | 'void'>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE = /^[A-Za-z0-9]{1,64}$/;
const ACTIONS = ['create','authorize','handoff','capture','cancel','reconcile'] as const;
class BoundaryError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function origin(value: string | undefined): URL {
  if (!value) throw new Error();
  const url = new URL(value);
  const local = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error();
  return url;
}
function configuration(env: DealPaymentsEnv): Config {
  sandboxConfig(env);
  const app = origin(env.DEAL_PAYMENTS_ORIGIN), database = origin(env.SUPABASE_URL);
  if (['sellwant.com','www.sellwant.com'].includes(app.hostname) || database.hostname === 'gguzeafbwsqkhggmcjjl.supabase.co' ||
      !env.SUPABASE_ANON_KEY || !env.SUPABASE_SECRET_KEY || !UUID.test(env.PAYPAL_DEMO_SELLER_ID ?? '') ||
      !RESOURCE.test(env.PAYPAL_MERCHANT_ID ?? '') || env.PAYPAL_ENVIRONMENT !== 'SANDBOX') throw new Error();
  // Fail closed if an admin key was accidentally supplied as the public key.
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.SUPABASE_ANON_KEY)) {
    const part = env.SUPABASE_ANON_KEY.split('.');
    if (part.length !== 3 || JSON.parse(atob(part[1].replace(/-/g,'+').replace(/_/g,'/'))).role !== 'anon') throw new Error();
  }
  return { origin: app.origin, database: database.origin, anon: env.SUPABASE_ANON_KEY,
    secret: env.SUPABASE_SECRET_KEY, seller: env.PAYPAL_DEMO_SELLER_ID!, merchant: env.PAYPAL_MERCHANT_ID! };
}
async function json(response: Response | Request, maximum = 64 * 1024): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) throw new Error();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset=0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function rpc(cfg: Config, name: string, args: Record<string,unknown>, humanToken?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${cfg.database}/rest/v1/rpc/${name}`, {
      method:'POST', headers:{apikey: humanToken ? cfg.anon : cfg.secret,
        Authorization:`Bearer ${humanToken ?? cfg.secret}`,'content-type':'application/json'},
      body:JSON.stringify(args),signal:AbortSignal.timeout(10000),credentials:'omit',redirect: 'manual',cache:'no-store',
    });
  } catch { throw new BoundaryError(503,'payment_unavailable'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new BoundaryError(response.status>=500 ? 503 : 409,
      response.status>=500 ? 'payment_unavailable' : 'payment_action_rejected');
  }
  try { return await json(response); } catch { throw new BoundaryError(503,'payment_unavailable'); }
}
async function human(cfg: Config, request: Request): Promise<{id:string;token:string}> {
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token || token.length>8192) throw new BoundaryError(401,'human_sign_in_required');
  let response: Response;
  try {
    response = await fetch(`${cfg.database}/auth/v1/user`, { headers:{apikey:cfg.anon,Authorization:`Bearer ${token}`},
      signal:AbortSignal.timeout(10000),credentials:'omit',redirect: 'manual',cache:'no-store' });
  } catch { throw new BoundaryError(503,'authentication_unavailable'); }
  if (!response.ok) { await response.body?.cancel(); throw new BoundaryError(response.status>=500?503:401,
    response.status>=500?'authentication_unavailable':'human_sign_in_required'); }
  const user = await json(response);
  if (!object(user) || typeof user.id!=='string' || !UUID.test(user.id)) throw new BoundaryError(401,'human_sign_in_required');
  return {id:user.id,token};
}
function checkedLease(value: unknown, cfg: Config, dealId: string): PaymentLease {
  if (!object(value) || value.deal_id!==dealId || value.seller_id!==cfg.seller || value.merchant_id!==cfg.merchant ||
      !Number.isSafeInteger(value.amount_cents) || (value.amount_cents as number)<=0 || value.currency!=='USD' ||
      !['create','authorize','capture','cancel','reconcile'].includes(String(value.lease_action)) ||
      !['create','authorize','capture','cancel','reconcile'].includes(String(value.pending_operation)) ||
      ['buyer_id','seller_id','lease_token','create_request_id','authorize_request_id','capture_request_id','void_request_id']
        .some(key=>typeof value[key]!=='string' || !UUID.test(value[key] as string)) ||
      !Number.isFinite(Date.parse(String(value.operation_started_at))) || !Number.isFinite(Date.parse(String(value.lease_until))) ||
      Date.parse(String(value.lease_until))<=Date.now() || !object(value.create_payload)) throw new BoundaryError(503,'payment_unavailable');
  for (const key of ['order_id','authorization_id','capture_id']) {
    if (value[key]!==null && (typeof value[key]!=='string' || !RESOURCE.test(value[key] as string))) throw new BoundaryError(503,'payment_unavailable');
  }
  return value as unknown as PaymentLease;
}

/** Provider results are verified by PayPalSandbox. Every mutation's UUID and
 * immutable expectation already exist in a fenced DB lease before this runs. */
export async function runPaymentLease(
  p: PaymentLease, store: PaymentStore, paypal: PaymentProvider, now = Date.now,
): Promise<PaymentResult> {
  const expected: PaymentExpectation = {dealId:p.deal_id,amountCents:p.amount_cents,currency:'USD',merchantId:p.merchant_id};
  const recent = () => now()-Date.parse(p.operation_started_at)<5*60*60*1000;
  const record = async (kind:'order'|'authorization'|'capture',id:string) => {
    await store.record(kind,id);
    if(kind==='order')p.order_id=id; else if(kind==='authorization')p.authorization_id=id; else p.capture_id=id;
  };
  const authorized = (auth:Authorization): PaymentResult => Number.isFinite(Date.parse(auth.expiration_time ?? ''))
    && Date.parse(auth.expiration_time!)>now()
    ?{status:'authorized',provider_status:auth.status,authorization_expires_at:auth.expiration_time!}
    :{status:'unknown',provider_status:auth.status};
  const captureResult = (capture:Capture):PaymentResult => ({status:capture.status==='COMPLETED'?'captured':'unknown',provider_status:capture.status});
  const handoff = () => !!(p.buyer_handoff_at && p.seller_handoff_at && p.capture_requested_at);
  const takeCapture = async ():Promise<PaymentResult> => {
    if (!p.order_id || !p.authorization_id || !handoff() || !recent()
      || !Number.isFinite(Date.parse(p.authorization_expires_at ?? '')) || Date.parse(p.authorization_expires_at!)<=now()
      || !Number.isFinite(Date.parse(p.expires_at)) || Date.parse(p.expires_at)<=now()) return {status:'unknown'};
    return captureResult(await paypal.capture(p.order_id,p.authorization_id,expected,p.capture_request_id,true,id=>record('capture',id)));
  };
  const takeCreate = async ():Promise<PaymentResult> => {
    if (!recent()) return {status:'unknown'};
    const order=await paypal.createOrderFromPayload(expected,p.create_request_id,p.create_payload);
    await record('order',order.id);
    return {status:'approval_required',provider_status:order.status,approval_url:approvalUrl(order)};
  };
  const inspect = async ():Promise<{order:Order;auth:Authorization|null;capture:Capture|null}> => {
    if (!p.order_id) throw new PaymentVerificationError('No persisted order');
    const order=await paypal.getOrder(p.order_id,expected);
    const auths=order.purchase_units[0].payments?.authorizations ?? [];
    const captures=order.purchase_units[0].payments?.captures ?? [];
    if(auths.length>1 || captures.length>1)throw new PaymentVerificationError('Unexpected multiple payment resources');
    if(auths.length)await record('authorization',auths[0].id);
    if(captures.length)await record('capture',captures[0].id);
    const auth=p.authorization_id?await paypal.getAuthorization(p.authorization_id,expected):null;
    const capture=p.capture_id && p.authorization_id
      ?await paypal.getCapture(p.capture_id,p.order_id,p.authorization_id,expected):null;
    return {order,auth,capture};
  };
  let result:PaymentResult;
  try {
    if(p.lease_action==='cancel' && p.pending_operation!=='cancel')throw new PaymentVerificationError('Conflicting pending operation');
    if(p.lease_action==='create')result=await takeCreate();
    else {
      // Missing create response: the identical request ID is the only allowed
      // mutation, within the conservative provider retention window.
      if(!p.order_id) {
        result=p.pending_operation==='create'?await takeCreate():{status:'unknown'};
      } else {
        const {order,auth,capture}=await inspect();
        if(capture) result=handoff()?captureResult(capture):{status:'unknown',provider_status:capture.status};
        else if(auth && ['VOIDED','EXPIRED','DENIED'].includes(auth.status))
          result={status:'cancelled',provider_status:auth.status};
        else if(auth && auth.status!=='CREATED') result={status:'unknown',provider_status:auth.status};
        else if(p.lease_action==='cancel' || p.lease_action==='reconcile' && p.pending_operation==='cancel') {
          if(auth) {
            const after=await paypal.void(p.order_id,p.authorization_id!,expected,p.void_request_id);
            result={status:after.status==='VOIDED'?'cancelled':'unknown',provider_status:after.status};
          } else result=['CREATED','APPROVED','PAYER_ACTION_REQUIRED','SAVED','VOIDED'].includes(order.status)
            ?{status:'cancelled',provider_status:order.status}:{status:'unknown',provider_status:order.status};
        } else if(p.lease_action==='capture' || p.lease_action==='reconcile' && p.pending_operation==='capture') {
          // Auth CREATED after an interrupted capture is not proof that a
          // capture can never arrive. Retry only that persisted capture UUID.
          result=auth?await takeCapture():{status:'unknown'};
        } else if(auth) result=authorized(auth);
        else if(p.lease_action==='authorize' || p.lease_action==='reconcile' && p.pending_operation==='authorize') {
          if(order.status==='APPROVED' && recent()) {
            const authorizedPayment=await paypal.authorize(p.order_id,expected,p.authorize_request_id);
            await record('authorization',authorizedPayment.id);
            result=authorizedPayment.status==='CREATED'?authorized(authorizedPayment):{status:'unknown',provider_status:authorizedPayment.status};
          } else if(['CREATED','PAYER_ACTION_REQUIRED','SAVED','APPROVED'].includes(order.status))
            result={status:'approval_required',provider_status:order.status,approval_url:approvalUrl(order)};
          else result={status:'unknown',provider_status:order.status};
        } else if(['CREATED','PAYER_ACTION_REQUIRED','SAVED','APPROVED'].includes(order.status))
          result={status:'approval_required',provider_status:order.status,approval_url:approvalUrl(order)};
        else result={status:'unknown',provider_status:order.status};
      }
    }
  } catch(error) {
    // A returned provider ID may already have been saved. Neither a network
    // failure nor a validation failure authorizes an opposing mutation.
    result={status:'unknown'};
    // Operator diagnostics only: provider status/issue/debug id or our own
    // check name. Never credentials, tokens, payloads or buyer data.
    console.log(`deal-payments: ${p.lease_action} -> unknown: ${error instanceof PayPalError
      ? `PayPal ${error.status} ${error.issue} ${error.debugId}` : error instanceof PaymentVerificationError
      ? `check failed: ${error.message.slice(0, 120)}` : 'unexpected error'}`);
    if(error instanceof PayPalError && !error.uncertain && error.issue==='PAYER_ACTION_REQUIRED')
      result={status:'approval_required',provider_status:'PAYER_ACTION_REQUIRED'};
  }
  await store.finish(result);
  return result;
}
async function perform(cfg:Config,env:DealPaymentsEnv,dealId:string,actor:string|null,action:Action) {
  const claimed=await rpc(cfg,'claim_deal_payment',{p_deal_id:dealId,p_actor:actor,p_action:action,
    p_demo_seller_id:cfg.seller,p_merchant_id:cfg.merchant,p_app_origin:cfg.origin});
  if(object(claimed) && (claimed.done===true || claimed.busy===true || claimed.reconciliation_required===true))return claimed;
  const payment=checkedLease(claimed,cfg,dealId);
  return runPaymentLease(payment,{
    record:async(kind,id)=>{ await rpc(cfg,'record_deal_payment_resource',{
      p_deal_id:dealId,p_lease_token:payment.lease_token,p_kind:kind,p_resource_id:id}); },
    finish:async(result)=>{ await rpc(cfg,'finish_deal_payment',{
      p_deal_id:dealId,p_lease_token:payment.lease_token,p_result:result}); },
  },new PayPalSandbox(env));
}
function reply(value:unknown,status=200) {
  return Response.json(value,{status,headers:{'cache-control':'no-store','vary':'Authorization, Origin',
    'x-content-type-options':'nosniff'}});
}
export async function handleDealPayments(request:Request,env:DealPaymentsEnv):Promise<Response> {
  if(env.DEAL_PAYMENTS_ENABLED!=='true')return reply({error:'not_found'},404);
  let cfg:Config;
  try { cfg=configuration(env); } catch { return reply({error:'sandbox_payment_not_configured'},503); }
  const url=new URL(request.url);
  if(url.origin!==cfg.origin || (request.headers.has('host') && request.headers.get('host')!==url.host) ||
    (request.headers.has('origin') && request.headers.get('origin')!==cfg.origin))return reply({error:'forbidden_origin'},403);
  const dealId=/^\/api\/deal-payments\/([0-9a-f-]{36})$/i.exec(url.pathname)?.[1].toLowerCase();
  if(!dealId || !UUID.test(dealId) || url.search || url.hash)return reply({error:'invalid_request'},400);
  if(!['GET','POST'].includes(request.method))return reply({error:'method_not_allowed'},405);
  try {
    const user=await human(cfg,request);
    // Human JWT/RLS participant check precedes service access, including for
    // nonexistent rows. This prevents an admin seam from becoming discovery.
    const context=await rpc(cfg,'get_deal_payment',{p_deal_id:dealId},user.token);
    if(!object(context) || context.deal_id!==dealId || ![context.buyer_id,context.seller_id].includes(user.id))
      throw new BoundaryError(404,'deal_unavailable');
    if(request.method==='POST') {
      let data:unknown;
      try { data=await json(request,4096); } catch { throw new BoundaryError(400,'invalid_request'); }
      if(!object(data) || Object.keys(data).length!==1 || !ACTIONS.includes(data.action as typeof ACTIONS[number]))
        throw new BoundaryError(400,'invalid_request');
      if(data.action==='handoff')await rpc(cfg,'confirm_deal_payment_handoff',{p_deal_id:dealId,p_confirmed:true},user.token);
      else {
        const outcome=await perform(cfg,env,dealId,user.id,data.action as Action);
        if(object(outcome) && outcome.busy===true)return reply({error:'payment_busy',retry_after_seconds:120},409);
        if(object(outcome) && outcome.reconciliation_required===true)return reply({error:'reconciliation_required'},409);
      }
    }
    const latest=await rpc(cfg,'get_deal_payment',{p_deal_id:dealId},user.token);
    if(!object(latest))throw new BoundaryError(503,'payment_unavailable');
    return reply({payment:latest.payment,eligible:latest.seller_id===cfg.seller && latest.deal_state==='pending_payment'});
  } catch(error) {
    return error instanceof BoundaryError?reply({error:error.code},error.status):reply({error:'payment_unavailable'},503);
  }
}

/** Existing scheduled handler calls this. Durable DB leases survive Worker
 * restarts; no in-memory loop and no unlock from an unknown provider outcome. */
export async function recoverDealPayments(env:DealPaymentsEnv):Promise<void> {
  if(env.DEAL_PAYMENTS_ENABLED!=='true')return;
  const cfg=configuration(env);
  const due=await rpc(cfg,'due_deal_payments',{p_limit:10});
  if(!Array.isArray(due) || due.some(id=>typeof id!=='string' || !UUID.test(id)))throw new Error('Payment recovery unavailable');
  for(const id of due) {
    try { await perform(cfg,env,id,null,'recover'); }
    catch { /* Persisted pending operation/lease remains recoverable. No IDs or secrets are logged. */ }
  }
}

export interface DealPaymentEmailRow {
  payload?:{deal_id?:string;listing_title?:string;event?:string;amount_cents?:number;currency?:string};
}
export function dealPaymentEmail(row:DealPaymentEmailRow,appOrigin:string) {
  const p=row.payload ?? {};
  if(!UUID.test(p.deal_id ?? '') || !Number.isSafeInteger(p.amount_cents) || p.currency!=='USD')throw new Error('Invalid payment notification');
  const messages:Record<string,string>={approval_required:'Buyer approval is required in PayPal sandbox.',
    authorized:'PayPal verified a sandbox authorization hold. Funds have not been captured.',
    handoff_confirmed:'A participant confirmed the test handoff. Both people must confirm before capture.',
    captured:'PayPal verified the sandbox payment capture.',cancelled:'This sandbox payment was cancelled without capture.',
    reconciliation_required:'The payment outcome needs verification. The deal stays locked while it is reconciled.'};
  const message=messages[p.event ?? '']; if(!message)throw new Error('Invalid payment notification');
  const title=(p.listing_title ?? 'Your deal').replace(/[\r\n<>]/g,' ').slice(0,100);
  const amount=`$${Math.floor(p.amount_cents!/100)}.${String(p.amount_cents!%100).padStart(2,'0')}`;
  const link=`${origin(appOrigin).origin}/deal/${p.deal_id}`;
  const escape=(s:string)=>s.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
  return {subject:`Sandbox payment: ${title}`,text:`${title} — ${amount} USD\n\n${message}\n\nReview deal: ${link}\n`,
    html:`<p>${escape(title)} — ${amount} USD</p><p>${message}</p><p><a href="${escape(link)}">Review deal</a></p>`};
}
