#!/usr/bin/env bash
# Recovery REHEARSAL only: new, explicitly named databases and a new media directory.
set -euo pipefail
umask 077
for name in BACKUP_DIR DATABASE_CONTAINER DATABASE_USER NEW_CLINICAL_DATABASE NEW_GATEWAY_DATABASE NEW_SYNC_DATABASE NEW_MEDIA_ROOT SIMULATOR_IMAGE DATABASE_NETWORK RESTORE_DATABASE_URL; do
 [[ -n "$(printenv "$name")" ]] || { echo "Missing $name" >&2; exit 1; }
done
ENGINE=$(printenv CONTAINER_ENGINE || printf podman)
[[ "$ENGINE" == podman || "$ENGINE" == docker ]] || exit 1
for target in "$NEW_CLINICAL_DATABASE" "$NEW_GATEWAY_DATABASE" "$NEW_SYNC_DATABASE"; do [[ "$target" =~ ^qc_[a-z0-9_]+_test$ ]] || { echo 'Disposable qc_*_test databases required' >&2; exit 1; }; done
[[ "$NEW_CLINICAL_DATABASE" != "$NEW_GATEWAY_DATABASE" && "$NEW_SYNC_DATABASE" != "$NEW_CLINICAL_DATABASE" && "$NEW_SYNC_DATABASE" != "$NEW_GATEWAY_DATABASE" ]] || exit 1
[[ "$NEW_MEDIA_ROOT" == /* && ! -e "$NEW_MEDIA_ROOT" && ! -L "$NEW_MEDIA_ROOT" ]] || { echo 'New absolute media directory required' >&2; exit 1; }
[[ -d "$BACKUP_DIR" && ! -L "$BACKUP_DIR" && -f "$BACKUP_DIR/checksums.sha256" && -d "$BACKUP_DIR/media/educacion" ]] || exit 1
[[ -z "$(find "$BACKUP_DIR" -type l -print -quit)" ]] || { echo 'Linked backup rejected' >&2; exit 1; }
grep -qx 'version=2' "$BACKUP_DIR/manifest.txt"
grep -qx 'mode=writers-stopped' "$BACKUP_DIR/manifest.txt"
(cd "$BACKUP_DIR"; sha256sum --strict -c checksums.sha256)
# URL must name the just-created destination, never a working database.
python3 - "$NEW_CLINICAL_DATABASE" <<'PY'
from urllib.parse import urlparse
import os, sys
if urlparse(os.environ['RESTORE_DATABASE_URL']).path != '/'+sys.argv[1]:
    raise SystemExit('Restore URL/database mismatch')
PY
# Check ALL targets before creating any. No DROP, fallback or working-service restart.
for target in "$NEW_CLINICAL_DATABASE" "$NEW_GATEWAY_DATABASE" "$NEW_SYNC_DATABASE"; do
 exists=$("$ENGINE" exec "$DATABASE_CONTAINER" psql -XAt -v ON_ERROR_STOP=1 -U "$DATABASE_USER" -d postgres -c "SELECT count(*) FROM pg_database WHERE datname='$target'")
 [[ "$exists" == 0 ]] || { echo 'Refusing an existing database' >&2; exit 1; }
done
for target in "$NEW_CLINICAL_DATABASE" "$NEW_GATEWAY_DATABASE" "$NEW_SYNC_DATABASE"; do "$ENGINE" exec "$DATABASE_CONTAINER" createdb -U "$DATABASE_USER" "$target"; done
"$ENGINE" exec -i "$DATABASE_CONTAINER" pg_restore -U "$DATABASE_USER" -d "$NEW_CLINICAL_DATABASE" --single-transaction --exit-on-error < "$BACKUP_DIR/source.dump"
"$ENGINE" exec -i "$DATABASE_CONTAINER" pg_restore -U "$DATABASE_USER" -d "$NEW_GATEWAY_DATABASE" --single-transaction --exit-on-error < "$BACKUP_DIR/gateway.dump"
mkdir "$NEW_MEDIA_ROOT"
cp -a --no-preserve=ownership "$BACKUP_DIR/media/educacion" "$NEW_MEDIA_ROOT/educacion"
if [[ "$ENGINE" == podman ]]; then
 podman unshare chown -R 1000:1000 "$NEW_MEDIA_ROOT"
fi
verify_user=()
if [[ "$ENGINE" == docker ]]; then verify_user=(--user "$(id -u):$(id -g)"); fi
"$ENGINE" run --rm --pull=never "${verify_user[@]}" --network "$DATABASE_NETWORK" \
 --env "DATABASE_URL=$RESTORE_DATABASE_URL" --env EDUCATION_MEDIA_ROOT=/restore/educacion \
 --volume "$NEW_MEDIA_ROOT:/restore:ro,Z" "$SIMULATOR_IMAGE" node apps/simulator/scripts/verify-education.mjs
echo 'Database dumps and referenced media verified. No working service was restarted.'
echo 'PowerSync storage is EMPTY: start a NEW isolated PowerSync instance and require initial_replication_done before testing it. Never clear active PowerSync.'
