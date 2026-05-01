-- APH2 Access System schema. One file is the authoritative source; `bun run
-- db:init` rebuilds db/access.sqlite from it.
--
-- All timestamps are ISO 8601 strings written by the server (Temporal) - no
-- column-level CURRENT_TIMESTAMP defaults so the on-disk format stays
-- consistent. Server code MUST pass the timestamp explicitly on every insert.

-- ---------------------------------------------------------------------------
-- Admin auth (mirrors aph2-diary's admin_users / admin_sessions pattern)
-- ---------------------------------------------------------------------------

CREATE TABLE admin_users (
  id              INTEGER PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,            -- email
  hashed_password TEXT,                            -- nullable until set (diary pattern)
  fob_number      TEXT,                            -- 10-digit decimal; lets admins also use the door
  super_user      INTEGER NOT NULL DEFAULT 0,
  manage_users    INTEGER NOT NULL DEFAULT 0,
  manage_groups   INTEGER NOT NULL DEFAULT 0,
  view_reports    INTEGER NOT NULL DEFAULT 0,
  user_id         INTEGER REFERENCES users(id),    -- optional link to a door-user row
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE admin_sessions (
  id              TEXT PRIMARY KEY,                -- random opaque cookie value
  admin_user_id   INTEGER NOT NULL REFERENCES admin_users(id),
  created_at      TEXT NOT NULL,
  expires         TEXT NOT NULL                    -- ISO 8601; sortable as text
);
CREATE INDEX idx_admin_sessions_admin   ON admin_sessions(admin_user_id);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires);

-- ---------------------------------------------------------------------------
-- Door domain
-- ---------------------------------------------------------------------------

CREATE TABLE groups (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- `deleted_at` is the logical-delete marker (NULL = active). Workflow:
--   1. unpaid user is BLOCKED (blocked=1, fob still on file, controller
--      receives a 'delete' op so the door rejects them);
--   2. ~12 months later they're DELETED (deleted_at = ISO timestamp,
--      fob_number nulled so the physical fob can be reissued).
-- access_log rows keep referencing the soft-deleted user via user_id, so
-- historical "who came through the door in 2024?" reports still work.
--
-- `fob_number` is nullable BECAUSE of soft delete - a deleted user's fob
-- field is cleared so the same number can be reused by a new user. SQLite
-- UNIQUE allows multiple NULLs by default, which is what we want.
CREATE TABLE users (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  fob_number      TEXT UNIQUE,                     -- 10-digit decimal; NULL after soft delete
  group_id        INTEGER REFERENCES groups(id),
  blocked         INTEGER NOT NULL DEFAULT 0,
  blocked_reason  TEXT,
  deleted_at      TEXT,                            -- NULL = active; ISO 8601 = soft-deleted at
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_users_group       ON users(group_id);
CREATE INDEX idx_users_deleted_at  ON users(deleted_at);

-- One row per swipe. Outcome distinguishes intrusion / passback / etc., so we
-- never have to UNION across multiple log tables for reporting.
CREATE TABLE access_log (
  id              INTEGER PRIMARY KEY,
  ts              TEXT NOT NULL,                   -- event timestamp (from controller, ISO 8601)
  fob_number      TEXT NOT NULL,
  user_id         INTEGER REFERENCES users(id),    -- null when fob is unknown
  outcome         TEXT NOT NULL CHECK (outcome IN ('granted','blocked','unknown','passback')),
  controller_sn   INTEGER,                         -- controller serial number that reported it
  raw_packet      BLOB                             -- the original 64 bytes, kept for forensics
);
CREATE INDEX idx_access_log_ts        ON access_log(ts);
CREATE INDEX idx_access_log_fob_ts    ON access_log(fob_number, ts);
CREATE INDEX idx_access_log_user_ts   ON access_log(user_id, ts);
CREATE INDEX idx_access_log_outcome   ON access_log(outcome);

-- ---------------------------------------------------------------------------
-- Controller card-list sync queue (Phase 2.5)
--
-- On user create / amend / block / delete, server enqueues a 'set' or
-- 'delete' op here. A worker drains the queue, sending UHPPOTE function 0x50
-- (set card) / 0x52 (delete card) to the controller.
-- ---------------------------------------------------------------------------

CREATE TABLE controller_sync_queue (
  id              INTEGER PRIMARY KEY,
  enqueued_at     TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('set','delete')),
  fob_number      TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  done            INTEGER NOT NULL DEFAULT 0,
  done_at         TEXT
);
CREATE INDEX idx_sync_queue_pending ON controller_sync_queue(done, enqueued_at);

-- ---------------------------------------------------------------------------
-- Audit log (mirrors aph2-diary). Every admin write inserts a row here in
-- the same transaction as the underlying change.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY,
  occurred_at     TEXT NOT NULL,
  table_name      TEXT NOT NULL,
  row_id          INTEGER NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  admin_user_id   INTEGER REFERENCES admin_users(id),
  before_json     TEXT,
  after_json      TEXT
);
CREATE INDEX idx_audit_log_table_row ON audit_log(table_name, row_id);
CREATE INDEX idx_audit_log_admin     ON audit_log(admin_user_id);
CREATE INDEX idx_audit_log_time      ON audit_log(occurred_at);
