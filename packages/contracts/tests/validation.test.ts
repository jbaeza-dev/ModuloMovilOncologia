import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  operations,
  documents,
  findOperation,
  getOperation,
  validateRequest,
  validateResponse,
  assertRequest,
  ContractValidationError,
  compileAllOperationSchemas,
  parseQuery,
  validateEducationDocument,
  validateEproConfiguration,
  fixtures,
  fixtureImageUrl,
} from '../src/index.js';
import type { OperationId } from '../src/index.js';

const id = '550e8400-e29b-41d4-a716-446655440000';
const captured = '2026-10-25T10:20:30Z';
const signs = { id, fecha_registro: captured, pulso: 72, temperatura: 36.6 };

describe('versioned operation boundary', () => {
  it('preserves exactly 36 operations and their aliases/authoritative operationIds', () => {
    expect(operations).toHaveLength(36);
    expect(new Set(operations.map((op) => op.id)).size).toBe(36);
    expect(operations.filter((op) => op.service === 'clinical')).toHaveLength(16);
    expect(operations.filter((op) => op.service === 'gateway')).toHaveLength(13);
    expect(findOperation('clinical', 'post', '/api/v1/pacientes/me/signos-vitales')?.id).toBe(
      'C-06',
    );
    expect(findOperation('clinical', 'GET', '/not-a-route')).toBeUndefined();
    expect(() => getOperation('C-99' as OperationId)).toThrow('Unknown contract');
  });
  it('compiles every component, including 2020-12 conditional schemas', () => {
    const expected = Object.values(documents).reduce(
      (sum, doc) => sum + Object.keys(doc.components.schemas as object).length,
      0,
    );
    expect(compileAllOperationSchemas()).toBe(expected);
    expect(expected).toBeGreaterThan(60);
  });
  it.each(Object.values(fixtures.mobile.operaciones))(
    'checks the independent upstream response fixture $method $path',
    (fixture) => {
      const op = findOperation('clinical', fixture.method, fixture.path);
      expect(op).toBeDefined();
      const result = validateResponse(op!.id, fixture.response_status, fixture.response);
      if (op!.id === 'C-11' || op!.id === 'C-13') {
        // These upstream examples explicitly predate the required archivo_* publication metadata.
        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.keyword === 'required')).toBe(true);
      } else expect(result.errors).toEqual([]);
    },
  );
  it('accepts the verified image metadata instead of pretending an incomplete legacy image is published', () => {
    const image = fixtures.imageMetadata.contenido_educativo;
    expect(validateResponse('C-13', 200, image).errors).toEqual([]);
    expect(validateResponse('C-11', 200, { total: 1, contenidos: [image] }).errors).toEqual([]);
    expect(validateResponse('C-13', 200, { ...image, archivo_sha256: 'A'.repeat(64) }).valid).toBe(
      false,
    );
    expect(validateResponse('C-13', 200, { ...image, archivo_mime: null }).valid).toBe(false);
    const video = {
      ...image,
      tipo: 'video',
      archivo_mime: null,
      archivo_tamano_bytes: null,
      archivo_revision: null,
      archivo_sha256: null,
    };
    expect(validateResponse('C-13', 200, video).valid).toBe(true);
    expect(validateResponse('C-13', 200, { ...video, archivo_mime: 'video/mp4' }).valid).toBe(
      false,
    );
  });
  it('does not mutate request payloads, fill defaults or coerce clinical values', () => {
    const body = { ...signs, presion_arterial_sistolica: null };
    const before = structuredClone(body);
    expect(validateRequest('C-06', { body }).valid).toBe(true);
    expect(body).toEqual(before);
    expect(validateRequest('C-06', { body: { ...body, pulso: '72' } }).valid).toBe(false);
    expect(validateRequest('C-06', { body: { ...body, pulso: false } }).valid).toBe(false);
  });
  it.each([30, 250])(
    'accepts pulse boundary %s from schema without interpreting urgency',
    (pulso) => {
      expect(validateRequest('C-06', { body: { ...signs, pulso } }).valid).toBe(true);
    },
  );
  it.each([29, 251, 72.5])('rejects an out-of-schema pulse %s', (pulso) => {
    expect(validateRequest('C-06', { body: { ...signs, pulso } }).valid).toBe(false);
  });
  it('requires UUID/date with timezone but does not invent a mandatory blood-pressure pair', () => {
    expect(
      validateRequest('C-06', { body: { ...signs, presion_arterial_sistolica: 120 } }).valid,
    ).toBe(true);
    expect(validateRequest('C-06', { body: { ...signs, id: 'not-a-uuid' } }).valid).toBe(false);
    expect(
      validateRequest('C-06', { body: { ...signs, fecha_registro: '2026-10-25T10:20:30' } }).valid,
    ).toBe(false);
    expect(validateRequest('C-06').valid).toBe(false);
  });
  it('validates path UUIDs and requires the declared query parameter', () => {
    expect(validateRequest('C-09', { path: { formulario_id: id } }).valid).toBe(true);
    expect(validateRequest('C-09', { path: { formulario_id: 'bad' } }).valid).toBe(false);
    expect(validateRequest('C-09').valid).toBe(false);
  });
  it('parses query transport scalars without permissive numbers, duplicate values or body coercion', () => {
    const query = parseQuery('C-11', new URLSearchParams('limit=10&skip=0'));
    expect(query).toMatchObject({ limit: 10, skip: 0 });
    expect(validateRequest('C-11', { query }).valid).toBe(true);
    expect(
      validateRequest('C-11', { query: parseQuery('C-11', new URLSearchParams('limit=1e2')) })
        .valid,
    ).toBe(false);
    expect(
      validateRequest('C-11', { query: parseQuery('C-11', new URLSearchParams('limit=1&limit=2')) })
        .valid,
    ).toBe(false);
    expect(
      validateRequest('C-11', { query: parseQuery('C-11', { limit: '9999999999999999999999999' }) })
        .valid,
    ).toBe(false);
  });
  it('enforces strict own request fields and rejects body on a bodyless operation', () => {
    expect(validateRequest('D-01', { body: { paciente_demo: 'A' } }).valid).toBe(true);
    expect(validateRequest('D-01', { body: { paciente_demo: 'A', owner: 'B' } }).valid).toBe(false);
    expect(validateRequest('D-01', { body: { paciente_demo: 'C' } }).valid).toBe(false);
    expect(validateRequest('D-02', { body: { refresh_token: '' } }).valid).toBe(false);
    expect(validateRequest('C-01', { body: {} }).valid).toBe(false);
  });
  it('accepts literal false and 1..2000 message characters, rejects string booleans/history', () => {
    expect(validateRequest('G-06', { body: { mensaje: 'a', activar_alarmas: false } }).valid).toBe(
      true,
    );
    expect(validateRequest('G-06', { body: { mensaje: 'a'.repeat(2000) } }).valid).toBe(true);
    expect(validateRequest('G-06', { body: { mensaje: '' } }).valid).toBe(false);
    expect(validateRequest('G-06', { body: { mensaje: 'a'.repeat(2001) } }).valid).toBe(false);
    expect(
      validateRequest('G-06', { body: { mensaje: 'a', activar_alarmas: 'false' } }).valid,
    ).toBe(false);
    expect(validateRequest('G-06', { body: { mensaje: 'a', history: [] } }).valid).toBe(false);
  });
  it('rejects undeclared HTTP statuses and distinguishes JSON from binary', () => {
    expect(validateResponse('D-01', 299, {}).valid).toBe(false);
    expect(validateResponse('D-06', 200, new Uint8Array([1]), 'image/png').valid).toBe(true);
    expect(validateResponse('D-06', 200, 'bytes', 'image/png').valid).toBe(false);
    expect(validateResponse('D-06', 200, new Uint8Array([1]), 'application/pdf').valid).toBe(false);
  });
  it('keeps validation diagnostics free of submitted values', () => {
    let caught: unknown;
    try {
      assertRequest('G-06', { body: { mensaje: { patient: 'PRIVATE-CLINICAL-VALUE' } } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContractValidationError);
    expect(JSON.stringify(caught)).not.toContain('PRIVATE-CLINICAL-VALUE');
  });
});

describe('unchanged upstream and versioned own extensions', () => {
  it('all copied sources have their declared byte length/hash in upstream provenance', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../PROVENANCE.json', import.meta.url), 'utf8'),
    ) as {
      copied: Array<{ package: string; upstream: string; bytes: number; sha256: string }>;
    };
    const upstream = JSON.parse(
      readFileSync(new URL('../specs/upstream-manifest.json', import.meta.url), 'utf8'),
    ) as {
      archivos: Array<{ archivo: string; bytes: number; sha256: string }>;
    };
    expect(provenance.copied).toHaveLength(14);
    for (const entry of provenance.copied) {
      const bytes = readFileSync(new URL('../' + entry.package, import.meta.url));
      expect(bytes.byteLength).toBe(entry.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      const original = upstream.archivos.find((item) => item.archivo === entry.upstream);
      expect(original).toBeDefined();
      expect(original?.sha256).toBe(entry.sha256);
    }
  });
  it('provides exact image bytes and metadata usable after compilation', () => {
    const bytes = readFileSync(fixtureImageUrl);
    const metadata = fixtures.imageMetadata.contenido_educativo;
    expect(bytes.byteLength).toBe(metadata.archivo_tamano_bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.archivo_sha256);
  });
  it('validates complete dependency configuration strictly, preserving false without accepting incomplete dependencies', () => {
    expect(
      validateEproConfiguration({
        depende_de: 'P1',
        valor_activador: false,
        requerida_si_activa: false,
      }).valid,
    ).toBe(true);
    expect(validateEproConfiguration({ depende_de: 'P1', requerida_si_activa: false }).valid).toBe(
      false,
    );
    expect(
      validateEproConfiguration({
        depende_de: 'P1',
        valor_activador: false,
        requerida_si_activa: 0,
      }).valid,
    ).toBe(false);
    expect(validateEproConfiguration({ unknown: true }).valid).toBe(false);
  });
  const document = {
    id,
    profesional_id: id,
    titulo: 'Documento técnico sintético',
    descripcion: '',
    tipo: 'documento',
    formato: 'pdf',
    url: 'https://example.invalid/demo.pdf',
    categoria: 'quimioterapia',
    activo: true,
    fecha_creacion: captured,
    archivo_mime: 'application/pdf',
    archivo_tamano_bytes: 100,
    archivo_revision: id,
    archivo_sha256: 'a'.repeat(64),
  };
  it('allows a PDF only as own v1.1 representation and does not silently extend RC3.2', () => {
    expect(validateEducationDocument(document).errors).toEqual([]);
    expect(validateResponse('C-13', 200, document).valid).toBe(false);
    expect(validateEducationDocument({ ...document, archivo_mime: 'image/png' }).valid).toBe(false);
    expect(validateEducationDocument({ ...document, archivo_sha256: 'A'.repeat(64) }).valid).toBe(
      false,
    );
    expect(validateEducationDocument({ ...document, archivo_revision: null }).valid).toBe(false);
    expect(validateEducationDocument({ ...document, archivo_tamano_bytes: 0 }).valid).toBe(false);
    expect(validateEducationDocument({ ...document, categoria: '  ' }).valid).toBe(false);
    expect(validateEducationDocument({ ...document, activo: false }).valid).toBe(false);
  });
});
