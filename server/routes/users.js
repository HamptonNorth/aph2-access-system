// Door-user management. Mounted at /api/users by server/app.js.
//
// Authorisation: any admin with `manage_users` (or super_user) can use these
// routes. The check is done in the routes themselves, not via a middleware,
// so each handler stays self-contained.
//
// Soft-delete model: payment-defaulting users are first BLOCKED; ~12 months
// later they're DELETED logically (deleted_at set, fob_number nulled).
// Historical access_log rows keep referencing the soft-deleted row through
// the FK, so attendance reports remain accurate.
//
// Every change that can affect what the door accepts (insert with fob, fob
// change, block, unblock, soft-delete) is mirrored to controller_sync_queue
// for the Phase 2.5 worker to push to the UHPPOTE board.

import { Hono } from "hono";

import db from "../db.js";
import { logChange } from "../lib/audit-log.js";
import { enqueueSet, enqueueDelete } from "../lib/controller-sync-queue.js";
import { Temporal } from "../lib/temporal.js";

const routes = new Hono();

function requireUserManager(c) {
  const admin = c.get("admin");
  if (!admin || (!admin.super_user && !admin.manage_users)) {
    return c.json({ error: "manage_users role required" }, 403);
  }
  return null;
}

// ---- SQL ----
//
// All read statements expose `name` as a derived column (first_name + ' ' +
// surname, trimmed) so any UI that wants a single display string still gets
// one. Sort order is surname, first_name (the conventional "people list"
// ordering).

const SELECT_LIST = `
  SELECT u.id, u.first_name, u.surname,
         TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.surname,'')) AS name,
         u.fob_number, u.group_id, u.blocked, u.blocked_reason,
         u.deleted_at, u.created_at, u.updated_at,
         g.name AS group_name
  FROM users AS u
  LEFT JOIN groups AS g ON g.id = u.group_id
`;

const listActiveStmt = db.query(`
  ${SELECT_LIST}
  WHERE u.deleted_at IS NULL
  ORDER BY u.surname, u.first_name
`);

const listAllStmt = db.query(`
  ${SELECT_LIST}
  ORDER BY (u.deleted_at IS NOT NULL), u.surname, u.first_name
`);

const getStmt = db.query(`
  ${SELECT_LIST}
  WHERE u.id = $id
`);

// Snapshot used for audit-log diffs.
const getInternalStmt = db.query(`SELECT * FROM users WHERE id = $id`);

const insertStmt = db.query(`
  INSERT INTO users
    (first_name, surname, fob_number, group_id, blocked, blocked_reason, created_at, updated_at)
  VALUES
    ($first_name, $surname, $fob_number, $group_id, 0, NULL, $now, $now)
  RETURNING id
`);

const updateStmt = db.query(`
  UPDATE users SET
    first_name = $first_name,
    surname    = $surname,
    fob_number = $fob_number,
    group_id   = $group_id,
    updated_at = $now
  WHERE id = $id AND deleted_at IS NULL
`);

const blockStmt = db.query(`
  UPDATE users
  SET blocked = 1, blocked_reason = $reason, updated_at = $now
  WHERE id = $id AND deleted_at IS NULL
`);

const unblockStmt = db.query(`
  UPDATE users
  SET blocked = 0, blocked_reason = NULL, updated_at = $now
  WHERE id = $id AND deleted_at IS NULL
`);

const softDeleteStmt = db.query(`
  UPDATE users
  SET deleted_at = $now, fob_number = NULL, updated_at = $now
  WHERE id = $id AND deleted_at IS NULL
`);

// ---- helpers ----

function asGroupId(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asFob(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function asTrimmed(v) {
  return typeof v === "string" ? v.trim() : "";
}

// ---- GET /api/users ----

routes.get("/", (c) => {
  const deny = requireUserManager(c);
  if (deny) return deny;

  const includeDeleted = c.req.query("include_deleted") === "1";
  const rows = includeDeleted ? listAllStmt.all() : listActiveStmt.all();
  return c.json({ users: rows });
});

// ---- GET /api/users/:id ----

routes.get("/:id", (c) => {
  const deny = requireUserManager(c);
  if (deny) return deny;

  const row = getStmt.get({ $id: Number(c.req.param("id")) });
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ user: row });
});

// ---- POST /api/users ----

routes.post("/", async (c) => {
  const deny = requireUserManager(c);
  if (deny) return deny;

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "request body must be JSON" }, 400); }

  const first   = asTrimmed(body.first_name);
  const surname = asTrimmed(body.surname);
  if (!first)   return c.json({ error: "first_name is required" }, 400);
  if (!surname) return c.json({ error: "surname is required" }, 400);

  const fob = asFob(body.fob_number);
  if (!fob) return c.json({ error: "fob_number is required" }, 400);

  const me = c.get("admin");
  const now = Temporal.Now.instant().toString();

  let id;
  try {
    db.transaction(() => {
      id = insertStmt.get({
        $first_name: first,
        $surname:    surname,
        $fob_number: fob,
        $group_id:   asGroupId(body.group_id),
        $now:        now,
      }).id;
      logChange({
        table: "users",
        rowId: id,
        action: "insert",
        adminUserId: me.id,
        before: null,
        after: getInternalStmt.get({ $id: id }),
      });
      enqueueSet(fob);
    })();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return c.json({ error: "fob_number already in use" }, 409);
    }
    return c.json({ error: e.message }, 400);
  }
  return c.json({ user: getStmt.get({ $id: id }) }, 201);
});

// ---- PUT /api/users/:id ----

routes.put("/:id", async (c) => {
  const deny = requireUserManager(c);
  if (deny) return deny;

  const id = Number(c.req.param("id"));
  const existing = getInternalStmt.get({ $id: id });
  if (!existing) return c.json({ error: "not found" }, 404);
  if (existing.deleted_at) return c.json({ error: "user is deleted" }, 410);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "request body must be JSON" }, 400); }

  const me = c.get("admin");
  const now = Temporal.Now.instant().toString();

  const newFob = body.fob_number === undefined
    ? existing.fob_number
    : asFob(body.fob_number);

  // Reject clearing the fob via amend - that's what soft-delete is for.
  if (newFob === null) {
    return c.json({ error: "fob_number cannot be cleared via amend; delete the user instead" }, 400);
  }

  // first_name / surname: undefined => keep; "" => reject (NOT NULL).
  const firstRaw   = body.first_name === undefined ? undefined : asTrimmed(body.first_name);
  const surnameRaw = body.surname    === undefined ? undefined : asTrimmed(body.surname);
  if (firstRaw   === "") return c.json({ error: "first_name cannot be cleared" }, 400);
  if (surnameRaw === "") return c.json({ error: "surname cannot be cleared" }, 400);

  const params = {
    $id: id,
    $first_name: firstRaw   ?? existing.first_name,
    $surname:    surnameRaw ?? existing.surname,
    $fob_number: newFob,
    $group_id:   body.group_id === undefined ? existing.group_id : asGroupId(body.group_id),
    $now:        now,
  };

  try {
    db.transaction(() => {
      updateStmt.run(params);
      const after = getInternalStmt.get({ $id: id });
      logChange({
        table: "users",
        rowId: id,
        action: "update",
        adminUserId: me.id,
        before: existing,
        after,
      });
      // If the fob changed, the controller needs to forget the old one and
      // learn the new one.
      if (existing.fob_number !== after.fob_number) {
        if (existing.fob_number) enqueueDelete(existing.fob_number);
        if (after.fob_number)    enqueueSet(after.fob_number);
      }
    })();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return c.json({ error: "fob_number already in use" }, 409);
    }
    return c.json({ error: e.message }, 400);
  }

  return c.json({ user: getStmt.get({ $id: id }) });
});

// ---- POST /api/users/:id/block ----

routes.post("/:id/block", async (c) => {
  const deny = requireUserManager(c);
  if (deny) return deny;

  const id = Number(c.req.param("id"));
  const existing = getInternalStmt.get({ $id: id });
  if (!existing) return c.json({ error: "not found" }, 404);
  if (existing.deleted_at) return c.json({ error: "user is deleted" }, 410);

  let body = {};
  try { body = await c.req.json(); }
  catch { /* empty body is fine for block */ }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return c.json({ error: "reason is required" }, 400);

  const me = c.get("admin");
  const now = Temporal.Now.instant().toString();

  db.transaction(() => {
    blockStmt.run({ $id: id, $reason: reason, $now: now });
    logChange({
      table: "users",
      rowId: id,
      action: "update",
      adminUserId: me.id,
      before: existing,
      after: getInternalStmt.get({ $id: id }),
    });
    if (existing.fob_number) enqueueDelete(existing.fob_number);
  })();

  return c.json({ user: getStmt.get({ $id: id }) });
});

// ---- POST /api/users/:id/unblock ----

routes.post("/:id/unblock", (c) => {
  const deny = requireUserManager(c);
  if (deny) return deny;

  const id = Number(c.req.param("id"));
  const existing = getInternalStmt.get({ $id: id });
  if (!existing) return c.json({ error: "not found" }, 404);
  if (existing.deleted_at) return c.json({ error: "user is deleted" }, 410);

  const me = c.get("admin");
  const now = Temporal.Now.instant().toString();

  db.transaction(() => {
    unblockStmt.run({ $id: id, $now: now });
    logChange({
      table: "users",
      rowId: id,
      action: "update",
      adminUserId: me.id,
      before: existing,
      after: getInternalStmt.get({ $id: id }),
    });
    if (existing.fob_number) enqueueSet(existing.fob_number);
  })();

  return c.json({ user: getStmt.get({ $id: id }) });
});

// ---- DELETE /api/users/:id ---- (soft delete)

routes.delete("/:id", (c) => {
  const deny = requireUserManager(c);
  if (deny) return deny;

  const id = Number(c.req.param("id"));
  const existing = getInternalStmt.get({ $id: id });
  if (!existing) return c.json({ error: "not found" }, 404);
  if (existing.deleted_at) return c.json({ error: "already deleted" }, 410);

  const me = c.get("admin");
  const now = Temporal.Now.instant().toString();

  db.transaction(() => {
    softDeleteStmt.run({ $id: id, $now: now });
    logChange({
      table: "users",
      rowId: id,
      action: "delete",
      adminUserId: me.id,
      before: existing,
      after: getInternalStmt.get({ $id: id }),
    });
    if (existing.fob_number) enqueueDelete(existing.fob_number);
  })();

  return c.json({ ok: true });
});

export default routes;
