#!/usr/bin/env python3
"""Build/start/status/stop an owned local Worker service that outlives its caller.

python3 scripts/hackathon-runtime-local.py start [--seller-id SYNTHETIC_UUID]
python3 scripts/hackathon-runtime-local.py status|stop

Existing official Node image; fixed isolated Supabase; no production deployment,
new account, global setting, remote target override, email sending or auto-approval.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.local/hackathon-runtime'
NAME = 'sellwant-hackathon-runtime'
IMAGE = 'node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32'
ORIGIN = 'http://127.0.0.1:8788'
LABEL = 'sellwant.hackathon.runtime'
spec = importlib.util.spec_from_file_location('runtime_baseline', ROOT / 'scripts/schema-baseline-local.py')
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


def save(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(value)
    path.chmod(0o600)


def owned(db):
    names = db.docker(['ps', '-a', '--filter', 'name=^/' + NAME + '$', '--format', '{{.ID}}']).split()
    if not names:
        return None
    baseline.require(len(names) == 1, 'Ambiguous runtime identity.')
    value = json.loads(db.docker(['inspect', names[0]]))[0]
    baseline.require(value['Name'] == '/' + NAME and value['Config']['Labels'].get(LABEL) == baseline.PROJECT,
                     'Existing container is not owned by this runtime; refusing mutation.')
    baseline.require(value['Config']['Image'] == IMAGE and list(value['NetworkSettings']['Networks']) == [baseline.NETWORK],
                     'Unexpected runtime image/network; refusing mutation.')
    ports = value['HostConfig']['PortBindings'].get('8788/tcp', [])
    baseline.require(ports == [{'HostIp': '127.0.0.1', 'HostPort': '8788'}], 'Runtime must publish loopback only.')
    return value


def stage(command, cwd, environment, logfile, timeout=180):
    with logfile.open('wb') as output:
        logfile.chmod(0o600)
        child = subprocess.Popen(command, cwd=cwd, env=environment, stdout=output,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        try:
            result = child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            # Terminate only the process group this launcher created, including
            # build workers. Observation timeouts never start a second process.
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
            raise RuntimeError('Build stage timed out; owned process group stopped. Private log: ' + str(logfile)) from None
    baseline.require(result == 0, 'Build stage failed. Private log: ' + str(logfile))


def stable_source(bun, directory, environment):
    target = Path(tempfile.mkdtemp(prefix='sellwant-hackathon-build-', dir='/private/tmp'))
    target.chmod(0o700)
    archive = subprocess.run(['git', 'archive', 'HEAD:sellwant'], cwd=ROOT, capture_output=True, timeout=30)
    baseline.require(archive.returncode == 0, 'Could not read the existing app commit for the stable build.')
    with tarfile.open(fileobj=io.BytesIO(archive.stdout), mode='r:') as source:
        source.extractall(target, filter='data')
    changed = subprocess.run(['git', 'diff', '--name-only', '--relative', '-z', 'HEAD', '--', '.'],
                             cwd=ROOT, capture_output=True, timeout=30)
    added = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard', '-z', '--', '.'],
                           cwd=ROOT, capture_output=True, timeout=30)
    baseline.require(changed.returncode == added.returncode == 0, 'Could not inventory the current app overlay.')
    overlay = {}
    for name in sorted(set((changed.stdout + added.stdout).decode().strip('\0').split('\0'))):
        if not name:
            continue
        relative = Path(name)
        baseline.require(not relative.is_absolute() and '..' not in relative.parts, 'Unexpected overlay path.')
        src, dst = ROOT / relative, target / relative
        if src.is_file():
            data = src.read_bytes()
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(data)
            overlay[name] = hashlib.sha256(data).hexdigest()
        elif dst.is_file():
            dst.unlink()  # Only an owned temporary copy of a deleted source.
            overlay[name] = 'deleted'
    cached = Path('/private/tmp/sellwant-recovery-20261104/source/sellwant/node_modules')
    if cached.is_dir():
        stage(['cp', '-cR', str(cached), str(target / 'node_modules')], ROOT, environment,
              directory / 'clone-dependencies.log')
    stage([bun, 'install', '--frozen-lockfile', '--ignore-scripts'], target, environment,
          directory / 'install-stable.log')
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, timeout=10)
    baseline.require(head.returncode == 0, 'Could not record the stable source commit.')
    save(directory / 'source-manifest.json', json.dumps({'head': head.stdout.strip(),
         'build_root': str(target), 'changed_source_sha256': overlay}, indent=2))
    return target, overlay


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'status', 'stop'])
    parser.add_argument('--seller-id')
    parser.add_argument('--stable-build', action='store_true', help='Build byte-identical app source outside iCloud.')
    args = parser.parse_args()
    baseline.require(args.action == 'start' or args.seller_id is None, 'Seller mapping belongs only to start.')
    baseline.require(args.action == 'start' or not args.stable_build, 'Build selection belongs only to start.')
    db = baseline.Local()
    current = owned(db)
    if args.action == 'status':
        print(json.dumps({'running': bool(current and current['State']['Running']),
          'id': current['Id'] if current else None, 'origin': ORIGIN, 'hosted': False}))
        return
    if args.action == 'stop':
        if current:
            if current['State']['Running']:
                db.docker(['stop', '--time', '20', current['Id']])
            db.docker(['rm', current['Id']])
        print('Owned runtime stopped; database, credentials and private journals preserved.')
        return
    if current:
        baseline.require(current['State']['Running'], 'Stopped runtime exists; use stop before rebuilding.')
        print('Owned runtime already running at ' + ORIGIN + '; no restart or configuration change.')
        return
    baseline.require(db.sql("SELECT to_regclass('public.deal_payments') IS NOT NULL AND to_regclass('public.agent_watches') IS NOT NULL;").strip() == 't',
                     'Apply/review ordered migrations through 006 before runtime startup.')
    if args.seller_id:
        baseline.require(re.fullmatch(r'[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', args.seller_id), 'Invalid demo seller UUID.')
        baseline.require(db.sql("SELECT count(*) FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id="
          + baseline.qs(args.seller_id) + " AND NOT p.is_suspended AND (u.email LIKE '%@example.invalid' OR u.email LIKE '%@sellwant.test');").strip() == '1',
                         'Explicit seller mapping requires an isolated synthetic account.')
    cli = subprocess.run([str(ROOT / 'node_modules/.bin/supabase'), 'status', '--output', 'json'],
                         cwd=ROOT, capture_output=True, text=True, timeout=30)
    baseline.require(cli.returncode == 0, 'Local Supabase status unavailable.')
    local = json.loads(cli.stdout)
    baseline.require(local['API_URL'] == 'http://127.0.0.1:55321', 'Unexpected API target.')
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    keypath = PRIVATE / 'watcher.key'
    if not keypath.exists():
        import base64
        save(keypath, base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))
    baseline.require(keypath.stat().st_mode & 0o077 == 0, 'Watcher key must remain private.')
    bun = shutil.which('bun')
    baseline.require(bun, 'Bun is required to build the existing Worker.')
    # Only these server settings leave the env loader; output is captured in
    # memory and never printed. Source credential files are not changed.
    names = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'PAYPAL_ENVIRONMENT', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID']
    loaded = subprocess.run([bun, '--env-file=.env.llm', '--env-file=.env.paypal-sandbox', '-e',
      'process.stdout.write(JSON.stringify(Object.fromEntries(' + json.dumps(names) + '.map(k=>[k,process.env[k]||" "]))));'],
      cwd=ROOT, capture_output=True, text=True, timeout=20)
    baseline.require(loaded.returncode == 0, 'Private server configuration unavailable.')
    env = {k: v.strip() for k, v in json.loads(loaded.stdout).items()}
    baseline.require(env['OPENAI_API_KEY'], 'Configure OpenAI access before starting the watcher.')
    env.update({'SUPABASE_URL': local['API_URL'], 'SUPABASE_ANON_KEY': local['ANON_KEY'],
      'SUPABASE_SECRET_KEY': local['SERVICE_ROLE_KEY'], 'AGENT_MCP_ENABLED': 'true', 'AGENT_MCP_ORIGIN': ORIGIN,
      'AGENT_AI_ENABLED': 'true', 'AGENT_AI_ORIGIN': ORIGIN, 'AGENT_WATCHER_ENABLED': 'true',
      'AGENT_WATCHER_ENCRYPTION_KEY': keypath.read_text(), 'DEAL_PAYMENTS_ORIGIN': ORIGIN,
      'DEAL_PAYMENTS_ENABLED': 'true' if args.seller_id else 'false', 'PAYPAL_DEMO_SELLER_ID': args.seller_id or ''})
    directory = PRIVATE / ('build-' + uuid.uuid4().hex)
    directory.mkdir(mode=0o700)
    save(directory / 'env.json', json.dumps(env))
    shutil.copyfile(ROOT / 'scripts/hackathon-worker-local.mjs', directory / 'server.mjs')
    buildenv = {**os.environ, 'EXPO_NO_DOTENV': '1', 'CI': '1', 'EXPO_PUBLIC_SUPABASE_URL': local['API_URL'],
      'EXPO_PUBLIC_SUPABASE_ANON_KEY': local['ANON_KEY'], 'EXPO_PUBLIC_HACKATHON_API_ORIGIN': ORIGIN,
      'EXPO_PUBLIC_AGENT_TRADING_ENABLED': 'true', 'EXPO_PUBLIC_AGENT_AI_ENABLED': 'true',
      'EXPO_PUBLIC_AGENT_WATCHER_ENABLED': 'true', 'EXPO_PUBLIC_SANDBOX_PAYMENTS_ENABLED': 'true'}
    buildroot, overlay = stable_source(bun, directory, buildenv) if args.stable_build else (ROOT, {})
    stage([bun, 'run', 'build'], buildroot, buildenv, directory / 'build-web.log')
    stage([bun, 'build', 'worker/index.js', '--target=node', '--format=esm', '--env=disable',
           '--outfile=' + str(directory / 'worker.mjs')], ROOT, buildenv, directory / 'build-worker.log')
    for name, digest in overlay.items():
        path = ROOT / name
        baseline.require((not path.exists()) if digest == 'deleted' else
                         path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest,
                         'Source changed during the stable build; preserve manifest and rebuild only after reconciliation.')
    shutil.copytree(buildroot / 'dist', directory / 'dist')
    identifier = db.docker(['run', '--detach', '--name', NAME, '--label', LABEL + '=' + baseline.PROJECT,
      '--read-only', '--tmpfs', '/tmp:rw,size=32m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--restart', 'unless-stopped', '--network', baseline.NETWORK, '--publish', '127.0.0.1:8788:8788',
      '--mount', 'type=bind,src=' + str(directory) + ',dst=/runtime,readonly', IMAGE, 'node', '/runtime/server.mjs']).strip()
    save(PRIVATE / 'last-start.json', json.dumps({'id': identifier, 'build': str(directory), 'origin': ORIGIN, 'hosted': False}))
    verified = owned(db)
    baseline.require(verified and verified['Id'] == identifier and verified['State']['Running'], 'Runtime startup needs reconciliation; inspect owned state.')
    print('Owned local Worker service started at ' + ORIGIN + '. It outlives this launcher; hosted deployment is unverified.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
