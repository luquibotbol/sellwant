#!/usr/bin/env python3
"""Serve only the authenticated local MCP endpoint; no fixtures or hosted target.

python3 scripts/mcp-local-server.py
Connect a Streamable HTTP client using a token from the human mandate panel.
The web frontend and actual LLM/watcher run separately.
"""
import importlib.util
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mcp_server_baseline', ROOT / 'scripts/schema-baseline-local.py')
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


def main():
    baseline.require(len(sys.argv) == 1, 'Local server accepts no connection overrides.')
    db = baseline.Local()
    baseline.require(db.sql("SELECT to_regprocedure('public.agent_get_access(text)') IS NOT NULL;").strip() == 't',
                     'Apply ordered local migrations through004 first.')
    status = subprocess.run([str(ROOT / 'node_modules/.bin/supabase'), 'status', '--output', 'json'],
                            cwd=ROOT, capture_output=True, text=True, timeout=30)
    baseline.require(status.returncode == 0, 'Local Supabase status unavailable.')
    config = json.loads(status.stdout)
    baseline.require(config['API_URL'] == 'http://127.0.0.1:55321', 'Unexpected API target.')
    bun = shutil.which('bun')
    baseline.require(bun is not None, 'Bun is required.')
    environment = {'PATH': os.environ['PATH'], 'NO_COLOR': '1'}
    if os.environ.get('TMPDIR'):
        environment['TMPDIR'] = os.environ['TMPDIR']
    child = subprocess.Popen([bun, str(ROOT / 'scripts/mcp-local-bridge.ts')], cwd=ROOT,
                             env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        child.stdin.write(json.dumps({'mode': 'serve', 'url': config['API_URL'], 'anonKey': config['ANON_KEY']}))
        child.stdin.close()
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            baseline.require(selector.select(timeout=20), 'Local MCP server did not report readiness.')
            line = child.stdout.readline()
        baseline.require(child.poll() is None and line, 'Local MCP server stopped before readiness.')
        endpoint = json.loads(line)['endpoint']
        baseline.require(endpoint.startswith('http://127.0.0.1:') and endpoint.endswith('/mcp'), 'Unexpected MCP endpoint.')
        print('Local MCP endpoint: ' + endpoint, flush=True)
        print('Use a mandate capability as the Bearer token. Press Ctrl-C to stop.', flush=True)
        code = child.wait()
        baseline.require(code == 0, 'Local MCP server stopped unexpectedly.')
    except KeyboardInterrupt:
        pass
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        child.stdout.close()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print('Local MCP server failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
