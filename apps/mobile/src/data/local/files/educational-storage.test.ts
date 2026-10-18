import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteTestHarness, patientA } from '../testing/sqlite-test-harness';
import {
  MAX_EDUCATIONAL_MEDIA_BYTES,
  saveEducationalMediaWithCompensation,
} from './educational-storage';
import { NodeFileStorageAdapter } from './node-file-storage-adapter';

const harness = createSqliteTestHarness();

afterEach(() => {
  harness.cleanup();
});

describe('educational-storage - validaciones y guardado seguro de medios', () => {
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
        adapter,
        baseDirResolver,
        persistCopyInTx: async () => {},
      }),
    ).rejects.toThrow(/solo se admiten imágenes PNG y JPEG/i);
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
        adapter,
        baseDirResolver,
        persistCopyInTx: async () => {},
      }),
    ).rejects.toThrow(/supera el tamaño máximo permitido de 5 MB/i);
  });

  it('rechaza imágenes que superen el límite de 8 megapíxeles', async () => {
    const tempBase = harness.createTempDir('storage-pixels-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const validBytes = new Uint8Array(1024); // 1 KB

    // 4000 x 2500 = 10,000,000 pixels > 8,000,000 pixels
    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-high-res',
        formato: 'png',
        content: validBytes,
        anchoPx: 4000,
        altoPx: 2500,
        adapter,
        baseDirResolver,
        persistCopyInTx: async () => {},
      }),
    ).rejects.toThrow(/supera la resolución máxima permitida de 8 megapíxeles/i);

    // 3000 x 2000 = 6,000,000 pixels <= 8,000,000 pixels (debe ser admitido)
    let persistedMeta: Record<string, unknown> | null = null;
    await saveEducationalMediaWithCompensation({
      pacienteId: patientA,
      contenidoId: 'edu-valid-res',
      formato: 'png',
      content: validBytes,
      anchoPx: 3000,
      altoPx: 2000,
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

  it('ejecuta compensación atómica si falla la persistencia en base de datos', async () => {
    const tempBase = harness.createTempDir('storage-comp-test-');
    const adapter = new NodeFileStorageAdapter();
    const baseDirResolver = (pid: string) => join(tempBase, 'recursos', pid).replace(/\\/g, '/');

    const validBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // Cabecera PNG
    let createdUri: string | null = null;

    await expect(
      saveEducationalMediaWithCompensation({
        pacienteId: patientA,
        contenidoId: 'edu-failing-tx',
        formato: 'png',
        content: validBytes,
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
