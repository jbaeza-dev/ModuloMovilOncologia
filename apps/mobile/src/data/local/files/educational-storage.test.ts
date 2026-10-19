import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteTestHarness, patientA } from '../testing/sqlite-test-harness';
import {
  createMinimalJpeg,
  createMinimalPng,
  MAX_EDUCATIONAL_MEDIA_BYTES,
  parseImageHeader,
  saveEducationalMediaWithCompensation,
} from './educational-storage';
import { NodeFileStorageAdapter } from './node-file-storage-adapter';

const harness = createSqliteTestHarness();

afterEach(() => {
  harness.cleanup();
});

describe('educational-storage - validaciones binarias y guardado seguro de medios', () => {
  it('rechaza formato markdown para nuevas descargas', async () => {
    const tempBase = harness.createTempDir('storage-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-md-test',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formato: 'markdown' as any,
        content: '# Guía markdown no permitida',
        textoAccesible: 'Texto descriptivo',
        adapter,
        baseDirResolver,
        persistCopyInTx: async () => {},
      }),
    ).rejects.toThrow(/solo se admiten imágenes PNG y JPEG/i);
  });

  it('rechaza infografía si no incluye texto accesible o este es vacío', async () => {
    const tempBase = harness.createTempDir('storage-alt-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');
    const validPng = createMinimalPng(100, 100);

    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-no-alt',
        formato: 'png',
        content: validPng,
        textoAccesible: '   ',
        adapter,
        baseDirResolver,
        persistCopyInTx: async () => {},
      }),
    ).rejects.toThrow(/requiere un texto accesible no vacío/i);
  });

  it('rechaza archivos que superen el límite máximo de 5 MiB', async () => {
    const tempBase = harness.createTempDir('storage-size-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    // Crear buffer que supere 5 MiB (5 * 1024 * 1024 + 1 bytes)
    const oversizedBytes = new Uint8Array(MAX_EDUCATIONAL_MEDIA_BYTES + 1);

    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-oversized',
        formato: 'png',
        content: oversizedBytes,
        textoAccesible: 'Texto accesible',
        adapter,
        baseDirResolver,
        persistCopyInTx: async () => {},
      }),
    ).rejects.toThrow(/supera el tamaño máximo permitido de 5 MB/i);
  });

  it('rechaza archivos con cabecera binaria corrupta o desconocida', async () => {
    const tempBase = harness.createTempDir('storage-corrupt-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const corruptBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-corrupt',
        formato: 'png',
        content: corruptBytes,
        textoAccesible: 'Texto descriptivo',
        adapter,
        baseDirResolver,
        persistCopyInTx: async () => {},
      }),
    ).rejects.toThrow(/Formato de imagen no reconocido/i);
  });

  it('rechaza imágenes que superen el límite de 8 megapíxeles directamente desde su cabecera binaria', async () => {
    const tempBase = harness.createTempDir('storage-pixels-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    // 4000 x 2500 = 10,000,000 pixels > 8,000,000 pixels codificados en cabecera IHDR
    const oversizedPng = createMinimalPng(4000, 2500);

    // Sin pasar anchoPx ni altoPx en los parámetros: debe rechazarse por análisis binario
    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-high-res',
        formato: 'png',
        content: oversizedPng,
        textoAccesible: 'Texto alternativo accesible de la infografía.',
        adapter,
        baseDirResolver,
        persistCopyInTx: async () => {},
      }),
    ).rejects.toThrow(/supera la resolución máxima permitida de 8 megapíxeles/i);
  });

  it('admite imagen PNG válida de 3000x2000 extrayendo dimensiones de cabecera binaria', async () => {
    const tempBase = harness.createTempDir('storage-valid-png-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    // 3000 x 2000 = 6,000,000 pixels <= 8,000,000 pixels
    const validPng = createMinimalPng(3000, 2000);

    let persistedMeta: Record<string, unknown> | null = null;
    await saveEducationalMediaWithCompensation({
      pacienteId: patientA,
      contenidoId: 'edu-valid-res',
      formato: 'png',
      content: validPng,
      textoAccesible: 'Texto alternativo accesible de la infografía.',
      adapter,
      baseDirResolver,
      persistCopyInTx: async (params) => {
        persistedMeta = params.metadataLocal as Record<string, unknown>;
      },
    });

    expect(persistedMeta).not.toBeNull();
    expect(persistedMeta?.['anchoPx']).toBe(3000);
    expect(persistedMeta?.['altoPx']).toBe(2000);
    expect(persistedMeta?.['textoAccesible']).toBe('Texto alternativo accesible de la infografía.');
  });

  it('admite imagen JPEG válida extrayendo dimensiones de marcador SOF binario', async () => {
    const tempBase = harness.createTempDir('storage-valid-jpg-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    // JPEG 1920x1080 (2,073,600 px <= 8,000,000 px)
    const validJpeg = createMinimalJpeg(1920, 1080);
    const parsed = parseImageHeader(validJpeg);
    expect(parsed.format).toBe('jpeg');
    expect(parsed.width).toBe(1920);
    expect(parsed.height).toBe(1080);

    let persistedMeta: Record<string, unknown> | null = null;
    await saveEducationalMediaWithCompensation({
      pacienteId: patientA,
      contenidoId: 'edu-valid-jpeg',
      formato: 'jpeg',
      content: validJpeg,
      textoAccesible: 'Infografía en formato JPEG accesible.',
      adapter,
      baseDirResolver,
      persistCopyInTx: async (params) => {
        persistedMeta = params.metadataLocal as Record<string, unknown>;
      },
    });

    expect(persistedMeta).not.toBeNull();
    expect(persistedMeta?.['anchoPx']).toBe(1920);
    expect(persistedMeta?.['altoPx']).toBe(1080);
    expect(persistedMeta?.['textoAccesible']).toBe('Infografía en formato JPEG accesible.');
  });

  it('ejecuta compensación atómica si falla la persistencia en base de datos', async () => {
    const tempBase = harness.createTempDir('storage-comp-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const validBytes = createMinimalPng(200, 200);
    let createdUri: string | null = null;

    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-failing-tx',
        formato: 'png',
        content: validBytes,
        textoAccesible: 'Texto descriptivo accesible',
        adapter,
        baseDirResolver,
        persistCopyInTx: async (params) => {
          createdUri = params.rutaLocal;
          // Verificar que el archivo final ya existe en disco antes del commit
          expect(existsSync(createdUri)).toBe(true);
          throw new Error('Fallo simulado de base de datos');
        },
      }),
    ).rejects.toThrow('Fallo simulado de base de datos');

    // La compensación debe haber eliminado el archivo final de disco
    expect(createdUri).not.toBeNull();
    expect(existsSync(createdUri!)).toBe(false);
  });
});
