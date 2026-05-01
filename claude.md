## Context
- This repo is the **APH2 Access System** — a single-door access control system for Audlem Public Hall.
- Sibling repo with the booking/diary code: `/var/home/rcollins/code/aph2-diary`. Same volunteer team maintains both, so we mirror that repo's conventions where they apply.
- Hardware:
  - One UHPPOTE 1-door / 2-reader Wiegand-26 IP/UDP controller board (network-attached, default UDP port 60000).
  - One Paxton P38 EM4100 prox reader at the door (Wiegand-26 output to the controller).
  - One USB EM4100 enrollment reader at the admin workstation (HID keyboard — types the fob number into a focused input).
  - Up to ~200 fobs in service.

## Stack
- **Bun** 1.3+ — runtime, package manager, test runner, SQLite binding. Same as aph2-diary.
- **Hono** for HTTP routing, mounted in `server/app.js` (Phase 2).
- **SQLite** (`bun:sqlite`) at `db/access.sqlite`. Authoritative schema in `db/schema.sql`.
- **Lit** light-DOM custom elements (Phase 3) — base class copied from aph2-diary.
- **Vanilla JS only** — no TypeScript, no `tsconfig.json`. JSDoc is fine.
- **Temporal API** via `@js-temporal/polyfill` — wrapped in `server/lib/temporal.js` so the import site is consistent. All timestamps stored as ISO 8601 strings (e.g. `2026-05-01T13:24:30.123Z`).

## What this system does
- The UHPPOTE controller is the authoritative gate keeper — it has the allowed-card list in its on-board memory and decides whether to open the lock. We push card additions / removals to it (Phase 2.5).
- It also broadcasts every swipe over UDP. Our server listens, decodes the packet, looks the fob up in our DB, and records the outcome:
  - `granted`  — known fob, not blocked, no recent prior swipe
  - `blocked`  — known fob whose user is marked blocked
  - `unknown`  — no user has this fob (intrusion attempt)
  - `passback` — same fob seen again within `passback_minutes` of its last grant
- Admin web UI (Phase 3) lets ops manage users / groups / admin users and view reports.

## Repo layout
- `db/schema.sql` — authoritative schema. `bun run db:init` recreates `db/access.sqlite` from it (**destructive**).
- `config/client.json` — runtime knobs (passback minutes, UDP port, controller serial, …). Edit and restart; no rebuild.
- `server/index.js` — entrypoint: opens DB, starts UDP listener (Phase 1), starts Hono (Phase 2).
- `server/db.js` — single shared `bun:sqlite` handle. `APH_DB_PATH` env overrides the default path (used by tier-2 tests).
- `server/lib/uhppote-protocol.js` — pure encode/decode of the 64-byte controller packets. Byte-layout table at the top of the file.
- `server/lib/temporal.js` — Temporal re-export.
- `server/lib/password.js` — argon2id via `Bun.password`.
- `server/services/access-decision.js` — pure function: given a decoded swipe + DB lookups, return `{outcome, userId}`.
- `server/services/udp-listener.js` — binds the UDP socket, decodes, decides, writes the access_log row.
- `server/services/controller-sync.js` *(Phase 2.5)* — pushes card adds/removes to the UHPPOTE board.
- `server/middleware/{auth,logging}.js` — copied from aph2-diary, role flags adapted to ours.
- `server/routes/` — one Hono router file per resource (Phase 2).
- `client/src/components/` — Lit elements, one per page or widget (Phase 3).
- `scripts/fake-controller.js` — CLI that crafts and sends a swipe packet for any fob; lets us exercise the listener end-to-end with no hardware.
- `tests/tier1/` — pure-logic unit tests (protocol, decision, helpers).
- `tests/tier2/` — integration tests via `app.fetch()` + tmp SQLite (`tests/tier2/setup.js`).
- `curl_tests/` — shell-based API smoke tests (Phase 2).

## Conventions (mirror aph2-diary)
- Tables: `snake_case`, plural; FKs named `<table>_id`.
- All admin writes log to `audit_log` (table_name, row_id, action, admin_user_id, before/after JSON).
- Admin role flags: `super_user`, `manage_users`, `manage_groups`, `view_reports`. Server enforces; client nav only filters for UX.
- Auth = `aph_sid` HttpOnly cookie -> `admin_sessions` row -> `admin_users` row, attached to Hono context (`c.get("admin")`).
- Volunteers maintain this code: favour straightforward over clever, comment the *why*, never the *what*.

## Phase plan
- **Phase 1 (done)**: UDP listener + DB writes. `bun run dev` listens, fake-controller sends, access_log fills.
- **Phase 2 (now)**: Hono app + `/api/auth`, `/api/admin-users` (cloned from diary, fob field added), `/api/users`, `/api/groups`, `/api/access-log`. Audit log on every admin write. Controller-sync queue is written to on every change that affects what the door should accept (Phase 2.5 will drain it). Curl smoke tests.
- **Phase 2.5**: Controller card-list sync worker (UHPPOTE 0x50 / 0x52). Drains `controller_sync_queue`, retries on failure, exposes a "Resync now" endpoint.
- **Phase 3**: Lit client (navbar cloned from diary, screens for users/groups/access-log/admin-users/enrollment).
- **Phase 4**: Reports by group / by fob, CSV download.

## Phase 2 routes (current)
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `/api/admin-users`: GET list / GET :id / POST / PUT :id / PUT :id/password / DELETE :id / POST :id/deactivate. super_user only (except `:id/password` and `GET :id`, which the admin can also do for themselves).
- `/api/users`: GET list (`?include_deleted=1`) / GET :id / POST / PUT :id / POST :id/block / POST :id/unblock / DELETE :id (soft). manage_users role.
- `/api/groups`: GET list / GET :id / POST / PUT :id / DELETE :id. manage_groups role.
- `/api/access-log`: GET ? from / to / user_id / group_id / fob / outcome / limit. view_reports role.

## Soft-delete model for door users
- **Block** (`POST /api/users/:id/block`): `blocked=1`, `blocked_reason` set, fob still on file. Future swipes log as `'blocked'`. Phase 2.5 pushes a `delete` to the controller so the door physically rejects.
- **Unblock** (`POST /api/users/:id/unblock`): `blocked=0`, fob still on file. Phase 2.5 pushes a `set`.
- **Delete** (`DELETE /api/users/:id`): `deleted_at` set, `fob_number` nulled. The user row stays so historical access_log rows still resolve. The fob can be reissued to a new user immediately. Phase 2.5 pushes a `delete`.
- After delete, every endpoint on that id returns 410 Gone.

## Getting started
- `bun install`
- `bun run db:init` — create `db/access.sqlite` from schema.sql (**destructive**).
- `bun run dev` — start server: opens DB and starts UDP listener on the configured port.
- `bun test` — tier-1 + tier-2 suites.
- `bun run scripts/fake-controller.js <fob_number> [--denied]` — send a fake swipe packet to the local listener.
