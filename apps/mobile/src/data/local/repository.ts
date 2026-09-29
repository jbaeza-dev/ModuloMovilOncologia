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

export type PatientProfileRecord = {
  paciente_id: string;
  nombre: string;
  email: string | null;
  rut: string | null;
  telefono: string | null;
  fecha_nacimiento: string | null;
  ciudad: string | null;
  activo: number;
  obtenido_en: string;
};

export type TreatmentRecord = {
  id: string;
  paciente_id: string;
  tipo: string;
  estado: string;
  nombre: string;
  equipo_tratante: string | null;
  ciclo_actual: number | null;
  total_ciclos: number | null;
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
          paciente_id, nombre, email, rut, telefono, fecha_nacimiento, ciudad, activo, obtenido_en
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(paciente_id) DO UPDATE SET
          nombre = excluded.nombre,
          email = excluded.email,
          rut = excluded.rut,
          telefono = excluded.telefono,
          fecha_nacimiento = excluded.fecha_nacimiento,
          ciudad = excluded.ciudad,
          activo = excluded.activo,
          obtenido_en = excluded.obtenido_en`,
        [
          patientId,
          data.nombre,
          data.email,
          data.rut,
          data.telefono,
          data.fecha_nacimiento,
          data.ciudad,
          data.activo,
          timestamp,
        ],
      );
    },

    treatment() {
      return database.first<TreatmentRecord>(
        'SELECT * FROM tratamiento_cache WHERE paciente_id = ? ORDER BY obtenido_en DESC LIMIT 1',
        [patientId],
      );
    },

    linkCode() {
      return database.first<LinkCodeRecord>(
        'SELECT * FROM codigo_vinculacion_cache WHERE paciente_id = ?',
        [patientId],
      );
    },

    async generateOrRefreshLinkCode(): Promise<LinkCodeRecord> {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let randomCode = '';
      for (let i = 0; i < 6; i++) {
        randomCode += chars[Math.floor(Math.random() * chars.length)];
      }
      const formattedCode = `${randomCode.slice(0, 3)} ${randomCode.slice(3)}`;
      const timestamp = now();
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      await database.run(
        `INSERT INTO codigo_vinculacion_cache (
          paciente_id, codigo, expira_en, estado_conocido, obtenido_en
        ) VALUES (?, ?, ?, 'pendiente', ?)
        ON CONFLICT(paciente_id) DO UPDATE SET
          codigo = excluded.codigo,
          expira_en = excluded.expira_en,
          estado_conocido = 'pendiente',
          obtenido_en = excluded.obtenido_en`,
        [patientId, formattedCode, expiresAt, timestamp],
      );
      return {
        paciente_id: patientId,
        codigo: formattedCode,
        expira_en: expiresAt,
        estado_conocido: 'pendiente',
        obtenido_en: timestamp,
      };
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
  };
}

export async function seedPatientContextIfEmpty(
  database: SqlConnection,
  patientAId: string,
  patientBId: string,
  now: Clock = () => new Date().toISOString(),
) {
  const existing = await database.first<{ total: number }>(
    'SELECT count(*) as total FROM paciente_cache',
  );
  if ((existing?.total ?? 0) > 0) return;

  const timestamp = now();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await database.transaction(async (tx) => {
    // Paciente A: Esquema FOLFOX (Cáncer Colorrectal)
    await tx.run(
      `INSERT INTO paciente_cache (
        paciente_id, nombre, email, rut, telefono, fecha_nacimiento, ciudad, activo, obtenido_en
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        patientAId,
        'Carlos Morales Valenzuela',
        'carlos.morales@quimiocare.test',
        '12.345.678-9',
        '+56 9 8765 4321',
        '1968-04-12',
        'Santiago',
        1,
        timestamp,
      ],
    );
    await tx.run(
      `INSERT INTO tratamiento_cache (
        id, paciente_id, tipo, estado, nombre, equipo_tratante, ciclo_actual, total_ciclos,
        parametros_json, fecha_inicio, fecha_termino, obtenido_en
      ) VALUES (?, ?, 'quimioterapia', 'activo', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'treat-patient-a',
        patientAId,
        'Esquema FOLFOX-6 modificado (Cáncer Colorrectal)',
        'Unidad Oncológica Hospital Clínico',
        3,
        12,
        JSON.stringify({
          drogas: ['Oxaliplatino', 'Leucovorina', '5-Fluorouracilo'],
          frecuencia: 'Cada 14 días',
          observaciones: 'Monitoreo de neuropatía periférica y hemograma pre-ciclo.',
        }),
        '2026-08-10',
        '2027-02-10',
        timestamp,
      ],
    );
    await tx.run(
      `INSERT INTO codigo_vinculacion_cache (
        paciente_id, codigo, expira_en, estado_conocido, obtenido_en
      ) VALUES (?, 'QCA 742', ?, 'pendiente', ?)`,
      [patientAId, expiresAt, timestamp],
    );

    // Paciente B: Esquema AC-T (Cáncer de Mama)
    await tx.run(
      `INSERT INTO paciente_cache (
        paciente_id, nombre, email, rut, telefono, fecha_nacimiento, ciudad, activo, obtenido_en
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        patientBId,
        'María Paz Sanhueza',
        'maria.sanhueza@quimiocare.test',
        '15.876.543-2',
        '+56 9 7654 3210',
        '1982-11-25',
        'Valparaíso',
        1,
        timestamp,
      ],
    );
    await tx.run(
      `INSERT INTO tratamiento_cache (
        id, paciente_id, tipo, estado, nombre, equipo_tratante, ciclo_actual, total_ciclos,
        parametros_json, fecha_inicio, fecha_termino, obtenido_en
      ) VALUES (?, ?, 'quimioterapia', 'activo', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'treat-patient-b',
        patientBId,
        'Esquema AC-T Dosis Densa (Cáncer de Mama)',
        'Centro Oncológico Regional',
        2,
        8,
        JSON.stringify({
          drogas: ['Doxorrubicina', 'Ciclofosfamida', 'Paclitaxel'],
          frecuencia: 'Cada 21 días',
          observaciones: 'Evaluación cardiológica basal y profilaxis con filgrastim.',
        }),
        '2026-09-01',
        '2027-03-15',
        timestamp,
      ],
    );
    await tx.run(
      `INSERT INTO codigo_vinculacion_cache (
        paciente_id, codigo, expira_en, estado_conocido, obtenido_en
      ) VALUES (?, 'QCB 918', ?, 'pendiente', ?)`,
      [patientBId, expiresAt, timestamp],
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
