import type { SqlClient } from './db.js';
import { one } from './db.js';
import { ApiError } from './errors.js';
import { NEW_TERMS_ID, ORIGINAL_TERMS_ID } from './seed-data.js';
import type { ObjectValue, ScenarioState } from './types.js';

export function currentTermsId(state?: ScenarioState): string {
  return state?.escenario === 'TERMINOS_NUEVOS' ? NEW_TERMS_ID : ORIGINAL_TERMS_ID;
}

export async function getTerms(client: SqlClient, id: string, code = 'TERMINOS_PLATAFORMA') {
  const row = await one<{ definicion: ObjectValue; codigo: string }>(
    client,
    'SELECT definicion,codigo FROM qc_demo_terminos WHERE id=$1',
    [id],
  );
  if (!row) throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Términos no encontrados.');
  if (row.codigo !== code)
    throw new ApiError(400, 'HTTP_400', 'La definición no pertenece a la familia solicitada.');
  return row.definicion;
}

interface ConsentRow {
  id: string;
  paciente_id: string;
  definicion_id: string;
  request: ObjectValue;
  otorgado_el: Date;
  revocado: boolean;
  revocado_el: Date | null;
}

function serializeConsent(row: ConsentRow, terms: ObjectValue) {
  return {
    id: row.id,
    paciente_id: row.paciente_id,
    definicion_terminos_id: row.definicion_id,
    version_codigo: terms.codigo,
    version_numero: terms.version,
    otorgado_el: row.otorgado_el.toISOString(),
    revocado: row.revocado,
    revocado_el: row.revocado_el?.toISOString() ?? null,
    ip_address: null,
    user_agent: null,
  };
}

export async function consentStatus(
  client: SqlClient,
  patientId: string,
  state: ScenarioState,
  code = 'TERMINOS_PLATAFORMA',
) {
  const currentId = currentTermsId(state);
  const current = await getTerms(client, currentId, code);
  const rows = (
    await client.query<ConsentRow>(
      'SELECT * FROM qc_demo_consentimiento WHERE paciente_id=$1 ORDER BY otorgado_el DESC,id ASC',
      [patientId],
    )
  ).rows;
  const serialized = await Promise.all(
    rows.map(async (row) => serializeConsent(row, await getTerms(client, row.definicion_id))),
  );
  const active =
    serialized.find((row) => row.definicion_terminos_id === currentId && !row.revocado) ?? null;
  return {
    requiere_aceptacion: active === null,
    terminos_vigentes: current,
    consentimiento_actual:
      active ?? serialized.find((row) => row.definicion_terminos_id === currentId) ?? null,
    historial_previo: serialized.filter((row) => row.definicion_terminos_id !== currentId),
  };
}

export async function requireConsent(
  client: SqlClient,
  patientId: string,
  state: ScenarioState,
): Promise<void> {
  if ((await consentStatus(client, patientId, state)).requiere_aceptacion) {
    throw new ApiError(
      403,
      'CONSENTIMIENTO_REQUERIDO',
      'Se requiere aceptación online de los términos vigentes.',
    );
  }
}

export async function acceptConsent(
  client: SqlClient,
  patientId: string,
  state: ScenarioState,
  input: { definicion_terminos_id: string; operacion_id: string; codigo?: string },
) {
  if (
    Object.keys(input).some(
      (key) => !['definicion_terminos_id', 'operacion_id', 'codigo'].includes(key),
    )
  ) {
    throw new ApiError(
      422,
      'ERROR_VALIDACION',
      'El acto no admite identidad, fecha ni campos adicionales del cliente.',
    );
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `consent:${input.operacion_id}`,
  ]);
  const existing = await one<ConsentRow>(
    client,
    'SELECT * FROM qc_demo_consentimiento WHERE id=$1',
    [input.operacion_id],
  );
  const code = input.codigo ?? 'TERMINOS_PLATAFORMA';
  if (existing) {
    if (existing.paciente_id !== patientId)
      throw new ApiError(403, 'ACCESO_DENEGADO', 'Acto no accesible.');
    if (
      existing.definicion_id !== input.definicion_terminos_id ||
      existing.request.codigo !== code
    ) {
      throw new ApiError(409, 'CONFLICTO_ESTADO', 'El UUID ya identifica una decisión distinta.');
    }
    return {
      status: 200,
      body: serializeConsent(existing, await getTerms(client, existing.definicion_id, code)),
    };
  }
  const terms = await getTerms(client, input.definicion_terminos_id, code);
  if (input.definicion_terminos_id !== currentTermsId(state)) {
    throw new ApiError(409, 'TERMINOS_DESACTUALIZADOS', 'Consulte y presente la edición vigente.');
  }
  const row = (
    await client.query<ConsentRow>(
      `INSERT INTO qc_demo_consentimiento(id,paciente_id,definicion_id,request,otorgado_el)
    VALUES($1,$2,$3,$4,now()) RETURNING *`,
      [input.operacion_id, patientId, input.definicion_terminos_id, { ...input, codigo: code }],
    )
  ).rows[0]!;
  return { status: 201, body: serializeConsent(row, terms) };
}
