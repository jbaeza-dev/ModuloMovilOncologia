export const ORIENTATION_SQL = `
CREATE TABLE qc_orientation_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  paciente_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  definition_version TEXT NOT NULL,
  definition_status TEXT NOT NULL CHECK(definition_status IN ('draft','approved')),
  mode TEXT NOT NULL CHECK(mode IN ('synthetic','clinical')),
  created_at TEXT NOT NULL,
  previous_id TEXT,
  snapshot_json TEXT NOT NULL
);
CREATE INDEX qc_orientation_owner_date
  ON qc_orientation_snapshot(paciente_id,environment,created_at DESC,id DESC);
CREATE TRIGGER qc_orientation_no_overwrite BEFORE UPDATE ON qc_orientation_snapshot
BEGIN SELECT RAISE(ABORT,'La evaluación original no se sobrescribe.'); END;
CREATE TABLE qc_palliative_plan_version (
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  paciente_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  content_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(id,version,paciente_id,environment)
);
CREATE TRIGGER qc_palliative_no_overwrite BEFORE UPDATE ON qc_palliative_plan_version
BEGIN SELECT RAISE(ABORT,'El plan original no se sobrescribe.'); END;
`;
