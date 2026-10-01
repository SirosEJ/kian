#!/usr/bin/env bash
# Production gate: a commit may be released only if it is on main and its own Deploy Staging run succeeded.
# Usage: scripts/verify-release-candidate.sh <40-character commit SHA>   (run inside a full checkout; needs git and an authenticated gh)
# Exit codes: 0 ok, 2 bad input, 3 not on main, 4 no successful staging deploy for this exact commit.
set -euo pipefail
SHA="${1:-}"
MAIN="${KIAN_MAIN_REF:-origin/main}"
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Give the full 40-character commit SHA (lower case hex). Got: '${SHA:0:60}'" >&2
  exit 2
fi
if ! git merge-base --is-ancestor "$SHA" "$MAIN"; then
  echo "::error::Commit $SHA is not on main. Only commits that were merged to main can be released to production." >&2
  exit 3
fi
count="$(gh run list --workflow staging.yml --commit "$SHA" --status success --limit 5 --json conclusion --jq 'length')"
if [ "${count:-0}" -lt 1 ]; then
  echo "::error::No successful Deploy Staging run for commit $SHA. Wait for staging to deploy it (or choose a commit that did), verify it there, then release." >&2
  exit 4
fi
echo "Commit $SHA is on main and passed Deploy Staging."
