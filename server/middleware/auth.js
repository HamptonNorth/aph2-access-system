// Auth middleware. Reads the `aph_sid` cookie, joins admin_sessions to
// admin_users, and attaches the admin record to the request context.
//
// Public paths (login, health) bypass this check. Everything else under
// /api/ requires a valid session - 401 otherwise.

import { getCookie } from "hono/cookie";
import db from "../db.js";

// One statement reused per request. Only returns a row if the session exists
// and has not expired, so "valid session" is a single SQL round-trip.
const lookupStmt = db.query(`
  SELECT
    s.id        AS session_id,
    s.expires   AS session_expires,
    au.id,
    au.username,
    au.fob_number,
    au.super_user,
    au.manage_users,
    au.manage_groups,
    au.view_reports,
    au.user_id
  FROM admin_sessions AS s
  JOIN admin_users    AS au ON au.id = s.admin_user_id
  WHERE s.id = $sid
    AND s.expires > $now
`);

function isPublic(path) {
  // Anything outside /api/ is static client assets, the app shell, or the
  // SPA entry - no session required. The static handler + onError fallback
  // in app.js decides what actually gets served.
  if (!path.startsWith("/api/")) return true;
  if (path === "/api/auth/login") return true;
  if (path === "/api/health") return true;
  return false;
}

export function auth() {
  return async (c, next) => {
    if (isPublic(c.req.path)) return next();

    const sid = getCookie(c, "aph_sid");
    if (!sid) return c.json({ error: "not authenticated" }, 401);

    // Compare against the same ISO 8601 format we wrote to admin_sessions.expires.
    const now = new Date().toISOString();
    const admin = lookupStmt.get({ $sid: sid, $now: now });
    if (!admin) return c.json({ error: "session expired" }, 401);

    c.set("admin", admin);
    return next();
  };
}
