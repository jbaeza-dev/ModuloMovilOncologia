#!/usr/bin/env bash
# PostgreSQL entrypoint: NEW volume only. No secret defaults and no password rotation.
set -euo pipefail
for name in POSTGRES_USER POSTGRES_DB QC_ADMIN_PASSWORD QC_REPLICA_PASSWORD QC_GATEWAY_PASSWORD QC_STORAGE_PASSWORD; do
 [[ -n "$(printenv "$name")" ]] || { echo "Missing $name" >&2; exit 1; }
done
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv admin_password QC_ADMIN_PASSWORD
\getenv replica_password QC_REPLICA_PASSWORD
\getenv gateway_password QC_GATEWAY_PASSWORD
\getenv storage_password QC_STORAGE_PASSWORD
SELECT format('CREATE ROLE qc_admin LOGIN PASSWORD %L', :'admin_password') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qc_admin') \gexec
SELECT format('CREATE ROLE qc_replica LOGIN REPLICATION PASSWORD %L', :'replica_password') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qc_replica') \gexec
SELECT format('CREATE ROLE qc_gateway LOGIN PASSWORD %L', :'gateway_password') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qc_gateway') \gexec
SELECT format('CREATE ROLE qc_storage LOGIN PASSWORD %L', :'storage_password') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qc_storage') \gexec
SELECT 'CREATE DATABASE qc_demo OWNER qc_admin' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='qc_demo') \gexec
SELECT 'CREATE DATABASE qc_gateway_demo OWNER qc_gateway' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='qc_gateway_demo') \gexec
SELECT 'CREATE DATABASE qc_powersync OWNER qc_storage' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='qc_powersync') \gexec
\connect qc_demo
GRANT CONNECT ON DATABASE qc_demo TO qc_admin,qc_replica;
GRANT USAGE,CREATE ON SCHEMA public TO qc_admin;
GRANT USAGE ON SCHEMA public TO qc_replica;
ALTER DEFAULT PRIVILEGES FOR ROLE qc_admin IN SCHEMA public GRANT SELECT ON TABLES TO qc_replica;
SELECT 'CREATE PUBLICATION powersync' WHERE NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='powersync') \gexec
\connect qc_gateway_demo
GRANT CONNECT ON DATABASE qc_gateway_demo TO qc_gateway;
GRANT USAGE,CREATE ON SCHEMA public TO qc_gateway;
\connect qc_powersync
GRANT CONNECT ON DATABASE qc_powersync TO qc_storage;
GRANT USAGE,CREATE ON SCHEMA public TO qc_storage;
SQL
echo 'Synthetic databases and least-privilege roles initialized.'
