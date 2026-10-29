export const AGENDA_COMPARTIDA_VERSION = 13;
export const AGENDA_COMPARTIDA_SQL = `
ALTER TABLE qc_operational_event ADD COLUMN registered_at TEXT;
-- Historical captured_at is not proof of SAVE time. Preserve it; do not invent a backfill.
CREATE TABLE qc_gateway_outbox (
 id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, environment TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('completion','receipt')), body_json TEXT NOT NULL,
 created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','acked','conflict')),
 acked_at TEXT, error_code TEXT
);
CREATE INDEX qc_gateway_outbox_pending ON qc_gateway_outbox(owner,environment,status,created_at);
CREATE TRIGGER qc_gateway_event_immutable BEFORE UPDATE OF id,owner,environment,kind,body_json,created_at ON qc_gateway_outbox
BEGIN SELECT RAISE(ABORT,'El evento operativo es inmutable.'); END;
CREATE TABLE qc_agenda_state (
 owner TEXT NOT NULL, environment TEXT NOT NULL, version INTEGER NOT NULL, server_time TEXT NOT NULL,
 synchronized_at TEXT NOT NULL, PRIMARY KEY(owner,environment)
);
CREATE TABLE qc_agenda_rule (
 owner TEXT NOT NULL, environment TEXT NOT NULL, id TEXT NOT NULL, rule_json TEXT NOT NULL,
 PRIMARY KEY(owner,environment,id)
);
CREATE TABLE qc_agenda_daily (
 owner TEXT NOT NULL, environment TEXT NOT NULL, kind TEXT NOT NULL, local_date TEXT NOT NULL,
 PRIMARY KEY(owner,environment,kind,local_date)
);
CREATE TABLE qc_agenda_intent (
 owner TEXT NOT NULL, environment TEXT NOT NULL, id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('create','replace','delete')), body_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','conflict')), created_at TEXT NOT NULL,
 PRIMARY KEY(owner,environment,id)
);
CREATE TABLE qc_agenda_job (
 owner TEXT NOT NULL, environment TEXT NOT NULL, session_id TEXT NOT NULL, occurrence_id TEXT NOT NULL,
 payload_json TEXT NOT NULL, native_id TEXT NOT NULL, backup_at TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('planned','scheduled','processing','processed','observed','cancel_pending','cancelled','expired')),
 processed_at TEXT, claim_id TEXT, claim_until TEXT, PRIMARY KEY(owner,environment,session_id,occurrence_id)
);
CREATE TABLE qc_agenda_observation (
 owner TEXT NOT NULL, environment TEXT NOT NULL, session_id TEXT NOT NULL, occurrence_id TEXT NOT NULL,
 event TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE,
 PRIMARY KEY(owner,environment,session_id,occurrence_id,event)
);
CREATE TABLE qc_agenda_coverage (
 owner TEXT NOT NULL, environment TEXT NOT NULL, session_id TEXT NOT NULL, value_json TEXT NOT NULL,
 PRIMARY KEY(owner,environment,session_id)
);
`;
