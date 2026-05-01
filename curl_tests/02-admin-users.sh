#!/usr/bin/env bash
# 02-admin-users: list, create, set password, update flags, deactivate.
# Assumes 01-auth.sh has populated the cookie jar with a super_user session.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_server

heading "list admin users"
req GET /api/admin-users

heading "create a new admin (no password yet - can't sign in)"
req POST /api/admin-users '{
  "username": "ops@example.com",
  "manage_users": 1,
  "manage_groups": 1
}'

heading "set password for the new admin (super user picks the id from the list above)"
req PUT /api/admin-users/2/password '{"password":"opspw"}'

heading "update permissions"
req PUT /api/admin-users/2 '{"view_reports":1}'

heading "fetch the updated row"
req GET /api/admin-users/2

heading "cleanup: deactivate (clears password + roles + linked user)"
req POST /api/admin-users/2/deactivate
