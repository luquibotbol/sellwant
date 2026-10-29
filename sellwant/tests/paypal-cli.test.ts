import { describe, expect, test } from 'bun:test';
import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sandboxEnv } from './paypal-fixtures';

const root = resolve(import.meta.dir, '..');
function run(args: string[], environment = sandboxEnv) {
  return Bun.spawnSync([
    process.execPath, '--preload', './tests/offline-guard.ts', './scripts/paypal-sandbox.ts', ...args,
  ], { cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe' });
}

describe('sandbox command safety', () => {
  test('configuration check does not contact PayPal or print credentials', () => {
    const result = run(['check']);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString() + result.stderr.toString();
    expect(output).toContain('not printed or tested remotely');
    expect(output).not.toContain(sandboxEnv.PAYPAL_CLIENT_SECRET);
  });

  test('production, fractional cents, excess test amounts and path traversal are rejected', () => {
    expect(run(['check'], { ...sandboxEnv, PAYPAL_ENVIRONMENT: 'PRODUCTION' }).exitCode).toBe(1);
    expect(run(['create', '--deal-id', '../elsewhere', '--amount-cents', '1665']).stderr.toString()).toContain('safe --deal-id');
    for (const value of ['16.65', '10001', '-1']) {
      const result = run(['create', '--deal-id', `cli-synthetic-${crypto.randomUUID()}`, '--amount-cents', value]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).not.toContain('PayPal network');
    }
  });

  test('a concurrent command cannot enter a locked deal journal', async () => {
    const id = `cli-lock-${crypto.randomUUID()}`;
    const directory = resolve(root, '.local/paypal-sandbox');
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, `${id}.json.lock`);
    const lock = await open(path, 'wx', 0o600);
    try {
      const result = run(['status', '--deal-id', id]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('journal is locked');
    } finally { await lock.close(); await unlink(path); }
  });
});
