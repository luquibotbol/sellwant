#!/usr/bin/env python3
"""Real mandate role/limit/idempotency/race tests on the fixed isolated local DB.

python3 scripts/test-mandates-local.py [--apply]
No URL/credentials/production target accepted. Ordinary cases ROLLBACK; races
use uniquely marked synthetic users/listings with ownership-checked cleanup.
--apply is allowed only after baseline restore + core authorization verification.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("baseline_local", ROOT / "scripts/schema-baseline-local.py")
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)
passed = 0


def uid():
    return str(uuid.uuid4())


def fixture():
    f = {k: uid() for k in ("owner", "buyer", "other", "listing", "listing2", "offer")}
    f["marker"] = "mandates-local-" + uid()
    f["setup"] = f"""
      INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
        ('{f['owner']}','{f['marker']}-owner@example.edu','{{"full_name":"Synthetic mandate owner"}}'),
        ('{f['buyer']}','{f['marker']}-buyer@example.edu','{{"full_name":"Synthetic mandate buyer"}}'),
        ('{f['other']}','{f['marker']}-other@example.edu','{{"full_name":"Synthetic mandate outsider"}}');
      INSERT INTO public.listings(id,user_id,type,title,price_cents,platform) VALUES
        ('{f['listing']}','{f['owner']}','sell','{f['marker']}',2000,'bubbl'),
        ('{f['listing2']}','{f['owner']}','sell','{f['marker']}-other',2000,'bubbl');
      INSERT INTO public.offers(id,listing_id,from_user,amount_cents)
        VALUES('{f['offer']}','{f['listing']}','{f['buyer']}',1665);
    """
    return f


def role(user, statement, key="attempt", dbrole="authenticated"):
    claims = json.dumps({"sub": user or None, "role": dbrole})
    return f"""SET LOCAL ROLE {dbrole};
      SELECT set_config('request.jwt.claim.sub','{user}',true),
        set_config('request.jwt.claims','{claims}',true);
      DO $attempt$ BEGIN
        {statement}
        PERFORM set_config('swtest.{key}','ok',true);
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('swtest.{key}',SQLSTATE || ':' || SQLERRM,true);
      END $attempt$;
      RESET ROLE;"""


def human(f, who="buyer", key="buyer", bound=1800, rounds=4, expire="interval '1 hour'", approve=True, tools=None):
    side = "sell" if who == "owner" else "buy"
    tools = tools or ["place_offer", "accept_offer", "get_mandate", "get_deal", "revoke_mandate"]
    arr = "ARRAY[" + ",".join(baseline.qs(t) for t in tools) + "]::text[]"
    return role(f[who], f"""
      DECLARE_MANDATE_PLACEHOLDER
      PERFORM set_config('swtest.{key}',(public.create_agent_mandate_draft(
        '{f['listing']}','{side}',{bound},clock_timestamp()+{expire},{rounds})).id::text,true);
      {f'''PERFORM public.approve_agent_mandate(current_setting('swtest.{key}')::uuid,
        (SELECT draft_hash FROM public.agent_mandates WHERE id=current_setting('swtest.{key}')::uuid));
      PERFORM set_config('swtest.{key}_token',public.issue_agent_capability(
        current_setting('swtest.{key}')::uuid,{arr},
        (SELECT expires_at FROM public.agent_mandates WHERE id=current_setting('swtest.{key}')::uuid))->>'token',true);''' if approve else ''}
    """.replace("DECLARE_MANDATE_PLACEHOLDER", ""), "setup_" + key)


def action(key="buyer", kind="place_offer", amount="1665", offer="NULL", parent="NULL", op=None, setting="result", extras=""):
    op = op or uid()
    return role("", f"""PERFORM set_config('swtest.{setting}',public.agent_mandate_action(
      current_setting('swtest.{key}_token'),'{op}','{kind}',{amount},{offer},{parent}{extras})::text,true);""", dbrole="anon")


def result_expr(key="result"):
    return f"nullif(current_setting('swtest.{key}',true),'')::jsonb"


def inspect(f, extra=""):
    return f"""SELECT json_build_object(
      'attempt',current_setting('swtest.attempt',true),'result',{result_expr()},
      'mandates',(SELECT coalesce(json_agg(json_build_object('id',id,'owner_id',owner_id,'status',status,'rounds',rounds_used,
        'approved_by',approved_by,'deal_id',deal_id) ORDER BY owner_id),'[]') FROM public.agent_mandates WHERE listing_id='{f['listing']}'),
      'actions',(SELECT count(*) FROM public.mandate_actions a JOIN public.agent_mandates m ON m.id=a.mandate_id WHERE m.listing_id='{f['listing']}'),
      'offers',(SELECT count(*) FROM public.offers WHERE listing_id='{f['listing']}'),
      'deals',(SELECT count(*) FROM public.lock_ins WHERE listing_id='{f['listing']}'),
      'prices',(SELECT coalesce(json_agg(locked_price_cents),'[]') FROM public.lock_ins WHERE listing_id='{f['listing']}'),
      'roles',(SELECT coalesce(json_agg(json_build_object('buyer',buyer_id,'seller',seller_id)),'[]') FROM public.lock_ins WHERE listing_id='{f['listing']}'),
      'listing',(SELECT status FROM public.listings WHERE id='{f['listing']}') {extra});"""


def check(db, name, build, verify):
    global passed
    f = fixture()
    out = db.sql("BEGIN;" + f["setup"] + build(f) + inspect(f) + "ROLLBACK;")
    r = json.loads(next(line for line in reversed(out.splitlines()) if line.startswith('{')))
    try:
        verify(r, f)
    except Exception:
        # No raw capability or private source data is included in this summary.
        raise AssertionError(name + " failed: " + json.dumps(r)) from None
    passed += 1
    print("PASS " + name)


def must(value, message="assertion failed"):
    if not value:
        raise AssertionError(message)


def denied(r, _):
    must(r["attempt"] != "ok")


def succeeded(r, _):
    must(r["attempt"] == "ok" and r["result"]["status"] == "succeeded")


def rejected(r, _):
    must(r["attempt"] == "ok" and r["result"]["status"] == "rejected")


def cases(db):
    check(db, "partial unique index rejects a second live deal", lambda f: f"""
      INSERT INTO public.lock_ins(listing_id,buyer_id,seller_id,locked_price_cents) VALUES('{f['listing']}','{f['buyer']}','{f['owner']}',1665);
      DO $test$ BEGIN
        BEGIN INSERT INTO public.lock_ins(listing_id,buyer_id,seller_id,locked_price_cents)
          VALUES('{f['listing']}','{f['other']}','{f['owner']}',1700);
          PERFORM set_config('swtest.attempt','ok',true);
        EXCEPTION WHEN unique_violation THEN PERFORM set_config('swtest.attempt',SQLSTATE,true); END;
      END $test$;""", lambda r, _: must(r['attempt']=='23505' and r['deals']==1))
    check(db, "partial unique index permits reaccept after cancellation", lambda f: f"""
      INSERT INTO public.lock_ins(listing_id,buyer_id,seller_id,locked_price_cents) VALUES('{f['listing']}','{f['buyer']}','{f['owner']}',1665);
      """+role(f['owner'],f"PERFORM public.advance_deal((SELECT id FROM public.lock_ins WHERE listing_id='{f['listing']}'),'cancelled');")
      +role(f['buyer'],f"PERFORM public.place_offer('{f['listing']}',1700);")
      +role(f['owner'],f"PERFORM public.accept_offer((SELECT id FROM public.offers WHERE listing_id='{f['listing']}' AND status='open'));"),
      lambda r, _: must(r['attempt']=='ok' and r['deals']==2 and r['listing']=='locked'))
    check(db, "human approval binds exact immutable draft hash", lambda f: human(f),
          lambda r, f: must(r["mandates"][0]["status"] == "approved" and r["mandates"][0]["approved_by"] == f['buyer']))
    for who, dbrole in [("other", "authenticated"), ("", "authenticated"), ("", "anon")]:
        check(db, f"{who or 'no UID'} {dbrole} cannot approve another mandate",
              lambda f, who=who, dbrole=dbrole: human(f, approve=False) + role(f.get(who, ''),
                "PERFORM public.approve_agent_mandate(current_setting('swtest.buyer')::uuid,"
                "(SELECT draft_hash FROM public.agent_mandates WHERE id=current_setting('swtest.buyer')::uuid));", dbrole=dbrole), denied)
    check(db, "wrong reviewed hash cannot approve", lambda f: human(f, approve=False) + role(f['buyer'],
      "PERFORM public.approve_agent_mandate(current_setting('swtest.buyer')::uuid,repeat('0',64));"), denied)
    check(db, "draft cannot issue capability", lambda f: human(f, approve=False) + role(f['buyer'],
      "PERFORM public.issue_agent_capability(current_setting('swtest.buyer')::uuid,ARRAY['place_offer'],clock_timestamp()+interval '30 minutes');"), denied)
    check(db, "human cannot edit approved terms directly", lambda f: human(f) + role(f['buyer'],
      "UPDATE public.agent_mandates SET bound_cents=9999 WHERE id=current_setting('swtest.buyer')::uuid;"), denied)
    check(db, "immutable terms survive privileged accidental edits", lambda f: human(f) + """DO $test$ BEGIN
      BEGIN UPDATE public.agent_mandates SET bound_cents=9999 WHERE id=current_setting('swtest.buyer')::uuid;
        PERFORM set_config('swtest.attempt','ok',true);
      EXCEPTION WHEN OTHERS THEN PERFORM set_config('swtest.attempt',SQLERRM,true); END;
      END $test$;""", denied)
    check(db, "outsider cannot read private mandate bound", lambda f: human(f) + role(f['other'],
      "IF EXISTS(SELECT 1 FROM public.agent_mandates) THEN RAISE EXCEPTION 'private mandate leaked'; END IF;"),
      lambda r, _: must(r['attempt'] == 'ok'))
    check(db, "anonymous has no private mandate table read", lambda f: human(f) + role('',
      "PERFORM * FROM public.agent_mandates;", dbrole='anon'), denied)
    check(db, "token hash column cannot be read by human", lambda f: human(f) + role(f['buyer'],
      "PERFORM token_hash FROM public.agent_capabilities;"), denied)
    check(db, "raw token never stored", lambda f: human(f) + """DO $test$ BEGIN
      IF EXISTS (SELECT 1 FROM public.agent_capabilities WHERE token_hash=current_setting('swtest.buyer_token'))
        OR NOT EXISTS(SELECT 1 FROM public.agent_capabilities WHERE token_hash=encode(extensions.digest(current_setting('swtest.buyer_token'),'sha256'),'hex'))
      THEN RAISE EXCEPTION 'token hashing failed'; END IF;
      END $test$;""", lambda r, _: must(len(r['mandates']) == 1))
    for cents in (1799, 1800, 1801):
        check(db, f"buy maximum 1800 tested at {cents}", lambda f, cents=cents: human(f) + action(amount=str(cents)),
          lambda r, _, cents=cents: must(r['result']['status'] == ('succeeded' if cents <= 1800 else 'rejected')
            and r['mandates'][0]['rounds'] == (1 if cents <= 1800 else 0)))
    for cents in (1499, 1500, 1501):
        check(db, f"sell minimum 1500 tested at {cents}",
          lambda f, cents=cents: human(f, who='owner', key='seller', bound=1500) + action(key='seller', amount=str(cents), parent=f"'{f['offer']}'"),
          lambda r, _, cents=cents: must(r['result']['status'] == ('succeeded' if cents >= 1500 else 'rejected')))
    check(db, "fractional cents cannot select integer RPC signature", lambda f: human(f) + action(amount='1665.5'), denied)
    check(db, "zero cents rejected without consuming a round", lambda f: human(f) + action(amount='0'),
      lambda r, _: must(r['result']['status'] == 'rejected' and r['mandates'][0]['rounds'] == 0))
    check(db, "wrong role draft rejected", lambda f: role(f['owner'],
      f"PERFORM public.create_agent_mandate_draft('{f['listing']}','buy',1800,clock_timestamp()+interval '1 hour',4);"), denied)
    check(db, "unknown currency cannot extend draft RPC", lambda f: role(f['buyer'],
      f"PERFORM public.create_agent_mandate_draft('{f['listing']}','buy',1800,clock_timestamp()+interval '1 hour',4,'EUR');"), denied)
    check(db, "capability may not expand expiry", lambda f: human(f) + role(f['buyer'],
      "PERFORM public.issue_agent_capability(current_setting('swtest.buyer')::uuid,ARRAY['place_offer'],clock_timestamp()+interval '2 hours');"), denied)
    check(db, "capability cannot invoke unapproved tool", lambda f: human(f, tools=['get_mandate']) + action(), denied)
    check(db, "capability cannot human-approve", lambda f: human(f, approve=False) + role('',
      "PERFORM public.approve_agent_mandate(current_setting('swtest.buyer')::uuid,repeat('0',64));", dbrole='anon'), denied)
    check(db, "revoked mandate stops agent", lambda f: human(f) + role(f['buyer'],
      "PERFORM public.revoke_agent_mandate(current_setting('swtest.buyer')::uuid);") + action(), denied)
    check(db, "revoked capability stops agent", lambda f: human(f) + role(f['buyer'],
      "PERFORM public.revoke_agent_capability((SELECT id FROM public.agent_capabilities WHERE mandate_id=current_setting('swtest.buyer')::uuid));") + action(), denied)
    for tool in ('agent_get_mandate','agent_get_deal'):
        check(db, f"revoked mandate denies scoped {tool} read", lambda f, tool=tool: human(f) + role(f['buyer'],
          "PERFORM public.revoke_agent_mandate(current_setting('swtest.buyer')::uuid);") + role('',
          f"PERFORM public.{tool}(current_setting('swtest.buyer_token'));",dbrole='anon'), denied)
    check(db, "agent can narrow authority by revoking its own mandate", lambda f: human(f) + role('',
      "PERFORM public.agent_revoke_mandate(current_setting('swtest.buyer_token'));",dbrole='anon') + action(), denied)
    check(db, "expired mandate cannot act", lambda f: human(f, expire="interval '0.2 seconds'") + "SELECT pg_sleep(0.25);" + action(), denied)
    check(db, "round budget checked in transaction", lambda f: human(f, rounds=1) + action(setting='first') + action(amount='1700'),
      lambda r, _: must(r['result']['status']=='rejected' and r['mandates'][0]['rounds']==1 and r['actions']==2))
    op = uid()
    check(db, "duplicate operation posts once and consumes one round", lambda f: human(f) + action(op=op, setting='first') + action(op=op),
      lambda r, _: must(r['result']['status']=='succeeded' and r['mandates'][0]['rounds']==1 and r['actions']==1 and r['offers']==2))
    op = uid()
    check(db, "operation key cannot change proposal", lambda f: human(f) + action(op=op) + action(op=op, amount='1700'), denied)
    check(db, "cross-listing parent rejected", lambda f: human(f) + f"""INSERT INTO public.offers(id,listing_id,from_user,amount_cents)
      VALUES ('{uid()}','{f['listing2']}','{f['owner']}',1665);""" + action(parent=f"(SELECT id FROM public.offers WHERE listing_id='{f['listing2']}')"), rejected)
    check(db, "poster cannot mint own top-level demand", lambda f: human(f, who='owner',key='seller',bound=1500) + action(key='seller'), rejected)
    check(db, "self acceptance rejected", lambda f: human(f) + action(kind='accept_offer',amount='NULL',offer=f"'{f['offer']}'"), rejected)
    check(db, "changed event snapshot stops agent", lambda f: human(f) + f"UPDATE public.listings SET title='Changed event' WHERE id='{f['listing']}';" + action(), rejected)
    def suspended_denied(r, _):
        # Privacy hardening may reject unavailable token authority before the
        # bounded-proposal audit. Both paths must leave public trading untouched.
        unavailable = r['attempt'] != 'ok' and r['result'] is None and r['actions'] == 0
        rejected_proposal = r['attempt'] == 'ok' and r['result']['status'] == 'rejected' and r['actions'] == 1
        must((unavailable or rejected_proposal) and r['deals'] == 0 and r['offers'] == 1
             and all(m['rounds'] == 0 for m in r['mandates']))
    for who in ('buyer', 'owner'):
        check(db, f"suspended {who} stops action", lambda f, who=who: human(f) + f"UPDATE public.profiles SET is_suspended=true WHERE id='{f[who]}';" + action(), suspended_denied)
    for listing_type in ('sell', 'ask'):
        # Swap sides and bounds for ask: poster buys, external participant sells.
        prefix = lambda f, listing_type=listing_type: (f"UPDATE public.listings SET type='{listing_type}' WHERE id='{f['listing']}';" if listing_type=='ask' else '')
        if listing_type == 'sell':
            build = lambda f: human(f) + action(setting='offer_result') + human(f,who='owner',key='seller',bound=1500) + action(
              key='seller',kind='accept_offer',amount='NULL',offer="(current_setting('swtest.offer_result')::jsonb->>'offer_id')::uuid")
        else:
            def build(f):
                return prefix(f) + role(f['buyer'], f"""PERFORM set_config('swtest.buyer',(public.create_agent_mandate_draft('{f['listing']}','sell',1500,clock_timestamp()+interval '1 hour',4)).id::text,true);
                  PERFORM public.approve_agent_mandate(current_setting('swtest.buyer')::uuid,(SELECT draft_hash FROM public.agent_mandates WHERE id=current_setting('swtest.buyer')::uuid));
                  PERFORM set_config('swtest.buyer_token',public.issue_agent_capability(current_setting('swtest.buyer')::uuid,ARRAY['place_offer'],clock_timestamp()+interval '30 minutes')->>'token',true);""") + action(setting='offer_result') + role(f['owner'],f"""
                  PERFORM set_config('swtest.seller',(public.create_agent_mandate_draft('{f['listing']}','buy',1800,clock_timestamp()+interval '1 hour',4)).id::text,true);
                  PERFORM public.approve_agent_mandate(current_setting('swtest.seller')::uuid,(SELECT draft_hash FROM public.agent_mandates WHERE id=current_setting('swtest.seller')::uuid));
                  PERFORM set_config('swtest.seller_token',public.issue_agent_capability(current_setting('swtest.seller')::uuid,ARRAY['accept_offer'],clock_timestamp()+interval '30 minutes')->>'token',true);""") + action(key='seller',kind='accept_offer',amount='NULL',offer="(current_setting('swtest.offer_result')::jsonb->>'offer_id')::uuid")
        check(db, f"two approved {listing_type} mandates lock exact bounded deal", build,
          lambda r, f, listing_type=listing_type: must(r['result']['status']=='succeeded' and r['deals']==1 and r['prices']==[1665]
            and all(m['status']=='consumed' for m in r['mandates'])
            and r['roles']==[{'buyer':f['buyer'] if listing_type=='sell' else f['owner'], 'seller':f['owner'] if listing_type=='sell' else f['buyer']}]))
    check(db, "buyer mandate accepts seller counter addressed to buyer", lambda f: human(f,who='owner',key='seller',bound=1500)
      + action(key='seller',amount='1700',parent=f"'{f['offer']}'",setting='offer_result') + human(f)
      + action(kind='accept_offer',amount='NULL',offer="(current_setting('swtest.offer_result')::jsonb->>'offer_id')::uuid"),
      lambda r, f: must(r['result']['status']=='succeeded' and r['prices']==[1700] and r['roles']==[{'buyer':f['buyer'],'seller':f['owner']}]))
    check(db, "manual acceptance consumes agent source mandate", lambda f: human(f) + action(setting='offer_result') + role(f['owner'],
      "PERFORM public.accept_offer((current_setting('swtest.offer_result')::jsonb->>'offer_id')::uuid);"),
      lambda r, _: must(r['attempt']=='ok' and r['deals']==1 and r['mandates'][0]['status']=='consumed'))
    check(db, "manual acceptance cannot use revoked agent offer", lambda f: human(f) + action(setting='offer_result') + role(f['buyer'],
      "PERFORM public.revoke_agent_mandate(current_setting('swtest.buyer')::uuid);") + role(f['owner'],
      "PERFORM public.accept_offer((current_setting('swtest.offer_result')::jsonb->>'offer_id')::uuid);"),
      lambda r, _: must(r['attempt']!='ok' and r['deals']==0))
    check(db, "manual acceptance cannot use expired agent offer", lambda f: human(f,expire="interval '0.2 seconds'") + action(setting='offer_result')
      + "SELECT pg_sleep(0.25);" + role(f['owner'],"PERFORM public.accept_offer((current_setting('swtest.offer_result')::jsonb->>'offer_id')::uuid);"),
      lambda r, _: must(r['attempt']!='ok' and r['deals']==0))
    check(db, "rejected proposal remains idempotent without round consumption", lambda f: human(f) + action(amount='1801',op=op) + action(amount='1801',op=op),
      lambda r, _: must(r['result']['status']=='rejected' and r['actions']==1 and r['mandates'][0]['rounds']==0))


def races(db):
    global passed
    # Synthetic rows commit only for independent sessions; cleanup verifies their
    # marker before deleting dependents in FK order, never global table contents.
    f = fixture()
    setup = human(f) + action(setting='offer_result')
    out = db.sql('BEGIN;' + f['setup'] + setup + f"""SELECT json_build_object(
      'mandate',current_setting('swtest.buyer'),'token',current_setting('swtest.buyer_token'),
      'offer',current_setting('swtest.offer_result')::jsonb->>'offer_id'); COMMIT;""")
    state = json.loads(next(line for line in reversed(out.splitlines()) if line.startswith('{')))
    try:
        operation = uid()
        def duplicate():
            return db.sql('BEGIN;' + role('', f"""PERFORM set_config('swtest.result',public.agent_mandate_action(
              '{state['token']}','{operation}','place_offer',1700)::text,true);""", dbrole='anon')
              + "SELECT current_setting('swtest.result'); COMMIT;")
        with ThreadPoolExecutor(max_workers=2) as pool:
            duplicates = list(pool.map(lambda _: duplicate(), range(2)))
        results = [json.loads(next(line for line in reversed(r.splitlines()) if line.startswith('{'))) for r in duplicates]
        must(results[0] == results[1] and results[0]['status']=='succeeded')
        must(db.sql(f"SELECT rounds_used||':'||(SELECT count(*) FROM public.mandate_actions WHERE mandate_id='{state['mandate']}') FROM public.agent_mandates WHERE id='{state['mandate']}';").strip() == '2:2')
        state['offer'] = results[0]['offer_id']
        passed += 1
        print('PASS concurrent duplicate agent operation consumes one additional round')
        def accept():
            return db.sql('BEGIN;' + role(f['owner'], f"PERFORM public.accept_offer('{state['offer']}');")
              + "SELECT current_setting('swtest.attempt'); COMMIT;")
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: accept(), range(2)))
        must(sum(r.splitlines()[-1] == 'ok' for r in results) == 1)
        must(db.sql(f"SELECT count(*) FROM public.lock_ins WHERE listing_id='{f['listing']}' AND state<>'cancelled';").strip() == '1')
        passed += 1
        print('PASS simultaneous manual acceptances of agent offer create one deal')
    finally:
        cleanup(db, f)


def cleanup(db, f):
    db.sql(f"""BEGIN;
          DO $ownership$ BEGIN
            IF (SELECT title FROM public.listings WHERE id='{f['listing']}') IS DISTINCT FROM '{f['marker']}'
              OR (SELECT count(*) FROM auth.users WHERE id IN ('{f['owner']}','{f['buyer']}','{f['other']}') AND email LIKE '{f['marker']}-%@example.edu')<>3
            THEN RAISE EXCEPTION 'fixture ownership mismatch'; END IF;
          END $ownership$;
          DELETE FROM public.mandate_actions WHERE mandate_id IN (SELECT id FROM public.agent_mandates WHERE listing_id IN ('{f['listing']}','{f['listing2']}'));
          DELETE FROM public.agent_capabilities WHERE mandate_id IN (SELECT id FROM public.agent_mandates WHERE listing_id IN ('{f['listing']}','{f['listing2']}'));
          DELETE FROM public.agent_mandates WHERE listing_id IN ('{f['listing']}','{f['listing2']}');
          DELETE FROM public.lock_ins WHERE listing_id IN ('{f['listing']}','{f['listing2']}');
          DO $outbox$ BEGIN
            IF to_regclass('public.email_outbox') IS NOT NULL THEN
              DELETE FROM public.email_outbox WHERE listing_id IN ('{f['listing']}','{f['listing2']}');
            END IF;
          END $outbox$;
          DELETE FROM public.offers WHERE listing_id IN ('{f['listing']}','{f['listing2']}');
          DELETE FROM public.listings WHERE id IN ('{f['listing']}','{f['listing2']}');
          DELETE FROM auth.users WHERE id IN ('{f['owner']}','{f['buyer']}','{f['other']}');
          COMMIT;""")


def lock_wait_expiry(db, kind):
    global passed
    f = fixture()
    marker = f['marker']
    if kind in ('capability','trigger_capability'):
        setup = human(f) + role(f['buyer'], """PERFORM set_config('swtest.buyer_token',public.issue_agent_capability(
          current_setting('swtest.buyer')::uuid,ARRAY['place_offer'],clock_timestamp()+interval '1 second')->>'token',true);""")
    else:
        setup = human(f, expire="interval '1 second'")
    if kind == 'manual_source':
        setup += action(setting='offer_result')
    out = db.sql('BEGIN;' + f['setup'] + setup + """SELECT json_build_object('token',current_setting('swtest.buyer_token'),
      'offer',nullif(current_setting('swtest.offer_result',true),'')::jsonb->>'offer_id'); COMMIT;""")
    state = json.loads(next(line for line in reversed(out.splitlines()) if line.startswith('{')))
    def wait_for(predicate):
        limit = time.monotonic() + 3
        while time.monotonic() < limit:
            if db.sql(predicate).strip()=='t':
                return
            time.sleep(.025)
        raise AssertionError('Expected a confirmed live local PostgreSQL wait.')
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            target = f"public.offers WHERE id='{f['offer']}'" if kind.startswith('trigger_') else f"public.listings WHERE id='{f['listing']}'"
            blocker = pool.submit(db.sql, f"""SET application_name='{marker}-block'; BEGIN;
              SELECT id FROM {target} FOR UPDATE;
              SELECT pg_sleep(1.8); COMMIT;""")
            wait_for(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{marker}-block' AND wait_event='PgSleep');")
            statement = (f"PERFORM public.accept_offer('{state['offer']}');" if kind=='manual_source' else
              f"PERFORM set_config('swtest.result',public.agent_mandate_action('{state['token']}','{uid()}','place_offer',1700)::text,true);")
            actor = pool.submit(db.sql, f"SET application_name='{marker}-actor'; BEGIN;" + role(
              f['owner'] if kind=='manual_source' else '', statement, dbrole='authenticated' if kind=='manual_source' else 'anon')
              + "SELECT json_build_object('attempt',current_setting('swtest.attempt',true),'result',nullif(current_setting('swtest.result',true),'')::jsonb); COMMIT;")
            wait_for(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{marker}-actor' AND wait_event_type='Lock');")
            output = actor.result()
            blocker.result()
        r = json.loads(next(line for line in reversed(output.splitlines()) if line.startswith('{')))
        if kind=='manual_source':
            must(r['attempt']!='ok')
        else:
            must(r['attempt']=='ok' and r['result']['status']=='rejected')
        must(db.sql(f"SELECT count(*) FROM public.lock_ins WHERE listing_id='{f['listing']}';").strip()=='0')
        must(db.sql(f"SELECT rounds_used FROM public.agent_mandates WHERE listing_id='{f['listing']}';").strip()==('1' if kind=='manual_source' else '0'))
        if kind.startswith('trigger_'):
            must(db.sql(f"SELECT count(*) FROM public.offers WHERE listing_id='{f['listing']}';").strip()=='1')
        passed += 1
        print('PASS '+kind+' expiry during confirmed row-lock wait blocks trade')
    finally:
        cleanup(db, f)


def late_source_mapping(db, agent):
    global passed
    f=fixture()
    marker=f['marker']
    setup=human(f)
    if agent:
        setup+=human(f,who='owner',key='seller',bound=1500)
    out=db.sql('BEGIN;'+f['setup']+setup+"""SELECT json_build_object('source',current_setting('swtest.buyer'),
      'capability',(SELECT id FROM public.agent_capabilities WHERE mandate_id=current_setting('swtest.buyer')::uuid),
      'actor_token',nullif(current_setting('swtest.seller_token',true),'')); COMMIT;""")
    state=json.loads(next(line for line in reversed(out.splitlines()) if line.startswith('{')))
    def wait_for(name,event):
        limit=time.monotonic()+3
        while time.monotonic()<limit:
            predicate="wait_event='PgSleep'" if event=='sleep' else "wait_event_type='Lock'"
            if db.sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{name}' AND {predicate});").strip()=='t':
                return
            time.sleep(.025)
        raise AssertionError('Expected confirmed live session for provenance race.')
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            blocker=pool.submit(db.sql,f"SET application_name='{marker}-block'; BEGIN; SELECT id FROM public.listings WHERE id='{f['listing']}' FOR UPDATE; SELECT pg_sleep(1.5); COMMIT;")
            wait_for(marker+'-block','sleep')
            statement=(f"PERFORM set_config('swtest.result',public.agent_mandate_action('{state['actor_token']}','{uid()}','accept_offer',NULL,'{f['offer']}')::text,true);" if agent
              else f"PERFORM public.accept_offer('{f['offer']}');")
            actor=pool.submit(db.sql,f"SET application_name='{marker}-actor'; BEGIN;"+role('' if agent else f['owner'],statement,dbrole='anon' if agent else 'authenticated')
              +"SELECT json_build_object('attempt',current_setting('swtest.attempt',true),'result',nullif(current_setting('swtest.result',true),'')::jsonb); COMMIT;")
            wait_for(marker+'-actor','lock')
            # Deterministically simulate provenance becoming visible after the
            # initial source lookup. No product client can write this metadata.
            db.sql(f"""BEGIN; INSERT INTO public.mandate_actions(mandate_id,capability_id,operation_key,request_hash,
              action,proposal,status,offer_id,result) VALUES ('{state['source']}','{state['capability']}','{uid()}',repeat('0',64),
              'place_offer','{{"amount_cents":1665}}','succeeded','{f['offer']}','{{"status":"succeeded"}}'); COMMIT;""")
            output=actor.result()
            blocker.result()
        r=json.loads(next(line for line in reversed(output.splitlines()) if line.startswith('{')))
        must(r['result']['status']=='rejected' if agent else r['attempt']!='ok')
        must(db.sql(f"SELECT count(*) FROM public.lock_ins WHERE listing_id='{f['listing']}';").strip()=='0')
        passed+=1
        print('PASS '+('agent' if agent else 'manual')+' acceptance rejects source mapping appearing after prelock')
    finally:
        cleanup(db,f)


def replay_expiry(db):
    global passed
    f=fixture()
    marker=f['marker']
    operation=uid()
    setup=human(f)+action(op=operation)+role(f['buyer'],"""PERFORM set_config('swtest.buyer_token',public.issue_agent_capability(
      current_setting('swtest.buyer')::uuid,ARRAY['place_offer'],clock_timestamp()+interval '1 second')->>'token',true);""")
    out=db.sql('BEGIN;'+f['setup']+setup+"""SELECT json_build_object('mandate',current_setting('swtest.buyer'),
      'token',current_setting('swtest.buyer_token')); COMMIT;""")
    state=json.loads(next(line for line in reversed(out.splitlines()) if line.startswith('{')))
    def wait_for(name,sleep):
        limit=time.monotonic()+3
        while time.monotonic()<limit:
            predicate="wait_event='PgSleep'" if sleep else "wait_event_type='Lock'"
            if db.sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{name}' AND {predicate});").strip()=='t':
                return
            time.sleep(.025)
        raise AssertionError('Expected confirmed live session for replay expiry race.')
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            blocker=pool.submit(db.sql,f"SET application_name='{marker}-block'; BEGIN; SELECT id FROM public.agent_mandates WHERE id='{state['mandate']}' FOR UPDATE; SELECT pg_sleep(1.8); COMMIT;")
            wait_for(marker+'-block',True)
            actor=pool.submit(db.sql,f"SET application_name='{marker}-actor'; BEGIN;"+role('',f"""PERFORM set_config('swtest.result',public.agent_mandate_action(
              '{state['token']}','{operation}','place_offer',1665)::text,true);""",dbrole='anon')
              +"SELECT json_build_object('attempt',current_setting('swtest.attempt',true),'result',nullif(current_setting('swtest.result',true),'')::jsonb); COMMIT;")
            wait_for(marker+'-actor',False)
            output=actor.result()
            blocker.result()
        r=json.loads(next(line for line in reversed(output.splitlines()) if line.startswith('{')))
        must(r['attempt']!='ok' and r['result'] is None)
        must(db.sql(f"SELECT rounds_used||':'||(SELECT count(*) FROM public.mandate_actions WHERE mandate_id='{state['mandate']}') FROM public.agent_mandates WHERE id='{state['mandate']}';").strip()=='1:1')
        passed+=1
        print('PASS expired capability cannot replay private result after confirmed mandate-lock wait')
    finally:
        cleanup(db,f)


def human_wait(db, operation, suspended=None):
    global passed
    f=fixture()
    marker=f['marker']
    setup=''
    if operation!='draft':
        setup=human(f,expire="interval '1 hour'" if suspended else "interval '1 second'",approve=operation=='approved_replay')
    out=db.sql('BEGIN;'+f['setup']+setup+"""SELECT json_build_object('mandate',nullif(current_setting('swtest.buyer',true),''),
      'hash',(SELECT draft_hash FROM public.agent_mandates WHERE id=nullif(current_setting('swtest.buyer',true),'')::uuid)); COMMIT;""")
    state=json.loads(next(line for line in reversed(out.splitlines()) if line.startswith('{')))
    def wait_for(name,sleep):
        limit=time.monotonic()+3
        while time.monotonic()<limit:
            predicate="wait_event='PgSleep'" if sleep else "wait_event_type='Lock'"
            if db.sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{name}' AND {predicate});").strip()=='t':
                return
            time.sleep(.025)
        raise AssertionError('Expected confirmed live session for human authority race.')
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            lock=(f"UPDATE public.profiles SET is_suspended=true WHERE id='{f[suspended]}';" if suspended else
              f"SELECT id FROM public.listings WHERE id='{f['listing']}' FOR UPDATE;")
            blocker=pool.submit(db.sql,f"SET application_name='{marker}-block'; BEGIN; {lock} SELECT pg_sleep(1.8); COMMIT;")
            wait_for(marker+'-block',True)
            statement=(f"PERFORM public.create_agent_mandate_draft('{f['listing']}','buy',1800,clock_timestamp()+interval '{'1 hour' if suspended else '1 second'}',4);" if operation=='draft' else
              f"PERFORM public.approve_agent_mandate('{state['mandate']}','{state['hash']}');")
            actor=pool.submit(db.sql,f"SET application_name='{marker}-actor'; BEGIN;"+role(f['buyer'],statement)
              +"SELECT json_build_object('attempt',current_setting('swtest.attempt',true)); COMMIT;")
            wait_for(marker+'-actor',False)
            output=actor.result()
            blocker.result()
        r=json.loads(next(line for line in reversed(output.splitlines()) if line.startswith('{')))
        must(r['attempt']!='ok')
        if operation=='draft':
            must(db.sql(f"SELECT count(*) FROM public.agent_mandates WHERE listing_id='{f['listing']}';").strip()=='0')
        else:
            expected='approved' if operation=='approved_replay' else 'draft'
            must(db.sql(f"SELECT status FROM public.agent_mandates WHERE id='{state['mandate']}';").strip()==expected)
        passed+=1
        print('PASS human '+operation+' rejects '+('committed '+suspended+' suspension' if suspended else 'expiry')+' after confirmed lock wait')
    finally:
        cleanup(db,f)


def validate_live_index(db, remove_redundant=False):
    rows=json.loads(db.sql("""SELECT coalesce(json_agg(json_build_object(
      'name',c.relname,'owner',pg_get_userbyid(c.relowner),'definition',pg_get_indexdef(i.indexrelid),
      'method',am.amname,'unique',i.indisunique,'valid',i.indisvalid,'ready',i.indisready,'immediate',i.indimmediate,
      'key_count',i.indnkeyatts,'all_count',i.indnatts,'predicate',pg_get_expr(i.indpred,i.indrelid),
      'expressions',pg_get_expr(i.indexprs,i.indrelid),'keys',(SELECT json_agg(a.attname ORDER BY k.n)
        FROM unnest(i.indkey) WITH ORDINALITY k(attnum,n) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)
      ) ORDER BY c.relname),'[]') FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid='public.lock_ins'::regclass;"""))
    def backstop(row):
        return (row['unique'] and row['valid'] and row['ready'] and row['immediate']
          and row['method']=='btree' and row['key_count']==1 and row['all_count']==1
          and row['keys']==['listing_id'] and row['expressions'] is None
          and row['predicate']=="(state <> 'cancelled'::text)")
    baseline.require(any(backstop(r) for r in rows),'Missing semantic partial unique live-deal backstop in recovered baseline.')
    if remove_redundant:
        by_name={r['name']:r for r in rows}
        original=by_name.get('lock_ins_one_open_per_listing_idx')
        added=by_name.get('lock_ins_one_live_deal')
        baseline.require(original is not None and added is not None,'Expected both original and task-created indexes before duplicate cleanup.')
        baseline.require(backstop(original) and backstop(added) and original['owner']==added['owner']=='postgres',
                         'Index ownership/semantics do not match the known local duplicate.')
        normalize=lambda text: re.sub(r'^CREATE UNIQUE INDEX \S+ ON ', 'CREATE UNIQUE INDEX <name> ON ',text)
        baseline.require(normalize(original['definition'])==normalize(added['definition']),
                         'Indexes are not identical apart from their names; refuse cleanup.')
        db.sql("""BEGIN; SET LOCAL ROLE postgres; LOCK TABLE public.lock_ins IN SHARE MODE;
          DO $ownership$ BEGIN
            IF pg_get_indexdef('public.lock_ins_one_open_per_listing_idx'::regclass) IS DISTINCT FROM """+baseline.qs(original['definition'])+"""
              OR pg_get_indexdef('public.lock_ins_one_live_deal'::regclass) IS DISTINCT FROM """+baseline.qs(added['definition'])+"""
              OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.lock_ins_one_live_deal'::regclass)<>'postgres'
            THEN RAISE EXCEPTION 'index ownership or definition changed before cleanup'; END IF;
          END $ownership$;
          DROP INDEX public.lock_ins_one_live_deal; COMMIT;""")
        validate_live_index(db)
        baseline.require(db.sql("SELECT to_regclass('public.lock_ins_one_open_per_listing_idx') IS NOT NULL AND to_regclass('public.lock_ins_one_live_deal') IS NULL;").strip()=='t',
                         'Original baseline index was not retained during cleanup.')
        print('Removed only the ownership-checked redundant task index; original baseline backstop retained.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--remove-redundant-index', action='store_true', help='Remove only the known task-created duplicate after comparing ownership and exact definitions with the original baseline index.')
    args = parser.parse_args()
    db = baseline.Local()
    baseline.require(db.sql("SELECT to_regprocedure('public.create_lock_in(uuid,integer)') IS NOT NULL;").strip() == 't',
                     'Core authorization fix gate has not been applied.')
    baseline.require('_lock_agent_offer_mandate' in db.sql("SELECT pg_get_functiondef('public.accept_offer(uuid)'::regprocedure);"),
                     'Core acceptance must call the mandate authority hook.')
    if args.apply:
        baseline.require(db.sql("SELECT to_regclass('public.agent_mandates') IS NULL;").strip() == 't', 'Mandate tables already exist; refuse reapply.')
        db.sql((ROOT / 'supabase/migrations/202611050002_agent_mandates.sql').read_text())
        print('Applied additive mandate migration to verified isolated local DB.')
    baseline.require(db.sql("SELECT to_regclass('public.agent_mandates') IS NOT NULL;").strip() == 't', 'Apply the mandate migration locally after the core gate.')
    validate_live_index(db,args.remove_redundant_index)
    cases(db)
    races(db)
    for kind in ('capability','mandate','manual_source','trigger_capability','trigger_mandate'):
        lock_wait_expiry(db,kind)
    for agent in (False,True):
        late_source_mapping(db,agent)
    replay_expiry(db)
    for operation in ('draft','approve','approved_replay'):
        human_wait(db,operation)
    for operation,suspended in (('draft','buyer'),('approve','buyer'),('approve','owner')):
        human_wait(db,operation,suspended)
    baseline.require(db.sql("SELECT count(*) FROM auth.users WHERE email LIKE 'mandates-local-%@example.edu';").strip()=='0',
                     'Synthetic mandate fixture users remain; inspect private local state before claiming cleanup.')
    print(f'{passed} real local mandate checks passed; synthetic race rows cleaned.')


if __name__ == '__main__':
    main()
