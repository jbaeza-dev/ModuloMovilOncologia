#!/usr/bin/env bash
# Run after registering the runner as this same unprivileged user.
set -euo pipefail
runner="$HOME/actions-runner-quimiocare"
[[ -f "$runner/.runner" && -x "$runner/run.sh" ]] || { echo 'Register the runner first in ~/actions-runner-quimiocare' >&2; exit 1; }
systemctl --user show-environment >/dev/null
[[ "$(loginctl show-user "$(id -un)" -p Linger --value)" == yes ]] || { echo 'User lingering must be enabled by the administrator' >&2; exit 1; }
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/quimiocare-actions-runner.service" <<'EOF'
[Unit]
Description=GitHub Actions Runner de QuimioCare
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/actions-runner-quimiocare
ExecStart=%h/actions-runner-quimiocare/run.sh
Environment="PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin"
UMask=0077
StandardOutput=append:%h/actions-runner-quimiocare/service.log
StandardError=append:%h/actions-runner-quimiocare/service.log
Restart=always
RestartSec=15
TimeoutStopSec=120
KillSignal=SIGINT

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now quimiocare-actions-runner.service
systemctl --user is-active quimiocare-actions-runner.service
