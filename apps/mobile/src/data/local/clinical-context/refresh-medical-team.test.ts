import { afterEach, expect, it } from 'vitest';
import { createSqliteTestHarness, patientA, patientB } from '../testing/sqlite-test-harness';
import { migrateDatabase } from '../migrations';
import type { HttpSessionAdapter } from '../../../services/session/http-session-adapter';
import { refreshMedicalTeam } from './refresh-medical-team';
import { createClinicalContextRepository } from './clinical-context-repository';
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());

it('stores the assigned team offline, rejects another patient, and retires removed links', async () => {
  const db = harness.open();
  await migrateDatabase(db);
  await db.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
    patientA,
    'Ejemplo',
    new Date().toISOString(),
  ]);
  let response = {
    status: 200,
    body: {
      paciente_id: patientA,
      items: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          paciente_id: patientA,
          profesional_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          nombre: 'Dra. Camila Rojas — demostración',
          especialidad: 'Oncología médica',
          vinculado_en: new Date().toISOString(),
        },
      ],
    },
  };
  const session = {
    request: async () => response,
    getCurrentUser: () => ({ id: patientA }),
  } as unknown as HttpSessionAdapter;
  const repository = createClinicalContextRepository(db, patientA);
  await refreshMedicalTeam(session, db, patientA, patientA);
  expect(await repository.assignedMedicalTeam()).toHaveLength(1);
  response.body.paciente_id = patientB;
  await expect(refreshMedicalTeam(session, db, patientA, patientA)).rejects.toThrow();
  expect(await repository.assignedMedicalTeam()).toHaveLength(1);
  response = { status: 200, body: { paciente_id: patientA, items: [] } };
  await refreshMedicalTeam(session, db, patientA, patientA);
  expect(await repository.assignedMedicalTeam()).toEqual([]);
});
