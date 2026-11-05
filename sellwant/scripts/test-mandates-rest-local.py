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

    def request(path, authorization, payload=None, single=False, expected=200):
        headers = {'apikey': status['ANON_KEY'], 'Authorization': 'Bearer ' + authorization}
        if single:
            headers['Accept'] = 'application/vnd.pgrst.object+json'
        if payload is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(status['API_URL'] + '/rest/v1/' + path, headers=headers,
          data=None if payload is None else json.dumps(payload).encode(), method='GET' if payload is None else 'POST')
        try:
            response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            code = response.code
            data = json.load(response)
        cases.must(code in expected if isinstance(expected, tuple) else code == expected,
                   'Local REST contract failed: ' + path.split('?')[0] + ', HTTP ' + str(code))
        return data

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
        cases.must(isinstance(cap, dict) and cap['token'].startswith('swcap_'))
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
        revoked = request('rpc/revoke_agent_mandate', owner, {'p_mandate_id': draft['id']}, single=True)
        cases.must(revoked['status'] == 'revoked')
        request('rpc/agent_get_mandate', anon, {'p_token': cap['token']}, expected=(400, 401, 403))
        checked += 1
        print(str(checked) + ' real local mandate REST contracts passed; synthetic approvals only.')
    finally:
        if created:
            cases.cleanup(db, f)


if __name__ == '__main__':
    main()
