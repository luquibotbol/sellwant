#!/usr/bin/env python3
"""Recover/compare the private hosted schema export against one fixed local DB.

Run from sellwant/: python3 scripts/schema-baseline-local.py validate|restore|compare
No hosted connection options, production credentials, or application row exports.
Restore requires an empty public app schema and is one transaction. The private
generated SQL, catalog differences, and source hashes stay under .local/schema/.
"""

import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "sellwant-paypal-ai-2026"
DB = "supabase_db_" + PROJECT
NETWORK = "supabase_network_" + PROJECT
IMAGE = "public.ecr.aws/supabase/postgres:17.11.0.011"
META = ROOT.parent / "Supabase Snippet Untitled query (1).csv"
FUNCS = ROOT.parent / "Supabase Snippet Untitled query.csv"
PRIVATE = ROOT / ".local/schema"
COUNTS = {"relations": 11, "columns": 83, "constraints": 52, "indexes": 31,
          "triggers": 6, "policies": 24, "enums": 0, "routine_permissions": 56,
          "sequences": 2, "extensions": 6, "schema_permissions": 1,
          "default_permissions": 6, "auth_user_triggers": 1,
          "storage_policies": 8, "sequence_ownership": 2, "listing_photo_bucket": 1}
PRIVILEGES = dict(a="INSERT", r="SELECT", w="UPDATE", d="DELETE", D="TRUNCATE",
                  x="REFERENCES", t="TRIGGER", m="MAINTAIN", X="EXECUTE",
                  U="USAGE", C="CREATE")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def qi(value):
    return '"' + value.replace('"', '""') + '"'


def qs(value):
    return "'" + value.replace("'", "''") + "'"


def qualified(schema, name):
    return qi(schema) + "." + qi(name)


def private_write(name, value):
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = PRIVATE / name
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(value)
    path.chmod(0o600)


def source():
    for path in (META, FUNCS):
        require(path.is_file(), "Required exact private CSV is missing: " + path.name)
        require(path.stat().st_mode & 0o077 == 0, "Private CSV permissions must be 0600.")
        ignored = subprocess.run(["git", "check-ignore", "-q", str(path)], cwd=ROOT)
        require(ignored.returncode == 0, "Refusing an export not excluded from Git.")
    with META.open(newline="") as stream:
        rows = list(csv.DictReader(stream))
    require(len(rows) == 17 and {r["section"] for r in rows} == set(COUNTS) | {"database"},
            "Expected exactly the 17 lossless metadata sections.")
    data = {r["section"]: json.loads(r["metadata"]) for r in rows}
    for section, count in COUNTS.items():
        require(len(data[section]) == count, "Unexpected source count: " + section)
    require(data["database"]["server_version_num"] == "170006", "Unexpected source PostgreSQL version.")
    require(next(s for s in data["sequences"] if s["name"] == "page_views_id_seq")["max_value"]
            == 9223372036854775807, "Rounded bigint metadata is forbidden.")
    with FUNCS.open(newline="") as stream:
        routines = list(csv.DictReader(stream))
    require(len(routines) == 56, "Expected all 56 function definitions.")
    identities = {(f["function_name"], f["arguments"]): f for f in routines}
    expected = {(p["name"], p["arguments"]) for p in data["routine_permissions"]}
    require(len(identities) == 56 and set(identities) == expected, "Routine exports disagree.")
    require(sum(p["extension"] is None for p in data["routine_permissions"]) == 25,
            "Expected exactly 25 app routines; extension routines must come from extensions.")
    for r in data["relations"]:
        require(r["kind"] == "r" and not r["options"] and not r["partition_key"],
                "Unimplemented relation metadata; do not silently approximate it.")
    require(not data["enums"], "Unexpected enum dependencies.")
    for c in data["columns"]:
        require(not c["identity"] and not c["generated"], "Unexpected identity/generated column.")
    return data, identities


class Local:
    def __init__(self):
        for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
            require(not os.environ.get(key), "Unset Docker daemon overrides before using this script.")
        self.context = self.run(["docker", "context", "show"]).strip()
        require(re.fullmatch(r"[A-Za-z0-9_.-]+", self.context), "Invalid Docker context.")
        contexts = json.loads(self.docker(["context", "inspect", self.context]))
        require(len(contexts) == 1 and contexts[0]["Endpoints"]["docker"]["Host"].startswith("unix:///"),
                "Refusing a nonlocal Docker daemon.")
        for path in (ROOT,):
            self.config(path)
        dbs = json.loads(self.docker(["inspect", DB]))
        require(len(dbs) == 1, "Expected exactly one isolated database.")
        db = dbs[0]
        require(db["Name"] == "/" + DB and db["Config"]["Image"] == IMAGE, "Unexpected DB container/image.")
        labels = db["Config"]["Labels"]
        for key in ("com.supabase.cli.project", "com.docker.compose.project"):
            require(labels.get(key) == PROJECT, "Wrong local project label.")
        self.config(Path(labels["com.supabase.cli.workdir"]))
        require(db["State"]["Running"] and db["State"]["Health"]["Status"] == "healthy", "Local DB is unhealthy.")
        require(list(db["NetworkSettings"]["Networks"]) == [NETWORK], "Unexpected DB network.")
        ports = db["HostConfig"]["PortBindings"].get("5432/tcp", [])
        require(len(ports) == 1 and ports[0]["HostPort"] == "55322", "Unexpected DB port.")
        self.id = db["Id"]
        require(re.fullmatch(r"[0-9a-f]{64}", self.id), "Missing immutable DB ID.")
        require(self.sql("SELECT current_setting('server_version_num');").strip() == "170011",
                "Expected isolated local PostgreSQL 17.11.")

    @staticmethod
    def config(path):
        require(path.is_absolute(), "Local project path must be absolute.")
        require(not (path / "supabase/.temp/project-ref").exists(), "Refusing a hosted-linked CLI project.")
        text = (path / "supabase/config.toml").read_text()
        require(re.search(r'^project_id\s*=\s*"' + PROJECT + r'"\s*$', text, re.M), "Wrong local project config.")
        require(re.search(r'^port\s*=\s*55322\s*$', text, re.M), "Expected DB port in local config.")

    @staticmethod
    def run(args, text=None):
        result = subprocess.run(args, input=text, text=True, capture_output=True, timeout=90, cwd=ROOT)
        if result.returncode:
            # Error details remain private; do not print SQL, data, or environment.
            private_write("last-command-error.txt", result.stderr)
            raise RuntimeError("Local command failed; private details: .local/schema/last-command-error.txt")
        return result.stdout

    def docker(self, args, text=None):
        return self.run(["docker", "--context", self.context, *args], text)

    def sql(self, text, csv_output=False):
        args = ["exec", "-i", self.id, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
                "-U", "supabase_admin", "-d", "postgres"]
        args += ["--csv"] if csv_output else ["-At"]
        return self.docker(args, "SET statement_timeout='60s'; SET lock_timeout='10s';\n" + text)


def acl_entries(acl):
    for entry in acl or []:
        match = re.fullmatch(r'([^=]*)=([^/]*)/(.+)', entry)
        require(match is not None, "Unsupported ACL syntax.")
        grantee, perms, grantor = match.groups()
        grantee = "PUBLIC" if not grantee else qi(grantee)
        i = 0
        while i < len(perms):
            letter = perms[i]
            require(letter in PRIVILEGES, "Unknown PostgreSQL privilege letter.")
            grant = i + 1 < len(perms) and perms[i + 1] == "*"
            yield grantee, PRIVILEGES[letter], grant, grantor
            i += 2 if grant else 1


def apply_acl(out, object_type, target, acl, owner, column=None):
    recipients = {"PUBLIC", qi(owner)} | {g for g, _, _, _ in acl_entries(acl)}
    # These are the only default ACL recipients on the exact isolated platform.
    recipients |= {qi(r) for r in ("postgres", "supabase_admin", "anon", "authenticated", "service_role")}
    privilege = "ALL" + (" (" + qi(column) + ")" if column else "")
    out.append("RESET ROLE;")
    out.append(f"REVOKE {privilege} ON {object_type} {target} FROM {', '.join(sorted(recipients))};")
    for grantee, privilege, grant, grantor in acl_entries(acl):
        out.append("SET ROLE " + qi(grantor) + ";")
        if column:
            privilege += " (" + qi(column) + ")"
        out.append(f"GRANT {privilege} ON {object_type} {target} TO {grantee}" + (" WITH GRANT OPTION" if grant else "") + ";")
    out.append("RESET ROLE;")


def policy_sql(p):
    text = (f"CREATE POLICY {qi(p['policyname'])} ON {qualified(p['schemaname'], p['tablename'])} "
            f"AS {p['permissive']} FOR {p['cmd']} TO " + ", ".join("PUBLIC" if r == "public" else qi(r) for r in p["roles"]))
    if p["qual"] is not None:
        text += " USING (" + p["qual"] + ")"
    if p["with_check"] is not None:
        text += " WITH CHECK (" + p["with_check"] + ")"
    return text + ";"


def restore_sql(data, routines, current_extensions):
    out = ["BEGIN;", "SET LOCAL search_path=public,extensions;", "SET LOCAL check_function_bodies=off;",
           "SELECT pg_advisory_xact_lock(hashtext('sellwant-local-baseline-20261105'));"]
    for ext in data["extensions"]:
        current = current_extensions.get(ext["name"])
        if current:
            require(all(current[key] == ext[key] for key in ("name", "schema", "version")),
                    "Installed platform extension version/schema differs; refusing replacement.")
            # Supabase 17.11's extension proxy creates these platform extensions
            # as supabase_admin even under SET ROLE postgres. Retain preinstalled
            # infrastructure and report this explicit owner divergence at compare.
            continue
        out += ["SET ROLE " + qi(ext["owner"]) + ";",
                f"CREATE EXTENSION {qi(ext['name'])} WITH SCHEMA {qi(ext['schema'])} VERSION {qs(ext['version'])};",
                "RESET ROLE;"]
    for s in data["sequences"]:
        out.append(f"CREATE SEQUENCE {qualified('public',s['name'])} AS {s['data_type']} "
                   f"INCREMENT BY {s['increment_by']} MINVALUE {s['min_value']} MAXVALUE {s['max_value']} "
                   f"START WITH {s['start_value']} CACHE {s['cache_size']} " + ("CYCLE;" if s["cycle"] else "NO CYCLE;"))
        out.append(f"ALTER SEQUENCE {qualified('public',s['name'])} OWNER TO {qi(s['owner'])};")
    for r in data["relations"]:
        columns = sorted((c for c in data["columns"] if c["relation_name"] == r["name"]), key=lambda c: c["position"])
        definitions = []
        dropped = []
        for position in range(1, columns[-1]["position"] + 1):
            c = next((c for c in columns if c["position"] == position), None)
            if c is None:
                name = "_baseline_dropped_" + str(position)
                definitions.append(qi(name) + " text")
                dropped.append(name)
                continue
            text = qi(c["name"]) + " " + c["type"]
            if c["collation"]:
                text += " COLLATE " + c["collation"]
            if c["default_expression"] is not None:
                text += " DEFAULT " + c["default_expression"]
            if c["not_null"]:
                text += " NOT NULL"
            definitions.append(text)
        target = qualified("public", r["name"])
        out.append(f"CREATE TABLE {target} (\n" + ",\n".join(definitions) + "\n);")
        for name in dropped:
            out.append(f"ALTER TABLE {target} DROP COLUMN {qi(name)};")
        out.append(f"ALTER TABLE {target} OWNER TO {qi(r['owner'])};")
    for p in data["routine_permissions"]:
        if p["extension"] is None:
            out.append(routines[(p["name"], p["arguments"])]["definition"].rstrip().rstrip(";") + ";")
        out.append(f"ALTER FUNCTION {qualified('public',p['name'])}({p['arguments']}) OWNER TO {qi(p['owner'])};")
    # Referenced unique keys must precede foreign keys.
    for k in sorted(data["constraints"], key=lambda k: k["kind"] == "f"):
        out.append(f"ALTER TABLE {qualified('public',k['relation_name'])} ADD CONSTRAINT {qi(k['name'])} {k['definition']}" +
                   (" NOT VALID" if not k["validated"] and "NOT VALID" not in k["definition"] else "") + ";")
    for index in data["indexes"]:
        if not index["constraint_index"]:
            out.append(index["definition"] + ";")
    for dep in data["sequence_ownership"]:
        require(dep["dependency_type"] == "a", "Unexpected identity-sequence dependency.")
        out.append(f"ALTER SEQUENCE {qualified(dep['sequence_schema'],dep['sequence_name'])} OWNED BY "
                   f"{qualified(dep['table_schema'],dep['table_name'])}.{qi(dep['column_name'])};")
    for t in data["triggers"] + data["auth_user_triggers"]:
        out.append(t["definition"] + ";")
        mode = {"O": "ENABLE", "D": "DISABLE", "A": "ENABLE ALWAYS", "R": "ENABLE REPLICA"}[t["enabled"]]
        out.append(f"ALTER TABLE {qualified(t.get('schema','public'),t['relation_name'])} {mode} TRIGGER {qi(t['name'])};")
    for p in data["policies"] + data["storage_policies"]:
        out.append(policy_sql(p))
    for r in data["relations"]:
        out.append(f"ALTER TABLE {qualified('public',r['name'])} " + ("ENABLE" if r["rls_enabled"] else "DISABLE") + " ROW LEVEL SECURITY;")
        out.append(f"ALTER TABLE {qualified('public',r['name'])} " + ("FORCE" if r["rls_forced"] else "NO FORCE") + " ROW LEVEL SECURITY;")
        apply_acl(out, "TABLE", qualified("public", r["name"]), r["acl"], r["owner"])
    for c in data["columns"]:
        if c["acl"] is not None:
            apply_acl(out, "TABLE", qualified("public", c["relation_name"]), c["acl"], "postgres", c["name"])
    for p in data["routine_permissions"]:
        apply_acl(out, "FUNCTION", qualified("public", p["name"]) + "(" + p["arguments"] + ")", p["acl"], p["owner"])
    for s in data["sequences"]:
        apply_acl(out, "SEQUENCE", qualified("public", s["name"]), s["acl"], s["owner"])
    for s in data["schema_permissions"]:
        out.append(f"ALTER SCHEMA {qi(s['name'])} OWNER TO {qi(s['owner'])};")
        apply_acl(out, "SCHEMA", qi(s["name"]), s["acl"], s["owner"])
    for d in data["default_permissions"]:
        kind = {"S": "SEQUENCES", "f": "FUNCTIONS", "r": "TABLES"}[d["kind"]]
        prefix = f"ALTER DEFAULT PRIVILEGES FOR ROLE {qi(d['owner'])}" + (" IN SCHEMA " + qi(d["schema"]) if d["schema"] else "")
        out.append(f"{prefix} REVOKE ALL ON {kind} FROM PUBLIC, postgres, supabase_admin, anon, authenticated, service_role;")
        for grantee, privilege, grant, grantor in acl_entries(d["acl"]):
            out.append("SET ROLE " + qi(grantor) + ";")
            out.append(f"{prefix} GRANT {privilege} ON {kind} TO {grantee}" + (" WITH GRANT OPTION" if grant else "") + ";")
            out.append("RESET ROLE;")
    for b in data["listing_photo_bucket"]:
        mime = "ARRAY[" + ",".join(qs(m) for m in b["allowed_mime_types"]) + "]::text[]" if b["allowed_mime_types"] is not None else "NULL"
        out.append("INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES (" +
                   ",".join([qs(b["id"]), qs(b["name"]), str(b["public"]).lower(), str(b["file_size_limit"]) if b["file_size_limit"] is not None else "NULL", mime]) + ");")
    out += ["NOTIFY pgrst, 'reload schema';", "COMMIT;"]
    return "\n".join(out) + "\n"


def snapshot(local):
    text = "BEGIN READ ONLY; SET LOCAL search_path=public,extensions;\n" + (ROOT / "scripts/inspect-schema.sql").read_text() + "\nCOMMIT;"
    rows = csv.DictReader(local.sql(text, csv_output=True).splitlines())
    return {r["section"]: json.loads(r["metadata"]) for r in rows}


def canonical(value, field=None):
    if isinstance(value, list):
        items = [canonical(x) for x in value]
        # Row sets, ACL entries and policy roles are order-independent. Keep
        # arrays such as enum labels, reloptions and MIME lists in source order.
        if field is None or field in {"acl", "roles"}:
            return sorted(items, key=lambda x: json.dumps(x, sort_keys=True))
        return items
    if isinstance(value, dict):
        return {k: canonical(v, k) for k, v in sorted(value.items())}
    return value


def compare(local, data, routines, allow_local_extension_owners=False):
    actual = snapshot(local)
    differences = {}
    for section in COUNTS:
        if canonical(data[section]) != canonical(actual[section]):
            differences[section] = {"source": data[section], "local": actual[section]}
    function_sql = """SELECT json_build_object('function_name',p.proname,'arguments',
      pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid))::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d
        WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e');"""
    app = [json.loads(line) for line in local.sql("BEGIN READ ONLY; SET LOCAL search_path=public,extensions;" + function_sql + "COMMIT;").splitlines()]
    expected = [routines[(p["name"], p["arguments"])] for p in data["routine_permissions"] if p["extension"] is None]
    if canonical(app) != canonical(expected):
        differences["app_function_definitions"] = {"source": expected, "local": app}
    acknowledged = {}
    if allow_local_extension_owners and "extensions" in differences:
        source_extensions = {e["name"]: e for e in data["extensions"]}
        local_extensions = {e["name"]: e for e in actual["extensions"]}
        require(set(source_extensions) == set(local_extensions), "Extension membership differs.")
        owner_differences = []
        for name, expected_extension in source_extensions.items():
            actual_extension = local_extensions[name]
            require(all(expected_extension[k] == actual_extension[k] for k in ("name", "schema", "version")),
                    "Only explicitly known local platform extension owner differences can be acknowledged.")
            if expected_extension["owner"] != actual_extension["owner"]:
                require(name in {"pg_stat_statements", "pgcrypto", "uuid-ossp"}
                        and expected_extension["owner"] == "postgres"
                        and actual_extension["owner"] == "supabase_admin",
                        "Unexpected extension owner difference.")
                owner_differences.append(name)
        require(set(owner_differences) == {"pg_stat_statements", "pgcrypto", "uuid-ossp"},
                "Expected the three previously verified local platform owner differences.")
        acknowledged["extensions"] = differences.pop("extensions")
    report = {"source_hashes": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (META, FUNCS)},
              "source_database": data["database"], "local_database": actual["database"],
              "differences": differences, "acknowledged_platform_differences": acknowledged,
              "verified_sections": list(COUNTS),
              "app_function_definitions": len(app)}
    private_write("baseline-comparison.json", json.dumps(report, indent=2, sort_keys=True) + "\n")
    require(not differences, "Baseline comparison differs: " + ", ".join(differences) + "; see private baseline-comparison.json")
    if acknowledged:
        print("Application baseline exact comparison passed: tables/columns/constraints/indexes/triggers/policies/ACLs/sequences/storage and 25 app definitions.")
        print("Explicit platform difference: pg_stat_statements, pgcrypto and uuid-ossp owners source=postgres/local=supabase_admin; versions/schemas match.")
    else:
        print("Baseline exact comparison passed: 16 schema/ACL sections and all 25 app function definitions.")
    print("Source PostgreSQL 17.6; local 17.11. No source application rows copied; sequence state is intentionally new.")


def permissions(local, data):
    checks = []
    roles = ("anon", "authenticated", "service_role")

    def granted(acl, role, privilege):
        return any(g in ("PUBLIC", qi(role)) and p == privilege for g, p, _, _ in acl_entries(acl))

    def add(role, kind, target, privilege, expected, column=None, sql_target=None):
        args = [qs(role), sql_target or qs(target)]
        if column is not None:
            args.append(qs(column))
        args.append(qs(privilege))
        actual = "has_" + kind + "_privilege(" + ",".join(args) + ")"
        name = role + ":" + kind + ":" + target + ("." + column if column else "") + ":" + privilege
        checks.append("SELECT " + qs(name) + " AS check_name," + str(expected).lower() +
                      " AS expected," + actual + " AS actual")

    for role in roles:
        for table in data["relations"]:
            target = qualified("public", table["name"])
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"):
                add(role, "table", target, privilege, granted(table["acl"], role, privilege))
            for column in (c for c in data["columns"] if c["relation_name"] == table["name"]):
                for privilege in ("SELECT", "INSERT", "UPDATE", "REFERENCES"):
                    expected = granted(table["acl"], role, privilege) or granted(column["acl"], role, privilege)
                    add(role, "column", target, privilege, expected, column["name"])
        for function in data["routine_permissions"]:
            target = qualified("public", function["name"]) + "(" + function["arguments"] + ")"
            # Resolve by exported identity, retaining argument names without
            # passing them to regprocedure's type-only parser.
            oid = ("(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
                   "WHERE n.nspname='public' AND p.proname=" + qs(function["name"]) +
                   " AND pg_get_function_identity_arguments(p.oid)=" + qs(function["arguments"]) + ")")
            add(role, "function", target, "EXECUTE", granted(function["acl"], role, "EXECUTE"), sql_target=oid)
        for sequence in data["sequences"]:
            for privilege in ("USAGE", "SELECT", "UPDATE"):
                add(role, "sequence", qualified("public", sequence["name"]), privilege,
                    granted(sequence["acl"], role, privilege))
        for schema in data["schema_permissions"]:
            for privilege in ("USAGE", "CREATE"):
                add(role, "schema", schema["name"], privilege, granted(schema["acl"], role, privilege))
    query = "BEGIN READ ONLY; SELECT json_agg(x)::text FROM (" + " UNION ALL ".join(checks) + ") x; COMMIT;"
    results = json.loads(local.sql(query))
    failures = [r for r in results if r["expected"] != r["actual"]]
    private_write("baseline-effective-permissions.json", json.dumps({"checks": len(results), "failures": failures}, indent=2) + "\n")
    require(not failures, "Effective role permissions differ; see private baseline-effective-permissions.json.")
    print(f"Effective privilege matrix passed: {len(results)} positive/negative checks for anon, authenticated and service_role.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("validate", "restore", "compare", "permissions"))
    parser.add_argument("--allow-local-extension-owners", action="store_true",
                        help="Explicitly acknowledge only the three documented 17.11 platform extension owner differences.")
    args = parser.parse_args()
    data, routines = source()
    if args.command == "validate":
        print("Private lossless sources validated: 17 sections, 25 app/31 extension routines, exact int64 maximum.")
        return
    local = Local()
    if args.command == "permissions":
        permissions(local, data)
        return
    if args.command == "restore":
        require(local.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S');").strip() == "0",
                "Restore requires an empty public app schema; refusing to overwrite or drop app objects.")
        before = snapshot(local)
        require(not before["auth_user_triggers"] and not before["storage_policies"] and not before["listing_photo_bucket"],
                "Restore would overwrite existing local app auth/storage objects.")
        require(not before["routine_permissions"], "Restore requires no existing public routines.")
        sql = restore_sql(data, routines, {e["name"]: e for e in before["extensions"]})
        private_write("baseline-restore.sql", sql)
        local.sql(sql)
        print("Baseline restored transactionally to isolated local DB 55322.")
    compare(local, data, routines, args.allow_local_extension_owners)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, KeyError, ValueError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
