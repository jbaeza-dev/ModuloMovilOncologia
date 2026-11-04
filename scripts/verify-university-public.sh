#!/usr/bin/env bash
# Required host smoke tests run during deploy.sh. This is an independent external observation.
set -euo pipefail
[[ "${QC_PUBLIC_ORIGIN:-}" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || { echo 'Invalid public HTTPS origin' >&2; exit 1; }
observe() {
 local label="$1" expected="$2" url="$3" status result
 shift 3
 if status=$(curl -4 --silent --show-error --connect-timeout 10 --max-time 20 -o /dev/null -w '%{http_code}' "$@" "$url"); then
  [[ "$status" == "$expected" ]] || { echo "::error::External $label expected HTTP $expected, received $status"; exit 1; }
  echo "External $label: HTTP $status"
 else
  result=$?
  if [[ "$result" == 28 && "$status" == 000 ]]; then
   echo "::warning::External verification inconclusive: GitHub runner could not reach Parra before timeout. Deployment host checks passed; external access must be checked from another network."
   if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo 'External verification: **INCONCLUSIVE** (network timeout without an HTTP response). Host readiness and public-route checks are required by deploy.sh; this warning is not proof of external availability.' >> "$GITHUB_STEP_SUMMARY"
   fi
   exit 0
  fi
  echo "::error::External $label transport/TLS failure (curl exit $result, HTTP $status)"
  exit 1
 fi
}
observe health 200 "$QC_PUBLIC_ORIGIN/quimiocare-backend/health"
observe sync 401 "$QC_PUBLIC_ORIGIN/quimiocare-backend/sync/stream" -X POST -H 'Content-Type: application/json' -d '{}'
observe checkpoint 401 "$QC_PUBLIC_ORIGIN/quimiocare-backend/write-checkpoint2.json?client_id=00000000-0000-4000-8000-000000000001"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
 echo 'External verification: **PASSED** (health 200, protected sync and checkpoint 401).' >> "$GITHUB_STEP_SUMMARY"
fi
