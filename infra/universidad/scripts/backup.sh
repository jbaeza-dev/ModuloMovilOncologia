#!/usr/bin/env bash
set -euo pipefail
umask 077
for name in DATABASE_CONTAINER DATABASE_USER CLINICAL_DATABASE GATEWAY_DATABASE MEDIA_ROOT BACKUP_ROOT; do
 [[ -n "$(printenv "$name")" ]] || { echo "Missing $name" >&2; exit 1; }
done
ENGINE=$(printenv CONTAINER_ENGINE || printf podman)
RESUME=$(printenv RESUME_WRITERS || printf true)
[[ "$ENGINE" == podman || "$ENGINE" == docker ]] || exit 1
[[ "$RESUME" == true || "$RESUME" == false ]] || exit 1
[[ "$CLINICAL_DATABASE" =~ ^qc_[a-z0-9_]+$ && "$GATEWAY_DATABASE" =~ ^qc_[a-z0-9_]+$ ]] || exit 1
media_command=()
if [[ "$ENGINE" == podman ]]; then media_command=(podman unshare); fi
[[ ! -L "$MEDIA_ROOT" ]] || exit 1
"${media_command[@]}" test -d "$MEDIA_ROOT/educacion"
links=$("${media_command[@]}" find "$MEDIA_ROOT" -type l -print -quit)
[[ -z "$links" ]] || { echo 'Linked media rejected' >&2; exit 1; }
mkdir -p "$BACKUP_ROOT"
database_bytes=0
for database in "$CLINICAL_DATABASE" "$GATEWAY_DATABASE"; do
 bytes=$("$ENGINE" exec "$DATABASE_CONTAINER" psql -XAt -v ON_ERROR_STOP=1 -U "$DATABASE_USER" -d postgres -c "SELECT pg_database_size('$database')")
 [[ "$bytes" =~ ^[0-9]+$ ]] || { echo 'Cannot estimate backup capacity' >&2; exit 1; }
 database_bytes=$((database_bytes + bytes))
done
media_kb=$("${media_command[@]}" du -sk "$MEDIA_ROOT/educacion" | awk '{print $1}')
free_kb=$(df -Pk "$BACKUP_ROOT" | awk 'NR==2 {print $4}')
[[ "$media_kb" =~ ^[0-9]+$ && "$free_kb" =~ ^[0-9]+$ ]] || exit 1
required_kb=$(((database_bytes + 1023) / 1024 + media_kb + 1048576))
[[ "$free_kb" -ge "$required_kb" ]] || { echo 'Insufficient backup capacity including 1 GiB safety margin' >&2; exit 1; }
units=(qc-worker qc-gateway qc-clinical qc-ai)
was_active=()
finish() {
 status=$?
 trap - EXIT
 if [[ "$status" != 0 || "$RESUME" == true ]]; then
  for unit in "${was_active[@]}"; do systemctl --user start "$unit.service" || status=1; done
 fi
 exit "$status"
}
trap finish EXIT
for unit in "${units[@]}"; do
 if systemctl --user is-active --quiet "$unit.service"; then was_active+=("$unit"); fi
 timeout 45s systemctl --user stop "$unit.service"
 if systemctl --user is-active --quiet "$unit.service"; then echo "Writer not stopped: $unit" >&2; exit 1; fi
done
mkdir -p "$BACKUP_ROOT"
out="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir "$out"
"$ENGINE" exec "$DATABASE_CONTAINER" pg_dump -U "$DATABASE_USER" -Fc "$CLINICAL_DATABASE" > "$out/source.dump"
"$ENGINE" exec "$DATABASE_CONTAINER" pg_dump -U "$DATABASE_USER" -Fc "$GATEWAY_DATABASE" > "$out/gateway.dump"
mkdir "$out/media"
# Read rootless UID-mapped files in their user namespace. Backup copies belong to
# the host operator; restore assigns the application UID again in the NEW target.
"${media_command[@]}" cp -a --no-preserve=ownership "$MEDIA_ROOT/educacion" "$out/media/educacion"
if [[ -f "$HOME/quimiocare/current/manifest.json" ]]; then cp "$HOME/quimiocare/current/manifest.json" "$out/release.json"; fi
printf 'version=2\nsource=%s\ngateway=%s\nmode=writers-stopped\n' "$CLINICAL_DATABASE" "$GATEWAY_DATABASE" > "$out/manifest.txt"
# checksums.sha256 is explicitly excluded from its own input.
# shellcheck disable=SC2094
(cd "$out"; find . -type f ! -name checksums.sha256 -print0 | sort -z | xargs -0 sha256sum > checksums.sha256)
echo "Snapshot confirmed: $out"
