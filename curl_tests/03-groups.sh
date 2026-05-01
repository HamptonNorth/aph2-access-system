#!/usr/bin/env bash
# 03-groups: create, amend, delete groups. Leaves group id=1 ("Members") in
# place for 04-users.sh to use.
#
# Assumes a freshly-initialised DB (bun run db:init + scripts/seed-admin.js)
# so groups starts empty and the IDs assigned below are deterministic.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_server

heading "list groups (empty after fresh db:init)"
req GET /api/groups

heading "create the group used by 04-users.sh -> id=1"
req POST /api/groups '{"name":"Members","description":"General membership"}'

heading "create a second group -> id=2"
req POST /api/groups '{"name":"Volunteers","description":"Hall volunteers"}'

heading "amend the second group's description"
req PUT /api/groups/2 '{"description":"Hall volunteers (updated)"}'

heading "delete the second group (empty -> succeeds)"
req DELETE /api/groups/2

heading "list groups (just Members left)"
req GET /api/groups
