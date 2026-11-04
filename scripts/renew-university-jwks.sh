#!/usr/bin/env bash
set -euo pipefail
[[ "${GITHUB_REF:-}" == refs/heads/main ]] || { echo 'Trusted main only' >&2; exit 1; }
[[ "${GITHUB_EVENT_NAME:-}" == schedule || "${GITHUB_EVENT_NAME:-}" == workflow_dispatch ]] || exit 1
[[ "$#" == 1 ]] || exit 1
export PATH="$HOME/.local/bin:$PATH"
XDG_RUNTIME_DIR="/run/user/$(id -u)"
export XDG_RUNTIME_DIR
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
ROOT="$HOME/quimiocare"
exec 9>"$ROOT/deploy.lock"
flock -w 30 9 || { echo 'Deployment busy; snapshot not applied' >&2; exit 1; }
SCRIPTS="$ROOT/current/infra/universidad/scripts"
[[ -f "$SCRIPTS/install-jwks.sh" ]] || { echo 'Distributed JWKS release not deployed' >&2; exit 1; }
mode=$(python3 "$SCRIPTS/environment.py" "$ROOT/shared/universidad.env" --get AUTH_JWKS_MODE)
[[ "$mode" == distributed ]] || { echo 'Direct mode: renewal skipped'; exit 0; }
namespace=$(python3 "$SCRIPTS/environment.py" "$ROOT/shared/universidad.env" --get IMAGE_NAMESPACE)
image=$(python3 "$SCRIPTS/release.py" "$ROOT/current" --namespace "$namespace" --get simulator)
bash "$SCRIPTS/install-jwks.sh" "$1" "$image"
podman exec qc-jwks node -e "fetch('http://localhost:3004/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
echo 'Validated JWKS renewed without deploying application code.'
