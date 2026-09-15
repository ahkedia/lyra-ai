#!/usr/bin/env node
/**
 * Create and validate a PGlite snapshot while the caller holds the gbrain lock.
 *
 * This program does not stop services. The shell orchestrator must prove that no
 * gbrain process is running and hold /tmp/brain-write.lock before invoking it.
 * Validation opens a disposable copy, never the source or archival snapshot.
 */
import { PGlite } from "@electric-sql/pglite";
import {
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

function fail(message) {
  console.error(`INCOMPLETE: ${message}`);
  process.exit(1);
}

async function filesUnder(root) {
  const result = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) result.push(full);
    }
  }
  await walk(root);
  return result.sort();
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const [sourceArg, outputArg, inventoryArg] = process.argv.slice(2);
if (!sourceArg || !outputArg || !inventoryArg) {
  fail("usage: snapshot-pglite.mjs SOURCE_DIR OUTPUT_DIR INVENTORY_JSON");
}

const source = resolve(sourceArg);
const output = resolve(outputArg);
const inventoryPath = resolve(inventoryArg);
if (source === output || output.startsWith(`${source}/`)) {
  fail("snapshot output must not be inside the source directory");
}

try {
  const sourceStat = await stat(source);
  if (!sourceStat.isDirectory()) fail(`PGlite source is not a directory: ${source}`);
} catch {
  fail(`PGlite source does not exist: ${source}`);
}

try {
  await mkdir(dirname(output), { recursive: true });
  await cp(source, output, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });

  const snapshotFiles = await filesUnder(output);
  if (snapshotFiles.length === 0) fail("PGlite snapshot contains no files");
  const fileInventory = [];
  for (const path of snapshotFiles) {
    const fileStat = await stat(path);
    fileInventory.push({
      path: relative(output, path),
      size_bytes: fileStat.size,
      sha256: await hashFile(path),
    });
  }

  // PGlite may write startup metadata. Validate a disposable second copy so the
  // archival snapshot remains byte-identical to the quiesced source.
  const validationRoot = await mkdtemp(join(tmpdir(), "pglite-validate-"));
  const validationCopy = join(validationRoot, "db");
  try {
    await cp(output, validationCopy, { recursive: true, errorOnExist: true });
    const db = new PGlite(validationCopy);
    await db.waitReady;
    const tableResult = await db.query(`
      SELECT schemaname, tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename
    `);
    const tables = [];
    for (const row of tableResult.rows) {
      const qualified = `${quoteIdent(row.schemaname)}.${quoteIdent(row.tablename)}`;
      const countResult = await db.query(`SELECT count(*)::bigint AS row_count FROM ${qualified}`);
      tables.push({
        schema: row.schemaname,
        table: row.tablename,
        row_count: Number(countResult.rows[0].row_count),
      });
    }
    await db.close();
    if (tables.length === 0) fail("PGlite validation found zero user tables");

    const inventory = {
      status: "COMPLETE",
      source_path: source,
      snapshot_path: output,
      snapshot_method: "quiesced filesystem copy under brain-write flock",
      validation_method: "opened disposable snapshot copy with @electric-sql/pglite",
      file_count: fileInventory.length,
      size_bytes: fileInventory.reduce((sum, item) => sum + item.size_bytes, 0),
      table_count: tables.length,
      row_count: tables.reduce((sum, item) => sum + item.row_count, 0),
      tables,
      files: fileInventory,
    };
    await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    console.log(
      `PGlite snapshot COMPLETE: ${inventory.table_count} tables, ` +
      `${inventory.row_count} rows, ${inventory.file_count} files`,
    );
  } finally {
    await rm(validationRoot, { recursive: true, force: true });
  }
} catch (error) {
  fail(`PGlite snapshot or validation failed: ${error.message}`);
}
