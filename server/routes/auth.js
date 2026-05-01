// Authentication endpoints: login, logout, me. Mounted at /api/auth by app.js.
//
// Sessions:
//   * The cookie value is a 256-bit random hex string ("sid").
//   * Stored in admin_sessions with an absolute expires timestamp.
//   * Auth middleware (server/middleware/auth.js) looks the sid up on every
//     non-public request and attaches the admin to context.
//   * On every login we sweep expired session rows so the table doesn't grow
//     unboundedly.

import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import crypto from "node:crypto";

import db from "../db.js";
import config from "../config.js";
import { verifyPassword } from "../lib/password.js";
import { Temporal } from "../lib/temporal.js";

const routes = new Hono();

// ---- SQL ----

const findAdmin = db.query(
  `SELECT * FROM admin_users WHERE username = $username`,
);

const insertSession = db.query(`
  INSERT INTO admin_sessions (id, admin_user_id, created_at, expires)
  VALUES ($id, $admin_user_id, $created_at, $expires)
`);

const deleteSession = db.query(
  `DELETE FROM admin_sessions WHERE id = $id`,
);

// Opportunistic cleanup of expired sessions, run on every login so we don't
// need a separate cron.
const sweepExpired = db.query(
  `DELETE FROM admin_sessions WHERE expires < $now`,
);

// ---- helpers ----

// Strip hashed_password before returning admin info over the wire.
function adminPublic(row) {
  if (!row) return null;
  return {
    id:             row.id,
    username:       row.username,
    fob_number:     row.fob_number ?? null,
    super_user:     row.super_user,
    manage_users:   row.manage_users,
    manage_groups:  row.manage_groups,
    view_reports:   row.view_reports,
    user_id:        row.user_id ?? null,
  };
}

// ---- POST /api/auth/login ----

routes.post("/login", async (c) => {
  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "request body must be JSON" }, 400); }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return c.json({ error: "username and password are required" }, 400);
  }

  const admin = findAdmin.get({ $username: username });

  // Same error for unknown-user and bad-password to avoid user enumeration.
  const ok = !!admin && (await verifyPassword(password, admin.hashed_password));
  if (!ok) return c.json({ error: "invalid credentials" }, 401);

  const now = Temporal.Now.instant();
  const expires = now.add({ hours: config.sessionTtlHours });

  sweepExpired.run({ $now: now.toString() });

  const sid = crypto.randomBytes(32).toString("hex");
  insertSession.run({
    $id:            sid,
    $admin_user_id: admin.id,
    $created_at:    now.toString(),
    $expires:       expires.toString(),
  });

  setCookie(c, "aph_sid", sid, {
    httpOnly: true,
    secure:   config.cookieSecure,
    sameSite: "Strict",
    path:     "/",
    maxAge:   config.sessionTtlHours * 3600,
  });

  return c.json({ admin: adminPublic(admin) });
});

// ---- POST /api/auth/logout ----

routes.post("/logout", (c) => {
  const sid = getCookie(c, "aph_sid");
  if (sid) deleteSession.run({ $id: sid });
  deleteCookie(c, "aph_sid", { path: "/" });
  return c.json({ ok: true });
});

// ---- GET /api/auth/me ----

routes.get("/me", (c) => {
  const admin = c.get("admin");
  if (!admin) return c.json({ error: "not authenticated" }, 401);
  return c.json({ admin: adminPublic(admin) });
});

export default routes;
