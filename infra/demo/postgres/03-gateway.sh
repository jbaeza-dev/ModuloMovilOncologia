#!/usr/bin/env bash
set -euo pipefail
psql --set ON_ERROR_STOP=1 --set gateway_password="$GATEWAY_DATABASE_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE qc_gateway LOGIN PASSWORD %L', :'gateway_password')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='qc_gateway') \gexec
SELECT 'CREATE DATABASE qc_gateway_demo OWNER qc_gateway'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='qc_gateway_demo') \gexec
REVOKE CONNECT ON DATABASE qc_gateway_demo FROM PUBLIC;
GRANT CONNECT ON DATABASE qc_gateway_demo TO qc_gateway;
SQL
