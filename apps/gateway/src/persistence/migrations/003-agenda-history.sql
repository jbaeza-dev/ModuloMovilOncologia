-- Preserve confirmed versions to validate late local-backup receipts without inventing a remote dispatch.
UPDATE gw_agenda SET version=1 WHERE version=0;
CREATE TABLE gw_reminder_revision (
 owner_id uuid NOT NULL, reminder_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 configuration jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,reminder_id,version),
 FOREIGN KEY(owner_id,reminder_id) REFERENCES gw_reminder(owner_id,id)
);
INSERT INTO gw_reminder_revision(owner_id,reminder_id,version,configuration)
SELECT r.owner_id,r.id,r.version,jsonb_build_object(
 'tipo',r.kind,'titulo',r.title,'zona_horaria',r.timezone,
 'horas',(SELECT jsonb_agg(left(h::text,5) ORDER BY h) FROM unnest(r.hours) h),
 'dias_semana',to_jsonb(r.weekdays),'fecha_inicio',r.starts_on::text,'fecha_fin',r.ends_on::text,'activo',r.active)
FROM gw_reminder r;
ALTER TABLE gw_receipt ADD COLUMN reminder_id uuid;
ALTER TABLE gw_receipt ADD COLUMN reminder_version integer;
UPDATE gw_receipt r SET reminder_id=d.reminder_id,reminder_version=d.reminder_version
FROM gw_dispatch d WHERE r.owner_id=d.owner_id AND r.occurrence_id=d.occurrence_id AND r.session_id=d.session_id;
ALTER TABLE gw_receipt ALTER COLUMN reminder_id SET NOT NULL;
ALTER TABLE gw_receipt ALTER COLUMN reminder_version SET NOT NULL;
ALTER TABLE gw_receipt DROP CONSTRAINT gw_receipt_owner_id_occurrence_id_session_id_fkey;
ALTER TABLE gw_receipt ADD CONSTRAINT gw_receipt_session_owner FOREIGN KEY(owner_id,session_id) REFERENCES gw_device(owner_id,id);
ALTER TABLE gw_receipt ADD CONSTRAINT gw_receipt_known_revision FOREIGN KEY(owner_id,reminder_id,reminder_version)
 REFERENCES gw_reminder_revision(owner_id,reminder_id,version);
ALTER TABLE gw_dispatch ADD COLUMN lease_id uuid;
ALTER TABLE gw_dispatch ADD COLUMN lease_until timestamptz;
ALTER TABLE gw_dispatch ADD COLUMN receipt_status text CHECK(receipt_status IN ('pending','ok','error','unknown'));
ALTER TABLE gw_dispatch ADD COLUMN receipt_checked_at timestamptz;
