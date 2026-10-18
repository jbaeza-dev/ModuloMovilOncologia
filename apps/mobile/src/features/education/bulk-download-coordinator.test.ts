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
  });
});
