// Writes one SQL file that builds the hackathon demo database from scratch:
// the production schema export, every repository migration since, then the
// synthetic demo seed. Paste it into the demo project's SQL editor.
//
//   bun scripts/demo-database-sql.ts <demo-project-ref> [output]
//
// The demo login password is generated once into .local/demo/password (git
// ignored) and substituted into the seed; it is never printed or committed.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PROD_REF = 'gguzeafbwsqkhggmcjjl';
const ref = process.argv[2] ?? '';
if (!/^[a-z0-9]{20}$/.test(ref) || ref === PROD_REF) {
  console.error('usage: bun scripts/demo-database-sql.ts <demo-project-ref> [output]  (never the production ref)');
  process.exit(1);
}
const output = process.argv[3] ?? '.local/demo/database.sql';

const passwordFile = '.local/demo/password';
mkdirSync(dirname(passwordFile), { recursive: true, mode: 0o700 });
if (!existsSync(passwordFile)) {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  writeFileSync(passwordFile, `Demo-${Buffer.from(bytes).toString('base64url')}\n`, { mode: 0o600 });
}
const password = readFileSync(passwordFile, 'utf8').trim();
if (!/^[A-Za-z0-9_-]{12,}$/.test(password)) throw new Error('unexpected password format');

// Everything after the 2026-11-04 schema export, in filename order. The
// schema export already contains the August migrations.
const migrations = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql') && f >= '20260821')
  .sort();

const sections: string[] = [
  `-- SellWant hackathon demo database for project ${ref}. Generated ${new Date().toISOString()}.`,
  '-- Run once in that project\'s SQL editor. NEVER run it against production.',
  section('docs/handoff/schema.sql', readFileSync('../docs/handoff/schema.sql', 'utf8')),
];
for (const f of migrations) {
  sections.push(section(f, readFileSync(join('supabase/migrations', f), 'utf8').replaceAll(PROD_REF, ref)));
}
sections.push(section('supabase/demo/seed.sql', readFileSync('supabase/demo/seed.sql', 'utf8').replaceAll('__DEMO_PASSWORD__', password)));
sections.push(`-- ===== check: every row should say true
select * from (values
  ('schema',      to_regclass('public.listings') is not null),
  ('migrations',  exists(select 1 from pg_constraint where conname = 'offers_message_bounded')),
  ('agent tables', to_regclass('public.agent_draft_usage') is not null),
  ('payments',    exists(select 1 from pg_proc where proname = 'claim_deal_payment')),
  ('demo users',  (select count(*) from public.profiles where id::text like 'd000000%') = 3),
  ('listings',    (select count(*) from public.listings where status = 'active') = 5)
) t(part, ok);
`);

mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, sections.join('\n\n'), { mode: 0o600 });
console.log(`wrote ${output}: schema + ${migrations.length} migrations + seed for ${ref}`);
console.log(migrations.join('\n'));

function section(name: string, sql: string): string {
  if (sql.includes(PROD_REF)) throw new Error(`${name} still references production`);
  // Each file is its own transaction, so a failure stops at that file.
  const wrapped = /^\s*begin\s*;/im.test(sql) ? sql : `begin;\n${sql}\ncommit;`;
  return `-- ================================================================ ${name}\n${wrapped}`;
}
