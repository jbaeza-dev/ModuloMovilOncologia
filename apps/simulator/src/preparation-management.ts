import type { SqlClient } from './db.js';
import { ApiError } from './errors.js';
import { requireUuid, categoryName } from './preparation.js';
import { loadForm } from './forms.js';
import type { ObjectValue } from './types.js';

export function managementPath(path: string, method: string) {
  if (method === 'GET')
    return (
      /^(categorias|contenido-educativo|podcasts|terminos|formularios|pacientes)(\/[^/]+)?$/.test(
        path,
      ) || /^pacientes\/[^/]+\/(contexto-clinico|vinculacion|consentimientos|escenario)$/.test(path)
    );
  if (method === 'POST') return /^pacientes\/[^/]+\/desvincular$/.test(path);
  return (
    ['PUT', 'DELETE'].includes(method) &&
    /^(categorias|contenido-educativo|podcasts)\/[^/]+$/.test(path)
  );
}
const invalid = () => new ApiError(422, 'ERROR_VALIDACION', 'Datos de gestión inválidos.');
const missing = () => new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Recurso inexistente.');
const text = (value: unknown, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid();
  return value.trim().replace(/\s+/g, ' ');
};
export async function manageData(db: SqlClient, method: string, path: string, input: ObjectValue) {
  const [kind, rawId, detail] = path.split('/');
  const id = rawId ? requireUuid(rawId) : null;
  const tables: Record<string, string> = {
    categorias: 'qc_preparacion_categoria',
    'contenido-educativo': 'contenido_educativo',
    podcasts: 'qc_educacion_podcast',
    terminos: 'qc_demo_terminos',
    formularios: 'formulario',
  };
  if (method === 'GET') {
    if (kind === 'pacientes') {
      const rows = (
        await db.query(
          'SELECT id,perfil,perfil_clinico,tratamiento FROM qc_demo_paciente WHERE ($1::uuid IS NULL OR id=$1) ORDER BY id LIMIT 1000',
          [id],
        )
      ).rows;
      if (id && !rows.length) throw missing();
      if (!id) return { status: 200, body: { items: rows, limite: 1000 } };
      if (detail === 'vinculacion')
        return {
          status: 200,
          body: {
            paciente_id: id,
            items: (
              await db.query('SELECT * FROM qc_demo_relacion_clinica WHERE paciente_id=$1', [id])
            ).rows,
          },
        };
      if (detail === 'consentimientos')
        return {
          status: 200,
          body: {
            paciente_id: id,
            items: (
              await db.query(
                'SELECT id,definicion_id,otorgado_el,revocado,revocado_el FROM qc_demo_consentimiento WHERE paciente_id=$1 ORDER BY otorgado_el DESC',
                [id],
              )
            ).rows,
          },
        };
      if (detail === 'escenario')
        return {
          status: 200,
          body:
            (
              await db.query(
                'SELECT escenario,aplicado_en FROM qc_demo_escenario WHERE paciente_id=$1',
                [id],
              )
            ).rows[0] ?? null,
        };
      return { status: 200, body: rows[0] };
    }
    if (kind === 'formularios' && id) return { status: 200, body: await loadForm(db, id) };
    const table = tables[kind!];
    if (!table) throw missing();
    const rows = (
      await db.query(
        `SELECT * FROM ${table} WHERE ($1::uuid IS NULL OR id=$1) ORDER BY id LIMIT 1000`,
        [id],
      )
    ).rows;
    if (id && !rows.length) throw missing();
    return { status: 200, body: id ? rows[0] : { items: rows, limite: 1000 } };
  }
  if (kind === 'pacientes' && detail === 'desvincular' && method === 'POST' && id) {
    if (
      Object.keys(input).some((k) => !['operacion_id', 'alcance'].includes(k)) ||
      !['profesional', 'tratamiento', 'ambos'].includes(String(input.alcance))
    )
      throw invalid();
    const row = (await db.query('SELECT id FROM qc_demo_paciente WHERE id=$1 FOR UPDATE', [id]))
      .rows[0];
    if (!row) throw missing();
    const professional = input.alcance !== 'tratamiento';
    const treatment = input.alcance !== 'profesional';
    if (treatment)
      await db.query(
        `UPDATE qc_demo_paciente SET tratamiento=NULL,
      perfil_clinico=CASE WHEN perfil_clinico IS NULL THEN NULL ELSE jsonb_set(perfil_clinico,'{medicamentos}',
        (SELECT coalesce(jsonb_agg(CASE WHEN m->>'motivo' LIKE 'Componente del esquema%' THEN m || '{"activo":false}'::jsonb ELSE m END),'[]'::jsonb) FROM jsonb_array_elements(coalesce(perfil_clinico->'medicamentos','[]'::jsonb)) m)) END WHERE id=$1`,
        [id],
      );
    await db.query(
      `UPDATE qc_demo_relacion_clinica SET
      profesional_activo=CASE WHEN $2 THEN false ELSE profesional_activo END,
      estado=CASE WHEN $3 THEN 'finalizada' ELSE estado END,
      desvinculado_en=CASE WHEN $3 THEN now() ELSE desvinculado_en END
      WHERE paciente_id=$1`,
      [id, professional, input.alcance === 'ambos'],
    );
    await db.query('DELETE FROM qc_demo_vinculacion WHERE paciente_id=$1', [id]);
    return { status: 200, body: { paciente_id: id, alcance: input.alcance, desvinculado: true } };
  }
  if (
    !id ||
    !['PUT', 'DELETE'].includes(method) ||
    !['categorias', 'contenido-educativo', 'podcasts'].includes(kind!)
  )
    throw invalid();
  const allowed =
    method === 'DELETE'
      ? ['operacion_id']
      : kind === 'categorias'
        ? ['operacion_id', 'nombre', 'activo']
        : ['operacion_id', 'titulo', 'descripcion', 'categoria', 'activo'];
  if (
    Object.keys(input).some((k) => !allowed.includes(k)) ||
    (input.activo !== undefined && typeof input.activo !== 'boolean')
  )
    throw invalid();
  const table = tables[kind!];
  const row = (await db.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  if (!row) throw missing();
  const active = method === 'DELETE' ? false : (input.activo ?? row.activo);
  if (kind === 'categorias') {
    const name = input.nombre === undefined ? row.nombre : text(input.nombre);
    await db.query(
      'UPDATE qc_preparacion_categoria SET nombre=$2,clave=lower($2),activo=$3 WHERE id=$1',
      [id, name, active],
    );
    await db.query('UPDATE contenido_educativo SET categoria=$2 WHERE lower(btrim(categoria))=$1', [
      row.clave,
      name,
    ]);
    await db.query(
      'UPDATE qc_educacion_podcast SET categoria=$2 WHERE lower(btrim(categoria))=$1',
      [row.clave, name],
    );
  } else {
    const category =
      input.categoria === undefined ? row.categoria : await categoryName(db, input.categoria);
    await db.query(
      `UPDATE ${table} SET titulo=$2,descripcion=$3,categoria=$4,activo=$5 WHERE id=$1`,
      [
        id,
        input.titulo === undefined ? row.titulo : text(input.titulo),
        input.descripcion === undefined ? row.descripcion : text(input.descripcion, 1000),
        category,
        active,
      ],
    );
  }
  return {
    status: 200,
    body: (await db.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0],
  };
}
