#!/usr/bin/env python3
"""Create/status/cleanup disposable local demo logins and two active listings.

No mandates, capabilities, offers, payments, handoffs or provider calls. Private
credentials: .local/demo/session.json. Cleanup refuses all financial associations
and any active watch. No URL, secret, environment or project override accepted.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys
import urllib.error
import urllib.request

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_test', ROOT / 'scripts/hackathon-local-test.py')
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)
DIRECTORY = ROOT / '.local/demo'
MANIFEST = DIRECTORY / 'session.json'
LOCK = DIRECTORY / 'session.lock'
API = 'http://127.0.0.1:55321'
APP = 'http://127.0.0.1:8788'


def write(plan):
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = DIRECTORY / 'session.new.json'
    with path.open('w') as target:
        os.chmod(path, 0o600)
        json.dump(plan, target, indent=2)
        target.flush()
        os.fsync(target.fileno())
    os.replace(path, MANIFEST)
    MANIFEST.chmod(0o600)


def load():
    plan = json.loads(MANIFEST.read_text())
    t.must(plan.get('version') == 1 and plan.get('api') == API and plan.get('marker', '').startswith('hackathon-demo-'), 'Unrecognized demo manifest.')
    t.must(set(plan['users']) == {'buyer', 'seller', 'outsider'} and set(plan['listings']) == {'capture', 'void'}, 'Unexpected demo scope.')
    for role, user in plan['users'].items():
        t.must(user['email'] == plan['marker'] + '-' + role + '@sellwant.test', 'Unexpected demo identity.')
        t.must(str(__import__('uuid').UUID(user['id'])) == user['id'], 'Invalid demo user ID.')
    for path, listing in plan['listings'].items():
        t.must(str(__import__('uuid').UUID(listing['id'])) == listing['id'] and listing['title'] == plan['marker'] + ' ' + path, 'Unexpected listing identity.')
    return plan


def fresh():
    marker = 'hackathon-demo-' + t.uid()
    return {'version': 1, 'api': API, 'marker': marker, 'state': 'planned',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'users': {role: {'id': t.uid(), 'email': marker + '-' + role + '@sellwant.test',
                         'password': secrets.token_urlsafe(30)} for role in ('buyer', 'seller', 'outsider')},
        'listings': {path: {'id': t.uid(), 'title': marker + ' ' + path} for path in ('capture', 'void')}}


def user_state(h, plan, role):
    user = plan['users'][role]
    return t.parsed(h.db.sql("SELECT json_build_object('count',count(*),'owned',coalesce(bool_and(id=" + t.q(user['id'])
        + '::uuid AND email=' + t.q(user['email']) + " AND raw_user_meta_data->>'fixture_marker'=" + t.q(plan['marker'])
        + '),false)) FROM auth.users WHERE id=' + t.q(user['id']) + ' OR email=' + t.q(user['email']) + ';'))


def auth(h, path, payload=None, method='POST', admin=False):
    h.rest()
    t.must(path == 'token?grant_type=password' or path == 'admin/users' or
           path.startswith('admin/users/') and method == 'DELETE', 'Unexpected local auth operation.')
    key = h.status['SERVICE_ROLE_KEY'] if admin else h.status['ANON_KEY']
    request = urllib.request.Request(API + '/auth/v1/' + path, method=method,
        headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
        data=None if payload is None else json.dumps(payload).encode())
    try:
        response = h.opener.open(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(1_000_001)
        t.must(len(raw) <= 1_000_000 and 200 <= response.code < 300,
               'Local synthetic auth action failed: HTTP ' + str(response.code) + '. Preserve manifest and reconcile IDs.')
        return json.loads(raw) if raw else None


def listing_state(h, plan, name):
    listing = plan['listings'][name]
    return t.parsed(h.db.sql("SELECT json_build_object('count',count(*),'owned',coalesce(bool_and(user_id="
        + t.q(plan['users']['seller']['id']) + '::uuid AND title=' + t.q(listing['title'])
        + " AND type='sell' AND price_cents=2000),false)) FROM public.listings WHERE id=" + t.q(listing['id']) + ';'))


def create(h):
    plan = load() if MANIFEST.exists() else fresh()
    t.must(plan['state'] != 'cleaned', 'Prior demo is cleaned; archive its private manifest before creating a new demo.')
    write(plan)  # Persist every ID and password before any network mutation.
    logins = {}
    for role, user in plan['users'].items():
        existing = user_state(h, plan, role)
        t.must(existing['count'] == 0 or existing['count'] == 1 and existing['owned'], 'Demo user ownership mismatch; nothing replaced.')
        if existing['count'] == 0:
            result = auth(h, 'admin/users', {'id': user['id'], 'email': user['email'], 'password': user['password'],
                'email_confirm': True, 'user_metadata': {'full_name': 'Synthetic demo ' + role, 'fixture_marker': plan['marker']}}, admin=True)
            t.must(result['id'] == user['id'] and result['email'] == user['email'], 'Unexpected local auth identity.')
        user['created'] = True
        write(plan)
        signed_in = auth(h, 'token?grant_type=password', {'email': user['email'], 'password': user['password']})
        t.must(signed_in['user']['id'] == user['id'], 'Unexpected synthetic sign-in identity.')
        logins[role] = signed_in['access_token']
    seller = plan['users']['seller']
    for name, listing in plan['listings'].items():
        existing = listing_state(h, plan, name)
        t.must(existing['count'] == 0 or existing['count'] == 1 and existing['owned'], 'Demo listing ownership mismatch; nothing replaced.')
        if existing['count'] == 0:
            h.request('listings', logins['seller'], {'id': listing['id'], 'user_id': seller['id'],
                'type': 'sell', 'title': listing['title'], 'price_cents': 2000, 'platform': 'bubbl',
                'description': 'Synthetic hackathon demo. No real admission rights or ticket code.', 'location': 'Synthetic test hall'})
        listing['created'] = True
        write(plan)
    plan['state'] = 'ready'
    write(plan)
    status(h, plan)


def status(h, plan):
    users = [t.q(user['id']) for user in plan['users'].values()]
    listings = [t.q(listing['id']) for listing in plan['listings'].values()]
    summary = t.parsed(h.db.sql("SELECT json_build_object('users',(SELECT count(*) FROM auth.users WHERE id IN (" + ','.join(users)
        + ")),'listings',(SELECT coalesce(json_agg(json_build_object('id',id,'state',status)),'[]') FROM public.listings WHERE id IN (" + ','.join(listings)
        + ")),'deals',(SELECT count(*) FROM public.lock_ins WHERE listing_id IN (" + ','.join(listings)
        + ")),'payments',(SELECT count(*) FROM public.deal_payments p JOIN public.lock_ins d ON d.id=p.deal_id WHERE d.listing_id IN (" + ','.join(listings)
        + ")),'active_watches',(SELECT count(*) FROM public.agent_watches WHERE owner_id IN (" + ','.join(users) + ") AND state='active'));"))
    print(json.dumps({'state': plan['state'], 'seller_id': plan['users']['seller']['id'], 'local': summary,
        'listing_urls': {name: APP + '/event/' + listing['id'] for name, listing in plan['listings'].items()},
        'private_credentials': '.local/demo/session.json', 'human_approvals': 0, 'provider_calls': 0}))


def cleanup(h, plan):
    for role in plan['users']:
        existing = user_state(h, plan, role)
        t.must(existing['count'] == 0 or existing['count'] == 1 and existing['owned'], 'Demo user ownership mismatch.')
    for name in plan['listings']:
        existing = listing_state(h, plan, name)
        t.must(existing['count'] == 0 or existing['count'] == 1 and existing['owned'], 'Demo listing ownership mismatch.')
    users = ','.join(t.q(user['id']) for user in plan['users'].values())
    listings = ','.join(t.q(listing['id']) for listing in plan['listings'].values())
    h.db.sql(f"""BEGIN;
      DO $owned$ BEGIN
        IF EXISTS(SELECT 1 FROM public.agent_watches WHERE owner_id IN ({users}) AND state='active')
          THEN RAISE EXCEPTION 'stop and review active demo watches before cleanup'; END IF;
        IF EXISTS(SELECT 1 FROM public.deal_payments p JOIN public.lock_ins d ON d.id=p.deal_id WHERE d.listing_id IN ({listings}))
          THEN RAISE EXCEPTION 'financial association exists: preserve manifest/journals and reconcile; cleanup refused'; END IF;
        IF EXISTS(SELECT 1 FROM public.listings WHERE user_id IN ({users}) AND id NOT IN ({listings}))
          THEN RAISE EXCEPTION 'unexpected listing owned by demo principal: cleanup refused'; END IF;
      END $owned$;
      DELETE FROM public.email_outbox WHERE to_profile IN ({users}) OR listing_id IN ({listings});
      DELETE FROM public.agent_watches WHERE owner_id IN ({users});
      DELETE FROM public.mandate_actions WHERE mandate_id IN (SELECT id FROM public.agent_mandates WHERE owner_id IN ({users}));
      DELETE FROM public.agent_capabilities WHERE mandate_id IN (SELECT id FROM public.agent_mandates WHERE owner_id IN ({users}));
      DELETE FROM public.agent_mandates WHERE owner_id IN ({users});
      DELETE FROM public.lock_ins WHERE listing_id IN ({listings});
      DELETE FROM public.offers WHERE listing_id IN ({listings});
      DELETE FROM public.listings WHERE id IN ({listings}); COMMIT;""")
    for role, user in plan['users'].items():
        if user_state(h, plan, role)['count']:
            auth(h, 'admin/users/' + user['id'], method='DELETE', admin=True)
    plan['state'] = 'cleaned'
    write(plan)
    status(h, plan)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('create', 'status', 'cleanup'))
    args = parser.parse_args()
    h = t.Harness('demo-setup-local', ('deal_payments', 'agent_watches'))
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.action == 'status':
        t.must(MANIFEST.exists(), 'No local demo manifest exists.')
        status(h, load())
        return
    with LOCK.open('x') as lock:
        os.chmod(LOCK, 0o600)
        lock.write(str(os.getpid()))
    try:
        if args.action == 'create':
            create(h)
        else:
            t.must(MANIFEST.exists(), 'No local demo manifest exists.')
            cleanup(h, load())
    finally:
        LOCK.unlink()


if __name__ == '__main__':
    main()
