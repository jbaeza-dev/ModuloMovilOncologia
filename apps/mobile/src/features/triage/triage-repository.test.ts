import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateDatabase } from '../../data/local/migrations';
import {
  createSqliteTestHarness,
  patientA,
  patientB,
  measured,
} from '../../data/local/testing/sqlite-test-harness';
import { createOrientationRepository } from './triage-repository';
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
describe('historia local de orientación sin otro emisor clínico', () => {
  it('conserva una alarma incompleta, replay idempotente y aislamiento por cuenta/entorno/modo', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    const repo = createOrientationRepository(db, { patientId: patientA, environment: 'test' });
    const input = { answers: { 'A1-CONCIENCIA': 'yes' as const }, informant: null, pain: null };
    const outcome = await repo.save('one', input, 'synthetic', measured);
    expect(outcome.outcome).toBe('A1');
    expect(outcome.complete).toBe(false);
    await repo.save('one', input, 'synthetic', measured);
    expect(await repo.history('synthetic')).toHaveLength(1);
    expect(await repo.history('clinical')).toEqual([]);
    expect(
      await createOrientationRepository(db, { patientId: patientB, environment: 'test' }).history(
        'synthetic',
      ),
    ).toEqual([]);
    expect(
      await createOrientationRepository(db, {
        patientId: patientA,
        environment: 'another',
      }).history('synthetic'),
    ).toEqual([]);
    expect(await db.all('SELECT * FROM qc_clinical_command')).toEqual([]);
    await expect(
      repo.save('one', { ...input, informant: 'PACIENTE' }, 'synthetic', measured),
    ).rejects.toThrow('UUID');
    await expect(repo.save('clinical', input, 'clinical', measured)).rejects.toThrow(
      'no está habilitada',
    );
  });
  it('una corrección enlaza a su original y no permite sobrescribir ni usar el antecedente de otro contexto', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    const repo = createOrientationRepository(db, { patientId: patientA, environment: 'test' });
    const input = { answers: {}, informant: null, pain: null };
    await repo.save('original', input, 'synthetic', measured);
    await repo.save('correction', input, 'synthetic', measured, 'original');
    await expect(
      db.run('UPDATE qc_orientation_snapshot SET snapshot_json=? WHERE id=?', ['{}', 'original']),
    ).rejects.toThrow('sobrescribe');
    await expect(
      createOrientationRepository(db, { patientId: patientB, environment: 'test' }).save(
        'other',
        input,
        'synthetic',
        measured,
        'original',
      ),
    ).rejects.toThrow('antecedente');
    expect(await repo.history('synthetic')).toHaveLength(2);
  });
});

describe('validaciones del repositorio de orientación', () => {
  const entrada = { answers: { 'A1-CONCIENCIA': 'yes' as const }, informant: null, pain: null };

  it('exige paciente y entorno', () => {
    const db = harness.open();
    expect(() => createOrientationRepository(db, { patientId: '', environment: 'test' })).toThrow(
      'Falta el contexto de orientación.',
    );
    expect(() => createOrientationRepository(db, { patientId: patientA, environment: '' })).toThrow(
      'Falta el contexto de orientación.',
    );
  });

  it('rechaza registros sin identificador o con fecha inválida', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    const repo = createOrientationRepository(db, { patientId: patientA, environment: 'test' });
    await expect(repo.save('', entrada, 'synthetic', measured)).rejects.toThrow(
      'Registro de orientación inválido.',
    );
    await expect(repo.save('x', entrada, 'synthetic', 'no-fecha')).rejects.toThrow(
      'Registro de orientación inválido.',
    );
  });

  it('exige que el antecedente pertenezca a la misma cuenta y modo', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    const repo = createOrientationRepository(db, { patientId: patientA, environment: 'test' });
    await expect(repo.save('dos', entrada, 'synthetic', measured, 'inexistente')).rejects.toThrow(
      'El antecedente no pertenece a esta evaluación.',
    );
    await repo.save('uno', entrada, 'synthetic', measured);
    await repo.save('dos', entrada, 'synthetic', measured, 'uno');
    expect(await repo.history('synthetic')).toHaveLength(2);
  });

  it('consulta el plan individual cuando hay un resolutor configurado', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    const resolver = vi.fn(async () => ({
      state: 'SIN_PLAN_REGISTRADO' as const,
      applicable: false,
      reason: 'not-registered',
      planId: null,
      version: null,
      contentHash: null,
      trustCheckedAt: null,
      patientId: null,
      environment: null,
      coveredSignals: [],
      instructions: null,
      contingency: null,
      contact: null,
    }));
    const repo = createOrientationRepository(
      db,
      { patientId: patientA, environment: 'test' },
      resolver,
    );
    const r = await repo.save('plan', entrada, 'synthetic', measured);
    expect(resolver).toHaveBeenCalled();
    expect(r.planNotAppliedReason).toBe('not-registered');
  });

  it.each([
    [0, 0],
    [101, 0],
    [1.5, 0],
    [10, -1],
    [10, 0.5],
  ])('rechaza páginas de historial inválidas (límite %s, desde %s)', async (limit, offset) => {
    const db = harness.open();
    await migrateDatabase(db);
    const repo = createOrientationRepository(db, { patientId: patientA, environment: 'test' });
    await expect(repo.history('synthetic', limit, offset)).rejects.toThrow(
      'Página de historial inválida.',
    );
  });
});
