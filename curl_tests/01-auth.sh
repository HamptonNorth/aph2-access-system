#!/usr/bin/env bash
# 01-auth: log in as the seeded super_user, then check /me. Other scripts in
# this folder reuse the cookie jar this script populates.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_server

# Wipe any stale cookie before logging in fresh.
: > "$COOKIES"

heading "login as super_user"
req POST /api/auth/login '{"username":"admin","password":"adminpw"}'

heading "who am I?"
req GET /api/auth/me

heading "health check"
req GET /api/health
