#!/usr/bin/env bash
set -euo pipefail
echo 'Automatic rollback/restore is disabled. Preserve volumes and logs.' >&2
echo 'Choose a verified previous release and review migration compatibility before reinstalling it.' >&2
exit 1
