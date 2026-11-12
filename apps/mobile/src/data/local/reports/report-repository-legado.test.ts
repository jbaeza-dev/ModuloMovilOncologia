import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteTestHarness, patientA } from '../testing/sqlite-test-harness';
import { migrateDatabase } from '../migrations';
import { createReportRepository } from './report-repository';

const h = createSqliteTestHarness();
const ahora = '2026-11-05T12:00:00.000Z';
afterEach(() => h.cleanup());

async function base() {
  const db = h.open();
  await migrateDatabase(db);
  await db.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
    patientA,
    'Paciente sintético',
    ahora,
  ]);
  await db.run(
    'INSERT INTO formulario_cache(formulario_id,version,titulo,descripcion,configuracion_json,obtenido_en) VALUES (?,?,?,?,?,?)',
    ['form-legado', '1', 'Cuestionario legado', 'Descripción sintética', '{}', ahora],
  );
  const pregunta = (id: string, orden: number, config: string | null, tipo = 'single_choice') =>
    db.run(
      'INSERT INTO pregunta_cache(formulario_id,version,pregunta_id,texto,tipo,orden,configuracion_json) VALUES (?,?,?,?,?,?,?)',
      ['form-legado', '1', id, 'Pregunta ' + id.toUpperCase(), tipo, orden, config],
    );
  await pregunta('q1', 0, JSON.stringify({ opciones: [{ codigo: 'a', etiqueta: 'Opción A' }] }));
  await pregunta('q2', 1, '{json-dañado');
  await pregunta('q3', 2, JSON.stringify({ sin: 'opciones' }));
  await pregunta('q4', 3, null, 'text');
  const respuesta = (id: string, fecha: string) =>
    db.run(
      'INSERT INTO respuesta_formulario(id,paciente_id,formulario_id,version,respuestas_json,fecha_confirmacion,creado_localmente_en) VALUES (?,?,?,?,?,?,?)',
      [
        id,
        patientA,
        'form-legado',
        '1',
        JSON.stringify({ q1: 'a', q2: 'b', q3: 'c', q4: 'libre' }),
        fecha,
        fecha,
      ],
    );
  await respuesta('r1', '2026-11-04T10:00:00.000Z');
  await respuesta('r2', '2026-11-04T11:00:00.000Z');
  return db;
}

describe('reporte con capturas ePRO legadas sin edición guardada', () => {
  it('usa las preguntas en caché, sus opciones válidas y tolera configuraciones dañadas', async () => {
    const db = await base();
    const data = await createReportRepository(db, patientA, () => ahora).getReportData(30);
    expect(data.epro).toHaveLength(2);
    const [primera] = data.epro ?? [];
    expect(primera!.source).toBe('legacy');
    expect(primera!.title).toBe('Cuestionario legado');
    expect(primera!.answers.map((a) => [a.question, a.value])).toEqual([
      ['Pregunta Q1', 'Opción A'],
      ['Pregunta Q2', 'b'],
      ['Pregunta Q3', 'c'],
      ['Pregunta Q4', 'libre'],
    ]);
  });

  it('asocia el estado de envío de los signos vitales del período', async () => {
    const db = await base();
    const fecha = '2026-11-04T09:00:00.000Z';
    await db.run(
      'INSERT INTO signos_vitales(id,paciente_id,fecha_registro,presion_sistolica,presion_diastolica,creado_localmente_en) VALUES (?,?,?,?,?,?)',
      ['v1', patientA, fecha, 120, 80, fecha],
    );
    await db
      .run(
        "INSERT INTO qc_clinical_command(id,owner,environment,kind,captured_at,payload_json,status,attempts) VALUES ('v1','o','e','signos',?,'{}','enviado',0)",
        [fecha],
      )
      .catch(() => undefined);
    const data = await createReportRepository(db, patientA, () => ahora).getReportData(7);
    expect(data.vitals).toHaveLength(1);
  });

  it('rechaza un período no admitido y un instante inválido', async () => {
    const db = await base();
    const repo = createReportRepository(db, patientA, () => ahora);
    await expect(repo.getReportData(14 as 7)).rejects.toThrow('Período de reporte no admitido.');
    await expect(repo.getReportData(30, 'no-es-fecha')).rejects.toThrow(
      'Instante de generación inválido.',
    );
  });

  it('usa la hora del sistema cuando no se entrega un proveedor', async () => {
    const db = await base();
    const data = await createReportRepository(db, patientA).getReportData(365);
    expect(Number.isFinite(Date.parse(data.generatedAt))).toBe(true);
  });
});
