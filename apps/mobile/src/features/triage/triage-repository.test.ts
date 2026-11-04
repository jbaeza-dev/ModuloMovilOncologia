import { afterEach, describe, expect, it } from 'vitest';
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
