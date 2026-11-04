#!/usr/bin/env bash
# Install only trusted public artifacts. Caller is an authorized main workflow/operator.
set -euo pipefail
umask 077
[[ "$#" == 2 ]] || { echo 'Snapshot and immutable simulator image required' >&2; exit 1; }
ROOT="$HOME/quimiocare"
SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
temporary=$(mktemp -d)
cleanup() { rm -f "$temporary/env/"*.env; rmdir "$temporary/env" "$temporary"; }
trap cleanup EXIT
python3 "$SCRIPTS/environment.py" "$ROOT/shared/universidad.env" --output "$temporary/env" >/dev/null
mkdir -p "$ROOT/shared/auth"
chmod 755 "$ROOT/shared/auth"
exec 8>"$ROOT/shared/jwks.lock"
flock -w 10 8 || { echo 'JWKS maintenance busy' >&2; exit 1; }
source_dir=$(cd "$(dirname "$1")" && pwd)
source_name=$(basename "$1")
[[ "$source_name" =~ ^[a-zA-Z0-9_.-]+$ ]] || exit 1
# User 0 inside rootless Podman maps to this unprivileged host account.
result=$(timeout 20s podman run --rm --pull=never --network none --user 0:0 --read-only --cap-drop ALL --memory 128m \
 --env-file "$temporary/env/jwks.env" \
 --volume "$SCRIPTS:/scripts:ro,z" --volume "$source_dir:/incoming:ro,z" \
 --volume "$ROOT/shared/auth:/snapshots:rw,z" --entrypoint node "$2" \
 /scripts/jwks-snapshot.mjs install "/incoming/$source_name" /snapshots)
echo "$result"
# A key change must also evict PowerSync's in-memory keys and existing streams.
if [[ "${JWKS_INSTALL_DURING_DEPLOY:-false}" == true ]]; then
 # The deployment owns stopped services and starts them after migrations/readiness.
 exit 0
fi
if [[ "$result" == KEYSET_CHANGED ]] && systemctl --user is-active --quiet qc-powersync.service; then
 touch "$ROOT/shared/auth/restart-sync"
fi
if [[ -f "$ROOT/shared/auth/restart-sync" ]]; then
 timeout 60s systemctl --user restart qc-powersync.service qc-proxy-backend.service
elif [[ -f "$ROOT/shared/auth/resume-sync" ]]; then
 timeout 60s systemctl --user start qc-powersync.service qc-proxy-backend.service
fi
rm -f "$ROOT/shared/auth/resume-sync" "$ROOT/shared/auth/restart-sync"
