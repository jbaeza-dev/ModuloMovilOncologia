import { describe, expect, it } from 'vitest';
import type { FormQuestion } from '@quimiocare/contracts/forms';
import fixture from '../../../../../../packages/contracts/fixtures/epro-seguimiento-domiciliario-v1_1_0.json';
import { completeDefinition } from '../../sync/catalog';
import { contractForm } from '../../sync/contract-form';
import { reportEpro, type ReportEproRow } from './report-epro';

const definition = completeDefinition(
  { ...fixture.formulario, eliminado: false },
  fixture.formulario.preguntas.map((q) => ({
    ...q,
    formulario_id: fixture.formulario.id,
    eliminado: false,
  })),
);
const preguntas = contractForm(definition).preguntas;
const conOpciones = preguntas.find((q) => q.opciones && q.opciones.length > 0)!;
const fecha = '2026-11-05T12:00:00.000Z';

function fila(over: Partial<ReportEproRow> = {}): ReportEproRow {
  return {
    id: 'captura-1',
    formulario_id: String(fixture.formulario.id),
    version: String(fixture.formulario.version),
    respuestas_json: '{}',
    fecha_confirmacion: fecha,
    titulo: null,
    snapshot_json: null,
    status: null,
    owner: 'owner-1',
    environment: 'demo',
    ...over,
  };
}

function conSnapshot(answers: Record<string, unknown>, cambios: Record<string, unknown> = {}) {
  const snapshot = {
    id: 'captura-1',
    owner: 'owner-1',
    environment: 'demo',
    submittedAt: fecha,
    answers,
    definition,
    ...cambios,
  };
  return fila({
    respuestas_json: JSON.stringify(answers),
    snapshot_json: JSON.stringify(snapshot),
  });
}

describe('reportEpro: capturas históricas sin edición guardada', () => {
  it('ordena por código y traduce valores vacíos, lógicos, numéricos y listas', () => {
    const r = reportEpro(
      fila({
        respuestas_json: JSON.stringify({ b: true, a: null, c: '', d: false, e: 3, f: ['x', 'y'] }),
      }),
    );
    expect(r.title).toBe('Cuestionario histórico');
    expect(r.status).toBe('guardado_local');
    expect(r.source).toBe('legacy');
    expect(r.answers.map((a) => [a.code, a.question, a.value])).toEqual([
      ['a', 'Pregunta a', 'Sin respuesta'],
      ['b', 'Pregunta b', 'Sí'],
      ['c', 'Pregunta c', 'Sin respuesta'],
      ['d', 'Pregunta d', 'No'],
      ['e', 'Pregunta e', '3'],
      ['f', 'Pregunta f', 'x; y'],
    ]);
  });

  it('usa el título y estado guardados cuando existen', () => {
    const r = reportEpro(fila({ titulo: 'Seguimiento', status: 'enviado' }));
    expect(r.title).toBe('Seguimiento');
    expect(r.status).toBe('enviado');
  });

  it('con preguntas de respaldo usa su orden y las etiquetas de las opciones', () => {
    const opcion = conOpciones.opciones![0]!;
    const r = reportEpro(
      fila({ respuestas_json: JSON.stringify({ [conOpciones.id]: opcion.codigo }) }),
      preguntas as readonly FormQuestion[],
    );
    expect(r.answers).toEqual([
      { code: conOpciones.codigo, question: conOpciones.titulo, value: opcion.etiqueta },
    ]);
  });

  it('con preguntas de respaldo rechaza respuestas ajenas a la edición', () => {
    expect(() =>
      reportEpro(fila({ respuestas_json: '{"ajena":"x"}' }), preguntas as readonly FormQuestion[]),
    ).toThrow('Respuesta ajena a la edición histórica.');
  });

  it.each([
    ['respuestas que no son objeto', '[]', 'Respuesta histórica inválida para el reporte.'],
    ['un valor objeto', '{"a":{"x":1}}', 'Valor de respuesta no compatible.'],
    ['una lista con números', '{"a":[1]}', 'Valor de respuesta no compatible.'],
  ])('rechaza %s', (_caso, json, mensaje) => {
    expect(() => reportEpro(fila({ respuestas_json: json }))).toThrow(mensaje);
  });
});

describe('reportEpro: capturas con la edición guardada (snapshot)', () => {
  const opcion = conOpciones.opciones![0]!;
  const answers = { [conOpciones.id]: opcion.codigo };

  it('usa la edición guardada y su título', () => {
    const r = reportEpro(conSnapshot(answers));
    expect(r.source).toBe('snapshot');
    expect(r.title).toBe(String(definition.form.titulo));
    expect(r.answers[0]!.value).toBe(opcion.etiqueta);
  });

  it.each([
    ['otra captura', { id: 'otra' }],
    ['otro dueño', { owner: 'otro' }],
    ['otro ambiente', { environment: 'prod' }],
    ['otra fecha', { submittedAt: '2026-01-01T00:00:00.000Z' }],
    ['otras respuestas', { answers: { distinta: 'x' } }],
    ['definición inválida', { definition: 'texto' }],
  ])('rechaza un snapshot con %s', (_caso, cambios) => {
    expect(() => reportEpro(conSnapshot(answers, cambios))).toThrow(
      'El snapshot del reporte no coincide con su captura.',
    );
  });

  it('rechaza un snapshot que no es objeto', () => {
    expect(() =>
      reportEpro(fila({ respuestas_json: JSON.stringify(answers), snapshot_json: '"texto"' })),
    ).toThrow('El snapshot del reporte no coincide con su captura.');
  });

  it('rechaza una edición distinta a la de la captura', () => {
    expect(() => reportEpro({ ...conSnapshot(answers), version: '9.9.9' })).toThrow(
      'La edición del reporte no coincide con su captura.',
    );
    expect(() => reportEpro({ ...conSnapshot(answers), formulario_id: 'otro' })).toThrow(
      'La edición del reporte no coincide con su captura.',
    );
  });
});
