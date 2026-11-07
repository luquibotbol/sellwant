#!/usr/bin/env python3
"""Real fixed-local SQL/REST/race checks of sandbox payment authority.

Run after manager applies migration 005: python3 scripts/test-deal-payments-local.py
Synthetic provider receipts exercise the ledger; they are NOT real PayPal proof.
No migration application, provider call, production target or real human approval.
"""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_test', ROOT / 'scripts/hackathon-local-test.py')
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)
MERCHANT = 'SYNTHETICMERCHANT'
ORIGIN = 'http://127.0.0.1:55677'
DENIED = (400, 401, 403, 404)


def deal(f):
    return f"INSERT INTO public.lock_ins(id,listing_id,buyer_id,seller_id,locked_price_cents) VALUES('{f['deal']}','{f['listing']}','{f['buyer']}','{f['owner']}',1665);"


def claim(f, action='create', actor='buyer', key='result', merchant=MERCHANT, seller=None, origin=ORIGIN, dbrole='service_role'):
    actor_sql = 'NULL' if actor is None else t.q(f[actor])
    return t.save('public.claim_deal_payment(' + ','.join((t.q(f['deal']), actor_sql, t.q(action),
        t.q(seller or f['owner']), t.q(merchant), t.q(origin))) + ')', key=key, dbrole=dbrole)


def record(f, kind, resource, lease='lease', key='result'):
    return t.save(f"public.record_deal_payment_resource('{f['deal']}',({t.value(lease)}->>'lease_token')::uuid,{t.q(kind)},{t.q(resource)})", key=key)


def finish(f, result, lease='lease', key='result'):
    expression = result if isinstance(result, str) else t.q(json.dumps(result)) + '::jsonb'
    return t.save(f"public.finish_deal_payment('{f['deal']}',({t.value(lease)}->>'lease_token')::uuid,{expression})", key=key)


def handoff(f, who='buyer', confirmed='true', dbrole='authenticated'):
    return t.save(f"public.confirm_deal_payment_handoff('{f['deal']}',{confirmed})", user=f.get(who, ''), dbrole=dbrole)


def ensure():
    return "DO $setup$ BEGIN IF current_setting('swtest.attempt',true) IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'synthetic payment setup failed'; END IF; END $setup$;"


def created(f):
    return (deal(f) + claim(f, key='lease') + ensure() + record(f, 'order', 'LOCALORDER') + ensure()
        + finish(f, {'status': 'approval_required', 'provider_status': 'CREATED', 'approval_url': 'https://www.sandbox.paypal.com/checkoutnow?token=LOCALORDER'}) + ensure())


def authorized(f):
    return (created(f) + claim(f, 'authorize', key='lease') + ensure() + record(f, 'authorization', 'LOCALAUTH') + ensure()
        + finish(f, "jsonb_build_object('status','authorized','provider_status','CREATED','authorization_expires_at',clock_timestamp()+interval '1 day')") + ensure())


def ready(f):
    return authorized(f) + handoff(f, 'buyer') + ensure() + handoff(f, 'owner') + ensure()


def inspect(f):
    return f"""'attempt',current_setting('swtest.attempt',true),'result',{t.value()},
      'first',{t.value('first')},'lease',{t.value('lease')},
      'payment',(SELECT jsonb_build_object('status',status,'amount',amount_cents,'pending',pending_operation,
        'lease_action',lease_action,'order',order_id,'authorization',authorization_id,'capture',capture_id,
        'buyer_handoff',buyer_handoff_at,'seller_handoff',seller_handoff_at,'requested',capture_requested_at,
        'expiry',authorization_expires_at,'payload',create_payload) FROM public.deal_payments WHERE deal_id='{f['deal']}'),
      'deal_state',(SELECT state FROM public.lock_ins WHERE id='{f['deal']}'),
      'listing_state',(SELECT status FROM public.listings WHERE id='{f['listing']}'),
      'emails',(SELECT count(*) FROM public.email_outbox WHERE listing_id='{f['listing']}' AND kind='deal_payment')"""


def denied(r, _):
    t.must(r['attempt'] != 'ok')


def try_null_expiry(f):
    return f"""DO $attempt$ BEGIN
      BEGIN UPDATE public.deal_payments SET authorization_expires_at=NULL WHERE deal_id='{f['deal']}';
        PERFORM set_config('swtest.attempt','ok',true);
      EXCEPTION WHEN check_violation THEN PERFORM set_config('swtest.attempt',SQLSTATE,true); END;
      END $attempt$;"""


def sql_cases(h):
    check = lambda label, build, verify: h.sql(label, build, verify, inspect)
    for dbrole in ('anon', 'authenticated'):
        check(dbrole + ' cannot claim privileged payment lease', lambda f, dbrole=dbrole: deal(f) + claim(f, dbrole=dbrole),
              lambda r, f: t.must(r['attempt'] != 'ok' and r['payment'] is None))
    for actor in ('owner', 'other'):
        check(actor + ' cannot create buyer payment', lambda f, actor=actor: deal(f) + claim(f, actor=actor),
              lambda r, f: t.must(r['attempt'] != 'ok' and r['payment'] is None))
    check('synthetic seller mapping is mandatory', lambda f: deal(f) + claim(f, seller=f['other']),
          lambda r, _: t.must(r['attempt'] != 'ok' and r['payment'] is None))
    for origin in ('https://sellwant.com', 'https://www.sellwant.com', 'http://example.com', 'https://user:pass@example.com', ORIGIN + '/path'):
        check('invalid or production callback origin rejected: ' + origin, lambda f, origin=origin: deal(f) + claim(f, origin=origin),
              lambda r, _: t.must(r['attempt'] != 'ok' and r['payment'] is None))
    check('payment creation persists exact cents merchant and complete callback payload before IO', lambda f: deal(f) + claim(f),
          lambda r, f: t.must(r['attempt'] == 'ok' and r['result']['amount_cents'] == 1665
            and r['result']['create_payload']['intent'] == 'AUTHORIZE'
            and r['result']['create_payload']['purchase_units'][0]['amount'] == {'currency_code': 'USD', 'value': '16.65'}
            and r['result']['create_payload']['purchase_units'][0]['payee']['merchant_id'] == MERCHANT
            and r['result']['create_payload']['payment_source']['paypal']['experience_context']['return_url'] == ORIGIN + '/deal/' + f['deal']))
    check('duplicate create is busy with one persisted payment', lambda f: deal(f) + claim(f, key='lease') + claim(f),
          lambda r, _: t.must(r['result'] == {'busy': True} and r['payment']['pending'] == 'create'))
    check('create retry retains callback payload and request ID after configured origin change', lambda f: deal(f) + claim(f, key='first')
        + f"UPDATE public.deal_payments SET lease_until=clock_timestamp()-interval '1 second' WHERE deal_id='{f['deal']}';"
        + claim(f, 'reconcile', key='result', origin='https://isolated-new.example'),
        lambda r, f: t.must(r['result']['create_payload'] == r['first']['create_payload']
            and r['result']['create_request_id'] == r['first']['create_request_id']
            and r['result']['lease_action'] == 'reconcile' and r['result']['pending_operation'] == 'create'))
    check('immutable merchant cannot change across retries', lambda f: created(f) + claim(f, merchant='OTHERMERCHANT'), denied)
    check('legacy paid claim cannot bypass payment verification', lambda f: created(f) + t.role(f['buyer'], f"PERFORM public.advance_deal('{f['deal']}','paid');"),
          lambda r, _: t.must(r['attempt'] != 'ok' and r['deal_state'] == 'pending_payment'))
    check('legacy cancel cannot unlock a payment with unresolved provider state', lambda f: deal(f) + claim(f, key='lease')
        + finish(f, {'status': 'unknown'}) + t.role(f['buyer'], f"PERFORM public.advance_deal('{f['deal']}','cancelled');"),
        lambda r, _: t.must(r['attempt'] != 'ok' and r['payment']['status'] == 'unknown' and r['deal_state'] == 'pending_payment'))
    check('human cannot attest handoff before verified authorization', lambda f: created(f) + handoff(f), denied)
    check('false handoff confirmation is denied', lambda f: authorized(f) + handoff(f, confirmed='false'), denied)
    check('outsider cannot attest another deal handoff', lambda f: authorized(f) + handoff(f, who='other'), denied)
    check('anon agent transport cannot attest human handoff', lambda f: authorized(f) + handoff(f, who='', dbrole='anon'), denied)
    check('authorization without known expiry cannot become a usable hold', lambda f: created(f) + claim(f, 'authorize', key='lease')
        + record(f, 'authorization', 'LOCALAUTH') + finish(f, {'status': 'authorized', 'provider_status': 'CREATED'}),
        lambda r, _: t.must(r['attempt'] != 'ok' and r['payment']['status'] == 'approval_required'))
    check('authorized ledger cannot lose its known hold expiry', lambda f: authorized(f) + try_null_expiry(f),
          lambda r, _: t.must(r['attempt'] == '23514' and r['payment']['expiry'] is not None))
    check('one human handoff cannot authorize capture', lambda f: authorized(f) + handoff(f) + claim(f, 'capture'),
          lambda r, _: t.must(r['attempt'] != 'ok' and r['payment']['requested'] is None))
    check('both handoffs are immutable on repeat confirmation', lambda f: ready(f)
        + t.save(f"public.get_deal_payment('{f['deal']}')", key='first', user=f['buyer'], dbrole='authenticated')
        + handoff(f) + t.save(f"public.get_deal_payment('{f['deal']}')", user=f['buyer'], dbrole='authenticated'),
        lambda r, _: t.must(r['attempt'] == 'ok' and r['first']['payment']['buyer_handoff_at'] == r['result']['payment']['buyer_handoff_at']))
    check('expired authorization rejects capture after both handoffs', lambda f: ready(f)
        + f"UPDATE public.deal_payments SET authorization_expires_at=clock_timestamp()-interval '1 second' WHERE deal_id='{f['deal']}';" + claim(f, 'capture'), denied)
    check('both handoffs cannot bypass ledger expiry constraint', lambda f: ready(f) + try_null_expiry(f),
          lambda r, _: t.must(r['attempt'] == '23514' and r['payment']['requested'] is None))
    for who in ('buyer', 'owner'):
        check('suspended ' + who + ' blocks capture', lambda f, who=who: ready(f)
            + f"UPDATE public.profiles SET is_suspended=true WHERE id='{f[who]}';" + claim(f, 'capture'), denied)
    check('capture claim serializes opposing cancellation', lambda f: ready(f) + claim(f, 'capture', key='lease') + claim(f, 'cancel'),
          lambda r, _: t.must(r['result'] == {'busy': True} and r['payment']['pending'] == 'capture'))
    check('unknown capture prohibits cancel after lease expiry', lambda f: ready(f) + claim(f, 'capture', key='lease')
        + finish(f, {'status': 'unknown'}) + claim(f, 'cancel'),
        lambda r, _: t.must(r['result'] == {'reconciliation_required': True} and r['payment']['pending'] == 'capture'
            and r['deal_state'] == 'pending_payment'))
    check('recovery of unknown capture retains original capture UUID and operation', lambda f: ready(f)
        + claim(f, 'capture', key='first') + finish(f, {'status': 'unknown'}, lease='first')
        + claim(f, 'recover', actor=None),
        lambda r, _: t.must(r['result']['lease_action'] == 'reconcile' and r['result']['pending_operation'] == 'capture'
            and r['result']['capture_request_id'] == r['first']['capture_request_id']))
    check('stale resource write is fenced after lease takeover', lambda f: deal(f) + claim(f, key='lease')
        + f"UPDATE public.deal_payments SET lease_until=clock_timestamp()-interval '1 second' WHERE deal_id='{f['deal']}';"
        + claim(f, 'recover', actor=None, key='first') + record(f, 'order', 'STALEORDER'),
        lambda r, _: t.must(r['attempt'] != 'ok' and r['payment']['order'] is None))
    check('stale completion cannot unlock after lease takeover', lambda f: deal(f) + claim(f, key='lease')
        + f"UPDATE public.deal_payments SET lease_until=clock_timestamp()-interval '1 second' WHERE deal_id='{f['deal']}';"
        + claim(f, 'recover', actor=None, key='first') + finish(f, {'status': 'cancelled'}),
        lambda r, _: t.must(r['attempt'] != 'ok' and r['deal_state'] == 'pending_payment'))
    check('capture with incomplete provider status remains locked', lambda f: ready(f) + claim(f, 'capture', key='lease')
        + record(f, 'capture', 'LOCALCAPTURE') + finish(f, {'status': 'captured', 'provider_status': 'PENDING'}), denied)
    check('completed synthetic capture settles exact deal once', lambda f: ready(f) + claim(f, 'capture', key='lease')
        + record(f, 'capture', 'LOCALCAPTURE') + finish(f, {'status': 'captured', 'provider_status': 'COMPLETED'}) + ensure()
        + claim(f, 'capture'),
        lambda r, _: t.must(r['result'] == {'done': True} and r['payment']['status'] == 'captured'
            and r['deal_state'] == 'confirmed' and r['payment']['amount'] == 1665))
    check('verified void cancels and permits a new trade', lambda f: authorized(f) + claim(f, 'cancel', key='lease')
        + finish(f, {'status': 'cancelled', 'provider_status': 'VOIDED'}) + ensure(),
        lambda r, _: t.must(r['payment']['status'] == 'cancelled' and r['deal_state'] == 'cancelled' and r['listing_state'] == 'active'))
    check('unverified authorized cancellation cannot unlock', lambda f: authorized(f) + claim(f, 'cancel', key='lease')
        + finish(f, {'status': 'cancelled', 'provider_status': 'CREATED'}),
        lambda r, _: t.must(r['attempt'] != 'ok' and r['deal_state'] == 'pending_payment'))
    check('timeout recovery claims cancellation only for expired known state', lambda f: created(f)
        + f"UPDATE public.deal_payments SET expires_at=clock_timestamp()-interval '1 second' WHERE deal_id='{f['deal']}';"
        + claim(f, 'recover', actor=None),
        lambda r, _: t.must(r['result']['lease_action'] == 'cancel' and r['result']['pending_operation'] == 'cancel'))
    check('payment notifications dedupe status and repeated human handoffs', lambda f:
        f"UPDATE auth.users SET email_confirmed_at=now() WHERE id IN ('{f['owner']}','{f['buyer']}');" + ready(f) + handoff(f)
        + claim(f, 'capture', key='lease') + record(f, 'capture', 'LOCALCAPTURE')
        + finish(f, {'status': 'captured', 'provider_status': 'COMPLETED'}) + ensure() + claim(f, 'capture'),
        lambda r, _: t.must(r['result'] == {'done': True} and r['emails'] == 10))


def rest_cases(h):
    f = h.fixture()
    committed = False
    try:
        h.commit(f, created(f))
        committed = True
        buyer, seller, outsider = (h.jwt(f[x]) for x in ('buyer', 'owner', 'other'))
        body = {'p_deal_id': f['deal']}
        own = h.request('rpc/get_deal_payment', buyer, body)
        other_party = h.request('rpc/get_deal_payment', seller, body)
        h.check('actual REST buyer alone receives sandbox approval URL', own['payment']['approval_url'].startswith('https://www.sandbox.paypal.com/')
            and other_party['payment']['approval_url'] is None)
        for label, actor in (('outsider', outsider), ('anon', None)):
            h.request('rpc/get_deal_payment', actor, body, expected=DENIED)
            h.check('actual REST ' + label + ' cannot discover private payment')
        columns = 'deal_id,buyer_id,seller_id,amount_cents,currency,status,provider_status,authorization_expires_at,buyer_handoff_at,seller_handoff_at,capture_requested_at,expires_at,updated_at'
        path = 'deal_payments?select=' + columns + '&deal_id=eq.' + f['deal']
        h.check('actual REST participant column grants retain exact cents', h.request(path, buyer)[0]['amount_cents'] == 1665)
        h.check('actual REST outsider RLS hides payment row', h.request(path, outsider) == [])
        for selection in ('*', 'approval_url', 'create_payload', 'lease_token', 'create_request_id', 'merchant_id', 'order_id'):
            h.request('deal_payments?select=' + selection + '&deal_id=eq.' + f['deal'], buyer, expected=(401, 403))
            h.check('actual REST hides payment internal column ' + selection)
        for method, payload in (('PATCH', {'status': 'captured'}), ('DELETE', None), ('POST', {'deal_id': f['deal']})):
            h.request('deal_payments' + ('' if method == 'POST' else '?deal_id=eq.' + f['deal']), buyer, payload, method=method, expected=(401, 403))
            h.check('actual REST direct payment ' + method + ' denied')
        h.request('rpc/confirm_deal_payment_handoff', outsider, {**body, 'p_confirmed': True}, expected=DENIED)
        h.check('actual REST outsider cannot attest handoff')
        for name, payload in (
            ('claim_deal_payment', {**body, 'p_actor': f['buyer'], 'p_action': 'create', 'p_demo_seller_id': f['owner'], 'p_merchant_id': MERCHANT, 'p_app_origin': ORIGIN}),
            ('record_deal_payment_resource', {**body, 'p_lease_token': t.uid(), 'p_kind': 'order', 'p_resource_id': 'FORGEDORDER'}),
            ('finish_deal_payment', {**body, 'p_lease_token': t.uid(), 'p_result': {'status': 'captured', 'provider_status': 'COMPLETED'}}),
            ('due_deal_payments', {'p_limit': 10}),
        ):
            h.request('rpc/' + name, buyer, payload, expected=(401, 403))
            h.check('actual REST human denied service RPC ' + name)
        h.check('denied REST writes leave payment/deal unchanged', h.request('rpc/get_deal_payment', buyer, body) == own)
    finally:
        if committed:
            h.cleanup(f)


def race_cases(h):
    f = h.fixture()
    committed = False
    try:
        h.commit(f, ready(f))
        committed = True
        def compete(action):
            return t.parsed(h.db.sql('BEGIN;' + claim(f, action) + 'SELECT json_build_object(\'attempt\',current_setting(\'swtest.attempt\',true),\'result\',' + t.value() + '); COMMIT;'))
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(compete, ('capture', 'cancel')))
        leases = [r['result'] for r in results if r['attempt'] == 'ok' and isinstance(r['result'], dict) and 'lease_token' in r['result']]
        busy = [r['result'] for r in results if r['result'] == {'busy': True}]
        h.check('actual concurrent capture/cancel yields one financial lease', len(leases) == 1 and len(busy) == 1)
        h.check('losing financial action cannot change winning pending operation', h.db.sql(
            f"SELECT pending_operation='{leases[0]['lease_action']}' FROM public.deal_payments WHERE deal_id='{f['deal']}';").strip() == 't')
    finally:
        if committed:
            h.cleanup(f)


def main():
    args = t.arguments(__doc__)
    h = t.Harness('deal-payments-local', ('deal_payments',))
    if args.section in ('all', 'sql'):
        sql_cases(h)
    if args.section in ('all', 'rest'):
        rest_cases(h)
    if args.section in ('all', 'races'):
        race_cases(h)
    h.summary()


if __name__ == '__main__':
    main()
