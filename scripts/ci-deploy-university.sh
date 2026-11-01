#!/usr/bin/env bash
# GitHub-hosted runner only. Not called during local preparation.
set -euo pipefail
umask 077
[[ "$(printenv GITHUB_REF)" == refs/heads/main && "$(printenv GITHUB_EVENT_NAME)" == push ]] || { echo 'Main push required' >&2; exit 1; }
for name in SSH_HOST SSH_USER SSH_PORT SSH_KEY SSH_KNOWN_HOSTS REGISTRY_TOKEN REGISTRY_USER; do
 [[ -n "$(printenv "$name")" ]] || { echo "Configure Environment universidad secret: $name" >&2; exit 1; }
done
[[ "$SSH_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && "$SSH_USER" =~ ^[a-z_][a-z0-9_-]*$ && "$SSH_PORT" =~ ^[0-9]{1,5}$ && "$REGISTRY_USER" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
(( SSH_PORT >= 1 && SSH_PORT <= 65535 )) || exit 1
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ && "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || exit 1
release_id="$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
temp=$(mktemp -d)
printf '%s\n' "$SSH_KEY" > "$temp/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$temp/known_hosts"
chmod 600 "$temp/key" "$temp/known_hosts"
target="$SSH_USER@$SSH_HOST"
# These variables expand on the REMOTE host, not on the GitHub runner.
# shellcheck disable=SC2016
remote_setup='export PATH="$HOME/.local/bin:$PATH"; export XDG_RUNTIME_DIR="/run/user/$(id -u)"; export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus";'
opts=(-i "$temp/key" -o "UserKnownHostsFile=$temp/known_hosts" -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
cleanup() {
 # No database, media, environment or volume deletion. Only this run's ephemeral registry credential.
 ssh "${opts[@]}" -p "$SSH_PORT" "$target" "rm -f \"\$HOME/quimiocare/releases/$release_id/registry-auth.json\"" || true
 rm -f "$temp/key" "$temp/known_hosts"
 rmdir "$temp"
}
trap cleanup EXIT
ssh "${opts[@]}" -p "$SSH_PORT" "$target" "set -eu; $remote_setup python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else \"Python 3.10+ required in deployment PATH\")'; umask 077; mkdir -p \"\$HOME/quimiocare/releases/$release_id\"; test -f \"\$HOME/quimiocare/shared/universidad.env\""
scp "${opts[@]}" -P "$SSH_PORT" build/universidad-release.tar.gz "$target:quimiocare/releases/$release_id/bundle.tar.gz"
# The ephemeral GITHUB_TOKEN has package read access for this repository; no registry PAT is stored in dotenv.
printf '%s' "$REGISTRY_TOKEN" | ssh "${opts[@]}" -p "$SSH_PORT" "$target" "$remote_setup podman login ghcr.io --authfile \"\$HOME/quimiocare/releases/$release_id/registry-auth.json\" --username '$REGISTRY_USER' --password-stdin >/dev/null"
ssh "${opts[@]}" -p "$SSH_PORT" "$target" "set -eu; $remote_setup cd \"\$HOME/quimiocare/releases/$release_id\"; tar -xzf bundle.tar.gz; sha256sum --strict -c SHA256SUMS; export REGISTRY_AUTH_FILE=\"\$PWD/registry-auth.json\"; QC_INSTALL_AUTHORIZED=yes bash infra/universidad/scripts/deploy.sh \"\$PWD\""
