# Isolated schema baseline recovery

Run from `sellwant/`. The script accepts no connection URL. It validates a local
Unix Docker context, the exact `sellwant-paypal-ai-2026` container/project/network,
PostgreSQL image/version, DB port 55322, and unlinked CLI config before SQL.

```sh
python3 scripts/schema-baseline-local.py validate
python3 scripts/schema-baseline-local.py restore --allow-local-extension-owners
python3 scripts/schema-baseline-local.py compare --allow-local-extension-owners
python3 scripts/schema-baseline-local.py permissions
```

Restore requires an empty public application schema, no public routines, and no
existing application auth triggers/storage policies/listing-photo bucket. It
executes in one transaction and refuses to overwrite existing app objects. Do not
rerun restore after a successful restore; use compare. No reset/drop command is
provided. Commands do not read hosted data, run app migrations or copy app rows.

The inputs are the exact private project-root files:

- `Supabase Snippet Untitled query (1).csv`: 17 lossless metadata sections.
- `Supabase Snippet Untitled query.csv`: 56 public function definitions.

Python preserves exact integer sequence bounds. Source consistency checks reject
missing/duplicate sections and mismatched routine signatures. Only the 25 app
routines are replayed; 31 `pg_trgm` routines come from extension installation.
Column positions, including gaps left by dropped profile columns, and grantors,
column grants, sequence ACL/ownership, default ACLs, public/schema ACLs, trigger
enable modes, RLS policies and bucket restrictions are restored. Foreign keys are
added after all tables/unique constraints. Existing app SQL behavior is retained.
The generated SQL and detailed catalog/function comparison report are private,
mode 0600 and ignored under `.local/schema/`.

Source PostgreSQL is 17.6; the isolated CLI stack is 17.11. Extension versions and
schemas match. Three preinstalled platform extension owners differ:
`pg_stat_statements`, `pgcrypto`, `uuid-ossp` are owned by `postgres` in source and
`supabase_admin` locally. Local CREATE EXTENSION through Supabase's proxy retains
`supabase_admin` even with SET ROLE postgres; this was verified in rollback-only
transactions. No system-catalog owner edits are used. The explicit flag above
acknowledges only these exact three owner differences, records source/local rows
in the report, and rejects all other differences. Without it, compare exits 1 for
the extension owner divergence. All application objects/grants and the 25 app
function definitions must compare exactly in either mode.

Sequence definitions are restored, but current sequence counters start fresh:
the export intentionally contains no row data or current sequence state. Only
listing-photo bucket configuration was exported, so unrelated bucket data and
uploaded objects are outside this baseline. Role-level settings and platform
auth/storage schema versions come from the local Supabase image; this script
compares exported app metadata rather than claiming platform image identity.

The canonical comparator is `scripts/inspect-schema.sql`, executed read-only
against the isolated local DB; app function bodies are compared independently
through `pg_get_functiondef`. Baseline comparison should run before applying
fixes/migrations; a later intentional app migration will correctly produce a
difference against the recovered source.

The read-only `permissions` command checks effective positive/negative table,
column, routine, sequence and schema privileges for `anon`, `authenticated` and
`service_role`, rather than relying only on ACL text. This is a privilege matrix;
transactional role/RLS behavior is exercised separately by `test-core-local.ts`.
