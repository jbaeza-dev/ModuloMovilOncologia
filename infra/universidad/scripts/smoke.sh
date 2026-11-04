#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE=$(printenv CONTAINER_ENGINE || printf podman)
[[ "$ENGINE" == podman || "$ENGINE" == docker ]] || exit 1
probe() {
 "$ENGINE" exec "$1" node -e "fetch('http://localhost:$2$3',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
}
for attempt in {1..30}; do
 if probe qc-clinical 3002 /health && probe qc-ai 3003 /health && probe qc-gateway 3001 /internal/ready && "$ENGINE" exec -i qc-powersync node --input-type=module < "$BASE_DIR/scripts/powersync-ready.mjs"; then break; fi
 [[ "$attempt" != 30 ]] || { echo 'Readiness failed; no automatic database restore.' >&2; exit 1; }
 sleep 2
done
systemctl --user is-active --quiet qc-worker.service
for container in qc-clinical qc-gateway qc-powersync; do
 "$ENGINE" exec -i "$container" node --input-type=module < "$BASE_DIR/scripts/auth-ready.mjs"
done
for url in http://127.0.0.1:8018/healthz http://127.0.0.1:8019/healthz http://127.0.0.1:8019/health; do curl --fail --silent --show-error --max-time 10 "$url" >/dev/null; done
for url in http://127.0.0.1:8018/__demo/reset http://127.0.0.1:8019/sync/api/admin/v1/diagnostics http://127.0.0.1:8019/internal/ready; do
 code=$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' "$url")
 [[ "$code" == 404 ]] || { echo 'An internal route is exposed' >&2; exit 1; }
done
code=$(curl --silent --show-error --max-time 10 -X POST -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}' http://127.0.0.1:8019/sync/stream)
[[ "$code" == 401 ]] || { echo "Sync route expected 401, got $code" >&2; exit 1; }
if [[ -n "$(printenv PUBLIC_ORIGIN || true)" ]]; then
 curl --fail --silent --show-error --max-time 15 "$PUBLIC_ORIGIN/quimiocare-backend/health" >/dev/null
 code=$(curl --silent --show-error --max-time 15 -X POST -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}' "$PUBLIC_ORIGIN/quimiocare-backend/sync/stream")
 [[ "$code" == 401 ]] || { echo 'Public TLS/PowerSync prefix failed' >&2; exit 1; }
fi
# The SDK needs this second public PowerSync endpoint to apply post-upload checkpoints.
for base in http://127.0.0.1:8019 "${PUBLIC_ORIGIN:+$PUBLIC_ORIGIN/quimiocare-backend}"; do
 [[ -n "$base" ]] || continue
 code=$(curl --silent --show-error --max-time 15 -o /dev/null -w '%{http_code}' "$base/write-checkpoint2.json?client_id=00000000-0000-4000-8000-000000000001")
 [[ "$code" == 401 ]] || { echo "Write checkpoint route expected 401, got $code" >&2; exit 1; }
done
echo 'PASS: database-backed services, worker, initial snapshot, replication lag and public prefixes.'
