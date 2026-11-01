#!/usr/bin/env bash
# Read-only host checks. No installation, sudo, deletion or credential output.
set -euo pipefail
for command in podman python3 systemctl loginctl curl sha256sum flock timeout tar; do command -v "$command" >/dev/null || { echo "Required command missing: $command" >&2; exit 1; }; done
[[ "$(id -u)" != 0 ]] || { echo 'Run as the rootless deployment user' >&2; exit 1; }
[[ "$(uname -m)" == x86_64 ]] || { echo 'Release currently targets linux/amd64' >&2; exit 1; }
podman info --format '{{.Host.Security.Rootless}}' | grep -qx true
podman info --format json | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["host"].get("cgroupVersion")=="v2" else 1)' || { echo 'Rootless resource limits require cgroups v2' >&2; exit 1; }
systemctl --user show-environment >/dev/null
loginctl show-user "$(id -un)" -p Linger --value | grep -qx yes
[[ -f "$HOME/quimiocare/shared/universidad.env" ]] || { echo 'Provision shared/universidad.env first' >&2; exit 1; }
[[ "$(stat -c '%a' "$HOME/quimiocare/shared/universidad.env")" == 600 ]] || { echo 'Canonical env must have mode 600' >&2; exit 1; }
free_kb=$(df -Pk "$HOME/quimiocare" | awk 'NR==2 {print $4}')
[[ "$free_kb" -ge 5242880 ]] || { echo 'Need at least 5 GiB free; export old backups to secure external storage' >&2; exit 1; }
ram_kb=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
[[ "$ram_kb" -ge 3600000 ]] || { echo 'Host RAM is below the expected 4 GB budget' >&2; exit 1; }
if ! podman container exists qc-proxy-simulator; then
 for port in 8018 8019; do
  if command -v ss >/dev/null && ss -H -ltn | awk '{print $4}' | grep -Eq ":$port$"; then echo "Port $port is already in use" >&2; exit 1; fi
 done
fi
echo 'Host preflight passed.'
