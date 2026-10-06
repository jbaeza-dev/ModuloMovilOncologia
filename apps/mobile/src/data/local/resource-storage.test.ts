import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { FileStorageAdapter } from './file-storage-adapter';
import { NodeFileStorageAdapter } from './node-file-storage-adapter';
import { reconcileCopiesCore } from './reconciliation';
import {
  assertSafeId,
  assertSafeVersion,
  cleanDanglingTempFiles,
  deleteResourceFile,
  isPathInPatientResourceDirectory,
  isResourceFileForContent,
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

  it('protege simultáneamente .tmp y .md en activeWrites durante escrituras pausadas concurrentes', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId);

    let resolveWritePause: () => void = () => {};
    const writePausedPromise = new Promise<void>((res) => {
      resolveWritePause = res;
    });

    let pauseStartedResolve: () => void = () => {};
    const pauseStartedPromise = new Promise<void>((res) => {
      pauseStartedResolve = res;
    });

    // Adaptador con escritura temporal pausada deliberadamente
    const slowAdapter: FileStorageAdapter = {
      ...adapter,
      exists: (p) => adapter.exists(p),
      readText: (p) => adapter.readText(p),
      deleteFile: (p) => adapter.deleteFile(p),
      moveFile: (src, dst, opts) => adapter.moveFile(src, dst, opts),
      listDirectory: (p) => adapter.listDirectory(p),
      ensureDirectory: (p) => adapter.ensureDirectory(p),
      writeText: async (p, c) => {
        await adapter.writeText(p, c);
        if (p.endsWith('.tmp')) {
          pauseStartedResolve();
          // Simula retardo o trabajo asíncrono largo en el temporal
          await writePausedPromise;
        }
      },
    };

    // Iniciar guardado con compensación en segundo plano
    const savePromise = saveResourceWithCompensation(
      patientA,
      'recurso-concurrente',
      '# Contenido en proceso',
      async () => {},
      slowAdapter,
      resolver,
    );

    // Esperar a que la escritura del temporal haya comenzado y esté pausada
    await pauseStartedPromise;

    // Obtener los archivos en el directorio mientras la escritura está pausada
    const filesDuringPause = await adapter.listDirectory(resolver(patientA));
    const inFlightTmp = filesDuringPause.find((f) => f.endsWith('.tmp'));
    expect(inFlightTmp).toBeDefined();

    // Ejecutar limpieza y conciliación concurrentemente mientras la escritura sigue pausada
    const cleanedDuringPause = await cleanDanglingTempFiles(patientA, adapter, resolver);
    // cleanDanglingTempFiles NO debió borrar el .tmp porque está protegido en activeWrites
    expect(cleanedDuringPause).toBe(0);
    expect(await adapter.exists(inFlightTmp!)).toBe(true);

    const reconcileResult = await reconcileCopiesCore(
      [],
      [inFlightTmp!],
      {
        markDbUnavailable: async () => {},
        deleteDisk: async () => true,
        checkDiskExists: () => true,
      },
      new Set(filesDuringPause), // Las escrituras activas se protegen en conciliación
    );
    expect(reconcileResult.cleanedOrphans).toBe(0);
    expect(await adapter.exists(inFlightTmp!)).toBe(true);

    // Reanudar la escritura
    resolveWritePause();
    const finalUri = await savePromise;

    // La escritura finalizó con éxito en .md
    expect(await adapter.exists(finalUri)).toBe(true);
    expect(await adapter.readText(finalUri)).toBe('# Contenido en proceso');
  });

  it('distingue con precisión identificadores para evitar colisiones por prefijo (guia vs guia_extra y guia vs guia_123)', async () => {
    // 1. Pruebas directas de isResourceFileForContent
    expect(isResourceFileForContent('guia.md', 'guia')).toBe(true);
    expect(isResourceFileForContent('guia.1791157123508.md', 'guia')).toBe(true);
    expect(isResourceFileForContent('guia.123.md', 'guia')).toBe(true);

    // No debe coincidir con recursos de IDs distintos ni formatos ambiguos
    expect(isResourceFileForContent('guia_extra.md', 'guia')).toBe(false);
    expect(isResourceFileForContent('guia_extra.1791157123508.md', 'guia')).toBe(false);
    expect(isResourceFileForContent('guia_nutricion_1.md', 'guia')).toBe(false);
    expect(isResourceFileForContent('guia_abc.md', 'guia')).toBe(false);
    // El archivo de guia_123.md NO debe coincidir al buscar guia
    expect(isResourceFileForContent('guia_123.md', 'guia')).toBe(false);

    // Pero sí debe coincidir con su propio contenidoId completo
    expect(isResourceFileForContent('guia_extra.1791157123508.md', 'guia_extra')).toBe(true);
    expect(isResourceFileForContent('guia_extra.md', 'guia_extra')).toBe(true);
    expect(isResourceFileForContent('guia_123.md', 'guia_123')).toBe(true);
    expect(isResourceFileForContent('guia_123.1791157123508.md', 'guia_123')).toBe(true);
  });

  it('valida pertenencia estricta al directorio del paciente y rechaza rutas ajenas o transversales', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId);

    const patientADir = resolver(patientA);
    const patientBDir = resolver('22222222-2222-4222-8222-222222222222');
    await adapter.ensureDirectory(patientADir);
    await adapter.ensureDirectory(patientBDir);

    const validPathA = join(patientADir, 'guia.123.md');
    const pathB = join(patientBDir, 'guia.123.md');
    const traversalPath = join(patientADir, '../malicioso.md');
    const systemPath = '/etc/passwd';

    await adapter.writeText(validPathA, '# Guia A');
    await adapter.writeText(pathB, '# Guia B');

    // Comprobaciones de pertenencia
    expect(isPathInPatientResourceDirectory(validPathA, patientA, 'guia', resolver)).toBe(true);
    // El archivo de Paciente B no pertenece al directorio de Paciente A
    expect(isPathInPatientResourceDirectory(pathB, patientA, 'guia', resolver)).toBe(false);
    // Rutas con traversal o externas son rechazadas
    expect(isPathInPatientResourceDirectory(traversalPath, patientA, 'guia', resolver)).toBe(false);
    expect(isPathInPatientResourceDirectory(systemPath, patientA, 'guia', resolver)).toBe(false);
    // Si el contenidoId no coincide, es rechazada
    expect(isPathInPatientResourceDirectory(validPathA, patientA, 'otra_guia', resolver)).toBe(
      false,
    );

    // deleteResourceFile rechaza borrar rutas que pertenezcan a otro paciente
    const deleteAttempt = await deleteResourceFile(patientA, 'guia', pathB);
    expect(deleteAttempt).toBe(false);
    // El archivo de Paciente B sigue existiendo intacto
    expect(await adapter.exists(pathB)).toBe(true);
  });

  it('borrar el recurso guia no elimina el archivo guia_123.md de otro recurso', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId);
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    const fileGuia = join(patientDir, 'guia.md');
    const fileGuia123 = join(patientDir, 'guia_123.md');

    await adapter.writeText(fileGuia, '# Contenido Guia');
    await adapter.writeText(fileGuia123, '# Contenido Guia 123');

    // Borrar exclusivamente la ruta de guia
    const deleted = await deleteResourceFile(patientA, 'guia', fileGuia, adapter, resolver);
    expect(deleted).toBe(true);
    expect(await adapter.exists(fileGuia)).toBe(false);
    // El archivo guia_123.md de otro recurso debe seguir intacto
    expect(await adapter.exists(fileGuia123)).toBe(true);
  });

  it('la conciliación no borra un archivo guardado recientemente si la lectura inicial de SQLite fue pausada', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId);
    await adapter.ensureDirectory(resolver(patientA));

    let unpauseSave: () => void = () => {};
    const saveAllowedPromise = new Promise<void>((r) => {
      unpauseSave = r;
    });

    let markSaveDone: () => void = () => {};
    const saveDonePromise = new Promise<void>((r) => {
      markSaveDone = r;
    });

    // Repositorio con base de datos en memoria para el test
    const fakeDb: Array<{ contenido_id: string; ruta_local: string | null; estado?: string }> = [];

    // Mock repository donde la primera lectura de downloads simula ser lenta o pausada
    let firstRead = true;
    const fakeRepo = {
      downloads: async () => {
        if (firstRead) {
          firstRead = false;
          // Permitir que el guardado ocurra mientras la conciliación leyó antes del commit
          unpauseSave();
          await saveDonePromise;
          // Devolver el snapshot viejo (vacío) previo al guardado
          return [];
        }
        // Lecturas posteriores devuelven el estado actualizado de la base de datos
        return [...fakeDb];
      },
      markDownloadUnavailable: async () => {},
    };

    // Tarea de guardado que se ejecutará mientras la lectura de conciliación estuvo en curso
    const runSaveTask = async () => {
      await saveAllowedPromise;
      await saveResourceWithCompensation(
        patientA,
        'recurso-nuevo',
        '# Nuevo recurso confirmado',
        async (uri) => {
          fakeDb.push({
            contenido_id: 'recurso-nuevo',
            ruta_local: uri,
            estado: 'descargado',
          });
        },
        adapter,
        resolver,
      );
      markSaveDone();
    };

    const saveBg = runSaveTask();

    // Ejecutar conciliación con comprobación protegida antes de borrar
    const initialRecords = await fakeRepo.downloads();
    await saveBg;

    // Obtener los archivos en disco (incluye el recién guardado)
    const diskFiles = await adapter.listDirectory(resolver(patientA));
    const newlySavedFile = diskFiles.find((f) => f.endsWith('.md'))!;
    expect(newlySavedFile).toBeDefined();

    // Conciliación utilizando el snapshot viejo inicial pero con isProtectedOrphan
    const concilResult = await reconcileCopiesCore(
      initialRecords, // snapshot viejo vacío
      diskFiles,
      {
        markDbUnavailable: async () => {},
        deleteDisk: async (uri) => adapter.deleteFile(uri),
        checkDiskExists: (uri) => adapter.exists(uri),
        isProtectedOrphan: async (uri) => {
          const fresh = await fakeRepo.downloads();
          const normUri = uri.replace(/\\/g, '/');
          return fresh.some(
            (r) =>
              r.ruta_local &&
              (r.ruta_local === uri || r.ruta_local.replace(/\\/g, '/') === normUri),
          );
        },
      },
    );

    // No debe borrarse el archivo recién confirmado
    expect(concilResult.cleanedOrphans).toBe(0);
    expect(await adapter.exists(newlySavedFile)).toBe(true);
  });
});
