// Helper for enqueuing card-list changes destined for the UHPPOTE controller.
// Called from the user / admin-user routes whenever the set of cards the
// door should accept changes (add, fob change, block, unblock, delete).
//
// Phase 2 only writes to the queue. Phase 2.5's controller-sync worker drains
// it - that's where the actual UDP traffic with the board happens. By
// enqueuing today, every Phase 2 change is replayable as soon as the worker
// ships - no retroactive backfill needed.

import db from "./../db.js";
import { Temporal } from "./temporal.js";

const insertStmt = db.query(`
  INSERT INTO controller_sync_queue (enqueued_at, action, fob_number)
  VALUES ($enqueued_at, $action, $fob_number)
`);

/**
 * Enqueue an add/update of a fob on the controller.
 * Skips silently when fobNumber is null (soft-deleted users can have no fob).
 */
export function enqueueSet(fobNumber) {
  if (!fobNumber) return;
  insertStmt.run({
    $enqueued_at: Temporal.Now.instant().toString(),
    $action: "set",
    $fob_number: fobNumber,
  });
}

/**
 * Enqueue a removal of a fob from the controller.
 */
export function enqueueDelete(fobNumber) {
  if (!fobNumber) return;
  insertStmt.run({
    $enqueued_at: Temporal.Now.instant().toString(),
    $action: "delete",
    $fob_number: fobNumber,
  });
}
