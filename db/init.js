#!/usr/bin/env bun
// Apply db/schema.sql to a fresh SQLite database.
//
// Usage: bun run db:init [path/to/output.sqlite]
//
// Default output: db/access.sqlite (relative to this file's directory).
// Any existing file at the output path is removed first.

import { Database } from "bun:sqlite";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "schema.sql");
const outPath = resolve(here, process.argv[2] ?? "access.sqlite");

if (existsSync(outPath)) {
  unlinkSync(outPath);
  console.log(`removed existing ${outPath}`);
}

const schema = readFileSync(schemaPath, "utf8");
const db = new Database(outPath, { create: true });
db.exec("PRAGMA foreign_keys = ON;");
db.exec(schema);
db.close();

console.log(`created ${outPath}`);
