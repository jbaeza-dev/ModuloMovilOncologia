#!/usr/bin/env bash
set -euo pipefail
test "${APP_ENV:-}" = demo || { echo 'Configuración limitada al origen demo.' >&2; exit 1; }
psql --set ON_ERROR_STOP=1 --file /bootstrap/02-replication.sql
