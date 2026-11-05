#!/usr/bin/env python3
"""Verify the human UI's real local PostgREST contracts; no browser/hosted target.

Run from sellwant/: python3 scripts/test-mandates-rest-local.py
Uses isolated synthetic human JWT fixtures, never user approval or credentials.
"""
import base64
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
from datetime import datetime, timedelta, timezone

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mandate_cases', ROOT / 'scripts/test-mandates-local.py')
cases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cases)


def main():
    db = cases.baseline.Local()
    status_result = subprocess.run([str(ROOT / 'node_modules/.bin/supabase'), 'status', '--output', 'json'],
                                   cwd=ROOT, capture_output=True, text=True, timeout=30)
    cases.must(status_result.returncode == 0, 'Isolated local status unavailable.')
    status = json.loads(status_result.stdout)
    cases.must(status['API_URL'] == 'http://127.0.0.1:55321', 'Unexpected API target.')
    f = cases.fixture()
    checked = 0

    def encoded(value):
        return base64.urlsafe_b64encode(value).rstrip(b'=').decode()

    def token(user):
        now = int(time.time())
        header = encoded(b'{"alg":"HS256","typ":"JWT"}')
        claims = encoded(json.dumps({'sub': user, 'role': 'authenticated', 'aud': 'authenticated',
          'iss': status['API_URL'] + '/auth/v1', 'iat': now, 'exp': now + 120}).encode())
        signature = encoded(hmac.new(status['JWT_SECRET'].encode(), (header + '.' + claims).encode(), hashlib.sha256).digest())
        return header + '.' + claims + '.' + signature

    def request(path, authorization, payload=None, single=False, expected=200, method=None,
                extra_headers=None, with_headers=False):
        headers = {'apikey': status['ANON_KEY'], 'Authorization': 'Bearer ' + authorization}
        if single:
            headers['Accept'] = 'application/vnd.pgrst.object+json'
        if payload is not None:
            headers['Content-Type'] = 'application/json'
        headers.update(extra_headers or {})
        req = urllib.request.Request(status['API_URL'] + '/rest/v1/' + path, headers=headers,
          data=None if payload is None else json.dumps(payload).encode(),
          method=method or ('GET' if payload is None else 'POST'))
        try:
            response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            code = response.code
            response_headers = {key.lower(): value for key, value in response.headers.items()}
            body = response.read()
            data = json.loads(body) if body else None
        cases.must(code in expected if isinstance(expected, tuple) else code == expected,
                   'Local REST contract failed: ' + path.split('?')[0] + ', HTTP ' + str(code))
        return (data, response_headers) if with_headers else data

    owner = token(f['buyer'])
    outsider = token(f['other'])
    anon = status['ANON_KEY']
    created = False
    try:
        db.sql('BEGIN;' + f['setup'] + 'COMMIT;')
        created = True
        draft = request('rpc/create_agent_mandate_draft', owner, {
          'p_listing_id': f['listing'], 'p_side': 'buy', 'p_bound_cents': 1800, 'p_max_rounds': 4,
          'p_expires_at': (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}, single=True)
        cases.must(isinstance(draft, dict) and draft['status'] == 'draft' and len(draft['draft_hash']) == 64)
        checked += 1
        rows = request('agent_mandates?select=*&id=eq.' + draft['id'], owner)
        cases.must(len(rows) == 1 and rows[0]['listing_snapshot']['title'] == f['marker'])
        cases.must(request('agent_mandates?select=*&id=eq.' + draft['id'], outsider) == [])
        request('agent_mandates?select=*', anon, expected=(401, 403))
        checked += 1
        approval = {'p_mandate_id': draft['id'], 'p_expected_hash': draft['draft_hash']}
        request('rpc/approve_agent_mandate', anon, approval, single=True, expected=(401, 403))
        checked += 1
        approved = request('rpc/approve_agent_mandate', owner, approval, single=True)
        cases.must(approved['approved_by'] == f['buyer'] and approved['status'] == 'approved')
        checked += 1
        cap = request('rpc/issue_agent_capability', owner, {'p_mandate_id': draft['id'],
          'p_tools': ['place_offer', 'get_mandate'], 'p_expires_at': draft['expires_at']})
        cases.must(isinstance(cap, dict) and cap['token'].startswith('swcap_') and len(cap['token']) == 70
                   and set(cap) == {'id', 'token', 'expires_at', 'tools'}
                   and cap['tools'] == ['place_offer', 'get_mandate'])
        checked += 1

        # The UI lists metadata through explicit column grants. Neither the
        # owner nor another user can recover the stored verifier/raw token.
        capability_columns = 'id,mandate_id,tools,expires_at,revoked_at,created_at'
        capability_path = ('agent_capabilities?select=' + capability_columns
                           + '&mandate_id=eq.' + draft['id'] + '&order=created_at.desc')
        metadata = request(capability_path, owner)
        cases.must(len(metadata) == 1 and set(metadata[0]) == set(capability_columns.split(','))
                   and metadata[0]['id'] == cap['id'] and metadata[0]['mandate_id'] == draft['id']
                   and metadata[0]['tools'] == cap['tools'] and metadata[0]['revoked_at'] is None
                   and metadata[0]['created_at'] and metadata[0]['expires_at'])
        checked += 1
        cases.must(request(capability_path, outsider) == [])
        request(capability_path, anon, expected=(401, 403))
        checked += 1
        for selection in ('*', 'token_hash', capability_columns + ',token_hash'):
            request('agent_capabilities?select=' + selection + '&id=eq.' + cap['id'], owner,
                    expected=(401, 403))
            checked += 1
        request('rpc/revoke_agent_capability', outsider, {'p_capability_id': cap['id']},
                expected=(400, 401, 403))
        cases.must(request(capability_path, owner)[0]['revoked_at'] is None)
        checked += 1
        for actor in (outsider, anon):
            request('rpc/issue_agent_capability', actor, {'p_mandate_id': draft['id'],
              'p_tools': ['get_mandate'], 'p_expires_at': draft['expires_at']}, expected=(400, 401, 403))
            checked += 1

        # REST writes must not become a second authority path around the RPCs.
        before = request(capability_path, owner)
        for method, payload in (
            ('POST', {'id': str(uuid.uuid4()), 'mandate_id': draft['id'],
                      'tools': ['place_offer'], 'expires_at': draft['expires_at'], 'token_hash': '0' * 64}),
            ('PATCH', {'tools': ['place_offer', 'accept_offer']}),
            ('DELETE', None),
        ):
            path = 'agent_capabilities' + ('' if method == 'POST' else '?id=eq.' + cap['id'])
            request(path, owner, payload, method=method, expected=(401, 403))
            cases.must(request(capability_path, owner) == before)
            checked += 1
        # TRUNCATE is not a PostgREST table operation. Assert the actual SQL
        # privilege separately, with an exception subtransaction and ROLLBACK.
        truncate_result = db.sql('BEGIN;' + cases.role(f['buyer'],
            'TRUNCATE public.agent_capabilities CASCADE;')
            + "SELECT current_setting('swtest.attempt'); ROLLBACK;")
        cases.must(truncate_result.splitlines()[-1].startswith('42501:'),
                   'Authenticated direct capability TRUNCATE must be denied.')
        cases.must(request(capability_path, owner) == before)
        checked += 1

        invalid_expiries = (
            (datetime.fromisoformat(draft['expires_at']) + timedelta(seconds=1)).isoformat(),
            (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
            None,
        )
        for expiry in invalid_expiries:
            request('rpc/issue_agent_capability', owner, {'p_mandate_id': draft['id'],
              'p_tools': ['get_mandate'], 'p_expires_at': expiry}, expected=(400, 401, 403))
            cases.must(request(capability_path, owner) == before)
            checked += 1
        for tools in (None, [], ['get_mandate', None], ['approve_mandate'],
                      ['get_mandate'] * 6):
            request('rpc/issue_agent_capability', owner, {'p_mandate_id': draft['id'],
              'p_tools': tools, 'p_expires_at': draft['expires_at']}, expected=(400, 401, 403))
            cases.must(request(capability_path, owner) == before)
            checked += 1

        narrower_expiry = (datetime.fromisoformat(draft['expires_at']) - timedelta(minutes=30)).isoformat()
        read_cap = request('rpc/issue_agent_capability', owner, {'p_mandate_id': draft['id'],
          'p_tools': ['get_mandate'], 'p_expires_at': narrower_expiry})
        cases.must(read_cap['tools'] == ['get_mandate']
                   and datetime.fromisoformat(read_cap['expires_at']) == datetime.fromisoformat(narrower_expiry)
                   and request('rpc/agent_get_mandate', anon, {'p_token': read_cap['token']})['id'] == draft['id'])
        checked += 1
        request('rpc/agent_mandate_action', anon, {'p_token': read_cap['token'],
          'p_operation_key': str(uuid.uuid4()), 'p_action': 'place_offer', 'p_amount_cents': 1665},
          expected=(400, 401, 403))
        request('rpc/agent_get_deal', anon, {'p_token': read_cap['token']}, expected=(400, 401, 403))
        request('rpc/agent_revoke_mandate', anon, {'p_token': read_cap['token']}, expected=(400, 401, 403))
        cases.must(request('rpc/agent_get_mandate', anon, {'p_token': read_cap['token']})['status'] == 'approved')
        checked += 1
        all_tools = ['place_offer', 'accept_offer', 'get_mandate', 'get_deal', 'revoke_mandate']
        max_caps = [request('rpc/issue_agent_capability', owner, {'p_mandate_id': draft['id'],
          'p_tools': all_tools, 'p_expires_at': draft['expires_at']}) for _ in range(2)]
        cases.must(len({c['id'] for c in [cap, read_cap, *max_caps]}) == 4
                   and len({c['token'] for c in [cap, read_cap, *max_caps]}) == 4
                   and all(c['tools'] == all_tools for c in max_caps))
        max_metadata = request(capability_path, owner)
        cases.must(len(max_metadata) == 4
                   and all(set(c) == set(capability_columns.split(',')) for c in max_metadata))
        cases.must(request('rpc/agent_get_deal', anon, {'p_token': max_caps[0]['token']}) is None)
        checked += 1

        # Exercise the UI's exact explicit-column count/order/range contract.
        # These 57 capabilities belong only to this synthetic mandate. Tied
        # created_at values make the UUID ordering necessary at the page seam.
        all_ids = {c['id'] for c in [cap, read_cap, *max_caps]}
        for _ in range(53):
            extra = request('rpc/issue_agent_capability', owner, {'p_mandate_id': draft['id'],
              'p_tools': ['get_mandate'], 'p_expires_at': narrower_expiry})
            all_ids.add(extra['id'])
        cases.must(len(all_ids) == 57)
        db.sql("UPDATE public.agent_capabilities SET created_at=TIMESTAMPTZ '2026-01-01 00:00:00+00' "
               "WHERE mandate_id='" + draft['id'] + "';")
        page_path = ('agent_capabilities?select=' + capability_columns
                     + '&mandate_id=eq.' + draft['id'] + '&order=created_at.desc,id.desc')
        expected_ids = sorted(all_ids, reverse=True)
        seen = []
        offset = 0
        while offset < len(all_ids):
            # supabase-js .range(from,to) sends offset and inclusive length.
            page, headers = request(page_path + '&offset=' + str(offset) + '&limit=50', owner,
              extra_headers={'Prefer': 'count=exact'}, with_headers=True, expected=(200, 206))
            total = len(all_ids)
            received = min(50, total - offset)
            cases.must(len(page) == received and headers.get('content-range') ==
                       str(offset) + '-' + str(offset + received - 1) + '/' + str(total),
                       'Capability explicit-column pagination count/range mismatch.')
            cases.must('count=exact' in headers.get('preference-applied', ''),
                       'PostgREST must acknowledge exact capability count.')
            cases.must(all(set(row) == set(capability_columns.split(',')) for row in page))
            cases.must([row['id'] for row in page] == expected_ids[offset:offset + received])
            seen.extend(row['id'] for row in page)
            offset += len(page)  # Actual received count is the continuation.
            checked += 1
        cases.must(seen == expected_ids and len(seen) == len(set(seen)))
        # The equivalent HTTP Range contract must preserve the same privacy,
        # count and stable page ordering under column-only SELECT grants.
        header_page, header_metadata = request(page_path, owner,
          extra_headers={'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '50-99'},
          with_headers=True, expected=(200, 206))
        cases.must([row['id'] for row in header_page] == expected_ids[50:]
                   and header_metadata.get('content-range') == '50-56/57'
                   and all(set(row) == set(capability_columns.split(',')) for row in header_page))
        checked += 1
        outsider_page, outsider_headers = request(page_path + '&offset=0&limit=50', outsider,
          extra_headers={'Prefer': 'count=exact'}, with_headers=True)
        cases.must(outsider_page == [] and outsider_headers.get('content-range') == '*/0',
                   'Exact count must not disclose another owner\'s capabilities.')
        checked += 1

        # An approved mandate must remain reachable after more than 50 newer
        # drafts. Include another listing and another owner to test both UI
        # filters independently of the owner-only RLS backstop.
        own_drafts = [draft]
        draft_terms = {'p_listing_id': f['listing'], 'p_side': 'buy', 'p_bound_cents': 1800,
                       'p_max_rounds': 4, 'p_expires_at': draft['expires_at']}
        for _ in range(56):
            own_drafts.append(request('rpc/create_agent_mandate_draft', owner, draft_terms, single=True))
        unrelated = request('rpc/create_agent_mandate_draft', owner,
                            {**draft_terms, 'p_listing_id': f['listing2']}, single=True)
        other_owner = request('rpc/create_agent_mandate_draft', outsider, draft_terms, single=True)
        mandate_page_path = ('agent_mandates?select=*&owner_id=eq.' + f['buyer']
                             + '&listing_id=eq.' + f['listing'] + '&order=created_at.desc,id.desc')
        expected_mandates = [row['id'] for row in sorted(own_drafts,
          key=lambda row: (datetime.fromisoformat(row['created_at']), row['id']), reverse=True)]
        seen_mandates = []
        all_mandates = []
        offset = 0
        while offset < 57:
            page, headers = request(mandate_page_path + '&offset=' + str(offset) + '&limit=50', owner,
              extra_headers={'Prefer': 'count=exact'}, with_headers=True, expected=(200, 206))
            received = min(50, 57 - offset)
            cases.must(len(page) == received and headers.get('content-range') ==
                       str(offset) + '-' + str(offset + received - 1) + '/57',
                       'Own-listing mandate count/range must cover all 57 mandates.')
            cases.must('count=exact' in headers.get('preference-applied', ''))
            cases.must([row['id'] for row in page] == expected_mandates[offset:offset + received]
                       and all(row['owner_id'] == f['buyer'] and row['listing_id'] == f['listing'] for row in page))
            all_mandates.extend(page)
            seen_mandates.extend(row['id'] for row in page)
            offset += len(page)
            checked += 1
        cases.must(seen_mandates == expected_mandates and len(set(seen_mandates)) == 57
                   and unrelated['id'] not in seen_mandates and other_owner['id'] not in seen_mandates)
        cases.must(seen_mandates[-1] == draft['id'] and draft['id'] not in seen_mandates[:50])
        older_approved = next(row for row in all_mandates if row['id'] == draft['id'])
        cases.must(older_approved['status'] == 'approved')
        older_access, older_headers = request('agent_capabilities?select=' + capability_columns
          + '&mandate_id=eq.' + older_approved['id'] + '&order=created_at.desc,id.desc&offset=0&limit=50', owner,
          extra_headers={'Prefer': 'count=exact'}, with_headers=True, expected=(200, 206))
        cases.must(len(older_access) == 50 and older_headers.get('content-range') == '0-49/57'
                   and all(set(row) == set(capability_columns.split(',')) for row in older_access))
        # Exercise a real access control discovered through that older row.
        primary_ids = {row['id'] for row in [cap, read_cap, *max_caps]}
        older_access_id = next(row['id'] for row in older_access if row['id'] not in primary_ids)
        cases.must(request('rpc/revoke_agent_capability', owner, {'p_capability_id': older_access_id}) is True)
        older_revoked = request('agent_capabilities?select=' + capability_columns + '&id=eq.' + older_access_id, owner)
        cases.must(len(older_revoked) == 1 and older_revoked[0]['revoked_at'] is not None)
        checked += 1
        outsider_mandates, outsider_count = request(mandate_page_path + '&offset=0&limit=50', outsider,
          extra_headers={'Prefer': 'count=exact'}, with_headers=True)
        cases.must(outsider_mandates == [] and outsider_count.get('content-range') == '*/0',
                   'Exact mandate count must not disclose another owner\'s drafts or approvals.')
        checked += 1
        proposal = {'p_token': cap['token'], 'p_operation_key': str(uuid.uuid4()),
                    'p_action': 'place_offer', 'p_amount_cents': 1665}
        action = request('rpc/agent_mandate_action', anon, proposal)
        cases.must(action['status'] == 'succeeded' and action.get('offer_id'))
        cases.must(request('rpc/agent_mandate_action', anon, proposal) == action)
        checked += 1
        columns = 'id,mandate_id,action,status,explanation,offer_id,deal_id,created_at'
        activity = request('mandate_actions?select=' + columns + '&mandate_id=eq.' + draft['id'], owner)
        cases.must(len(activity) == 1 and activity[0]['offer_id'] == action['offer_id'])
        cases.must(request('mandate_actions?select=' + columns + '&mandate_id=eq.' + draft['id'], outsider) == [])
        checked += 1

        # Human capability revocation invalidates only that credential; its
        # original mandate and independently issued read credential stay active.
        revoked_capability = request('rpc/revoke_agent_capability', owner, {'p_capability_id': cap['id']})
        cases.must(revoked_capability is True)
        revoked_metadata = request('agent_capabilities?select=' + capability_columns + '&id=eq.' + cap['id'], owner)
        cases.must(len(revoked_metadata) == 1 and revoked_metadata[0]['revoked_at'] is not None)
        cases.must(request('rpc/revoke_agent_capability', owner, {'p_capability_id': cap['id']}) is True)
        cases.must(request('agent_capabilities?select=' + capability_columns + '&id=eq.' + cap['id'], owner) == revoked_metadata)
        checked += 1
        request('rpc/agent_get_mandate', anon, {'p_token': cap['token']}, expected=(400, 401, 403))
        request('rpc/agent_mandate_action', anon, proposal, expected=(400, 401, 403))
        request('rpc/agent_mandate_action', anon, {**proposal, 'p_operation_key': str(uuid.uuid4())},
                expected=(400, 401, 403))
        cases.must(request('mandate_actions?select=' + columns + '&mandate_id=eq.' + draft['id'], owner) == activity)
        cases.must(request('rpc/agent_get_mandate', anon, {'p_token': read_cap['token']})['status'] == 'approved')
        checked += 1
        request('rpc/revoke_agent_capability', outsider, {'p_capability_id': read_cap['id']},
                expected=(400, 401, 403))
        cases.must(request('rpc/agent_get_mandate', anon, {'p_token': read_cap['token']})['status'] == 'approved')
        checked += 1
        revoked = request('rpc/revoke_agent_mandate', owner, {'p_mandate_id': draft['id']}, single=True)
        cases.must(revoked['status'] == 'revoked')
        request('rpc/agent_get_mandate', anon, {'p_token': cap['token']}, expected=(400, 401, 403))
        request('rpc/agent_get_mandate', anon, {'p_token': read_cap['token']}, expected=(400, 401, 403))
        request('rpc/agent_get_deal', anon, {'p_token': max_caps[0]['token']}, expected=(400, 401, 403))
        request('rpc/agent_mandate_action', anon, {'p_token': max_caps[1]['token'],
          'p_operation_key': str(uuid.uuid4()), 'p_action': 'place_offer', 'p_amount_cents': 1700},
          expected=(400, 401, 403))
        checked += 1
        print(str(checked) + ' real local mandate REST contracts passed; synthetic approvals only.')
    finally:
        if created:
            cases.cleanup(db, f)


if __name__ == '__main__':
    main()
