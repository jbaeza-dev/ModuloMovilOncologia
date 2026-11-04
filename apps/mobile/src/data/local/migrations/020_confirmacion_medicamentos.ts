export const MEDICATION_CONFIRMATIONS_SQL = `
ALTER TABLE qc_medication_intake_log ADD COLUMN avisos_confirmados_json TEXT
  CHECK(avisos_confirmados_json IS NULL OR json_valid(avisos_confirmados_json));
ALTER TABLE qc_medication_intake_events ADD COLUMN avisos_confirmados_json TEXT
  CHECK(avisos_confirmados_json IS NULL OR json_valid(avisos_confirmados_json));
`;
