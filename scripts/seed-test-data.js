#!/usr/bin/env bun
// scripts/seed-test-data.js
//
// Imports the active members from db/gym_members_2026.csv into the users
// table and generates ~18 months of synthetic access_log events for them,
// so the UI / reports have realistic demo data without real swipes.
//
// Distribution rules (per the brief):
//   * Average 1.8 visits per member per week.
//   * Range: 0.5 to 9 visits / week per member.
//   * 5% of members never visit (paying-but-not-using).
//   * Time-of-day bias: 50% of swipes 07:00-09:15, 30% 16:40-18:00,
//     20% spread across 06:00-22:00.
//
// Idempotent guard: aborts if the users table already has rows. Run
// `bun run db:init && bun run scripts/seed-admin.js <user> <pw> --super`
// first, then this script.
//
// Usage:
//   bun run scripts/seed-test-data.js [csvPath]   (defaults to db/gym_members_2026.csv)

import { readFileSync, existsSync } from "node:fs";
import db from "../server/db.js";
import { Temporal } from "../server/lib/temporal.js";

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------
//
// The source file has a single header row, then an active section, a row
// reading "CANCELLED,," that marks the start of cancelled members, then
// some trailing sentinel rows ("active,,", "paused,,", etc.). We only keep
// rows from the active section that have a numeric fob and both names.
// Duplicates (the file has a handful) are dropped on first occurrence.

function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const out = [];
  let inCancelled = false;

  for (let i = 1; i < lines.length; i++) {  // skip header
    const raw = lines[i];
    if (!raw) continue;

    if (raw.trim().toUpperCase().startsWith("CANCELLED")) {
      inCancelled = true;
      continue;
    }
    if (inCancelled) continue;

    const cols = raw.split(",").map((c) => c.trim());
    if (cols.length < 3) continue;

    const [fob, first, surname] = cols;
    if (!/^\d+$/.test(fob)) continue;
    if (!first || !surname)  continue;
    if (seen.has(fob))       continue;
    seen.add(fob);

    out.push({ fob, first, surname });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Visit-rate + time-of-day distributions
// ---------------------------------------------------------------------------

// Weekly rate per member. 5% never visit; remaining 95% sampled from a
// right-skewed distribution that lands the population mean at ~1.8.
//
//   90%   in [0.5, 2.5]    mean 1.5
//    5%   in [2.5, 5.0]    mean 3.75
//    5%   in [5.0, 9.0]    mean 7.0
//   ------------------
//   excl-zero mean ≈ 1.89, overall mean ≈ 1.79.
function pickWeeklyRate() {
  if (Math.random() < 0.05) return 0;
  const u = Math.random();
  if (u < 0.90) return 0.5 + Math.random() * 2.0;
  if (u < 0.95) return 2.5 + Math.random() * 2.5;
  return 5.0 + Math.random() * 4.0;
}

// Pick a (hours, minutes, seconds) tuple biased toward the two peak
// windows. Operating hours 06:00-22:00.
function pickTimeOfDay() {
  const u = Math.random();
  let totalMinutes;
  if (u < 0.50) {
    // morning peak 07:00 - 09:15  (135 min wide)
    totalMinutes = 7 * 60 + Math.random() * 135;
  } else if (u < 0.80) {
    // evening peak 16:40 - 18:00  (80 min wide)
    totalMinutes = 16 * 60 + 40 + Math.random() * 80;
  } else {
    // off-peak: anywhere in 06:00 - 22:00
    totalMinutes = 6 * 60 + Math.random() * 16 * 60;
  }
  const hours   = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  const seconds = Math.floor(Math.random() * 60);
  return { hours, minutes, seconds };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const csvPath = process.argv[2] ?? "db/gym_members_2026.csv";
if (!existsSync(csvPath)) {
  console.error(`csv not found: ${csvPath}`);
  process.exit(1);
}

// Don't clobber existing data.
const existing = db.query("SELECT COUNT(*) AS n FROM users").get().n;
if (existing > 0) {
  console.error(`users table already has ${existing} rows.`);
  console.error("Run `bun run db:init` first (and re-seed admin via scripts/seed-admin.js).");
  process.exit(1);
}

const members = parseCsv(readFileSync(csvPath, "utf8"));
console.log(`parsed ${members.length} active members from ${csvPath}`);
if (members.length === 0) {
  console.error("nothing to seed.");
  process.exit(1);
}

const now = Temporal.Now.instant().toString();

// Single Members group.
const groupRow = db.query(`
  INSERT INTO groups (name, description, created_at, updated_at)
  VALUES ('Members', 'Audlem gym members (synthetic test data)', $now, $now)
  RETURNING id
`).get({ $now: now });
const groupId = groupRow.id;

const insertUser = db.query(`
  INSERT INTO users
    (first_name, surname, fob_number, group_id, blocked, blocked_reason, created_at, updated_at)
  VALUES
    ($f, $s, $fob, $g, 0, NULL, $now, $now)
  RETURNING id
`);

// Insert users in a single transaction for speed.
const userRows = [];
db.transaction(() => {
  for (const m of members) {
    // Pad fobs to the 10-digit form the controller emits, so the data
    // matches the wire shape elsewhere in the system.
    const fob = m.fob.padStart(10, "0");
    try {
      const { id } = insertUser.get({
        $f: m.first, $s: m.surname, $fob: fob, $g: groupId, $now: now,
      });
      userRows.push({ id, fob });
    } catch (e) {
      // The CSV has a couple of accidental dupes; ignore.
      if (!String(e.message).includes("UNIQUE")) throw e;
    }
  }
})();
console.log(`inserted ${userRows.length} users into the Members group`);

// ---------------------------------------------------------------------------
// Generate access_log events
// ---------------------------------------------------------------------------

const insertLog = db.query(`
  INSERT INTO access_log (ts, fob_number, user_id, outcome, controller_sn)
  VALUES ($ts, $fob, $uid, $outcome, $sn)
`);

const CONTROLLER_SN = 423187757;
const DAY_MS  = 86_400_000;
const PERIOD_DAYS = 540;                    // ~18 months
const periodMs = PERIOD_DAYS * DAY_MS;
const endMs    = Date.now();
const startMs  = endMs - periodMs;
const totalWeeks = PERIOD_DAYS / 7;

let granted = 0;
let zeroVisitors = 0;
const rateHistogram = { lo: 0, mid: 0, hi: 0, zero: 0 };

db.transaction(() => {
  for (const u of userRows) {
    const rate = pickWeeklyRate();
    if (rate === 0) {
      zeroVisitors += 1;
      rateHistogram.zero += 1;
      continue;
    }
    if (rate <= 2.5)      rateHistogram.lo  += 1;
    else if (rate <= 5.0) rateHistogram.mid += 1;
    else                  rateHistogram.hi  += 1;

    const visits = Math.round(rate * totalWeeks);
    for (let i = 0; i < visits; i++) {
      const dayOffset = Math.floor(Math.random() * PERIOD_DAYS);
      const { hours, minutes, seconds } = pickTimeOfDay();
      const d = new Date(startMs + dayOffset * DAY_MS);
      d.setUTCHours(hours, minutes, seconds, 0);

      insertLog.run({
        $ts:      d.toISOString(),
        $fob:     u.fob,
        $uid:     u.id,
        $outcome: "granted",
        $sn:      CONTROLLER_SN,
      });
      granted += 1;
    }
  }

  // Sprinkle a small handful of "unknown fob" intrusion attempts so the
  // outcome filter on the access-log page has something interesting.
  for (let i = 0; i < 24; i++) {
    const dayOffset = Math.floor(Math.random() * PERIOD_DAYS);
    const { hours, minutes, seconds } = pickTimeOfDay();
    const d = new Date(startMs + dayOffset * DAY_MS);
    d.setUTCHours(hours, minutes, seconds, 0);
    // Random 10-digit fob outside the range used above.
    const fob = String(9_900_000_000 + Math.floor(Math.random() * 100_000_000));
    insertLog.run({
      $ts:      d.toISOString(),
      $fob:     fob,
      $uid:     null,
      $outcome: "unknown",
      $sn:      CONTROLLER_SN,
    });
  }
})();

console.log("");
console.log(`generated ${granted} 'granted' events + 24 'unknown' intrusion attempts`);
console.log(`covering ${PERIOD_DAYS} days (${(totalWeeks).toFixed(1)} weeks)`);
console.log("rate histogram:");
console.log(`  zero (paying, no visits) : ${rateHistogram.zero} member(s)`);
console.log(`  light (0.5 - 2.5 / week) : ${rateHistogram.lo} member(s)`);
console.log(`  med   (2.5 - 5.0 / week) : ${rateHistogram.mid} member(s)`);
console.log(`  heavy (5.0 - 9.0 / week) : ${rateHistogram.hi} member(s)`);
const empiricalMean = granted / userRows.length / totalWeeks;
console.log(`empirical mean visits/week/member: ${empiricalMean.toFixed(2)} (target 1.8)`);
console.log("");
console.log("done. To verify in the UI: bun run dev, then sign in and visit");
console.log("  /users        - 200+ members in the Members group");
console.log("  /access-log   - filter by outcome / date / user");
