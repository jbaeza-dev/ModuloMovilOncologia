-- Additive own operational association; no patient names, doses or clinical write proxy.
ALTER TABLE gw_reminder ADD COLUMN patient_medication_id uuid;
ALTER TABLE gw_reminder ADD CONSTRAINT gw_reminder_medication_binding CHECK(patient_medication_id IS NULL OR kind='medicacion');
CREATE INDEX gw_reminder_patient_medication ON gw_reminder(owner_id,patient_medication_id) WHERE deleted_at IS NULL AND patient_medication_id IS NOT NULL;
