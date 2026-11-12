import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { fixtures } from '@quimiocare/contracts';
import type { SqlClient } from '../src/db.js';
import { clinicalCrud, clinicalCrudPath } from '../src/preparation-clinical-crud.js';
import { manageData, managementPath } from '../src/preparation-management.js';

type Responder = (sql: string, params: unknown[]) => unknown[] | undefined;

/** Cliente SQL simulado: cada consulta se responde según el texto que contiene. */
function cliente(responder: Responder = () => []) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => ({
    rows: responder(sql, params) ?? [],
  }));
  return { db: { query } as unknown as SqlClient, query };
}

async function codigo(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (error) {
    return (error as { code?: string; codigo?: string; status?: number }).status;
  }
  return 'sin error';
}

const perfilBase = (
  fixtures.mobile as unknown as {
    operaciones: Record<string, { response: Record<string, unknown> }>;
  }
).operaciones['API-03']!.response;
const paciente = randomUUID();
const operador = randomUUID();

describe('rutas de gestión de preparación', () => {
  it('reconoce las rutas de consulta, desvinculación y edición', () => {
    expect(managementPath('pacientes/x/escenario', 'GET')).toBe(true);
    expect(managementPath('pacientes/x/desvincular', 'POST')).toBe(true);
    expect(managementPath('podcasts/x', 'PUT')).toBe(true);
    expect(managementPath('podcasts/x', 'PATCH')).toBe(false);
    expect(clinicalCrudPath('profesionales')).toBe(true);
    expect(clinicalCrudPath('pacientes/x/medicamentos/y', 'PUT')).toBe(true);
    expect(clinicalCrudPath('otra-ruta', 'POST')).toBe(false);
  });
});

describe('gestión de profesionales', () => {
  it('rechaza campos ajenos y un borrado con datos', async () => {
    const { db } = cliente();
    expect(await codigo(clinicalCrud(db, 'POST', 'profesionales', { otro: 1 }))).toBe(422);
    expect(
      await codigo(clinicalCrud(db, 'DELETE', `profesionales/${operador}`, { nombre: 'x' })),
    ).toBe(422);
  });

  it('lista todos y exige existencia al consultar uno', async () => {
    const { db, query } = cliente((sql, [id]) => (id ? [] : [{ operador_id: operador }]));
    const lista = await clinicalCrud(db, 'GET', 'profesionales', {});
    expect(lista.body).toEqual({ items: [{ operador_id: operador }] });
    expect(query.mock.calls[0]![1]).toEqual([null]);
    expect(await codigo(clinicalCrud(db, 'GET', `profesionales/${operador}`, {}))).toBe(404);
  });

  it('valida el alta: activo lógico, operador vigente, textos y perfil duplicado', async () => {
    const vacio = cliente();
    expect(
      await codigo(
        clinicalCrud(vacio.db, 'POST', 'profesionales', { operador_id: operador, activo: 'si' }),
      ),
    ).toBe(422);
    expect(
      await codigo(clinicalCrud(vacio.db, 'POST', 'profesionales', { operador_id: operador })),
    ).toBe(404);

    const conOperador = cliente((sql) =>
      sql.includes('qc_demo_operador') ? [{ id: operador }] : [],
    );
    const datos = { operador_id: operador, nombre: 'Dra. Sintética', especialidad: 'Oncología' };
    expect(
      await codigo(clinicalCrud(conOperador.db, 'POST', 'profesionales', { ...datos, nombre: 5 })),
    ).toBe(422);
    expect(await codigo(clinicalCrud(conOperador.db, 'POST', 'profesionales', datos))).toBe(409);

    const creado = cliente((sql) =>
      sql.includes('qc_demo_operador') ? [{ id: operador }] : [{ operador_id: operador }],
    );
    const alta = await clinicalCrud(creado.db, 'POST', 'profesionales', datos);
    expect(alta.status).toBe(201);
    expect(creado.query.mock.calls[1]![1]).toEqual([operador, 'Dra. Sintética', 'Oncología', true]);
  });

  it('valida la edición y conserva o desactiva según el método', async () => {
    const { db } = cliente();
    expect(await codigo(clinicalCrud(db, 'PUT', 'profesionales', {}))).toBe(422);
    expect(await codigo(clinicalCrud(db, 'PATCH', `profesionales/${operador}`, {}))).toBe(422);
    expect(
      await codigo(clinicalCrud(db, 'PUT', `profesionales/${operador}`, { operador_id: operador })),
    ).toBe(422);
    expect(await codigo(clinicalCrud(db, 'PUT', `profesionales/${operador}`, {}))).toBe(404);

    const viejo = { operador_id: operador, nombre: 'Antes', especialidad: 'Antes', activo: true };
    const conPerfil = cliente((sql, params) =>
      sql.startsWith('SELECT') ? [viejo] : [{ valores: params }],
    );
    expect(
      await codigo(
        clinicalCrud(conPerfil.db, 'PUT', `profesionales/${operador}`, { activo: 'no' }),
      ),
    ).toBe(422);
    const editado = await clinicalCrud(conPerfil.db, 'PUT', `profesionales/${operador}`, {
      especialidad: ' Cuidados paliativos ',
    });
    expect((editado.body as { valores: unknown[] }).valores).toEqual([
      operador,
      'Antes',
      'Cuidados paliativos',
      true,
    ]);
    const borrado = await clinicalCrud(conPerfil.db, 'DELETE', `profesionales/${operador}`, {});
    expect((borrado.body as { valores: unknown[] }).valores[3]).toBe(false);
  });
});

describe('gestión de medicamentos del perfil clínico', () => {
  const ruta = `pacientes/${paciente}/medicamentos`;
  const medicamento = {
    id: randomUUID(),
    medicamento_id: randomUUID(),
    nombre: 'Ondansetrón',
    dosis: '8 mg',
    frecuencia: 'Cada 8 horas',
    activo: true,
    fecha_inicio: '2026-11-01',
    fecha_termino: null,
  };
  const conPerfil = (perfil: Record<string, unknown> | null) =>
    cliente((sql) => (sql.startsWith('SELECT') ? [{ perfil_clinico: perfil }] : []));

  it('exige paciente con perfil clínico preparado', async () => {
    expect(await codigo(clinicalCrud(cliente().db, 'GET', ruta, {}))).toBe(404);
    expect(await codigo(clinicalCrud(conPerfil(null).db, 'GET', ruta, {}))).toBe(409);
  });

  it('trata una lista ausente como vacía y exige que el medicamento exista', async () => {
    const { db } = conPerfil({ medicamentos: 'no-es-lista' });
    expect((await clinicalCrud(db, 'GET', ruta, {})).body).toEqual({
      paciente_id: paciente,
      items: [],
    });
    expect(await codigo(clinicalCrud(db, 'GET', `${ruta}/${randomUUID()}`, {}))).toBe(404);
  });

  it('consulta uno y rechaza una edición sin identificador', async () => {
    const { db } = conPerfil({ ...perfilBase, medicamentos: [medicamento] });
    expect((await clinicalCrud(db, 'GET', `${ruta}/${medicamento.id}`, {})).body).toEqual(
      medicamento,
    );
    expect(await codigo(clinicalCrud(db, 'PUT', ruta, { medicamento: {} }))).toBe(422);
  });

  it.each([
    ['un campo ajeno', { color: 'azul' }],
    ['activo no lógico', { activo: 'si' }],
    ['un motivo vacío', { motivo: '  ' }],
    ['una fecha numérica', { fecha_inicio: 20261101 }],
    ['una fecha mal escrita', { fecha_inicio: '01-11-2026' }],
    ['una fecha inexistente', { fecha_inicio: '2026-02-30' }],
    ['un inicio posterior al término', { fecha_inicio: '2026-12-01', fecha_termino: '2026-11-01' }],
  ])('rechaza %s al editar', async (_caso, cambios) => {
    const { db } = conPerfil({ ...perfilBase, medicamentos: [medicamento] });
    expect(
      await codigo(clinicalCrud(db, 'PUT', `${ruta}/${medicamento.id}`, { medicamento: cambios })),
    ).toBe(422);
  });

  it('edita con motivo y fechas válidas, y elimina del perfil', async () => {
    const { db, query } = conPerfil({ ...perfilBase, medicamentos: [medicamento] });
    const editado = await clinicalCrud(db, 'PUT', `${ruta}/${medicamento.id}`, {
      medicamento: { motivo: 'Náuseas', fecha_termino: '2026-11-20' },
    });
    expect(editado.status).toBe(200);
    expect(editado.body).toMatchObject({
      medicamento: { motivo: 'Náuseas', fecha_termino: '2026-11-20' },
      eliminado: false,
    });
    const borrado = await clinicalCrud(db, 'DELETE', `${ruta}/${medicamento.id}`, {});
    expect(borrado.body).toMatchObject({ eliminado: true, medicamento: { id: medicamento.id } });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE qc_demo_paciente'), [
      paciente,
      expect.objectContaining({ medicamentos: [] }),
    ]);
  });

  it('rechaza guardar un perfil que no cumple el contrato', async () => {
    const { db } = conPerfil({ medicamentos: [] });
    expect(
      await codigo(
        clinicalCrud(db, 'POST', ruta, {
          medicamento: { nombre: 'Dexametasona', dosis: '4 mg', frecuencia: 'Diaria' },
        }),
      ),
    ).toBe(422);
  });
});

describe('consulta y edición de catálogos de preparación', () => {
  const id = randomUUID();

  it('lista pacientes y consulta su vinculación, consentimientos y escenario', async () => {
    const { db } = cliente((sql) => {
      if (sql.includes('qc_demo_paciente')) return [{ id }];
      if (sql.includes('qc_demo_escenario')) return [];
      return [{ fila: sql.split(' ')[3] }];
    });
    expect((await manageData(db, 'GET', 'pacientes', {})).body).toMatchObject({ limite: 1000 });
    expect((await manageData(db, 'GET', `pacientes/${id}`, {})).body).toEqual({ id });
    expect((await manageData(db, 'GET', `pacientes/${id}/vinculacion`, {})).body).toMatchObject({
      paciente_id: id,
    });
    expect((await manageData(db, 'GET', `pacientes/${id}/consentimientos`, {})).body).toMatchObject(
      { paciente_id: id },
    );
    expect((await manageData(db, 'GET', `pacientes/${id}/escenario`, {})).body).toBeNull();
    expect(await codigo(manageData(cliente().db, 'GET', `pacientes/${id}`, {}))).toBe(404);
  });

  it('rechaza un catálogo desconocido o un registro inexistente', async () => {
    expect(await codigo(manageData(cliente().db, 'GET', 'desconocido', {}))).toBe(404);
    expect(await codigo(manageData(cliente().db, 'GET', `podcasts/${id}`, {}))).toBe(404);
    const lista = await manageData(cliente(() => [{ id }]).db, 'GET', 'terminos', {});
    expect(lista.body).toEqual({ items: [{ id }], limite: 1000 });
  });

  it('valida la desvinculación y aplica solo el alcance pedido', async () => {
    const ruta = `pacientes/${id}/desvincular`;
    expect(await codigo(manageData(cliente().db, 'POST', ruta, { alcance: 'todo' }))).toBe(422);
    expect(
      await codigo(manageData(cliente().db, 'POST', ruta, { alcance: 'ambos', extra: 1 })),
    ).toBe(422);
    expect(await codigo(manageData(cliente().db, 'POST', ruta, { alcance: 'ambos' }))).toBe(404);
    const { db, query } = cliente((sql) => (sql.startsWith('SELECT') ? [{ id }] : []));
    const r = await manageData(db, 'POST', ruta, { alcance: 'profesional' });
    expect(r.body).toEqual({ paciente_id: id, alcance: 'profesional', desvinculado: true });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('tratamiento=NULL'))).toBe(false);
  });

  it('rechaza ediciones fuera de los catálogos editables o con campos inválidos', async () => {
    const { db } = cliente();
    expect(await codigo(manageData(db, 'PUT', 'terminos/' + id, {}))).toBe(422);
    expect(await codigo(manageData(db, 'PATCH', 'podcasts/' + id, {}))).toBe(422);
    expect(await codigo(manageData(db, 'DELETE', 'podcasts/' + id, { titulo: 'x' }))).toBe(422);
    expect(await codigo(manageData(db, 'PUT', 'categorias/' + id, { titulo: 'x' }))).toBe(422);
    expect(await codigo(manageData(db, 'PUT', 'podcasts/' + id, { activo: 'si' }))).toBe(422);
    expect(await codigo(manageData(db, 'PUT', 'podcasts/' + id, {}))).toBe(404);
  });

  it('edita una categoría conservando el nombre y propaga la clave', async () => {
    const fila = { id, nombre: 'Nutrición', clave: 'nutricion', activo: true };
    const { db, query } = cliente((sql) => (sql.startsWith('SELECT') ? [fila] : []));
    await manageData(db, 'DELETE', 'categorias/' + id, {});
    expect(query.mock.calls[1]![1]).toEqual([id, 'Nutrición', false]);
    expect(query.mock.calls[2]![1]).toEqual(['nutricion', 'Nutrición']);
  });

  it('edita un contenido conservando o normalizando sus textos', async () => {
    const fila = {
      id,
      titulo: 'Antes',
      descripcion: 'Antes',
      categoria: 'Nutrición',
      activo: false,
    };
    const { db, query } = cliente((sql) => (sql.startsWith('SELECT') ? [fila] : []));
    await manageData(db, 'PUT', 'podcasts/' + id, { titulo: '  Nuevo   título ', activo: true });
    expect(query.mock.calls[1]![1]).toEqual([id, 'Nuevo título', 'Antes', 'Nutrición', true]);
    expect(await codigo(manageData(db, 'PUT', 'podcasts/' + id, { descripcion: '' }))).toBe(422);
  });

  it('cambia la categoría de un contenido solo si está registrada', async () => {
    const fila = { id, titulo: 'T', descripcion: 'D', categoria: 'Nutrición', activo: true };
    const { db, query } = cliente((sql) => {
      if (sql.includes('qc_preparacion_categoria')) return [{ nombre: 'Síntomas' }];
      return sql.startsWith('SELECT') ? [fila] : [];
    });
    await manageData(db, 'PUT', 'contenido-educativo/' + id, { categoria: 'síntomas' });
    expect(query.mock.calls.at(-2)![1]).toEqual([id, 'T', 'D', 'Síntomas', true]);
    const sinCategoria = cliente((sql) =>
      sql.startsWith('SELECT') && !sql.includes('categoria WHERE clave') ? [fila] : [],
    );
    expect(
      await codigo(manageData(sinCategoria.db, 'PUT', 'podcasts/' + id, { categoria: 'otra' })),
    ).toBe(422);
  });

  it('al desvincular el tratamiento lo retira del perfil del paciente', async () => {
    const { db, query } = cliente((sql) => (sql.startsWith('SELECT') ? [{ id }] : []));
    await manageData(db, 'POST', `pacientes/${id}/desvincular`, { alcance: 'tratamiento' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('tratamiento=NULL'))).toBe(true);
  });
});
