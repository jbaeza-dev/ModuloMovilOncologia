import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { createPatientRepository, seedPatientContextIfEmpty, sinceDays } from './repository';
import { buildReportHtml } from '../../features/reports/report-template';
import {
  createSqliteTestHarness,
  ids,
  measured,
  patientA,
  patientB,
  validVitals,
} from './testing/sqlite-test-harness';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('reportes locales y generación de contenido para PDF', () => {
  it('calcula correctamente el resumen de signos vitales para reportes en rangos de 7, 30 y 90 días con fechas límite', async () => {
    const database = open();
    await migrateDatabase(database);

    let currentTime = '2026-09-26T12:00:00.000Z';
    const repoA = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 'v2', 'q2', 'v3', 'q3', 'v4', 'q4'),
      () => currentTime,
    );

    // Registro 1: medido hace 2 días (dentro de 7, 30 y 90 días)
    currentTime = '2026-09-26T12:00:00.000Z';
    await repoA.createVitals({
      temperatura: 36.5,
      presion_sistolica: 120,
      presion_diastolica: 80,
      pulso: 70,
      saturacion_o2: 98,
    });

    // Registro 2: medido hace 15 días (fuera de 7 días, pero dentro de 30 y 90 días)
    currentTime = '2026-09-13T12:00:00.000Z';
    await repoA.createVitals({
      temperatura: 37.5,
      presion_sistolica: 130,
      presion_diastolica: 85,
      pulso: 80,
      saturacion_o2: 97,
    });

    // Registro 3: medido hace 45 días (fuera de 7 y 30 días, pero dentro de 90 días)
    currentTime = '2026-08-14T12:00:00.000Z';
    await repoA.createVitals({
      temperatura: 38.5,
      presion_sistolica: 135,
      presion_diastolica: 88,
      pulso: 90,
      saturacion_o2: 96,
    });

    // Registro 4: medido hace 100 días (fuera de 7, 30 y 90 días)
    currentTime = '2026-06-20T12:00:00.000Z';
    await repoA.createVitals({
      temperatura: 39.0,
      presion_sistolica: 140,
      presion_diastolica: 90,
      pulso: 100,
      saturacion_o2: 95,
    });

    const reference = new Date('2026-09-28T12:00:00.000Z');

    // Rango 7 días: solo registro 1 (hace 2 días)
    const summary7 = await repoA.vitalsSummary(sinceDays(7, reference));
    expect(summary7.total).toBe(1);
    expect(summary7.avgTemperature).toBe(36.5);
    expect(summary7.avgPulse).toBe(70);

    // Rango 30 días: registros 1 y 2 (hace 2 y 15 días)
    const summary30 = await repoA.vitalsSummary(sinceDays(30, reference));
    expect(summary30.total).toBe(2);
    expect(summary30.avgTemperature).toBe(37); // (36.5 + 37.5) / 2
    expect(summary30.avgPulse).toBe(75); // (70 + 80) / 2

    // Rango 90 días: registros 1, 2 y 3 (hace 2, 15 y 45 días)
    const summary90 = await repoA.vitalsSummary(sinceDays(90, reference));
    expect(summary90.total).toBe(3);
    expect(summary90.avgTemperature).toBe(37.5); // (36.5 + 37.5 + 38.5) / 3
    expect(summary90.avgPulse).toBe(80); // (70 + 80 + 90) / 3

    // Paciente B debe tener 0 registros (aislamiento A/B)
    const repoB = createPatientRepository(database, patientB, ids());
    const summaryB = await repoB.vitalsSummary(sinceDays(90, reference));
    expect(summaryB.total).toBe(0);
    expect(summaryB.avgTemperature).toBeNull();
    expect(summaryB.avgPulse).toBeNull();
  });

  it('recupera mediciones para reporte cronológicamente y sin límite arbitrario con vitalsForReport', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repo = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 'v2', 'q2', 'v3', 'q3'),
      () => measured,
    );

    // Insertar registros con fechas conocidas
    await repo.createVitals({ ...validVitals, temperatura: 36.5 });
    await repo.createVitals({ ...validVitals, temperatura: 37.1 });
    await repo.createVitals({ ...validVitals, temperatura: 36.9 });

    const vitals = await repo.vitalsForReport(sinceDays(30, new Date('2026-10-01T00:00:00Z')));
    expect(vitals).toHaveLength(3);
    // Orden cronológico ascendente para el reporte
    expect(vitals[0].temperatura).toBe(36.5);
    expect(vitals[1].temperatura).toBe(37.1);
    expect(vitals[2].temperatura).toBe(36.9);
  });

  it('genera plantilla HTML válida con datos del paciente, resumen y disclaimer sintético', () => {
    const html = buildReportHtml({
      pacienteId: patientA,
      periodDays: 30,
      profile: {
        paciente_id: patientA,
        nombre: 'Paciente A de Prueba',
        rut: '12.345.678-9',
        email: 'paciente.a@quimiocare.cl',
        obtenido_en: '2026-09-28T12:00:00Z',
      },
      treatment: {
        id: 't1',
        paciente_id: patientA,
        tipo: 'quimioterapia',
        estado: 'activo',
        nombre: 'Esquema de quimioterapia de prueba',
        parametros_json: null,
        fecha_inicio: '2026-08-01',
        fecha_termino: null,
        obtenido_en: '2026-09-28T12:00:00Z',
      },
      summary: {
        total: 2,
        avgTemperature: 36.8,
        avgPulse: 72,
      },
      vitals: [
        {
          id: 'v1',
          paciente_id: patientA,
          fecha_registro: '2026-09-28T08:00:00Z',
          presion_sistolica: 120,
          presion_diastolica: 80,
          pulso: 72,
          temperatura: 36.8,
          saturacion_o2: 98,
          fecha_subida: null,
        },
      ],
    });

    expect(html).toContain('QuimioCare');
    expect(html).toContain('Paciente A de Prueba');
    expect(html).toContain('12.345.678-9');
    expect(html).toContain('Esquema de quimioterapia de prueba');
    expect(html).toContain('Últimos 30 días');
    expect(html).toContain('Aviso técnico y demostrativo');
    expect(html).toContain('36,8 °C');
    expect(html).toContain('120/80 mmHg');
    expect(html).toContain('72 lpm');
    expect(html).toContain('98 %');
  });

  it('genera instantánea ReportData con normalización UTC y excluye registros futuros', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const nowIso = '2026-09-28T12:00:00.000Z';
    const repoA = createPatientRepository(database, patientA, ids(), () => nowIso);

    // Registro pasado (válido dentro de 30 días)
    await repoA.createVitals({ ...validVitals, temperatura: 36.6 });
    await repoA.createSymptom('Náuseas leves por la mañana');

    // Registro futuro (posterior a nowIso)
    const futureRepo = createPatientRepository(
      database,
      patientA,
      ids('fut-v', 'fut-q1', 'fut-s', 'fut-q2'),
      () => '2026-09-29T12:00:00.000Z',
    );
    await futureRepo.createVitals({ ...validVitals, temperatura: 39.5 });
    await futureRepo.createSymptom('Fiebre futura no computable');

    const reportData = await repoA.getReportData(30, nowIso);

    expect(reportData.pacienteId).toBe(patientA);
    expect(reportData.periodDays).toBe(30);
    expect(reportData.generatedAt).toBe(nowIso);
    expect(reportData.periodEnd).toBe(nowIso);
    expect(reportData.vitals).toHaveLength(1);
    expect(reportData.vitals[0].temperatura).toBe(36.6);
    expect(reportData.symptoms).toHaveLength(1);
    expect(reportData.symptoms[0].descripcion).toBe('Náuseas leves por la mañana');
    expect(reportData.summary.vitalsCount).toBe(1);
    expect(reportData.summary.symptomsCount).toBe(1);
  });

  it('rechaza instantes now inválidos con error descriptivo', async () => {
    const database = open();
    await migrateDatabase(database);

    const repoA = createPatientRepository(database, patientA, ids());
    await expect(repoA.getReportData(30, 'fecha-invalida')).rejects.toThrow(
      'Instante de generación inválido.',
    );
  });

  it('incluye todos los registros del período sin truncar a 30 filas e impone orden cronológico ascendente', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const baseTime = new Date('2026-09-10T00:00:00.000Z').getTime();
    let currentId = 0;
    const repoA = createPatientRepository(
      database,
      patientA,
      () => `id-${++currentId}`,
      () => new Date(baseTime + currentId * 3600 * 1000).toISOString(),
    );

    // Insertar 35 signos y 35 síntomas
    for (let i = 0; i < 35; i++) {
      await repoA.createVitals({ ...validVitals, temperatura: 36.0 + (i % 10) * 0.1 });
      await repoA.createSymptom(`Síntoma evento #${i + 1}`);
    }

    const reportData = await repoA.getReportData(30, '2026-09-28T12:00:00.000Z');

    expect(reportData.vitals.length).toBe(35);
    expect(reportData.symptoms.length).toBe(35);
    expect(reportData.summary.vitalsCount).toBe(35);
    expect(reportData.summary.symptomsCount).toBe(35);

    // Comprobar orden cronológico ascendente estricto
    for (let i = 1; i < reportData.vitals.length; i++) {
      expect(new Date(reportData.vitals[i].fecha_registro).getTime()).toBeGreaterThanOrEqual(
        new Date(reportData.vitals[i - 1].fecha_registro).getTime(),
      );
    }
    for (let i = 1; i < reportData.symptoms.length; i++) {
      expect(new Date(reportData.symptoms[i].fecha_registro).getTime()).toBeGreaterThanOrEqual(
        new Date(reportData.symptoms[i - 1].fecha_registro).getTime(),
      );
    }
  });

  it('calcula promedios aritméticos reales excluyendo valores nulos sin convertir null en cero', async () => {
    const database = open();
    await migrateDatabase(database);

    const repoA = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 'v2', 'q2', 'v3', 'q3'),
      () => '2026-09-25T12:00:00.000Z',
    );

    // Registro 1: temp 36.0, pulso 70, presiones null, sat 98
    await repoA.createVitals({
      temperatura: 36.0,
      pulso: 70,
      presion_sistolica: null,
      presion_diastolica: null,
      saturacion_o2: 98,
    });

    // Registro 2: temp null, pulso 90, presiones 120/80, sat null
    await repoA.createVitals({
      temperatura: null,
      pulso: 90,
      presion_sistolica: 120,
      presion_diastolica: 80,
      saturacion_o2: null,
    });

    // Registro 3: temp 38.0, pulso null, presiones 130/84, sat 96
    await repoA.createVitals({
      temperatura: 38.0,
      pulso: null,
      presion_sistolica: 130,
      presion_diastolica: 84,
      saturacion_o2: 96,
    });

    const reportData = await repoA.getReportData(30, '2026-09-28T12:00:00.000Z');

    // Temperatura: (36.0 + 38.0) / 2 = 37.0
    expect(reportData.summary.avgTemperature).toBe(37);
    expect(reportData.summary.minTemperature).toBe(36);
    expect(reportData.summary.maxTemperature).toBe(38);

    // Pulso: (70 + 90) / 2 = 80
    expect(reportData.summary.avgPulse).toBe(80);
    expect(reportData.summary.minPulse).toBe(70);
    expect(reportData.summary.maxPulse).toBe(90);

    // Presiones: sistólica (120 + 130) / 2 = 125, diastólica (80 + 84) / 2 = 82
    expect(reportData.summary.avgSystolic).toBe(125);
    expect(reportData.summary.avgDiastolic).toBe(82);

    // Saturación: (98 + 96) / 2 = 97
    expect(reportData.summary.avgOxygenSaturation).toBe(97);
  });

  it('resuelve el código de vinculación clínica con desempate determinista y maneja expiración inválida', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Caso con 2 vínculos activos: debe seleccionar el más reciente por fecha_vinculacion DESC, id DESC
    await database.run(
      `INSERT OR REPLACE INTO profesional_medico_cache (id, nombre, especialidad, email, obtenido_en)
       VALUES ('prof-custom-1', 'Dr. Uno', 'Oncología', null, '2026-09-01T00:00:00Z'),
              ('prof-custom-2', 'Dr. Dos', 'Hematología', null, '2026-09-01T00:00:00Z')`,
    );
    await database.run(
      `INSERT OR REPLACE INTO paciente_clinico_cache (id, paciente_id, profesional_id, estado_conocido, fecha_vinculacion, codigo_origen, obtenido_en)
       VALUES ('vinc-old', ?, 'prof-custom-1', 'activo', '2026-08-01T00:00:00Z', 'COD-VIEJO', '2026-08-01T00:00:00Z'),
              ('vinc-new', ?, 'prof-custom-2', 'activo', '2026-09-15T00:00:00Z', 'COD-NUEVO', '2026-09-15T00:00:00Z')`,
      [patientA, patientA],
    );

    const reportActive = await repoA.getReportData(30, '2026-09-28T12:00:00.000Z');
    expect(reportActive.linkingCode.status).toBe('active_link');
    expect(reportActive.linkingCode.code).toBe('COD-NUEVO');
    expect(reportActive.linkingCode.displayText).toContain(
      'Vínculo activo según información en caché: COD-NUEVO',
    );

    // 2. Caso código temporal en paciente B con expira_en inválida: inactivar vínculos previos para evaluar fallback a codigo_vinculacion_cache
    await database.run(
      `UPDATE paciente_clinico_cache SET estado_conocido = 'inactivo' WHERE paciente_id = ?`,
      [patientB],
    );
    await database.run(
      `INSERT OR REPLACE INTO codigo_vinculacion_cache (paciente_id, codigo, expira_en, estado_conocido, obtenido_en)
       VALUES (?, 'TMP-999', 'fecha-invalida', 'pendiente', '2026-09-01T00:00:00Z')`,
      [patientB],
    );
    const repoB = createPatientRepository(database, patientB, ids());
    const reportB = await repoB.getReportData(30, '2026-09-28T12:00:00.000Z');
    expect(reportB.linkingCode.status).toBe('unavailable');
    expect(reportB.linkingCode.displayText).toContain('fecha de expiración inválida en caché');
    expect(reportB.vitals).toHaveLength(0);
  });

  it('garantiza inmutabilidad profunda de ReportData y congela sus elementos', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 's1', 'q2'),
      () => '2026-09-25T12:00:00.000Z',
    );
    await repoA.createVitals({ ...validVitals, temperatura: 36.8 });
    await repoA.createSymptom('Fatiga moderada');

    const reportData = await repoA.getReportData(30, '2026-09-28T12:00:00.000Z');

    expect(Object.isFrozen(reportData)).toBe(true);
    expect(Object.isFrozen(reportData.vitals)).toBe(true);
    expect(Object.isFrozen(reportData.symptoms)).toBe(true);
    expect(Object.isFrozen(reportData.vitals[0])).toBe(true);
    expect(Object.isFrozen(reportData.symptoms[0])).toBe(true);
    expect(Object.isFrozen(reportData.summary)).toBe(true);
    expect(Object.isFrozen(reportData.linkingCode)).toBe(true);

    expect(() => {
      // @ts-expect-error mutación intencional de prueba
      reportData.vitals[0].temperatura = 39.9;
    }).toThrow();

    expect(() => {
      // @ts-expect-error mutación intencional de prueba
      reportData.symptoms[0].descripcion = 'Cambio no permitido';
    }).toThrow();
  });

  it('acredita RNF-06: generación de instantánea con 500 signos vitales y 500 síntomas en menos de 3 segundos', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const baseMs = new Date('2026-07-01T00:00:00.000Z').getTime();

    // Inserción rápida en lote dentro de una única transacción
    await database.transaction(async (tx) => {
      for (let i = 0; i < 500; i++) {
        const timeIso = new Date(baseMs + i * 3600 * 1000).toISOString();
        await tx.run(
          `INSERT INTO signos_vitales (
            id, paciente_id, fecha_registro, presion_sistolica, presion_diastolica,
            pulso, temperatura, saturacion_o2, creado_localmente_en
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`bench-v-${i}`, patientA, timeIso, 120, 80, 72, 36.5, 98, timeIso],
        );
        await tx.run(
          `INSERT INTO sintomas (
            id, paciente_id, fecha_registro, descripcion, creado_localmente_en
          ) VALUES (?, ?, ?, ?, ?)`,
          [`bench-s-${i}`, patientA, timeIso, `Síntoma de prueba #${i}`, timeIso],
        );
      }
    });

    const repoA = createPatientRepository(database, patientA, ids());

    const tStart = performance.now();
    const reportData = await repoA.getReportData(90, '2026-09-28T12:00:00.000Z');
    const tEnd = performance.now();
    const durationMs = tEnd - tStart;

    expect(reportData.vitals.length).toBe(500);
    expect(reportData.symptoms.length).toBe(500);
    expect(reportData.summary.vitalsCount).toBe(500);
    expect(reportData.summary.symptomsCount).toBe(500);

    // RNF-06: tiempo estricto inferior a 3.000 ms (3 segundos)
    expect(durationMs).toBeLessThan(3000);
  });
});
