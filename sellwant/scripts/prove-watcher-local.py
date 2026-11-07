#!/usr/bin/env python3
"""Real scheduled AI -> guarded trade proof on the fixed isolated local runtime.

python3 scripts/prove-watcher-local.py prepare
# The preparation client has exited. Wait for the separately owned scheduler.
python3 scripts/prove-watcher-local.py check
python3 scripts/prove-watcher-local.py cleanup

Synthetic SQL principals create/approve fixture mandates. This does NOT prove
human UI approval. The seller watch must independently generate a real OpenAI
proposal, discover the public buyer offer and lock one bounded deal. No payment,
handoff, provider-key access, manual scheduler tick or hosted deployment proof.
Never runs while another watch is active; coordinate with the manager first.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.local/ai/watcher-runtime-proof.json'
ORIGIN = 'http://127.0.0.1:8788'
TOOLS = ['get_mandate', 'get_deal', 'place_offer', 'accept_offer']
UUID = re.compile(r'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


t = module('watcher_proof_harness', 'hackathon-local-test.py')
runtime = module('watcher_proof_runtime', 'hackathon-runtime-local.py')


def save(value):
    PRIVATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(PRIVATE, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)
    PRIVATE.chmod(0o600)


def load():
    t.must(PRIVATE.is_file() and PRIVATE.stat().st_mode & 0o077 == 0, 'Private proof state is absent or not private.')
    state = json.loads(PRIVATE.read_text())
    f = state['fixture']
    for key in ('owner', 'buyer', 'other', 'listing', 'listing2', 'offer', 'deal', 'watch'):
        t.must(isinstance(f.get(key), str) and UUID.fullmatch(f[key]), 'Invalid owned fixture identity.')
    t.must(re.fullmatch(r'watcher-runtime-local-[0-9a-f-]{36}', f['marker']), 'Invalid fixture marker.')
    return state


def http(path, payload=None, bearer=None):
    t.must(path in ('/_local/runtime', '/api/agent/watch'), 'Unexpected runtime path.')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), t.NoRedirect)
    headers = {'Origin': ORIGIN, 'Accept': 'application/json'}
    if bearer:
        headers['Authorization'] = 'Bearer ' + bearer
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(ORIGIN + path, headers=headers,
        data=None if payload is None else json.dumps(payload).encode(), method='GET' if payload is None else 'POST')
    try:
        response = opener.open(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(131073)
        t.must(len(raw) <= 131072, 'Unexpected runtime response size.')
        # Never reflect the provider body, JWT or capability in failures.
        t.must(response.code == 200, 'Local runtime returned HTTP ' + str(response.code) + '; reconcile existing proof state before retrying.')
        return json.loads(raw)


def live(h, expected=None):
    owned = runtime.owned(h.db)
    t.must(owned is not None and owned['State']['Running'], 'The owned isolated runtime is not live.')
    if expected:
        t.must(owned['Id'] == expected, 'Runtime instance changed; this is not continuity proof.')
    state = http('/_local/runtime')
    t.must(state.get('kind') == 'isolated_local_scheduler' and state.get('hosted') is False and
        isinstance(state.get('instance'), str) and isinstance(state.get('scheduled_runs'), int), 'Unexpected runtime health evidence.')
    return owned['Id'], state


def ensure(key='attempt'):
    return "DO $ok$ BEGIN IF current_setting('swtest." + key + "',true) IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'synthetic watcher setup failed'; END IF; END $ok$;"


def prepare(h):
    t.must(not PRIVATE.exists(), 'Existing proof journal must be checked/cleaned; never overwrite an unknown watch.')
    t.must(h.db.sql("SELECT count(*) FROM public.agent_watches WHERE state='active';").strip() == '0',
           'Another active watcher exists; coordinate before using the global scheduler.')
    container_id, before = live(h)
    f = h.fixture()
    enrollment = t.uid()
    operation = t.uid()
    state = {'phase': 'preparing', 'synthetic_principals': True, 'human_ui_approval': False,
        'hosted': False, 'fixture': {k: v for k, v in f.items() if k != 'setup'},
        'container_id': container_id, 'runtime_before': before, 'enrollment_key': enrollment,
        'buyer_operation_key': operation,
        'source_hashes': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in ('worker/ai.ts', 'worker/watcher.ts', 'worker/index.js')}}
    save(state)
    try:
        prepared = h.commit(f, f"DELETE FROM public.offers WHERE id='{f['offer']}';"
            + t.mandates.human(f, bound=1800, tools=TOOLS) + ensure('setup_buyer')
            + t.mandates.human(f, who='owner', key='seller', bound=1600, tools=TOOLS) + ensure('setup_seller')
            + t.save("public.agent_mandate_action(current_setting('swtest.buyer_token')," + t.q(operation)
                + ",'place_offer',1665,NULL,NULL,'Synthetic bounded buyer offer','Synthetic setup for real watcher proof','synthetic-setup')",
                key='bid', dbrole='anon') + ensure(),
            "'buyer_mandate',current_setting('swtest.buyer'),'seller_mandate',current_setting('swtest.seller'),"
            "'offer'," + t.value('bid') + ","
            "'capability',(SELECT jsonb_build_object('id',id,'token',current_setting('swtest.seller_token'),'expires_at',expires_at)"
            " FROM public.agent_capabilities WHERE token_hash=encode(extensions.digest(current_setting('swtest.seller_token'),'sha256'),'hex'))")
        t.must(prepared['offer'].get('status') == 'succeeded' and UUID.fullmatch(prepared['offer'].get('offer_id', '')),
               'Guarded synthetic setup offer did not succeed.')
        state.update({'phase': 'enrolling', 'buyer_mandate': prepared['buyer_mandate'],
            'seller_mandate': prepared['seller_mandate'], 'public_offer_id': prepared['offer']['offer_id'],
            'watch_expires_at': prepared['capability']['expires_at']})
        save(state)
        result = http('/api/agent/watch', {'action': 'start', 'mandate_id': state['seller_mandate'],
            'capability': prepared['capability']['token'], 'enrollment_key': enrollment,
            'expires_at': state['watch_expires_at']}, h.jwt(f['owner']))
        t.must(UUID.fullmatch(result.get('id', '')) and result.get('mandate_id') == state['seller_mandate'] and result.get('state') == 'active',
               'Watch enrollment response is invalid; reconcile the private journal.')
        state.update({'phase': 'enrolled', 'watch_id': result['id']})
        save(state)
        print(json.dumps({'phase': 'enrolled', 'listing_id': f['listing'], 'watch_id': result['id'],
            'runtime_instance': before['instance'], 'scheduled_runs_before': before['scheduled_runs'],
            'preparation_client_will_exit': True, 'human_ui_approval': False, 'hosted': False}), flush=True)
    except Exception:
        # Keep the journal/fixtures for reconciliation. No blind replacement
        # capability, enrollment, provider generation or financial operation.
        state['phase'] = 'needs_reconciliation'
        save(state)
        raise


def check(h, state):
    _, after = live(h, state['container_id'])
    t.must(after['instance'] == state['runtime_before']['instance'], 'Scheduler process restarted; original continuity is unproven.')
    f = state['fixture']
    result = t.parsed(h.db.sql("SELECT json_build_object("
        "'watch',(SELECT jsonb_build_object('id',id,'state',state,'last_error',last_error,'updated_at',updated_at) FROM public.agent_watches WHERE enrollment_key=" + t.q(state['enrollment_key']) + "),"
        "'operations',(SELECT coalesce(jsonb_agg(jsonb_build_object('operation_key',o.operation_key,'status',o.status,'proposal',o.proposal,'result',o.result)),'[]'::jsonb)"
        " FROM public.agent_watch_operations o JOIN public.agent_watches w ON w.id=o.watch_id WHERE w.enrollment_key=" + t.q(state['enrollment_key']) + "),"
        "'deals',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'state',state,'buyer_id',buyer_id,'seller_id',seller_id,'cents',locked_price_cents)),'[]'::jsonb)"
        " FROM public.lock_ins WHERE listing_id=" + t.q(f['listing']) + "),"
        "'mandates',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'side',side,'status',status,'bound_cents',bound_cents,'rounds_used',rounds_used,'approved_by',approved_by,'owner_id',owner_id,'deal_id',deal_id)),'[]'::jsonb)"
        " FROM public.agent_mandates WHERE listing_id=" + t.q(f['listing']) + "),"
        "'actions',(SELECT coalesce(jsonb_agg(jsonb_build_object('mandate_id',mandate_id,'operation_key',operation_key,'status',status,'model',model,'deal_id',deal_id,'offer_id',offer_id)),'[]'::jsonb)"
        " FROM public.mandate_actions WHERE mandate_id IN (SELECT id FROM public.agent_mandates WHERE listing_id=" + t.q(f['listing']) + ")));") )
    state['runtime_after'] = after
    state['database_evidence'] = result
    save(state)
    if result['watch'] and result['watch']['state'] in ('blocked', 'stopped'):
        print(json.dumps({'phase': 'review_required', 'watch_state': result['watch']['state'],
            'error': result['watch']['last_error'], 'journal': str(PRIVATE.relative_to(ROOT)), 'provider_retry': False}))
        return
    if not result['operations'] or not result['deals']:
        print(json.dumps({'phase': 'waiting_for_scheduled_result', 'scheduled_runs': after['scheduled_runs'],
            'last_scheduled_ok': after.get('last_scheduled_ok'), 'watch_state': result['watch']['state'] if result['watch'] else None}))
        return
    t.must(after['scheduled_runs'] > state['runtime_before']['scheduled_runs'], 'No independent scheduled event was observed.')
    t.must(result['watch']['state'] == 'finished' and len(result['deals']) == 1 and len(result['operations']) == 1,
           'Expected one finished watch, operation and persistent deal.')
    deal = result['deals'][0]
    op = result['operations'][0]
    t.must(deal['buyer_id'] == f['buyer'] and deal['seller_id'] == f['owner'] and deal['cents'] == 1665,
           'Locked deal participants or exact price mismatch.')
    t.must(op['status'] == 'succeeded' and op['result'].get('deal_id') == deal['id'] and
        op['proposal'].get('action') == 'accept_offer' and op['proposal'].get('offer_id') == state['public_offer_id'] and
        isinstance(op['proposal'].get('explanation'), str) and len(op['proposal']['explanation']) > 0 and
        re.fullmatch(r'resp_[A-Za-z0-9]+', op['proposal'].get('response_id', '')) and
        op['proposal'].get('model', '').startswith('gpt-'), 'Real model proposal or exact operation receipt is missing.')
    t.must(len(result['mandates']) == 2 and all(m['status'] == 'consumed' and m['approved_by'] == m['owner_id'] and m['deal_id'] == deal['id']
        for m in result['mandates']), 'Both approved synthetic mandates must be consumed by this deal.')
    t.must(len(result['actions']) == 2 and all(a['status'] == 'succeeded' for a in result['actions']) and
        any(a['operation_key'] == op['operation_key'] and a['deal_id'] == deal['id'] and a['model'] == op['proposal']['model'] for a in result['actions']),
        'Guarded trading receipts do not match the persisted generated proposal.')
    state['phase'] = 'verified'
    save(state)
    print(json.dumps({'phase': 'verified', 'model': op['proposal']['model'], 'response_id': op['proposal']['response_id'],
        'action': op['proposal']['action'], 'deal_id': deal['id'], 'amount_cents': deal['cents'],
        'same_runtime_instance': True, 'scheduled_runs': after['scheduled_runs'],
        'human_ui_approval': False, 'hosted': False, 'journal': str(PRIVATE.relative_to(ROOT))}))


def cleanup(h, state):
    f = state['fixture']
    remaining = h.db.sql('SELECT count(*) FROM public.listings WHERE id=' + t.q(f['listing']) + ';').strip()
    if remaining != '0':
        h.db.sql('BEGIN;' + t.role(f['owner'], "PERFORM public.stop_agent_watch(id) FROM public.agent_watches WHERE enrollment_key=" + t.q(state['enrollment_key']) + ';') + 'COMMIT;')
        h.cleanup(f)
    state['phase_before_cleanup'] = state['phase']
    state['phase'] = 'cleaned'
    save(state)
    print('Owned watcher fixtures cleaned; private model/runtime evidence preserved. No runtime or provider mutation requested.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'check', 'cleanup'))
    args = parser.parse_args()
    h = t.Harness('watcher-runtime-local', ('agent_watches', 'agent_watch_operations'))
    if args.action == 'prepare':
        prepare(h)
    elif args.action == 'check':
        check(h, load())
    else:
        cleanup(h, load())


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, AssertionError, KeyError, urllib.error.URLError) as error:
        print('Local watcher proof stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
