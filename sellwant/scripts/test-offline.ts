/** Default hackathon checks must not silently start the production DB suite. */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const tests = readdirSync(resolve(root, 'tests'))
  .filter(name => name.endsWith('.test.ts') && name !== 'advance-deal.test.ts')
  .sort()
  .map(name => `./tests/${name}`);

// A network tripwire also catches a new "unit" test that accidentally calls
// a remote service. Existing Worker tests replace fetch with local fixtures.
const result = Bun.spawnSync([process.execPath, 'test', '--preload', './tests/offline-guard.ts', ...tests], {
  cwd: root, stdout: 'inherit', stderr: 'inherit',
});
process.exit(result.exitCode);
