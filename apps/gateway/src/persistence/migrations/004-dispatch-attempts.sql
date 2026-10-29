-- Operational audit only: never store push tokens, JWTs, chat or clinical values here.
CREATE TABLE gw_dispatch_attempt (
 id uuid PRIMARY KEY, occurrence_id varchar(200) NOT NULL, session_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 3), device_version integer NOT NULL,
 state text NOT NULL CHECK(state IN ('started','accepted','temporary','permanent','uncertain','cancelled')),
 ticket varchar(256), error_code varchar(80), started_at timestamptz NOT NULL, finished_at timestamptz,
 receipt_status text CHECK(receipt_status IN ('pending','ok','error','unknown')),
 receipt_checked_at timestamptz,
 UNIQUE(occurrence_id,session_id,ordinal),
 FOREIGN KEY(occurrence_id,session_id) REFERENCES gw_dispatch(occurrence_id,session_id)
);
CREATE INDEX gw_dispatch_receipt_pending ON gw_dispatch_attempt(started_at) WHERE receipt_status='pending';
