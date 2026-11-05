/** Real PostgreSQL/PostgREST protocol check, NOT a recovered SellWant baseline.
 * Creates only a random fixture schema and a disposable local REST container.
 * Never reads hosted credentials, links a project, or creates public app tables.
 * PostgREST env names: https://docs.postgrest.org/en/stable/references/configuration.html
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import worker from '../worker/index.js';
import { MarketReadError, scanActiveMarket, type MarketListing } from '../worker/market';

const PROJECT = 'sellwant-paypal-ai-2026';
const DATABASE = `supabase_db_${PROJECT}`;
const EXISTING_REST = `supabase_rest_${PROJECT}`;
const NETWORK = `supabase_network_${PROJECT}`;
const REST_IMAGE = 'public.ecr.aws/supabase/postgrest:v16.5';
const OWNER_LABEL = 'com.sellwant.discovery-fixture';
const root = resolve(import.meta.dir, '..');
const token = crypto.randomUUID().replaceAll('-', '');
const schema = `sellwant_discovery_${token}`;
const fixtureName = `sellwant-discovery-test-${token}`;
const ownership = `SellWant local discovery protocol fixture ${token}`;
const expectedIds = Array.from({ length: 501 }, (_, i) => id(501 - i));
const publicKeys = ['currency', 'event_date', 'going_rate_cents', 'going_rate_status', 'id',
  'location', 'offers', 'price_cents', 'title', 'type', 'url'];

type Container = {
  Id: string;
  Name: string;
  Image: string;
  Config: { Image: string; Env: string[]; Labels: Record<string, string> };
  State: { Running: boolean; Health?: { Status: string } };
  NetworkSettings: {
    Networks: Record<string, { Aliases?: string[]; IPAddress: string; NetworkID: string }>;
    Ports: Record<string, { HostIp: string; HostPort: string }[] | null>;
  };
};

let context: string | undefined;
let databaseId: string | undefined;
let interrupted = false;
let schemaAttempted = false;
let containerAttempted = false;
let fixtureId: string | undefined;
let bridge: ReturnType<typeof Bun.serve> | undefined;
let proxyRequests = 0;
let originalPublicObjects: string | undefined;

function id(n: number) { return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`; }
function checkInterrupt() { if (interrupted) throw new Error('Interrupted; cleaning up fixture.'); }
const interrupt = () => { interrupted = true; };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

/** Suppress captured diagnostics: Docker/psql failures may contain a DB URI.
 * Pass the URI via child environment, never in command arguments or logs. */
async function command(args: string[], stage: string, options: {
  stdin?: string; env?: Record<string, string | undefined>; allowFailure?: boolean;
} = {}) {
  const child = (() => {
    try {
      return Bun.spawn(args, {
        cwd: root, env: options.env ?? process.env,
        stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
        stdout: 'pipe', stderr: 'pipe',
      });
    } catch { throw new Error(`${stage}: could not start local command.`); }
  })();
  const timeout = setTimeout(() => child.kill(), 60_000);
  try {
    const [output, , exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (exitCode !== 0 && !options.allowFailure) throw new Error(`${stage}: local command failed (details suppressed).`);
    return { output, exitCode };
  } finally { clearTimeout(timeout); }
}

function docker(args: string[], stage: string, options: Parameters<typeof command>[2] = {}) {
  assert(context, 'Local Docker context has not been verified.');
  return command(['docker', '--context', context, ...args], stage, options);
}

async function inspect(name: string): Promise<Container> {
  const { output } = await docker(['inspect', name], 'Inspect local container');
  try {
    const data = JSON.parse(output);
    assert.equal(data.length, 1);
    return data[0];
  } catch { throw new Error('Local container inspection returned invalid metadata.'); }
}

function localConfig(path: string) {
  assert(isAbsolute(path), 'Local project workdir must be absolute.');
  assert(!existsSync(resolve(path, 'supabase/.temp/project-ref')), 'Refusing a hosted-linked CLI project.');
  const config = readFileSync(resolve(path, 'supabase/config.toml'), 'utf8');
  assert.equal(/^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1], PROJECT,
    'Expected the isolated hackathon local project.');
}

function localProjectContainer(container: Container, name: string) {
  assert.equal(container.Name, `/${name}`, 'Unexpected local container name.');
  assert.equal(container.Config.Labels['com.supabase.cli.project'], PROJECT, 'Wrong CLI project label.');
  assert.equal(container.Config.Labels['com.docker.compose.project'], PROJECT, 'Wrong Compose project label.');
  assert(container.State.Running, 'Expected a running isolated local container.');
  assert(container.NetworkSettings.Networks[NETWORK], 'Expected the isolated local project network.');
}

async function sql(text: string, stage: string) {
  // Fixed local container and Unix socket; no caller-provided connection target.
  assert(databaseId, 'Local database container ID has not been verified.');
  return (await docker(['exec', '-i', databaseId, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres'], stage, {
    stdin: `SET statement_timeout = '10s'; SET lock_timeout = '5s';\n${text}\n`,
  })).output.trim();
}

async function publicObjects() {
  return sql(`SELECT coalesce(string_agg(c.relname || ':' || c.relkind::text, ',' ORDER BY c.relname), '')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S');`, 'Snapshot public catalog');
}

async function validateTarget() {
  // Fix all later calls to a verified Unix-socket context. Reject daemon overrides.
  for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) {
    assert(!process.env[name], `Unset ${name} before running this local-only check.`);
  }
  context = (await command(['docker', 'context', 'show'], 'Read Docker context')).output.trim();
  assert(/^[a-zA-Z0-9_.-]+$/.test(context), 'Invalid Docker context.');
  const contexts = JSON.parse((await docker(['context', 'inspect', context], 'Inspect Docker context')).output);
  assert.equal(contexts.length, 1);
  assert(/^unix:\/\/\//.test(contexts[0]?.Endpoints?.docker?.Host ?? ''),
    'Refusing a remote Docker daemon.');
  localConfig(root);
  const db = await inspect(DATABASE);
  const rest = await inspect(EXISTING_REST);
  localProjectContainer(db, DATABASE);
  localProjectContainer(rest, EXISTING_REST);
  assert.equal(db.State.Health?.Status, 'healthy', 'Local database is not healthy.');
  assert(/^[0-9a-f]{64}$/.test(db.Id), 'Missing immutable local database container ID.');
  assert.equal(db.Config.Image, 'public.ecr.aws/supabase/postgres:17.11.0.011', 'Unexpected local database image.');
  assert.equal(rest.Config.Image, REST_IMAGE, 'Unexpected local PostgREST image.');
  assert(/^sha256:[0-9a-f]{64}$/.test(rest.Image), 'Missing immutable local REST image ID.');
  const workdir = db.Config.Labels['com.supabase.cli.workdir'];
  assert.equal(rest.Config.Labels['com.supabase.cli.workdir'], workdir, 'Local project workdirs differ.');
  localConfig(workdir);
  assert.equal(Object.keys(db.NetworkSettings.Networks).join(','), NETWORK, 'Unexpected DB network attachment.');
  assert.equal(Object.keys(rest.NetworkSettings.Networks).join(','), NETWORK, 'Unexpected REST network attachment.');
  const networks = JSON.parse((await docker(['network', 'inspect', NETWORK], 'Inspect local network')).output);
  assert.equal(networks.length, 1);
  assert.equal(networks[0].Name, NETWORK);
  assert.equal(networks[0].Driver, 'bridge');
  assert.equal(networks[0].Scope, 'local');
  assert.equal(networks[0].Id, db.NetworkSettings.Networks[NETWORK].NetworkID);
  assert.equal(networks[0].Id, rest.NetworkSettings.Networks[NETWORK].NetworkID);

  const values = rest.Config.Env.filter(v => v.startsWith('PGRST_DB_URI='));
  assert.equal(values.length, 1, 'Expected one existing local REST database URI.');
  const dbUri = values[0].slice('PGRST_DB_URI='.length);
  let target: URL;
  try { target = new URL(dbUri); }
  catch { throw new Error('Existing local database URI is not a supported URI.'); }
  const aliases = db.NetworkSettings.Networks[NETWORK].Aliases ?? [];
  // Do not accept arbitrary IPs, alternate query parameters, sockets or hosted URLs.
  assert(['postgres:', 'postgresql:'].includes(target.protocol), 'Invalid local DB protocol.');
  assert(target.hostname === DATABASE || aliases.includes(target.hostname), 'DB URI must address this local DB container.');
  assert.equal(decodeURIComponent(target.username), 'authenticator', 'Expected local REST authenticator.');
  assert.equal(target.port || '5432', '5432', 'Unexpected local DB port.');
  assert.equal(target.pathname, '/postgres', 'Unexpected local database name.');
  assert.equal(target.search, '', 'DB URI query overrides are forbidden.');
  assert.equal(target.hash, '', 'DB URI fragments are forbidden.');
  assert(target.password, 'Expected the existing local REST credential.');
  databaseId = db.Id;
  return { dbUri, image: rest.Image };
}

async function createSchema() {
  assert(/^sellwant_discovery_[0-9a-f]{32}$/.test(schema));
  assert.equal(await sql(`SELECT count(*) FROM pg_namespace WHERE nspname = '${schema}';`, 'Check fixture namespace'), '0');
  schemaAttempted = true; // A lost command response must still trigger ownership-checked cleanup.
  await sql(`BEGIN;
    CREATE SCHEMA ${schema};
    COMMENT ON SCHEMA ${schema} IS '${ownership}';
    REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
    GRANT USAGE ON SCHEMA ${schema} TO anon, authenticator;
    CREATE TABLE ${schema}.listings (
      id uuid PRIMARY KEY, title text NOT NULL, type text NOT NULL CHECK (type IN ('sell', 'ask')),
      price_cents integer NOT NULL CHECK (price_cents > 0), event_date date, location text,
      best_offer_cents integer, offer_count integer NOT NULL CHECK (offer_count >= 0),
      status text NOT NULL CHECK (status IN ('active', 'sold', 'cancelled')),
      created_at timestamptz NOT NULL
    );
    ALTER TABLE ${schema}.listings ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE ${schema}.listings FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON TABLE ${schema}.listings TO anon;
    CREATE POLICY discovery_active_only ON ${schema}.listings FOR SELECT TO anon USING (status = 'active');
    INSERT INTO ${schema}.listings
      SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
        'Synthetic ticket ' || g, CASE WHEN g % 2 = 0 THEN 'ask' ELSE 'sell' END,
        1665 + g, DATE '2026-11-12', 'Synthetic campus',
        CASE WHEN g % 4 = 0 THEN NULL ELSE 1600 + g END,
        CASE WHEN g % 4 = 0 THEN 0 ELSE (g % 3) + 1 END, 'active',
        TIMESTAMPTZ '2026-11-05 01:02:03.123000+00' + (g / 3) * INTERVAL '1 microsecond'
      FROM generate_series(1, 501) AS g;
    INSERT INTO ${schema}.listings VALUES
      ('${id(502)}', 'INACTIVE-SOLD-SENTINEL', 'sell', 999999, NULL, NULL, NULL, 0, 'sold', NOW()),
      ('${id(503)}', 'INACTIVE-CANCELLED-SENTINEL', 'ask', 999999, NULL, NULL, NULL, 0, 'cancelled', NOW());
    COMMIT;`, 'Create isolated discovery fixture');
}

async function startRest(dbUri: string, image: string) {
  containerAttempted = true;
  const started = await docker(['run', '--detach', '--pull=never', '--name', fixtureName,
    '--label', `${OWNER_LABEL}=${token}`, '--network', NETWORK,
    '--publish', '127.0.0.1::3000', '--read-only', '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
    '--env', 'PGRST_DB_URI', '--env', `PGRST_DB_SCHEMAS=${schema}`,
    '--env', 'PGRST_DB_ANON_ROLE=anon', '--env', 'PGRST_DB_MAX_ROWS=75',
    '--env', 'PGRST_DB_CONFIG=false', '--env', 'PGRST_DB_EXTRA_SEARCH_PATH=',
    '--env', 'PGRST_DB_CHANNEL_ENABLED=false', '--env', 'PGRST_DB_POOL=2',
    '--env', 'PGRST_SERVER_HOST=0.0.0.0', '--env', 'PGRST_SERVER_PORT=3000', image],
  'Start disposable local REST fixture', { env: { ...process.env, PGRST_DB_URI: dbUri } });
  const runId = started.output.trim();
  assert(/^[0-9a-f]{64}$/.test(runId), 'Missing disposable container ID.');
  fixtureId = runId;
  const container = await inspect(fixtureId);
  assert.equal(container.Id, fixtureId, 'Fixture container ID mismatch.');
  assert.equal(container.Name, `/${fixtureName}`, 'Fixture container name mismatch.');
  assert.equal(container.Config.Labels[OWNER_LABEL], token, 'Fixture ownership label mismatch.');
  assert.equal(container.Image, image, 'Fixture image differs from verified local REST image.');
  assert.equal(Object.keys(container.NetworkSettings.Networks).join(','), NETWORK);
  const ports = container.NetworkSettings.Ports['3000/tcp'];
  assert.equal(ports?.length, 1, 'Expected one local fixture port.');
  assert.equal(ports[0].HostIp, '127.0.0.1', 'Fixture must bind only loopback.');
  assert(/^[1-9]\d{0,4}$/.test(ports[0].HostPort));
  const origin = `http://127.0.0.1:${ports[0].HostPort}`;
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) {
    checkInterrupt();
    try {
      const response = await fetch(`${origin}/listings?select=id&limit=1`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
      if (response.ok && (await response.json()).length === 1) return origin;
    } catch { /* Poll this exact instance; do not restart on an observation timeout. */ }
    await Bun.sleep(250);
  }
  throw new Error('Disposable local REST fixture did not become ready within 55 seconds.');
}

function startBridge(restOrigin: string) {
  bridge = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === '/rest/v1/listings' && request.method === 'GET') {
        proxyRequests++;
        assert.equal(request.headers.get('apikey'), 'synthetic-local-anon');
        assert.equal(request.headers.get('authorization'), null);
        const response = await fetch(`${restOrigin}/listings${url.search}`, {
          headers: { Prefer: request.headers.get('prefer') ?? '', 'accept-encoding': 'identity' },
          signal: AbortSignal.timeout(3000), redirect: 'error',
        });
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(await response.arrayBuffer(), { status: response.status, headers });
      }
      if (url.pathname === '/api/listings.json') {
        return worker.fetch(request, {
          SUPABASE_URL: `http://127.0.0.1:${server.port}`, SUPABASE_ANON_KEY: 'synthetic-local-anon',
        }, {});
      }
      return new Response('Not found', { status: 404 });
    },
    error() { return new Response('Local bridge failure', { status: 500 }); },
  });
  return `http://127.0.0.1:${bridge.port}`;
}

function checkListings(rows: MarketListing[]) {
  assert.deepEqual(rows.map(row => row.id), expectedIds, 'Every active listing must appear exactly once in keyset order.');
  assert.equal(new Set(rows.map(row => row.id)).size, 501);
  assert.equal(rows.filter(row => row.going_rate_status === 'no_offers').length, 125);
  for (const row of rows) {
    const n = Number(row.id.slice(-12));
    assert.deepEqual(Object.keys(row).sort(), [...publicKeys].sort(), 'Only whitelisted discovery fields may escape.');
    assert.equal(row.title, `Synthetic ticket ${n}`);
    assert.equal(row.price_cents, 1665 + n);
    assert(Number.isSafeInteger(row.price_cents));
    assert.equal(row.type, n % 2 === 0 ? 'want' : 'sell');
    assert.equal(row.currency, 'USD');
    assert.equal(row.offers, n % 4 === 0 ? 0 : n % 3 + 1);
    assert.equal(row.going_rate_cents, n % 4 === 0 ? null : 1600 + n);
    assert.equal(row.going_rate_status, n % 4 === 0 ? 'no_offers' : 'available');
    assert.equal(row.event_date, '2026-11-12');
    assert.equal(row.location, 'Synthetic campus');
  }
}

async function verify(restOrigin: string, origin: string) {
  // Actual RLS and privileges, not a stubbed HTTP response.
  const anon = await fetch(`${restOrigin}/listings?select=id,status&limit=1000`, {
    headers: { Prefer: 'count=exact' }, redirect: 'error', signal: AbortSignal.timeout(3000),
  });
  assert.equal(anon.status, 206);
  assert.equal(anon.headers.get('content-range'), '0-74/501');
  const anonRows = await anon.json();
  assert.equal(anonRows.length, 75, 'The real PostgREST max_rows cap must be active.');
  assert(anonRows.every((row: { status: string }) => row.status === 'active'), 'RLS must hide inactive sentinels even without an API filter.');
  const deniedWrite = await fetch(`${restOrigin}/listings`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: id(900), title: 'DENIED-WRITE' }),
    redirect: 'error', signal: AbortSignal.timeout(3000),
  });
  assert([401, 403].includes(deniedWrite.status), 'Anonymous fixture writes must be forbidden.');
  assert.equal(await sql(`SELECT count(*) FROM ${schema}.listings;`, 'Check read-only fixture'), '503');

  const before = proxyRequests;
  const all = await scanActiveMarket({ origin, pageSize: 200, maxPages: 20 });
  checkListings(all.listings);
  assert.equal(all.complete, true);
  assert.equal(all.next_cursor, null);
  assert.equal(all.pages, 7, 'A 75-row cap requires seven pages for 501 active listings.');
  assert.equal(proxyRequests - before, 7);

  const resumed: MarketListing[] = [];
  let cursor: string | null = null;
  for (let batch = 0; batch < 4; batch++) {
    checkInterrupt();
    const part = await scanActiveMarket({ origin, pageSize: 200, maxPages: 2, cursor });
    resumed.push(...part.listings);
    if (batch < 3) {
      assert.equal(part.complete, false, 'A bounded batch must advertise continuation.');
      assert(part.next_cursor);
    } else {
      assert.equal(part.complete, true);
      assert.equal(part.next_cursor, null);
    }
    cursor = part.next_cursor;
  }
  checkListings(resumed);

  const beforeInvalid = proxyRequests;
  const invalid = await fetch(`${origin}/api/listings.json?cursor=garbage`, { redirect: 'error' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'invalid_pagination');
  assert.equal(proxyRequests, beforeInvalid, 'Invalid pagination must fail before querying PostgreSQL.');

  await sql(`REVOKE SELECT ON TABLE ${schema}.listings FROM anon;`, 'Revoke fixture anonymous read permission');
  const deniedRead = await fetch(`${restOrigin}/listings?select=id`, { redirect: 'error' });
  assert([401, 403].includes(deniedRead.status), 'Permission denial must come from the real database.');
  const unavailable = await fetch(`${origin}/api/listings.json`, { redirect: 'error' });
  assert.equal(unavailable.status, 503);
  const error = await unavailable.json();
  assert.equal(error.error, 'market_unavailable');
  assert.equal(error.listings, undefined, 'Permission denial must not become an empty successful market.');
  await assert.rejects(scanActiveMarket({ origin, maxPages: 20 }),
    (error: unknown) => error instanceof MarketReadError && error.code === 'unavailable');
}

async function cleanup() {
  const failures: string[] = [];
  try { if (bridge) await bridge.stop(true); }
  catch { failures.push('Could not confirm local bridge shutdown.'); }
  if (containerAttempted) {
    try {
      // Resolve an unknown run outcome by the unguessable name and ownership
      // label, then always remove the verified immutable ID, never a name.
      const result = await docker(['inspect', fixtureId ?? fixtureName], 'Inspect fixture before removal', { allowFailure: true });
      if (result.exitCode === 0) {
        const containers = JSON.parse(result.output) as Container[];
        assert.equal(containers.length, 1);
        assert.equal(containers[0].Name, `/${fixtureName}`);
        assert.equal(containers[0].Config.Labels[OWNER_LABEL], token);
        assert(/^[0-9a-f]{64}$/.test(containers[0].Id));
        if (fixtureId) assert.equal(containers[0].Id, fixtureId);
        await docker(['rm', '--force', containers[0].Id], 'Remove only the owned disposable REST fixture');
      } else {
        // Confirm absence; a Docker failure must not be mistaken for successful cleanup.
        const listed = await docker(['ps', '--all', '--filter', `name=^/${fixtureName}$`, '--format', '{{.Names}}'], 'Confirm fixture absence');
        assert.equal(listed.output.trim(), '');
      }
    } catch { failures.push(`Could not confirm cleanup of owned fixture container ${fixtureName}.`); }
  }
  if (schemaAttempted) {
    try {
      await sql(`DO $cleanup$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '${schema}') THEN
          IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '${schema}'
            AND obj_description(oid, 'pg_namespace') = '${ownership}') THEN
            RAISE EXCEPTION 'Fixture schema ownership mismatch';
          END IF;
          DROP SCHEMA ${schema} CASCADE;
        END IF;
      END $cleanup$;`, 'Drop only the owned discovery fixture schema');
      assert.equal(await sql(`SELECT count(*) FROM pg_namespace WHERE nspname = '${schema}';`, 'Confirm schema cleanup'), '0');
    } catch { failures.push(`Could not confirm cleanup of owned fixture schema ${schema}.`); }
  }
  if (originalPublicObjects !== undefined) {
    try { assert.equal(await publicObjects(), originalPublicObjects, 'Public app catalog changed.'); }
    catch { failures.push('Could not confirm the public app catalog stayed unchanged.'); }
  }
  if (failures.length) throw new Error(failures.join(' '));
}

let failure: unknown;
try {
  const { dbUri, image } = await validateTarget();
  originalPublicObjects = await publicObjects();
  checkInterrupt();
  await createSchema();
  checkInterrupt();
  const restOrigin = await startRest(dbUri, image);
  const origin = startBridge(restOrigin);
  await verify(restOrigin, origin);
  checkInterrupt();
} catch (error) { failure = error; }
finally {
  try { await cleanup(); }
  catch (error) { failure = new Error(`${failure instanceof Error ? `${failure.message} ` : ''}${error instanceof Error ? error.message : 'Fixture cleanup failed.'}`); }
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}

if (failure) {
  // Assertion diagnostics may embed unexpected data; only print explicit safe messages.
  console.error(failure instanceof Error ? failure.message.split('\n')[0] : 'Local discovery check failed.');
  process.exitCode = 1;
} else {
  console.log('Local discovery passed: 501 active rows, real 75-row cap/RLS, keyset resume, integer cents, invalid cursor, permission failure.');
  console.log('Owned fixture container/schema removed; public app catalog unchanged. This does not prove core baseline recovery.');
}
