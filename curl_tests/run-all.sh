#!/usr/bin/env bash
# Runs every NN-*.sh script in this directory, in order. Errors abort the run.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Start each run with a clean cookie jar.
: > "$here/cookies.txt"

for s in "$here"/[0-9][0-9]-*.sh; do
  echo
  echo "############################################################"
  echo "# $(basename "$s")"
  echo "############################################################"
  bash "$s"
done
