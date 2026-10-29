import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteTestHarness, patientA } from '../testing/sqlite-test-harness';
import { migrateDatabase } from '../migrations';
import { cacheMedicationForReminder } from './medication-cache';
import type { IdentityCache } from '../../../services/session/http-session-types';
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const medId = '3589dcad-685b-5c68-b9ee-81fd555db86d';
const identity: IdentityCache = {
  owner: '964d32f1-6941-579f-9f08-b60342194da9',
  scope: 'test',
  fetchedAt: '2026-10-27T00:00:00Z',
  user: { id: '964d32f1-6941-579f-9f08-b60342194da9', name: 'Synthetic', isDemo: true },
  profile: {
    id: '964d32f1-6941-579f-9f08-b60342194da9',
    email: 'a@example.test',
    rol: 'paciente',
    activo: true,
  },
  clinicalStatus: 'available',
  treatmentStatus: 'missing',
  treatment: null,
  clinicalProfile: {
    id: 'dba7e9f7-46ed-5b29-8e51-fb5a81212342',
    fecha_actualizacion: '2026-10-27T00:00:00Z',
    medicamentos: [
      {
        id: medId,
        medicamento_id: '89e72d25-8063-5f9d-91c8-515d14c1e663',
        nombre: 'Medicamento sintético',
        dosis: 'Según fixture sintético',
        frecuencia: 'Según fixture sintético',
        activo: true,
      },
    ],
  },
};
async function database() {
  const db = harness.open();
  await migrateDatabase(db);
  await db.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
    patientA,
    'Synthetic',
    identity.fetchedAt,
  ]);
  return db;
}
describe('REST indication for local reminders', () => {
  it('copies exact known indication and original source time', async () => {
    const db = await database();
    await cacheMedicationForReminder(db, patientA, identity, medId, () => undefined);
    expect(
      await db.first(
        'SELECT nombre,dosis,frecuencia,obtenido_en FROM medicamento_activo_cache WHERE id=?',
        [medId],
      ),
    ).toEqual({
      nombre: 'Medicamento sintético',
      dosis: 'Según fixture sintético',
      frecuencia: 'Según fixture sintético',
      obtenido_en: identity.fetchedAt,
    });
  });
  it('does not fabricate a dose, frequency, active status or foreign medication', async () => {
    const db = await database();
    for (const patch of [
      { dosis: undefined },
      { frecuencia: undefined },
      { activo: undefined },
      { activo: false },
    ]) {
      const incomplete = structuredClone(identity);
      Object.assign(incomplete.clinicalProfile!.medicamentos![0], patch);
      await expect(
        cacheMedicationForReminder(db, patientA, incomplete, medId, () => undefined),
      ).rejects.toThrow('suficientes');
    }
    await expect(
      cacheMedicationForReminder(db, patientA, identity, 'other', () => undefined),
    ).rejects.toThrow();
    expect(await db.first('SELECT id FROM medicamento_activo_cache')).toBeNull();
  });
  it('does not write after the context guard rejects', async () => {
    const db = await database();
    await expect(
      cacheMedicationForReminder(db, patientA, identity, medId, () => {
        throw new Error('changed');
      }),
    ).rejects.toThrow('changed');
    expect(await db.first('SELECT id FROM medicamento_activo_cache')).toBeNull();
  });
});
