// Single shared handle to the APH2 Access SQLite database. Opened once at
// startup and reused for the lifetime of the server (bun:sqlite is
// thread-safe).

import { Database } from "bun:sqlite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// APH_DB_PATH lets the test harness point the server at a throwaway
// database per suite (see tests/tier2/setup.js). Unset in normal
// operation.
const dbPath =
  process.env.APH_DB_PATH ||
  resolve(here, "..", "db", "access.sqlite");

const db = new Database(dbPath);
db.exec("PRAGMA foreign_keys = ON");

// Idempotent boot-time upgrades: anything that can be added to an existing
// database without wiping it goes here so a dev doesn't have to run
// `db:init` to pick up a new side-table. Production will still prefer
// `db:init` from the schema for fresh installs.
//
// (Empty for now - all tables live in db/schema.sql at the moment.)

export default db;
