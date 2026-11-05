-- Read-only recovery of public schema and listing-photo bucket configuration.
-- No application table rows, storage objects or uploaded contents.
-- Run in SQL Editor and export the result as CSV. This is not a migration.
-- Return JSON as text so browser exports cannot round 64-bit integers.
SELECT 'relations' AS section, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text AS metadata
FROM (
  SELECT c.relname AS name, c.relkind::text AS kind,
         pg_get_userbyid(c.relowner) AS owner, c.relacl AS acl,
         c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
         c.reloptions AS options,
         CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END AS view_definition,
         CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END AS partition_key,
         CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound, c.oid) END AS partition_bound
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  ORDER BY c.relname
) x
UNION ALL
SELECT 'columns', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT c.relname AS relation_name, a.attnum AS position, a.attname AS name,
         format_type(a.atttypid, a.atttypmod) AS type,
         a.attnotnull AS not_null, a.attacl AS acl,
         pg_get_expr(d.adbin, d.adrelid) AS default_expression,
         a.attidentity::text AS identity, a.attgenerated::text AS generated,
         CASE WHEN a.attcollation <> 0 THEN a.attcollation::regcollation::text END AS collation
  FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
    AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY c.relname, a.attnum
) x
UNION ALL
SELECT 'constraints', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT c.relname AS relation_name, k.conname AS name, k.contype::text AS kind,
         pg_get_constraintdef(k.oid, true) AS definition, k.convalidated AS validated
  FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' ORDER BY c.relname, k.conname
) x
UNION ALL
SELECT 'indexes', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT c.relname AS relation_name, ci.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
         EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = c.oid
                 AND k.conindid = i.indexrelid AND k.contype IN ('p', 'u', 'x')) AS constraint_index
  FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_class ci ON ci.oid = i.indexrelid
  WHERE n.nspname = 'public' ORDER BY c.relname, ci.relname
) x
UNION ALL
SELECT 'triggers', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT c.relname AS relation_name, t.tgname AS name, t.tgenabled::text AS enabled,
         pg_get_triggerdef(t.oid, true) AS definition
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname
) x
UNION ALL
SELECT 'policies', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (SELECT * FROM pg_catalog.pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname) x
UNION ALL
SELECT 'enums', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT t.typname AS name, pg_get_userbyid(t.typowner) AS owner,
         jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
  FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public' GROUP BY t.oid, t.typname, t.typowner ORDER BY t.typname
) x
UNION ALL
SELECT 'routine_permissions', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments,
         pg_get_userbyid(p.proowner) AS owner, p.proacl AS acl, e.extname AS extension
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN pg_catalog.pg_depend d ON d.classid = 'pg_proc'::regclass AND d.objid = p.oid
    AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
  LEFT JOIN pg_catalog.pg_extension e ON e.oid = d.refobjid
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') ORDER BY p.proname, p.oid
) x
UNION ALL
SELECT 'sequences', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT s.sequencename AS name, s.sequenceowner AS owner, s.data_type::text,
         s.start_value, s.min_value, s.max_value, s.increment_by, s.cycle, s.cache_size,
         c.relacl AS acl
  FROM pg_catalog.pg_sequences s
  JOIN pg_catalog.pg_namespace n ON n.nspname = s.schemaname
  JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = s.sequencename
  WHERE s.schemaname = 'public' ORDER BY s.sequencename
) x
UNION ALL
SELECT 'extensions', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema,
         pg_get_userbyid(e.extowner) AS owner
  FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  ORDER BY e.extname
) x
UNION ALL
SELECT 'schema_permissions', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT n.nspname AS name, pg_get_userbyid(n.nspowner) AS owner, n.nspacl AS acl
  FROM pg_catalog.pg_namespace n WHERE n.nspname = 'public'
) x
UNION ALL
SELECT 'default_permissions', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT pg_get_userbyid(d.defaclrole) AS owner, n.nspname AS schema,
         d.defaclobjtype::text AS kind, d.defaclacl AS acl
  FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
  WHERE n.nspname = 'public' OR d.defaclnamespace = 0
  ORDER BY d.defaclrole, d.defaclnamespace, d.defaclobjtype
) x
UNION ALL
SELECT 'database', jsonb_build_object(
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num')
)::text
UNION ALL
SELECT 'auth_user_triggers', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT n.nspname AS schema, c.relname AS relation_name, t.tgname AS name,
         t.tgenabled::text AS enabled, pg_get_triggerdef(t.oid, true) AS definition
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
  WHERE n.nspname = 'auth' AND c.relname = 'users' AND pn.nspname = 'public'
    AND NOT t.tgisinternal ORDER BY t.tgname
) x
UNION ALL
SELECT 'storage_policies', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (SELECT * FROM pg_catalog.pg_policies WHERE schemaname = 'storage' ORDER BY tablename, policyname) x
UNION ALL
SELECT 'sequence_ownership', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT sn.nspname AS sequence_schema, sc.relname AS sequence_name,
         d.deptype::text AS dependency_type, tn.nspname AS table_schema,
         tc.relname AS table_name, a.attname AS column_name
  FROM pg_catalog.pg_class sc JOIN pg_catalog.pg_namespace sn ON sn.oid = sc.relnamespace
  LEFT JOIN pg_catalog.pg_depend d ON d.classid = 'pg_class'::regclass
    AND d.objid = sc.oid AND d.objsubid = 0
    AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
  LEFT JOIN pg_catalog.pg_class tc ON tc.oid = d.refobjid
  LEFT JOIN pg_catalog.pg_namespace tn ON tn.oid = tc.relnamespace
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = tc.oid AND a.attnum = d.refobjsubid
  WHERE sn.nspname = 'public' AND sc.relkind = 'S' ORDER BY sc.relname
) x
UNION ALL
SELECT 'listing_photo_bucket', coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text
FROM (
  SELECT id, name, public, file_size_limit, allowed_mime_types
  FROM storage.buckets WHERE id = 'listing-photos'
) x;
