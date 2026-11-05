/** Real local MCP proof helper. Configuration enters over stdin, never argv. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import worker from '../worker/index.js';

async function main() {
  const input = JSON.parse(await Bun.stdin.text());
  if (input.mode === 'serve') {
    if (input.url !== 'http://127.0.0.1:55321' || typeof input.anonKey !== 'string') throw new Error();
    const env: Record<string, unknown> = {
      AGENT_MCP_ENABLED: 'true', SUPABASE_URL: input.url, SUPABASE_ANON_KEY: input.anonKey,
      ASSETS: { fetch: async () => new Response('Local proof asset fallback', { status: 404 }) },
    };
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      fetch: request => worker.fetch(request, env, { waitUntil: (promise: Promise<unknown>) => { void promise.catch(() => {}); } }),
    });
    const origin = `http://127.0.0.1:${server.port}`;
    env.AGENT_MCP_ORIGIN = origin;
    console.log(JSON.stringify({ endpoint: `${origin}/mcp` }));
    return;
  }
  if (input.mode !== 'client' || typeof input.token !== 'string' || !Array.isArray(input.actions)) throw new Error();
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/mcp'
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !endpoint.port) throw new Error();
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${input.token}` } },
  });
  const client = new Client({ name: 'sellwant-isolated-proof', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const results = [];
    for (const action of input.actions) {
      if (typeof action.name !== 'string' || action.arguments === null || typeof action.arguments !== 'object') throw new Error();
      try {
        results.push(await client.callTool({ name: action.name, arguments: action.arguments }));
      } catch (error) {
        const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
        if (!action.expectRejected || (code !== -32601 && code !== -32602)) throw error;
        results.push({ isError: true, protocolErrorCode: code,
          content: [{ type: 'text', text: 'Expected MCP tool/argument rejection.' }] });
      }
    }
    const output = JSON.stringify({ tools, results });
    if (output.includes(input.token)) throw new Error();
    console.log(output);
  } finally { await client.close(); }
}

main().catch(() => {
  // SDK failures can contain request metadata; do not print the error object.
  console.error('Local MCP bridge failed; no request credentials were printed.');
  process.exitCode = 1;
});
