#!/usr/bin/env python3
"""Real isolated SQL/REST tests for minimal MCP bearer authentication context.

python3 scripts/test-agent-access-local.py [--apply]
Only migration 004 can be applied. No hosted URL, credential or project options.
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
KEYS = {'id', 'mandate_id', 'tools', 'expires_at'}
TOOLS = ['place_offer', 'accept_offer', 'get_mandate', 'get_deal', 'revoke_mandate']
checked = 0


def check(condition, label):
    global checked
    cases.must(condition, label)
    checked += 1
    print('PASS ' + label)


def fixture():
    f = cases.fixture()
    marker = 'agent-access-local-' + str(uuid.uuid4())
    f['setup'] = f['setup'].replace(f['marker'], marker)
    f['marker'] = marker
    return f


def context_call(user='', role='anon', token="current_setting('swtest.buyer_token')"):
    return cases.role(user, "PERFORM set_config('swtest.result',public.agent_get_access(" + token + ")::text,true);", dbrole=role)


def metadata(result, mandate, capability, tools):
    return (isinstance(result, dict) and set(result) == KEYS and result['mandate_id'] == mandate
            and result['id'] == capability and result['tools'] == tools
            and datetime.fromisoformat(result['expires_at']) > datetime.now(timezone.utc))


def sql_case(db, label, build, success=True, tools=None):
    f = fixture()
    out = db.sql('BEGIN;' + f['setup'] + build(f) + """SELECT json_build_object(
      'attempt',current_setting('swtest.attempt',true),'result',nullif(current_setting('swtest.result',true),'')::jsonb,
      'mandate',nullif(current_setting('swtest.buyer',true),''),
      'capability',(SELECT id FROM public.agent_capabilities
        WHERE token_hash=encode(extensions.digest(current_setting('swtest.buyer_token',true),'sha256'),'hex')));
      ROLLBACK;""")
    r = json.loads(next(line for line in reversed(out.splitlines()) if line.startswith('{')))
    if success:
        check(r['attempt'] == 'ok' and metadata(r['result'],r['mandate'],r['capability'],tools or TOOLS),label)
        check(not any(value in json.dumps(r['result']) for value in (f['owner'],f['buyer'],f['other'],f['listing'],f['marker'])),
              label + ' excludes owner, listing and unrelated identity data')
    else:
        check(r['attempt'] != 'ok' and r['result'] is None,label)


def sql_cases(db):
    for tool in TOOLS:
        sql_case(db, tool + '-only capability authenticates without broader scope',
                 lambda f, tool=tool: cases.human(f,tools=[tool]) + context_call(),tools=[tool])
    sql_case(db, 'all-scope capability returns exact minimal metadata',lambda f: cases.human(f) + context_call())
    sql_case(db, 'authenticated outsider JWT gets only the supplied bearer capability context',
             lambda f: cases.human(f) + cases.human(f,who='other',key='other') + context_call(f['other'],'authenticated'))
    sql_case(db, 'nondefault array lower bound still selects an actually granted scope', lambda f: cases.human(f)
      + cases.role(f['buyer'],"""PERFORM set_config('swtest.buyer_token',public.issue_agent_capability(
        current_setting('swtest.buyer')::uuid,'[0:0]={place_offer}'::text[],clock_timestamp()+interval '30 minutes')->>'token',true);""")
      + context_call(),tools=['place_offer'])
    for literal,label in [('NULL','missing'),("''",'empty'),("'not-a-token'",'malformed'),("'swcap_'||repeat('0',64)",'unknown')]:
        sql_case(db,label + ' capability denied without private result',lambda f,literal=literal: context_call(token=literal),False)
    sql_case(db,'revoked capability denied',lambda f: cases.human(f) + cases.role(f['buyer'],
      "PERFORM public.revoke_agent_capability((SELECT id FROM public.agent_capabilities WHERE mandate_id=current_setting('swtest.buyer')::uuid));")
      + context_call(),False)
    sql_case(db,'revoked mandate denied',lambda f: cases.human(f) + cases.role(f['buyer'],
      "PERFORM public.revoke_agent_mandate(current_setting('swtest.buyer')::uuid);") + context_call(),False)
    sql_case(db,'shorter expired capability denied',lambda f: cases.human(f) + cases.role(f['buyer'],
      """PERFORM set_config('swtest.buyer_token',public.issue_agent_capability(current_setting('swtest.buyer')::uuid,
        ARRAY['get_mandate'],clock_timestamp()+interval '0.1 seconds')->>'token',true);""")
      + 'SELECT pg_sleep(0.15);' + context_call(),False)
    sql_case(db,'expired mandate denied',lambda f: cases.human(f,expire="interval '0.1 seconds'") + 'SELECT pg_sleep(0.15);' + context_call(),False)
    sql_case(db,'suspended mandate owner denied',lambda f: cases.human(f)
      + f"UPDATE public.profiles SET is_suspended=true WHERE id='{f['buyer']}';" + context_call(),False)
    sql_case(db,'persisted token cannot authenticate an unapproved draft',lambda f: cases.human(f,approve=False)
      + """SELECT set_config('swtest.buyer_token','swcap_'||repeat('a',64),true);
        INSERT INTO public.agent_capabilities(mandate_id,token_hash,tools,expires_at)
          VALUES(current_setting('swtest.buyer')::uuid,encode(extensions.digest(current_setting('swtest.buyer_token'),'sha256'),'hex'),ARRAY['get_mandate'],clock_timestamp()+interval '1 hour');"""
      + context_call(),False)
    sql_case(db,'consumed mandate retains minimal capability authentication',lambda f: cases.human(f)
      + cases.action(setting='offer_result') + cases.role(f['owner'],
        "PERFORM public.accept_offer((current_setting('swtest.offer_result')::jsonb->>'offer_id')::uuid);") + context_call())
    privileges = json.loads(db.sql("""SELECT json_build_object(
      'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service',has_function_privilege('service_role',p.oid,'EXECUTE'),
      'public',EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
      'anon_helper',has_function_privilege('anon','public._agent_capability(text,text)','EXECUTE'),
      'authenticated_helper',has_function_privilege('authenticated','public._agent_capability(text,text)','EXECUTE'))
      FROM pg_proc p WHERE p.oid='public.agent_get_access(text)'::regprocedure;"""))
    check(privileges == {'owner':'postgres','definer':True,'config':['search_path=pg_catalog, public'],
          'anon':True,'authenticated':True,'service':False,'public':False,'anon_helper':False,'authenticated_helper':False},
          'explicit function owner, search path and narrow execute ACL preserve private helper boundary')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Local REST redirect refused.')


def rest_cases(db):
    proc = subprocess.run([str(ROOT/'node_modules/.bin/supabase'),'status','--output','json'],
                          cwd=ROOT,capture_output=True,text=True,timeout=30)
    cases.must(proc.returncode == 0,'Verified local status unavailable.')
    status = json.loads(proc.stdout)
    cases.must(status['API_URL'] == 'http://127.0.0.1:55321','Unexpected local API target.')
    opener = urllib.request.build_opener(NoRedirect)
    def jwt(user):
        encoded = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b'=').decode()
        header = encoded(b'{"alg":"HS256","typ":"JWT"}')
        now = int(time.time())
        claims = encoded(json.dumps({'sub':user,'role':'authenticated','aud':'authenticated',
          'iss':status['API_URL']+'/auth/v1','iat':now,'exp':now+180}).encode())
        signature = encoded(hmac.new(status['JWT_SECRET'].encode(),(header+'.'+claims).encode(),hashlib.sha256).digest())
        return header+'.'+claims+'.'+signature
    def request(name,payload,authorization=None):
        req = urllib.request.Request(status['API_URL']+'/rest/v1/rpc/'+name,
          data=json.dumps(payload).encode(),headers={'apikey':status['ANON_KEY'],
            'Authorization':'Bearer '+(authorization or status['ANON_KEY']),'Content-Type':'application/json'})
        try:
            response = opener.open(req,timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(1_000_001)
            cases.must(len(raw)<=1_000_000,'Unexpected local response size.')
            return response.code,json.loads(raw) if raw else None
    def ok(name,payload,authorization=None):
        code,data = request(name,payload,authorization)
        cases.must(200<=code<300,'Expected local REST RPC success: '+name)
        return data
    f=fixture()
    created=False
    try:
        db.sql('BEGIN;'+f['setup']+'COMMIT;')
        created=True
        human=jwt(f['buyer'])
        outsider=jwt(f['other'])
        expiry=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()
        draft=ok('create_agent_mandate_draft',{'p_listing_id':f['listing'],'p_side':'buy','p_bound_cents':1800,
          'p_expires_at':expiry,'p_max_rounds':4},human)
        ok('approve_agent_mandate',{'p_mandate_id':draft['id'],'p_expected_hash':draft['draft_hash']},human)
        for tool in TOOLS:
            cap=ok('issue_agent_capability',{'p_mandate_id':draft['id'],'p_tools':[tool],'p_expires_at':expiry},human)
            context=ok('agent_get_access',{'p_token':cap['token']})
            check(metadata(context,draft['id'],cap['id'],[tool]),'real REST '+tool+'-only token gets exact minimal context')
            check(ok('agent_get_access',{'p_token':cap['token']},outsider)==context,
                  'real REST unrelated JWT cannot change supplied bearer scope for '+tool)
            if tool!='get_mandate':
                code,_=request('agent_get_mandate',{'p_token':cap['token']})
                check(code in (400,401,403),'introspection does not add private get_mandate scope to '+tool)
        for payload,label in [({},'omitted token'),({'p_token':None},'null token'),({'p_token':''},'empty token'),
                              ({'p_token':'swcap_'+'0'*64},'unknown token')]:
            code,data=request('agent_get_access',payload)
            check(code in (400,401,403,404) and not KEYS.issubset(data or {}),'real REST denies '+label+' without context')
        cap=ok('issue_agent_capability',{'p_mandate_id':draft['id'],'p_tools':['get_deal'],'p_expires_at':expiry},human)
        code,_=request('_agent_capability',{'p_token':cap['token'],'p_tool':'get_deal'})
        check(code in (401,403,404),'private authority helper remains unavailable over REST')
        ok('revoke_agent_capability',{'p_capability_id':cap['id']},human)
        code,data=request('agent_get_access',{'p_token':cap['token']})
        check(code in (400,401,403) and not KEYS.issubset(data or {}),'real REST revoked token denied')
        cap=ok('issue_agent_capability',{'p_mandate_id':draft['id'],'p_tools':['place_offer'],'p_expires_at':expiry},human)
        db.sql(f"UPDATE public.profiles SET is_suspended=true WHERE id='{f['buyer']}';")
        code,data=request('agent_get_access',{'p_token':cap['token']})
        check(code in (400,401,403) and not KEYS.issubset(data or {}),'real REST suspended owner token denied')
    finally:
        if created:
            cases.cleanup(db,f)


def lock_wait(db,target):
    f=fixture()
    setup=cases.human(f)
    if target in ('mandate_expiry','profile_expiry'):
        setup+=cases.role(f['buyer'],"""PERFORM set_config('swtest.buyer_token',public.issue_agent_capability(
          current_setting('swtest.buyer')::uuid,ARRAY['place_offer'],clock_timestamp()+interval '1 second')->>'token',true);""")
    out=db.sql('BEGIN;'+f['setup']+setup+"SELECT json_build_object('mandate',current_setting('swtest.buyer'),'token',current_setting('swtest.buyer_token')); COMMIT;")
    state=json.loads(next(line for line in reversed(out.splitlines()) if line.startswith('{')))
    marker=f['marker']
    def wait(name,predicate):
        limit=time.monotonic()+4
        while time.monotonic()<limit:
            if db.sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name="+cases.baseline.qs(name)+' AND '+predicate+');').strip()=='t':
                return
            time.sleep(.025)
        raise AssertionError('Expected confirmed live access-context wait.')
    try:
        if target=='mandate_expiry':
            blocker_sql=f"SELECT id FROM public.agent_mandates WHERE id='{state['mandate']}' FOR UPDATE;"
        elif target=='profile_expiry':
            blocker_sql=f"SELECT id FROM public.profiles WHERE id='{f['buyer']}' FOR UPDATE;"
        elif target=='suspension':
            blocker_sql=f"UPDATE public.profiles SET is_suspended=true WHERE id='{f['buyer']}';"
        else:
            blocker_sql=f"UPDATE public.agent_mandates SET status='revoked',revoked_at=clock_timestamp() WHERE id='{state['mandate']}';"
        with ThreadPoolExecutor(max_workers=2) as pool:
            blocker=pool.submit(db.sql,f"SET application_name='{marker}-block'; BEGIN; {blocker_sql} SELECT pg_sleep(1.8); COMMIT;")
            wait(marker+'-block',"wait_event='PgSleep'")
            actor=pool.submit(db.sql,f"SET application_name='{marker}-actor'; BEGIN;"+context_call(token=cases.baseline.qs(state['token']))
              +"SELECT json_build_object('attempt',current_setting('swtest.attempt',true),'result',nullif(current_setting('swtest.result',true),'')::jsonb); COMMIT;")
            wait(marker+'-actor',"wait_event_type='Lock'")
            out=actor.result()
            blocker.result()
        r=json.loads(next(line for line in reversed(out.splitlines()) if line.startswith('{')))
        check(r['attempt']!='ok' and r['result'] is None,'access context rechecks '+target+' after confirmed lock wait')
    finally:
        cases.cleanup(db,f)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    db=cases.baseline.Local()
    helper=db.sql("SELECT pg_get_functiondef('public._agent_capability(text,text)'::regprocedure);")
    cases.must('NOT p.is_suspended' in helper,'Apply existing privacy migration 003 before access context.')
    if args.apply:
        cases.must(db.sql("SELECT to_regprocedure('public.agent_get_access(text)') IS NULL;").strip()=='t','Refusing to replace an existing access-context function.')
        db.sql((ROOT/'supabase/migrations/202611050004_agent_access_context.sql').read_text())
        print('Applied only additive migration 004 to the guarded isolated local database.')
    cases.must(db.sql("SELECT to_regprocedure('public.agent_get_access(text)') IS NOT NULL;").strip()=='t','Apply reviewed access-context migration 004 locally first.')
    sql_cases(db)
    rest_cases(db)
    for target in ('mandate_expiry','profile_expiry','suspension','revocation'):
        lock_wait(db,target)
    check(db.sql("SELECT count(*) FROM auth.users WHERE email LIKE 'agent-access-local-%@example.edu';").strip()=='0',
          'all owned committed access-context fixture users removed')
    print(str(checked)+' real local access-context checks passed.')


if __name__=='__main__':
    main()
