#!/usr/bin/env python3
"""Verify source baseline -> 001 -> 002 -> 003 -> 004 in an owned disposable database.

Uses only the fixed local container verified by schema-baseline-local.py. Copies
schema, never rows or role/global definitions. The working postgres database is
read-only except CREATE/COMMENT/DROP of the random owned database itself.
No URL, database-name override, hosted target, browser, or service credentials.

This proves app DDL replay on the CURRENT local platform schemas/shared roles.
It does not prove a fresh Supabase service bootstrap or PostgreSQL 17.6 behavior.
Private diagnostics/source hashes are isolated under .local/schema-replay/.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('replay_baseline', ROOT / 'scripts/schema-baseline-local.py')
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)

MIGRATIONS = (
    '202611050001_core_trade_authorization.sql',
    '202611050002_agent_mandates.sql',
    '202611050003_agent_privacy.sql',
    '202611050004_agent_access_context.sql',
)


def app_definitions(db):
    value = db.sql("""BEGIN READ ONLY; SET LOCAL search_path=public,extensions;
      SELECT coalesce(json_agg(x ORDER BY x.name,x.arguments),'[]')::text FROM (
        SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
          pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind IN ('f','p') AND NOT EXISTS (
          SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid
            AND d.refclassid='pg_extension'::regclass AND d.deptype='e')
      ) x; COMMIT;""")
    return json.loads(value)


def catalog(db):
    return {'metadata': baseline.snapshot(db), 'app_functions': app_definitions(db)}


class FixedLocal(baseline.Local):
    def sql(self, text, csv_output=False):
        args = ['exec', '-i', self.id, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
                '-h', '/var/run/postgresql', '-p', '5432', '-U', 'supabase_admin', '-d', 'postgres']
        args += ['--csv'] if csv_output else ['-At']
        return self.docker(args, "SET statement_timeout='60s'; SET lock_timeout='10s';\n" + text)


class OwnedDatabase:
    def __init__(self, original, name, marker, oid):
        self.original, self.name, self.marker, self.oid = original, name, marker, oid

    def check(self):
        baseline.require(re.fullmatch(r'sellwant_replay_[0-9a-f]{32}', self.name), 'Invalid replay database identity.')
        match = self.original.sql("BEGIN READ ONLY; SELECT count(*) FROM pg_database WHERE datname="
            + baseline.qs(self.name) + ' AND oid=' + str(self.oid)
            + " AND pg_get_userbyid(datdba)='postgres' AND shobj_description(oid,'pg_database')="
            + baseline.qs(self.marker) + '; COMMIT;').strip()
        baseline.require(match == '1', 'Owned replay database identity/owner/comment changed; refuse mutation.')

    def sql(self, text, csv_output=False):
        self.check()
        args = ['exec', '-i', self.original.id, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
                '-h', '/var/run/postgresql', '-p', '5432', '-U', 'supabase_admin', '-d', self.name]
        args += ['--csv'] if csv_output else ['-At']
        return self.original.docker(args, "SET statement_timeout='60s'; SET lock_timeout='10s';\n" + text)


def main():
    baseline.require(len(sys.argv) == 1, 'This fixed-target replay accepts no arguments or connection overrides.')
    data, routines = baseline.source()
    original = FixedLocal()
    nonce = uuid.uuid4().hex
    name = 'sellwant_replay_' + nonce
    marker = 'SellWant owned schema replay ' + nonce
    baseline.PRIVATE = ROOT / '.local/schema-replay' / nonce
    before = catalog(original)
    baseline.require({e['name'] for e in before['metadata']['extensions']} == {e['name'] for e in data['extensions']},
                     'Unexpected local extensions; review external side effects before schema cloning.')
    baseline.require(original.sql("BEGIN READ ONLY; SELECT (SELECT count(*) FROM pg_foreign_server)+(SELECT count(*) FROM pg_subscription); COMMIT;").strip() == '0',
                     'Foreign servers/subscriptions require explicit review; no remote connections copied.')

    # A plain schema-only dump emits no role/global definitions or table data.
    # Capture privately, and reject any unexpected target-changing statements.
    dump = original.docker(['exec', '-i', original.id, 'pg_dump', '-h', '/var/run/postgresql',
                            '-p', '5432', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only', '--no-password'])
    baseline.require(len(dump.encode()) < 16 * 1024 * 1024, 'Unexpectedly large schema-only dump.')
    baseline.require(not re.search(r'^\s*(?:CREATE|ALTER|DROP)\s+(?:DATABASE|ROLE|USER|TABLESPACE)\b', dump, re.I | re.M),
                     'Schema dump contains forbidden database/global DDL.')
    baseline.require(not re.search(r'^\s*(?:COMMENT|SECURITY LABEL)\b[^\n]*\bON\s+DATABASE\b|^\s*(?:GRANT|REVOKE)\b[^\n]*\bON\s+DATABASE\b', dump, re.I | re.M),
                     'Schema dump contains cross-database metadata or grants.')
    for line in dump.splitlines():
        if line.lstrip().startswith('\\'):
            baseline.require(re.fullmatch(r'\\(?:un)?restrict [A-Za-z0-9]+', line.strip()) is not None,
                             'Schema dump contains an unexpected psql metacommand.')
    # Function bodies legitimately contain INSERT/COPY text. The trusted
    # pg_dump --schema-only mode, rather than a body-blind regex, excludes rows.
    baseline.private_write('platform-schema-only.sql', dump)
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (baseline.META, baseline.FUNCS)}
    migration_sql = {}
    for migration in MIGRATIONS:
        path = ROOT / 'supabase/migrations' / migration
        raw = path.read_bytes()
        hashes[migration] = hashlib.sha256(raw).hexdigest()
        migration_sql[migration] = raw.decode()
    report = {'database': name, 'marker': marker, 'source_hashes': hashes,
              'limitation': 'App DDL replay on current local platform schema/shared roles; not fresh service bootstrap or PG17.6 equivalence.'}
    baseline.private_write('report.json', json.dumps(report, indent=2) + '\n')
    baseline.require(original.sql('BEGIN READ ONLY; SELECT count(*) FROM pg_database WHERE datname='
                                 + baseline.qs(name) + '; COMMIT;').strip() == '0', 'Random replay database already exists.')
    owned = None
    creation_attempted = False
    failure = None
    try:
        creation_attempted = True
        # CREATE DATABASE cannot run in a transaction. If its response is lost
        # before the ownership comment/OID are confirmed, never guess at cleanup.
        original.sql('CREATE DATABASE ' + baseline.qi(name) + ' OWNER postgres TEMPLATE template0;\n'
                     + 'COMMENT ON DATABASE ' + baseline.qi(name) + ' IS ' + baseline.qs(marker) + ';')
        oid = original.sql('BEGIN READ ONLY; SELECT oid FROM pg_database WHERE datname='
                           + baseline.qs(name) + '; COMMIT;').strip()
        baseline.require(oid.isdigit(), 'Missing replay database OID.')
        owned = OwnedDatabase(original, name, marker, int(oid))
        owned.check()
        owned.sql('REVOKE CONNECT ON DATABASE ' + baseline.qi(name)
                  + ' FROM PUBLIC,anon,authenticated,authenticator,service_role;')
        if re.search(r'^CREATE SCHEMA public;', dump, re.M):
            owned.sql('DROP SCHEMA public CASCADE;')
        owned.sql(dump)
        # Dropping only this database's public schema also removes the app's
        # auth.users trigger through its dependency on handle_new_user().
        cleanup = ['BEGIN;', 'DROP SCHEMA public CASCADE;', 'CREATE SCHEMA public AUTHORIZATION pg_database_owner;']
        actual = baseline.snapshot(owned)
        baseline.require(baseline.canonical(actual['storage_policies']) == baseline.canonical(data['storage_policies']),
                         'Unexpected storage policies in clone; refuse broader deletion.')
        for policy in data['storage_policies']:
            cleanup.append('DROP POLICY ' + baseline.qi(policy['policyname']) + ' ON '
                           + baseline.qualified(policy['schemaname'], policy['tablename']) + ';')
        cleanup.append('COMMIT;')
        owned.sql('\n'.join(cleanup))
        empty = baseline.snapshot(owned)
        baseline.require(not empty['relations'] and not empty['routine_permissions'] and not empty['sequences']
                         and not empty['auth_user_triggers'] and not empty['storage_policies']
                         and not empty['listing_photo_bucket'], 'Disposable database app state is not empty.')
        sql = baseline.restore_sql(data, routines, {e['name']: e for e in empty['extensions']})
        baseline.private_write('baseline-restore.sql', sql)
        owned.sql(sql)
        baseline.compare(owned, data, routines, allow_local_extension_owners=True)
        baseline.permissions(owned, data)
        privileges = json.loads((baseline.PRIVATE / 'baseline-effective-permissions.json').read_text())
        baseline.require(not privileges['failures'], 'Baseline privilege report contains failures.')
        for migration in MIGRATIONS:
            owned.sql(migration_sql[migration])
            print('Replayed whole migration ' + migration + '.')
        after = catalog(owned)
        differences = [key for key in before if baseline.canonical(before[key]) != baseline.canonical(after[key])]
        baseline.private_write('final-catalog.json', json.dumps(after, indent=2, sort_keys=True) + '\n')
        if differences:
            baseline.private_write('catalog-differences.json', json.dumps({'working': before, 'replayed': after}, indent=2, sort_keys=True) + '\n')
        baseline.require(not differences, 'Ordered replay differs from current working schema/functions; see private diagnostics.')
        report.update({'baseline_compare': 'passed', 'effective_privilege_checks': privileges['checks'],
                       'ordered_migrations': list(MIGRATIONS), 'final_catalog_match': True,
                       'app_functions_compared': len(after['app_functions'])})
        print('Ordered baseline + 001/002/003/004 matches working app catalog and all '
              + str(len(after['app_functions'])) + ' app function definitions.')
    except BaseException as error:
        failure = error
    finally:
        cleanup_error = None
        try:
            if owned:
                owned.check()
                original.sql('DROP DATABASE ' + baseline.qi(name) + ';')
                baseline.require(original.sql('BEGIN READ ONLY; SELECT count(*) FROM pg_database WHERE datname='
                    + baseline.qs(name) + '; COMMIT;').strip() == '0', 'Could not confirm replay database removal.')
                report['owned_database_removed'] = True
            elif creation_attempted:
                baseline.require(original.sql('BEGIN READ ONLY; SELECT count(*) FROM pg_database WHERE datname='
                    + baseline.qs(name) + '; COMMIT;').strip() == '0', 'Unconfirmed creation outcome; owned replay identity needs reconciliation before removal.')
            unchanged = baseline.canonical(catalog(original)) == baseline.canonical(before)
            report['original_catalog_unchanged'] = unchanged
            baseline.require(unchanged, 'Working app catalog changed during replay; inspect concurrent changes.')
        except BaseException as error:
            cleanup_error = error
        baseline.private_write('report.json', json.dumps(report, indent=2) + '\n')
        if cleanup_error:
            raise RuntimeError('Replay cleanup/original-catalog verification failed; private report identifies only the owned database.') from cleanup_error
    if failure:
        raise failure
    print('Owned replay database removed; original app schema/functions unchanged. No application rows copied.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
