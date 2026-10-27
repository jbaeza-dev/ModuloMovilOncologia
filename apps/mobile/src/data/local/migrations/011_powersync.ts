export const POWERSYNC_VERSION = 11;

// Older builds reject user_version > 10 instead of restarting the old queue.
export const POWERSYNC_SQL = `
CREATE TABLE qc_storage_control (
  id TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL
);
CREATE TABLE qc_clinical_command (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  environment TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('signos', 'epro')),
  captured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  legacy_queue_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'pausado', 'aceptado', 'rechazado')),
  ack_json TEXT,
  error_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'aceptado' OR ack_json IS NOT NULL),
  CHECK (status <> 'rechazado' OR error_json IS NOT NULL)
);
CREATE INDEX qc_clinical_owner_status ON qc_clinical_command(owner, status);
CREATE TRIGGER qc_command_snapshot_immutable
BEFORE UPDATE OF id, owner, environment, kind, captured_at, payload_json, legacy_queue_id
ON qc_clinical_command
BEGIN
  SELECT RAISE(ABORT, 'El comando clínico es inmutable.');
END;
CREATE TABLE qc_operational_event (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente'
);
CREATE TABLE qc_definition_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  snapshot_json TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  retired INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE qc_catalog_status (
  id TEXT PRIMARY KEY NOT NULL,
  completed_at TEXT,
  error_code TEXT
);
`;
