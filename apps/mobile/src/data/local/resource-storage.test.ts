import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { FileStorageAdapter } from './files/file-storage-adapter';
import { NodeFileStorageAdapter } from './files/node-file-storage-adapter';
import { reconcileCopiesCore } from './files/reconciliation';
import {
  assertSafeId,
  assertSafeVersion,
  cleanDanglingTempFiles,
  deleteResourceFile,
  isPathInPatientResourceDirectory,
  isResourceFileForContent,
  readResourceFile,
  reconcileResourceCopies,
  registerActiveWrite,
  resourceFileExists,
  saveResourceWithCompensation,
} from './files/resource-storage';

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

    // No debe coincidir con recursos de IDs distintos ni formatos ambiguos sin allowLegacy
    expect(isResourceFileForContent('guia_extra.md', 'guia')).toBe(false);
    expect(isResourceFileForContent('guia_extra.1791157123508.md', 'guia')).toBe(false);
    expect(isResourceFileForContent('guia_nutricion_1.md', 'guia')).toBe(false);
    expect(isResourceFileForContent('guia_abc.md', 'guia')).toBe(false);
    // El archivo de guia_123.md NO debe coincidir al buscar guia sin allowLegacy
    expect(isResourceFileForContent('guia_123.md', 'guia')).toBe(false);

    // Con allowLegacy: true, admite formato histórico exacto ${contenidoId}_${digits}.md
    expect(isResourceFileForContent('guia_123.md', 'guia', { allowLegacy: true })).toBe(true);
    expect(isResourceFileForContent('guia_1791157123508.md', 'guia', { allowLegacy: true })).toBe(
      true,
    );
    // Pero NO admite prefijos diferentes aunque tengan guion bajo
    expect(isResourceFileForContent('guia_extra.md', 'guia', { allowLegacy: true })).toBe(false);

    // Pero sí debe coincidir con su propio contenidoId completo
    expect(isResourceFileForContent('guia_extra.1791157123508.md', 'guia_extra')).toBe(true);
    expect(isResourceFileForContent('guia_extra.md', 'guia_extra')).toBe(true);
    expect(isResourceFileForContent('guia_123.md', 'guia_123')).toBe(true);
    expect(isResourceFileForContent('guia_123.1791157123508.md', 'guia_123')).toBe(true);
  });

  it('permite leer, comprobar existencia y eliminar copias históricas registradas en SQLite con guion bajo', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId);
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    const legacyPath = join(patientDir, 'guia_1791157123508.md');
    await adapter.writeText(legacyPath, '# Guía histórica');

    // 1. resourceFileExists reconoce la ruta registrada exacta de SQLite
    const exists = resourceFileExists(patientA, 'guia', legacyPath, resolver);
    expect(exists).toBe(true);

    // 2. readResourceFile lee el contenido mediante la ruta registrada
    const content = await readResourceFile(patientA, 'guia', legacyPath, adapter, resolver);
    expect(content).toBe('# Guía histórica');

    // 3. deleteResourceFile sin rutaLocal NO borra copias con guion bajo (evita barridos ambiguos)
    const scanDelete = await deleteResourceFile(patientA, 'guia', null, adapter, resolver);
    expect(scanDelete).toBe(true);
    expect(await adapter.exists(legacyPath)).toBe(true);

    // 4. deleteResourceFile con la rutaLocal registrada exacta la elimina con éxito
    const exactDelete = await deleteResourceFile(patientA, 'guia', legacyPath, adapter, resolver);
    expect(exactDelete).toBe(true);
    expect(await adapter.exists(legacyPath)).toBe(false);
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

describe('almacenamiento multimedia educativo y compensación de colisiones', () => {
  it('guarda infografía PNG binaria calculando tamaño y SHA-256 sobre sus bytes reales', async () => {
    const tempDir = createTempDir();
    const resolver = (p: string) => join(tempDir, 'recursos_educativos', p);

    const { createMinimalPng, saveEducationalMediaWithCompensation } =
      await import('./files/educational-storage');

    // PNG válido de 33 bytes generado sintéticamente
    const pngBytes = createMinimalPng(10, 10);
    const persistedMetaHolder: {
      current?: {
        tamanoBytes: number;
        metadataLocal: { sha256?: string };
        formato: string;
      };
    } = {};

    const result = await saveEducationalMediaWithCompensation({
      pacienteId: patientA,
      contenidoId: 'edu-infografia-1',
      formato: 'png',
      content: pngBytes,
      textoAccesible: 'Infografía descriptiva accesible',
      versionOrigen: '1.0.0',
      mimeType: 'image/png',
      persistCopyInTx: async (params) => {
        persistedMetaHolder.current = params;
      },
      adapter,
      baseDirResolver: resolver,
    });

    expect(result.tamanoBytes).toBe(33);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedMetaHolder.current?.tamanoBytes).toBe(33);
    expect(persistedMetaHolder.current?.metadataLocal.sha256).toBe(result.sha256);
    expect(persistedMetaHolder.current?.formato).toBe('png');
    expect(adapter.exists(result.uri)).toBe(true);

    const readBack = await adapter.readBinary!(result.uri);
    expect(Array.from(readBack)).toEqual(Array.from(pngBytes));
  });

  it('elimina archivo creado si persistCopyInTx falla antes del commit', async () => {
    const tempDir = createTempDir();
    const resolver = (p: string) => join(tempDir, 'recursos_educativos', p);

    const { createMinimalPng, saveEducationalMediaWithCompensation } =
      await import('./files/educational-storage');

    let createdUri = '';

    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-infografia-error',
        formato: 'png',
        content: createMinimalPng(10, 10),
        textoAccesible: 'Texto accesible de prueba',
        persistCopyInTx: async (params) => {
          createdUri = params.rutaLocal;
          throw new Error('Fallo de base de datos antes del commit');
        },
        adapter,
        baseDirResolver: resolver,
      }),
    ).rejects.toThrow('Fallo de base de datos');

    expect(createdUri).toBeTruthy();
    expect(adapter.exists(createdUri)).toBe(false);
  });

  it('colisión con adaptador real: si moveFile falla porque el destino ya existe, la compensación conserva el destino preexistente', async () => {
    const tempDir = createTempDir();
    const resolver = (p: string) => join(tempDir, 'recursos_educativos', p);
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    const { createMinimalPng, saveEducationalMediaWithCompensation } =
      await import('./files/educational-storage');

    // Token determinista para forzar misma ruta destino
    const fixedToken = 'edu-infografia-colision.fixed-token';
    const initialBytes = createMinimalPng(10, 10);
    const collidingBytes = createMinimalPng(20, 20);

    // 1. Guardar primer archivo legítimo en el destino
    const firstResult = await saveEducationalMediaWithCompensation({
      pacienteId: patientA,
      contenidoId: 'edu-infografia-colision',
      formato: 'png',
      content: initialBytes,
      textoAccesible: 'Texto accesible inicial',
      tokenGenerator: () => fixedToken,
      persistCopyInTx: async () => {},
      adapter,
      baseDirResolver: resolver,
    });

    expect(adapter.exists(firstResult.uri)).toBe(true);
    const readInitial = await adapter.readBinary!(firstResult.uri);
    expect(Array.from(readInitial)).toEqual(Array.from(initialBytes));

    // 2. Segundo intento sobre el mismo destino usando el adaptador real NodeFileStorageAdapter
    // Dado que overwrite es false, moveFile rechazará con error al detectar el destino
    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-infografia-colision',
        formato: 'png',
        content: collidingBytes,
        textoAccesible: 'Texto accesible colisionante',
        tokenGenerator: () => fixedToken,
        persistCopyInTx: async () => {},
        adapter,
        baseDirResolver: resolver,
      }),
    ).rejects.toThrow(/ya existe/i);

    // 3. Comprobación de propiedad y preservación:
    // - El temporal del segundo intento fue limpiado por compensación
    const tmpUri = join(patientDir, `${fixedToken}.tmp`);
    expect(adapter.exists(tmpUri)).toBe(false);

    // - El destino original del primer intento se conservó intacto con sus bytes originales
    expect(adapter.exists(firstResult.uri)).toBe(true);
    const preservedBytes = await adapter.readBinary!(firstResult.uri);
    expect(Array.from(preservedBytes)).toEqual(Array.from(initialBytes));
  });

  it('compensación parcial: limpia el archivo temporal si la escritura falla antes de completarse', async () => {
    const tempDir = createTempDir();
    const resolver = (p: string) => join(tempDir, 'recursos_educativos', p);
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    const { createMinimalPng, saveEducationalMediaWithCompensation } =
      await import('./files/educational-storage');

    const fixedToken = 'edu-parcial.fixed-token';
    const tmpUri = join(patientDir, `${fixedToken}.tmp`);

    // Adaptador espía que escribe temporal pero luego lanza error simulando fallo de I/O parcial
    const partialFailureAdapter: FileStorageAdapter = Object.assign(Object.create(adapter), {
      async writeBinary(targetPath: string, content: Uint8Array) {
        // Escribe físicamente bytes parciales en disco antes de fallar
        await adapter.writeBinary!(targetPath, content.slice(0, 2));
        throw new Error('FALLO_IO_PARCIAL: Espacio insuficiente en disco');
      },
    });

    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-parcial',
        formato: 'png',
        content: createMinimalPng(10, 10),
        textoAccesible: 'Texto descriptivo parcial',
        tokenGenerator: () => fixedToken,
        persistCopyInTx: async () => {},
        adapter: partialFailureAdapter,
        baseDirResolver: resolver,
      }),
    ).rejects.toThrow('FALLO_IO_PARCIAL');

    // La compensación debe haber limpiado el temporal parcial dejado en disco
    expect(adapter.exists(tmpUri)).toBe(false);
  });

  it('deleteResourceFile verifica eliminación física y distingue ausencia confirmada de fallo', async () => {
    const tempDir = createTempDir();
    const resolver = (p: string) => join(tempDir, 'recursos_educativos', p);
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    const targetFile = join(patientDir, 'edu-prueba.png');
    await adapter.writeBinary!(targetFile, new Uint8Array([1, 2, 3]));
    expect(adapter.exists(targetFile)).toBe(true);

    // 1. Eliminación física confirmada cuando el archivo existe
    const deleted = await deleteResourceFile(patientA, 'edu-prueba', targetFile, adapter, resolver);
    expect(deleted).toBe(true);
    expect(adapter.exists(targetFile)).toBe(false);

    // 2. Ausencia confirmada cuando el archivo ya no existe físicamente en disco -> retorna true
    const alreadyAbsent = await deleteResourceFile(
      patientA,
      'edu-prueba',
      targetFile,
      adapter,
      resolver,
    );
    expect(alreadyAbsent).toBe(true);

    // 3. Fallo cuando el sistema de archivos no puede eliminar el archivo
    await adapter.writeBinary!(targetFile, new Uint8Array([1, 2, 3]));
    const lockedAdapter: FileStorageAdapter = Object.assign(Object.create(adapter), {
      async deleteFile() {
        return false; // Falla la eliminación
      },
    });
    const failedDelete = await deleteResourceFile(
      patientA,
      'edu-prueba',
      targetFile,
      lockedAdapter,
      resolver,
    );
    expect(failedDelete).toBe(false);
    expect(adapter.exists(targetFile)).toBe(true);
  });

  it('deleteResourceFile propaga errores de acceso en exists() en lugar de tratarlos como ausencia', async () => {
    const tempDir = createTempDir();
    const resolver = (p: string) => join(tempDir, 'recursos_educativos', p);
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    const targetFile = join(patientDir, 'edu-prueba.png');
    await adapter.writeBinary!(targetFile, new Uint8Array([1, 2, 3]));
    expect(adapter.exists(targetFile)).toBe(true);

    // Inyectar fallo de acceso / permisos en exists()
    const errorAdapter: FileStorageAdapter = Object.assign(Object.create(adapter), {
      exists(p: string) {
        if (p === targetFile) {
          throw new Error('EACCES: permission denied');
        }
        return adapter.exists(p);
      },
    });

    // Debe propagar la excepción de consulta en lugar de retornar true (que causaría borrado de SQLite)
    await expect(
      deleteResourceFile(patientA, 'edu-prueba', targetFile, errorAdapter, resolver),
    ).rejects.toThrow('EACCES: permission denied');

    // El archivo físico sigue intacto en disco
    expect(adapter.exists(targetFile)).toBe(true);
  });

  it('saveEducationalMediaWithCompensation limpia copia anterior tras confirmar la nueva', async () => {
    const tempDir = createTempDir();
    const resolver = (p: string) => join(tempDir, 'recursos_educativos', p);
    const { createMinimalPng, saveEducationalMediaWithCompensation } =
      await import('./files/educational-storage');

    // Guardado 1: Primera versión
    const res1 = await saveEducationalMediaWithCompensation({
      pacienteId: patientA,
      contenidoId: 'edu-infografia',
      formato: 'png',
      content: createMinimalPng(10, 10),
      textoAccesible: 'Texto inicial',
      adapter,
      baseDirResolver: resolver,
      persistCopyInTx: async () => {},
    });
    expect(adapter.exists(res1.uri)).toBe(true);

    // Guardado 2: Reemplazo pasando previousRutaLocal
    const res2 = await saveEducationalMediaWithCompensation({
      pacienteId: patientA,
      contenidoId: 'edu-infografia',
      formato: 'png',
      content: createMinimalPng(20, 20),
      textoAccesible: 'Texto actualizado',
      previousRutaLocal: res1.uri,
      adapter,
      baseDirResolver: resolver,
      persistCopyInTx: async () => {},
    });
    expect(adapter.exists(res2.uri)).toBe(true);

    // La copia anterior res1.uri debe haber sido limpiada del almacenamiento
    expect(adapter.exists(res1.uri)).toBe(false);
  });

  it('reconcileResourceCopies contempla PNG/JPEG, limpia huérfanos y preserva archivos desconocidos', async () => {
    const tempDir = createTempDir();
    const resolver = (p: string) => join(tempDir, 'recursos_educativos', p);
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    // 1. Archivo PNG huérfano legítimo (antigua versión reemplazada)
    const orphanPng = join(patientDir, 'edu-infografia.1700000000000.uuid1.png');
    await adapter.writeBinary!(orphanPng, new Uint8Array([1, 2, 3]));

    // 2. Archivo PNG activo en base de datos
    const activePng = join(patientDir, 'edu-infografia.1700000001000.uuid2.png');
    await adapter.writeBinary!(activePng, new Uint8Array([4, 5, 6]));

    // 3. Archivos desconocidos que no son recursos educativos (deben preservarse)
    const unknownFile = join(patientDir, 'mi_foto_personal.png');
    await adapter.writeBinary!(unknownFile, new Uint8Array([9, 9, 9]));

    const unknownDoc = join(patientDir, 'documento.pdf');
    await adapter.writeBinary!(unknownDoc, new Uint8Array([8, 8, 8]));

    const fakeRepo = {
      async downloads() {
        return [
          {
            contenido_id: 'edu-infografia',
            ruta_local: activePng,
            estado: 'descargado',
          },
        ];
      },
      async markDownloadUnavailable() {},
    };

    const result = await reconcileResourceCopies(patientA, fakeRepo, adapter, resolver);

    // Debe limpiar el PNG huérfano
    expect(result.cleanedOrphans).toBe(1);
    expect(adapter.exists(orphanPng)).toBe(false);

    // Debe conservar el PNG activo de SQLite
    expect(adapter.exists(activePng)).toBe(true);

    // Debe preservar intactos los archivos desconocidos
    expect(adapter.exists(unknownFile)).toBe(true);
    expect(adapter.exists(unknownDoc)).toBe(true);
  });

  it('reconcileResourceCopies conserva el estado previo y no marca como no disponible ante un error de acceso a disco', async () => {
    const tempDir = createTempDir();
    const resolver = (p: string) => join(tempDir, 'recursos_educativos', p);
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    const activeMd = join(patientDir, 'edu-guia.1700000000000.uuid.md');
    await adapter.writeText(activeMd, '# Guia');

    let markUnavailableCalled = false;
    const fakeRepo = {
      async downloads() {
        return [
          {
            contenido_id: 'edu-guia',
            ruta_local: activeMd,
            estado: 'descargado',
          },
        ];
      },
      async markDownloadUnavailable() {
        markUnavailableCalled = true;
      },
    };

    class AccessErrorAdapter extends NodeFileStorageAdapter {
      override exists(p: string): boolean {
        if (p === activeMd) {
          throw new Error('EACCES: permission denied, stat');
        }
        return super.exists(p);
      }
    }

    const failingAdapter = new AccessErrorAdapter();
    const result = await reconcileResourceCopies(patientA, fakeRepo, failingAdapter, resolver);

    // Ante el fallo de acceso, no debe marcarse como ausente en SQLite ni eliminarse
    expect(markUnavailableCalled).toBe(false);
    expect(result.markedUnavailable).toBe(0);
    expect(result.cleanedOrphans).toBe(0);
  });
});
