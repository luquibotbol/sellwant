// Builds the hackathon demo bundle into dist-demo/ from the public values in
// wrangler.jsonc env.demo, so the client and the Worker can never disagree on
// which Supabase project they talk to. Refuses to build against production.
import { readFileSync, rmSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const PROD_REF = 'gguzeafbwsqkhggmcjjl';
const config = JSON.parse(
  readFileSync('wrangler.jsonc', 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'),
);
const vars = config.env?.demo?.vars ?? {};
const url: string = vars.SUPABASE_URL ?? '';
const key: string = vars.SUPABASE_ANON_KEY ?? '';
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(url)?.[1];
if (!ref || ref === PROD_REF) throw new Error(`env.demo SUPABASE_URL must be the demo project, got ${url}`);
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error('env.demo SUPABASE_ANON_KEY must be a publishable key');

const env: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  NODE_ENV: 'production',
  EXPO_NO_DOTENV: '1', // never pick up the production .env
  EXPO_PUBLIC_SUPABASE_URL: url,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
  EXPO_PUBLIC_AGENT_TRADING_ENABLED: 'true',
  EXPO_PUBLIC_AGENT_AI_ENABLED: vars.AGENT_AI_ENABLED === 'true' ? 'true' : 'false',
  EXPO_PUBLIC_AGENT_WATCHER_ENABLED: vars.AGENT_WATCHER_ENABLED === 'true' ? 'true' : 'false',
  EXPO_PUBLIC_SANDBOX_PAYMENTS_ENABLED: vars.DEAL_PAYMENTS_ENABLED === 'true' ? 'true' : 'false',
  EXPO_PUBLIC_HACKATHON_API_ORIGIN: vars.AGENT_AI_ORIGIN ?? '',
};

rmSync('dist-demo', { recursive: true, force: true });
const run = Bun.spawnSync(['bunx', 'expo', 'export', '-p', 'web', '--output-dir', 'dist-demo', '--clear'], {
  env, stdout: 'inherit', stderr: 'inherit',
});
if (run.exitCode !== 0) process.exit(run.exitCode ?? 1);

const dir = join('dist-demo', '_expo', 'static', 'js', 'web');
const js = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
if (!js.includes(`${ref}.supabase.co`)) throw new Error('demo bundle does not carry the demo Supabase URL');
if (js.includes(PROD_REF)) throw new Error('demo bundle references the production Supabase project');
console.log(`dist-demo built against ${ref}`);
