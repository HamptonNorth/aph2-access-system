#!/usr/bin/env bash
# 04-users: create, amend, block, unblock, soft-delete a door user. Also
# demonstrates the FK guard on group delete.
#
# Depends on 03-groups.sh having created group id=1 ("Members").
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_server

heading "list active users (empty after fresh db:init)"
req GET /api/users

heading "create a user in Members (id=1) -> user id=1"
req POST /api/users '{
  "name": "Curl Demo",
  "fob_number": "0000099001",
  "group_id": 1
}'

heading "amend the user (rename)"
req PUT /api/users/1 '{"name":"Curl Demo (renamed)"}'

heading "block the user (controller-sync queue gets a delete op)"
req POST /api/users/1/block '{"reason":"unpaid: Aug invoice"}'

heading "unblock the user (controller-sync queue gets a set op)"
req POST /api/users/1/unblock

heading "create a second user so we can demo the FK guard on group delete"
req POST /api/users '{"name":"Second User","fob_number":"0000099002","group_id":1}'

heading "try to delete the Members group (409 - users still reference it)"
req DELETE /api/groups/1

heading "soft-delete user id=1"
req DELETE /api/users/1

heading "active list (deleted user is hidden)"
req GET /api/users

heading "list including deleted (shows id=1 with fob_number nulled)"
req GET /api/users?include_deleted=1

heading "soft-delete the second user too, so the next run starts cleaner"
req DELETE /api/users/2
