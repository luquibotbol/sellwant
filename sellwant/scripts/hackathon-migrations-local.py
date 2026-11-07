#!/usr/bin/env python3
"""Inspect/apply reviewed M3 migrations and their outbox prerequisite locally.

python3 scripts/hackathon-migrations-local.py status
python3 scripts/hackathon-migrations-local.py apply outbox|005|006|007

No connection overrides, production target, automatic legacy migrations or seeds.
Exact applied bytes and before/after catalog hashes remain private under .local/.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('m3_baseline', ROOT / 'scripts/schema-baseline-local.py')
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)
MIGRATIONS = {
    'outbox': ('20260821_email_outbox.sql', 'email_outbox'),
    '005': ('202611050005_deal_payments.sql', 'deal_payments'),
    '006': ('202611050006_agent_watcher.sql', 'agent_watches'),
    '007': ('202611060007_watcher_cursor_checks.sql', 'agent_watches'),
}


def status(db):
    return json.loads(db.sql("""BEGIN READ ONLY;
      SELECT json_build_object(
        'access_context',to_regprocedure('public.agent_get_access(text)') IS NOT NULL,
        'outbox',to_regclass('public.email_outbox') IS NOT NULL,
        '005',to_regclass('public.deal_payments') IS NOT NULL,
        '006',to_regclass('public.agent_watches') IS NOT NULL,
        '007',(SELECT count(*)=2 FROM pg_constraint WHERE conrelid=to_regclass('public.agent_watches')
          AND conname IN ('agent_watches_scan_cursor_bounded','agent_watches_offer_cursor_bounded')),
        'app_functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.prokind IN ('f','p') AND NOT EXISTS
            (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid
              AND d.refclassid='pg_extension'::regclass AND d.deptype='e')));
      COMMIT;"""))


def fingerprint(db):
    value = db.sql("""BEGIN READ ONLY;
      SELECT coalesce(json_agg(x ORDER BY x.name,x.arguments),'[]')::text FROM (
        SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
          pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind IN ('f','p') AND NOT EXISTS
          (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid
            AND d.refclassid='pg_extension'::regclass AND d.deptype='e')) x;
      COMMIT;""")
    return hashlib.sha256(value.encode()).hexdigest()


def main():
    args = sys.argv[1:]
    baseline.require(args == ['status'] or len(args) == 2 and args[0] == 'apply' and args[1] in MIGRATIONS,
                     'Use status or apply outbox|005|006|007; target overrides are forbidden.')
    db = baseline.Local()
    before = status(db)
    baseline.require(before['access_context'], 'Apply and verify the ordered foundation through 004 first.')
    if args == ['status']:
        print(json.dumps(before, sort_keys=True))
        return
    number = args[1]
    baseline.require(not before[number], 'Migration already present; refusing to replay over newer code.')
    baseline.require(number != '005' or before['outbox'], 'Review/apply the existing outbox prerequisite before 005.')
    baseline.require(number != '006' or before['005'], 'Review/apply 005 before 006.')
    baseline.require(number != '007' or before['006'], 'Review/apply 006 before 007.')
    filename, table = MIGRATIONS[number]
    path = ROOT / 'supabase/migrations' / filename
    raw = path.read_bytes()
    text = raw.decode('utf-8')
    if number == 'outbox':
        # The existing migration predates transactional wrappers. Apply its
        # exact source within one reviewed transaction, without changing it.
        text = 'BEGIN; SET LOCAL ROLE postgres;\n' + text + "\nNOTIFY pgrst,'reload schema'; COMMIT;\n"
    else:
        baseline.require(text.lstrip().startswith('--') and '\nBEGIN;' in text and text.rstrip().endswith('COMMIT;'),
                         'Expected a whole transactional migration.')
    digest = hashlib.sha256(raw).hexdigest()
    baseline.PRIVATE = ROOT / '.local/m3-migrations' / number / digest
    baseline.private_write('applied.sql', text)
    report = {'migration': filename, 'sha256': digest, 'before': before,
              'before_functions_sha256': fingerprint(db), 'target': 'isolated API55321/DB55322',
              'started_at': datetime.now(timezone.utc).isoformat(), 'outcome': 'pending'}
    baseline.private_write('report.json', json.dumps(report, indent=2) + '\n')
    try:
        db.sql(text)
        report.update({'after': status(db), 'after_functions_sha256': fingerprint(db), 'outcome': 'applied'})
        baseline.require(report['after'][number], 'Migration returned without its expected catalog state.')
        baseline.require(path.read_bytes() == raw, 'Migration source changed during application; preserve exact applied bytes.')
    except BaseException:
        # A tool interruption is not evidence of rollback. A subsequent status
        # reads actual catalog state; exact SQL and pending report are retained.
        report['outcome'] = 'requires_catalog_reconciliation'
        raise
    finally:
        baseline.private_write('report.json', json.dumps(report, indent=2) + '\n')
    print(json.dumps({'migration': filename, 'sha256': digest, 'state': report['outcome'],
                      'app_functions': report['after']['app_functions']}, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        if baseline.PRIVATE != ROOT / '.local/schema':
            print('Exact migration diagnostics: ' + str(baseline.PRIVATE.relative_to(ROOT)), file=sys.stderr)
        sys.exit(1)
