import { randomUUID } from 'node:crypto';
import { validateResponse } from '@quimiocare/contracts';
import type { SqlClient } from './db.js';
import { ApiError, record } from './errors.js';
import { requireUuid } from './preparation.js';
import type { ObjectValue } from './types.js';
import { manageData, managementPath } from './preparation-management.js';

const missing = () => new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Registro inexistente.');
const invalid = () => new ApiError(422, 'ERROR_VALIDACION', 'Datos de gestión inválidos.');
const text = (value: unknown, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid();
  return value.trim();
};
export const clinicalCrudPath = (path: string, method = 'GET') =>
  /^(?:profesionales(?:\/[^/]+)?|pacientes\/[^/]+\/medicamentos(?:\/[^/]+)?)$/.test(path) ||
  managementPath(path, method);

export async function clinicalCrud(
  client: SqlClient,
  method: string,
  path: string,
  input: ObjectValue,
) {
  if (managementPath(path, method)) return manageData(client, method, path, input);
  const parts = path.split('/');
  const professionals = parts[0] === 'profesionales';
  const allowed = professionals
    ? ['operador_id', 'nombre', 'especialidad', 'activo']
    : ['medicamento'];
  if (Object.keys(input).some((k) => k !== 'operacion_id' && !allowed.includes(k))) throw invalid();
  if (method === 'DELETE' && Object.keys(input).some((k) => k !== 'operacion_id')) throw invalid();
  if (professionals) {
    const id = parts[1] ? requireUuid(parts[1]) : undefined;
    if (method === 'GET') {
      const rows = (
        await client.query(
          'SELECT * FROM qc_demo_profesional WHERE ($1::uuid IS NULL OR operador_id=$1) ORDER BY nombre,operador_id',
          [id ?? null],
        )
      ).rows;
      if (id && !rows.length) throw missing();
      return { status: 200, body: id ? rows[0] : { items: rows } };
    }
    if (method === 'POST' && !id) {
      if (input.activo !== undefined && typeof input.activo !== 'boolean') throw invalid();
      const operator = requireUuid(input.operador_id);
      const row = (
        await client.query('SELECT id FROM qc_demo_operador WHERE id=$1 AND activo=true', [
          operator,
        ])
      ).rows[0];
      if (!row) throw missing();
      const result = await client.query(
        `INSERT INTO qc_demo_profesional(operador_id,nombre,especialidad,activo)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *`,
        [operator, text(input.nombre, 150), text(input.especialidad, 150), input.activo ?? true],
      );
      if (!result.rows.length)
        throw new ApiError(409, 'PERFIL_EXISTENTE', 'Edite el perfil profesional existente.');
      return { status: 201, body: result.rows[0] };
    }
    if (!id || !['PUT', 'DELETE'].includes(method) || input.operador_id !== undefined)
      throw invalid();
    const old = (
      await client.query('SELECT * FROM qc_demo_profesional WHERE operador_id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!old) throw missing();
    if (input.activo !== undefined && typeof input.activo !== 'boolean') throw invalid();
    const result = await client.query(
      `UPDATE qc_demo_profesional SET nombre=$2,especialidad=$3,activo=$4 WHERE operador_id=$1 RETURNING *`,
      [
        id,
        input.nombre === undefined ? old.nombre : text(input.nombre, 150),
        input.especialidad === undefined ? old.especialidad : text(input.especialidad, 150),
        method === 'DELETE' ? false : (input.activo ?? old.activo),
      ],
    );
    return { status: 200, body: result.rows[0] };
  }
  const patient = requireUuid(parts[1]);
  const id = parts[3] ? requireUuid(parts[3]) : undefined;
  const row = (
    await client.query<{ perfil_clinico: ObjectValue | null }>(
      'SELECT perfil_clinico FROM qc_demo_paciente WHERE id=$1 FOR UPDATE',
      [patient],
    )
  ).rows[0];
  if (!row) throw missing();
  if (!row.perfil_clinico)
    throw new ApiError(409, 'CONTEXTO_PENDIENTE', 'Prepare primero el perfil clínico.');
  const medications = Array.isArray(row.perfil_clinico.medicamentos)
    ? row.perfil_clinico.medicamentos.map(record)
    : [];
  const index = medications.findIndex((m) => m.id === id);
  if (id && index < 0) throw missing();
  if (method === 'GET')
    return {
      status: 200,
      body: id ? medications[index] : { paciente_id: patient, items: medications },
    };
  let result: ObjectValue;
  if (method === 'DELETE' && id) result = medications.splice(index, 1)[0]!;
  else {
    if (!((method === 'POST' && !id) || (method === 'PUT' && id))) throw invalid();
    const value = record(input.medicamento);
    if (
      Object.keys(value).some(
        (k) =>
          ![
            'nombre',
            'dosis',
            'frecuencia',
            'motivo',
            'activo',
            'fecha_inicio',
            'fecha_termino',
          ].includes(k),
      )
    )
      throw invalid();
    if (value.activo !== undefined && typeof value.activo !== 'boolean') throw invalid();
    result = {
      ...(id
        ? medications[index]
        : {
            id: randomUUID(),
            medicamento_id: randomUUID(),
            activo: false,
            fecha_inicio: null,
            fecha_termino: null,
          }),
      ...value,
    };
    for (const key of ['nombre', 'dosis', 'frecuencia']) result[key] = text(result[key], 500);
    if (result.motivo !== undefined) result.motivo = text(result.motivo, 1000);
    for (const key of ['fecha_inicio', 'fecha_termino']) {
      const date = result[key];
      if (
        date !== null &&
        (typeof date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date)
      )
        throw invalid();
    }
    if (
      result.fecha_inicio &&
      result.fecha_termino &&
      String(result.fecha_inicio) > String(result.fecha_termino)
    )
      throw invalid();
    if (id) medications[index] = result;
    else medications.push(result);
  }
  const profile = {
    ...row.perfil_clinico,
    medicamentos: medications,
    fecha_actualizacion: new Date().toISOString(),
  };
  if (!validateResponse('C-03', 200, profile).valid) throw invalid();
  await client.query('UPDATE qc_demo_paciente SET perfil_clinico=$2 WHERE id=$1', [
    patient,
    profile,
  ]);
  return {
    status: method === 'POST' ? 201 : 200,
    body: { paciente_id: patient, medicamento: result, eliminado: method === 'DELETE' },
  };
}
