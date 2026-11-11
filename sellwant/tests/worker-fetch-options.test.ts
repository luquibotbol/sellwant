import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

// The Workers runtime throws on fetch(..., { redirect: 'error' }) before any
// request is made ("won't be implemented ... use manual"). That made every
// Worker-side call fail closed in production -- /api/listings.json, AI
// drafts, MCP and PayPal -- while unit tests with a fake transport passed.
// Use redirect: 'manual' and treat any non-2xx (a 3xx included) as failure.
test('Worker code never passes redirect: "error" to fetch', () => {
  for (const file of readdirSync('worker')) {
    if (!/\.(js|ts)$/.test(file)) continue;
    const source = readFileSync(`worker/${file}`, 'utf8');
    expect({ file, uses: /redirect\s*:\s*['"]error['"]/.test(source) }).toEqual({ file, uses: false });
  }
});
