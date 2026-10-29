import { describe, expect, it } from 'vitest';
import { createReplicatedEducationReader } from './replicated-education-reader';
const image = {
  id: '8384c56c-0b01-5629-9108-0ec27217646e',
  titulo: 'Synthetic',
  descripcion: 'Texto accesible',
  tipo: 'imagen',
  url: 'https://example.test/x.png',
  categoria: ' Categoría ',
  activo: 1,
  fecha_creacion: '2026-10-27T00:00:00Z',
  archivo_mime: 'image/png',
  archivo_tamano_bytes: 77,
  archivo_revision: '38a00cb5-7f84-5076-9c22-2378dad7ea71',
  archivo_sha256: 'a'.repeat(64),
};
describe('replicated reader has no fabricated sample fallback', () => {
  it('keeps category order from the publication rather than reordering the approved inventory alphabetically', async () => {
    const reader = createReplicatedEducationReader({
      status: async () => ({ completed_at: '2026-10-27T00:00:00Z', error_code: null }),
      education: async () => [
        { ...image, categoria: 'Unidad', fecha_creacion: '2026-10-28T00:00:00Z' },
        {
          ...image,
          id: '413f345c-2e9e-4c27-8ab6-ea6491be6e02',
          categoria: 'Cáncer',
          fecha_creacion: '2026-10-27T00:00:00Z',
        },
      ],
    });
    expect((await reader.getCategories()).map((category) => category.title)).toEqual([
      'Unidad',
      'Cáncer',
    ]);
  });
  it('requires a complete checkpoint even when individual rows exist', async () => {
    const reader = createReplicatedEducationReader({
      status: async () => null,
      education: async () => [image],
    });
    await expect(reader.getAllResources()).rejects.toThrow('completo');
  });
  it('derives only actual categories, preserves exact names and exposes verification metadata', async () => {
    const reader = createReplicatedEducationReader({
      status: async () => ({ completed_at: '2026-10-27T00:00:00Z', error_code: null }),
      education: async () => [image],
    });
    const categories = await reader.getCategories();
    expect(categories).toHaveLength(1);
    expect(categories[0].title).toBe(' Categoría ');
    expect(await reader.getResourcesByCategory(categories[0].id)).toHaveLength(1);
    expect((await reader.getResourceById(image.id))?.asset).toMatchObject({
      expectedBytes: 77,
      expectedSha256: 'a'.repeat(64),
    });
    expect(await reader.getResourceById('retired')).toBeNull();
  });
  it('keeps the last complete snapshot after an update error without inventing new resources', async () => {
    const reader = createReplicatedEducationReader({
      status: async () => ({ completed_at: '2026-10-27T00:00:00Z', error_code: 'INCOMPLETE' }),
      education: async () => [image],
    });
    expect(await reader.getAllResources()).toHaveLength(1);
  });
});
