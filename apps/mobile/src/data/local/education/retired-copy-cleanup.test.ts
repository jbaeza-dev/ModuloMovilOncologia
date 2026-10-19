import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeFileStorageAdapter } from '../files/node-file-storage-adapter';
import { migrateDatabase } from '../migrations';
import { seedPatientContextIfEmpty } from '../repository';
import { createSqliteTestHarness, patientA, patientB } from '../testing/sqlite-test-harness';
import { cleanupRetiredEducationalCopies } from './retired-copy-cleanup';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('cleanupRetiredEducationalCopies - limpieza física recuperable de Markdown', () => {
  it('elimina físicamente copias retiradas y borra la fila en SQLite', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const tempBase = harness.createTempDir('cleanup-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const patientDir = baseDirResolver(patientA);
    mkdirSync(patientDir, { recursive: true });

    const filePath = join(patientDir, 'edu-guia.md').replace(/\\/g, '/');
    writeFileSync(filePath, '# Guía de prueba Markdown', 'utf8');

    // Insertar copia retirada en SQLite
    await database.run(
      `INSERT INTO descarga (
        paciente_id, contenido_id, ruta_local, estado, fecha_descarga,
        formato, retirado_en
      ) VALUES (?, 'edu-guia', ?, 'descargado', '2026-10-10T10:00:00Z', 'markdown', '2026-10-17T12:00:00Z')`,
      [patientA, filePath],
    );

    const result = await cleanupRetiredEducationalCopies(database, patientA, {
      adapter,
      baseDirResolver,
    });

    expect(result.processed).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);

    // Archivo físico eliminado
    expect(existsSync(filePath)).toBe(false);

    // Fila eliminada de SQLite
    const row = await database.first(
      'SELECT * FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
      [patientA, 'edu-guia'],
    );
    expect(row).toBeNull();
  });

  it('no toca copias activas de imágenes (retirado_en IS NULL)', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const tempBase = harness.createTempDir('cleanup-active-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const patientDir = baseDirResolver(patientA);
    mkdirSync(patientDir, { recursive: true });

    const imgPath = join(patientDir, 'edu-info.png').replace(/\\/g, '/');
    writeFileSync(imgPath, 'fake-png-bytes', 'utf8');

    // Copia activa
    await database.run(
      `INSERT INTO descarga (
        paciente_id, contenido_id, ruta_local, estado, fecha_descarga,
        formato, retirado_en
      ) VALUES (?, 'edu-info', ?, 'descargado', '2026-10-10T10:00:00Z', 'png', NULL)`,
      [patientA, imgPath],
    );

    const result = await cleanupRetiredEducationalCopies(database, patientA, {
      adapter,
      baseDirResolver,
    });

    expect(result.processed).toBe(0);
    expect(result.deleted).toBe(0);

    // Archivo físico y fila siguen intactos
    expect(existsSync(imgPath)).toBe(true);
    const row = await database.first(
      'SELECT * FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
      [patientA, 'edu-info'],
    );
    expect(row).not.toBeNull();
  });

  it('descarta el retiro si la fila fue reemplazada bajo bloqueo por una copia activa', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const tempBase = harness.createTempDir('cleanup-replaced-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const patientDir = baseDirResolver(patientA);
    mkdirSync(patientDir, { recursive: true });

    const newImgPath = join(patientDir, 'edu-info.png').replace(/\\/g, '/');
    writeFileSync(newImgPath, 'active-png-content', 'utf8');

    // Simular que en la tabla ya está la nueva copia activa (retirado_en = null)
    await database.run(
      `INSERT INTO descarga (
        paciente_id, contenido_id, ruta_local, estado, fecha_descarga,
        formato, retirado_en
      ) VALUES (?, 'edu-info', ?, 'descargado', '2026-10-18T10:00:00Z', 'png', NULL)`,
      [patientA, newImgPath],
    );

    const result = await cleanupRetiredEducationalCopies(database, patientA, {
      adapter,
      baseDirResolver,
    });

    expect(result.processed).toBe(0);
    expect(result.deleted).toBe(0);
    expect(existsSync(newImgPath)).toBe(true);
  });

  it('si el borrado físico falla, persiste el error en ultimo_error_retiro y se recupera en reintento', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const tempBase = harness.createTempDir('cleanup-fail-');
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const patientDir = baseDirResolver(patientA);
    mkdirSync(patientDir, { recursive: true });

    const filePath = join(patientDir, 'edu-guia-bloqueada.md').replace(/\\/g, '/');
    writeFileSync(filePath, '# Contenido bloqueado', 'utf8');

    await database.run(
      `INSERT INTO descarga (
        paciente_id, contenido_id, ruta_local, estado, fecha_descarga,
        formato, retirado_en
      ) VALUES (?, 'edu-guia-bloqueada', ?, 'descargado', '2026-10-10T10:00:00Z', 'markdown', '2026-10-17T12:00:00Z')`,
      [patientA, filePath],
    );

    // Mock adapter que falla en deleteFile
    let shouldFail = true;
    const failingAdapter = {
      async exists(path: string) {
        return existsSync(path);
      },
      async deleteFile(path: string) {
        if (shouldFail) {
          throw new Error('EBUSY: archivo bloqueado por otro proceso');
        }
        const realAdapter = new NodeFileStorageAdapter();
        await realAdapter.deleteFile(path);
      },
    } as unknown as NodeFileStorageAdapter;

    // Primer intento: falla el borrado
    const firstResult = await cleanupRetiredEducationalCopies(database, patientA, {
      adapter: failingAdapter,
      baseDirResolver,
    });

    expect(firstResult.failed).toBe(1);
    expect(firstResult.deleted).toBe(0);
    expect(firstResult.errors[0].error).toContain('EBUSY');

    // Verificar que la fila permanece en SQLite y tiene registrado ultimo_error_retiro
    const rowAfterFail = await database.first<{
      ultimo_error_retiro: string | null;
      retirado_en: string | null;
    }>(
      'SELECT ultimo_error_retiro, retirado_en FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
      [patientA, 'edu-guia-bloqueada'],
    );
    expect(rowAfterFail?.retirado_en).toBeTruthy();
    expect(rowAfterFail?.ultimo_error_retiro).toBe('EBUSY: archivo bloqueado por otro proceso');
    expect(existsSync(filePath)).toBe(true);

    // Segundo intento (recuperación durable tras reiniciar app o resolver bloqueo):
    shouldFail = false;
    const secondResult = await cleanupRetiredEducationalCopies(database, patientA, {
      adapter: failingAdapter,
      baseDirResolver,
    });

    expect(secondResult.failed).toBe(0);
    expect(secondResult.deleted).toBe(1);
    expect(existsSync(filePath)).toBe(false);

    // Fila eliminada de SQLite
    const rowAfterSuccess = await database.first(
      'SELECT * FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
      [patientA, 'edu-guia-bloqueada'],
    );
    expect(rowAfterSuccess).toBeNull();
  });

  it('rechaza rutas no seguras o ajenas al paciente sin borrar archivos ajenos', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const tempBase = harness.createTempDir('cleanup-security-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const patientBDir = baseDirResolver(patientB);
    mkdirSync(patientBDir, { recursive: true });

    // Archivo que pertenece a pacienteB
    const alienFile = join(patientBDir, 'edu-alien.md').replace(/\\/g, '/');
    writeFileSync(alienFile, '# Archivo de paciente B', 'utf8');

    // Fila corrupta o maliciosa en paciente A apuntando al archivo de paciente B
    await database.run(
      `INSERT INTO descarga (
        paciente_id, contenido_id, ruta_local, estado, fecha_descarga,
        formato, retirado_en
      ) VALUES (?, 'edu-alien', ?, 'descargado', '2026-10-10T10:00:00Z', 'markdown', '2026-10-17T12:00:00Z')`,
      [patientA, alienFile],
    );

    const result = await cleanupRetiredEducationalCopies(database, patientA, {
      adapter,
      baseDirResolver,
    });

    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.errors[0].error).toContain('seguro');

    // El archivo de paciente B NO fue eliminado
    expect(existsSync(alienFile)).toBe(true);
    expect(readFileSync(alienFile, 'utf8')).toBe('# Archivo de paciente B');
  });

  it('si deleteFile devuelve false, conserva la fila en SQLite y registra el error para reintento', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const tempBase = harness.createTempDir('cleanup-false-');
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const patientDir = baseDirResolver(patientA);
    mkdirSync(patientDir, { recursive: true });

    const filePath = join(patientDir, 'edu-false.md').replace(/\\/g, '/');
    writeFileSync(filePath, '# Contenido no borrado', 'utf8');

    await database.run(
      `INSERT INTO descarga (
        paciente_id, contenido_id, ruta_local, estado, fecha_descarga,
        formato, retirado_en
      ) VALUES (?, 'edu-false', ?, 'descargado', '2026-10-10T10:00:00Z', 'markdown', '2026-10-17T12:00:00Z')`,
      [patientA, filePath],
    );

    const mockAdapter = {
      async exists(path: string) {
        return existsSync(path);
      },
      async deleteFile() {
        // Devuelve false simulando fallo sin excepción
        return false;
      },
    } as unknown as NodeFileStorageAdapter;

    const result = await cleanupRetiredEducationalCopies(database, patientA, {
      adapter: mockAdapter,
      baseDirResolver,
    });

    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(0);
    expect(existsSync(filePath)).toBe(true);

    const row = await database.first<{ ultimo_error_retiro: string | null }>(
      'SELECT ultimo_error_retiro FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
      [patientA, 'edu-false'],
    );
    expect(row?.ultimo_error_retiro).toContain('false');
  });

  it('si adapter.exists lanza error, conserva la fila y registra el error de consulta', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const tempBase = harness.createTempDir('cleanup-exists-err-');
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const patientDir = baseDirResolver(patientA);
    mkdirSync(patientDir, { recursive: true });

    const filePath = join(patientDir, 'edu-exists-err.md').replace(/\\/g, '/');
    writeFileSync(filePath, '# Archivo con error de disco', 'utf8');

    await database.run(
      `INSERT INTO descarga (
        paciente_id, contenido_id, ruta_local, estado, fecha_descarga,
        formato, retirado_en
      ) VALUES (?, 'edu-exists-err', ?, 'descargado', '2026-10-10T10:00:00Z', 'markdown', '2026-10-17T12:00:00Z')`,
      [patientA, filePath],
    );

    const mockAdapter = {
      async exists() {
        throw new Error('EIO: error de lectura de inodo');
      },
      async deleteFile() {
        return true;
      },
    } as unknown as NodeFileStorageAdapter;

    const result = await cleanupRetiredEducationalCopies(database, patientA, {
      adapter: mockAdapter,
      baseDirResolver,
    });

    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(0);
    expect(existsSync(filePath)).toBe(true);

    const row = await database.first<{ ultimo_error_retiro: string | null }>(
      'SELECT ultimo_error_retiro FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
      [patientA, 'edu-exists-err'],
    );
    expect(row?.ultimo_error_retiro).toContain('EIO');
  });
});
