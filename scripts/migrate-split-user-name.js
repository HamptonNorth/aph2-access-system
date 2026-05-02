#!/usr/bin/env bun
// One-shot migration: split users.name into users.first_name + users.surname.
//
// Idempotent - safe to run multiple times; safe to run on a DB that's
// already been re-init-ed against the new schema.
//
// Strategy:
//   1. If first_name / surname columns are missing, ALTER TABLE ADD them
//      (nullable initially because SQLite can't add a NOT NULL column to a
//      table with existing rows without a default).
//   2. Backfill from `name` by splitting on the LAST whitespace:
//        "Alice Allowed"      -> first="Alice",   surname="Allowed"
//        "Mary Anne Smith"    -> first="Mary Anne", surname="Smith"
//        "Cher"               -> first="",       surname="Cher"
//      One-word names go to surname so list sort still works.
//   3. We DO NOT drop the legacy `name` column - SQLite < 3.35 can't, and
//      newer SQLite needs a table rebuild we don't want to risk on a live
//      DB. The new schema.sql doesn't have `name`, so a fresh `bun run
//      db:init` produces the clean shape.
//
// After this migration, server code only reads first_name + surname; the
// stale `name` column (where it still exists) is harmless extra storage.

import db from "../server/db.js";

function columnNames(table) {
  return db.query(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

const cols = columnNames("users");
const hasFirst   = cols.includes("first_name");
const hasSurname = cols.includes("surname");
const hasName    = cols.includes("name");

if (hasFirst && hasSurname && !hasName) {
  console.log("users table already split (and legacy `name` column dropped). Nothing to do.");
  process.exit(0);
}

db.transaction(() => {
  if (!hasFirst) {
    db.exec(`ALTER TABLE users ADD COLUMN first_name TEXT`);
    console.log("added users.first_name");
  }
  if (!hasSurname) {
    db.exec(`ALTER TABLE users ADD COLUMN surname TEXT`);
    console.log("added users.surname");
  }

  if (hasName) {
    // Backfill rows where first_name OR surname is NULL/empty. Splitting on
    // the LAST whitespace lets "Mary Anne Smith" become first="Mary Anne",
    // surname="Smith" - the more conventional outcome than "Mary, Anne Smith".
    //
    // SQLite has no rfind, so we compute the last-space index by reversing
    // the string with substr+instr tricks. Easier path: read rows out, split
    // in JS, write back.
    const rows = db.query(
      `SELECT id, name, first_name, surname FROM users WHERE name IS NOT NULL`
    ).all();

    const upd = db.query(
      `UPDATE users SET first_name = $f, surname = $s WHERE id = $id`
    );

    let touched = 0;
    for (const row of rows) {
      // Skip if we've already split this row (idempotent on re-run).
      if (row.first_name || row.surname) continue;

      const trimmed = String(row.name).trim();
      if (!trimmed) continue;

      const lastSpace = trimmed.lastIndexOf(" ");
      let first = "";
      let surname = trimmed;
      if (lastSpace > 0) {
        first   = trimmed.slice(0, lastSpace).trim();
        surname = trimmed.slice(lastSpace + 1).trim();
      }
      upd.run({ $id: row.id, $f: first, $s: surname });
      touched += 1;
    }
    console.log(`backfilled first_name + surname on ${touched} row(s)`);
  } else {
    console.log("no legacy `name` column to backfill from");
  }
})();

// Optional sanity check: any rows still missing the new fields?
const orphan = db.query(
  `SELECT COUNT(*) AS n FROM users WHERE first_name IS NULL AND surname IS NULL`
).get().n;
if (orphan > 0) {
  console.warn(`WARNING: ${orphan} user row(s) have neither first_name nor surname set.`);
  console.warn("Edit them via the UI before relying on the new fields.");
}

console.log("migration complete.");
