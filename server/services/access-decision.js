// Pure decision function: given a decoded swipe event and a small bag of DB
// query helpers, return what outcome should be recorded.
//
// Outcome values (must stay in sync with db/schema.sql access_log.outcome
// CHECK constraint):
//
//   'unknown'  - no user has this fob (intrusion attempt)
//   'blocked'  - known fob whose user is marked blocked
//   'passback' - same fob seen again within passback_minutes of its last grant
//   'granted'  - known, not blocked, no recent grant
//
// Order of checks matters: unknown beats blocked beats passback beats granted.
// A blocked user is ALWAYS logged as 'blocked' (even if also inside the
// passback window) because that's the more diagnostic signal for ops.
//
// Kept pure (no DB / no time-of-day reads) so it tests fast and behaves
// identically in dev, test, and production. Callers pass in the queries
// they need:
//
//   findUserByFob(fobNumber)            -> { id, blocked, ... } | null
//   lastGrantedAccessForFob(fobNumber)  -> { ts } | null    (most recent 'granted' row)

/**
 * @param {object} event       Decoded swipe event (see uhppote-protocol.js).
 * @param {object} queries     { findUserByFob, lastGrantedAccessForFob }.
 * @param {object} config      { passbackMinutes }.
 * @returns {{ outcome: string, userId: number | null }}
 */
export function decide(event, queries, config) {
  const user = queries.findUserByFob(event.fobNumber);
  if (!user) {
    return { outcome: "unknown", userId: null };
  }

  if (user.blocked) {
    return { outcome: "blocked", userId: user.id };
  }

  const last = queries.lastGrantedAccessForFob(event.fobNumber);
  if (last) {
    // Numeric epoch-ms diff is plenty precise for a passback window measured
    // in minutes; using Temporal here would buy nothing. The event timestamp
    // is already an ISO 8601 string, so Date.parse round-trips cleanly.
    const eventMs = Date.parse(event.timestamp);
    const lastMs  = Date.parse(last.ts);
    const diffMinutes = (eventMs - lastMs) / 60000;
    if (diffMinutes >= 0 && diffMinutes < config.passbackMinutes) {
      return { outcome: "passback", userId: user.id };
    }
  }

  return { outcome: "granted", userId: user.id };
}
