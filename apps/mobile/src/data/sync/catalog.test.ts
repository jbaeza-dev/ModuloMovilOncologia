import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommonPowerSyncDatabase } from '@powersync/common';
import { completeDefinition, publishCatalog } from './catalog';
import { createSqliteTestHarness, patientA, patientB } from '../local/testing/sqlite-test-harness';
import { migrateDatabase } from '../local/migrations';

const fixture = JSON.parse(
  readFileSync(resolve('packages/contracts/fixtures/casos-condiciones-tecnicas.json'), 'utf8'),
);
const form = {
  ...fixture.formulario,
  configuracion: fixture.configuracion_formulario_en_origen,
  eliminado: 0,
};
delete form.preguntas;
const questions: Record<string, unknown>[] = fixture.formulario.preguntas.map(
  (q: Record<string, unknown>) => ({ ...q, formulario_id: form.id, eliminado: 0 }),
);
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const server = (
  forms: Record<string, unknown>[],
  rows: Record<string, unknown>[],
  education: Record<string, unknown>[] = [],
) =>
  ({
    readTransaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        getAll: async (sql: string) =>
          sql.includes('FROM formulario')
            ? forms
            : sql.includes('FROM pregunta')
              ? rows
              : education,
      }),
  }) as unknown as CommonPowerSyncDatabase;

describe('P04 complete catalog publication', () => {
  it('retires a formerly published image only for the active patient, preserving unrelated legacy copies', async () => {
    const local = harness.open();
    await migrateDatabase(local);
    const image = {
      id: '8384c56c-0b01-5629-9108-0ec27217646e',
      titulo: 'Synthetic',
      descripcion: null,
      tipo: 'imagen',
      url: 'https://example.test/one.png',
      categoria: 'Synthetic',
      activo: 1,
      fecha_creacion: '2026-10-27T00:00:00Z',
      archivo_mime: 'image/png',
      archivo_tamano_bytes: 77,
      archivo_revision: '38a00cb5-7f84-5076-9c22-2378dad7ea71',
      archivo_sha256: 'a'.repeat(64),
    };
    for (const patient of [patientA, patientB]) {
      await local.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
        patient,
        'Synthetic',
        '2026-10-27T00:00:00Z',
      ]);
      for (const content of [image.id, 'legacy-image'])
        await local.run(
          "INSERT INTO descarga(paciente_id,contenido_id,formato) VALUES (?,?,'png')",
          [patient, content],
        );
    }
    await publishCatalog(server([], [], [image]), local, '2026-10-27T00:00:00Z', patientA);
    await publishCatalog(server([], [], []), local, '2026-10-27T01:00:00Z', patientA);
    const retired = await local.all<{ paciente_id: string; contenido_id: string }>(
      'SELECT paciente_id,contenido_id FROM descarga WHERE retirado_en IS NOT NULL',
    );
    expect(retired).toEqual([{ paciente_id: patientA, contenido_id: image.id }]);
  });
  it('preserves typed false and zero in conditional configuration', () => {
    const rows = structuredClone(questions);
    rows[1].configuracion = {
      depende_de: 'MADRE_DEMO',
      valor_activador: false,
      requerida_si_activa: false,
    };
    const definition = completeDefinition(form, rows);
    expect(definition.questions[1].configuracion).toEqual({
      depende_de: 'MADRE_DEMO',
      valor_activador: false,
      requerida_si_activa: false,
    });
  });
  it('rejects missing parents and cyclic dependencies', () => {
    const missing = structuredClone(questions);
    missing[1].configuracion = {
      depende_de: 'AUSENTE',
      valor_activador: 0,
      requerida_si_activa: true,
    };
    expect(() => completeDefinition(form, missing)).toThrow();
    const cyclic = structuredClone(questions);
    cyclic[0].configuracion = {
      depende_de: 'HIJA_DEMO',
      valor_activador: 0,
      requerida_si_activa: true,
    };
    expect(() => completeDefinition(form, cyclic)).toThrow('Ciclo');
  });
  it('rejects a numeric activator for a boolean parent instead of coercing false to zero', () => {
    const rows = structuredClone(questions);
    rows[1].configuracion = {
      depende_de: 'MADRE_DEMO',
      valor_activador: 0,
      requerida_si_activa: true,
    };
    expect(() => completeDefinition(form, rows)).toThrow('activador');
  });
  it('rejects malformed or duplicated option codes before displaying an edition', () => {
    const rows = structuredClone(questions);
    rows[0].tipo = 'opcion_unica';
    rows[0].opciones = [
      { codigo: 'A', etiqueta: 'A' },
      { codigo: 'A', etiqueta: 'Duplicado' },
    ];
    expect(() => completeDefinition(form, rows)).toThrow('duplicadas');
  });
  it('keeps the last coherent snapshot if a later checkpoint is incomplete', async () => {
    const local = harness.open();
    await migrateDatabase(local);
    await publishCatalog(server([form], questions), local, '2026-10-27T04:00:00Z');
    const before = await local.first('SELECT * FROM qc_definition_snapshot');
    await expect(
      publishCatalog(server([form], questions.slice(1)), local, '2026-10-27T05:00:00Z'),
    ).rejects.toThrow();
    expect(await local.first('SELECT * FROM qc_definition_snapshot')).toEqual(before);
  });
  it('retires an edition while preserving its immutable snapshot for pending work', async () => {
    const local = harness.open();
    await migrateDatabase(local);
    await publishCatalog(server([form], questions), local, '2026-10-27T04:00:00Z');
    const before = await local.first<{ snapshot_json: string }>(
      'SELECT snapshot_json FROM qc_definition_snapshot',
    );
    await publishCatalog(server([], []), local, '2026-10-27T05:00:00Z');
    expect(await local.first('SELECT snapshot_json,retired FROM qc_definition_snapshot')).toEqual({
      ...before,
      retired: 1,
    });
  });
  it('refuses changing an already published edition or publishing educational PDFs', async () => {
    const local = harness.open();
    await migrateDatabase(local);
    await publishCatalog(server([form], questions), local, '2026-10-27T04:00:00Z');
    await expect(
      publishCatalog(server([{ ...form, titulo: 'Changed edition' }], questions), local, 'later'),
    ).rejects.toThrow('cambió');
    await expect(
      publishCatalog(
        server([form], questions, [{ id: form.id, tipo: 'pdf', activo: 1 }]),
        local,
        'later',
      ),
    ).rejects.toThrow('educativo');
    expect(
      (await local.first<{ completed_at: string }>('SELECT * FROM qc_catalog_status'))
        ?.completed_at,
    ).toBe('2026-10-27T04:00:00Z');
  });
});
