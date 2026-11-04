import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../../data/local/migrations';
import {
  createSqliteTestHarness,
  patientA,
  patientB,
  measured,
} from '../../data/local/testing/sqlite-test-harness';
import { createPalliativeRepository } from './palliative-repository';
import type { SignedPlan } from './palliative-plan';
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const envelope: SignedPlan = {
  plan: {
    id: 'synthetic-plan',
    version: 1,
    patientId: patientA,
    environment: 'test',
    issuerId: 'synthetic-issuer',
    approvedAt: measured,
    reviewAt: null,
    instructions: 'Prueba, sin indicación clínica.',
    coveredSignals: ['A1-RESP'],
    contact: 'Contacto de prueba',
    hours: 'Horario de prueba',
    contingency: 'Contingencia de prueba',
  },
  contentHash: 'a'.repeat(64),
  keyId: 'synthetic-key',
  signature: 'synthetic-unverified-signature',
};
describe('versiones locales del plan: almacenamiento no acredita aprobación', () => {
  it('preserva versiones, idempotencia y aislamiento; una declaración sigue sin verificar', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    const repo = createPalliativeRepository(db, { patientId: patientA, environment: 'test' });
    expect(await repo.recordDeclaration(envelope, measured)).toEqual({
      state: 'DECLARADO_NO_VERIFICADO',
    });
    await repo.recordDeclaration(envelope, measured);
    await expect(
      repo.recordDeclaration(
        { ...envelope, plan: { ...envelope.plan, instructions: 'Cambio no versionado' } },
        measured,
      ),
    ).rejects.toThrow('sobrescribe');
    await repo.recordDeclaration(
      {
        ...envelope,
        plan: { ...envelope.plan, version: 2, instructions: 'Nueva versión sintética' },
      },
      measured,
    );
    expect(await repo.get(envelope.plan.id, 1)).toEqual(envelope);
    expect(await db.all('SELECT * FROM qc_palliative_plan_version')).toHaveLength(2);
    expect(
      await createPalliativeRepository(db, { patientId: patientB, environment: 'test' }).get(
        envelope.plan.id,
        1,
      ),
    ).toBeNull();
    expect(
      await createPalliativeRepository(db, { patientId: patientA, environment: 'other' }).get(
        envelope.plan.id,
        1,
      ),
    ).toBeNull();
    await expect(
      createPalliativeRepository(db, {
        patientId: patientB,
        environment: 'test',
      }).recordDeclaration(envelope, measured),
    ).rejects.toThrow('contexto');
    await expect(
      db.run('UPDATE qc_palliative_plan_version SET content_json=? WHERE id=?', [
        '{}',
        envelope.plan.id,
      ]),
    ).rejects.toThrow('sobrescribe');
    expect(await db.all('SELECT * FROM qc_clinical_command')).toEqual([]);
  });
});
