// Read-only access-log queries. Mounted at /api/access-log by server/app.js.
//
// Covers spec item 5.5 user-attendance:
//
//   GET /api/access-log?from=ISO&to=ISO&group_id=N&user_id=N&fob=NNNN[,NNNN...]&outcome=granted&limit=N
//
// All filters are optional; combine freely. The `fob` filter accepts a
// single fob or a comma-separated list - useful for "show me activity for
// these three fobs at once". Returned rows are joined to the users + groups
// tables so the UI doesn't need to hit those endpoints separately.
// Soft-deleted users are still resolved (so historical reports remain
// accurate) but you can spot them by `user_deleted_at IS NOT NULL`.

import { Hono } from "hono";

import db from "../db.js";

const routes = new Hono();

const VALID_OUTCOMES = new Set(["granted", "blocked", "unknown", "passback"]);
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

function requireReportViewer(c) {
  const admin = c.get("admin");
  if (!admin || (!admin.super_user && !admin.view_reports)) {
    return c.json({ error: "view_reports role required" }, 403);
  }
  return null;
}

// We build the SQL with concatenated WHERE fragments rather than one giant
// statement with COALESCE-trickery. This keeps each filter readable - the
// volunteer maintaining it can see what each clause does at a glance.
function buildQuery(filters) {
  const where = [];
  const params = {};

  if (filters.from) {
    where.push("al.ts >= $from");
    params.$from = filters.from;
  }
  if (filters.to) {
    where.push("al.ts <= $to");
    params.$to = filters.to;
  }
  if (filters.userId != null) {
    where.push("al.user_id = $user_id");
    params.$user_id = filters.userId;
  }
  if (filters.groupId != null) {
    where.push("u.group_id = $group_id");
    params.$group_id = filters.groupId;
  }
  if (filters.fobs && filters.fobs.length > 0) {
    // Build an IN clause with a named placeholder per value so we still get
    // bound-parameter safety - SQLite doesn't have an array placeholder.
    const placeholders = filters.fobs.map((_, i) => `$fob${i}`).join(", ");
    where.push(`al.fob_number IN (${placeholders})`);
    filters.fobs.forEach((f, i) => { params[`$fob${i}`] = f; });
  }
  if (filters.outcome) {
    where.push("al.outcome = $outcome");
    params.$outcome = filters.outcome;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // user_name is derived from first_name + surname so the client just gets
  // a display string. Keep the join minimal - we only show name + group on
  // each row.
  const sql = `
    SELECT al.id, al.ts, al.fob_number, al.outcome, al.controller_sn,
           al.user_id,
           TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.surname,'')) AS user_name,
           u.deleted_at AS user_deleted_at,
           u.group_id, g.name AS group_name
    FROM access_log AS al
    LEFT JOIN users  AS u ON u.id = al.user_id
    LEFT JOIN groups AS g ON g.id = u.group_id
    ${whereSql}
    ORDER BY al.ts DESC, al.id DESC
    LIMIT $limit
  `;
  params.$limit = filters.limit;
  return { sql, params };
}

routes.get("/", (c) => {
  const deny = requireReportViewer(c);
  if (deny) return deny;

  // Parse + sanitise query params.
  const q = c.req.query();
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(q.limit) || DEFAULT_LIMIT));

  // `fob` accepts a single value or a comma-separated list. We split, trim
  // each entry, drop empties, and pass a (possibly empty) array down to the
  // query builder.
  const fobsRaw = typeof q.fob === "string" ? q.fob : "";
  const fobs = fobsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const filters = {
    from:    typeof q.from === "string" ? q.from : null,
    to:      typeof q.to   === "string" ? q.to   : null,
    userId:  q.user_id  != null && q.user_id  !== "" ? Number(q.user_id)  : null,
    groupId: q.group_id != null && q.group_id !== "" ? Number(q.group_id) : null,
    fobs,
    outcome: typeof q.outcome === "string" ? q.outcome : null,
    limit,
  };

  if (filters.outcome && !VALID_OUTCOMES.has(filters.outcome)) {
    return c.json({ error: `outcome must be one of: ${[...VALID_OUTCOMES].join(", ")}` }, 400);
  }
  if (filters.userId != null && !Number.isFinite(filters.userId)) {
    return c.json({ error: "user_id must be numeric" }, 400);
  }
  if (filters.groupId != null && !Number.isFinite(filters.groupId)) {
    return c.json({ error: "group_id must be numeric" }, 400);
  }

  const { sql, params } = buildQuery(filters);
  const rows = db.query(sql).all(params);
  return c.json({ access_log: rows, limit, count: rows.length });
});

export default routes;
