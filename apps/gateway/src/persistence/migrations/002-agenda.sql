-- P06 activates agenda, completion, receipt and dispatch operations. No automatic purge of tombstones/idempotency keys.
CREATE TABLE gw_agenda (owner_id uuid PRIMARY KEY, version bigint NOT NULL DEFAULT 0 CHECK(version>=0));
CREATE TABLE gw_reminder (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES gw_agenda(owner_id),
 kind text NOT NULL CHECK(kind IN ('epro','signos','medicacion')), title varchar(80) NOT NULL CHECK(length(title)>0),
 timezone text NOT NULL CHECK(timezone='America/Santiago'), hours time[] NOT NULL,
 weekdays smallint[] NOT NULL, starts_on date NOT NULL, ends_on date,
 active boolean NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 create_hash char(64) NOT NULL CHECK(create_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 CHECK(cardinality(hours) BETWEEN 1 AND 8), CHECK(cardinality(weekdays) BETWEEN 1 AND 7),
 CHECK(weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]), CHECK(ends_on IS NULL OR ends_on>=starts_on),
 UNIQUE(owner_id,id)
);
CREATE INDEX gw_reminder_owner ON gw_reminder(owner_id) WHERE deleted_at IS NULL;
CREATE TABLE gw_completion_event (
 operation_id uuid PRIMARY KEY, owner_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('epro','signos')),
 local_date date NOT NULL, timezone text NOT NULL CHECK(timezone='America/Santiago'), registered_at timestamptz NOT NULL,
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'), received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gw_daily_state (
 owner_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('epro','signos')), local_date date NOT NULL,
 timezone text NOT NULL CHECK(timezone='America/Santiago'), completed_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,kind,local_date,timezone)
);
CREATE TABLE gw_dispatch (
 occurrence_id varchar(200) NOT NULL, session_id uuid NOT NULL, owner_id uuid NOT NULL,
 reminder_id uuid NOT NULL, reminder_version integer NOT NULL CHECK(reminder_version>0),
 scheduled_at timestamptz NOT NULL, backup_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','sending','sent','retry','cancelled','expired','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz,
 provider_ticket varchar(256), last_error_code varchar(80), reserved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(occurrence_id,session_id), UNIQUE(owner_id,occurrence_id,session_id),
 FOREIGN KEY(owner_id,session_id) REFERENCES gw_device(owner_id,id),
 FOREIGN KEY(owner_id,reminder_id) REFERENCES gw_reminder(owner_id,id),
 CHECK(backup_at>=scheduled_at AND expires_at>=backup_at)
);
CREATE INDEX gw_dispatch_pending ON gw_dispatch(next_attempt_at) WHERE status IN ('reserved','retry');
CREATE TABLE gw_receipt (
 operation_id uuid PRIMARY KEY, owner_id uuid NOT NULL, occurrence_id varchar(200) NOT NULL,
 session_id uuid NOT NULL, event text NOT NULL CHECK(event IN ('push_procesado','respaldo_observado','abierto')),
 occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 FOREIGN KEY(owner_id,occurrence_id,session_id) REFERENCES gw_dispatch(owner_id,occurrence_id,session_id)
);
CREATE INDEX gw_completion_owner_date ON gw_completion_event(owner_id,local_date);
