#!/usr/bin/env bash
# 05-access-log: fire a few mimic swipes via the UDP fake-controller, then
# query the access log with various filters.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_server

# Fire mimic packets. Requires bun on PATH and the server to be running on
# the configured UDP port. The fobs below are chosen so the first matches
# what 04-users.sh enrolled (now soft-deleted, so it'll log as 'unknown')
# and the second doesn't match anything.
heading "fire two mimic swipes"
bun run scripts/fake-controller.js 0000099001 || true
bun run scripts/fake-controller.js 0000099999 --denied || true
# Give the listener a beat to commit the rows before we read.
sleep 1

heading "everything (newest first, default limit 500)"
req GET /api/access-log

heading "only intrusion attempts (unknown fobs)"
req GET '/api/access-log?outcome=unknown'

heading "only granted swipes"
req GET '/api/access-log?outcome=granted'

heading "filtered by date range (this year)"
req GET '/api/access-log?from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z&limit=20'
