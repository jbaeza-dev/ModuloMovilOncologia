#!/usr/bin/env bash
# Called by the main-only CI deployment, or explicitly by the authorized host operator.
set -euo pipefail
umask 077
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
[[ "$(printenv QC_INSTALL_AUTHORIZED)" == yes ]] || { echo 'Installation authorization required' >&2; exit 1; }
[[ "$#" == 1 ]] || { echo 'Explicit immutable release directory required' >&2; exit 1; }
ROOT="$HOME/quimiocare"
RELEASE=$(realpath "$1")
[[ "$RELEASE" == "$ROOT/releases/"* && ! -L "$1" ]] || { echo 'Release must be under the deployment root' >&2; exit 1; }
ENV="$ROOT/shared/universidad.env"
SCRIPTS="$RELEASE/infra/universidad/scripts"
mkdir -p "$ROOT/shared" "$ROOT/backups"
exec 9>"$ROOT/deploy.lock"
flock -n 9 || { echo 'Another deployment holds the lock' >&2; exit 1; }
bash "$SCRIPTS/preflight.sh"
python3 "$SCRIPTS/environment.py" "$ENV"
NAMESPACE=$(python3 "$SCRIPTS/environment.py" "$ENV" --get IMAGE_NAMESPACE)
python3 "$SCRIPTS/release.py" "$RELEASE" --namespace "$NAMESPACE"
REVISION=$(python3 "$SCRIPTS/release.py" "$RELEASE" --namespace "$NAMESPACE" --get revision)
SEQUENCE=$(python3 "$SCRIPTS/release.py" "$RELEASE" --namespace "$NAMESPACE" --get sequence)
RELEASE_ID=$(python3 "$SCRIPTS/release.py" "$RELEASE" --namespace "$NAMESPACE" --get release_id)
[[ "$(basename "$RELEASE")" == "$RELEASE_ID" ]] || { echo 'Release path/identity mismatch' >&2; exit 1; }
if [[ -f "$ROOT/shared/successful-deployment.json" ]]; then
 python3 - "$ROOT/shared/successful-deployment.json" "$SEQUENCE" "$REVISION" <<'PY'
import json,sys
old=json.load(open(sys.argv[1],encoding="utf-8"))
if int(sys.argv[2]) < old["sequence"] or (int(sys.argv[2]) == old["sequence"] and sys.argv[3] != old["revision"]):
    raise SystemExit("Refusing an obsolete CI deployment")
PY
fi
SIMULATOR_IMAGE=$(python3 "$SCRIPTS/release.py" "$RELEASE" --namespace "$NAMESPACE" --get simulator)
GATEWAY_IMAGE=$(python3 "$SCRIPTS/release.py" "$RELEASE" --namespace "$NAMESPACE" --get gateway)
# Pull serially before downtime. REGISTRY_AUTH_FILE is an ephemeral host file provisioned by CI.
podman pull "$SIMULATOR_IMAGE"
podman pull "$GATEWAY_IMAGE"
for image in $(python3 - "$RELEASE/infra/universidad/versions.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]))
for key in ("postgres","powersync","nginx"):
 print(v[key]["image"]+":"+v[key]["tag"]+"@"+v[key]["digest"])
PY
); do podman pull "$image"; done
if podman container exists qc-clinical; then
 DATABASE_CONTAINER=qc-postgres DATABASE_USER=postgres CLINICAL_DATABASE=qc_demo GATEWAY_DATABASE=qc_gateway_demo MEDIA_ROOT="$ROOT/media" BACKUP_ROOT="$ROOT/backups" RESUME_WRITERS=false bash "$SCRIPTS/backup.sh"
fi
# Keep writers stopped until migrations, file verification and readiness finish.
for unit in qc-worker qc-gateway qc-clinical qc-ai qc-powersync; do
 if systemctl --user cat "$unit.service" >/dev/null 2>&1; then timeout 45s systemctl --user stop "$unit.service"; fi
done
python3 "$SCRIPTS/environment.py" "$ENV" --output "$ROOT/shared/env"
python3 "$SCRIPTS/release.py" "$RELEASE" --namespace "$NAMESPACE" --render "$ROOT/shared/quadlet-next" --activate-root "$ROOT"
mkdir -p "$HOME/.config/containers/systemd"
podman unshare mkdir -p "$ROOT/media/educacion" "$ROOT/media/temp"
podman unshare chown -R 1000:1000 "$ROOT/media"
cp "$ROOT/shared/quadlet-next/"* "$HOME/.config/containers/systemd/"
systemctl --user daemon-reload
systemctl --user start qc-postgres.service
for attempt in {1..30}; do
 # The first initialization starts a socket-only temporary server. Wait for TCP.
 if podman exec qc-postgres pg_isready -h qc-postgres -U postgres; then break; fi
 [[ "$attempt" != 30 ]] || exit 1
 sleep 2
done
fresh=$(podman exec qc-postgres psql -XAt -v ON_ERROR_STOP=1 -U postgres -d qc_demo -c "SELECT to_regclass('public.qc_demo_paciente') IS NULL")
if [[ "$fresh" == t ]]; then
 [[ "$(python3 "$SCRIPTS/environment.py" "$ENV" --get INITIALIZE_SYNTHETIC_DATABASE)" == true ]] || { echo 'Explicit first synthetic initialization required' >&2; exit 1; }
fi
podman run --rm --pull=never --network qc-net --env-file "$ROOT/shared/env/clinical.env" "$SIMULATOR_IMAGE" node apps/simulator/dist/migrate.js
podman run --rm --pull=never --network qc-net --env-file "$ROOT/shared/env/gateway.env" "$GATEWAY_IMAGE" node apps/gateway/dist/migrate.js
if [[ "$fresh" == t ]]; then podman run --rm --pull=never --network qc-net --env-file "$ROOT/shared/env/clinical.env" "$SIMULATOR_IMAGE" node apps/simulator/dist/seed.js; fi
podman run --rm --pull=never --network qc-net --env-file "$ROOT/shared/env/clinical.env" "$SIMULATOR_IMAGE" node apps/simulator/dist/provision-evaluation.js
podman exec -i qc-postgres psql -v ON_ERROR_STOP=1 -U postgres -d qc_demo < "$RELEASE/infra/universidad/postgres/02-setup-replication.sql"
# Verify references before serving files. Run the host script inside the already-built Node image.
podman run --rm --pull=never --network qc-net --env-file "$ROOT/shared/env/clinical.env" --volume "$ROOT/media:/var/lib/quimiocare:ro,Z" "$SIMULATOR_IMAGE" node apps/simulator/scripts/verify-education.mjs
# The release verifier is also exercised in disposable CI. Never delete or rebuild active sync storage here.
systemctl --user start qc-ai.service qc-clinical.service qc-gateway.service qc-worker.service qc-powersync.service
systemctl --user restart qc-proxy-backend.service qc-proxy-simulator.service
PUBLIC_ORIGIN=$(python3 "$SCRIPTS/environment.py" "$ENV" --get PUBLIC_ORIGIN) bash "$SCRIPTS/smoke.sh"
python3 - "$ROOT/shared/successful-deployment.json" "$SEQUENCE" "$REVISION" "$RELEASE_ID" <<'PY'
import json,sys
from pathlib import Path
path=Path(sys.argv[1]); tmp=path.with_suffix(".next")
tmp.write_text(json.dumps(dict(sequence=int(sys.argv[2]),revision=sys.argv[3],release_id=sys.argv[4]))+"\n")
tmp.replace(path)
PY
echo "Deployment healthy: $REVISION. Phone acceptance remains with the user."
