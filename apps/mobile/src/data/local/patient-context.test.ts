import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { createPatientRepository, seedPatientContextIfEmpty } from './repository';
import { createSqliteTestHarness, ids, patientA, patientB } from './testing/sqlite-test-harness';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('contexto y perfil clínico offline', () => {
  it('puebla datos sintéticos de demostración para paciente A y paciente B con seed', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    const profileA = await repoA.profile();
    const profileB = await repoB.profile();
    expect(profileA?.nombre).toBe('Paciente A de Prueba');
    expect(profileB?.nombre).toBe('Paciente B de Prueba');
    expect(profileA?.rut).toBe('12.345.678-9');
    expect(profileB?.rut).toBe('15.876.543-2');

    const treatmentA = await repoA.treatment();
    const treatmentB = await repoB.treatment();
    expect(treatmentA?.nombre).toContain('Tratamiento de quimioterapia (demostración)');
    expect(treatmentB?.nombre).toContain('Tratamiento de quimioterapia (demostración)');
    expect(treatmentA?.tipo).toBe('quimioterapia');
    expect(treatmentB?.tipo).toBe('quimioterapia');
    expect(JSON.parse(treatmentA?.parametros_json ?? '{}').ciclo_actual).toBe(3);
    expect(JSON.parse(treatmentB?.parametros_json ?? '{}').ciclo_actual).toBe(1);

    // La caché de código de vinculación inicia vacía hasta recibir uno del servicio/simulador
    const codeA = await repoA.linkCode();
    const codeB = await repoB.linkCode();
    expect(codeA).toBeNull();
    expect(codeB).toBeNull();
  });

  it('permite actualizar el perfil y almacena código canónico emitido por el servicio', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    await repoA.saveProfile({
      nombre: 'Paciente A Actualizado',
      email: 'paciente.a.nuevo@quimiocare.test',
      rut: '11.111.111-K',
    });

    const updated = await repoA.profile();
    expect(updated?.nombre).toBe('Paciente A Actualizado');
    expect(updated?.email).toBe('paciente.a.nuevo@quimiocare.test');
    expect(updated?.rut).toBe('11.111.111-K');

    // SQLite almacena el código canónico (6 caracteres alfanuméricos sin espacios)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await repoA.saveLinkCode({
      codigo: 'SRV 891',
      expira_en: expiresAt,
      estado_conocido: 'pendiente',
    });

    const storedCode = await repoA.linkCode();
    expect(storedCode?.codigo).toBe('SRV891');
    expect(storedCode?.expira_en).toBe(expiresAt);
    expect(storedCode?.estado_conocido).toBe('pendiente');
  });

  it('selecciona únicamente el tratamiento activo ignorando tratamientos finalizados', async () => {
    const database = open();
    await migrateDatabase(database);
    const repoA = createPatientRepository(database, patientA, ids());

    await database.run(
      `INSERT INTO paciente_cache (paciente_id, nombre, email, rut, obtenido_en)
       VALUES (?, 'Paciente A', 'a@test.com', '1-9', '2026-09-01T00:00:00Z')`,
      [patientA],
    );
    await database.run(
      `INSERT INTO tratamiento_cache (
        id, paciente_id, tipo, estado, nombre, parametros_json, fecha_inicio, fecha_termino, obtenido_en
      ) VALUES ('t-activo', ?, 'quimioterapia', 'activo', 'Tratamiento Activo', '{"ciclo_actual":2}', '2026-08-01', '2026-12-01', '2026-08-01T00:00:00Z')`,
      [patientA],
    );
    await database.run(
      `INSERT INTO tratamiento_cache (
        id, paciente_id, tipo, estado, nombre, parametros_json, fecha_inicio, fecha_termino, obtenido_en
      ) VALUES ('t-finalizado', ?, 'quimioterapia', 'finalizado', 'Tratamiento Finalizado', '{}', '2026-01-01', '2026-07-01', '2026-09-01T00:00:00Z')`,
      [patientA],
    );

    const active = await repoA.treatment();
    expect(active?.id).toBe('t-activo');
    expect(active?.estado).toBe('activo');
    expect(active?.nombre).toBe('Tratamiento Activo');
  });

  it('hace cumplir las restricciones de clave foránea y no genera violaciones en foreign_key_check', async () => {
    const database = open();
    await migrateDatabase(database);
    await expect(
      database.run(
        `INSERT INTO tratamiento_cache (
          id, paciente_id, tipo, estado, nombre, obtenido_en
        ) VALUES ('t1', 'paciente-no-existe', 'quimioterapia', 'activo', 'Test', '2026-09-28T00:00:00Z')`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);

    await expect(
      database.run(
        `INSERT INTO codigo_vinculacion_cache (
          paciente_id, codigo, expira_en, estado_conocido, obtenido_en
        ) VALUES ('paciente-no-existe', 'XYZ123', '2026-09-29T00:00:00Z', 'pendiente', '2026-09-28T00:00:00Z')`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);

    const fkIssues = await database.all('PRAGMA foreign_key_check');
    expect(fkIssues).toHaveLength(0);
  });
});
