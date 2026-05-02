// Controller status: small read-only endpoint that surfaces the
// controller_sync_queue contents and the latest health-check ping result
// so the UI can show pending counts AND whether the controller is
// actually reachable. Phase 2.5 will add `POST /api/controller/resync`
// for the manual replay button; for now this file is read-only.

import { Hono } from "hono";

import db from "../db.js";
import { getHealth } from "../services/controller-health.js";

const routes = new Hono();

function requireSuperUser(c) {
  const admin = c.get("admin");
  if (!admin || !admin.super_user) {
    return c.json({ error: "super user only" }, 403);
  }
  return null;
}

const countsStmt = db.query(`
  SELECT
    SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS done,
    COUNT(*) AS total
  FROM controller_sync_queue
`);

const recentStmt = db.query(`
  SELECT id, enqueued_at, action, fob_number, attempts, last_error, done, done_at
  FROM controller_sync_queue
  ORDER BY id DESC
  LIMIT 20
`);

routes.get("/status", (c) => {
  const deny = requireSuperUser(c);
  if (deny) return deny;

  const counts = countsStmt.get() ?? { pending: 0, done: 0, total: 0 };
  return c.json({
    pending: counts.pending ?? 0,
    done:    counts.done ?? 0,
    total:   counts.total ?? 0,
    recent:  recentStmt.all(),
    health:  getHealth(),
  });
});

export default routes;
