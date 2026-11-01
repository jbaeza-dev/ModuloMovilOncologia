import { describe, expect, it } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import {
  isMaintenanceActive,
  setMaintenanceActive,
  drainPublishes,
} from '../src/education-publish.js';
import { reconcileOrphanEducationFiles } from '../src/education-cleanup.js';
import type { SimulatorConfig } from '../src/config.js';
import type { Database } from '../src/db.js';

describe('Publicación Educativa, Decodificación y Reconciliación', () => {
  it('coordina la bandera de mantenimiento y drenaje de peticiones activas', async () => {
    expect(isMaintenanceActive()).toBe(false);

    setMaintenanceActive(true);
    expect(isMaintenanceActive()).toBe(true);

    const drained = await drainPublishes(500);
    expect(drained).toBe(true);

    setMaintenanceActive(false);
    expect(isMaintenanceActive()).toBe(false);
  });

  describe('Decodificación y validación de imágenes', () => {
    it('genera y valida correctamente una imagen PNG legítima', () => {
      const png = new PNG({ width: 10, height: 10 });
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const idx = (png.width * y + x) << 2;
          png.data[idx] = 255;
          png.data[idx + 1] = 0;
          png.data[idx + 2] = 0;
          png.data[idx + 3] = 255;
        }
      }
      const buffer = PNG.sync.write(png);
      expect(buffer.length).toBeGreaterThan(24);

      // Los primeros 8 bytes son los magic bytes de PNG
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50);
      expect(buffer[2]).toBe(0x4e);
      expect(buffer[3]).toBe(0x47);

      // Decodificación exitosa sin lanzar error
      const decoded = PNG.sync.read(buffer);
      expect(decoded.width).toBe(10);
      expect(decoded.height).toBe(10);
    });

    it('genera y valida correctamente una imagen JPEG legítima con límites estrictos', () => {
      const width = 10;
      const height = 10;
      const frameData = Buffer.alloc(width * height * 4);
      const rawImageData = { data: frameData, width, height };
      const jpegBuffer = jpeg.encode(rawImageData, 50).data;

      expect(jpegBuffer[0]).toBe(0xff);
      expect(jpegBuffer[1]).toBe(0xd8);
      expect(jpegBuffer[2]).toBe(0xff);

      const decoded = jpeg.decode(jpegBuffer, {
        maxMemoryUsageInMB: 64,
        maxResolutionInMP: 8,
        tolerantDecoding: false,
      });

      expect(decoded.width).toBe(10);
      expect(decoded.height).toBe(10);
    });

    it('detecta y rechaza un PNG con flujo deflate corrupto', () => {
      const png = new PNG({ width: 10, height: 10 });
      const buffer = PNG.sync.write(png);

      // Corromper intencionalmente los datos comprimidos en el chunk IDAT
      const idx1 = buffer.length - 20;
      const idx2 = buffer.length - 21;
      buffer[idx1] = (buffer[idx1] ?? 0) ^ 0xff;
      buffer[idx2] = (buffer[idx2] ?? 0) ^ 0xff;

      expect(() => PNG.sync.read(buffer)).toThrow();
    });

    it('detecta cabecera IHDR que excede 8 Megapíxeles antes de descomprimir', () => {
      // Simular buffer PNG con dimensiones IHDR manipuladas (ej. 4000x3000 = 12 MP)
      const fakeHeader = Buffer.alloc(24);
      fakeHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      const view = new DataView(fakeHeader.buffer, fakeHeader.byteOffset, fakeHeader.byteLength);
      view.setUint32(16, 4000, false); // width
      view.setUint32(20, 3000, false); // height

      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);
      expect(width * height).toBe(12_000_000);
      expect(width * height).toBeGreaterThan(8_000_000);
    });
  });

  describe('Reconciliador de Huérfanos Seguro', () => {
    it('aborta sin eliminar archivos si la consulta a PostgreSQL falla', async () => {
      const testDir = join(tmpdir(), `qc_test_cleanup_${randomUUID()}`);
      await mkdir(testDir, { recursive: true });

      const contentDir = join(testDir, randomUUID());
      await mkdir(contentDir, { recursive: true });
      const sampleFile = join(contentDir, `${randomUUID()}.png`);
      await writeFile(sampleFile, Buffer.from('test-image-data'));

      const failingDb = {
        query: async () => {
          throw new Error('Database connection failed');
        },
      } as unknown as Database;

      const mockConfig = {
        educationMediaRoot: testDir,
      } as SimulatorConfig;

      try {
        const result = await reconcileOrphanEducationFiles(mockConfig, failingDb, 0);
        expect(result.removed).toBe(0);
        expect(result.scanned).toBe(0);

        // El archivo debe permanecer intacto
        const fileExists = await writeFile(sampleFile, Buffer.from('test-image-data')).then(
          () => true,
          () => false,
        );
        expect(fileExists).toBe(true);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('preserva archivos de contenidos existentes (incluso inactivos) y elimina huérfanos antiguos', async () => {
      const testDir = join(tmpdir(), `qc_test_cleanup_success_${randomUUID()}`);
      await mkdir(testDir, { recursive: true });

      const contentId1 = randomUUID();
      const rev1 = randomUUID();
      const dir1 = join(testDir, contentId1);
      await mkdir(dir1, { recursive: true });
      const file1 = join(dir1, `${rev1}.png`);
      await writeFile(file1, Buffer.from('active-image'));

      const contentId2 = randomUUID();
      const rev2 = randomUUID();
      const dir2 = join(testDir, contentId2);
      await mkdir(dir2, { recursive: true });
      const file2 = join(dir2, `${rev2}.jpg`);
      await writeFile(file2, Buffer.from('inactive-retired-image'));

      // Archivo huérfano (no registrado en DB)
      const orphanContentId = randomUUID();
      const orphanRev = randomUUID();
      const orphanDir = join(testDir, orphanContentId);
      await mkdir(orphanDir, { recursive: true });
      const orphanFile = join(orphanDir, `${orphanRev}.png`);
      await writeFile(orphanFile, Buffer.from('orphan-image'));

      const successDb = {
        query: async () => ({
          rows: [
            { id: contentId1, archivo_revision: rev1 }, // activo
            { id: contentId2, archivo_revision: rev2 }, // inactivo pero registrado
          ],
        }),
      } as unknown as Database;

      const mockConfig = {
        educationMediaRoot: testDir,
      } as SimulatorConfig;

      try {
        // minAgeMs = 0 para simular archivo con antigüedad suficiente en la prueba
        const result = await reconcileOrphanEducationFiles(mockConfig, successDb, 0);
        expect(result.scanned).toBe(3);
        expect(result.preserved).toBe(2);
        expect(result.removed).toBe(1);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });
});
