import type { SqlConnection } from './sql';
import { type VitalValues } from './validation';

export type VitalRecord = VitalValues & {
  id: string;
  paciente_id: string;
  fecha_registro: string;
  fecha_subida: string | null;
};
export type QueueState =
  | 'pendiente'
  | 'enviando'
  | 'enviado'
  | 'error_reintentable'
  | 'requiere_sesion'
  | 'conflicto';

export type VitalWithSyncRecord = VitalRecord & {
  estado_envio: QueueState | null;
};

export type SymptomRecord = {
  id: string;
  paciente_id: string;
  fecha_registro: string;
  descripcion: string;
  fecha_subida: string | null;
};

export type SymptomWithSyncRecord = SymptomRecord & {
  estado_envio: QueueState | null;
};

export type DownloadRecord = {
  paciente_id: string;
  contenido_id: string;
  ruta_local: string | null;
  estado: 'pendiente' | 'descargando' | 'descargado' | 'error';
  fecha_descarga: string | null;
  visualizada: number;
  visualizada_en: string | null;
};

export type PatientProfileRecord = {
  paciente_id: string;
  nombre: string;
  email: string | null;
  rut: string | null;
  obtenido_en: string;
};

export type TreatmentRecord = {
  id: string;
  paciente_id: string;
  tipo: string;
  estado: string;
  nombre: string | null;
  parametros_json: string | null;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  obtenido_en: string;
};

export type LinkCodeRecord = {
  paciente_id: string;
  codigo: string;
  expira_en: string;
  estado_conocido: 'pendiente' | 'usado' | 'expirado';
  obtenido_en: string;
};

export type VitalsSummary = {
  total: number;
  avgTemperature: number | null;
  avgPulse: number | null;
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
      return database.first<VitalWithSyncRecord>(
        `SELECT v.*, c.estado AS estado_envio
         FROM signos_vitales AS v
         LEFT JOIN cola_envio AS c
           ON c.tipo_entidad = 'signos_vitales' AND c.registro_id = v.id
         WHERE v.paciente_id = ?
         ORDER BY v.fecha_registro DESC, v.id DESC LIMIT 1`,
        [patientId],
      );
    },

    vital(id: string) {
      return database.first<VitalWithSyncRecord>(
        `SELECT v.*, c.estado AS estado_envio
         FROM signos_vitales AS v
         LEFT JOIN cola_envio AS c
           ON c.tipo_entidad = 'signos_vitales' AND c.registro_id = v.id
         WHERE v.paciente_id = ? AND v.id = ?`,
        [patientId, id],
      );
    },

    vitals(since: string, limit = 30, offset = 0) {
      return database.all<VitalWithSyncRecord>(
        `SELECT v.*, c.estado AS estado_envio
         FROM signos_vitales AS v
         LEFT JOIN cola_envio AS c
           ON c.tipo_entidad = 'signos_vitales' AND c.registro_id = v.id
         WHERE v.paciente_id = ? AND v.fecha_registro >= ?
         ORDER BY v.fecha_registro DESC, v.id DESC LIMIT ? OFFSET ?`,
        [patientId, since, limit, offset],
      );
    },

    symptoms(limit = 30, offset = 0) {
      return database.all<SymptomWithSyncRecord>(
        `SELECT s.*, c.estado AS estado_envio
         FROM sintomas AS s
         LEFT JOIN cola_envio AS c
           ON c.tipo_entidad = 'sintomas' AND c.registro_id = s.id
         WHERE s.paciente_id = ?
         ORDER BY s.fecha_registro DESC, s.id DESC LIMIT ? OFFSET ?`,
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

    profile() {
      return database.first<PatientProfileRecord>(
        'SELECT * FROM paciente_cache WHERE paciente_id = ?',
        [patientId],
      );
    },

    async saveProfile(
      data: Omit<PatientProfileRecord, 'paciente_id' | 'obtenido_en'>,
    ): Promise<void> {
      const timestamp = now();
      await database.run(
        `INSERT INTO paciente_cache (
          paciente_id, nombre, email, rut, obtenido_en
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(paciente_id) DO UPDATE SET
          nombre = excluded.nombre,
          email = excluded.email,
          rut = excluded.rut,
          obtenido_en = excluded.obtenido_en`,
        [patientId, data.nombre, data.email, data.rut, timestamp],
      );
    },

    treatment() {
      return database.first<TreatmentRecord>(
        "SELECT * FROM tratamiento_cache WHERE paciente_id = ? AND estado = 'activo' ORDER BY obtenido_en DESC LIMIT 1",
        [patientId],
      );
    },

    linkCode() {
      return database.first<LinkCodeRecord>(
        'SELECT * FROM codigo_vinculacion_cache WHERE paciente_id = ?',
        [patientId],
      );
    },

    async saveLinkCode(data: {
      codigo: string;
      expira_en: string;
      estado_conocido?: 'pendiente' | 'usado' | 'expirado';
    }): Promise<void> {
      const canonicalCode = data.codigo.replace(/\s+/g, '').toUpperCase();
      const timestamp = now();
      await database.run(
        `INSERT INTO codigo_vinculacion_cache (
          paciente_id, codigo, expira_en, estado_conocido, obtenido_en
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(paciente_id) DO UPDATE SET
          codigo = excluded.codigo,
          expira_en = excluded.expira_en,
          estado_conocido = excluded.estado_conocido,
          obtenido_en = excluded.obtenido_en`,
        [patientId, canonicalCode, data.expira_en, data.estado_conocido ?? 'pendiente', timestamp],
      );
    },

    async vitalsSummary(sinceIso: string): Promise<VitalsSummary> {
      const row = await database.first<{
        total: number;
        avg_temp: number | null;
        avg_pulse: number | null;
      }>(
        `SELECT count(*) as total, avg(temperatura) as avg_temp, avg(pulso) as avg_pulse
         FROM signos_vitales
         WHERE paciente_id = ? AND fecha_registro >= ?`,
        [patientId, sinceIso],
      );
      return {
        total: row?.total ?? 0,
        avgTemperature: row?.avg_temp != null ? Math.round(row.avg_temp * 10) / 10 : null,
        avgPulse: row?.avg_pulse != null ? Math.round(row.avg_pulse) : null,
      };
    },

    download(contenidoId: string) {
      return database.first<DownloadRecord>(
        'SELECT * FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
        [patientId, contenidoId],
      );
    },

    downloads() {
      return database.all<DownloadRecord>(
        `SELECT * FROM descarga WHERE paciente_id = ?
         ORDER BY fecha_descarga DESC, contenido_id ASC`,
        [patientId],
      );
    },

    async saveDownload(data: {
      contenido_id: string;
      ruta_local: string;
      estado?: 'descargado';
    }): Promise<void> {
      const timestamp = now();
      await database.run(
        `INSERT INTO descarga (
          paciente_id, contenido_id, ruta_local, estado, fecha_descarga, visualizada, visualizada_en
        ) VALUES (?, ?, ?, ?, ?, 0, NULL)
        ON CONFLICT(paciente_id, contenido_id) DO UPDATE SET
          ruta_local = excluded.ruta_local,
          estado = excluded.estado,
          fecha_descarga = excluded.fecha_descarga`,
        [patientId, data.contenido_id, data.ruta_local, data.estado ?? 'descargado', timestamp],
      );
    },

    async markDownloadViewed(contenidoId: string): Promise<void> {
      const timestamp = now();
      await database.run(
        `UPDATE descarga
         SET visualizada = 1, visualizada_en = ?
         WHERE paciente_id = ? AND contenido_id = ?`,
        [timestamp, patientId, contenidoId],
      );
    },

    async removeDownload(contenidoId: string): Promise<void> {
      await database.run('DELETE FROM descarga WHERE paciente_id = ? AND contenido_id = ?', [
        patientId,
        contenidoId,
      ]);
    },
  };
}

export async function seedPatientContextIfEmpty(
  database: SqlConnection,
  patientAId: string,
  patientBId: string,
  now: Clock = () => new Date().toISOString(),
) {
  const timestamp = now();
  await database.transaction(async (tx) => {
    // Paciente A (demostración)
    await tx.run(
      `INSERT OR IGNORE INTO paciente_cache (
        paciente_id, nombre, email, rut, obtenido_en
      ) VALUES (?, ?, ?, ?, ?)`,
      [patientAId, 'Paciente A de Prueba', 'paciente.a@quimiocare.test', '12.345.678-9', timestamp],
    );
    await tx.run(
      `INSERT OR IGNORE INTO tratamiento_cache (
        id, paciente_id, tipo, estado, nombre, parametros_json, fecha_inicio, fecha_termino, obtenido_en
      ) VALUES (?, ?, 'quimioterapia', 'activo', ?, ?, ?, ?, ?)`,
      [
        'treat-demo-a',
        patientAId,
        'Tratamiento de quimioterapia (demostración)',
        JSON.stringify({
          ciclo_actual: 3,
          total_ciclos: 12,
          observaciones: 'Seguimiento de demostración sin evaluación clínica.',
        }),
        '2026-08-01',
        '2027-02-01',
        timestamp,
      ],
    );

    // Paciente B (demostración)
    await tx.run(
      `INSERT OR IGNORE INTO paciente_cache (
        paciente_id, nombre, email, rut, obtenido_en
      ) VALUES (?, ?, ?, ?, ?)`,
      [patientBId, 'Paciente B de Prueba', 'paciente.b@quimiocare.test', '15.876.543-2', timestamp],
    );
    await tx.run(
      `INSERT OR IGNORE INTO tratamiento_cache (
        id, paciente_id, tipo, estado, nombre, parametros_json, fecha_inicio, fecha_termino, obtenido_en
      ) VALUES (?, ?, 'quimioterapia', 'activo', ?, ?, ?, ?, ?)`,
      [
        'treat-demo-b',
        patientBId,
        'Tratamiento de quimioterapia (demostración)',
        JSON.stringify({
          ciclo_actual: 1,
          total_ciclos: 8,
          observaciones: 'Seguimiento de demostración sin evaluación clínica.',
        }),
        '2026-09-01',
        '2027-03-01',
        timestamp,
      ],
    );
  });
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

export function formatLinkCode(code: string): string {
  const clean = code.replace(/\s+/g, '').toUpperCase();
  if (clean.length === 6) {
    return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  }
  return clean;
}
