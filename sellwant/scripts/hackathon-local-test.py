#!/usr/bin/env python3
"""Shared fixed-target test support; never applies migrations or contacts providers."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
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
spec = importlib.util.spec_from_file_location('mandate_fixture', ROOT / 'scripts/test-mandates-local.py')
mandates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mandates)
q = mandates.baseline.qs
role = mandates.role
must = mandates.must
uid = mandates.uid


def arguments(description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('--section', choices=('all', 'sql', 'rest', 'races'), default='all')
    return parser.parse_args()


def parsed(output):
    return json.loads(next(line for line in reversed(output.splitlines()) if line.startswith(('{', '['))))


def value(key='result'):
    return "nullif(current_setting('swtest." + key + "',true),'')::jsonb"


def save(expression, key='result', user='', dbrole='service_role'):
    return role(user, "PERFORM set_config('swtest." + key + "',(" + expression + ")::text,true);", dbrole=dbrole)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise AssertionError('Local REST redirect refused.')


class GuardedLocal(mandates.baseline.Local):
    @staticmethod
    def run(args, text=None):
        result = subprocess.run(args, input=text, text=True, capture_output=True, timeout=90, cwd=ROOT)
        if result.returncode:
            directory = ROOT / '.local/verification'
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = directory / ('command-error-' + str(time.time_ns()) + '.txt')
            path.write_text(result.stderr)
            path.chmod(0o600)
            raise RuntimeError('Local command failed; private details: ' + str(path.relative_to(ROOT)))
        return result.stdout


class Harness:
    def __init__(self, name, required_tables):
        self.name = name
        self.db = GuardedLocal()
        self.passed = 0
        self.status = None
        for table in required_tables:
            must(self.db.sql('SELECT to_regclass(' + q('public.' + table) + ') IS NOT NULL;').strip() == 't',
                 'Required migration is absent: ' + table + '. Manager must apply it first.')

    def fixture(self):
        f = mandates.fixture()
        marker = self.name + '-' + uid()
        f['setup'] = f['setup'].replace(f['marker'], marker)
        f['marker'] = marker
        f['deal'] = uid()
        f['watch'] = uid()
        return f

    def check(self, label, condition=True):
        must(condition, label)
        self.passed += 1
        print('PASS ' + label, flush=True)

    def sql(self, label, build, verify, inspect="'attempt',current_setting('swtest.attempt',true),'result'," + value()):
        f = self.fixture()
        selected = inspect(f) if callable(inspect) else inspect
        output = self.db.sql('BEGIN;' + f['setup'] + build(f) + 'SELECT json_build_object(' + selected + '); ROLLBACK;')
        result = parsed(output)
        try:
            verify(result, f)
        except Exception:
            self.private(label, result)
            raise AssertionError(label + ' failed; private verification evidence saved.') from None
        self.check(label)

    def commit(self, f, sql, inspect="'ok',true"):
        return parsed(self.db.sql('BEGIN;' + f['setup'] + sql + 'SELECT json_build_object(' + inspect + '); COMMIT;'))

    def cleanup(self, f):
        # Verify exact row ownership before removing any committed dependents.
        self.db.sql(f"""BEGIN;
          DO $owned$ BEGIN
            IF (SELECT title FROM public.listings WHERE id='{f['listing']}') IS DISTINCT FROM '{f['marker']}'
              OR (SELECT count(*) FROM auth.users WHERE id IN ('{f['owner']}','{f['buyer']}','{f['other']}')
                AND email LIKE '{f['marker']}-%@example.edu')<>3 THEN RAISE EXCEPTION 'fixture ownership mismatch'; END IF;
          END $owned$;
          DO $dependents$ BEGIN
            IF to_regclass('public.agent_watches') IS NOT NULL THEN
              DELETE FROM public.agent_watches WHERE mandate_id IN
                (SELECT id FROM public.agent_mandates WHERE listing_id IN ('{f['listing']}','{f['listing2']}'));
            END IF;
            IF to_regclass('public.deal_payments') IS NOT NULL THEN
              DELETE FROM public.deal_payments WHERE deal_id IN
                (SELECT id FROM public.lock_ins WHERE listing_id IN ('{f['listing']}','{f['listing2']}'));
            END IF;
          END $dependents$;
          DELETE FROM public.email_outbox WHERE listing_id IN ('{f['listing']}','{f['listing2']}');
          DELETE FROM public.mandate_actions WHERE mandate_id IN
            (SELECT id FROM public.agent_mandates WHERE listing_id IN ('{f['listing']}','{f['listing2']}'));
          DELETE FROM public.agent_capabilities WHERE mandate_id IN
            (SELECT id FROM public.agent_mandates WHERE listing_id IN ('{f['listing']}','{f['listing2']}'));
          DELETE FROM public.agent_mandates WHERE listing_id IN ('{f['listing']}','{f['listing2']}');
          DELETE FROM public.lock_ins WHERE listing_id IN ('{f['listing']}','{f['listing2']}');
          DELETE FROM public.offers WHERE listing_id IN ('{f['listing']}','{f['listing2']}');
          DELETE FROM public.listings WHERE id IN ('{f['listing']}','{f['listing2']}');
          DELETE FROM auth.users WHERE id IN ('{f['owner']}','{f['buyer']}','{f['other']}');
          COMMIT;""")
        self.check('owned fixture cleanup leaves no synthetic users', self.db.sql(
            f"SELECT count(*) FROM auth.users WHERE id IN ('{f['owner']}','{f['buyer']}','{f['other']}');").strip() == '0')

    def private(self, label, details):
        path = ROOT / '.local/verification'
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        output = path / (self.name + '-' + str(time.time_ns()) + '.json')
        output.write_text(json.dumps({'label': label, 'details': details}, indent=2))
        output.chmod(0o600)

    def rest(self):
        if self.status is not None:
            return
        result = subprocess.run([str(ROOT / 'node_modules/.bin/supabase'), 'status', '--output', 'json'],
                                cwd=ROOT, capture_output=True, text=True, timeout=30)
        must(result.returncode == 0, 'Verified local Supabase status unavailable.')
        self.status = json.loads(result.stdout)
        must(self.status['API_URL'] == 'http://127.0.0.1:55321', 'Unexpected REST target.')
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)

    def jwt(self, user, dbrole='authenticated'):
        self.rest()
        encoded = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b'=').decode()
        header = encoded(b'{"alg":"HS256","typ":"JWT"}')
        now = int(time.time())
        claims = encoded(json.dumps({'sub': user, 'role': dbrole, 'aud': 'authenticated',
            'iss': self.status['API_URL'] + '/auth/v1', 'iat': now, 'exp': now + 300}).encode())
        signature = encoded(hmac.new(self.status['JWT_SECRET'].encode(), (header + '.' + claims).encode(), hashlib.sha256).digest())
        return header + '.' + claims + '.' + signature

    def request(self, path, authorization=None, payload=None, method=None, expected=(200, 201, 204, 206), service=False):
        self.rest()
        must(not path.startswith(('/', 'http')) and '\\' not in path and '\r' not in path and '\n' not in path,
             'Invalid local REST path.')
        headers = {'apikey': self.status['SERVICE_ROLE_KEY'] if service else self.status['ANON_KEY'],
                   'Authorization': 'Bearer ' + (authorization or self.status['ANON_KEY'])}
        if payload is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.status['API_URL'] + '/rest/v1/' + path, headers=headers,
            data=None if payload is None else json.dumps(payload).encode(),
            method=method or ('GET' if payload is None else 'POST'))
        try:
            response = self.opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(1_000_001)
            must(len(raw) <= 1_000_000, 'Unexpected REST response size.')
            must(response.code in expected, 'Local REST ' + path.split('?')[0] + ': HTTP ' + str(response.code))
            return json.loads(raw) if raw else None

    def wait(self, predicate):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            if self.db.sql(predicate).strip() == 't':
                return
            time.sleep(.025)
        raise AssertionError('Expected a confirmed live PostgreSQL process/wait.')

    def summary(self):
        print(str(self.passed) + ' isolated local ' + self.name + ' checks passed. Synthetic principals/receipts only; no provider or human proof.', flush=True)
