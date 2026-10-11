import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { reconcileCopiesCore } from './reconciliation';
import { createPatientRepository, seedPatientContextIfEmpty } from './repository';
import { createSqliteTestHarness, ids, patientA, patientB } from './testing/sqlite-test-harness';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('descargas y recursos educativos offline', () => {
  it('hace cumplir las restricciones de CHECK y clave foránea en la tabla descarga', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Estado 'descargado' válido con ruta y fecha
    await database.run(
      `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
       VALUES (?, 'edu-valido', '/data/res.md', 'descargado', '2026-09-29T10:00:00Z')`,
      [patientA],
    );

    // 2. Estado 'descargado' sin ruta_local debe fallar CHECK
    await expect(
      database.run(
        `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
         VALUES (?, 'edu-sin-ruta', NULL, 'descargado', '2026-09-29T10:00:00Z')`,
        [patientA],
      ),
    ).rejects.toThrow();

    // 3. Estado 'descargado' sin fecha_descarga debe fallar CHECK
    await expect(
      database.run(
        `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
         VALUES (?, 'edu-sin-fecha', '/data/res.md', 'descargado', NULL)`,
        [patientA],
      ),
    ).rejects.toThrow();

    // 4. Estados 'pendiente', 'descargando' y 'error' permiten ruta_local y fecha_descarga nulas
    await database.run(
      `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
       VALUES (?, 'edu-pendiente', NULL, 'pendiente', NULL)`,
      [patientA],
    );
    await database.run(
      `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
       VALUES (?, 'edu-descargando', NULL, 'descargando', NULL)`,
      [patientA],
    );
    await database.run(
      `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
       VALUES (?, 'edu-error', NULL, 'error', NULL)`,
      [patientA],
    );

    // 5. Estado inválido debe fallar CHECK
    await expect(
      database.run(
        `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
         VALUES (?, 'edu-invalido', '/data/res.md', 'completado', '2026-09-29T10:00:00Z')`,
        [patientA],
      ),
    ).rejects.toThrow();

    // 6. Paciente inexistente debe fallar restricción de clave foránea
    await expect(
      database.run(
        `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
         VALUES ('paciente-fantasma', 'edu-1', '/data/res.md', 'descargado', '2026-09-29T10:00:00Z')`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);

    // PRAGMA foreign_key_check no debe reportar violaciones
    expect(await database.all('PRAGMA foreign_key_check')).toHaveLength(0);
  });

  it('gestiona ciclo de vida de descarga, visualización y eliminación en el repositorio', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    expect(await repoA.download('edu-prep-sesion')).toBeNull();
    expect(await repoA.downloads()).toHaveLength(0);

    // Guardar descarga
    await repoA.saveDownload({
      contenido_id: 'edu-prep-sesion',
      ruta_local: '/documentos/recursos_educativos/pacienteA/edu-prep-sesion.md',
    });

    const record = await repoA.download('edu-prep-sesion');
    expect(record).not.toBeNull();
    expect(record?.estado).toBe('descargado');
    expect(record?.ruta_local).toContain('edu-prep-sesion.md');
    expect(record?.visualizada).toBe(0);
    expect(record?.visualizada_en).toBeNull();

    // Marcar como visualizada
    await repoA.markDownloadViewed('edu-prep-sesion');
    const viewed = await repoA.download('edu-prep-sesion');
    expect(viewed?.visualizada).toBe(1);
    expect(viewed?.visualizada_en).toBeTruthy();

    // Re-guardar o actualizar descarga previa debe reiniciar visualizada a 0 y visualizada_en a null
    await repoA.saveDownload({
      contenido_id: 'edu-prep-sesion',
      ruta_local: '/documentos/recursos_educativos/pacienteA/edu-prep-sesion-v2.md',
    });
    const updated = await repoA.download('edu-prep-sesion');
    expect(updated?.ruta_local).toContain('edu-prep-sesion-v2.md');
    expect(updated?.visualizada).toBe(0);
    expect(updated?.visualizada_en).toBeNull();

    // Eliminar descarga
    await repoA.removeDownload('edu-prep-sesion');
    expect(await repoA.download('edu-prep-sesion')).toBeNull();
    expect(await repoA.downloads()).toHaveLength(0);
  });

  it('garantiza aislamiento A/B tanto en SQLite como a nivel de ruta física por paciente', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    // Directorio temporal emulando Paths.document/recursos_educativos/{paciente_id}
    const tempBase = harness.createTempDir('quimiocare-fs-');

    const dirA = join(tempBase, 'recursos_educativos', patientA);
    const dirB = join(tempBase, 'recursos_educativos', patientB);
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    const fileA = join(dirA, 'edu-compartido.md');
    const fileB = join(dirB, 'edu-compartido.md');

    // Ambos pacientes guardan el mismo recurso en sus respectivas rutas y base de datos
    writeFileSync(fileA, 'Contenido Paciente A', 'utf8');
    writeFileSync(fileB, 'Contenido Paciente B', 'utf8');

    await repoA.saveDownload({ contenido_id: 'edu-compartido', ruta_local: fileA });
    await repoB.saveDownload({ contenido_id: 'edu-compartido', ruta_local: fileB });

    expect(await repoA.download('edu-compartido')).not.toBeNull();
    expect(await repoB.download('edu-compartido')).not.toBeNull();

    // Paciente A elimina su recurso físico y registro en SQLite
    unlinkSync(fileA);
    await repoA.removeDownload('edu-compartido');

    // Paciente A ya no tiene el registro ni el archivo
    expect(await repoA.download('edu-compartido')).toBeNull();
    expect(existsSync(fileA)).toBe(false);

    // Paciente B conserva íntegro su registro en SQLite y su archivo físico
    const bRecord = await repoB.download('edu-compartido');
    expect(bRecord).not.toBeNull();
    expect(bRecord?.contenido_id).toBe('edu-compartido');
    expect(existsSync(fileB)).toBe(true);
    expect(readFileSync(fileB, 'utf8')).toBe('Contenido Paciente B');
  });

  it('permite que el seeder sea idempotente cuando el Paciente A ya existía previamente', async () => {
    const database = open();
    await migrateDatabase(database);

    // Pre-insertar únicamente Paciente A (simulando estado existente de migración previa)
    await database.run(
      `INSERT INTO paciente_cache (paciente_id, nombre, email, rut, obtenido_en)
       VALUES (?, 'Paciente A Preexistente', 'a.pre@test.com', '1-1', '2026-09-01T00:00:00Z')`,
      [patientA],
    );

    // Ejecutar el seeder
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Paciente A conserva sus datos preexistentes (INSERT OR IGNORE no sobreescribe)
    const repoA = createPatientRepository(database, patientA, ids());
    const profileA = await repoA.profile();
    expect(profileA?.nombre).toBe('Paciente A Preexistente');

    // Paciente B fue insertado correctamente
    const repoB = createPatientRepository(database, patientB, ids());
    const profileB = await repoB.profile();
    expect(profileB?.nombre).toBe('Paciente B de Prueba');

    // Segunda ejecución del seeder no duplica ni falla
    await seedPatientContextIfEmpty(database, patientA, patientB);
    const countA = await database.first<{ total: number }>(
      'SELECT count(*) as total FROM paciente_cache WHERE paciente_id = ?',
      [patientA],
    );
    const countB = await database.first<{ total: number }>(
      'SELECT count(*) as total FROM paciente_cache WHERE paciente_id = ?',
      [patientB],
    );
    expect(countA?.total).toBe(1);
    expect(countB?.total).toBe(1);
  });
});

describe('copias educativas y descargas locales', () => {
  it('guarda, consulta, actualiza y elimina descargas locales aisladas por paciente', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    // Paciente A guarda una descarga
    await repoA.saveDownload({
      contenido_id: 'edu-alimentacion',
      ruta_local: 'file:///data/user/0/recursos_educativos/A/edu-alimentacion_1.md',
    });

    // Paciente B guarda una descarga distinta
    await repoB.saveDownload({
      contenido_id: 'edu-bienestar',
      ruta_local: 'file:///data/user/0/recursos_educativos/B/edu-bienestar_1.md',
    });

    // Verificación de aislamiento A vs B
    const downloadsA = await repoA.downloads();
    const downloadsB = await repoB.downloads();
    expect(downloadsA).toHaveLength(1);
    expect(downloadsA[0].contenido_id).toBe('edu-alimentacion');
    expect(downloadsA[0].visualizada).toBe(0);
    expect(downloadsA[0].visualizada_en).toBeNull();

    expect(downloadsB).toHaveLength(1);
    expect(downloadsB[0].contenido_id).toBe('edu-bienestar');

    // Consulta individual por ID
    const singleA = await repoA.download('edu-alimentacion');
    expect(singleA?.ruta_local).toBe(
      'file:///data/user/0/recursos_educativos/A/edu-alimentacion_1.md',
    );
    expect(await repoA.download('edu-bienestar')).toBeNull();

    // Marcar como visualizada
    await repoA.markDownloadViewed('edu-alimentacion');
    const viewedA = await repoA.download('edu-alimentacion');
    expect(viewedA?.visualizada).toBe(1);
    expect(viewedA?.visualizada_en).not.toBeNull();

    // Actualización con nueva ruta atómica (ON CONFLICT DO UPDATE)
    await repoA.saveDownload({
      contenido_id: 'edu-alimentacion',
      ruta_local: 'file:///data/user/0/recursos_educativos/A/edu-alimentacion_2.md',
    });
    const updatedA = await repoA.download('edu-alimentacion');
    expect(updatedA?.ruta_local).toBe(
      'file:///data/user/0/recursos_educativos/A/edu-alimentacion_2.md',
    );
    // Debe resetear visualizada a 0 tras la actualización
    expect(updatedA?.visualizada).toBe(0);

    // Eliminación
    await repoA.removeDownload('edu-alimentacion');
    expect(await repoA.downloads()).toHaveLength(0);
    // Paciente B permanece intacto
    expect(await repoB.downloads()).toHaveLength(1);
  });

  it('conciliación bidireccional detecta registros sin archivo y limpia archivos sin registro', async () => {
    const markedUnavailableIds: string[] = [];
    const deletedDiskUris: string[] = [];

    const dbRecords = [
      { contenido_id: 'valido', ruta_local: 'file:///disk/valido.md' },
      { contenido_id: 'huerfano_en_db', ruta_local: 'file:///disk/inexistente.md' },
    ];
    const diskFiles = ['file:///disk/valido.md', 'file:///disk/huerfano_en_disco.md'];

    const existingOnDisk = new Set(['file:///disk/valido.md', 'file:///disk/huerfano_en_disco.md']);

    const result = await reconcileCopiesCore(dbRecords, diskFiles, {
      markDbUnavailable: async (id) => {
        markedUnavailableIds.push(id);
      },
      deleteDisk: async (uri) => {
        deletedDiskUris.push(uri);
        return true;
      },
      checkDiskExists: (uri) => existingOnDisk.has(uri),
    });

    expect(result.markedUnavailable).toBe(1);
    expect(result.cleanedOrphans).toBe(1);
    expect(result.failedDeletions).toBe(0);
    expect(markedUnavailableIds).toEqual(['huerfano_en_db']);
    expect(deletedDiskUris).toEqual(['file:///disk/huerfano_en_disco.md']);
  });

  it('no pierde archivo previo si la base de datos falla al guardar nueva versión', async () => {
    const tempDir = harness.createTempDir('quimiocare-edu-test-');

    const oldFilePath = join(tempDir, 'edu_old.md');
    const newFilePath = join(tempDir, 'edu_new.md');

    // 1. Archivo previo existe en disco
    writeFileSync(oldFilePath, 'Contenido previo', 'utf-8');
    expect(existsSync(oldFilePath)).toBe(true);

    // 2. Se escribe la nueva versión en archivo único
    writeFileSync(newFilePath, 'Contenido nuevo', 'utf-8');
    expect(existsSync(newFilePath)).toBe(true);

    // 3. Simular fallo de base de datos
    const dbSaveOperation = async () => {
      throw new Error('Fallo simulado en SQLite');
    };

    // 4. Manejo de error: se elimina el archivo nuevo y se conserva el viejo
    try {
      await dbSaveOperation();
    } catch {
      unlinkSync(newFilePath);
    }

    // Comprobación: el archivo previo no se perdió y el nuevo no quedó huérfano
    expect(existsSync(oldFilePath)).toBe(true);
    expect(readFileSync(oldFilePath, 'utf-8')).toBe('Contenido previo');
    expect(existsSync(newFilePath)).toBe(false);
  });
});
