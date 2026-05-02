// Tier-2 shared bootstrap. Each calling suite gets:
//   * a fresh tmp SQLite at a unique path (set via APH_DB_PATH BEFORE
//     server/db.js is first imported - the caller must import this module
//     at the top of its test file, which is why this file has side effects
//     at module scope rather than exporting a factory)
//   * the full schema.sql applied
//   * seed rows useful for the door-flow + admin tests:
//       - two groups
//       - one allowed and one blocked door user
//       - a super_user admin ("admin" / "adminpw")
//       - a manage_users-only admin ("usermgr" / "usermgrpw")
//   * an `app.fetch` helper agent with a per-instance cookie jar, so
//     suites read like HTTP-level code
//
// Import order matters: set APH_DB_PATH -> apply schema -> seed -> import
// the app (so its `db.js` opens our tmp file).

import { Database } from "bun:sqlite";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "aph2-access-test-"));
const dbPath = join(tmp, "access.sqlite");
process.env.APH_DB_PATH = dbPath;

const schemaSql = readFileSync("db/schema.sql", "utf8");

// Apply schema through a separate handle, then close it so the
// process-global handle inside server/db.js picks the file up fresh.
{
  const bootstrap = new Database(dbPath, { create: true });
  bootstrap.exec("PRAGMA foreign_keys = ON");
  bootstrap.exec(schemaSql);
  bootstrap.close();
}

// Seed groups + users + admins.
{
  const db = new Database(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  const now = new Date().toISOString();

  db.query(`
    INSERT INTO groups (id, name, description, created_at, updated_at)
    VALUES ($id, $n, $d, $now, $now)
  `).run({ $id: 1, $n: "Trustees",   $d: "Hall trustees",       $now: now });
  db.query(`
    INSERT INTO groups (id, name, description, created_at, updated_at)
    VALUES ($id, $n, $d, $now, $now)
  `).run({ $id: 2, $n: "Volunteers", $d: "General volunteers",  $now: now });

  const insUser = db.query(`
    INSERT INTO users
      (id, first_name, surname, fob_number, group_id, blocked, blocked_reason, created_at, updated_at)
    VALUES
      ($id, $fn, $sn, $fob, $gid, $blk, $reason, $now, $now)
  `);
  insUser.run({ $id: 1, $fn: "Alice", $sn: "Allowed", $fob: "0000000001", $gid: 1, $blk: 0, $reason: null,       $now: now });
  insUser.run({ $id: 2, $fn: "Bob",   $sn: "Blocked", $fob: "0000000002", $gid: 2, $blk: 1, $reason: "lost fob", $now: now });

  // Admin users with known passwords. We hash lazily because Bun.password.hash
  // is async and module scope can't be top-level-awaited from inside a block.
  const { hashPassword } = await import("../../server/lib/password.js");
  const adminHash   = await hashPassword("adminpw");
  const usermgrHash = await hashPassword("usermgrpw");

  const insAdmin = db.query(`
    INSERT INTO admin_users (
      id, username, hashed_password, fob_number,
      super_user, manage_users, manage_groups, view_reports,
      user_id, created_at, updated_at
    ) VALUES (
      $id, $u, $h, $fob,
      $su, $mu, $mg, $vr,
      NULL, $now, $now
    )
  `);
  insAdmin.run({
    $id: 1, $u: "admin", $h: adminHash, $fob: null,
    $su: 1, $mu: 1, $mg: 1, $vr: 1, $now: now,
  });
  insAdmin.run({
    $id: 2, $u: "usermgr", $h: usermgrHash, $fob: null,
    $su: 0, $mu: 1, $mg: 0, $vr: 0, $now: now,
  });

  db.close();
}

// Everything above runs before the first import of server/app.js because
// db.js captures dbPath at module load. Dynamic import is intentional -
// static would execute server/db.js before APH_DB_PATH is set.
const { default: app } = await import("../../server/app.js");

// ---------------------------------------------------------------------------
// Agent helper - tiny wrapper around app.fetch with a sticky cookie jar.
// ---------------------------------------------------------------------------

function makeAgent() {
  let cookie = "";
  async function send(method, path, body) {
    const init = { method, headers: {} };
    if (cookie) init.headers["Cookie"] = cookie;
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await app.fetch(new Request("http://test.local" + path, init));
    // Persist the first Set-Cookie header for subsequent calls. The auth
    // route only sets one (`aph_sid`), so we don't need a full parser.
    const sc = res.headers.get("Set-Cookie");
    if (sc) cookie = sc.split(";")[0];
    return res;
  }
  return {
    get:    (p)    => send("GET",    p),
    post:   (p, b) => send("POST",   p, b),
    put:    (p, b) => send("PUT",    p, b),
    delete: (p)    => send("DELETE", p),
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
  };
}

export async function loginAs(username, password) {
  const agent = makeAgent();
  const res = await agent.post("/api/auth/login", { username, password });
  if (res.status !== 200) {
    throw new Error(`login ${username} failed: ${res.status} ${await res.text()}`);
  }
  return agent;
}

export function newAgent() {
  return makeAgent();
}

export { app, dbPath };
