## Status — paused for hardware (2026-05-02)
- Active development is **paused** until the UHPPOTE controller, the Paxton P38 reader, and the HikVision DVR are physically installed and on the network. Expected ~1 week from the date above.
- The system is fully exercisable end-to-end *in demo mode*: synthetic access-log data, simulated controller health checks, and a static placeholder DVR snapshot. See **Hardware-dependent stubs** below for the exact list of code paths that need a live endpoint to graduate from demo to live.
- When hardware arrives, the path to going live is: flip `mode` flags in `config/client.json`, fill in real host/port/credentials, and implement the `pingLive()` / `frameUrl(live)` / sync-queue-worker bodies. Each stub lists its acceptance criteria.

## Context
- This repo is the **APH2 Access System** — a single-door access control system for Audlem Public Hall.
- Sibling repo with the booking/diary code: `/var/home/rcollins/code/aph2-diary`. Same volunteer team maintains both, so we mirror that repo's conventions where they apply.
- Hardware:
  - One UHPPOTE 1-door / 2-reader Wiegand-26 IP/UDP controller board (network-attached, default UDP port 60000).
  - One Paxton P38 EM4100 prox reader at the door (Wiegand-26 output to the controller).
  - One USB EM4100 enrollment reader at the admin workstation (HID keyboard — types the fob number into a focused input).
  - One HikVision DVR with cameras covering the door, accessible via the ISAPI HTTP API.
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
- **Phase 2 (done)**: Hono app + `/api/auth`, `/api/admin-users`, `/api/users`, `/api/groups`, `/api/access-log`. Audit log on every admin write. Controller-sync queue written to on every change that affects what the door should accept.
- **Phase 3 (done)**: Lit client. App-shell + login + home + users / groups / admin-users / access-log / controller status pages. Tailwind bundle. USB-EM4100-keyboard fob enrolment via the autofocused fob input on the user form. Controller-status page shows reachability via a 60-second simulated health-check ping. Access-log filters with typeahead user picker, comma-separated fob list, show/hide toggle. Film-strip dialog (5 simulated DVR frames) on every access-log row.
- **Paused — awaiting hardware**. See "Hardware-dependent stubs" below.
- **Phase 2.5 (when hardware arrives)**: Controller card-list sync worker (UHPPOTE 0x50 / 0x52). Drains `controller_sync_queue`, retries on failure, exposes a "Resync now" button on the controller-status page.
- **Phase DVR-live (when hardware arrives)**: Replace the demo film-strip generator with a real HikVision ISAPI image-by-time fetch, and wire the disabled "Watch 2-minute clip" button to an ISAPI clip endpoint.
- **Phase 4**: Reports by group / by fob, CSV download.

## Hardware-dependent stubs
Every demo-mode code path is listed here so that when hardware arrives the team has one checklist to walk. Each item names the file, the demo behaviour, what `live` mode needs to do, and the config knobs that have to be filled in.

### 1. UHPPOTE controller-sync queue worker — `server/services/controller-sync.js` *(file does not exist yet)*
- **Demo today**: every change that affects what the door accepts (insert with fob, fob change, block, unblock, soft-delete) writes a row to `controller_sync_queue` via `server/lib/controller-sync-queue.js`. Nothing drains it. The controller's on-board allowed-card list and our DB are *not* in sync today.
- **Live needs**:
  - A worker (setInterval or on-demand) that selects `WHERE done = 0 ORDER BY id` and, for each row, sends UHPPOTE function `0x50` (set card) or `0x52` (delete card) over UDP to `controller.host:port`.
  - On success: `UPDATE controller_sync_queue SET done = 1, done_at = ?`. On failure: increment `attempts`, store `last_error`, retry with backoff.
  - A "Resync now" button on the controller-status page that POSTs to a new `POST /api/controller/resync` endpoint to drain immediately.
- **Config**: `controller.host`, `controller.port`, `controller.serial_number` (already present, currently placeholders).

### 2. UHPPOTE controller health-check — `server/services/controller-health.js` (`pingLive()`)
- **Demo today**: 99% success organic + one engineered failure scheduled randomly between 0:30 and 4:30 after boot. Latency 5–50 ms simulated. Drives the **online / offline / unknown** tile and 20-dot sparkline on `#/controller`.
- **Live needs**: send UHPPOTE function `0x94` (or `0x20` get-status) and time the round-trip with a 3-second timeout. Return `{ts, ok, latency_ms, error}` shaped exactly like the demo result. Module already has the right imports + interval scheduling; only `pingLive()` body needs writing.
- **Config flip**: `controller.mode` from `"demo"` → `"live"`.

### 3. UHPPOTE controller "set listener" bootstrap — *(no script yet)*
- **Today**: not done. Without this, the real controller won't know where to send swipe events and our UDP listener will hear nothing.
- **Live needs**: a one-shot script (e.g. `scripts/configure-controller.js`) that sends UHPPOTE function `0x90` (set listener IP/port) to the controller's `host:port` with our server's IP and `udp.port`. Run once at install time.
- **Config**: `controller.host` / `controller.port`, plus the server's reachable IP (probably easiest to pass as a CLI arg).

### 4. HikVision DVR film-strip frames — `server/lib/dvr.js` (`frameUrl()` `mode === "live"`)
- **Demo today**: every frame URL points at the local `/media/gym-demo.jpg` (resized once via `scripts/fetch-demo-snapshot.js`). Server adds a 500–2500 ms artificial latency so the dialog spinner has something to do. UI shows an amber "Demo mode" banner under the strip.
- **Live needs**: `frameUrl()` builds a HikVision ISAPI image-by-time URL of the form `http://<host>/ISAPI/Streaming/channels/<chan>01/picture?starttime=YYYYMMDDTHHMMSSZ&endtime=...` for each frame's timestamp. Either return the URL (and rely on browser HTTP-Basic auth) or proxy through `/api/access-log/:id/film-strip-frame/:i`.
- **Config flip**: `dvr.mode` from `"demo"` → `"live"`. Also add `dvr.host`, `dvr.port`, `dvr.channel`, `dvr.username`, `dvr.password` to `config/client.json` *and* update the whitelist in `server/routes/config.js` so credentials don't leak to the browser.

### 5. HikVision DVR 2-minute video clip — film-strip dialog "Watch" button
- **Demo today**: button is rendered `disabled` with a tooltip ("Available once the DVR is on the network"). No backend endpoint.
- **Live needs**:
  - `GET /api/access-log/:id/clip` — calls HikVision ISAPI clip-export (`/ISAPI/ContentMgmt/download` style) for a 2-minute window starting at the swipe time. Returns either a video stream URL or a proxied byte-stream.
  - Drop the `disabled` attribute on the button in `client/src/components/film-strip-dialog.js` and wire `@click` to navigate to / inline-embed the clip URL.

### 6. USB EM4100 enrollment reader
- **Demo today**: not actually a stub — most USB EM4100 readers behave as a HID keyboard, "typing" the fob number plus Enter into the focused input. The `users-form.js` and `admin-users-form.js` fob inputs are autofocused on the new-user form so this Just Works as soon as a reader is plugged in.
- **Live**: plug in the reader. If the device sends extra characters (some pad with leading spaces or specific delimiters), tweak the input handlers in those two files to strip them.

### 7. Real-data import (replacing synthetic seed)
- **Demo today**: `scripts/seed-test-data.js` reads `db/gym_members_2026.csv` and produces ~30k synthetic access events for 18 months. Tagged "test data" — its `users` table guard refuses to run if rows already exist.
- **Live needs (go-live)**: separate `scripts/import-members.js` that reads the same CSV (or a fresh one), inserts only the `users` rows (no fake `access_log` events), and enqueues `controller_sync_queue` rows so the Phase 2.5 worker pushes them to the board. Currently absent — write before go-live.

### Restart checklist when hardware arrives
1. Implement the four `pingLive()` / `frameUrl(live)` / sync-worker / set-listener bodies above.
2. Update `config/client.json`: flip `controller.mode` → `"live"`, set real `controller.host`, `controller.port`, `controller.serial_number`. Flip `dvr.mode` → `"live"`, add credentials block.
3. Run the set-listener script once against the controller.
4. Run `bun run scripts/import-members.js` against a vetted CSV.
5. Watch `#/controller` — the green "online" tile and a populated sparkline confirm the round-trip.
6. Tap a fob on the door reader; confirm a `granted` row in `#/access-log` and a green dot in the next ping.

## Phase 3 client layout
- `client/src/{base,router,store,api,main}.js` — foundation (cloned from aph2-diary).
- `client/src/components/`:
  - `app-shell.js` — header + role-filtered NAV + outlet (cloned from diary, NAV adapted).
  - `auth-login.js` — login form. Re-boots the app on success via `aph-auth-changed` event.
  - `home-view.js` — quick-link tiles, role-filtered.
  - `users-list.js` / `users-form.js` — door-user CRUD. Form fob input is autofocused so a USB EM4100 reader can type the number + Enter.
  - `groups-list.js` / `groups-form.js`.
  - `admin-users-list.js` / `admin-users-form.js` — adapted from diary's pattern; password set via prompt from list view.
  - `access-log-page.js` — filterable list (date range + group + user + fob + outcome).
  - `controller-status.js` — pending/done counts + recent queue rows.
  - Generic helpers: `data-table.js`, `error-banner.js`, `confirm-dialog.js`, `form-field.js` (cloned from diary).
- Build: `bun run client:build` (bundle + Tailwind + copy index.html). Watch in dev: `bun run client:watch:js` and `client:watch:css` in two panes.

## Phase 3 server additions
- `server/routes/config.js` — `GET /api/config/client` returns a whitelisted subset of `config/client.json` (no controller IPs / serials).
- `server/routes/controller.js` — `GET /api/controller/status` returns `{ pending, done, total, recent }` from `controller_sync_queue`. super_user only.
- `server/app.js` — `serveStatic` from `hono/bun` mounted at `/*`, serving `client/dist/`.

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
- `bun run scripts/seed-admin.js <user> <pw> --super` — bootstrap a super-user (no API path before the first admin exists).
- `bun run scripts/fetch-demo-snapshot.js` — one-shot: download + resize the placeholder gym image to `media/gym-demo.jpg` (used by the film-strip dialog).
- `bun run scripts/seed-test-data.js` — populate ~219 demo users + ~30k synthetic access-log events from `db/gym_members_2026.csv`.
- `bun run client:build` — bundle the Lit client + Tailwind CSS into `client/dist`.
- `bun run dev` — start server: opens DB, starts UDP listener, starts HTTP server, schedules the controller-health ping.
- `bun test` — tier-1 + tier-2 suites.
- `bun run scripts/fake-controller.js <fob_number> [--denied]` — send a fake swipe packet to the local listener.
