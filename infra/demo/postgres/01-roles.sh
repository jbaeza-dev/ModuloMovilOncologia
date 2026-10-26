#!/usr/bin/env bash
set -euo pipefail

# El entrypoint oficial lo ejecuta únicamente al inicializar un volumen vacío.
psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set simulator_password="$DEMO_DATABASE_PASSWORD" \
  --set replica_password="$DEMO_REPLICA_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE qc_simulator LOGIN PASSWORD %L', :'simulator_password') \gexec
SELECT format('CREATE ROLE qc_replica REPLICATION LOGIN PASSWORD %L', :'replica_password') \gexec
GRANT CONNECT, CREATE ON DATABASE qc_demo TO qc_simulator;
GRANT USAGE, CREATE ON SCHEMA public TO qc_simulator;
GRANT CONNECT ON DATABASE qc_demo TO qc_replica;
GRANT USAGE ON SCHEMA public TO qc_replica;
SQL
