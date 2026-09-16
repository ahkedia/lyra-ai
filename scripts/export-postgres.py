#!/usr/bin/env python3
"""Create and validate a consistent PostgreSQL dump with per-table inventory."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], *, capture: bool = True) -> str:
    result = subprocess.run(
        command,
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE,
        env=os.environ,
    )
    if result.returncode != 0:
        raise RuntimeError(f"{command[0]} failed: {(result.stderr or '').strip()}")
    return result.stdout or ""


def query(sql: str, url: str) -> str:
    return run(
        ["psql", "--dbname", url, "--no-psqlrc", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql]
    ).strip()


def ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--inventory", required=True, type=Path)
    args = parser.parse_args()

    url = os.environ.get("LYRA_DATABASE_URL")
    if not url:
        print("INCOMPLETE: LYRA_DATABASE_URL is not set in the process environment", file=sys.stderr)
        return 1
    for command in ("psql", "pg_dump", "pg_restore"):
        if not shutil.which(command):
            print(f"INCOMPLETE: required command is missing: {command}", file=sys.stderr)
            return 1

    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.inventory.parent.mkdir(parents=True, exist_ok=True)
        database_size = int(query("SELECT pg_database_size(current_database())", url))
        rows = json.loads(
            query(
                """
                SELECT COALESCE(json_agg(json_build_object(
                  'schema', schemaname, 'table', tablename
                ) ORDER BY schemaname, tablename), '[]'::json)
                FROM pg_catalog.pg_tables
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                """,
                url,
            )
        )
        if not rows:
            raise RuntimeError("PostgreSQL contains zero user tables")

        inventory_tables = []
        timestamp_candidates = (
            "updated_at",
            "modified_at",
            "last_edited_time",
            "created_at",
            "timestamp",
        )
        for table in rows:
            schema = table["schema"]
            name = table["table"]
            qualified = f"{ident(schema)}.{ident(name)}"
            row_count = int(query(f"SELECT count(*) FROM {qualified}", url))
            size_bytes = int(
                query(f"SELECT pg_total_relation_size({literal(qualified)}::regclass)", url)
            )
            columns = set(
                json.loads(
                    query(
                        f"""
                        SELECT COALESCE(json_agg(column_name), '[]'::json)
                        FROM information_schema.columns
                        WHERE table_schema = {literal(schema)}
                          AND table_name = {literal(name)}
                          AND data_type IN (
                            'timestamp without time zone',
                            'timestamp with time zone',
                            'date'
                          )
                        """,
                        url,
                    )
                )
            )
            timestamp_column = next((item for item in timestamp_candidates if item in columns), None)
            if timestamp_column:
                latest_write = query(
                    f"SELECT COALESCE(max({ident(timestamp_column)})::text, '') FROM {qualified}",
                    url,
                ) or None
                latest_write_basis = f"max({timestamp_column})"
            else:
                # PostgreSQL does not expose last-DML time natively. Relation-file
                # mtime is explicit filesystem evidence, not represented as exact DML.
                latest_write = query(
                    f"""
                    SELECT modification::text
                    FROM pg_stat_file(pg_relation_filepath({literal(qualified)}::regclass))
                    """,
                    url,
                ) or None
                latest_write_basis = "relation_file_mtime (proxy; no application timestamp column)"
            if not latest_write:
                raise RuntimeError(f"cannot determine latest-write evidence for {schema}.{name}")
            inventory_tables.append(
                {
                    "schema": schema,
                    "table": name,
                    "row_count": row_count,
                    "size_bytes": size_bytes,
                    "latest_write": latest_write,
                    "latest_write_basis": latest_write_basis,
                }
            )

        run(
            [
                "pg_dump",
                "--dbname",
                url,
                "--format=custom",
                "--no-owner",
                "--no-privileges",
                "--file",
                str(args.output),
            ]
        )
        if not args.output.is_file() or args.output.stat().st_size == 0:
            raise RuntimeError("pg_dump produced an empty file")
        listing = run(["pg_restore", "--list", str(args.output)])
        table_data_entries = [line for line in listing.splitlines() if " TABLE DATA " in line]
        if not table_data_entries:
            raise RuntimeError("pg_restore validation found no TABLE DATA entries")

        inventory = {
            "status": "COMPLETE",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "snapshot_method": "pg_dump custom-format MVCC snapshot",
            "database_size_bytes": database_size,
            "dump_size_bytes": args.output.stat().st_size,
            "dump_sha256": sha256_file(args.output),
            "table_count": len(inventory_tables),
            "row_count": sum(item["row_count"] for item in inventory_tables),
            "tables": inventory_tables,
            "pg_restore_table_data_entries": len(table_data_entries),
        }
        args.inventory.write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
        print(
            f"PostgreSQL export COMPLETE: {inventory['table_count']} tables, "
            f"{inventory['row_count']} rows, {inventory['dump_size_bytes']} dump bytes"
        )
        return 0
    except Exception as exc:
        failure = {
            "status": "INCOMPLETE",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        }
        args.inventory.parent.mkdir(parents=True, exist_ok=True)
        args.inventory.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(f"INCOMPLETE: PostgreSQL export failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
