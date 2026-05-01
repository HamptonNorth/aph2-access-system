#!/usr/bin/env bash
# Shared helpers. Sourced (not executed) by each NN-<resource>.sh script.
#
# Phase 1 has no HTTP API yet, so this file exists only as a placeholder so
# Phase 2's first script lands cleanly. The contents are copied verbatim from
# aph2-diary's curl_tests/_common.sh - same conventions, same cookie jar.
#
# Env overrides:
#   BASE      default http://localhost:3002
#   COOKIES   default ./cookies.txt next to the scripts
#   JQ        set JQ=0 to skip pretty-printing (if jq is not installed)

BASE="${BASE:-http://localhost:3002}"
COOKIES="${COOKIES:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cookies.txt}"

have_jq() {
  [[ "${JQ:-1}" = "1" ]] && command -v jq >/dev/null 2>&1
}

# req METHOD PATH [JSON_BODY]
# Sends a request with the shared cookie jar, prints the HTTP status and the
# response body (pretty via jq if available).
req() {
  local method="$1"; local path="$2"; local body="${3:-}"

  local tmp
  tmp="$(mktemp)"
  local args=(-s -o "$tmp" -w '%{http_code}' -b "$COOKIES" -c "$COOKIES"
              -X "$method" "${BASE}${path}")
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi

  local status
  status="$(curl "${args[@]}")"

  echo "HTTP ${status}  ${method} ${path}"
  if [[ -s "$tmp" ]]; then
    if have_jq; then jq . < "$tmp" 2>/dev/null || cat "$tmp"
    else cat "$tmp"
    fi
    echo
  fi
  rm -f "$tmp"
}

heading() {
  echo
  echo "=== $* ==="
}

# Check the server is up before running tests; bail early with a clear message.
require_server() {
  if ! curl -sf "${BASE}/" > /dev/null; then
    echo "server not responding at ${BASE}" >&2
    echo "start it with: bun run dev" >&2
    exit 1
  fi
}
