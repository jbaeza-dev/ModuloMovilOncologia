import { describe, expect, it } from 'vitest';
import { eligibleEducation, selectEducation, assertEducationRevisions } from './education-catalog';
const id = '8384c56c-0b01-5629-9108-0ec27217646e';
const image = {
  id,
  titulo: 'Imagen',
  descripcion: null,
  tipo: 'imagen',
  url: 'https://example.test/image.jpg',
  categoria: ' Alimentación ',
  activo: true,
  fecha_creacion: '2026-10-27T12:00:00Z',
  archivo_mime: 'image/jpeg',
  archivo_tamano_bytes: 34,
  archivo_revision: '38a00cb5-7f84-5076-9c22-2378dad7ea71',
  archivo_sha256: 'a'.repeat(64),
};
describe('published education subset', () => {
  it('normalizes only null description and keeps the exact category', () => {
    expect(eligibleEducation([image])[0]).toMatchObject({
      descripcion: '',
      categoria: ' Alimentación ',
    });
  });
  it.each([null, '', '  ', '\t\n'])('excludes category or URL %j', (value) => {
    expect(
      eligibleEducation([
        { ...image, categoria: value },
        { ...image, url: value },
      ]),
    ).toEqual([]);
  });
  it.each([
    { activo: false },
    { tipo: 'pdf' },
    { archivo_mime: 'image/webp' },
    { archivo_tamano_bytes: 0 },
    { archivo_tamano_bytes: 1.1 },
    { archivo_revision: 'bad' },
    { archivo_sha256: 'A'.repeat(64) },
  ])('excludes an unpublished image: %j', (patch) =>
    expect(eligibleEducation([{ ...image, ...patch }])).toEqual([]),
  );
  it('counts after filtering, before pagination, deduplicates and orders dates DESC/id ASC', () => {
    const b = { ...image, id: '8384c56c-0b01-5629-9108-0ec27217646f' };
    const older = {
      ...image,
      id: '8384c56c-0b01-5629-9108-0ec27217646a',
      fecha_creacion: '2026-10-26T12:00:00Z',
    };
    const result = selectEducation([older, b, image, image, { ...image, activo: false }], {
      limit: 1,
      skip: 1,
    });
    expect(result.total).toBe(3);
    expect(result.contenidos.map((x) => x.id)).toEqual([b.id]);
    expect(result.categorias).toEqual([' Alimentación ']);
    expect(selectEducation([image], { category: 'Alimentación' }).total).toBe(0);
  });
  it('fails conflicting IDs instead of silently picking an arbitrary version', () => {
    expect(() => eligibleEducation([image, { ...image, titulo: 'different' }])).toThrow(
      'contradictorias',
    );
  });
  it('includes videos only without file metadata', () => {
    const video = {
      ...image,
      tipo: 'video',
      archivo_mime: null,
      archivo_tamano_bytes: null,
      archivo_revision: null,
      archivo_sha256: null,
    };
    expect(eligibleEducation([video])).toHaveLength(1);
    expect(eligibleEducation([{ ...video, archivo_mime: 'video/mp4' }])).toHaveLength(0);
  });
  it('permits text-only updates but rejects a reused revision or URL after byte replacement', () => {
    expect(() =>
      assertEducationRevisions([image], eligibleEducation([{ ...image, titulo: 'new title' }])),
    ).not.toThrow();
    expect(() =>
      assertEducationRevisions(
        [image],
        eligibleEducation([{ ...image, archivo_sha256: 'b'.repeat(64) }]),
      ),
    ).toThrow();
    expect(() =>
      assertEducationRevisions(
        [image],
        eligibleEducation([
          {
            ...image,
            archivo_revision: '38a00cb5-7f84-5076-9c22-2378dad7ea72',
            archivo_sha256: 'b'.repeat(64),
          },
        ]),
      ),
    ).toThrow();
    expect(() =>
      assertEducationRevisions(
        [image],
        eligibleEducation([
          {
            ...image,
            url: 'https://example.test/new.jpg',
            archivo_revision: '38a00cb5-7f84-5076-9c22-2378dad7ea72',
            archivo_sha256: 'b'.repeat(64),
          },
        ]),
      ),
    ).not.toThrow();
  });
});
