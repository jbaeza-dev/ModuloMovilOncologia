#!/usr/bin/env bash
# Generate services without starting containers or needing a running user systemd.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
temp=$(mktemp -d)
trap 'rm -f "$temp/"*; rmdir "$temp"' EXIT
for file in "$root/infra/universidad/quadlet/"*; do
 sed -e 's|@@SIMULATOR_IMAGE@@|ghcr.io/test/quimiocare-simulator@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|g' \
     -e 's|@@GATEWAY_IMAGE@@|ghcr.io/test/quimiocare-gateway@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|g' "$file" > "$temp/$(basename "$file")"
done
generator=
for candidate in /usr/libexec/podman/quadlet /usr/lib/podman/quadlet /usr/lib/systemd/system-generators/podman-system-generator; do
 if [[ -x "$candidate" ]]; then generator=$candidate; break; fi
done
[[ -n "$generator" ]] || { echo 'Install a Podman distribution with Quadlet support' >&2; exit 1; }
QUADLET_UNIT_DIRS="$temp" "$generator" --dryrun --user > "$temp/generated.txt" 2> "$temp/errors.txt"
if grep -Eiq 'unsupported|failed|error|unknown key' "$temp/errors.txt"; then cat "$temp/errors.txt" >&2; exit 1; fi
for file in "$root/infra/universidad/quadlet/"*.container; do
 name=$(basename "$file" .container)
 grep -q "$name.service" "$temp/generated.txt" || { echo "Generator omitted $name" >&2; exit 1; }
 grep -q 'MemoryMax=' "$file"
done
echo 'All Quadlet containers generated successfully; no services started.'
