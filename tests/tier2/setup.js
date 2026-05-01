// Tier-2 shared bootstrap. Each calling suite gets:
//   * a fresh tmp SQLite at a unique path (set via APH_DB_PATH BEFORE
//     server/db.js is first imported - the caller must import this module
//     at the top of its test file, which is why this file has side effects
//     at module scope rather than exporting a factory)
//   * the full schema.sql applied
//   * a couple of seed rows useful for the door-flow tests (one allowed
//     user, one blocked user)
//
// Import order matters: set APH_DB_PATH -> apply schema -> import server code.

import { Database } from "bun:sqlite";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "aph2-access-test-"));
const dbPath = join(tmp, "access.sqlite");
process.env.APH_DB_PATH = dbPath;

const schemaSql = readFileSync("db/schema.sql", "utf8");

// Apply the schema through a separate handle, then close it so the
// process-global handle inside server/db.js picks the file up fresh.
{
  const bootstrap = new Database(dbPath, { create: true });
  bootstrap.exec("PRAGMA foreign_keys = ON");
  bootstrap.exec(schemaSql);
  bootstrap.close();
}

// Seed two test groups + three users so the access-flow suite has someone
// allowed, someone blocked, and one obvious "unknown fob" gap.
{
  const db = new Database(dbPath);
  db.exec("PRAGMA foreign_keys = ON");

  const now = new Date().toISOString();

  db.query(`
    INSERT INTO groups (id, name, description, created_at, updated_at)
    VALUES ($id, $n, $d, $now, $now)
  `).run({ $id: 1, $n: "Trustees",   $d: "Hall trustees",   $now: now });
  db.query(`
    INSERT INTO groups (id, name, description, created_at, updated_at)
    VALUES ($id, $n, $d, $now, $now)
  `).run({ $id: 2, $n: "Volunteers", $d: "General volunteers", $now: now });

  const insUser = db.query(`
    INSERT INTO users
      (id, name, fob_number, group_id, blocked, blocked_reason, created_at, updated_at)
    VALUES
      ($id, $n, $fob, $gid, $blk, $reason, $now, $now)
  `);
  insUser.run({ $id: 1, $n: "Alice Allowed", $fob: "0000000001", $gid: 1, $blk: 0, $reason: null, $now: now });
  insUser.run({ $id: 2, $n: "Bob Blocked",   $fob: "0000000002", $gid: 2, $blk: 1, $reason: "lost fob", $now: now });

  db.close();
}

export { dbPath };
