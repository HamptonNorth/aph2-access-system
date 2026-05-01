// Group management. Mounted at /api/groups by server/app.js.
//
// Groups are a soft organisational label (e.g. "Trustees", "Bowls Club"),
// used for reporting and (eventually) group-level access rules. No
// access-control semantics today - a user is granted/blocked individually.

import { Hono } from "hono";

import db from "../db.js";
import { logChange } from "../lib/audit-log.js";
import { Temporal } from "../lib/temporal.js";

const routes = new Hono();

function requireGroupManager(c) {
  const admin = c.get("admin");
  if (!admin || (!admin.super_user && !admin.manage_groups)) {
    return c.json({ error: "manage_groups role required" }, 403);
  }
  return null;
}

// ---- SQL ----

const listStmt = db.query(`
  SELECT g.id, g.name, g.description, g.created_at, g.updated_at,
         (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id AND u.deleted_at IS NULL) AS user_count
  FROM groups AS g
  ORDER BY g.name
`);

const getStmt = db.query(`SELECT * FROM groups WHERE id = $id`);

const insertStmt = db.query(`
  INSERT INTO groups (name, description, created_at, updated_at)
  VALUES ($name, $description, $now, $now)
  RETURNING id
`);

const updateStmt = db.query(`
  UPDATE groups SET name = $name, description = $description, updated_at = $now
  WHERE id = $id
`);

const deleteStmt = db.query(`DELETE FROM groups WHERE id = $id`);

// ---- routes ----

routes.get("/", (c) => {
  const deny = requireGroupManager(c);
  if (deny) return deny;
  return c.json({ groups: listStmt.all() });
});

routes.get("/:id", (c) => {
  const deny = requireGroupManager(c);
  if (deny) return deny;
  const row = getStmt.get({ $id: Number(c.req.param("id")) });
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ group: row });
});

routes.post("/", async (c) => {
  const deny = requireGroupManager(c);
  if (deny) return deny;

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "request body must be JSON" }, 400); }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name is required" }, 400);

  const description = typeof body.description === "string" ? body.description.trim() : null;
  const me = c.get("admin");
  const now = Temporal.Now.instant().toString();

  let id;
  try {
    db.transaction(() => {
      id = insertStmt.get({ $name: name, $description: description, $now: now }).id;
      logChange({
        table: "groups", rowId: id, action: "insert", adminUserId: me.id,
        before: null, after: getStmt.get({ $id: id }),
      });
    })();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return c.json({ error: "group name already in use" }, 409);
    }
    return c.json({ error: e.message }, 400);
  }
  return c.json({ group: getStmt.get({ $id: id }) }, 201);
});

routes.put("/:id", async (c) => {
  const deny = requireGroupManager(c);
  if (deny) return deny;

  const id = Number(c.req.param("id"));
  const existing = getStmt.get({ $id: id });
  if (!existing) return c.json({ error: "not found" }, 404);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "request body must be JSON" }, 400); }

  const me = c.get("admin");
  const now = Temporal.Now.instant().toString();

  const params = {
    $id: id,
    $name: typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : existing.name,
    $description: body.description === undefined
      ? existing.description
      : (typeof body.description === "string" ? body.description.trim() : null),
    $now: now,
  };

  try {
    db.transaction(() => {
      updateStmt.run(params);
      logChange({
        table: "groups", rowId: id, action: "update", adminUserId: me.id,
        before: existing, after: getStmt.get({ $id: id }),
      });
    })();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return c.json({ error: "group name already in use" }, 409);
    }
    return c.json({ error: e.message }, 400);
  }
  return c.json({ group: getStmt.get({ $id: id }) });
});

// Hard delete. Fails with 409 if any user (including soft-deleted) still
// references the group - the operator should reassign those users first.
routes.delete("/:id", (c) => {
  const deny = requireGroupManager(c);
  if (deny) return deny;

  const id = Number(c.req.param("id"));
  const existing = getStmt.get({ $id: id });
  if (!existing) return c.json({ error: "not found" }, 404);

  const me = c.get("admin");

  try {
    db.transaction(() => {
      deleteStmt.run({ $id: id });
      logChange({
        table: "groups", rowId: id, action: "delete", adminUserId: me.id,
        before: existing, after: null,
      });
    })();
    return c.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes("FOREIGN KEY")) {
      return c.json({
        error: "this group still has users assigned; reassign them first",
        code: "has_users",
      }, 409);
    }
    return c.json({ error: e.message }, 400);
  }
});

export default routes;
