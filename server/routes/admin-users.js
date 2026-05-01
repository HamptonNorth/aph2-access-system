// Admin-user management. Mounted at /api/admin-users by server/app.js.
//
// Cloned from aph2-diary/server/routes/admin-users.js with two changes:
//   1. Role flags adapted to ours (super_user, manage_users, manage_groups,
//      view_reports - we don't have set_up_documents / booking / accounts).
//   2. `fob_number` field added so admins can also use the door without
//      needing a separate users row.
//
// Authorisation:
//   GET list, create, update flags, delete   -> super_user only
//   PUT  /:id/password                       -> super_user OR the admin themselves
//   GET  /:id                                -> super_user OR the admin themselves
//
// Note: changing an admin's fob_number does NOT enqueue a controller-sync op,
// because admin_users.fob_number is a convenience field; if the admin needs
// the door, the same fob should also be assigned to a row in `users`. The
// `users` route is what writes to the controller-sync queue.

import { Hono } from "hono";

import db from "../db.js";
import { hashPassword } from "../lib/password.js";
import { logChange } from "../lib/audit-log.js";
import { Temporal } from "../lib/temporal.js";

const routes = new Hono();

function requireSuperUser(c) {
  const admin = c.get("admin");
  if (!admin || !admin.super_user) {
    return c.json({ error: "super user only" }, 403);
  }
  return null;
}

// ---- SQL ----

// `has_password` is exposed (rather than the hash) so the UI can show whether
// an admin can currently log in.
const listStmt = db.query(`
  SELECT
    a.id, a.username, a.fob_number,
    a.super_user, a.manage_users, a.manage_groups, a.view_reports,
    a.user_id,
    (a.hashed_password IS NOT NULL) AS has_password,
    a.created_at, a.updated_at
  FROM admin_users AS a
  ORDER BY a.username
`);

const getStmt = db.query(`
  SELECT
    a.id, a.username, a.fob_number,
    a.super_user, a.manage_users, a.manage_groups, a.view_reports,
    a.user_id,
    (a.hashed_password IS NOT NULL) AS has_password,
    a.created_at, a.updated_at
  FROM admin_users AS a
  WHERE a.id = $id
`);

// Internal read - includes hashed_password for diff snapshots in audit_log.
const getInternalStmt = db.query(`SELECT * FROM admin_users WHERE id = $id`);

const insertStmt = db.query(`
  INSERT INTO admin_users (
    username, fob_number,
    super_user, manage_users, manage_groups, view_reports,
    user_id, created_at, updated_at
  ) VALUES (
    $username, $fob_number,
    $super_user, $manage_users, $manage_groups, $view_reports,
    $user_id, $now, $now
  )
  RETURNING id
`);

const updateStmt = db.query(`
  UPDATE admin_users SET
    username      = $username,
    fob_number    = $fob_number,
    super_user    = $super_user,
    manage_users  = $manage_users,
    manage_groups = $manage_groups,
    view_reports  = $view_reports,
    user_id       = $user_id,
    updated_at    = $now
  WHERE id = $id
`);

const updatePasswordStmt = db.query(
  `UPDATE admin_users SET hashed_password = $hash, updated_at = $now WHERE id = $id`,
);

const deleteStmt = db.query(`DELETE FROM admin_users WHERE id = $id`);

// Soft-delete fallback for admins with audit_log history. Clears password,
// roles, fob, and linked user. The row stays so audit FKs keep referencing
// a real admin.
const deactivateStmt = db.query(`
  UPDATE admin_users
  SET hashed_password = NULL,
      fob_number      = NULL,
      super_user      = 0,
      manage_users    = 0,
      manage_groups   = 0,
      view_reports    = 0,
      user_id         = NULL,
      updated_at      = $now
  WHERE id = $id
`);

// ---- helpers ----

function asFlag(v) {
  return v === true || v === 1 || v === "1" || v === "Y" || v === "y" ? 1 : 0;
}

function asUserId(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Fob normalisation: trim, treat empty as null. We don't validate strict
// 10-digit length here because controller models vary - just store what was
// typed and let the UI surface validation messages.
function asFob(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// ---- GET /api/admin-users ----

routes.get("/", (c) => {
  const deny = requireSuperUser(c);
  if (deny) return deny;
  return c.json({ admin_users: listStmt.all() });
});

// ---- POST /api/admin-users ----

routes.post("/", async (c) => {
  const deny = requireSuperUser(c);
  if (deny) return deny;

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "request body must be JSON" }, 400); }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!username) return c.json({ error: "username is required" }, 400);

  const me = c.get("admin");
  const now = Temporal.Now.instant().toString();

  const params = {
    $username:      username,
    $fob_number:    asFob(body.fob_number),
    $super_user:    asFlag(body.super_user),
    $manage_users:  asFlag(body.manage_users),
    $manage_groups: asFlag(body.manage_groups),
    $view_reports:  asFlag(body.view_reports),
    $user_id:       asUserId(body.user_id),
    $now:           now,
  };

  let id;
  try {
    db.transaction(() => {
      id = insertStmt.get(params).id;
      logChange({
        table: "admin_users",
        rowId: id,
        action: "insert",
        adminUserId: me.id,
        before: null,
        after: getInternalStmt.get({ $id: id }),
      });
    })();
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
  return c.json({ admin_user: getStmt.get({ $id: id }) }, 201);
});

// ---- GET /api/admin-users/:id ----

routes.get("/:id", (c) => {
  const me = c.get("admin");
  const id = Number(c.req.param("id"));
  if (!me.super_user && me.id !== id) {
    return c.json({ error: "forbidden" }, 403);
  }
  const row = getStmt.get({ $id: id });
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ admin_user: row });
});

// ---- PUT /api/admin-users/:id ----

routes.put("/:id", async (c) => {
  const deny = requireSuperUser(c);
  if (deny) return deny;

  const id = Number(c.req.param("id"));
  const existing = getInternalStmt.get({ $id: id });
  if (!existing) return c.json({ error: "not found" }, 404);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "request body must be JSON" }, 400); }

  const me = c.get("admin");
  const now = Temporal.Now.instant().toString();

  // undefined => keep existing; null/empty/false => write the new value.
  const params = {
    $id: id,
    $username: typeof body.username === "string" && body.username.trim()
      ? body.username.trim()
      : existing.username,
    $fob_number: body.fob_number === undefined
      ? existing.fob_number : asFob(body.fob_number),
    $super_user: body.super_user === undefined
      ? existing.super_user : asFlag(body.super_user),
    $manage_users: body.manage_users === undefined
      ? existing.manage_users : asFlag(body.manage_users),
    $manage_groups: body.manage_groups === undefined
      ? existing.manage_groups : asFlag(body.manage_groups),
    $view_reports: body.view_reports === undefined
      ? existing.view_reports : asFlag(body.view_reports),
    $user_id: body.user_id === undefined
      ? existing.user_id : asUserId(body.user_id),
    $now: now,
  };

  try {
    db.transaction(() => {
      updateStmt.run(params);
      logChange({
        table: "admin_users",
        rowId: id,
        action: "update",
        adminUserId: me.id,
        before: existing,
        after: getInternalStmt.get({ $id: id }),
      });
    })();
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }

  return c.json({ admin_user: getStmt.get({ $id: id }) });
});

// ---- PUT /api/admin-users/:id/password ----

routes.put("/:id/password", async (c) => {
  const me = c.get("admin");
  const id = Number(c.req.param("id"));
  if (!me.super_user && me.id !== id) {
    return c.json({ error: "forbidden" }, 403);
  }

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "request body must be JSON" }, 400); }

  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return c.json({ error: "password is required" }, 400);

  const hash = await hashPassword(password);
  const now = Temporal.Now.instant().toString();
  const res = updatePasswordStmt.run({ $id: id, $hash: hash, $now: now });
  if (res.changes === 0) return c.json({ error: "not found" }, 404);

  // Audit row records that the password changed; we don't store the hash itself.
  logChange({
    table: "admin_users",
    rowId: id,
    action: "update",
    adminUserId: me.id,
    before: { password: "(set)" },
    after:  { password: "(set)" },
  });

  return c.json({ ok: true });
});

// ---- DELETE /api/admin-users/:id ----
//
// Hard-delete only succeeds for admins with no historical audit_log rows.
// Otherwise the FK guard fires and we return 409 with a hint to deactivate.

routes.delete("/:id", (c) => {
  const deny = requireSuperUser(c);
  if (deny) return deny;

  const id = Number(c.req.param("id"));
  const me = c.get("admin");
  if (me.id === id) {
    return c.json({ error: "cannot delete yourself" }, 400);
  }

  const existing = getInternalStmt.get({ $id: id });
  if (!existing) return c.json({ error: "not found" }, 404);

  try {
    db.transaction(() => {
      deleteStmt.run({ $id: id });
      logChange({
        table: "admin_users",
        rowId: id,
        action: "delete",
        adminUserId: me.id,
        before: existing,
        after: null,
      });
    })();
    return c.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes("FOREIGN KEY")) {
      return c.json({
        error: "This admin has historical records (audit log) and can't be removed. " +
               "Deactivate instead - that clears their password, roles, fob, and " +
               "linked user so they can no longer sign in.",
        code:  "has_history",
      }, 409);
    }
    return c.json({ error: e.message }, 400);
  }
});

// ---- POST /api/admin-users/:id/deactivate ----

routes.post("/:id/deactivate", (c) => {
  const deny = requireSuperUser(c);
  if (deny) return deny;

  const id = Number(c.req.param("id"));
  const me = c.get("admin");
  if (me.id === id) {
    return c.json({ error: "cannot deactivate yourself" }, 400);
  }

  const existing = getInternalStmt.get({ $id: id });
  if (!existing) return c.json({ error: "not found" }, 404);

  const now = Temporal.Now.instant().toString();
  db.transaction(() => {
    deactivateStmt.run({ $id: id, $now: now });
    logChange({
      table: "admin_users",
      rowId: id,
      action: "update",
      adminUserId: me.id,
      before: existing,
      after: getInternalStmt.get({ $id: id }),
    });
  })();
  return c.json({ admin_user: getStmt.get({ $id: id }) });
});

export default routes;
