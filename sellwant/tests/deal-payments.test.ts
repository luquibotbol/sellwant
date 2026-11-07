import {afterEach,describe,expect,test} from 'bun:test';
import {runPaymentLease,handleDealPayments,dealPaymentEmail,type PaymentLease,type PaymentResult,type PaymentStore} from '../worker/deal-payments';
import {availablePaymentActions,paymentStage,sandboxApprovalUrl,fetchSandboxPayment,type SandboxPayment} from '../lib/deal-payments';
import {fakePayPal,expected,orderId,authorizationId,captureId,sandboxEnv,response} from './paypal-fixtures';
import {sandboxOrderPayload} from '../worker/paypal';

const buyer='00000000-0000-4000-8000-000000000001',seller='00000000-0000-4000-8000-000000000002';
const deal='00000000-0000-4000-8000-000000000003';
function lease(action:PaymentLease['lease_action'],extra:Partial<PaymentLease>={}):PaymentLease {
  return {deal_id:expected.dealId,buyer_id:buyer,seller_id:seller,amount_cents:1665,currency:'USD',merchant_id:expected.merchantId,
    status:'authorized',order_id:orderId,authorization_id:authorizationId,capture_id:null,
    create_request_id:'10000000-0000-4000-8000-000000000001',authorize_request_id:'10000000-0000-4000-8000-000000000002',
    create_payload:sandboxOrderPayload(expected,{returnUrl:`http://127.0.0.1:8799/deal/${expected.dealId}`,cancelUrl:`http://127.0.0.1:8799/deal/${expected.dealId}`}),
    capture_request_id:'10000000-0000-4000-8000-000000000003',void_request_id:'10000000-0000-4000-8000-000000000004',
    pending_operation:action,operation_started_at:new Date().toISOString(),lease_token:'10000000-0000-4000-8000-000000000005',
    lease_until:new Date(Date.now()+120000).toISOString(),lease_action:action,
    buyer_handoff_at:null,seller_handoff_at:null,capture_requested_at:null,
    expires_at:new Date(Date.now()+3600000).toISOString(),authorization_expires_at:new Date(Date.now()+24*3600000).toISOString(),...extra};
}
function store() {
  const resources:Record<string,string>={};const results:PaymentResult[]=[];
  const value:PaymentStore={record:async(kind,id)=>{if(resources[kind]&&resources[kind]!==id)throw new Error('association mismatch');resources[kind]=id;},
    finish:async result=>{results.push(result);}};
  return {resources,results,value};
}
function approved() {const f=fakePayPal();f.state.approved=true;f.state.authorized=true;return f;}
const handoffs={buyer_handoff_at:new Date().toISOString(),seller_handoff_at:new Date().toISOString(),capture_requested_at:new Date().toISOString()};

describe('durable app payment orchestration (provider fixtures, not live proof)',()=>{
  test('create uses the persisted UUID and records returned ID before completion',async()=>{
    const f=fakePayPal(),s=store(),p=lease('create',{order_id:null,authorization_id:null,status:'creating'});
    const result=await runPaymentLease(p,s.value,f.client());
    expect(result.status).toBe('approval_required');expect(s.resources.order).toBe(orderId);
    const post=f.calls.find(c=>c.url.endsWith('/orders')&&c.init.method==='POST');
    expect((post!.init.headers as Record<string,string>)['PayPal-Request-Id']).toBe(p.create_request_id);
    expect(f.state.authorizeCalls+f.state.captureCalls).toBe(0);
  });
  test('integrated checkout returns only to its exact isolated deal path; CLI default stays intact',async()=>{
    const f=fakePayPal(),s=store(),p=lease('create',{order_id:null,authorization_id:null,status:'creating'});
    const callback=`http://127.0.0.1:8799/deal/${expected.dealId}`;
    await runPaymentLease(p,s.value,f.client());
    const post=f.calls.find(c=>c.url.endsWith('/orders')&&c.init.method==='POST');
    expect(JSON.parse(String(post!.init.body)).payment_source.paypal.experience_context.return_url).toBe(callback);
    for(const invalid of [`https://sellwant.com/deal/${expected.dealId}`,`${callback}?redirect=https://evil.test`,`${callback}#x`,
      `http://user@127.0.0.1:8799/deal/${expected.dealId}`,`http://127.0.0.1:8799/deal/other`]) {
      const provider=fakePayPal();
      await expect(provider.client().createOrder(expected,p.create_request_id,{returnUrl:invalid,cancelUrl:invalid})).rejects.toThrow();
      expect(provider.calls).toHaveLength(0);
    }
    const mismatch=fakePayPal();
    await expect(mismatch.client().createOrder(expected,p.create_request_id,{returnUrl:callback,cancelUrl:`http://localhost:8799/deal/${expected.dealId}`})).rejects.toThrow('same app origin');
  });
  test('persisted create payload ignores environment changes and rejects changed amount/payee/callbacks',async()=>{
    const f=fakePayPal(),s=store(),p=lease('reconcile',{order_id:null,authorization_id:null,pending_operation:'create',status:'unknown'});
    await runPaymentLease(p,s.value,f.client());
    const post=f.calls.find(c=>c.url.endsWith('/orders')&&c.init.method==='POST');
    expect(JSON.parse(String(post!.init.body))).toEqual(p.create_payload);
    for(const kind of ['price','payee','extra','callback'] as const){
      const changed=structuredClone(p.create_payload);
      if(kind==='price')changed.purchase_units[0].amount.value='16.66';
      if(kind==='payee')changed.purchase_units[0].payee.merchant_id='OTHER';
      if(kind==='extra')Object.assign(changed,{untrusted:'field'});
      if(kind==='callback')changed.payment_source.paypal.experience_context.return_url+='?redirect=evil';
      const provider=fakePayPal();
      await expect(provider.client().createOrderFromPayload(expected,p.create_request_id,changed)).rejects.toThrow();
      expect(provider.calls).toHaveLength(0);
    }
  });
  test('missing, invalid or expired provider authorization expiry is unknown and never captures',async()=>{
    for(const expiration_time of [undefined,'invalid',new Date(Date.now()-1000).toISOString()]){
      const f=approved(),s=store();
      f.intercept((url,init)=>url.endsWith(`/authorizations/${authorizationId}`)&&init.method==='GET'
        ?response({id:authorizationId,status:'CREATED',amount:{currency_code:'USD',value:'16.65'},expiration_time}):undefined);
      expect((await runPaymentLease(lease('reconcile'),s.value,f.client())).status).toBe('unknown');
      expect((await runPaymentLease(lease('capture',handoffs),s.value,f.client())).status).toBe('unknown');
      expect(f.state.captureCalls).toBe(0);
    }
  });
  test('missing or expired persisted hold expiry cannot dispatch capture',async()=>{
    for(const expiry of [null,'invalid',new Date(Date.now()-1000).toISOString()]){
      const f=approved(),s=store();
      expect((await runPaymentLease(lease('capture',{...handoffs,authorization_expires_at:expiry}),s.value,f.client())).status).toBe('unknown');
      expect(f.state.captureCalls).toBe(0);
    }
  });
  test('checkout approval alone does not create a handoff or capture',async()=>{
    const f=fakePayPal(),s=store();f.state.approved=true;
    const p=lease('authorize',{authorization_id:null,status:'approval_required'});
    const result=await runPaymentLease(p,s.value,f.client());
    expect(result.status).toBe('authorized');expect(s.resources.authorization).toBe(authorizationId);
    expect(p.buyer_handoff_at).toBeNull();expect(p.seller_handoff_at).toBeNull();expect(f.state.captureCalls).toBe(0);
  });
  test('unapproved checkout stays approval required without authorization POST',async()=>{
    const f=fakePayPal(),s=store();
    const result=await runPaymentLease(lease('authorize',{authorization_id:null,status:'approval_required'}),s.value,f.client());
    expect(result.status).toBe('approval_required');expect(f.state.authorizeCalls).toBe(0);
  });
  test('capture requires both persisted human attestations and the capture request',async()=>{
    for(const absent of ['buyer_handoff_at','seller_handoff_at','capture_requested_at'] as const){
      const f=approved(),s=store();
      expect((await runPaymentLease(lease('capture',{...handoffs,[absent]:null}),s.value,f.client())).status).toBe('unknown');
      expect(f.state.captureCalls).toBe(0);
    }
  });
  test('verified capture records ID before GET verification and uses original request UUID',async()=>{
    const f=approved(),s=store(),p=lease('capture',handoffs);
    f.intercept((url,init)=>{if(url.endsWith(`/captures/${captureId}`)&&init.method==='GET')expect(s.resources.capture).toBe(captureId);return undefined;});
    const result=await runPaymentLease(p,s.value,f.client());
    expect(result.status).toBe('captured');expect(f.state.captureCalls).toBe(1);
    expect((f.calls.find(c=>c.url.endsWith('/capture'))!.init.headers as Record<string,string>)['PayPal-Request-Id']).toBe(p.capture_request_id);
  });
  test('crash after capture before resource save reconciles from order, with no duplicate capture',async()=>{
    const f=approved(),s=store(),p=lease('capture',handoffs);
    const crash:PaymentStore={...s.value,record:async(kind,id)=>{if(kind==='capture')throw new Error('lost DB response');await s.value.record(kind,id);}};
    expect((await runPaymentLease(p,crash,f.client())).status).toBe('unknown');
    expect(f.state.captureCalls).toBe(1);
    expect((await runPaymentLease(lease('reconcile',{...handoffs,pending_operation:'capture'}),s.value,f.client())).status).toBe('captured');
    expect(f.state.captureCalls).toBe(1);
  });
  test('interrupted capture GET recovers by persisted capture ID even if order omits it',async()=>{
    const f=approved(),s=store(),p=lease('capture',handoffs);let unavailable=true;
    f.intercept((url,init)=>{
      if(url.endsWith(`/orders/${orderId}`)&&init.method==='GET'){const o=f.order();delete o.purchase_units[0].payments!.captures;return response(o);}
      if(url.endsWith(`/captures/${captureId}`)&&unavailable)return response({name:'SERVICE_UNAVAILABLE'},503);
      return undefined;
    });
    expect((await runPaymentLease(p,s.value,f.client())).status).toBe('unknown');expect(s.resources.capture).toBe(captureId);
    unavailable=false;
    expect((await runPaymentLease(lease('reconcile',{...handoffs,pending_operation:'capture',capture_id:captureId}),s.value,f.client())).status).toBe('captured');
    expect(f.state.captureCalls).toBe(1);
  });
  test('pending capture cannot be labeled captured and later completed read does not POST again',async()=>{
    const f=approved(),s=store();f.state.captureStatus='PENDING';
    expect((await runPaymentLease(lease('capture',handoffs),s.value,f.client())).status).toBe('unknown');
    f.state.captureStatus='COMPLETED';
    expect((await runPaymentLease(lease('reconcile',{...handoffs,pending_operation:'capture',capture_id:captureId}),s.value,f.client())).status).toBe('captured');
    expect(f.state.captureCalls).toBe(1);
  });
  test('a lost void response reconciles VOIDED before any repeated void',async()=>{
    const f=approved(),s=store();
    f.intercept((url,init)=>{if(url.endsWith('/void')&&init.method==='POST'){f.state.authorizationStatus='VOIDED';f.state.voidCalls++;throw new Error('lost response');}return undefined;});
    expect((await runPaymentLease(lease('cancel'),s.value,f.client())).status).toBe('unknown');
    f.intercept(undefined);
    expect((await runPaymentLease(lease('reconcile',{pending_operation:'cancel'}),s.value,f.client())).status).toBe('cancelled');
    expect(f.state.voidCalls).toBe(1);expect(f.state.captureCalls).toBe(0);
  });
  test('a contradictory cancel lease cannot oppose an unknown capture',async()=>{
    const f=approved(),s=store();
    expect((await runPaymentLease(lease('cancel',{pending_operation:'capture',...handoffs}),s.value,f.client())).status).toBe('unknown');
    expect(f.calls.length).toBe(0);
  });
  test('unknown create and capture never POST outside request retention',async()=>{
    for(const action of ['create','capture'] as const){
      const f=approved(),s=store();const p=lease('reconcile',{pending_operation:action,...handoffs,...(action==='create'?{order_id:null,authorization_id:null}:{})});
      expect((await runPaymentLease(p,s.value,f.client(),()=>Date.parse(p.operation_started_at)+6*3600000)).status).toBe('unknown');
      expect(f.state.createCalls+f.state.captureCalls).toBe(0);
    }
  });
  test('provider mismatch stays unknown and does not void/capture/unlock',async()=>{
    const f=approved(),s=store();f.intercept((url)=>{if(url.endsWith(`/orders/${orderId}`)){const o=f.order();o.purchase_units[0].amount.value='99.99';return response(o);}return undefined;});
    expect((await runPaymentLease(lease('cancel'),s.value,f.client())).status).toBe('unknown');
    expect(f.state.voidCalls+f.state.captureCalls).toBe(0);expect(s.results[0].status).toBe('unknown');
  });
  test('no-authorization cancellation requires a nonfinancial provider order state',async()=>{
    const f=fakePayPal(),s=store();f.intercept(url=>{if(url.endsWith(`/orders/${orderId}`)){const o=f.order();o.status='COMPLETED';return response(o);}return undefined;});
    expect((await runPaymentLease(lease('cancel',{authorization_id:null}),s.value,f.client())).status).toBe('unknown');
  });
  test('completion write failure preserves the exception for lease recovery',async()=>{
    const f=approved(),s=store();
    await expect(runPaymentLease(lease('capture',handoffs),{...s.value,finish:async()=>{throw new Error('lease lost');}},f.client())).rejects.toThrow('lease lost');
    expect(f.state.captureCalls).toBe(1);
  });
});

const publicPayment:SandboxPayment={deal_id:deal,status:'authorized',amount_cents:1665,currency:'USD',approval_url:null,provider_status:'CREATED',
  authorization_expires_at:null,buyer_handoff_at:null,seller_handoff_at:null,capture_requested_at:null,expires_at:new Date().toISOString(),updated_at:new Date().toISOString()};
describe('payment UI public contract',()=>{
  test('role-aware actions keep handoff and capture distinct',()=>{
    expect(availablePaymentActions(null,'seller',true)).toEqual([]);
    expect(availablePaymentActions(null,'buyer',true)).toEqual(['create']);
    expect(availablePaymentActions(publicPayment,'buyer',true)).not.toContain('capture');
    expect(availablePaymentActions({...publicPayment,...handoffs},'seller',true)).toContain('capture');
    expect(availablePaymentActions({...publicPayment,status:'unknown'},'buyer',true)).toEqual(['reconcile']);
    expect(paymentStage({...publicPayment,status:'authorized'}).body).toContain('Funds have not been captured');
  });
  test('approval links are sandbox HTTPS only',()=>{
    expect(sandboxApprovalUrl('https://www.sandbox.paypal.com/checkoutnow?token=fixture')).toContain('sandbox.paypal.com');
    for(const url of ['https://www.paypal.com/checkoutnow','https://www.sandbox.paypal.com.evil.test','https://x@www.sandbox.paypal.com/'])expect(()=>sandboxApprovalUrl(url)).toThrow();
  });
  test('frontend sends human bearer in headers and validates immutable deal response',async()=>{
    let called=false;
    const transport=(async(url:unknown,init:RequestInit)=>{called=true;expect(String(url)).toBe(`http://127.0.0.1:8799/api/deal-payments/${deal}`);
      expect((init.headers as Record<string,string>).Authorization).toBe('Bearer human');expect(init.body).toBe('{"action":"reconcile"}');return response({payment:publicPayment,eligible:true});}) as typeof fetch;
    expect((await fetchSandboxPayment('http://127.0.0.1:8799','human',deal,'reconcile',transport)).payment?.deal_id).toBe(deal);expect(called).toBe(true);
    await expect(fetchSandboxPayment('http://127.0.0.1:8799','human',deal,undefined,(async()=>response({payment:{...publicPayment,deal_id:buyer},eligible:true})) as unknown as typeof fetch)).rejects.toThrow();
  });
  test('outbox renderer escapes untrusted title, distinguishes hold/capture and uses private deal link',()=>{
    const result=dealPaymentEmail({payload:{deal_id:deal,listing_title:'<script> & title',event:'authorized',amount_cents:1665,currency:'USD'}},'http://127.0.0.1:8799');
    expect(result.text).toContain('Funds have not been captured');expect(result.text).toContain(`/deal/${deal}`);
    expect(result.html).not.toContain('<script>');expect(result.html).toContain('&amp; title');
  });
});

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const anon=`e30.${btoa(JSON.stringify({role:'anon'}))}.signature`;
const env={...sandboxEnv,DEAL_PAYMENTS_ENABLED:'true',DEAL_PAYMENTS_ORIGIN:'http://127.0.0.1:8799',SUPABASE_URL:'http://127.0.0.1:55321',
  SUPABASE_ANON_KEY:anon,SUPABASE_SECRET_KEY:'fixture-admin',PAYPAL_DEMO_SELLER_ID:seller};
const request=(method='GET',action?:unknown)=>new Request(`${env.DEAL_PAYMENTS_ORIGIN}/api/deal-payments/${deal}`,{
  method,headers:{Authorization:'Bearer e30.human.signature',...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(action)}:{})});
describe('authenticated sandbox Worker boundary',()=>{
  test('disabled and production configurations never call any remote service',async()=>{
    globalThis.fetch=(()=>{throw new Error('unexpected fetch');}) as unknown as typeof fetch;
    expect((await handleDealPayments(request(),{...env,DEAL_PAYMENTS_ENABLED:'false'})).status).toBe(404);
    expect((await handleDealPayments(request(),{...env,SUPABASE_URL:'https://gguzeafbwsqkhggmcjjl.supabase.co'})).status).toBe(503);
    expect((await handleDealPayments(request(),{...env,PAYPAL_ENVIRONMENT:'LIVE'})).status).toBe(503);
  });
  test('agent capabilities and cross-origin requests cannot reach auth/service RPCs',async()=>{
    globalThis.fetch=(()=>{throw new Error('unexpected fetch');}) as unknown as typeof fetch;
    const capability=request();capability.headers.set('Authorization',`Bearer swcap_${'a'.repeat(64)}`);
    expect((await handleDealPayments(capability,env)).status).toBe(401);
    const cross=request('POST',{action:'capture'});cross.headers.set('origin','https://evil.test');
    expect((await handleDealPayments(cross,env)).status).toBe(403);
  });
  test('outsider fails human participant RPC before service-role access',async()=>{
    let calls=0;globalThis.fetch=(async(_url:unknown,init:RequestInit)=>{calls++;expect((init.headers as Record<string,string>).Authorization).not.toContain(env.SUPABASE_SECRET_KEY);
      return calls===1?response({id:buyer}):response({message:'private SQL text'},403);}) as typeof fetch;
    const result=await handleDealPayments(request('POST',{action:'cancel'}),env);
    expect(result.status).toBe(409);expect(await result.text()).not.toContain('private SQL');expect(calls).toBe(2);
  });
  test('GET reads only authenticated participant status and never provider/admin',async()=>{
    const urls:string[]=[];globalThis.fetch=(async(url:unknown,init:RequestInit)=>{urls.push(String(url));expect((init.headers as Record<string,string>).Authorization).toBe('Bearer e30.human.signature');
      return String(url).endsWith('/user')?response({id:buyer}):response({deal_id:deal,buyer_id:buyer,seller_id:seller,deal_state:'pending_payment',payment:publicPayment});}) as typeof fetch;
    const result=await handleDealPayments(request(),env);expect(result.status).toBe(200);expect(urls).toHaveLength(3);
    expect(await result.json()).toEqual({payment:publicPayment,eligible:true});
  });
  test('handoff uses the verified human JWT, never the service key',async()=>{
    const urls:string[]=[];globalThis.fetch=(async(url:unknown,init:RequestInit)=>{urls.push(String(url));expect((init.headers as Record<string,string>).Authorization).toBe('Bearer e30.human.signature');
      if(String(url).endsWith('/user'))return response({id:buyer});
      if(String(url).endsWith('/confirm_deal_payment_handoff')){expect(JSON.parse(String(init.body)).p_confirmed).toBe(true);return response(publicPayment);}
      return response({deal_id:deal,buyer_id:buyer,seller_id:seller,deal_state:'pending_payment',payment:publicPayment});}) as typeof fetch;
    expect((await handleDealPayments(request('POST',{action:'handoff'}),env)).status).toBe(200);
    expect(urls.some(url=>url.endsWith('/confirm_deal_payment_handoff'))).toBe(true);
  });
  test('a busy fenced payment returns conflict with no provider access',async()=>{
    let claims=0;globalThis.fetch=(async(url:unknown,init:RequestInit)=>{
      if(String(url).endsWith('/user'))return response({id:buyer});
      if(String(url).endsWith('/claim_deal_payment')){claims++;expect((init.headers as Record<string,string>).Authorization).toBe('Bearer fixture-admin');return response({busy:true});}
      if(String(url).endsWith('/get_deal_payment'))return response({deal_id:deal,buyer_id:buyer,seller_id:seller,deal_state:'pending_payment',payment:publicPayment});
      throw new Error('Unexpected provider request');}) as typeof fetch;
    expect((await handleDealPayments(request('POST',{action:'capture'}),env)).status).toBe(409);expect(claims).toBe(1);
  });
  test('a restarted Worker with a changed app origin replays the exact saved create body',async()=>{
    const changed={...env,DEAL_PAYMENTS_ORIGIN:'http://127.0.0.1:8899'};
    const initialOrigin=env.DEAL_PAYMENTS_ORIGIN;
    const saved=sandboxOrderPayload({...expected,dealId:deal},{returnUrl:`${initialOrigin}/deal/${deal}`,cancelUrl:`${initialOrigin}/deal/${deal}`});
    const persisted=lease('reconcile',{deal_id:deal,create_payload:saved,pending_operation:'create',order_id:null,authorization_id:null,status:'unknown'});
    let posted=false;
    globalThis.fetch=(async(url:unknown,init:RequestInit)=>{
      const target=String(url);
      if(target.endsWith('/auth/v1/user'))return response({id:buyer});
      if(target.endsWith('/get_deal_payment'))return response({deal_id:deal,buyer_id:buyer,seller_id:seller,deal_state:'pending_payment',payment:publicPayment});
      if(target.endsWith('/claim_deal_payment')){expect(JSON.parse(String(init.body)).p_app_origin).toBe(changed.DEAL_PAYMENTS_ORIGIN);return response(persisted);}
      if(target.endsWith('/record_deal_payment_resource')||target.endsWith('/finish_deal_payment'))return response(true);
      if(target.endsWith('/v1/oauth2/token'))return response({access_token:'fixture-token',expires_in:300});
      if(target==='https://api-m.sandbox.paypal.com/v2/checkout/orders'){
        posted=true;expect(JSON.parse(String(init.body))).toEqual(saved);
        expect((init.headers as Record<string,string>)['PayPal-Request-Id']).toBe(persisted.create_request_id);
        return response({id:orderId,status:'CREATED',intent:'AUTHORIZE',purchase_units:saved.purchase_units,
          links:[{rel:'payer-action',href:`https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`}]},201);
      }
      throw new Error('Unexpected fixture request');
    }) as typeof fetch;
    const req=new Request(`${changed.DEAL_PAYMENTS_ORIGIN}/api/deal-payments/${deal}`,{method:'POST',
      headers:{Authorization:'Bearer e30.human.signature','content-type':'application/json'},body:JSON.stringify({action:'reconcile'})});
    expect((await handleDealPayments(req,changed)).status).toBe(200);expect(posted).toBe(true);
  });
});
