import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { createPatientRepository, sinceDays } from './repository';
import { InputError, parseSymptomDescription, parseVitalInput } from './validation';
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

describe('registros y cola local', () => {
  it('guarda registro e instantánea pendiente para signos y síntomas', async () => {
    const database = open();
    await migrateDatabase(database);
    const repository = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 's1', 'q2'),
      () => measured,
    );
    await repository.createVitals(validVitals);
    await repository.createSymptom('Molestia de prueba');
    const rows = await database.all<{
      tipo_entidad: string;
      registro_id: string;
      payload_json: string;
      estado: string;
    }>(
      'SELECT tipo_entidad, registro_id, payload_json, estado FROM cola_envio ORDER BY creado_en, id',
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.estado)).toEqual(['pendiente', 'pendiente']);
    expect(JSON.parse(rows[0].payload_json)).toMatchObject({
      schemaVersion: 1,
      entity: 'signos_vitales',
      record: { id: 'v1', paciente_id: patientA },
    });
    expect((await repository.latestVital())?.fecha_subida).toBeNull();
    expect(await repository.pendingCount()).toBe(2);
  });

  it('revierte el registro cuando la operación de cola falla', async () => {
    const database = open();
    await migrateDatabase(database);
    const repository = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 'v2', 'q1'),
      () => measured,
    );
    await repository.createVitals(validVitals);
    await expect(repository.createVitals(validVitals)).rejects.toThrow();
    expect((await repository.vitals('2026-01-01')).map((row) => row.id)).toEqual(['v1']);
    expect(await repository.pendingCount()).toBe(1);
  });

  it('separa historial, detalle, último registro, síntomas y pendientes por paciente', async () => {
    const database = open();
    await migrateDatabase(database);
    const a = createPatientRepository(
      database,
      patientA,
      ids('av', 'aq', 'as', 'asq'),
      () => measured,
    );
    const b = createPatientRepository(database, patientB, ids('bv', 'bq'), () => measured);
    await a.createVitals(validVitals);
    await a.createSymptom('Síntoma A');
    await b.createVitals({ ...validVitals, pulso: 80 });
    expect((await a.vitals('2026-01-01')).map((row) => row.id)).toEqual(['av']);
    expect((await b.vitals('2026-01-01')).map((row) => row.id)).toEqual(['bv']);
    expect(await b.vital('av')).toBeNull();
    expect((await a.latestVital())?.id).toBe('av');
    expect((await b.latestVital())?.id).toBe('bv');
    expect((await a.symptoms()).map((row) => row.descripcion)).toEqual(['Síntoma A']);
    expect(await b.symptoms()).toEqual([]);
    expect(await a.pendingCount()).toBe(2);
    expect(await b.pendingCount()).toBe(1);
  });

  it('filtra por tiempo y pagina en bloques', async () => {
    const database = open();
    await migrateDatabase(database);
    let n = 0;
    const repository = createPatientRepository(
      database,
      patientA,
      () => `id-${n++}`,
      () => measured,
    );
    for (let i = 0; i < 32; i++) await repository.createVitals(validVitals);
    expect(
      await repository.vitals(sinceDays(7, new Date('2026-09-28T12:30:00Z')), 30),
    ).toHaveLength(30);
    expect(await repository.vitals('2026-09-01', 30, 30)).toHaveLength(2);
    expect(await repository.vitals('2026-09-29')).toHaveLength(0);
  });
});

describe('validación estructural', () => {
  const blank = { temperature: '', systolic: '', diastolic: '', pulse: '', saturation: '' };
  it('acepta coma o punto y mediciones parciales', () => {
    expect(parseVitalInput({ ...blank, temperature: '36,8' }).temperatura).toBe(36.8);
    expect(parseVitalInput({ ...blank, temperature: '36.8' }).temperatura).toBe(36.8);
  });
  it('rechaza mediciones vacías y números inválidos, y admite presión aislada', () => {
    expect(() => parseVitalInput(blank)).toThrow(InputError);
    expect(parseVitalInput({ ...blank, systolic: '120' }).presion_sistolica).toBe(120);
    expect(() => parseVitalInput({ ...blank, pulse: '72.5' })).toThrow(InputError);
    expect(() => parseVitalInput({ ...blank, saturation: '101' })).toThrow(InputError);
    expect(() => parseVitalInput({ ...blank, temperature: 'Infinity' })).toThrow(InputError);
  });
  it('exige una descripción real de hasta 2.000 caracteres', () => {
    expect(() => parseSymptomDescription('   ')).toThrow(InputError);
    expect(() => parseSymptomDescription('a'.repeat(2001))).toThrow(InputError);
    expect(parseSymptomDescription('  Molestia  ')).toBe('Molestia');
  });
});
