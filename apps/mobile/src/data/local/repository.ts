import type { SqlConnection } from './sql';
import { type VitalValues } from './validation';

export type VitalRecord = VitalValues & {
  id: string;
  paciente_id: string;
  fecha_registro: string;
  fecha_subida: string | null;
};
export type SymptomRecord = {
  id: string;
  paciente_id: string;
  fecha_registro: string;
  descripcion: string;
  fecha_subida: string | null;
};

export type IdFactory = () => string;
export type Clock = () => string;

export function createPatientRepository(
  database: SqlConnection,
  patientId: string,
  newId: IdFactory,
  now: Clock = () => new Date().toISOString(),
) {
  if (!patientId) throw new Error('Selecciona un paciente de prueba.');

  return {
    async createVitals(values: VitalValues): Promise<string> {
      const id = newId();
      const queueId = newId();
      const timestamp = now();
      await database.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO signos_vitales (
            id, paciente_id, fecha_registro, presion_sistolica, presion_diastolica,
            pulso, temperatura, saturacion_o2, creado_localmente_en
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            patientId,
            timestamp,
            values.presion_sistolica,
            values.presion_diastolica,
            values.pulso,
            values.temperatura,
            values.saturacion_o2,
            timestamp,
          ],
        );
        await tx.run(
          `INSERT INTO cola_envio (
            id, paciente_id, tipo_entidad, registro_id, payload_json,
            estado, creado_en, actualizado_en
          ) VALUES (?, ?, 'signos_vitales', ?, ?, 'pendiente', ?, ?)`,
          [
            queueId,
            patientId,
            id,
            JSON.stringify({
              schemaVersion: 1,
              entity: 'signos_vitales',
              record: {
                id,
                paciente_id: patientId,
                fecha_registro: timestamp,
                ...values,
              },
            }),
            timestamp,
            timestamp,
          ],
        );
      });
      return id;
    },

    async createSymptom(description: string): Promise<string> {
      const id = newId();
      const queueId = newId();
      const timestamp = now();
      await database.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO sintomas (
            id, paciente_id, fecha_registro, descripcion, creado_localmente_en
          ) VALUES (?, ?, ?, ?, ?)`,
          [id, patientId, timestamp, description, timestamp],
        );
        await tx.run(
          `INSERT INTO cola_envio (
            id, paciente_id, tipo_entidad, registro_id, payload_json,
            estado, creado_en, actualizado_en
          ) VALUES (?, ?, 'sintomas', ?, ?, 'pendiente', ?, ?)`,
          [
            queueId,
            patientId,
            id,
            JSON.stringify({
              schemaVersion: 1,
              entity: 'sintomas',
              record: {
                id,
                paciente_id: patientId,
                fecha_registro: timestamp,
                descripcion: description,
              },
            }),
            timestamp,
            timestamp,
          ],
        );
      });
      return id;
    },

    latestVital() {
      return database.first<VitalRecord>(
        `SELECT * FROM signos_vitales WHERE paciente_id = ?
         ORDER BY fecha_registro DESC, id DESC LIMIT 1`,
        [patientId],
      );
    },

    vital(id: string) {
      return database.first<VitalRecord>(
        'SELECT * FROM signos_vitales WHERE paciente_id = ? AND id = ?',
        [patientId, id],
      );
    },

    vitals(since: string, limit = 30, offset = 0) {
      return database.all<VitalRecord>(
        `SELECT * FROM signos_vitales
         WHERE paciente_id = ? AND fecha_registro >= ?
         ORDER BY fecha_registro DESC, id DESC LIMIT ? OFFSET ?`,
        [patientId, since, limit, offset],
      );
    },

    symptoms(limit = 30, offset = 0) {
      return database.all<SymptomRecord>(
        `SELECT * FROM sintomas WHERE paciente_id = ?
         ORDER BY fecha_registro DESC, id DESC LIMIT ? OFFSET ?`,
        [patientId, limit, offset],
      );
    },

    async pendingCount() {
      const row = await database.first<{ total: number }>(
        "SELECT count(*) AS total FROM cola_envio WHERE paciente_id = ? AND estado = 'pendiente'",
        [patientId],
      );
      return row?.total ?? 0;
    },
  };
}

export function sinceDays(days: 7 | 30 | 90, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatVital(value: number | null, unit: string): string {
  return value === null ? 'Sin registro' : `${value.toLocaleString('es-CL')} ${unit}`;
}
