#!/usr/bin/env bash
# Fail closed even for PowerSync connections opened before snapshot expiration.
set -euo pipefail
ROOT="$HOME/quimiocare"
# A long image download must never postpone expiry of existing streams.
exec 9>"$ROOT/shared/jwks.lock"
flock -w 85 9 || { echo 'JWKS maintenance exceeded its deadline' >&2; exit 1; }
if python3 - "$ROOT" <<'PY'
import json,sys,time
from pathlib import Path
root=Path(sys.argv[1])
try:
    value=json.loads((root/'shared/auth/snapshot.json').read_text())
    now=int(time.time()*1000)
    fresh=value['schema']==1 and value['fetchedAt']<=now+30000 and value['expiresAt']==value['fetchedAt']+43200000 and now<value['expiresAt']
except (OSError,ValueError,KeyError,TypeError): fresh=False
raise SystemExit(0 if fresh else 1)
PY
then exit 0; fi
if systemctl --user is-active --quiet qc-powersync.service; then
 touch "$ROOT/shared/auth/resume-sync"
 timeout 60s systemctl --user stop qc-powersync.service qc-proxy-backend.service
 echo 'JWKS expired: sync stopped; a validated renewal is required.' >&2
fi
