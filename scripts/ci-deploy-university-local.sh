#!/usr/bin/env bash
# Runs only on the dedicated Parra user runner; never opens a listening port.
set -euo pipefail
umask 077
[[ "${GITHUB_REF:-}" == refs/heads/main && "${GITHUB_EVENT_NAME:-}" == push && "${RUNNER_ENVIRONMENT:-}" == self-hosted ]] || { echo 'Main push on a self-hosted runner required' >&2; exit 1; }
[[ "$#" == 1 && -f "$1" ]] || { echo 'Explicit release archive required' >&2; exit 1; }
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ && "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] || exit 1
[[ "${RELEASE_ATTEMPT:-}" =~ ^[0-9]+$ ]] || { echo 'Packaged attempt required' >&2; exit 1; }
[[ -n "${REGISTRY_TOKEN:-}" && "${REGISTRY_USER:-}" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Ephemeral registry credentials required' >&2; exit 1; }
export PATH="$HOME/.local/bin:$PATH"
XDG_RUNTIME_DIR="/run/user/$(id -u)"
export XDG_RUNTIME_DIR
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else "Python 3.11+ required")'
systemctl --user show-environment >/dev/null
[[ "$(podman info --format '{{.Host.Security.Rootless}}')" == true ]] || { echo 'Rootless Podman required' >&2; exit 1; }
test -f "$HOME/quimiocare/shared/universidad.env"
release_id="$GITHUB_SHA-$GITHUB_RUN_ID-$RELEASE_ATTEMPT"
release="$HOME/quimiocare/releases/$release_id"
mkdir -p "$HOME/quimiocare/releases"
# Identical retries reuse immutable bytes; differing or partial releases fail closed.
python3 scripts/extract-university-release.py "$1" "$release" "$release_id"
(cd "$release" && sha256sum --strict -c SHA256SUMS)
credentials=$(mktemp -d "$XDG_RUNTIME_DIR/qc-registry.XXXXXX")
cleanup() {
 rm -f "$credentials/auth.json"
 rmdir "$credentials"
}
trap cleanup EXIT
export REGISTRY_AUTH_FILE="$credentials/auth.json"
printf '%s' "$REGISTRY_TOKEN" | podman login ghcr.io --authfile "$REGISTRY_AUTH_FILE" --username "$REGISTRY_USER" --password-stdin >/dev/null
unset REGISTRY_TOKEN
QC_INSTALL_AUTHORIZED=yes bash "$release/infra/universidad/scripts/deploy.sh" "$release"
