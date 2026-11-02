import { createHash, randomUUID } from 'node:crypto';
import { validateResponse } from '@quimiocare/contracts';
import type { OperationId } from '@quimiocare/contracts';
import { one, transaction, type Database, type SqlClient } from './db.js';
import { ApiError, record } from './errors.js';
import { validateDefinition } from './forms.js';
import { currentTermsId } from './consent.js';
import { enterMutation } from './mutation-gate.js';
import type { ObjectValue, Principal, FormDefinition } from './types.js';
import type { SimulatorConfig } from './config.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value))
    throw new ApiError(422, 'ERROR_VALIDACION', 'UUID inválido.');
  return value.toLowerCase();
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export async function requireOperator(
  db: SqlClient,
  config: SimulatorConfig,
  principal: Principal,
) {
  const row = await one<{ id: string }>(
    db,
    'SELECT id FROM qc_demo_operador WHERE auth_issuer=$1 AND auth_subject=$2 AND activo=true',
    [principal.issuer ?? config.issuer, principal.id],
  );
  if (!row) throw new ApiError(403, 'OPERADOR_NO_AUTORIZADO', 'Se requiere un operador activo.');
  return row.id;
}
function validResponse(operation: OperationId, body: unknown) {
  if (!validateResponse(operation, 200, body).valid)
    throw new ApiError(422, 'ERROR_VALIDACION', 'Los datos no cumplen el contrato externo.');
}
const text = (v: unknown, max = 200) => {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.trim().length > max ||
    [...v].some((c) => c.charCodeAt(0) < 32 && !'\t\n\r'.includes(c))
  )
    throw new ApiError(422, 'ERROR_VALIDACION', 'Texto vacío o inválido.');
  return v.trim().replace(/\s+/g, ' ');
};
export async function categoryName(client: SqlClient, value: unknown) {
  const name = text(value);
  const row = await one<{ nombre: string }>(
    client,
    'SELECT nombre FROM qc_preparacion_categoria WHERE clave=$1',
    [name.toLowerCase()],
  );
  if (!row)
    throw new ApiError(
      422,
      'CATEGORIA_NO_REGISTRADA',
      'Cree primero la categoría desde Preparación.',
    );
  return row.nombre;
}

/** Private evaluation interface; its DTOs never extend the external contract. */
export async function prepare(
  db: Database,
  config: SimulatorConfig,
  principal: Principal,
  action: string,
  input: ObjectValue,
) {
  const leave = enterMutation();
  try {
    const operator = await requireOperator(db, config, principal);
    const operation = requireUuid(input.operacion_id);
    const allowed =
      action === 'categorias'
        ? ['nombre']
        : action.endsWith('/estado')
          ? ['activo']
          : action === 'terminos'
            ? ['definicion']
            : action === 'formularios'
              ? ['formulario']
              : action.endsWith('/consentimiento-demo')
                ? ['estado', 'definicion_terminos_id', 'consentimiento_id']
                : action.endsWith('/contexto-clinico')
                  ? ['perfil_clinico', 'tratamiento']
                  : action.endsWith('/escenario')
                    ? ['escenario']
                    : action === 'contenido-educativo/videos' ||
                        action === 'contenido-educativo/podcasts'
                      ? ['titulo', 'descripcion', 'categoria', 'url']
                      : [];
    if (Object.keys(input).some((key) => key !== 'operacion_id' && !allowed.includes(key)))
      throw new ApiError(422, 'ERROR_VALIDACION', 'Campo de preparación no permitido.');
    const digest = createHash('sha256').update(canonical({ action, input })).digest('hex');
    return await transaction(db, async (client) => {
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('qc-preparacion-write'))");
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'preparacion:' + operation,
      ]);
      const prior = await one<{ operador_id: string; payload_sha256: string; resultado: unknown }>(
        client,
        'SELECT * FROM qc_preparacion_operacion WHERE operacion_id=$1',
        [operation],
      );
      if (prior) {
        if (prior.operador_id !== operator)
          throw new ApiError(403, 'ACCESO_DENEGADO', 'Operación de otro operador.');
        if (prior.payload_sha256 !== digest)
          throw new ApiError(
            409,
            'CONFLICTO_OPERACION_ID',
            'Operación reutilizada con otros datos.',
          );
        return { status: 200, body: prior.resultado };
      }
      if (
        await one(
          client,
          'SELECT operacion_id FROM qc_demo_operacion_educativa WHERE operacion_id=$1',
          [operation],
        )
      )
        throw new ApiError(
          409,
          'CONFLICTO_OPERACION_ID',
          'Identificador de una publicación previa.',
        );
      let body: unknown;
      let status = 200;
      let patient: string | null = null;
      let definition: string | null = null;
      const parts = action.split('/');
      if (action === 'categorias') {
        const name = text(input.nombre);
        const existed = await one(
          client,
          'SELECT clave FROM qc_preparacion_categoria WHERE clave=$1',
          [name.toLowerCase()],
        );
        await client.query(
          'INSERT INTO qc_preparacion_categoria(clave,nombre) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [name.toLowerCase(), name],
        );
        body = await one(client, 'SELECT nombre FROM qc_preparacion_categoria WHERE clave=$1', [
          name.toLowerCase(),
        ]);
        status = existed ? 200 : 201;
      } else if (action === 'contenido-educativo/podcasts') {
        const category = await categoryName(client, input.categoria);
        const match =
          /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,100})\/(?:view|preview)$/.exec(
            String(input.url ?? ''),
          );
        if (!match)
          throw new ApiError(
            422,
            'ERROR_VALIDACION',
            'Use un enlace de archivo de audio público de Drive, terminado en /view.',
          );
        const id = randomUUID();
        const title = text(input.titulo);
        const description = text(input.descripcion, 1000);
        if (await one(client, 'SELECT id FROM qc_educacion_podcast WHERE drive_id=$1', [match[1]]))
          throw new ApiError(409, 'CONFLICTO_ESTADO', 'Este episodio ya está publicado.');
        await client.query(
          'INSERT INTO qc_educacion_podcast(id,profesional_id,titulo,descripcion,categoria,drive_id) VALUES($1,$2,$3,$4,$5,$6)',
          [id, operator, title, description, category, match[1]],
        );
        body = { id, titulo: title, categoria: category, drive_id: match[1], activo: true };
        status = 201;
      } else if (parts[0] === 'podcasts' && parts[2] === 'estado') {
        if (typeof input.activo !== 'boolean')
          throw new ApiError(422, 'ERROR_VALIDACION', 'activo debe ser booleano.');
        body = await one(
          client,
          'UPDATE qc_educacion_podcast SET activo=$2 WHERE id=$1 RETURNING id,activo',
          [requireUuid(parts[1]), input.activo],
        );
        if (!body) throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Podcast inexistente.');
      } else if (action === 'contenido-educativo/videos') {
        const category = await categoryName(client, input.categoria);
        const url = String(input.url ?? '');
        if (!/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(url))
          throw new ApiError(
            422,
            'ERROR_VALIDACION',
            'Use una URL YouTube compatible con el catálogo actual.',
          );
        const id = randomUUID();
        const title = text(input.titulo);
        const description = text(input.descripcion, 1000);
        await client.query(
          `INSERT INTO contenido_educativo(id,profesional_id,titulo,descripcion,tipo,url,categoria,activo,fecha_creacion)
          VALUES($1,$2,$3,$4,'video',$5,$6,true,now())`,
          [id, operator, title, description, url, category],
        );
        body = { id, titulo: title, url, categoria: category, tipo: 'video' };
        status = 201;
      } else if (parts[0] === 'contenido-educativo' && parts[2] === 'estado') {
        if (typeof input.activo !== 'boolean')
          throw new ApiError(422, 'ERROR_VALIDACION', 'activo debe ser booleano.');
        const result = await client.query(
          'UPDATE contenido_educativo SET activo=$2 WHERE id=$1 RETURNING id,activo',
          [requireUuid(parts[1]), input.activo],
        );
        body = result.rows[0];
      } else if (action === 'terminos') {
        const def = { ...record(input.definicion) };
        def.id = def.id ? requireUuid(def.id) : randomUUID();
        def.obligatorio ??= true;
        validResponse('C-14', def);
        await client.query(
          'INSERT INTO qc_demo_terminos(id,codigo,version,definicion) VALUES($1,$2,$3,$4)',
          [def.id, def.codigo, def.version, def],
        );
        body = def;
        status = 201;
        definition = String(def.id);
      } else if (parts[0] === 'terminos' && parts[2] === 'publicar') {
        definition = requireUuid(parts[1]);
        const def = await one<{ codigo: string }>(
          client,
          'SELECT codigo FROM qc_demo_terminos WHERE id=$1',
          [definition],
        );
        if (!def) throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Definición inexistente.');
        await client.query(
          "UPDATE qc_demo_terminos SET definicion = jsonb_set(definicion, '{vigente}', 'false'::jsonb) WHERE codigo=$1",
          [def.codigo],
        );
        await client.query(
          "UPDATE qc_demo_terminos SET definicion = jsonb_set(definicion, '{vigente}', 'true'::jsonb) WHERE id=$1",
          [definition],
        );
        await client.query(
          'INSERT INTO qc_preparacion_terminos_vigentes(codigo,definicion_id) VALUES($1,$2) ON CONFLICT(codigo) DO UPDATE SET definicion_id=excluded.definicion_id',
          [def.codigo, definition],
        );
        body = { id: definition, codigo: def.codigo, vigente: true };
      } else if (parts[0] === 'pacientes') {
        patient = requireUuid(parts[1]);
        const actor = await one(client, 'SELECT id FROM qc_demo_paciente WHERE id=$1 FOR UPDATE', [
          patient,
        ]);
        if (!actor)
          throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Paciente sintético inexistente.');
        if (parts[2] === 'consentimiento-demo') {
          definition = input.definicion_terminos_id
            ? requireUuid(input.definicion_terminos_id)
            : await currentTermsId(undefined, client);
          if (!(await one(client, 'SELECT id FROM qc_demo_terminos WHERE id=$1', [definition])))
            throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Términos inexistentes.');
          if (!['pendiente', 'aceptado', 'revocado'].includes(String(input.estado)))
            throw new ApiError(422, 'ERROR_VALIDACION', 'Estado de consentimiento inválido.');
          if (input.estado === 'aceptado') {
            status = 201;
            await client.query(
              'INSERT INTO qc_demo_consentimiento(id,paciente_id,definicion_id,request,otorgado_el) VALUES($1,$2,$3,$4,now())',
              [
                operation,
                patient,
                definition,
                {
                  origen: 'simulacion',
                  codigo: 'TERMINOS_PLATAFORMA',
                  definicion_terminos_id: definition,
                  operacion_id: operation,
                },
              ],
            );
          } else if (input.estado === 'pendiente') {
            await client.query(
              'UPDATE qc_demo_consentimiento SET revocado=true,revocado_el=now() WHERE paciente_id=$1 AND definicion_id=$2 AND NOT revocado',
              [patient, definition],
            );
          } else {
            const result = await client.query(
              'UPDATE qc_demo_consentimiento SET revocado=true,revocado_el=now() WHERE id=$1 AND paciente_id=$2 AND definicion_id=$3 RETURNING id',
              [requireUuid(input.consentimiento_id), patient, definition],
            );
            if (!result.rowCount)
              throw new ApiError(
                404,
                'RECURSO_NO_ENCONTRADO',
                'Acto de consentimiento inexistente.',
              );
          }
          body = {
            paciente_id: patient,
            definicion_terminos_id: definition,
            estado: input.estado,
            origen: 'simulacion',
            ...(input.estado === 'aceptado' ? { consentimiento_id: operation } : {}),
          };
        } else if (parts[2] === 'contexto-clinico') {
          body = await assignClinicalContext(client, patient, input);
        } else if (parts[2] === 'escenario') {
          const scenario = String(input.escenario);
          if (
            ![
              'NORMAL',
              'AUTORIZACION_DENEGADA',
              'SERVICIO_NO_DISPONIBLE',
              'ACK_SIGNOS_PERDIDO',
              'ACK_EPRO_PERDIDO',
              'IA_NO_DISPONIBLE',
              'IA_URGENCIA',
            ].includes(scenario)
          )
            throw new ApiError(422, 'ERROR_VALIDACION', 'Escenario no permitido.');
          await client.query(
            'UPDATE qc_demo_escenario SET escenario=$2,ack_signos_usado=false,ack_epro_usado=false WHERE paciente_id=$1',
            [patient, scenario],
          );
          body = { paciente_id: patient, escenario: scenario };
        }
      } else if (action === 'formularios') {
        const form = { ...record(input.formulario) } as unknown as FormDefinition;
        form.id = form.id ? requireUuid(form.id) : randomUUID();
        form.fecha_creacion ??= new Date().toISOString();
        form.activo = false;
        if (!Array.isArray(form.preguntas))
          throw new ApiError(422, 'ERROR_VALIDACION', 'preguntas debe ser una lista.');
        form.preguntas = form.preguntas.map((q) => {
          record(q);
          return { ...q, id: q.id ? requireUuid(q.id) : randomUUID() };
        });
        validResponse('C-09', form);
        validateDefinition(form);
        await client.query(
          `INSERT INTO formulario(id,codigo,titulo,descripcion,tratamiento,version,activo,configuracion,fecha_creacion)
          VALUES($1,$2,$3,$4,$5,$6,false,$7,$8)`,
          [
            form.id,
            form.codigo,
            form.titulo,
            form.descripcion ?? null,
            form.tratamiento,
            form.version,
            { ...form.configuracion, version_condiciones: form.version_condiciones },
            form.fecha_creacion,
          ],
        );
        for (const q of form.preguntas)
          await client.query(
            `INSERT INTO pregunta(id,formulario_id,codigo,titulo,texto,tipo,requerida,orden,opciones,configuracion)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              q.id,
              form.id,
              q.codigo,
              q.titulo,
              q.texto ?? null,
              q.tipo,
              q.requerida ?? false,
              q.orden,
              JSON.stringify(q.opciones ?? []),
              q.configuracion ?? {},
            ],
          );
        body = form;
        status = 201;
      } else if (parts[0] === 'formularios' && parts[2] === 'publicar') {
        const id = requireUuid(parts[1]);
        const row = await one<{ tratamiento: string }>(
          client,
          'SELECT tratamiento FROM formulario WHERE id=$1 AND NOT eliminado',
          [id],
        );
        if (!row) throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Formulario inexistente.');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          'formulario:' + row.tratamiento,
        ]);
        await client.query('UPDATE formulario SET activo=(id=$2) WHERE tratamiento=$1', [
          row.tratamiento,
          id,
        ]);
        await client.query(
          'INSERT INTO qc_preparacion_formulario_vigente(tratamiento,formulario_id) VALUES($1,$2) ON CONFLICT(tratamiento) DO UPDATE SET formulario_id=excluded.formulario_id',
          [row.tratamiento, id],
        );
        body = { id, tratamiento: row.tratamiento, activo: true };
      }
      if (!body)
        throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Operación o recurso inexistente.');
      await client.query(
        'INSERT INTO qc_preparacion_operacion(operacion_id,operador_id,accion,payload_sha256,resultado) VALUES($1,$2,$3,$4,$5)',
        [operation, operator, action, digest, JSON.stringify(body)],
      );
      await client.query(
        'INSERT INTO qc_preparacion_auditoria(operacion_id,operador_id,paciente_id,definicion_id,accion) VALUES($1,$2,$3,$4,$5)',
        [operation, operator, patient, definition, action],
      );
      return { status, body };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new ApiError(409, 'CONFLICTO_ESTADO', 'Ese recurso ya existe; cree una nueva versión.');
    throw error;
  } finally {
    leave();
  }
}

export async function assignClinicalContext(
  client: SqlClient,
  patient: string,
  input: ObjectValue,
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('qc-contexto-clinico'))");
  if (!('perfil_clinico' in input) && !('tratamiento' in input))
    throw new ApiError(422, 'ERROR_VALIDACION', 'Indique un contexto o null.');
  for (const [key, op] of [
    ['perfil_clinico', 'C-03'],
    ['tratamiento', 'C-04'],
  ] as const) {
    if (!(key in input)) continue;
    let value = input[key];
    if (value !== null) {
      const data = { ...record(value) };
      if (data.paciente_id && data.paciente_id !== patient)
        throw new ApiError(422, 'ERROR_VALIDACION', 'Propietario incoherente.');
      data.id = data.id ? requireUuid(data.id) : randomUUID();
      if (key === 'perfil_clinico') data.fecha_actualizacion = new Date().toISOString();
      const collision = await one(
        client,
        `SELECT id FROM qc_demo_paciente WHERE id<>$1 AND ${key}->>'id'=$2`,
        [patient, data.id],
      );
      if (collision) throw new ApiError(409, 'CONFLICTO_ESTADO', 'Entidad de otro paciente.');
      if (Array.isArray(data.medicamentos)) {
        data.medicamentos = await Promise.all(
          data.medicamentos.map(async (raw) => {
            const med = { ...record(raw) };
            med.id = med.id ? requireUuid(med.id) : randomUUID();
            if (
              await one(
                client,
                "SELECT id FROM qc_demo_paciente WHERE id<>$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(perfil_clinico->'medicamentos','[]')) AS m WHERE m->>'id'=$2)",
                [patient, med.id],
              )
            )
              throw new ApiError(409, 'CONFLICTO_ESTADO', 'Prescripción de otro paciente.');
            return med;
          }),
        );
      }
      validResponse(op, data);
      value = data;
    }
    await client.query(`UPDATE qc_demo_paciente SET ${key}=$2 WHERE id=$1`, [patient, value]);
  }
  return (
    await client.query('SELECT id,perfil_clinico,tratamiento FROM qc_demo_paciente WHERE id=$1', [
      patient,
    ])
  ).rows[0];
}
