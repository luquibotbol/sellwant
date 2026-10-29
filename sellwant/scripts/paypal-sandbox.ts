/** Isolated, sandbox-only proof. Never imports Supabase or changes a listing. */
import { mkdir, open, readFile, rename, unlink, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PayPalSandbox, PayPalError, sandboxConfig } from '../worker/paypal';
import { newJournal, SandboxJournal, SandboxSession } from './lib/paypal-session';

const usage = `Sandbox payment proof (run in sellwant/):
  bun run paypal:sandbox check
  bun run paypal:sandbox callback
  bun run paypal:sandbox create --deal-id demo-capture-001 --amount-cents 1665
  bun run paypal:sandbox authorize --deal-id demo-capture-001
  bun run paypal:sandbox handoff --deal-id demo-capture-001
  bun run paypal:sandbox capture --deal-id demo-capture-001
  bun run paypal:sandbox status --deal-id demo-capture-001
  bun run paypal:sandbox void --deal-id demo-void-001

Load credentials using: bun --env-file=.env.paypal-sandbox run paypal:sandbox ...
handoff is an explicit LOCAL TEST attestation, not a product user permission.
Actual buyer approval happens at PayPal. callback never changes payment state.`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') { console.log(usage); return; }
  if (!['check', 'callback', 'create', 'authorize', 'handoff', 'capture', 'void', 'status'].includes(command)) throw new Error('Unknown command; use --help');
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--deal-id', '--amount-cents'].includes(key) || !args[i + 1] || options[key]) throw new Error('Invalid/duplicate option; use --help');
    options[key] = args[i + 1];
  }
  if (['check', 'callback'].includes(command) && args.length) throw new Error('This command takes no options');
  if (command === 'callback') {
    Bun.serve({
      hostname: '127.0.0.1', port: 8789,
      fetch(request) {
        const path = new URL(request.url).pathname;
        const message = path === '/return'
          ? 'PayPal returned from buyer approval. No capture has occurred. Run the authorize command to verify the order with PayPal.'
          : path === '/cancel'
            ? 'PayPal approval was cancelled in this browser. This callback does not void any existing authorization. Check status and use the void command if needed.'
            : null;
        return new Response(message ?? 'Not found', { status: message ? 200 : 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      },
    });
    console.log('Sandbox callback listening at http://127.0.0.1:8789. Read-only; stop with Ctrl-C.');
    return;
  }
  const environment = {
    PAYPAL_ENVIRONMENT: process.env.PAYPAL_ENVIRONMENT,
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    PAYPAL_MERCHANT_ID: process.env.PAYPAL_MERCHANT_ID,
  };
  const config = sandboxConfig(environment);
  if (command === 'check') {
    console.log('Sandbox environment configured. Credentials were not printed or tested remotely.');
    return;
  }
  const dealId = options['--deal-id'];
  if (!dealId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(dealId)) throw new Error('Supply a safe --deal-id (letters, numbers, underscore, hyphen; max 64)');
  if (command !== 'create' && options['--amount-cents']) throw new Error('Amount is immutable after create');
  const directory = resolve(import.meta.dir, '..', '.local', 'paypal-sandbox');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = resolve(directory, `${dealId}.json`);
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new Error(`Payment journal is locked. Finish the other command. If it crashed, inspect ${lockPath} and reconcile before removing its stale lock.`);
  });
  try {
    let journal: SandboxJournal;
    try { journal = JSON.parse(await readFile(path, 'utf8')) as SandboxJournal; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read payment journal; preserve it for reconciliation');
      if (command !== 'create') throw new Error('Unknown deal; create the sandbox order first');
      const value = options['--amount-cents'];
      if (!value || !/^[1-9]\d*$/.test(value)) throw new Error('Supply positive integer --amount-cents');
      const cents = Number(value);
      // A harness limit, not a marketplace rule. Keep synthetic tests small.
      if (!Number.isSafeInteger(cents) || cents > 10000) throw new Error('Sandbox proof amount must be 1–10000 cents');
      journal = newJournal({ dealId, amountCents: cents, currency: 'USD', merchantId: config.merchantId });
    }
    if (journal.expected?.dealId !== dealId || journal.expected?.merchantId !== config.merchantId) throw new Error('Journal deal/seller does not match configuration');
    if (command === 'create' && options['--amount-cents'] !== String(journal.expected.amountCents)) throw new Error('Existing deal amount is immutable');
    const persist = async (data: SandboxJournal) => {
      const temporary = `${path}.tmp`;
      const file = await open(temporary, 'w', 0o600);
      try { await file.writeFile(JSON.stringify(data, null, 2) + '\n'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, path);
    };
    const session = new SandboxSession(journal, new PayPalSandbox(environment), persist);
    if (command === 'status') await session.reconcile();
    else await session[command as 'create' | 'authorize' | 'handoff' | 'capture' | 'void']();
    console.log(JSON.stringify({
      environment: 'SANDBOX', dealId, amountCents: journal.expected.amountCents, currency: 'USD',
      state: journal.state, orderId: journal.orderId, authorizationId: journal.authorizationId,
      captureId: journal.captureId, localTestHandoffConfirmed: !!journal.handoffConfirmedAt,
      ...(journal.state === 'approval_pending' ? { buyerApprovalUrl: journal.approvalUrl } : {}),
    }, null, 2));
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (import.meta.main) main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Sandbox operation failed');
  if (error instanceof PayPalError && error.uncertain) console.error('Remote outcome is unknown. Preserve the journal and run status before retrying.');
  process.exitCode = 1;
});
