#!/usr/bin/env bun
// Create or reset an admin user. Used to bootstrap the very first super_user
// (no other admin exists yet, so the API can't be used) and as a recovery
// path if everyone forgets their password.
//
// Usage:
//   bun run scripts/seed-admin.js <username> <password> [--super]
//
// Example:
//   bun run scripts/seed-admin.js rcollins@redmug.co.uk borland --super
//
// If the user already exists, only the password is reset (and --super, if
// passed, re-grants the super_user flag). Other role flags are not changed.

import db from "../server/db.js";
import { hashPassword } from "../server/lib/password.js";
import { Temporal } from "../server/lib/temporal.js";

const [, , username, password, ...rest] = process.argv;
if (!username || !password) {
  console.error("usage: bun run scripts/seed-admin.js <username> <password> [--super]");
  process.exit(2);
}
const makeSuper = rest.includes("--super");

const hash = await hashPassword(password);
const now = Temporal.Now.instant().toString();

const existing = db.query("SELECT id FROM admin_users WHERE username = $u").get({ $u: username });

if (existing) {
  if (makeSuper) {
    db.query(`
      UPDATE admin_users
      SET hashed_password = $h, super_user = 1, updated_at = $now
      WHERE id = $id
    `).run({ $h: hash, $id: existing.id, $now: now });
    console.log(`reset password for existing admin ${username} (id=${existing.id}, super_user=1)`);
  } else {
    db.query(`
      UPDATE admin_users SET hashed_password = $h, updated_at = $now WHERE id = $id
    `).run({ $h: hash, $id: existing.id, $now: now });
    console.log(`reset password for existing admin ${username} (id=${existing.id})`);
  }
} else {
  const { id } = db.query(`
    INSERT INTO admin_users
      (username, hashed_password, super_user, manage_users, manage_groups, view_reports,
       created_at, updated_at)
    VALUES
      ($u, $h, $su, $mu, $mg, $vr, $now, $now)
    RETURNING id
  `).get({
    $u: username, $h: hash,
    $su: makeSuper ? 1 : 0,
    $mu: makeSuper ? 1 : 0,
    $mg: makeSuper ? 1 : 0,
    $vr: makeSuper ? 1 : 0,
    $now: now,
  });
  console.log(`created admin ${username} (id=${id}, super_user=${makeSuper ? 1 : 0})`);
}
