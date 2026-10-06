import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeFileStorageAdapter } from './node-file-storage-adapter';
import { reconcileCopiesCore } from './reconciliation';
import {
  assertSafeId,
  assertSafeVersion,
  cleanDanglingTempFiles,
  registerActiveWrite,
  saveResourceWithCompensation,
} from './resource-storage';

const patientA = '11111111-1111-4111-8111-111111111111';
const temporaryDirs: string[] = [];
const adapter = new NodeFileStorageAdapter();

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'quimiocare-storage-test-'));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('validadores de seguridad por dominio', () => {
  it('assertSafeId valida identificadores alfanuméricos seguros y rechaza path traversal', () => {
    expect(() => assertSafeId('paciente-123_abc', 'id')).not.toThrow();
    expect(() => assertSafeId('edu-guia_01', 'id')).not.toThrow();

    expect(() => assertSafeId('../paciente', 'id')).toThrow('Identificador inválido');
    expect(() => assertSafeId('..\\etc\\passwd', 'id')).toThrow('Identificador inválido');
    expect(() => assertSafeId('archivo.json', 'id')).toThrow('Identificador inválido');
    expect(() => assertSafeId('id con espacios', 'id')).toThrow('Identificador inválido');
    expect(() => assertSafeId('', 'id')).toThrow('Identificador inválido');
  });

  it('assertSafeVersion admite versiones con punto y rechaza rutas o caracteres inválidos', () => {
    expect(() => assertSafeVersion('1.0', 'version')).not.toThrow();
    expect(() => assertSafeVersion('v2.1.0-beta', 'version')).not.toThrow();

    expect(() => assertSafeVersion('../1.0', 'version')).toThrow('Versión inválida');
    expect(() => assertSafeVersion('1.0/etc', 'version')).toThrow('Versión inválida');
    expect(() => assertSafeVersion('version con espacios', 'version')).toThrow('Versión inválida');
  });
});

describe('guardado seguro con compensación y control de escrituras en curso', () => {
  it('escribe el archivo con token sincronizado y confirma la ruta en la base de datos', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId);

    let savedUriInDb: string | null = null;
    const finalUri = await saveResourceWithCompensation(
      patientA,
      'recurso-nutricion',
      '# Guía de Nutrición',
      async (uri) => {
        savedUriInDb = uri;
      },
      adapter,
      resolver,
    );

    expect(finalUri).toBe(savedUriInDb);
    expect(await adapter.exists(finalUri)).toBe(true);
    expect(await adapter.readText(finalUri)).toBe('# Guía de Nutrición');
    // Verificar que no quedó ningún .tmp
    const files = await adapter.listDirectory(resolver(patientA));
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('ejecuta compensación eliminando el archivo físico si la inserción en base de datos falla', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId);

    let targetUriSeen: string | null = null;
    await expect(
      saveResourceWithCompensation(
        patientA,
        'recurso-fallido',
        'Contenido efímero',
        async (uri) => {
          targetUriSeen = uri;
          // Simular fallo de restricción o E/S en SQLite
          throw new Error('Fallo simulado en SQLite (FOREIGN KEY o UNIQUE error)');
        },
        adapter,
        resolver,
      ),
    ).rejects.toThrow('Fallo simulado en SQLite');

    expect(targetUriSeen).not.toBeNull();
    // La compensación debió eliminar el archivo .md huérfano
    expect(await adapter.exists(targetUriSeen!)).toBe(false);

    // Tampoco debe quedar ningún archivo .tmp
    const files = await adapter.listDirectory(resolver(patientA));
    expect(files).toHaveLength(0);
  });

  it('la conciliación no borra como huérfano un archivo con escritura en curso (activeWrites)', async () => {
    const baseDir = createTempDir();
    const inFlightUri = join(baseDir, 'recurso-en-vuelo.md');
    await adapter.writeText(inFlightUri, 'En escritura...');

    // 1. Sin activeWrites, un archivo que no está en la base de datos se borra como huérfano
    let diskDeleted = false;
    const resultSinActiveWrites = await reconcileCopiesCore(
      [],
      [inFlightUri],
      {
        markDbUnavailable: async () => {},
        deleteDisk: async () => {
          diskDeleted = true;
          return true;
        },
        checkDiskExists: () => true,
      },
      new Set(), // Vacío
    );
    expect(resultSinActiveWrites.cleanedOrphans).toBe(1);
    expect(diskDeleted).toBe(true);

    // 2. Con activeWrites (escritura en vuelo intercalada con conciliación)
    diskDeleted = false;
    const activeSet = new Set<string>([inFlightUri]);
    const resultConActiveWrites = await reconcileCopiesCore(
      [],
      [inFlightUri],
      {
        markDbUnavailable: async () => {},
        deleteDisk: async () => {
          diskDeleted = true;
          return true;
        },
        checkDiskExists: () => true,
      },
      activeSet,
    );

    // No se debe borrar el archivo en vuelo
    expect(resultConActiveWrites.cleanedOrphans).toBe(0);
    expect(diskDeleted).toBe(false);
  });

  it('marca registros como no disponibles ante archivo ausente en lugar de borrarlos', async () => {
    const nonExistentUri = '/ruta/ficticia/archivo_inexistente.md';
    let markedId: string | null = null;

    const result = await reconcileCopiesCore(
      [{ contenido_id: 'recurso-perdido', ruta_local: nonExistentUri, estado: 'descargado' }],
      [],
      {
        markDbUnavailable: async (id) => {
          markedId = id;
        },
        deleteDisk: async () => true,
        checkDiskExists: () => false,
      },
    );

    expect(result.markedUnavailable).toBe(1);
    expect(markedId).toBe('recurso-perdido');
  });

  it('contabiliza failedDeletions si el borrado de disco falla durante la conciliación', async () => {
    const orphanUri = '/ruta/huerfana.md';

    const result = await reconcileCopiesCore([], [orphanUri], {
      markDbUnavailable: async () => {},
      deleteDisk: async () => false, // Simular fallo de permisos o bloqueo de archivo
      checkDiskExists: () => true,
    });

    expect(result.cleanedOrphans).toBe(0);
    expect(result.failedDeletions).toBe(1);
  });

  it('cleanDanglingTempFiles elimina archivos .tmp huérfanos respetando escrituras activas', async () => {
    const baseDir = createTempDir();
    const patientDir = join(baseDir, patientA);
    await adapter.ensureDirectory(patientDir);

    const abandonedTmp = join(patientDir, 'abandonado_123.tmp');
    const inFlightTmp = join(patientDir, 'en_vuelo_456.tmp');
    const validMd = join(patientDir, 'guia_permanente.md');

    await adapter.writeText(abandonedTmp, 'basura antigua');
    await adapter.writeText(inFlightTmp, 'escribiendo...');
    await adapter.writeText(validMd, '# Guía permanente');

    // Registrar en_vuelo_456.tmp como escritura activa
    const unregister = registerActiveWrite(inFlightTmp);

    try {
      const cleaned = await cleanDanglingTempFiles(patientA, adapter, (p) => join(baseDir, p));
      expect(cleaned).toBe(1);

      expect(await adapter.exists(abandonedTmp)).toBe(false);
      expect(await adapter.exists(inFlightTmp)).toBe(true);
      expect(await adapter.exists(validMd)).toBe(true);
    } finally {
      unregister();
    }
  });
});
