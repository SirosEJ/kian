#!/usr/bin/env bash
# Removes one story's preview resources: the Cloud Run service and the Neon database branch, both named kian-sft-<N>.
# Usage:       scripts/cleanup-story-preview.sh <story-number> [--dry-run]
# Environment: GCP_PROJECT_ID, NEON_API_KEY, NEON_PROJECT_ID. Optional: REGION (default europe-west1), NEON_API_BASE.
# Safe to run twice: something already gone counts as done. It only ever builds the name kian-sft-<digits>, so it cannot
# touch kian-staging, production, or the Neon default branch (which it also refuses explicitly).
set -euo pipefail

STORY="${1:-}"
DRY_RUN=false
[ "${2:-}" = "--dry-run" ] && DRY_RUN=true

if ! [[ "$STORY" =~ ^[0-9]{1,6}$ ]]; then
  echo "::error::Story number must be digits only, got '${STORY}'" >&2
  exit 2
fi
NAME="kian-sft-${STORY}"
: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${NEON_API_KEY:?NEON_API_KEY is required}"
: "${NEON_PROJECT_ID:?NEON_PROJECT_ID is required}"
REGION="${REGION:-europe-west1}"
NEON_API_BASE="${NEON_API_BASE:-https://console.neon.tech/api/v2}"
API="${NEON_API_BASE}/projects/${NEON_PROJECT_ID}"
RESPONSE="$(mktemp)"
trap 'rm -f "$RESPONSE"' EXIT

summary() { echo "$1"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- $1" >> "$GITHUB_STEP_SUMMARY" || true; }

# Calls the Neon API; on a non-2xx answer, fails with Neon's own message.
neon() {
  local code
  code="$(curl -sS -o "$RESPONSE" -w '%{http_code}' -X "$1" -H "Authorization: Bearer ${NEON_API_KEY}" -H 'Content-Type: application/json' "${API}$2")"
  if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
    echo "::error::Neon API $1 $2 returned HTTP ${code}: $(node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");try{const j=JSON.parse(t);console.log(j.message||t)}catch{console.log(t)}' "$RESPONSE")" >&2
    exit 1
  fi
  cat "$RESPONSE"
}

# ---- Neon branch (exact name match only; the search endpoint also returns partial matches)
FOUND="$(neon GET "/branches?search=${NAME}" | node -e '
  let d = ""; process.stdin.on("data", c => d += c).on("end", () => {
    const hit = (JSON.parse(d).branches || []).find(b => b.name === process.argv[1]);
    console.log(hit ? `${hit.id} ${hit.default ? "default" : "normal"}` : "");
  });' "$NAME")"
if [ -z "$FOUND" ]; then
  summary "Neon branch ${NAME}: already gone"
else
  BRANCH_ID="${FOUND%% *}"
  if [ "${FOUND##* }" = "default" ]; then
    echo "::error::Refusing to delete ${NAME}: Neon reports it as the default branch" >&2
    exit 3
  fi
  if [ "$DRY_RUN" = true ]; then
    summary "Neon branch ${NAME} (${BRANCH_ID}): would delete (dry run)"
  else
    neon DELETE "/branches/${BRANCH_ID}" > /dev/null
    summary "Neon branch ${NAME} (${BRANCH_ID}): deleted"
  fi
fi

# ---- Cloud Run service
EXISTING="$(gcloud run services list --project "$GCP_PROJECT_ID" --region "$REGION" --filter="metadata.name=${NAME}" --format='value(metadata.name)')"
if [ "$EXISTING" != "$NAME" ]; then
  summary "Cloud Run service ${NAME}: already gone"
elif [ "$DRY_RUN" = true ]; then
  summary "Cloud Run service ${NAME}: would delete (dry run)"
else
  gcloud run services delete "$NAME" --project "$GCP_PROJECT_ID" --region "$REGION" --quiet
  summary "Cloud Run service ${NAME}: deleted"
fi
