#!/usr/bin/env python3
"""Real isolated SQL/REST privacy checks; no hosted target or browser.

python3 scripts/test-privacy-local.py [--apply] [--expect vulnerable|fixed]
Synthetic principals only. All committed fixtures are ownership-checked/cleaned.
"""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mandate_cases', ROOT / 'scripts/test-mandates-local.py')
cases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cases)


def issuance_wait(db, fixed, target):
    f = cases.fixture()
    marker = f['marker']
    out = db.sql('BEGIN;' + f['setup'] + cases.human(f)
                 + "SELECT current_setting('swtest.buyer'); COMMIT;")
    mandate = out.splitlines()[-1]
    cases.must(str(uuid.UUID(mandate)) == mandate, 'Missing synthetic race mandate.')

    def wait_for(name, predicate):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            if db.sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name="
                      + cases.baseline.qs(name) + " AND " + predicate + ');').strip() == 't':
                return
            time.sleep(.025)
        raise AssertionError('Expected confirmed local issuance session: ' + target)

    try:
        lock = f"SELECT id FROM public.agent_mandates WHERE id='{mandate}' FOR UPDATE;" if target == 'mandate' else ''
        with ThreadPoolExecutor(max_workers=2) as pool:
            blocker = pool.submit(db.sql, f"SET application_name='{marker}-block'; BEGIN; {lock} "
                f"UPDATE public.profiles SET is_suspended=true WHERE id='{f['buyer']}'; SELECT pg_sleep(2.2); COMMIT;")
            wait_for(marker + '-block', "wait_event='PgSleep'")
            actor = pool.submit(db.sql, f"SET application_name='{marker}-actor'; BEGIN;" + cases.role(f['buyer'],
                f"PERFORM public.issue_agent_capability('{mandate}',ARRAY['get_mandate'],clock_timestamp()+interval '30 minutes');")
                + "SELECT current_setting('swtest.attempt'); COMMIT;")
            wait_for(marker + '-actor', "wait_event_type='Lock'")
            result = actor.result().splitlines()[-1]
            blocker.result()
        count = db.sql(f"SELECT count(*) FROM public.agent_capabilities WHERE mandate_id='{mandate}';").strip()
        cases.must((result != 'ok' and count == '1') if fixed else (result == 'ok' and count == '2'),
                   'Issuance after suspension did not match expected authority boundary.')
        print('PASS ' + ('issuance rejects suspension after confirmed ' + target + ' lock wait' if fixed
                         else 'reproduced issuance after suspension during mandate lock wait'))
    finally:
        cases.cleanup(db, f)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expect', choices=('vulnerable', 'fixed'), default='fixed')
    args = parser.parse_args()
    cases.must(not (args.apply and args.expect != 'fixed'), 'Apply requires fixed expectations.')
    db = cases.baseline.Local()
    cases.must(db.sql("SELECT to_regprocedure('public.agent_mandate_action(text,uuid,text,integer,uuid,uuid,text,text,text)') IS NOT NULL;").strip() == 't',
               'Apply core and mandates before privacy verification.')
    if args.apply:
        db.sql((ROOT / 'supabase/migrations/202611050003_agent_privacy.sql').read_text())
        print('Applied additive privacy migration to the verified isolated local DB.')
    status_result = subprocess.run([str(ROOT / 'node_modules/.bin/supabase'), 'status', '--output', 'json'],
                                  cwd=ROOT, capture_output=True, text=True, timeout=30)
    cases.must(status_result.returncode == 0, 'Isolated local status unavailable.')
    status = json.loads(status_result.stdout)
    cases.must(status['API_URL'] == 'http://127.0.0.1:55321', 'Unexpected API target.')
    f = cases.fixture()
    f.update({key: str(uuid.uuid4()) for key in ('past', 'listing3', 'control', 'maintenance', 'past_offer', 'cancel_offer', 'active_offer')})
    owner_email = f['marker'] + '-owner@example.test'
    f['setup'] = f['setup'].replace(f['marker'] + '-owner@example.edu', owner_email)
    checked = 0
    fixed = args.expect == 'fixed'

    def check(condition, label):
        nonlocal checked
        cases.must(condition, label)
        checked += 1
        print('PASS ' + label)

    def encoded(value):
        return base64.urlsafe_b64encode(value).rstrip(b'=').decode()

    def token(user):
        now = int(time.time())
        header = encoded(b'{"alg":"HS256","typ":"JWT"}')
        claims = encoded(json.dumps({'sub': user, 'role': 'authenticated', 'aud': 'authenticated',
            'iss': status['API_URL'] + '/auth/v1', 'iat': now, 'exp': now + 180}).encode())
        signature = encoded(hmac.new(status['JWT_SECRET'].encode(), (header + '.' + claims).encode(), hashlib.sha256).digest())
        return header + '.' + claims + '.' + signature

    def request(path, authorization, payload=None, single=False):
        headers = {'apikey': status['ANON_KEY'], 'Authorization': 'Bearer ' + authorization}
        if single:
            headers['Accept'] = 'application/vnd.pgrst.object+json'
        if payload is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(status['API_URL'] + '/rest/v1/' + path, headers=headers,
            data=None if payload is None else json.dumps(payload).encode())
        try:
            response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read()
            return response.code, json.loads(body) if body else None

    def ok(path, authorization, payload=None, single=False):
        code, data = request(path, authorization, payload, single)
        cases.must(200 <= code < 300, 'Expected local REST success for ' + path.split('?')[0])
        return data

    def denial(path, authorization, payload):
        code, data = request(path, authorization, payload)
        return code in (400, 401, 403) and owner_email not in json.dumps(data)

    identities = {role: token(f[role]) for role in ('owner', 'buyer', 'other', 'past')}
    anon = status['ANON_KEY']
    expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    tools = ['place_offer', 'accept_offer', 'get_mandate', 'get_deal', 'revoke_mandate']

    def mandate(listing, approve=True, scoped_tools=None):
        draft = ok('rpc/create_agent_mandate_draft', identities['buyer'], {'p_listing_id': listing,
            'p_side': 'buy', 'p_bound_cents': 1800, 'p_max_rounds': 4, 'p_expires_at': expiry}, True)
        if not approve:
            return draft, None
        ok('rpc/approve_agent_mandate', identities['buyer'], {'p_mandate_id': draft['id'], 'p_expected_hash': draft['draft_hash']}, True)
        cap = ok('rpc/issue_agent_capability', identities['buyer'], {'p_mandate_id': draft['id'], 'p_tools': scoped_tools or tools, 'p_expires_at': expiry})
        return draft, cap

    created = False
    try:
        db.sql('BEGIN;' + f['setup'] + f"""
          INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
            ('{f['past']}','{f['marker']}-past@example.edu','{{"full_name":"Synthetic past author"}}');
          INSERT INTO public.listings(id,user_id,type,title,price_cents,platform) VALUES
            ('{f['listing3']}','{f['owner']}','sell','{f['marker']}-cancelled',2000,'bubbl'),
            ('{f['control']}','{f['owner']}','sell','{f['marker']}-control',2000,'bubbl'),
            ('{f['maintenance']}','{f['buyer']}','sell','{f['marker']}-maintenance',2000,'bubbl');
          INSERT INTO public.offers(id,listing_id,from_user,amount_cents) VALUES
            ('{f['past_offer']}','{f['listing']}','{f['past']}',1500),
            ('{f['cancel_offer']}','{f['listing3']}','{f['past']}',1550),
            ('{f['active_offer']}','{f['listing2']}','{f['buyer']}',1600);
          INSERT INTO public.lock_ins(listing_id,buyer_id,seller_id,locked_price_cents)
            VALUES ('{f['listing']}','{f['buyer']}','{f['owner']}',1665),
              ('{f['listing3']}','{f['buyer']}','{f['owner']}',1550);
          UPDATE public.offers SET status='accepted' WHERE id='{f['offer']}';
          UPDATE public.lock_ins SET state='confirmed' WHERE listing_id='{f['listing']}';
          UPDATE public.lock_ins SET state='cancelled' WHERE listing_id='{f['listing3']}';
          UPDATE public.listings SET status='cancelled' WHERE id='{f['listing3']}';
          COMMIT;""")
        created = True
        sold_path = 'offers?select=id,amount_cents,status&listing_id=eq.' + f['listing']
        outsider_rows = ok(sold_path, identities['other'])
        check(outsider_rows == [] if fixed else any(r['status'] == 'accepted' and r['amount_cents'] == 1665 for r in outsider_rows),
              'completed offer price hidden from outsider' if fixed else 'reproduced completed offer price leak')
        check(len(ok(sold_path, identities['owner'])) == 2, 'listing owner retains completed offer board')
        check(len(ok(sold_path, identities['buyer'])) == 2, 'current deal party retains completed offer board')
        past_rows = ok(sold_path, identities['past'])
        check([r['id'] for r in past_rows] == [f['past_offer']] if fixed else len(past_rows) == 2,
              'offer author retains only own completed offer' if fixed else 'baseline author reads all completed offers')
        check(ok(sold_path, anon) == [], 'anonymous completed offer reads denied')
        active_path = 'offers?select=id&listing_id=eq.' + f['listing2']
        check(len(ok(active_path, anon)) == 1 and len(ok(active_path, identities['other'])) == 1,
              'active public offer board preserved')
        cancelled_path = 'offers?select=id&listing_id=eq.' + f['listing3']
        check(ok(cancelled_path, identities['buyer']) == [] if fixed else len(ok(cancelled_path, identities['buyer'])) == 1,
              'cancelled former deal grants no unrelated offer reads' if fixed else 'baseline former party reads unrelated inactive offer')
        check(len(ok(cancelled_path, identities['past'])) == 1 and len(ok(cancelled_path, identities['owner'])) == 1,
              'inactive listing owner and offer author retain legitimate reads')
        for listing in (f['listing'], f['listing3']):
            check(ok('listings?select=id&id=eq.' + listing, anon) == [], 'anonymous inactive listing remains hidden')

        # SQL exercises effective RLS as an actual role independently of REST.
        sql = db.sql('BEGIN;' + cases.role(f['other'], f"""IF (SELECT count(*) FROM public.offers WHERE listing_id='{f['listing']}')<>{0 if fixed else 2}
            THEN RAISE EXCEPTION 'unexpected sold offers'; END IF;""") + "SELECT current_setting('swtest.attempt'); ROLLBACK;")
        check(sql.splitlines()[-1] == 'ok', 'actual authenticated SQL role matches REST completed-price policy')

        code, error = request('rpc/purge_test_listing', identities['other'], {'p_id': f['listing']})
        check(code in (401, 403) and owner_email not in json.dumps(error) if fixed else owner_email in json.dumps(error),
              'fixture cleanup cannot disclose private email to outsider' if fixed else 'reproduced fixture cleanup private email leak')
        if not fixed:
            # The remaining reproduction uses its own live approved authority.
            draft, cap = mandate(f['control'])
            db.sql(f"UPDATE public.profiles SET is_suspended=true WHERE id='{f['buyer']}';")
            check(ok('rpc/agent_get_mandate', anon, {'p_token': cap['token']})['id'] == draft['id'],
                  'reproduced suspended-owner token private read')
            check(denial('rpc/revoke_agent_mandate', identities['buyer'], {'p_mandate_id': draft['id']}),
                  'reproduced suspended owner unable to revoke mandate')
            check(denial('rpc/revoke_agent_capability', identities['buyer'], {'p_capability_id': cap['id']}),
                  'reproduced suspended owner unable to revoke capability')
        else:
            check(denial('rpc/purge_test_listing', identities['buyer'], {'p_id': f['maintenance']}),
                  'authenticated fixture owner cannot invoke maintenance cleanup')
            check(denial('rpc/purge_test_listing', anon, {'p_id': f['listing']}), 'anonymous cleanup denied')
            check(denial('rpc/purge_test_listing', status['SERVICE_ROLE_KEY'], {'p_id': f['listing']}),
                  'service cleanup retains target-fixture guard and generic error')
            ok('rpc/purge_test_listing', status['SERVICE_ROLE_KEY'], {'p_id': f['maintenance']})
            check(db.sql(f"SELECT count(*) FROM public.listings WHERE id='{f['maintenance']}';").strip() == '0',
                  'service maintenance can clean its synthetic fixture')

            revoke_draft, revoke_cap = mandate(f['control'], scoped_tools=['revoke_mandate'])
            read_cap = ok('rpc/issue_agent_capability', identities['buyer'], {'p_mandate_id': revoke_draft['id'],
                'p_tools': ['get_mandate', 'get_deal'], 'p_expires_at': expiry})
            check(denial('rpc/agent_get_mandate', anon, {'p_token': revoke_cap['token']})
                  and denial('rpc/agent_get_deal', anon, {'p_token': revoke_cap['token']}),
                  'revoke-only capability cannot invoke private read tools')
            check(ok('rpc/agent_revoke_mandate', anon, {'p_token': revoke_cap['token']})
                  == {'id': revoke_draft['id'], 'status': 'revoked'},
                  'revoke-only response contains no bound, owner or listing snapshot')
            check(denial('rpc/agent_get_mandate', anon, {'p_token': read_cap['token']})
                  and denial('rpc/agent_get_deal', anon, {'p_token': read_cap['token']}),
                  'independently scoped private reads remain denied after token revocation of mandate')

            draft, cap = mandate(f['control'])
            deal_draft, deal_cap = mandate(f['listing2'])
            pending, _ = mandate(f['control'], False)
            action = ok('rpc/agent_mandate_action', anon, {'p_token': deal_cap['token'], 'p_operation_key': str(uuid.uuid4()),
                'p_action': 'place_offer', 'p_amount_cents': 1700})
            cases.must(action['status'] == 'succeeded', 'Synthetic bounded offer must succeed.')
            deal = ok('rpc/accept_offer', identities['owner'], {'p_offer_id': action['offer_id']})
            check(ok('rpc/agent_get_deal', anon, {'p_token': deal_cap['token']})['id'] == deal,
                  'scoped participant can read own exact locked deal before suspension')
            check(ok('rpc/agent_get_mandate', anon, {'p_token': cap['token']})['id'] == draft['id'],
                  'active owner capability remains functional')
            db.sql(f"UPDATE public.profiles SET is_suspended=true WHERE id='{f['buyer']}';")
            check(denial('rpc/agent_get_mandate', anon, {'p_token': cap['token']}), 'suspended owner token cannot read private mandate')
            check(denial('rpc/agent_get_deal', anon, {'p_token': deal_cap['token']}), 'suspended owner token cannot read private deal')
            check(denial('rpc/create_agent_mandate_draft', identities['buyer'], {'p_listing_id': f['control'], 'p_side': 'buy',
                'p_bound_cents': 1800, 'p_max_rounds': 4, 'p_expires_at': expiry}), 'suspended owner cannot create authority')
            check(denial('rpc/approve_agent_mandate', identities['buyer'], {'p_mandate_id': pending['id'], 'p_expected_hash': pending['draft_hash']}),
                  'suspended owner cannot approve authority')
            check(denial('rpc/issue_agent_capability', identities['buyer'], {'p_mandate_id': draft['id'], 'p_tools': ['get_mandate'], 'p_expires_at': expiry}),
                  'suspended owner cannot issue new capability')
            for actor in (identities['other'], anon):
                check(denial('rpc/revoke_agent_capability', actor, {'p_capability_id': cap['id']}), 'outsider cannot revoke capability')
                check(denial('rpc/revoke_agent_mandate', actor, {'p_mandate_id': draft['id']}), 'outsider cannot revoke mandate')
            check(ok('rpc/revoke_agent_capability', identities['buyer'], {'p_capability_id': deal_cap['id']}) is True,
                  'suspended owner can revoke consumed-mandate capability')
            check(ok('rpc/revoke_agent_capability', identities['buyer'], {'p_capability_id': deal_cap['id']}) is True,
                  'suspended capability revocation remains idempotent')
            revoked = ok('rpc/revoke_agent_mandate', identities['buyer'], {'p_mandate_id': draft['id']}, True)
            check(revoked['status'] == 'revoked', 'suspended owner can revoke mandate')
            check(ok('rpc/revoke_agent_mandate', identities['buyer'], {'p_mandate_id': draft['id']}, True)['revoked_at'] == revoked['revoked_at'],
                  'suspended mandate revocation remains idempotent')
            check(ok('rpc/revoke_agent_capability', identities['buyer'], {'p_capability_id': cap['id']}) is True,
                  'suspended owner can revoke capability after mandate revocation')
            for function, arg in (('revoke_agent_mandate', "'" + draft['id'] + "'"), ('revoke_agent_capability', "'" + cap['id'] + "'")):
                result = db.sql('BEGIN;' + cases.role('', f'PERFORM public.{function}({arg});') + "SELECT current_setting('swtest.attempt'); ROLLBACK;")
                check(result.splitlines()[-1].startswith('42501:'), 'missing-UID authenticated role cannot revoke authority')
        issuance_wait(db, fixed, 'mandate')
        checked += 1
        if fixed:
            issuance_wait(db, True, 'profile')
            checked += 1
        print(str(checked) + ' real local privacy SQL/REST checks passed (' + args.expect + ').')
    finally:
        if created:
            emails = {f['owner']: owner_email, **{f[k]: f['marker'] + '-' + k + '@example.edu' for k in ('buyer', 'other', 'past')}}
            expected = ','.join('(' + cases.baseline.qs(user) + '::uuid,' + cases.baseline.qs(email) + ')' for user, email in emails.items())
            listings = ','.join(cases.baseline.qs(f[k]) for k in ('listing', 'listing2', 'listing3', 'control', 'maintenance'))
            users = ','.join(cases.baseline.qs(user) for user in emails)
            db.sql(f"""BEGIN; DO $ownership$ BEGIN
              IF (SELECT title FROM public.listings WHERE id='{f['listing']}') IS DISTINCT FROM '{f['marker']}'
                OR (SELECT count(*) FROM auth.users u JOIN (VALUES {expected}) e(id,email) ON u.id=e.id AND u.email=e.email)<>4
              THEN RAISE EXCEPTION 'privacy fixture ownership mismatch'; END IF;
              END $ownership$;
              DELETE FROM public.mandate_actions WHERE mandate_id IN (SELECT id FROM public.agent_mandates WHERE listing_id IN ({listings}));
              DELETE FROM public.agent_capabilities WHERE mandate_id IN (SELECT id FROM public.agent_mandates WHERE listing_id IN ({listings}));
              DELETE FROM public.agent_mandates WHERE listing_id IN ({listings});
              DELETE FROM public.lock_ins WHERE listing_id IN ({listings});
              DO $outbox$ BEGIN
                IF to_regclass('public.email_outbox') IS NOT NULL THEN
                  DELETE FROM public.email_outbox WHERE listing_id IN ({listings});
                END IF;
              END $outbox$;
              DELETE FROM public.offers WHERE listing_id IN ({listings});
              DELETE FROM public.listings WHERE id IN ({listings});
              DELETE FROM auth.users WHERE id IN ({users}); COMMIT;""")
            cases.must(db.sql(f"SELECT (SELECT count(*) FROM public.listings WHERE id IN ({listings}))+(SELECT count(*) FROM auth.users WHERE id IN ({users}));").strip() == '0',
                       'Privacy fixture cleanup incomplete.')
            print('Owned privacy fixtures removed.')


if __name__ == '__main__':
    main()
