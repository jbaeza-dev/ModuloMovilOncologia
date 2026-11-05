import { describe, expect, it, vi } from 'vitest';

import type { SqlConnection } from '../../data/local/core/sql';
import type { EducationalLocalCopy } from '../../data/local/education/education-types';
import type { PatientRepository } from '../../data/local/repository';
import { runBulkInfographicDownload, type BulkDownloadProgress } from './bulk-download-coordinator';
import {
  InMemoryEducationalCatalogReader,
  type EducationalCatalogReader,
} from './educational-catalog-service';
import * as storageService from './infographic-storage-service';
import * as resourceStorage from '../../data/local/files/resource-storage';

function createMockRepo(copies: EducationalLocalCopy[] = []): PatientRepository {
  return {
    education: {
      listLocalCopies: vi.fn().mockResolvedValue(copies),
      getLocalCopy: vi.fn().mockResolvedValue(null),
      removeLocalCopy: vi.fn().mockResolvedValue({ removed: true }),
      declareCopyReviewed: vi.fn().mockResolvedValue({ updated: true }),
    },
  } as unknown as PatientRepository;
}

describe('Coordinador de descargas masivas de infografías (bulk-download-coordinator)', () => {
  const mockDatabase = {} as SqlConnection;

  it('excluye videos y guías, descargando únicamente infografías', async () => {
    const catalog = new InMemoryEducationalCatalogReader([
      {
        id: 'res-vid-1',
        title: 'Video inducción',
        category: 1,
        categoryName: 'General',
        description: 'Video',
        type: 'video',
        version: '1.0.0',
      },
      {
        id: 'res-guia-1',
        title: 'Guía de cuidados',
        category: 1,
        categoryName: 'General',
        description: 'Guía texto',
        type: 'guia',
        version: '1.0.0',
      },
      {
        id: 'res-info-1',
        title: 'Infografía cuidados',
        category: 1,
        categoryName: 'General',
        description: 'Infografía imagen',
        type: 'infografia',
        version: '1.0.0',
      },
    ]);

    const repo = createMockRepo([]);
    const downloadSpy = vi
      .spyOn(storageService, 'downloadAndSaveInfographic')
      .mockResolvedValue(undefined);
    vi.spyOn(resourceStorage, 'resourceFileExists').mockReturnValue(false);

    const result = await runBulkInfographicDownload({
      patientId: 'paciente-1',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
    });

    expect(result.total).toBe(1);
    expect(result.downloaded).toBe(1);
    expect(result.cancelled).toBe(false);
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({ id: 'res-info-1' }),
      }),
    );
  });

  it('indica que ya está al día cuando todas las infografías existen físicamente', async () => {
    const catalog = new InMemoryEducationalCatalogReader([
      {
        id: 'res-info-1',
        title: 'Infografía 1',
        category: 1,
        categoryName: 'General',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
    ]);

    const existingCopies: EducationalLocalCopy[] = [
      {
        patientId: 'paciente-1',
        contentId: 'res-info-1',
        rutaRelativa: 'res-info-1.png',
        formato: 'png',
        tamanoBytes: 1024,
        descargadoEn: '2026-10-18T10:00:00Z',
        estado: 'descargado',
        revisionDeclarada: false,
        metadataLocal: {
          versionOrigen: '1.0.0',
        },
      },
    ];

    const repo = createMockRepo(existingCopies);
    const downloadSpy = vi
      .spyOn(storageService, 'downloadAndSaveInfographic')
      .mockResolvedValue(undefined);
    vi.spyOn(resourceStorage, 'resourceFileExists').mockReturnValue(true);

    const result = await runBulkInfographicDownload({
      patientId: 'paciente-1',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
    });

    expect(result.alreadyUpToDate).toBe(true);
    expect(result.downloaded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.message).toContain('ya están disponibles');
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it('emite actualizaciones de progreso progresivas durante la descarga', async () => {
    const catalog = new InMemoryEducationalCatalogReader([
      {
        id: 'info-1',
        title: 'Infografía A',
        category: 1,
        categoryName: 'Cat 1',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
      {
        id: 'info-2',
        title: 'Infografía B',
        category: 1,
        categoryName: 'Cat 1',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
    ]);

    const repo = createMockRepo([]);
    vi.spyOn(storageService, 'downloadAndSaveInfographic').mockResolvedValue(undefined);
    vi.spyOn(resourceStorage, 'resourceFileExists').mockReturnValue(false);

    const progressUpdates: BulkDownloadProgress[] = [];
    const result = await runBulkInfographicDownload({
      patientId: 'paciente-1',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
      onProgress: (p) => progressUpdates.push({ ...p }),
    });

    expect(result.downloaded).toBe(2);
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    expect(progressUpdates[0].total).toBe(2);
    expect(progressUpdates[progressUpdates.length - 1].percent).toBe(100);
  });

  it('soporta cancelación limpia interrumpiendo el bucle y preservando las ya descargadas', async () => {
    const catalog = new InMemoryEducationalCatalogReader([
      {
        id: 'info-1',
        title: 'Infografía A',
        category: 1,
        categoryName: 'Cat 1',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
      {
        id: 'info-2',
        title: 'Infografía B',
        category: 1,
        categoryName: 'Cat 1',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
      {
        id: 'info-3',
        title: 'Infografía C',
        category: 1,
        categoryName: 'Cat 1',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
    ]);

    const repo = createMockRepo([]);
    const abortController = new AbortController();

    vi.spyOn(resourceStorage, 'resourceFileExists').mockReturnValue(false);
    vi.spyOn(storageService, 'downloadAndSaveInfographic').mockImplementation(
      async ({ resource }) => {
        if (resource.id === 'info-1') {
          // Primera completada
          abortController.abort();
        }
      },
    );

    const result = await runBulkInfographicDownload({
      patientId: 'paciente-1',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
      signal: abortController.signal,
    });

    expect(result.cancelled).toBe(true);
    expect(result.downloaded).toBe(1);
    expect(result.message).toContain('cancelada');
    expect(result.message).toContain('1 infografía completada');
    expect(result.pendingResources.length).toBe(2);
    expect(result.pendingResources.map((r) => r.id)).toEqual(['info-2', 'info-3']);
  });

  it('actualiza infografías cuando la versión del catálogo es superior a la copia local existente', async () => {
    const catalog = new InMemoryEducationalCatalogReader([
      {
        id: 'info-upgrade',
        title: 'Guía de cuidados v2',
        category: 1,
        categoryName: 'General',
        description: 'Nueva versión actualizada',
        type: 'infografia',
        version: '2.0.0',
      },
    ]);

    const existingCopy: EducationalLocalCopy = {
      patientId: 'paciente-1',
      contentId: 'info-upgrade',
      rutaRelativa: 'info-upgrade.v1.png',
      formato: 'png',
      tamanoBytes: 2048,
      descargadoEn: '2026-10-01T10:00:00Z',
      estado: 'descargado',
      revisionDeclarada: false,
      metadataLocal: {
        versionOrigen: '1.0.0',
        titulo: 'Guía de cuidados v1',
      },
    };

    const repo = createMockRepo([existingCopy]);
    const downloadSpy = vi
      .spyOn(storageService, 'downloadAndSaveInfographic')
      .mockResolvedValue(undefined);
    vi.spyOn(resourceStorage, 'resourceFileExists').mockReturnValue(true);

    const result = await runBulkInfographicDownload({
      patientId: 'paciente-1',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
    });

    expect(result.alreadyUpToDate).toBe(false);
    expect(result.downloaded).toBe(1);
    expect(result.skipped).toBe(0);
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    // Debe pasar localCopy para asegurar compensación atómica conservando el archivo previo hasta el commit
    expect(downloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({ id: 'info-upgrade', version: '2.0.0' }),
        localCopy: expect.objectContaining({
          contentId: 'info-upgrade',
          metadataLocal: expect.objectContaining({ versionOrigen: '1.0.0' }),
        }),
      }),
    );
  });

  it('previene ejecuciones simultáneas para el mismo paciente uniendo la segunda llamada a la promesa en curso', async () => {
    const catalog = new InMemoryEducationalCatalogReader([
      {
        id: 'info-slow',
        title: 'Infografía pesada',
        category: 1,
        categoryName: 'General',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
    ]);

    const repo = createMockRepo([]);
    vi.spyOn(resourceStorage, 'resourceFileExists').mockReturnValue(false);

    let resolveDownload!: () => void;
    const downloadPromise = new Promise<void>((res) => {
      resolveDownload = res;
    });

    const downloadSpy = vi
      .spyOn(storageService, 'downloadAndSaveInfographic')
      .mockImplementation(async () => downloadPromise);

    // Lanzar dos descargas concurrentes para el mismo paciente
    const run1 = runBulkInfographicDownload({
      patientId: 'paciente-concurrente',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
    });

    const run2 = runBulkInfographicDownload({
      patientId: 'paciente-concurrente',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
    });

    // Desbloquear la descarga
    resolveDownload();

    const [res1, res2] = await Promise.all([run1, run2]);

    expect(res1).toBe(res2);
    expect(res1.downloaded).toBe(1);
    expect(downloadSpy).toHaveBeenCalledTimes(1);
  });

  it('registra fallos parciales, capturando errores y recursos pendientes para reintento', async () => {
    const catalog = new InMemoryEducationalCatalogReader([
      {
        id: 'info-ok',
        title: 'Infografía Exitosa',
        category: 1,
        categoryName: 'General',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
      {
        id: 'info-fail',
        title: 'Infografía con Fallo',
        category: 1,
        categoryName: 'General',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
    ]);

    const repo = createMockRepo([]);
    vi.spyOn(resourceStorage, 'resourceFileExists').mockReturnValue(false);
    vi.spyOn(storageService, 'downloadAndSaveInfographic').mockImplementation(
      async ({ resource }) => {
        if (resource.id === 'info-fail') {
          throw new Error('Disco lleno al guardar archivo');
        }
      },
    );

    const result = await runBulkInfographicDownload({
      patientId: 'paciente-1',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
    });

    expect(result.downloaded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toEqual({
      resourceId: 'info-fail',
      title: 'Infografía con Fallo',
      message: 'Disco lleno al guardar archivo',
    });
    expect(result.pendingResources.length).toBe(1);
    expect(result.pendingResources[0].id).toBe('info-fail');
    expect(result.message).toContain('Se guardaron 1 de 2 infografías. 1 pendiente.');
  });

  it('conecta la cancelación y el progreso del segundo consumidor a la sesión activa', async () => {
    const catalog = new InMemoryEducationalCatalogReader([
      {
        id: 'info-c1',
        title: 'Infografía Uno',
        category: 1,
        categoryName: 'General',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
      {
        id: 'info-c2',
        title: 'Infografía Dos',
        category: 1,
        categoryName: 'General',
        description: 'Desc',
        type: 'infografia',
        version: '1.0.0',
      },
    ]);

    const repo = createMockRepo([]);
    vi.spyOn(resourceStorage, 'resourceFileExists').mockReturnValue(false);

    let resolveFirstDownload!: () => void;
    let signalDownloadStarted!: () => void;
    const downloadStartedPromise = new Promise<void>((res) => {
      signalDownloadStarted = res;
    });
    const firstDownloadPromise = new Promise<void>((res) => {
      resolveFirstDownload = res;
    });

    const abortController2 = new AbortController();
    const progressUpdates2: BulkDownloadProgress[] = [];

    const downloadSpy = vi
      .spyOn(storageService, 'downloadAndSaveInfographic')
      .mockImplementation(async ({ resource }) => {
        if (resource.id === 'info-c1') {
          signalDownloadStarted();
          await firstDownloadPromise;
        }
      });

    // Primer consumidor inicia la descarga
    const run1 = runBulkInfographicDownload({
      patientId: 'paciente-cancel-share',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
    });

    // Esperar a que el primer recurso esté en vuelo
    await downloadStartedPromise;

    // Segundo consumidor se une con su propio AbortController y callback de progreso
    const run2 = runBulkInfographicDownload({
      patientId: 'paciente-cancel-share',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
      signal: abortController2.signal,
      onProgress: (p) => progressUpdates2.push({ ...p }),
    });

    // El segundo consumidor solicita cancelar mientras el primer recurso está en vuelo
    abortController2.abort();

    // Se completa el primer recurso que estaba en vuelo
    resolveFirstDownload();

    const [res1, res2] = await Promise.all([run1, run2]);

    expect(res1).toBe(res2);
    expect(res1.cancelled).toBe(true);
    expect(res1.downloaded).toBe(1);
    expect(res1.pendingResources.length).toBe(1);
    expect(res1.pendingResources[0].id).toBe('info-c2');
    expect(downloadSpy).toHaveBeenCalledTimes(1); // No intentó info-c2 tras la cancelación del segundo consumidor
    expect(progressUpdates2.length).toBeGreaterThanOrEqual(1); // El segundo consumidor recibió eventos de progreso
  });

  it('el porcentaje de progreso nunca retrocede cuando ocurren fallos en las descargas', async () => {
    const catalog = new InMemoryEducationalCatalogReader([
      {
        id: 'f-1',
        title: 'Infografía 1',
        category: 1,
        categoryName: 'General',
        description: 'D',
        type: 'infografia',
        version: '1.0.0',
      },
      {
        id: 'f-2',
        title: 'Infografía 2',
        category: 1,
        categoryName: 'General',
        description: 'D',
        type: 'infografia',
        version: '1.0.0',
      },
      {
        id: 'f-3',
        title: 'Infografía 3',
        category: 1,
        categoryName: 'General',
        description: 'D',
        type: 'infografia',
        version: '1.0.0',
      },
      {
        id: 'f-4',
        title: 'Infografía 4',
        category: 1,
        categoryName: 'General',
        description: 'D',
        type: 'infografia',
        version: '1.0.0',
      },
    ]);

    const repo = createMockRepo([]);
    vi.spyOn(resourceStorage, 'resourceFileExists').mockReturnValue(false);

    vi.spyOn(storageService, 'downloadAndSaveInfographic').mockImplementation(
      async ({ resource }) => {
        // Fallan los tres primeros recursos; solo el cuarto tiene éxito
        if (resource.id === 'f-1' || resource.id === 'f-2' || resource.id === 'f-3') {
          throw new Error('Fallo de red en descarga');
        }
      },
    );

    const progressHistory: number[] = [];
    const result = await runBulkInfographicDownload({
      patientId: 'paciente-progreso-no-decreciente',
      repository: repo,
      database: mockDatabase,
      catalogReader: catalog,
      onProgress: (p) => {
        progressHistory.push(p.percent);
      },
    });

    // Comprobar monotonicidad: cada porcentaje emitido debe ser mayor o igual al anterior
    for (let i = 1; i < progressHistory.length; i++) {
      expect(progressHistory[i]).toBeGreaterThanOrEqual(progressHistory[i - 1]);
    }

    // Al finalizar todos los intentos, el progreso de procesamiento alcanza el 100%
    expect(progressHistory[progressHistory.length - 1]).toBe(100);
    expect(result.downloaded).toBe(1);
    expect(result.failed).toBe(3);
    expect(result.message).toBe('Se guardaron 1 de 4 infografías. 3 pendientes.');
  });

  it('un segundo consumidor con señal y progreso no genera rechazos no manejados si la descarga compartida falla', async () => {
    const unhandledRejections: unknown[] = [];
    const handleUnhandled = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', handleUnhandled);

    try {
      let failCatalogPromise!: () => void;
      const catalogWait = new Promise<never>((_, reject) => {
        failCatalogPromise = () => reject(new Error('Fallo crítico al cargar catálogo'));
      });

      const failingCatalog: EducationalCatalogReader = {
        async getCategories() {
          return [];
        },
        async getAllResources() {
          return await catalogWait;
        },
        async getResourcesByCategory() {
          return [];
        },
        async getResourceById() {
          return null;
        },
      };

      const repo = createMockRepo([]);
      const abortController = new AbortController();
      const progressUpdates: BulkDownloadProgress[] = [];

      // Consumidor 1 inicia
      const run1 = runBulkInfographicDownload({
        patientId: 'paciente-error-compartido',
        repository: repo,
        database: mockDatabase,
        catalogReader: failingCatalog,
      });

      // Consumidor 2 se une con señal y listener de progreso
      const run2 = runBulkInfographicDownload({
        patientId: 'paciente-error-compartido',
        repository: repo,
        database: mockDatabase,
        catalogReader: failingCatalog,
        signal: abortController.signal,
        onProgress: (p) => progressUpdates.push(p),
      });

      // Desencadenar el fallo
      failCatalogPromise();

      // Ambos consumidores deben recibir el error original
      await expect(run1).rejects.toThrow('Fallo crítico al cargar catálogo');
      await expect(run2).rejects.toThrow('Fallo crítico al cargar catálogo');

      // Dar tiempo para procesar cualquier rechazo asíncrono pendiente
      await new Promise((r) => setTimeout(r, 50));

      // No deben existir rechazos de promesas huérfanos o no manejados
      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', handleUnhandled);
    }
  });
});

describe('Regulación de cuota de almacenamiento educativo (enforceEducationStorageQuota)', () => {
  it('no expulsa copias si el total de archivos y bytes está dentro de la cuota', async () => {
    const copies = [
      {
        contentId: 'info-1',
        estado: 'descargado',
        rutaRelativa: 'files/info-1.png',
        tamanoBytes: 1024,
        descargadoEn: '2026-11-01T10:00:00Z',
      },
      {
        contentId: 'info-2',
        estado: 'descargado',
        rutaRelativa: 'files/info-2.png',
        tamanoBytes: 2048,
        descargadoEn: '2026-11-02T10:00:00Z',
      },
    ];
    const repo = createMockRepo(copies as unknown as EducationalLocalCopy[]);
    const res = await storageService.enforceEducationStorageQuota({
      patientId: 'pac-1',
      repository: repo,
      maxCopies: 5,
      maxBytes: 10000,
    });
    expect(res.evictedCount).toBe(0);
    expect(res.freedBytes).toBe(0);
    expect(res.evictedIds).toEqual([]);
  });

  it('expulsa según política LRU cuando se excede maxCopies, respetando copias fijadas (conservar_offline)', async () => {
    const copies = [
      {
        contentId: 'info-antigua-fijada',
        estado: 'descargado',
        rutaRelativa: 'files/info-pin.png',
        tamanoBytes: 1000,
        descargadoEn: '2026-10-01T10:00:00Z',
        metadataLocal: { conservar_offline: true, ultimo_acceso_en: '2026-10-01T10:00:00Z' },
      },
      {
        contentId: 'info-mas-antigua',
        estado: 'descargado',
        rutaRelativa: 'files/info-old.png',
        tamanoBytes: 1000,
        descargadoEn: '2026-10-05T10:00:00Z',
        metadataLocal: { ultimo_acceso_en: '2026-10-05T10:00:00Z' },
      },
      {
        contentId: 'info-reciente',
        estado: 'descargado',
        rutaRelativa: 'files/info-new.png',
        tamanoBytes: 1000,
        descargadoEn: '2026-11-01T10:00:00Z',
        metadataLocal: { ultimo_acceso_en: '2026-11-01T10:00:00Z' },
      },
    ];
    const deleteFileSpy = vi.spyOn(resourceStorage, 'deleteResourceFile').mockResolvedValue(true);
    const dbRunSpy = vi.fn().mockResolvedValue({ changes: 1 });
    const mockDb = { run: dbRunSpy } as unknown as SqlConnection;
    const repo = createMockRepo(copies as unknown as EducationalLocalCopy[]);
    const res = await storageService.enforceEducationStorageQuota({
      patientId: 'pac-1',
      repository: repo,
      database: mockDb,
      maxCopies: 2,
      maxBytes: 100000,
    });
    expect(res.evictedCount).toBe(1);
    expect(res.evictedIds).toEqual(['info-mas-antigua']);
    expect(res.freedBytes).toBe(1000);
    expect(deleteFileSpy).toHaveBeenCalledWith('pac-1', 'info-mas-antigua', 'files/info-old.png');
    expect(dbRunSpy).toHaveBeenCalledWith(
      'UPDATE descarga SET estado = ?, ruta_local = NULL, metadata_local_json = ? WHERE paciente_id = ? AND contenido_id = ?',
      ['pendiente', expect.stringContaining('"expulsado_cuota":true'), 'pac-1', 'info-mas-antigua'],
    );
  });

  it('expulsa copias adicionales cuando el tamaño en bytes excede maxBytes', async () => {
    const copies = [
      {
        contentId: 'info-pesada-1',
        estado: 'descargado',
        rutaRelativa: 'files/pesada-1.png',
        tamanoBytes: 5000,
        descargadoEn: '2026-10-10T10:00:00Z',
      },
      {
        contentId: 'info-pesada-2',
        estado: 'descargado',
        rutaRelativa: 'files/pesada-2.png',
        tamanoBytes: 6000,
        descargadoEn: '2026-10-11T10:00:00Z',
      },
    ];
    vi.spyOn(resourceStorage, 'deleteResourceFile').mockResolvedValue(true);
    const removeCopySpy = vi.fn().mockResolvedValue({ removed: true });
    const repo = {
      ...createMockRepo(copies as unknown as EducationalLocalCopy[]),
      education: {
        listLocalCopies: vi.fn().mockResolvedValue(copies),
        removeLocalCopy: removeCopySpy,
      },
    } as unknown as PatientRepository;
    const res = await storageService.enforceEducationStorageQuota({
      patientId: 'pac-1',
      repository: repo,
      maxCopies: 10,
      maxBytes: 7000,
    });
    expect(res.evictedCount).toBe(1);
    expect(res.evictedIds).toEqual(['info-pesada-1']);
    expect(res.freedBytes).toBe(5000);
    expect(removeCopySpy).toHaveBeenCalledWith('info-pesada-1');
  });
});
