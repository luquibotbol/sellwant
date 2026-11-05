#!/usr/bin/env python3
"""Actual SDK client -> loopback Worker -> isolated PostgreSQL/PostgREST proof.

Run after ordered migrations: python3 scripts/test-mcp-local.py
No browser, hosted URL, external model or user credentials. Synthetic human
approval fixtures are not approval of a real user's mandate. Owned fixtures and
child servers are cleaned; existing application rows are never modified.
"""
import importlib.util
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mcp_mandate_cases', ROOT / 'scripts/test-mandates-local.py')
cases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cases)


def decoded(result):
    value = result.get('structuredContent')
    if value is None:
        text = [part['text'] for part in result.get('content', []) if part.get('type') == 'text']
        cases.must(len(text) == 1, 'Expected one MCP JSON result.')
        value = json.loads(text[0])
    if isinstance(value, dict) and set(value) in ({'result'}, {'data'}):
        return next(iter(value.values()))
    return value


def main():
    cases.must(len(sys.argv) == 1, 'This fixed local proof accepts no connection overrides.')
    db = cases.baseline.Local()
    status_result = subprocess.run([str(ROOT / 'node_modules/.bin/supabase'), 'status', '--output', 'json'],
                                  cwd=ROOT, capture_output=True, text=True, timeout=30)
    cases.must(status_result.returncode == 0, 'Local Supabase status unavailable.')
    status = json.loads(status_result.stdout)
    cases.must(status['API_URL'] == 'http://127.0.0.1:55321', 'Unexpected API target.')
    cases.must(db.sql("SELECT to_regprocedure('public.agent_get_access(text)') IS NOT NULL;").strip() == 't',
               'Apply the access-context migration first.')
    f = cases.fixture()
    old_marker = f['marker']
    f['marker'] = 'mcp-local-' + uuid.uuid4().hex
    f['setup'] = f['setup'].replace(old_marker, f['marker'])
    # Placing a new bid supersedes that same bidder's old offer. A genuinely
    # separate bidder is needed to exercise an open board across two pages.
    f['setup'] += f"INSERT INTO public.offers(id,listing_id,from_user,amount_cents) VALUES ('{uuid.uuid4()}','{f['listing']}','{f['other']}',1600);"
    private = ROOT / '.local/mcp-proof' / uuid.uuid4().hex
    private.mkdir(parents=True, mode=0o700)
    bun = shutil.which('bun')
    cases.must(bun is not None, 'Bun is required for the official SDK client.')
    command = [bun, str(ROOT / 'scripts/mcp-local-bridge.ts')]
    environment = {'PATH': os.environ['PATH'], 'NO_COLOR': '1'}
    if os.environ.get('TMPDIR'):
        environment['TMPDIR'] = os.environ['TMPDIR']
    server = None
    server_log = None
    created = False
    creation_attempted = False
    checked = 0

    def check(condition, label):
        nonlocal checked
        cases.must(condition, label)
        checked += 1
        print('PASS ' + label, flush=True)

    def stop():
        nonlocal server, server_log
        if server is not None:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)
            server.stdout.close()
            server = None
        if server_log:
            server_log.close()
            server_log = None

    def start():
        nonlocal server, server_log
        cases.must(server is None, 'Stop and confirm the previous server before restarting.')
        fd = os.open(private / ('server-' + uuid.uuid4().hex + '.log'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        server_log = os.fdopen(fd, 'w')
        server = subprocess.Popen(command, cwd=ROOT, env=environment, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=server_log, text=True)
        server.stdin.write(json.dumps({'mode': 'serve', 'url': status['API_URL'], 'anonKey': status['ANON_KEY']}))
        server.stdin.close()
        with selectors.DefaultSelector() as selector:
            selector.register(server.stdout, selectors.EVENT_READ)
            cases.must(selector.select(timeout=20), 'Local MCP server did not report readiness.')
            line = server.stdout.readline()
        cases.must(server.poll() is None and line, 'Local MCP server stopped before readiness; private diagnostics preserved.')
        ready = json.loads(line)
        endpoint = ready['endpoint']
        cases.must(endpoint.startswith('http://127.0.0.1:') and endpoint.endswith('/mcp'), 'Unexpected MCP target.')
        return endpoint

    def client(endpoint, token, actions):
        result = subprocess.run(command, cwd=ROOT, env=environment,
            input=json.dumps({'mode': 'client', 'endpoint': endpoint, 'token': token, 'actions': actions}),
            capture_output=True, text=True, timeout=30)
        cases.must(result.returncode == 0, 'Official local MCP client failed; request credentials were not printed.')
        cases.must(token not in result.stdout and token not in result.stderr, 'Capability leaked from MCP client.')
        return json.loads(result.stdout)

    def call(endpoint, token, name, args=None, expect_rejected=False):
        return client(endpoint, token, [{'name': name, 'arguments': args or {}, 'expectRejected': expect_rejected}])['results'][0]

    def http(endpoint, token=None, origin=None):
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if origin:
            headers['Origin'] = origin
        request = urllib.request.Request(endpoint, headers=headers,
            data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list', 'params': {}}).encode())
        try:
            response = urllib.request.urlopen(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, response.read().decode()

    try:
        setup = 'BEGIN;' + f['setup'] + cases.human(f) + cases.human(f, who='owner', key='seller', bound=1500)
        setup += cases.human(f, who='other', key='outsider')
        setup += cases.role(f['buyer'], """PERFORM set_config('mcp.read',public.issue_agent_capability(
          current_setting('swtest.buyer')::uuid,ARRAY['get_mandate','get_deal'],clock_timestamp()+interval '30 minutes')::text,true);""")
        setup += """SELECT json_build_object('buyer',current_setting('swtest.buyer_token'),
          'seller',current_setting('swtest.seller_token'),'outsider',current_setting('swtest.outsider_token'),
          'mandate',current_setting('swtest.buyer'),'read',current_setting('mcp.read')::jsonb); COMMIT;"""
        creation_attempted = True
        state = json.loads(db.sql(setup).splitlines()[-1])
        created = True
        endpoint = start()
        before = client(endpoint, state['buyer'], [{'name': 'get_mandate', 'arguments': {}}])
        names = {tool['name'] for tool in before['tools']['tools']}
        check(names == {'search_listings', 'get_going_rate', 'get_public_offers', 'get_mandate', 'get_deal', 'place_offer', 'accept_offer', 'revoke_mandate'},
              'official SDK initialization and scoped trading tool discovery')
        check(decoded(before['results'][0])['id'] == state['mandate'], 'private mandate is durable and capability scoped')
        read = client(endpoint, state['read']['token'], [])
        check({t['name'] for t in read['tools']['tools']} == {'search_listings', 'get_going_rate', 'get_public_offers', 'get_mandate', 'get_deal'},
              'read-only capability advertises no mutation tools')
        check(call(endpoint, state['read']['token'], 'place_offer', {'operation_key': str(uuid.uuid4()), 'amount_cents': 1700}, expect_rejected=True).get('isError') is True,
              'read-only capability cannot dispatch hidden mutation')
        check(http(endpoint)[0] == 401 and http(endpoint, 'swcap_' + '0' * 64)[0] == 401,
              'missing and unknown credentials rejected before protocol dispatch')
        check(http(endpoint, state['buyer'], 'https://unrelated.example')[0] == 403,
              'foreign browser Origin rejected with valid capability')
        market = decoded(call(endpoint, state['buyer'], 'search_listings', {'query': f['marker'], 'page_size': 100}))
        check({row['id'] for row in market['listings']} == {f['listing'], f['listing2']}
              and all('bound_cents' not in row and 'user_id' not in row for row in market['listings']),
              'SDK public search returns only active public listing fields')
        rate = decoded(call(endpoint, state['buyer'], 'get_going_rate', {'listing_id': f['listing']}))
        check(rate['status'] == 'available' and rate['rate_cents'] == 1665,
              'SDK going rate uses actual non-poster public offer')
        empty_rate = decoded(call(endpoint, state['buyer'], 'get_going_rate', {'listing_id': f['listing2']}))
        check(empty_rate['status'] == 'no_offers' and empty_rate['rate_cents'] is None,
              'SDK listing without offers retains explicit no-offers state')

        op = str(uuid.uuid4())
        proposal = {'operation_key': op, 'amount_cents': 1700}
        posted = decoded(call(endpoint, state['buyer'], 'place_offer', proposal))
        check(posted['status'] == 'succeeded' and posted.get('offer_id'), 'SDK offer creates real persisted public offer')
        check(decoded(call(endpoint, state['buyer'], 'place_offer', proposal)) == posted, 'same operation key returns same offer receipt')
        rejected = decoded(call(endpoint, state['buyer'], 'place_offer', {'operation_key': str(uuid.uuid4()), 'amount_cents': 1801}))
        check(rejected['status'] == 'rejected', 'real database rejects proposal above approved bound')
        check(db.sql("SELECT rounds_used FROM public.agent_mandates WHERE id='" + state['mandate'] + "';").strip() == '1',
              'duplicate and rejected proposals consume no extra negotiation rounds')

        stop()
        endpoint = start()
        check(decoded(call(endpoint, state['buyer'], 'place_offer', proposal)) == posted,
              'new Worker process resumes same persisted operation and offer')
        public = decoded(call(endpoint, state['seller'], 'get_public_offers', {'listing_id': f['listing'], 'page_size': 1}))
        if not (public.get('status') == 'active' and len(public.get('offers', [])) == 1 and not public.get('complete') and public.get('next_cursor')):
            diagnostics = {'tool_result': public, 'queries': []}
            for path in (
                'listings?select=id,user_id,status&id=eq.' + f['listing'] + '&status=eq.active&limit=1',
                'offers?select=id,listing_id,parent_offer_id,amount_cents,message,created_at,from_user,status&listing_id=eq.'
                    + f['listing'] + '&status=eq.open&order=created_at.desc,id.desc&limit=2',
            ):
                request = urllib.request.Request(status['API_URL'] + '/rest/v1/' + path,
                    headers={'apikey': status['ANON_KEY'], 'Accept': 'application/json', 'Prefer': 'count=exact'})
                try:
                    response = urllib.request.urlopen(request, timeout=10)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    diagnostics['queries'].append({'status': response.code, 'range': response.headers.get('Content-Range'),
                                                  'body': json.loads(response.read())})
            fd = os.open(private / 'public-offer-failure.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as stream:
                json.dump(diagnostics, stream)
        check(public['status'] == 'active' and len(public['offers']) == 1 and not public['complete'] and public['next_cursor'],
              'real public offer discovery returns bounded continuation')
        next_public = decoded(call(endpoint, state['seller'], 'get_public_offers',
            {'listing_id': f['listing'], 'page_size': 1, 'cursor': public['next_cursor']}))
        bids = public['offers'] + next_public['offers']
        expected_fields = {'id', 'listing_id', 'parent_offer_id', 'amount_cents', 'message', 'created_at', 'is_poster'}
        check(next_public['complete'] and next_public['next_cursor'] is None
              and len({row['id'] for row in bids}) == 2 and all(set(row) == expected_fields for row in bids),
              'public offer pages expose complete stable IDs without author/private fields')
        best_bid = max((row for row in bids if not row['is_poster']), key=lambda row: row['amount_cents'])
        check(best_bid['id'] == posted['offer_id'], 'seller discovers counter target through public MCP tool')
        counter = decoded(call(endpoint, state['seller'], 'place_offer', {'operation_key': str(uuid.uuid4()),
            'amount_cents': 1665, 'parent_offer_id': best_bid['id']}))
        check(counter['status'] == 'succeeded', 'seller capability posts bounded real counteroffer')
        board = decoded(call(endpoint, state['buyer'], 'get_public_offers', {'listing_id': f['listing'], 'page_size': 100}))
        counters = [row for row in board['offers'] if row['is_poster'] and row['parent_offer_id'] == posted['offer_id']]
        check(len(counters) == 1 and counters[0]['id'] == counter['offer_id'] and counters[0]['amount_cents'] == 1665,
              'buyer discovers exact seller counter through public MCP tool')
        accepted = decoded(call(endpoint, state['buyer'], 'accept_offer', {'operation_key': str(uuid.uuid4()), 'offer_id': counters[0]['id']}))
        check(accepted['status'] == 'succeeded' and accepted.get('deal_id'), 'SDK acceptance locks exact real deal')
        deal = decoded(call(endpoint, state['read']['token'], 'get_deal'))
        check(deal['id'] == accepted['deal_id'] and deal['locked_price_cents'] == 1665,
              'preissued read-only access retains exact deal after mandate consumption')
        check(decoded(call(endpoint, state['outsider'], 'get_deal')) is None,
              'unrelated mandate cannot retrieve another capability deal')
        check(call(endpoint, state['outsider'], 'get_deal', {'deal_id': accepted['deal_id']}, expect_rejected=True).get('isError') is True,
              'private deal tool refuses arbitrary deal selector')
        check(db.sql(f"SELECT count(*) FROM public.lock_ins WHERE listing_id='{f['listing']}' AND state<>'cancelled';").strip() == '1',
              'one persisted live deal after process restart and negotiation')
        hidden_offers = decoded(call(endpoint, state['outsider'], 'get_public_offers', {'listing_id': f['listing']}))
        hidden_rate = decoded(call(endpoint, state['outsider'], 'get_going_rate', {'listing_id': f['listing']}))
        check(hidden_offers['status'] == 'not_found' and hidden_offers['offers'] == [] and hidden_rate['status'] == 'not_found',
              'locked listing offers and agreed price absent from public MCP discovery')
        db.sql('BEGIN;' + cases.role(f['buyer'], "PERFORM public.revoke_agent_capability('" + state['read']['id'] + "');") + 'COMMIT;')
        code, body = http(endpoint, state['read']['token'])
        check(code == 401 and state['read']['token'] not in body and 'bound_cents' not in body,
              'next HTTP request rejects revoked access without private output')
        print(str(checked) + ' actual local MCP/SDK contract groups passed; no LLM or browser claimed.', flush=True)
    finally:
        stop()
        if creation_attempted:
            present = db.sql("SELECT EXISTS(SELECT 1 FROM public.listings WHERE id='" + f['listing']
                             + "' AND title='" + f['marker'] + "');").strip() == 't'
            if created or present:
                cases.cleanup(db, f)
            cases.must(db.sql("SELECT count(*) FROM auth.users WHERE email LIKE '" + f['marker'] + "%';").strip() == '0',
                       'Owned MCP fixtures remain.')
            print('Owned MCP users, mandates, actions, offers and deal removed.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, AssertionError, subprocess.TimeoutExpired) as error:
        print('Local MCP proof failed: ' + str(error) + '. Owned cleanup attempted; private diagnostics preserved.', file=sys.stderr)
        sys.exit(1)
