/** Local Node host for the actual Worker fetch/scheduled handlers.
 * Run only through hackathon-runtime-local.py in its owned, loopback-published
 * container. The timer is a local scheduler, not Cloudflare deployment proof.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import worker from './worker.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const env = JSON.parse(await readFile(resolve(root, 'env.json'), 'utf8'));
const origin = 'http://127.0.0.1:8788';
if (env.SUPABASE_URL !== 'http://127.0.0.1:55321' ||
    env.AGENT_AI_ORIGIN !== origin || env.AGENT_MCP_ORIGIN !== origin || env.DEAL_PAYMENTS_ORIGIN !== origin) {
  throw new Error('Unexpected isolated runtime configuration.');
}
const dist = resolve(root, 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
env.ASSETS = { async fetch(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url).pathname); }
  catch { return new Response(null, { status: 400 }); }
  const target = resolve(dist, `.${pathname}`);
  if (target !== dist && !target.startsWith(dist + '/')) return new Response(null, { status: 404 });
  for (const path of [target, target + '.html', resolve(target, 'index.html')]) {
    try {
      if (!(await stat(path)).isFile()) continue;
      return new Response(request.method === 'HEAD' ? null : await readFile(path), {
        headers: { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' },
      });
    } catch { /* An absent static route is handled by the Worker. */ }
  }
  return new Response('Not found', { status: 404 });
} };
// Node does not implement Cloudflare's HTMLRewriter or edge cache. Serve the
// real Expo export locally, including its exact dynamic templates, while API
// and scheduled requests still execute the bundled Worker unchanged. This is
// browser/runtime proof, not hosted SEO/edge-cache equivalence.
const dynamic = { deal: '/deal/[id].html', edit: '/edit/[id].html',
  event: '/event/[id].html', u: '/u/[id].html' };
async function browserAsset(request) {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;
  const url = new URL(request.url);
  const [, head, tail, ...rest] = url.pathname.split('/');
  if (rest.length === 0 && tail && Object.hasOwn(dynamic, head)) {
    const target = new Request(new URL(dynamic[head], origin), { method: request.method });
    const page = await env.ASSETS.fetch(target);
    if (page.ok) return page;
  }
  const missing = await env.ASSETS.fetch(new Request(new URL('/+not-found.html', origin), { method: request.method }));
  return new Response(missing.body, { status: 404, headers: missing.headers });
}
async function body(request, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Request too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function send(response, value) {
  const headers = new Headers(value.headers);
  // Node fetch has already decompressed upstream bodies.
  headers.delete('content-encoding'); headers.delete('content-length');
  response.writeHead(value.status, Object.fromEntries(headers));
  if (value.body) for await (const chunk of value.body) {
    if (!response.write(chunk)) await new Promise(done => response.once('drain', done));
  }
  response.end();
}

// The Worker continues to use its fixed loopback target guards inside Docker.
// This private proxy can reach only this task's local Kong container, never a
// caller-selected URL or the hosted project. It is not published on the host.
const upstream = 'http://supabase_kong_sellwant-paypal-ai-2026:8000';
const proxy = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:55321');
    if (url.origin !== 'http://127.0.0.1:55321' || !/^\/(rest|auth|storage)\/v1\//.test(url.pathname)) {
      response.writeHead(404); response.end(); return;
    }
    const headers = new Headers();
    for (const name of ['authorization', 'apikey', 'content-type', 'accept', 'prefer', 'range',
      'x-client-info', 'x-supabase-api-version']) if (request.headers[name]) headers.set(name, request.headers[name]);
    const data = ['GET', 'HEAD'].includes(request.method) ? undefined : await body(request, 512 * 1024);
    const result = await fetch(upstream + url.pathname + url.search, { method: request.method, headers,
      body: data, redirect: 'error', signal: AbortSignal.timeout(60000) });
    await send(response, result);
  } catch { response.writeHead(503); response.end('Local database unavailable.'); }
});
await new Promise((ready, reject) => { proxy.once('error', reject); proxy.listen(55321, '127.0.0.1', ready); });

const state = { instance: randomUUID(), started_at: new Date().toISOString(), scheduled_runs: 0,
  last_scheduled_at: null, last_scheduled_ok: null };
let stopping = false;
let timer;
async function scheduled() {
  if (stopping) return;
  const pending = [];
  try {
    await worker.scheduled({ scheduledTime: Date.now(), cron: '* * * * *' }, env, { waitUntil: p => pending.push(p) });
    const results = await Promise.allSettled(pending);
    state.last_scheduled_ok = results.every(result => result.status === 'fulfilled');
  } catch { state.last_scheduled_ok = false; }
  state.scheduled_runs++;
  state.last_scheduled_at = new Date().toISOString();
  console.log(JSON.stringify({ event: 'scheduled', ok: state.last_scheduled_ok, runs: state.scheduled_runs }));
  if (!stopping) timer = setTimeout(scheduled, 60000);
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin);
    if (url.origin !== origin || request.headers.host !== '127.0.0.1:8788') {
      response.writeHead(403); response.end(); return;
    }
    if (request.method === 'GET' && url.pathname === '/_local/runtime' && !url.search) {
      await send(response, Response.json({ ...state, kind: 'isolated_local_scheduler', hosted: false,
        browser_assets: 'expo_static_dynamic_templates', edge_html_rewriter: false },
        { headers: { 'cache-control': 'no-store' } })); return;
    }
    const data = ['GET', 'HEAD'].includes(request.method) ? undefined : await body(request, 64 * 1024);
    const incoming = new Request(url, { method: request.method, headers: request.headers, body: data });
    const pending = [];
    const workerRoute = url.pathname === '/mcp' || url.pathname === '/sitemap.xml' || url.pathname.startsWith('/api/');
    const result = workerRoute
      ? await worker.fetch(incoming, env, { waitUntil: p => pending.push(p) })
      : await browserAsset(incoming);
    await send(response, result);
    await Promise.allSettled(pending);
  } catch {
    if (!response.headersSent) response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end('{"error":"local_runtime_unavailable"}');
  }
});
await new Promise((ready, reject) => { server.once('error', reject); server.listen(8788, '0.0.0.0', ready); });
console.log(JSON.stringify({ event: 'ready', instance: state.instance, origin, hosted: false }));
void scheduled();
function stop() {
  stopping = true; clearTimeout(timer); server.close(); proxy.close();
  setTimeout(() => process.exit(0), 10000).unref();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
