import type { SqlConnection } from './core/sql';
import { type VitalValues } from './validation';
import { createFormRepository } from './forms/form-repository';
import { seedMedicalFormsDemo } from './forms/form-seed';
import { createClinicalContextRepository } from './clinical-context/clinical-context-repository';
import { createConsentRepository } from './consents/consent-repository';
import { seedClinicalContextDemoInTransaction } from './clinical-context/clinical-context-seed';
import { createReportRepository } from './reports/report-repository';
import { createEducationRepository } from './education/education-repository';
import { createReminderRepository } from './reminders/reminder-repository';
export * from './clinical-context/clinical-context-types';
export * from './consents/consent-types';
export * from './reports/report-types';
export * from './education/education-types';
export * from './reminders/reminder-types';

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
  formato?: string;
  retirado_en?: string | null;
  ultimo_error_retiro?: string | null;
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

  const formRepo = createFormRepository(database, patientId, newId, now);
  const reportRepo = createReportRepository(database, patientId, now);

  return {
    ...formRepo,
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

    vitalsForReport(sinceIso: string, untilIso?: string) {
      return reportRepo.vitalsForReport(sinceIso, untilIso);
    },

    symptomsForReport(sinceIso: string, untilIso?: string) {
      return reportRepo.symptomsForReport(sinceIso, untilIso);
    },

    getReportData(periodDays: 7 | 30 | 90, customNow?: string) {
      return reportRepo.getReportData(periodDays, customNow);
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
      formato?: string;
    }): Promise<void> {
      const timestamp = now();
      const ext = data.ruta_local.split('.').pop()?.toLowerCase();
      const inferredFormato =
        data.formato ??
        (ext === 'jpeg' || ext === 'jpg' ? 'jpeg' : ext === 'md' ? 'markdown' : 'png');
      const isMarkdown = inferredFormato === 'markdown';
      const retiradoEn = isMarkdown ? timestamp : null;

      await database.run(
        `INSERT INTO descarga (
          paciente_id, contenido_id, ruta_local, estado, fecha_descarga, visualizada, visualizada_en,
          formato, tamano_bytes, retirado_en, ultimo_error_retiro
        ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, 0, ?, NULL)
        ON CONFLICT(paciente_id, contenido_id) DO UPDATE SET
          ruta_local = excluded.ruta_local,
          estado = excluded.estado,
          fecha_descarga = excluded.fecha_descarga,
          visualizada = 0,
          visualizada_en = NULL,
          formato = excluded.formato,
          retirado_en = excluded.retirado_en,
          ultimo_error_retiro = excluded.ultimo_error_retiro`,
        [
          patientId,
          data.contenido_id,
          data.ruta_local,
          data.estado ?? 'descargado',
          timestamp,
          inferredFormato,
          retiradoEn,
        ],
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

    async markDownloadUnavailable(contenidoId: string): Promise<void> {
      await database.run(
        `UPDATE descarga
         SET estado = 'error'
         WHERE paciente_id = ? AND contenido_id = ?`,
        [patientId, contenidoId],
      );
    },

    async removeDownload(contenidoId: string): Promise<void> {
      await database.run('DELETE FROM descarga WHERE paciente_id = ? AND contenido_id = ?', [
        patientId,
        contenidoId,
      ]);
    },

    ...createFormRepository(database, patientId, newId, now),
    ...createClinicalContextRepository(database, patientId),
    ...createConsentRepository(database, patientId, newId, now),
    reports: reportRepo,
    education: createEducationRepository(database, patientId, now),
    reminders: createReminderRepository(database, patientId, now, newId),
  };
}

export type PatientRepository = ReturnType<typeof createPatientRepository>;

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

    // Seed de cuestionarios médicos de demostración (si la migración 004 ya está aplicada)
    const hasForms = await tx.first<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'formulario_asignacion_cache'",
    );
    if (hasForms) {
      await seedMedicalFormsDemo(tx, patientAId, patientBId, now);
    }

    // Seed de contexto clínico y consentimientos (si la migración 005 ya está aplicada)
    const hasClinicalContext = await tx.first<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ficha_clinica_cache'",
    );
    if (hasClinicalContext) {
      await seedClinicalContextDemoInTransaction(tx, patientAId, patientBId, now);
    }

    // Seed de recordatorios y preferencias (si la migración 008 ya está aplicada)
    const hasReminders = await tx.first<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'preferencia_avisos'",
    );
    if (hasReminders) {
      // Iniciar con preferencias estrictamente deshabilitadas (habilitado = 0)
      await tx.run(
        `INSERT OR IGNORE INTO preferencia_avisos (paciente_id, habilitado, actualizado_el)
         VALUES (?, 0, ?)`,
        [patientAId, timestamp],
      );
      await tx.run(
        `INSERT OR IGNORE INTO preferencia_avisos (paciente_id, habilitado, actualizado_el)
         VALUES (?, 0, ?)`,
        [patientBId, timestamp],
      );

      // Regla de plantilla de ejemplo para Paciente A (estrictamente deshabilitada: habilitado = 0)
      await tx.run(
        `INSERT OR IGNORE INTO recordatorio_local (
           id, paciente_id, tipo, medicamento_id, dias_semana, horas_minutos, zona_horaria,
           fecha_inicio, fecha_fin, habilitado, revision, eliminado_el, creado_el, actualizado_el
         ) VALUES (?, ?, 'registro_vitales', NULL, '[1,2,3,4,5,6,7]', '["09:00"]', 'America/Santiago', NULL, NULL, 0, 1, NULL, ?, ?)`,
        ['rule-template-vitales-a', patientAId, timestamp, timestamp],
      );
    }
  });
}

export async function seedDemoVitalsAndSymptoms(
  database: SqlConnection,
  patientAId: string,
  patientBId: string,
): Promise<void> {
  await database.transaction(async (tx) => {
    const hasVitalsTable = await tx.first<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'signos_vitales'",
    );
    if (!hasVitalsTable) return;

    const existing = await tx.first<{ count: number }>(
      "SELECT COUNT(*) as count FROM signos_vitales WHERE id LIKE 'vital-a-%' OR id LIKE 'vital-b-%'",
    );
    if (existing && existing.count > 0) return;

    const nowMs = Date.now();
    const isoHoursAgo = (hours: number) => new Date(nowMs - hours * 3600 * 1000).toISOString();

    const vitalsA = [
      { id: 'vital-a-1', hours: 2, sis: 120, dia: 80, pulso: 72, temp: 36.6, sat: 98 },
      { id: 'vital-a-2', hours: 24, sis: 118, dia: 76, pulso: 75, temp: 36.8, sat: 98 },
      { id: 'vital-a-3', hours: 72, sis: 122, dia: 82, pulso: 80, temp: 37.1, sat: 97 },
      { id: 'vital-a-4', hours: 120, sis: 125, dia: 84, pulso: 78, temp: 36.7, sat: 99 },
      { id: 'vital-a-5', hours: 168, sis: 119, dia: 78, pulso: 70, temp: 36.5, sat: 98 },
      { id: 'vital-a-6', hours: 240, sis: 121, dia: 79, pulso: 74, temp: 36.6, sat: 98 },
      { id: 'vital-a-7', hours: 336, sis: 117, dia: 75, pulso: 72, temp: 36.4, sat: 99 },
      { id: 'vital-a-8', hours: 504, sis: 123, dia: 81, pulso: 76, temp: 36.7, sat: 98 },
    ];

    for (const v of vitalsA) {
      const regDate = isoHoursAgo(v.hours);
      await tx.run(
        `INSERT OR IGNORE INTO signos_vitales (
          id, paciente_id, fecha_registro, presion_sistolica, presion_diastolica,
          pulso, temperatura, saturacion_o2, creado_localmente_en
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.id, patientAId, regDate, v.sis, v.dia, v.pulso, v.temp, v.sat, regDate],
      );
    }

    const symptomsA = [
      {
        id: 'symp-a-1',
        hours: 4,
        desc: 'Náuseas leves después del desayuno, mejoraron con reposo y agua tibia.',
      },
      {
        id: 'symp-a-2',
        hours: 28,
        desc: 'Sensación de fatiga al caminar distancias medias. Descanso adecuado por 30 minutos.',
      },
      {
        id: 'symp-a-3',
        hours: 76,
        desc: 'Ligera molestia estomacal y poco apetito durante la tarde.',
      },
      {
        id: 'symp-a-4',
        hours: 124,
        desc: 'Hipersensibilidad al frío en las manos al lavar platos. Se usaron guantes de protección.',
      },
      {
        id: 'symp-a-5',
        hours: 172,
        desc: 'Dolor muscular leve en hombros y espalda. Buen descanso nocturno.',
      },
      {
        id: 'symp-a-6',
        hours: 244,
        desc: 'Buen estado de ánimo general, caminata ligera de 20 minutos sin molestias.',
      },
    ];

    for (const s of symptomsA) {
      const regDate = isoHoursAgo(s.hours);
      await tx.run(
        `INSERT OR IGNORE INTO sintomas (
          id, paciente_id, fecha_registro, descripcion, creado_localmente_en
        ) VALUES (?, ?, ?, ?, ?)`,
        [s.id, patientAId, regDate, s.desc, regDate],
      );
    }

    const vitalsB = [
      { id: 'vital-b-1', hours: 3, sis: 128, dia: 82, pulso: 68, temp: 36.5, sat: 99 },
      { id: 'vital-b-2', hours: 26, sis: 130, dia: 85, pulso: 72, temp: 36.7, sat: 98 },
      { id: 'vital-b-3', hours: 74, sis: 126, dia: 80, pulso: 70, temp: 36.6, sat: 98 },
      { id: 'vital-b-4', hours: 146, sis: 124, dia: 82, pulso: 74, temp: 36.8, sat: 97 },
      { id: 'vital-b-5', hours: 242, sis: 129, dia: 84, pulso: 69, temp: 36.5, sat: 99 },
      { id: 'vital-b-6', hours: 360, sis: 127, dia: 81, pulso: 71, temp: 36.6, sat: 98 },
    ];

    for (const v of vitalsB) {
      const regDate = isoHoursAgo(v.hours);
      await tx.run(
        `INSERT OR IGNORE INTO signos_vitales (
          id, paciente_id, fecha_registro, presion_sistolica, presion_diastolica,
          pulso, temperatura, saturacion_o2, creado_localmente_en
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.id, patientBId, regDate, v.sis, v.dia, v.pulso, v.temp, v.sat, regDate],
      );
    }

    const symptomsB = [
      {
        id: 'symp-b-1',
        hours: 5,
        desc: 'Cansancio matutino leve, se recuperó adecuadamente tras el almuerzo.',
      },
      {
        id: 'symp-b-2',
        hours: 78,
        desc: 'Sensación de pesadez en las extremidades inferiores tras actividad diaria.',
      },
      {
        id: 'symp-b-3',
        hours: 170,
        desc: 'Cefalea leve vespertina que cedió con reposo e hidratación.',
      },
      {
        id: 'symp-b-4',
        hours: 260,
        desc: 'Digestión lenta y sensación de saciedad temprana.',
      },
    ];

    for (const s of symptomsB) {
      const regDate = isoHoursAgo(s.hours);
      await tx.run(
        `INSERT OR IGNORE INTO sintomas (
          id, paciente_id, fecha_registro, descripcion, creado_localmente_en
        ) VALUES (?, ?, ?, ?, ?)`,
        [s.id, patientBId, regDate, s.desc, regDate],
      );
    }
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
