import { describe, expect, it, vi } from 'vitest';

import type { SqlConnection } from '../../data/local/core/sql';
import type { EducationalLocalCopy } from '../../data/local/education/education-types';
import type { PatientRepository } from '../../data/local/repository';
import { runBulkInfographicDownload, type BulkDownloadProgress } from './bulk-download-coordinator';
import { InMemoryEducationalCatalogReader } from './educational-catalog-service';
import * as storageService from './infographic-storage-service';
import * as resourceStorage from '../../data/local/files/resource-storage';

describe('Coordinador de descargas masivas de infografías (bulk-download-coordinator)', () => {
  const mockDatabase = {} as SqlConnection;

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
});
