// Single entry point for writing audit_log rows. Mirrors aph2-diary's
// services/auditService.js so volunteers see the same shape in both repos.
//
// Every call should happen inside the caller's db.transaction so the audit
// row commits only if the underlying change does - no phantom audit entries
// on rollback.
//
// Conventions:
//   * One row per (table_name, row_id, action) change.
//   * before / after are stringified row snapshots; field-level diffs are a
//     query-time concern.
//   * If before === after on update we skip the log to keep the table from
//     filling with no-op rewrites.

import db from "../db.js";
import { Temporal } from "./temporal.js";

const insertStmt = db.query(`
  INSERT INTO audit_log (
    occurred_at, table_name, row_id, action, admin_user_id, before_json, after_json
  ) VALUES (
    $occurred_at, $table_name, $row_id, $action, $admin_user_id, $before_json, $after_json
  )
`);

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function logChange({ table, rowId, action, adminUserId, before, after }) {
  if (action === "update" && shallowEqual(before, after)) return false;
  insertStmt.run({
    $occurred_at:   Temporal.Now.instant().toString(),
    $table_name:    table,
    $row_id:        rowId,
    $action:        action,
    $admin_user_id: adminUserId,
    $before_json:   before ? JSON.stringify(before) : null,
    $after_json:    after  ? JSON.stringify(after)  : null,
  });
  return true;
}
