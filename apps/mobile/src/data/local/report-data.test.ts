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
});
