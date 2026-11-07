#!/usr/bin/env python3
"""Real fixed-local watcher SQL/REST/race and guarded-trading checks.

python3 scripts/test-ai-watcher-local.py --section all
Manager must apply migration 006 first. Refuses unrelated active watches because
claim_agent_watches is a global queue operation. No provider/model calls or real
human approvals. Fake ciphertext is SQL fixture data, not runtime crypto proof.
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
TOOLS = ['get_mandate', 'get_deal', 'place_offer', 'accept_offer']
CIPHER = 'v1.' + 'A' * 16 + '.' + 'B' * 104
CONTEXT = '1' * 64
DENIED = (400, 401, 403, 404)


def ensure(key='attempt'):
    return "DO $setup$ BEGIN IF current_setting('swtest." + key + "',true) IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'synthetic watcher setup failed'; END IF; END $setup$;"


def prepare(f, expiry="interval '30 minutes'", tools=None):
    tools_sql = 'ARRAY[' + ','.join(t.q(tool) for tool in (TOOLS if tools is None else tools)) + ']::text[]'
    return t.mandates.human(f) + ensure('setup_buyer') + t.role(f['buyer'], f"""
      PERFORM set_config('swtest.cap',public.issue_agent_capability(current_setting('swtest.buyer')::uuid,
        {tools_sql},clock_timestamp()+{expiry})::text,true);
      PERFORM set_config('swtest.buyer_token',current_setting('swtest.cap')::jsonb->>'token',true);
    """) + ensure()


def wid():
    return "(" + t.value('watch') + "->>'id')::uuid"


def lease(key='jobs'):
    return "(" + t.value(key) + "->0->>'lease_token')::uuid"


def start(f, expiry=None, who='buyer', key='watch', enrollment=None, dbrole='authenticated'):
    expires = expiry or "(" + t.value('cap') + "->>'expires_at')::timestamptz"
    enrollment = enrollment or f.setdefault('enrollment', t.uid())
    return t.save("public.start_agent_watch(current_setting('swtest.buyer')::uuid,(" + t.value('cap')
        + "->>'id')::uuid,'" + enrollment + "'," + expires + ',' + t.q(CIPHER) + ')',
        key=key, user=f.get(who, ''), dbrole=dbrole)


def enroll(f, expiry="interval '30 minutes'"):
    return prepare(f, expiry) + start(f) + ensure()


def claim(f, key='jobs', dbrole='service_role', limit='4'):
    guard = "DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.agent_watches WHERE state='active' AND mandate_id<>current_setting('swtest.buyer')::uuid) THEN RAISE EXCEPTION 'unrelated active watches: refusing global queue claim'; END IF; END $guard$;"
    return guard + t.save('public.claim_agent_watches(' + limit + ')', key=key, dbrole=dbrole)


def proposal(amount=1665):
    return {'action': 'place_offer', 'amount_cents': amount, 'offer_id': None, 'parent_offer_id': None,
        'message': 'Synthetic bounded offer', 'explanation': 'Synthetic independent verification',
        'model': 'fixture-model', 'response_id': 'fixture-response'}


def stage(f, amount=1665, key='operation', lease_key='jobs', operation=None, cursor=None, extra=None, dbrole='service_role'):
    p = proposal(amount)
    if extra:
        p.update(extra)
    operation = operation or f.setdefault('operation_key', t.uid())
    return t.save('public.stage_agent_watch_operation(' + wid() + ',' + lease(lease_key) + ',' + t.q(operation)
        + ',' + t.q(CONTEXT) + ',' + t.q(json.dumps(p)) + '::jsonb,' + ('NULL' if cursor is None else t.q(cursor)) + ')',
        key=key, dbrole=dbrole)


def finish(f, state='active', result=None, error=None, key='result', lease_key='jobs', operation=True,
           cursor=None, advance=False, diagnostic=None, scan_cursor=None):
    result_sql = 'NULL' if result is None else result if isinstance(result, str) else t.q(json.dumps(result)) + '::jsonb'
    return t.save('public.finish_agent_watch(p_watch_id=>' + wid() + ',p_lease_token=>' + lease(lease_key)
        + ',p_state=>' + t.q(state) + ',p_context_hash=>' + t.q(CONTEXT)
        + ',p_scan_cursor=>' + ('NULL' if scan_cursor is None else t.q(scan_cursor))
        + ',p_operation_key=>' + (t.q(f.setdefault('operation_key', t.uid())) + '::uuid' if operation else 'NULL')
        + ',p_result=>' + result_sql + ',p_error=>' + ('NULL' if error is None else t.q(error))
        + ',p_offer_cursor=>' + ('NULL' if cursor is None else t.q(cursor))
        + ',p_advance_offer_cursor=>' + ('true' if advance else 'false')
        + ',p_diagnostic=>' + ('NULL' if diagnostic is None else t.q(json.dumps(diagnostic)) + '::jsonb') + ')', key=key)


def send(f, key='result'):
    return t.save("public.agent_mandate_action(current_setting('swtest.buyer_token')," + t.q(f.setdefault('operation_key', t.uid()))
        + ",'place_offer',1665,NULL,NULL,'Synthetic bounded offer','Synthetic independent verification','fixture-model')",
        key=key, dbrole='anon')


def stop(f, who='buyer', dbrole='authenticated'):
    return t.save('public.stop_agent_watch(' + wid() + ')', user=f.get(who, ''), dbrole=dbrole)


def resume(f, who='buyer', dbrole='authenticated'):
    return t.save('public.resume_agent_watch(' + wid() + ')', user=f.get(who, ''), dbrole=dbrole)


def due(f):
    return "UPDATE public.agent_watches SET next_run_at=clock_timestamp()-interval '1 second',lease_until=CASE WHEN lease_until IS NOT NULL THEN clock_timestamp()-interval '1 second' END WHERE mandate_id=current_setting('swtest.buyer')::uuid;"


def inspect(f):
    return f"""'attempt',current_setting('swtest.attempt',true),'result',{t.value()},'jobs',{t.value('jobs')},
      'first',{t.value('first')},'operation',{t.value('operation')},
      'watch',(SELECT jsonb_build_object('id',id,'state',state,'expires_at',expires_at,'cursor',offer_cursor,'scan_cursor',scan_cursor,'error',last_error)
        FROM public.agent_watches WHERE mandate_id=current_setting('swtest.buyer',true)::uuid),
      'cap_revoked',(SELECT revoked_at IS NOT NULL FROM public.agent_capabilities WHERE id=({t.value('cap')}->>'id')::uuid),
      'operations',(SELECT coalesce(jsonb_agg(jsonb_build_object('operation_key',operation_key,'proposal',proposal,'status',status,'result',result)),'[]'::jsonb)
        FROM public.agent_watch_operations WHERE watch_id={wid()}),
      'rounds',(SELECT rounds_used FROM public.agent_mandates WHERE id=current_setting('swtest.buyer',true)::uuid),
      'actions',(SELECT count(*) FROM public.mandate_actions WHERE mandate_id=current_setting('swtest.buyer',true)::uuid),
      'offers',(SELECT count(*) FROM public.offers WHERE listing_id='{f['listing']}')"""


def denied(r, _):
    t.must(r['attempt'] != 'ok')


def sql_cases(h):
    check = lambda label, build, verify: h.sql(label, build, verify, inspect)
    check('enrollment requires exactly the capability expiry', lambda f: prepare(f) + start(f,
        expiry="(" + t.value('cap') + "->>'expires_at')::timestamptz-interval '1 second'"),
        lambda r, _: t.must(r['attempt'] != 'ok' and r['watch'] is None))
    check('enrollment cannot exceed capability expiry', lambda f: prepare(f) + start(f,
        expiry="(" + t.value('cap') + "->>'expires_at')::timestamptz+interval '1 second'"), denied)
    check('read-only capability cannot enroll trading watcher', lambda f: prepare(f, tools=['get_mandate']) + start(f), denied)
    for who, dbrole in (('other', 'authenticated'), ('', 'anon')):
        check((who or 'anon') + ' cannot enroll another mandate watcher', lambda f, who=who, dbrole=dbrole:
              prepare(f) + start(f, who=who, dbrole=dbrole), denied)
    check('same enrollment replays one watch without replacing ciphertext', lambda f: enroll(f) + start(f, key='first'),
          lambda r, _: t.must(r['attempt'] == 'ok' and r['watch']['id'] == r['first']['id']))
    check('one mandate cannot create two independent watches', lambda f: enroll(f) + start(f, enrollment=t.uid()), denied)
    for dbrole in ('anon', 'authenticated'):
        check(dbrole + ' cannot claim queue jobs', lambda f, dbrole=dbrole: enroll(f) + claim(f, dbrole=dbrole), denied)
    for limit in ('0', '9', 'NULL'):
        check('invalid queue claim limit ' + limit + ' denied', lambda f, limit=limit: enroll(f) + claim(f, limit=limit), denied)
    check('claimed watch cannot be claimed again before lease expiry', lambda f: enroll(f) + claim(f) + ensure() + claim(f, key='result'),
          lambda r, _: t.must(len(r['jobs']) == 1 and r['result'] == []))
    check('staging persists exact proposal and next public-offer cursor', lambda f: enroll(f) + claim(f) + ensure()
        + stage(f, cursor='fixture_cursor') + ensure(),
        lambda r, f: t.must(r['operation']['proposal'] == proposal() and len(r['operations']) == 1
            and r['operations'][0]['status'] == 'pending' and r['watch']['cursor'] == 'fixture_cursor'))
    check('SQL offer cursor accepts the full 1024-character bound', lambda f: enroll(f) + claim(f) + ensure()
        + stage(f, cursor='A' * 1024) + ensure(), lambda r, _: t.must(r['watch']['cursor'] == 'A' * 1024))
    check('SQL scan cursor accepts the full 1024-character bound', lambda f: enroll(f) + claim(f) + ensure()
        + finish(f, operation=False, scan_cursor='A' * 1024),
        lambda r, _: t.must(r['attempt'] == 'ok' and r['result'] is True and r['watch']['scan_cursor'] == 'A' * 1024))
    for label, cursor in (('1025 characters', 'A' * 1025), ('empty', ''), ('invalid charset', 'bad.cursor')):
        check('SQL offer cursor rejects ' + label, lambda f, cursor=cursor: enroll(f) + claim(f) + ensure() + stage(f, cursor=cursor), denied)
        check('SQL scan cursor rejects ' + label, lambda f, cursor=cursor: enroll(f) + claim(f) + ensure()
            + finish(f, operation=False, scan_cursor=cursor), denied)
    check('same stage key and payload replays one durable operation', lambda f: enroll(f) + claim(f) + ensure()
        + stage(f) + ensure() + stage(f, key='first'),
        lambda r, _: t.must(r['attempt'] == 'ok' and r['first'] == r['operation'] and len(r['operations']) == 1))
    check('pending operation key cannot change its proposal', lambda f: enroll(f) + claim(f) + ensure()
        + stage(f) + ensure() + stage(f, amount=1700), denied)
    check('pending proposal cannot be replaced with a fresh operation key', lambda f: enroll(f) + claim(f) + ensure()
        + stage(f) + ensure() + stage(f, operation=t.uid()), denied)
    check('stage rejects extra secret-bearing proposal fields', lambda f: enroll(f) + claim(f) + ensure()
        + stage(f, extra={'capability': 'synthetic_forbidden_field'}), denied)
    check('stale stage is fenced after another lease claims job', lambda f: enroll(f) + claim(f) + ensure() + due(f)
        + claim(f, key='first') + ensure() + stage(f),
        lambda r, _: t.must(r['attempt'] != 'ok' and r['operations'] == []))
    check('stale finish cannot alter current lease or job state', lambda f: enroll(f) + claim(f) + ensure() + stage(f) + ensure()
        + due(f) + claim(f, key='first') + ensure() + finish(f, state='finished'),
        lambda r, _: t.must(r['attempt'] == 'ok' and r['result'] is False and r['watch']['state'] == 'active'
            and r['operations'][0]['status'] == 'pending'))
    check('unknown remote action retains exact operation after next claim', lambda f: enroll(f) + claim(f) + ensure()
        + stage(f) + ensure() + finish(f, error='unknown') + ensure() + due(f) + claim(f, key='result'),
        lambda r, _: t.must(r['operations'][0]['status'] == 'unknown' and len(r['result']) == 1
            and r['result'][0]['pending'] == r['operation']))
    check('lost action reply replays exact key without duplicate offer or round', lambda f: enroll(f) + claim(f) + ensure() + stage(f) + ensure()
        + send(f, key='first') + ensure() + finish(f, error='unknown') + ensure() + due(f) + claim(f, key='newjobs') + ensure() + send(f),
        lambda r, _: t.must(r['attempt'] == 'ok' and r['result'] == r['first'] and r['result']['status'] == 'succeeded'
            and r['actions'] == 1 and r['rounds'] == 1 and r['offers'] == 2))
    check('successful receipt persists own offer ID for later eligible counters', lambda f: enroll(f) + claim(f) + ensure() + stage(f) + ensure()
        + send(f, key='first') + ensure() + finish(f, result=t.value('first')) + ensure() + due(f) + claim(f, key='result'),
        lambda r, _: t.must(r['operations'][0]['status'] == 'succeeded' and r['result'][0]['own_offer_ids'] == [r['first']['offer_id']]))
    check('completion can durably advance public-offer pagination without mutation', lambda f: enroll(f) + claim(f) + ensure()
        + finish(f, operation=False, cursor='next_public_page', advance=True) + ensure() + due(f) + claim(f, key='result'),
        lambda r, _: t.must(r['watch']['cursor'] == 'next_public_page' and r['result'][0]['offer_cursor'] == 'next_public_page'))
    for who, dbrole in (('other', 'authenticated'), ('', 'anon')):
        check((who or 'anon') + ' cannot stop owner watcher', lambda f, who=who, dbrole=dbrole: enroll(f) + stop(f, who, dbrole), denied)
    check('human Stop revokes the capability before stale staged send', lambda f: enroll(f) + claim(f) + ensure() + stage(f) + ensure()
        + stop(f) + ensure() + send(f),
        lambda r, _: t.must(r['attempt'] != 'ok' and r['watch']['state'] == 'stopped' and r['cap_revoked']
            and r['actions'] == 0 and r['rounds'] == 0 and r['offers'] == 1))
    for target in ('capability', 'mandate', 'suspension'):
        def revoke(f, target=target):
            if target == 'capability':
                return t.role(f['buyer'], "PERFORM public.revoke_agent_capability((" + t.value('cap') + "->>'id')::uuid);")
            if target == 'mandate':
                return t.role(f['buyer'], "PERFORM public.revoke_agent_mandate(current_setting('swtest.buyer')::uuid);")
            return f"UPDATE public.profiles SET is_suspended=true WHERE id='{f['buyer']}';"
        check(target + ' revocation blocks queued unknown outcome without erasing it', lambda f, revoke=revoke: enroll(f) + claim(f) + ensure()
            + stage(f) + ensure() + revoke(f) + due(f) + claim(f, key='result'),
            lambda r, _: t.must(r['result'] == [] and r['watch']['state'] == 'blocked'
                and r['operations'][0]['status'] == 'unknown' and r['watch']['error'] == 'denied'))
    check('transient account block resumes only under unchanged valid human authority', lambda f: enroll(f) + claim(f) + ensure()
        + finish(f, state='blocked', error='account_required', operation=False,
            diagnostic={'stage': 'http_rejection', 'http_status': 429, 'error_code': 'credit_balance_exhausted'}) + ensure() + resume(f),
        lambda r, _: t.must(r['attempt'] == 'ok' and r['watch']['state'] == 'active' and not r['cap_revoked']))
    check('outsider cannot resume blocked watcher', lambda f: enroll(f) + claim(f) + ensure()
        + finish(f, state='blocked', error='account_required', operation=False) + ensure() + resume(f, 'other'), denied)
    check('revoked capability cannot be resumed', lambda f: enroll(f) + claim(f) + ensure()
        + finish(f, state='blocked', error='account_required', operation=False) + ensure()
        + t.role(f['buyer'], "PERFORM public.revoke_agent_capability((" + t.value('cap') + "->>'id')::uuid);") + resume(f), denied)
    check('provider diagnostic rejects arbitrary body or credential fields', lambda f: enroll(f) + claim(f) + ensure()
        + finish(f, operation=False, diagnostic={'body': 'forbidden provider response'}), denied)


def rest_cases(h):
    f = h.fixture()
    committed = False
    try:
        data = h.commit(f, enroll(f) + claim(f) + ensure() + stage(f) + ensure(),
            "'watch'," + t.value('watch') + ",'capability_id'," + t.value('cap') + "->>'id','mandate',current_setting('swtest.buyer')")
        committed = True
        owner, outsider = h.jwt(f['buyer']), h.jwt(f['other'])
        watch = data['watch']['id']
        columns = 'id,mandate_id,owner_id,capability_id,enrollment_key,expires_at,state,next_run_at,last_error,created_at,updated_at'
        path = 'agent_watches?select=' + columns + '&id=eq.' + watch
        rows = h.request(path, owner)
        h.check('actual REST owner can read metadata with no queue or cipher secrets', len(rows) == 1 and set(rows[0]) == set(columns.split(',')))
        h.check('actual REST outsider RLS hides watch metadata', h.request(path, outsider) == [])
        for selection in ('*', 'lease_token', 'lease_until', 'last_diagnostic'):
            h.request('agent_watches?select=' + selection + '&id=eq.' + watch, owner, expected=(401, 403))
            h.check('actual REST denies watch internal column ' + selection)
        for actor in (owner, outsider, None):
            h.request('agent_watch_secrets?select=*&watch_id=eq.' + watch, actor, expected=(401, 403))
        h.check('actual REST owner outsider and anon cannot read ciphertext table')
        operations = 'agent_watch_operations?select=*&watch_id=eq.' + watch
        owned = h.request(operations, owner)
        h.check('actual REST operation history belongs only to watch owner', len(owned) == 1 and owned[0]['proposal'] == proposal()
            and h.request(operations, outsider) == [])
        h.request(operations, None, expected=(401, 403))
        h.check('actual REST anonymous cannot read proposal history')
        for table, query, patch, inserted in (
            ('agent_watches', '?id=eq.' + watch, {'state': 'active'}, {'id': t.uid()}),
            ('agent_watch_secrets', '?watch_id=eq.' + watch, {'ciphertext': CIPHER}, {'watch_id': watch, 'ciphertext': CIPHER}),
            ('agent_watch_operations', '?watch_id=eq.' + watch, {'status': 'succeeded'}, {'operation_key': t.uid()}),
        ):
            for method, payload in (('PATCH', patch), ('DELETE', None), ('POST', inserted)):
                h.request(table + ('' if method == 'POST' else query), owner, payload, method=method, expected=(401, 403))
            h.check('actual REST direct writes denied for ' + table)
        h.request('rpc/claim_agent_watches', owner, {'p_limit': 1}, expected=(401, 403))
        h.check('actual REST human denied service queue claim')
        h.request('rpc/stop_agent_watch', outsider, {'p_watch_id': watch}, expected=DENIED)
        h.check('actual REST outsider cannot stop watcher')
        stopped = h.request('rpc/stop_agent_watch', owner, {'p_watch_id': watch})
        again = h.request('rpc/stop_agent_watch', owner, {'p_watch_id': watch})
        h.check('actual REST owner Stop is idempotent', stopped == again and stopped['state'] == 'stopped')
        h.request('rpc/resume_agent_watch', owner, {'p_watch_id': watch}, expected=DENIED)
        h.check('actual REST stopped and revoked watch cannot resume')
    finally:
        if committed:
            h.cleanup(f)


def race_cases(h):
    f = h.fixture()
    committed = False
    try:
        data = h.commit(f, enroll(f), "'watch'," + t.value('watch') + ",'mandate',current_setting('swtest.buyer')")
        committed = True
        def compete(_):
            return t.parsed(h.db.sql('BEGIN;' + "SELECT set_config('swtest.buyer','" + data['mandate'] + "',true);"
                + claim(f) + 'SELECT json_build_object(\'jobs\',' + t.value('jobs') + '); COMMIT;'))['jobs']
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(compete, range(2)))
        h.check('actual simultaneous queue claim leases job once', sorted(map(len, results)) == [0, 1])
        token = next(jobs[0]['lease_token'] for jobs in results if jobs)
        h.check('one durable lease survives claimant connection closure', h.db.sql(
            f"SELECT lease_token='{token}' AND lease_until>clock_timestamp() FROM public.agent_watches WHERE id='{data['watch']['id']}';").strip() == 't')
    finally:
        if committed:
            h.cleanup(f)

    f = h.fixture()
    committed = False
    try:
        data = h.commit(f, enroll(f, expiry="interval '2 seconds'") + claim(f) + ensure() + stage(f) + ensure(),
            "'watch'," + t.value('watch') + ",'token',current_setting('swtest.buyer_token'),'operation'," + t.value('operation'))
        committed = True
        marker = f['marker']
        with ThreadPoolExecutor(max_workers=2) as pool:
            blocker = pool.submit(h.db.sql, f"SET application_name='{marker}-block'; BEGIN; SELECT id FROM public.listings WHERE id='{f['listing']}' FOR UPDATE; SELECT pg_sleep(2.7); COMMIT;")
            h.wait(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{marker}-block' AND wait_event='PgSleep');")
            statement = f"public.agent_mandate_action({t.q(data['token'])},'{data['operation']['operation_key']}','place_offer',1665,NULL,NULL,'Synthetic bounded offer','Synthetic independent verification','fixture-model')"
            actor = pool.submit(h.db.sql, f"SET application_name='{marker}-actor'; BEGIN;" + t.save(statement, dbrole='anon')
                + 'SELECT json_build_object(\'attempt\',current_setting(\'swtest.attempt\',true),\'result\',' + t.value() + '); COMMIT;')
            h.wait(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{marker}-actor' AND wait_event_type='Lock');")
            result = t.parsed(actor.result())
            blocker.result()
        h.check('actual staged send revalidates tied watch/cap expiry after confirmed lock wait',
            result['attempt'] != 'ok' or isinstance(result['result'], dict) and result['result']['status'] == 'rejected')
        h.check('expired stale sender creates no offer and consumes no round', h.db.sql(
            f"SELECT (SELECT count(*) FROM public.offers WHERE listing_id='{f['listing']}')=1 AND (SELECT rounds_used FROM public.agent_mandates WHERE id='{data['watch']['mandate_id']}')=0;").strip() == 't')
    finally:
        if committed:
            h.cleanup(f)


def main():
    args = t.arguments(__doc__)
    h = t.Harness('ai-watcher-local', ('agent_watches', 'agent_watch_secrets', 'agent_watch_operations'))
    if args.section in ('all', 'sql'):
        sql_cases(h)
    if args.section in ('all', 'rest'):
        rest_cases(h)
    if args.section in ('all', 'races'):
        race_cases(h)
    h.summary()


if __name__ == '__main__':
    main()
