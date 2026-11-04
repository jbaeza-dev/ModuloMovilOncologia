#!/usr/bin/env bash
# Probe the proposed configuration without stopping services or replacing active env files.
set -euo pipefail
umask 077
[[ "$#" == 3 ]] || { echo 'Canonical env, clinical image and gateway image required' >&2; exit 1; }
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary=$(mktemp -d)
cleanup() {
 for service in postgres clinical gateway powersync jwks; do rm -f "$temporary/env/$service.env"; done
 if [[ -d "$temporary/env" ]]; then rmdir "$temporary/env"; fi
 rmdir "$temporary"
}
trap cleanup EXIT
python3 "$BASE_DIR/scripts/environment.py" "$1" --output "$temporary/env"
mode=$(python3 "$BASE_DIR/scripts/environment.py" "$1" --get AUTH_JWKS_MODE)
if [[ "$mode" == distributed ]]; then
 timeout 20s podman run --rm --pull=never --network none --memory 128m \
  --env-file "$temporary/env/jwks.env" --volume "$BASE_DIR:/validation:ro,z" --entrypoint node "$2" \
  /validation/scripts/jwks-snapshot.mjs validate /validation/jwks-snapshot.json
 echo 'PASS: trusted snapshot validated before downtime.'
 exit 0
fi
check() {
 timeout 20s podman run --rm -i --pull=never --network "$1" --memory 128m \
  --env-file "$temporary/env/$2.env" --entrypoint node "$3" --input-type=module \
  < "$BASE_DIR/scripts/auth-ready.mjs"
}
# No listeners are opened by this short-lived process, including in host network mode.
check host clinical "$2"
if podman network exists qc-net; then
 check qc-net clinical "$2"
 check qc-net gateway "$3"
 powersync_image=$(python3 - "$BASE_DIR/versions.json" <<'PY'
import json,sys
value=json.load(open(sys.argv[1]))['powersync']
print(value['image']+':'+value['tag']+'@'+value['digest'])
PY
)
 check qc-net powersync "$powersync_image"
fi
echo 'PASS: autenticación comprobada antes de pausar escritores o migrar.'
