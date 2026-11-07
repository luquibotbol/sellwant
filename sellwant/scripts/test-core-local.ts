/** Real role/concurrency regression checks against the recovered local baseline.
 * No environment URL/key is used. All ordinary cases roll back; the race uses
 * uniquely owned synthetic rows and ownership-checked cleanup.
 *   bun scripts/test-core-local.ts --expect baseline
 *   bun scripts/test-core-local.ts --expect fixed --apply-core  # before mandates
 *   bun scripts/test-core-local.ts --expect fixed --rest
 * Baseline mode asserts the documented defects reproduce, alongside denial
 * controls. Fixed mode asserts corrected behavior; --rest adds actual loopback
 * PostgREST embedding/.single() contracts. Runtime keys stay only in memory.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT = 'sellwant-paypal-ai-2026';
const DB = `supabase_db_${PROJECT}`;
const NETWORK = `supabase_network_${PROJECT}`;
const root = resolve(import.meta.dir, '..');
const mode = process.argv[process.argv.indexOf('--expect') + 1];
assert(['baseline', 'fixed'].includes(mode), 'Supply --expect baseline or --expect fixed.');
const fixed = mode === 'fixed';
let context = '';
let databaseId = '';
let passed = 0;

async function command(args: string[], input?: string) {
  const child = Bun.spawn(args, { cwd: root, stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
    stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill(), 30_000);
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    assert.equal(code, 0, `Local command failed: ${err.slice(-1800)}`);
    return out.trim();
  } finally { clearTimeout(timer); }
}
const docker = (args: string[], input?: string) => command(['docker', '--context', context, ...args], input);
const psqlArgs = () => ['docker', '--context', context, 'exec', '-i', databaseId, 'psql', '-X', '-qAt',
  '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'];
const sql = (text: string) => command(psqlArgs(), `SET statement_timeout='15s'; SET lock_timeout='10s';\n${text}\n`);
function config(path: string) {
  assert(!existsSync(resolve(path, 'supabase/.temp/project-ref')), 'Hosted-linked project is forbidden.');
  assert.equal(/^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(resolve(path, 'supabase/config.toml'), 'utf8'))?.[1], PROJECT);
}
async function validateTarget() {
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) assert(!process.env[key], `Unset ${key}.`);
  context = (await command(['docker', 'context', 'show'])).trim();
  assert(/^[\w.-]+$/.test(context));
  const contexts = JSON.parse(await docker(['context', 'inspect', context]));
  assert.equal(contexts.length, 1);
  assert(/^unix:\/\/\//.test(contexts[0]?.Endpoints?.docker?.Host ?? ''), 'Remote Docker is forbidden.');
  config(root);
  const containers = JSON.parse(await docker(['inspect', DB]));
  assert.equal(containers.length, 1);
  const db = containers[0];
  assert.equal(db.Name, `/${DB}`);
  assert.equal(db.Config.Labels['com.supabase.cli.project'], PROJECT);
  assert.equal(db.Config.Labels['com.docker.compose.project'], PROJECT);
  assert.equal(db.Config.Image, 'public.ecr.aws/supabase/postgres:17.11.0.011');
  assert.equal(db.State.Health?.Status, 'healthy');
  assert.equal(Object.keys(db.NetworkSettings.Networks).join(','), NETWORK);
  config(db.Config.Labels['com.supabase.cli.workdir']);
  assert(/^[0-9a-f]{64}$/.test(db.Id));
  databaseId = db.Id;
  assert.equal(await sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('profiles','listings','offers','lock_ins');"), '4',
    'Recover and verify the faithful marketplace baseline first.');
}

function fixture() {
  const owner = crypto.randomUUID(), bidder = crypto.randomUUID(), other = crypto.randomUUID();
  const listing = crypto.randomUUID(), offer = crypto.randomUUID(), deal = crypto.randomUUID();
  const marker = `core-local-${crypto.randomUUID()}`;
  const users = [owner, bidder, other];
  const setup = `INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES
    ${users.map((u, i) => `('${u}','${marker}-${i}@example.edu','{"full_name":"Synthetic core regression"}'::jsonb)`).join(',')};
    INSERT INTO public.listings (id,user_id,type,title,price_cents,platform)
      VALUES ('${listing}','${owner}','sell','${marker}',2000,'bubbl');
    INSERT INTO public.offers (id,listing_id,from_user,amount_cents)
      VALUES ('${offer}','${listing}','${bidder}',1665);`;
  return { owner, bidder, other, listing, offer, deal, marker, users, setup };
}
type Fixture = ReturnType<typeof fixture>;
function asRole(role: 'anon' | 'authenticated', uid: string, statement: string, key = 'attempt') {
  assert(/^[a-z_]+$/.test(key));
  return `SET LOCAL ROLE ${role};
    DO $claims$ BEGIN
      PERFORM set_config('request.jwt.claim.sub','${uid}',true);
      PERFORM set_config('request.jwt.claims','${JSON.stringify({ sub: uid || undefined, role })}',true);
    END $claims$;
    DO $attempt$ BEGIN
      ${statement}
      PERFORM set_config('sellwant.${key}','ok',true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('sellwant.${key}',SQLSTATE || ':' || SQLERRM,true);
    END $attempt$;
    RESET ROLE;`;
}
function snapshot(f: Fixture, extra = '') {
  return `SELECT json_build_object(
    'attempt',current_setting('sellwant.attempt',true),
    'listing',(SELECT status FROM public.listings WHERE id='${f.listing}'),
    'offer',(SELECT status FROM public.offers WHERE id='${f.offer}'),
    'deals',(SELECT count(*) FROM public.lock_ins WHERE listing_id='${f.listing}'),
    'live_deals',(SELECT count(*) FROM public.lock_ins WHERE listing_id='${f.listing}' AND state<>'cancelled'),
    'states',(SELECT coalesce(json_agg(state ORDER BY state),'[]') FROM public.lock_ins WHERE listing_id='${f.listing}'),
    'prices',(SELECT coalesce(json_agg(locked_price_cents ORDER BY locked_price_cents),'[]') FROM public.lock_ins WHERE listing_id='${f.listing}'),
    'buyer',(SELECT buyer_id FROM public.lock_ins WHERE listing_id='${f.listing}' AND state<>'cancelled' LIMIT 1),
    'seller',(SELECT seller_id FROM public.lock_ins WHERE listing_id='${f.listing}' AND state<>'cancelled' LIMIT 1)
    ${extra});`;
}
type Result = { attempt: string; listing: string; offer: string; deals: number; live_deals: number; states: string[]; prices: number[]; [key: string]: unknown };
async function check(name: string, build: (f: Fixture) => string, verify: (r: Result, f: Fixture) => void) {
  const f = fixture();
  const output = await sql(`BEGIN; ${f.setup}\n${build(f)}\n${snapshot(f)}\nROLLBACK;`);
  const result = JSON.parse(output.split('\n').findLast(line => line.startsWith('{'))!);
  try { verify(result, f); } catch (error) { console.error(name, result); throw error; }
  console.log(`PASS ${name}`); passed++;
}
const denied = (r: Result) => assert.notEqual(r.attempt, 'ok');

async function roleChecks() {
  for (const role of ['anon', 'authenticated'] as const) {
    await check(`${role} without UID cannot cancel listing`, f => asRole(role, '', `PERFORM public.cancel_listing('${f.listing}');`), r => {
      if (fixed) { denied(r); assert.equal(r.listing, 'active'); }
      else { assert.equal(r.attempt, 'ok'); assert.equal(r.listing, 'cancelled'); }
    });
  }
  await check('anonymous accept denied by execute ACL', f => asRole('anon', '', `PERFORM public.accept_offer('${f.offer}');`), r => {
    denied(r); assert.equal(r.deals, 0);
  });
  await check('authenticated without UID cannot accept offer', f => asRole('authenticated', '', `PERFORM public.accept_offer('${f.offer}');`), r => {
    if (fixed) { denied(r); assert.equal(r.deals, 0); }
    else { assert.equal(r.attempt, 'ok'); assert.equal(r.deals, 1); }
  });
  await check('authenticated without UID cannot advance deal', f => `
    INSERT INTO public.lock_ins (id,listing_id,buyer_id,seller_id,locked_price_cents)
      VALUES ('${f.deal}','${f.listing}','${f.bidder}','${f.owner}',1665);
    ${asRole('authenticated', '', `PERFORM public.advance_deal('${f.deal}','paid');`)}`, r => {
    if (fixed) { denied(r); assert.deepEqual(r.states, ['pending_payment']); }
    else { assert.equal(r.attempt, 'ok'); assert.deepEqual(r.states, ['paid']); }
  });
  for (const action of ['cancel', 'accept'] as const) {
    await check(`stranger cannot ${action}`, f => asRole('authenticated', f.other,
      action === 'cancel' ? `PERFORM public.cancel_listing('${f.listing}');` : `PERFORM public.accept_offer('${f.offer}');`), r => {
      denied(r); assert.equal(r.listing, 'active'); assert.equal(r.deals, 0);
    });
  }
  for (const forged of [{ cents: 1, state: 'pending_payment' }, { cents: 2000, state: 'paid' }, { cents: 2000, state: 'confirmed' }]) {
    await check(`direct buy-now cannot forge ${forged.cents} cents / ${forged.state}`, f => asRole('authenticated', f.bidder,
      `INSERT INTO public.lock_ins(listing_id,buyer_id,seller_id,locked_price_cents,state)
       VALUES('${f.listing}','${f.bidder}','${f.owner}',${forged.cents},'${forged.state}');`), r => {
      if (fixed) { denied(r); assert.equal(r.deals, 0); assert.equal(r.listing, 'active'); }
      else { assert.equal(r.attempt, 'ok'); assert.equal(r.deals, 1); assert.deepEqual(r.prices, [forged.cents]); }
    });
  }
  for (const suspended of ['owner', 'bidder'] as const) {
    await check(`suspended ${suspended} prevents acceptance`, f => `UPDATE public.profiles SET is_suspended=true WHERE id='${f[suspended]}';
      ${asRole('authenticated', f.owner, `PERFORM public.accept_offer('${f.offer}');`)}`, r => {
      if (fixed) { denied(r); assert.equal(r.deals, 0); }
      else { assert.equal(r.attempt, 'ok'); assert.equal(r.deals, 1); }
    });
  }
  await check('cancelled deal history permits a new acceptance', f => `
    INSERT INTO public.lock_ins(listing_id,buyer_id,seller_id,locked_price_cents)
      VALUES('${f.listing}','${f.bidder}','${f.owner}',1665);
    ${asRole('authenticated', f.owner, `PERFORM public.advance_deal((SELECT id FROM public.lock_ins WHERE listing_id='${f.listing}'),'cancelled');`, 'cancel')}
    INSERT INTO public.offers(id,listing_id,from_user,amount_cents)
      VALUES('${crypto.randomUUID()}','${f.listing}','${f.bidder}',1700);
    ${asRole('authenticated', f.owner, `PERFORM public.accept_offer((SELECT id FROM public.offers WHERE listing_id='${f.listing}' AND status='open'));`)}`, r => {
    if (fixed) { assert.equal(r.attempt, 'ok'); assert.equal(r.deals, 2); assert.equal(r.live_deals, 1); assert.equal(r.listing, 'locked'); }
    else { denied(r); assert.equal(r.deals, 1); assert.equal(r.live_deals, 0); assert.equal(r.listing, 'active'); }
  });
}

async function fixedChecks() {
  if (!fixed) return;
  for (const type of ['sell', 'ask']) {
    await check(`${type} buy-now derives exact amount and roles`, f => `UPDATE public.listings SET type='${type}' WHERE id='${f.listing}';
      ${asRole('authenticated', f.bidder, `PERFORM public.create_lock_in('${f.listing}',2000);`)}`, (r, f) => {
      assert.equal(r.attempt, 'ok'); assert.equal(r.live_deals, 1); assert.deepEqual(r.prices, [2000]); assert.deepEqual(r.states, ['pending_payment']);
      assert.equal(r.buyer, type === 'sell' ? f.bidder : f.owner); assert.equal(r.seller, type === 'sell' ? f.owner : f.bidder);
    });
    await check(`${type} manual offer uses canonical seam`, f => `UPDATE public.listings SET type='${type}' WHERE id='${f.listing}';
      ${asRole('authenticated', f.bidder, `PERFORM public.place_offer('${f.listing}',1750,'Synthetic counter',NULL);`, 'place')}
      ${asRole('authenticated', f.owner, `PERFORM public.accept_offer((SELECT id FROM public.offers WHERE listing_id='${f.listing}' AND status='open'));`)}`, (r, f) => {
      assert.equal(r.attempt, 'ok'); assert.deepEqual(r.prices, [1750]); assert.equal(r.live_deals, 1);
      assert.equal(r.buyer, type === 'sell' ? f.bidder : f.owner); assert.equal(r.seller, type === 'sell' ? f.owner : f.bidder);
    });
    await check(`${type} poster counter accepted only by its recipient`, f => `UPDATE public.listings SET type='${type}' WHERE id='${f.listing}';
      ${asRole('authenticated', f.owner, `PERFORM public.place_offer('${f.listing}',1800,'Synthetic poster counter','${f.offer}');`, 'place')}
      ${asRole('authenticated', f.other, `PERFORM public.accept_offer((SELECT id FROM public.offers WHERE listing_id='${f.listing}' AND from_user='${f.owner}'));`, 'stranger')}
      DO $assert$ BEGIN IF current_setting('sellwant.stranger')='ok' THEN RAISE EXCEPTION 'Stranger accepted counter'; END IF; END $assert$;
      ${asRole('authenticated', f.bidder, `PERFORM public.accept_offer((SELECT id FROM public.offers WHERE listing_id='${f.listing}' AND from_user='${f.owner}'));`)}`, (r, f) => {
      assert.equal(r.attempt, 'ok'); assert.deepEqual(r.prices, [1800]); assert.equal(r.live_deals, 1);
      assert.equal(r.buyer, type === 'sell' ? f.bidder : f.owner); assert.equal(r.seller, type === 'sell' ? f.owner : f.bidder);
    });
  }
  await check('manual offer withdrawal stays available', f => asRole('authenticated', f.bidder,
    `PERFORM public.set_offer_status('${f.offer}','withdrawn');`), r => { assert.equal(r.attempt, 'ok'); assert.equal(r.offer, 'withdrawn'); });
  await check('manual incoming offer decline stays available', f => asRole('authenticated', f.owner,
    `PERFORM public.set_offer_status('${f.offer}','declined');`), r => { assert.equal(r.attempt, 'ok'); assert.equal(r.offer, 'declined'); });
  for (const statement of [
    (f: Fixture) => `UPDATE public.offers SET status='accepted' WHERE id='${f.offer}';`,
    (f: Fixture) => `UPDATE public.offers SET amount_cents=9999 WHERE id='${f.offer}';`,
    (f: Fixture) => `DELETE FROM public.offers WHERE id='${f.offer}';`,
    (f: Fixture) => `INSERT INTO public.offers(listing_id,from_user,amount_cents,status) VALUES('${f.listing}','${f.bidder}',1,'accepted');`,
    (_f: Fixture) => `TRUNCATE public.offers CASCADE;`,
    (_f: Fixture) => `TRUNCATE public.lock_ins CASCADE;`,
    (_f: Fixture) => `TRUNCATE public.listings CASCADE;`,
  ]) {
    const probe = statement(fixture()).split(' ').slice(0, 3).join(' ');
    await check(`authenticated direct mutation denied: ${probe}`, f => asRole('authenticated', f.bidder, statement(f)), r => {
      denied(r); assert.equal(r.offer, 'open'); assert.equal(r.listing, 'active'); assert.equal(r.deals, 0);
    });
  }
  for (const action of ['UPDATE', 'DELETE']) {
    await check(`authenticated direct deal ${action} denied`, f => `INSERT INTO public.lock_ins(id,listing_id,buyer_id,seller_id,locked_price_cents)
        VALUES('${f.deal}','${f.listing}','${f.bidder}','${f.owner}',1665);
      ${asRole('authenticated', f.bidder, action === 'UPDATE'
        ? `UPDATE public.lock_ins SET state='confirmed' WHERE id='${f.deal}';`
        : `DELETE FROM public.lock_ins WHERE id='${f.deal}';`)}`, r => { denied(r); assert.equal(r.deals, 1); assert.deepEqual(r.states, ['pending_payment']); });
  }
  for (const cents of [1, 1999, 2001]) {
    await check(`buy-now rejects mismatched expected price ${cents}`, f => asRole('authenticated', f.bidder,
      `PERFORM public.create_lock_in('${f.listing}',${cents});`), r => { denied(r); assert.equal(r.deals, 0); });
  }
  await check('buy-now rejects self-trading', f => asRole('authenticated', f.owner,
    `PERFORM public.create_lock_in('${f.listing}',2000);`), r => { denied(r); assert.equal(r.deals, 0); });
  await check('buy-now retry returns the existing deal', f => `${asRole('authenticated', f.bidder,
    `PERFORM public.create_lock_in('${f.listing}',2000);`, 'first')}
    ${asRole('authenticated', f.bidder, `PERFORM public.create_lock_in('${f.listing}',2000);`)}`, r => {
      assert.equal(r.attempt, 'ok'); assert.equal(r.deals, 1);
    });
  await check('poster cannot invent an opening bid', f => asRole('authenticated', f.owner,
    `PERFORM public.place_offer('${f.listing}',1700,NULL,NULL);`), r => { denied(r); assert.equal(r.deals, 0); });
  await check('recipient cannot accept a counter after withdrawing parent', f => `
    ${asRole('authenticated', f.owner, `PERFORM public.place_offer('${f.listing}',1800,NULL,'${f.offer}');`, 'place')}
    ${asRole('authenticated', f.bidder, `PERFORM public.set_offer_status('${f.offer}','withdrawn');`, 'withdraw')}
    ${asRole('authenticated', f.bidder, `PERFORM public.accept_offer((SELECT id FROM public.offers WHERE listing_id='${f.listing}' AND from_user='${f.owner}'));`)}`, r => {
      denied(r); assert.equal(r.deals, 0); assert.equal(r.offer, 'withdrawn');
    });
  await check('buyer legacy paid and confirm transitions remain idempotent', f => `
    INSERT INTO public.lock_ins(id,listing_id,buyer_id,seller_id,locked_price_cents)
      VALUES('${f.deal}','${f.listing}','${f.bidder}','${f.owner}',1665);
    ${asRole('authenticated', f.owner, `PERFORM public.advance_deal('${f.deal}','paid');`, 'seller')}
    DO $assert$ BEGIN IF current_setting('sellwant.seller')='ok' THEN RAISE EXCEPTION 'Seller marked paid'; END IF; END $assert$;
    ${asRole('authenticated', f.bidder, `PERFORM public.advance_deal('${f.deal}','paid'); PERFORM public.advance_deal('${f.deal}','confirmed'); PERFORM public.advance_deal('${f.deal}','confirmed');`)}`, r => {
      assert.equal(r.attempt, 'ok'); assert.deepEqual(r.states, ['confirmed']); assert.equal(r.listing, 'sold');
    });
}

async function waitFor(query: string, label: string) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await sql(query) === 't') return;
    await Bun.sleep(25);
  }
  throw new Error(`Timed out waiting for authoritative local ${label}.`);
}

async function cleanupFixture(f: Fixture) {
  await sql(`BEGIN;
    DO $owner$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM public.listings WHERE id='${f.listing}' AND title='${f.marker}' AND user_id='${f.owner}')
        OR (SELECT count(*) FROM auth.users WHERE id IN (${f.users.map(x => `'${x}'`).join(',')}) AND email LIKE '${f.marker}-%@example.edu')<>3
      THEN RAISE EXCEPTION 'Fixture ownership mismatch; refusing cleanup'; END IF;
    END $owner$;
    DO $outbox$ BEGIN
      IF to_regclass('public.email_outbox') IS NOT NULL THEN
        DELETE FROM public.email_outbox WHERE listing_id='${f.listing}';
      END IF;
    END $outbox$;
    DELETE FROM public.listings WHERE id='${f.listing}';
    DELETE FROM auth.users WHERE id IN (${f.users.map(x => `'${x}'`).join(',')}); COMMIT;`);
}

async function acceptanceRace() {
  const f = fixture();
  const holderName = `core_holder_${crypto.randomUUID().replaceAll('-', '')}`;
  const acceptName = `core_accept_${crypto.randomUUID().replaceAll('-', '')}`;
  let holder: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | undefined;
  let accept: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | undefined;
  let holderOutput: Promise<string> | undefined;
  let acceptOutput: Promise<string> | undefined;
  let holderError: Promise<string> | undefined;
  let acceptError: Promise<string> | undefined;
  let created = false;
  try {
    await sql(`BEGIN; ${f.setup} COMMIT;`); created = true;
    holder = Bun.spawn(psqlArgs(), { cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    holderOutput = new Response(holder.stdout).text(); holderError = new Response(holder.stderr).text();
    assert(holder.stdin && typeof holder.stdin !== 'number');
    holder.stdin.write(`SET application_name='${holderName}'; BEGIN; SET LOCAL statement_timeout='15s';
      SELECT id FROM public.listings WHERE id='${f.listing}' FOR UPDATE;\n`);
    await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${holderName}' AND state='idle in transaction');`, 'listing lock holder');
    accept = Bun.spawn(psqlArgs(), { cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    acceptOutput = new Response(accept.stdout).text(); acceptError = new Response(accept.stderr).text();
    assert(accept.stdin && typeof accept.stdin !== 'number');
    accept.stdin.write(`SET application_name='${acceptName}'; BEGIN; SET LOCAL statement_timeout='15s';
      ${asRole('authenticated', f.owner, `PERFORM public.accept_offer('${f.offer}');`)}
      SELECT current_setting('sellwant.attempt'); COMMIT;\n`);
    accept.stdin.end();
    await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity h ON h.application_name='${holderName}'
      WHERE a.application_name='${acceptName}' AND a.wait_event_type='Lock' AND h.pid=ANY(pg_blocking_pids(a.pid)));`, 'blocked acceptance');
    // The bidder's withdrawal commits while acceptance is waiting for listing.
    // Fixed RPCs reread/lock the offer only after acquiring the listing lock.
    holder.stdin.write(`${asRole('authenticated', f.bidder, fixed
      ? `PERFORM public.set_offer_status('${f.offer}','withdrawn');`
      : `UPDATE public.offers SET status='withdrawn' WHERE id='${f.offer}';`)}
      SELECT current_setting('sellwant.attempt'); COMMIT;\n`);
    holder.stdin.end();
    const [hCode, aCode, hOut, aOut, hErr, aErr] = await Promise.all([holder.exited, accept.exited, holderOutput, acceptOutput, holderError, acceptError]);
    assert.equal(hCode, 0, hErr); assert.equal(aCode, 0, aErr); assert(hOut.includes('ok'));
    const result = JSON.parse((await sql(snapshot(f))).split('\n').findLast(line => line.startsWith('{'))!);
    if (fixed) { assert(!aOut.split('\n').includes('ok')); assert.equal(result.deals, 0); assert.equal(result.offer, 'withdrawn'); }
    else { assert(aOut.split('\n').includes('ok')); assert.equal(result.deals, 1); assert.equal(result.offer, 'accepted'); }
    console.log('PASS acceptance cannot consume an offer withdrawn while waiting'); passed++;
  } finally {
    for (const child of [holder, accept]) if (child && child.exitCode === null) child.kill();
    await Promise.allSettled([holder?.exited, accept?.exited, holderOutput, acceptOutput, holderError, acceptError]);
    if (created) await cleanupFixture(f);
  }
}

async function competingActions(kind: 'accept' | 'confirm_cancel') {
  const f = fixture(), secondOffer = crypto.randomUUID();
  const tag = crypto.randomUUID().replaceAll('-', '');
  const holderName = `core_holder_${tag}`;
  const names = [`core_first_${tag}`, `core_second_${tag}`];
  let holder: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | undefined;
  const workers: Bun.Subprocess<'pipe', 'pipe', 'pipe'>[] = [];
  const streams: Promise<string>[] = [];
  let created = false;
  try {
    await sql(`BEGIN; ${f.setup}
      ${kind === 'accept' ? `INSERT INTO public.offers(id,listing_id,from_user,amount_cents)
        VALUES('${secondOffer}','${f.listing}','${f.other}',1800);`
      : `INSERT INTO public.lock_ins(id,listing_id,buyer_id,seller_id,locked_price_cents,state)
        VALUES('${f.deal}','${f.listing}','${f.bidder}','${f.owner}',1665,'paid');`}
      COMMIT;`); created = true;
    holder = Bun.spawn(psqlArgs(), { cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    streams.push(new Response(holder.stdout).text(), new Response(holder.stderr).text());
    holder.stdin.write(`SET application_name='${holderName}'; BEGIN; SELECT id FROM public.listings WHERE id='${f.listing}' FOR UPDATE;\n`);
    await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${holderName}' AND state='idle in transaction');`, 'race holder');
    for (const [i, name] of names.entries()) {
      const worker = Bun.spawn(psqlArgs(), { cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
      workers.push(worker);
      streams.push(new Response(worker.stdout).text(), new Response(worker.stderr).text());
      const action = kind === 'accept'
        ? asRole('authenticated', f.owner, `PERFORM public.accept_offer('${i === 0 ? f.offer : secondOffer}');`)
        : asRole('authenticated', i === 0 ? f.bidder : f.owner,
          `PERFORM public.advance_deal('${f.deal}','${i === 0 ? 'confirmed' : 'cancelled'}');`);
      worker.stdin.write(`SET application_name='${name}'; BEGIN; SET LOCAL statement_timeout='15s';
        ${action} SELECT current_setting('sellwant.attempt'); COMMIT;\n`);
      worker.stdin.end();
    }
    // PostgreSQL may queue the second waiter behind the first row-lock waiter,
    // so its direct blocker need not be the original transaction holder.
    await waitFor(`SELECT count(*)=2 FROM pg_stat_activity a
      WHERE a.application_name IN ('${names[0]}','${names[1]}') AND a.wait_event_type='Lock'
      AND cardinality(pg_blocking_pids(a.pid))>0;`, 'both blocked actions');
    holder.stdin.write('COMMIT;\n'); holder.stdin.end();
    const codes = await Promise.all([holder.exited, ...workers.map(w => w.exited)]);
    const output = await Promise.all(streams);
    assert(codes.every(code => code === 0), output.join('\n'));
    const successes = [output[2], output[4]].filter(value => value.split('\n').includes('ok')).length;
    assert.equal(successes, 1, 'Exactly one competing mutation must succeed.');
    const result = JSON.parse((await sql(snapshot(f))).split('\n').findLast(line => line.startsWith('{'))!);
    assert.equal(result.deals, 1);
    if (kind === 'accept') {
      assert.equal(result.live_deals, 1); assert.equal(result.listing, 'locked');
      assert.equal(await sql(`SELECT count(*) FROM public.offers WHERE listing_id='${f.listing}' AND status='accepted';`), '1');
    } else {
      assert(['confirmed', 'cancelled'].includes(result.states[0]));
      assert.equal(result.listing, result.states[0] === 'confirmed' ? 'sold' : 'active');
    }
    console.log(`PASS ${kind === 'accept' ? 'competing accepts create one deal' : 'confirm and cancel serialize to one terminal state'}`); passed++;
  } finally {
    for (const child of [holder, ...workers]) if (child && child.exitCode === null) child.kill();
    await Promise.allSettled([holder?.exited, ...workers.map(w => w.exited), ...streams]);
    if (created) await cleanupFixture(f);
  }
}

async function restContracts() {
  assert(fixed, '--rest requires --expect fixed.');
  // Read only this already-validated local CLI stack's runtime keys in memory.
  // No .env, hosted target, credential argument or credential logging is used.
  const status = JSON.parse(await command([resolve(root, 'node_modules/.bin/supabase'), 'status', '--output', 'json']));
  assert.equal(status.API_URL, 'http://127.0.0.1:55321');
  const dbUrl = new URL(status.DB_URL);
  assert.equal(dbUrl.hostname, '127.0.0.1'); assert.equal(dbUrl.port, '55322');
  assert(typeof status.ANON_KEY === 'string' && typeof status.JWT_SECRET === 'string');
  const f = fixture();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(status.JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  async function token(uid: string) {
    const now = Math.floor(Date.now() / 1000);
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated',
      iss: `${status.API_URL}/auth/v1`, iat: now, exp: now + 120 })).toString('base64url');
    const signed = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`))).toString('base64url');
    return `${head}.${body}.${signed}`;
  }
  const buyerToken = await token(f.bidder), ownerToken = await token(f.owner);
  async function rpc(name: string, data: object, authorization: string, select?: string) {
    assert(['place_offer', 'set_offer_status', 'create_lock_in', 'advance_deal'].includes(name));
    const url = new URL(`/rest/v1/rpc/${name}`, status.API_URL);
    if (select) url.searchParams.set('select', select);
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${authorization}`,
        'Content-Type': 'application/json', Accept: 'application/vnd.pgrst.object+json' }, body: JSON.stringify(data) });
    const json = await response.json();
    assert.equal(response.status, 200, `Local ${name} REST contract failed (${response.status}, ${json.code ?? 'unknown'}).`);
    assert(json && typeof json.id === 'string' && !Array.isArray(json), `${name} must support .single().`);
    return json;
  }
  let created = false;
  try {
    await sql(`BEGIN; ${f.setup} COMMIT;`); created = true;
    const select = '*,from:profiles!offers_from_user_fkey(id,full_name,profile_picture,instagram,completed_deals)';
    const offer = await rpc('place_offer', { p_listing_id: f.listing, p_amount_cents: 1750,
      p_message: 'Synthetic REST contract', p_parent_offer_id: null }, buyerToken, select);
    assert.equal(offer.amount_cents, 1750); assert.equal(offer.from?.id, f.bidder);
    assert.equal(offer.from.full_name, 'Synthetic core regression');
    const withdrawn = await rpc('set_offer_status', { p_offer_id: offer.id, p_to: 'withdrawn' }, buyerToken);
    assert.equal(withdrawn.status, 'withdrawn');
    const next = await rpc('place_offer', { p_listing_id: f.listing, p_amount_cents: 1800,
      p_message: null, p_parent_offer_id: null }, buyerToken, select);
    const declined = await rpc('set_offer_status', { p_offer_id: next.id, p_to: 'declined' }, ownerToken);
    assert.equal(declined.status, 'declined');
    const deal = await rpc('create_lock_in', { p_listing_id: f.listing, p_expected_price_cents: 2000 }, buyerToken);
    assert.equal(deal.buyer_id, f.bidder); assert.equal(deal.seller_id, f.owner);
    assert.equal(deal.locked_price_cents, 2000); assert.equal(deal.state, 'pending_payment');
    const retry = await rpc('create_lock_in', { p_listing_id: f.listing, p_expected_price_cents: 2000 }, buyerToken);
    assert.equal(retry.id, deal.id);
    const cancelled = await rpc('advance_deal', { p_lock_in_id: deal.id, p_to: 'cancelled' }, ownerToken);
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(await sql(`SELECT status FROM public.listings WHERE id='${f.listing}';`), 'active');
    console.log('PASS real local REST composite RPC embedding, .single(), offer/withdraw/decline/buy-now/retry/cancel'); passed++;
  } finally { if (created) await cleanupFixture(f); }
}

await validateTarget();
if (process.argv.includes('--apply-core')) {
  assert(fixed, '--apply-core requires --expect fixed.');
  assert.equal(await sql("SELECT to_regclass('public.agent_mandates') IS NULL;"), 't',
    'Core must precede mandates. Refusing to replace active mandate hooks.');
  await sql(readFileSync(resolve(root, 'supabase/migrations/202611050001_core_trade_authorization.sql'), 'utf8'));
}
await roleChecks();
await fixedChecks();
await acceptanceRace();
await competingActions('accept');
await competingActions('confirm_cancel');
if (process.argv.includes('--rest')) await restContracts();
console.log(`${passed} real local core checks passed (${mode} expectations).`);
