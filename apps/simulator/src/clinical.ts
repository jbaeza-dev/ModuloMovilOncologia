import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Database, SqlClient } from './db.js';
import { one, transaction } from './db.js';
import { ApiError, invalid } from './errors.js';
import { requireConsent } from './consent.js';
import { loadForm, validateAnswers } from './forms.js';
import { consumeLostAck, scenarioFor } from './scenarios.js';
import type { EproInput, ObjectValue, ScenarioState, SignsInput } from './types.js';

export function checkCaptureDate(value: string, now = Date.now()): void {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now + 300000)
    invalid('Fecha de captura inválida o demasiado futura.');
}

const SIGN_VALUES = [
  'presion_arterial_sistolica',
  'presion_arterial_diastolica',
  'pulso',
  'temperatura',
  'saturacion_oxigeno',
] as const;
export function normalizedSigns(input: SignsInput): SignsInput {
  checkCaptureDate(input.fecha_registro);
  if (
    input.presion_arterial_sistolica != null &&
    input.presion_arterial_diastolica != null &&
    input.presion_arterial_sistolica <= input.presion_arterial_diastolica
  )
    invalid('La presión sistólica debe superar la diastólica.');
  return {
    id: input.id,
    fecha_registro: new Date(input.fecha_registro).toISOString(),
    presion_arterial_sistolica: input.presion_arterial_sistolica ?? null,
    presion_arterial_diastolica: input.presion_arterial_diastolica ?? null,
    pulso: input.pulso ?? null,
    temperatura: input.temperatura == null ? null : Number(input.temperatura.toFixed(1)),
    saturacion_oxigeno: input.saturacion_oxigeno ?? null,
  };
}

export function equivalentSigns(left: SignsInput, right: SignsInput): boolean {
  return (
    left.id === right.id &&
    Math.abs(Date.parse(left.fecha_registro) - Date.parse(right.fecha_registro)) <= 1000 &&
    SIGN_VALUES.every((key) => left[key] === right[key])
  );
}

interface Persisted<T> {
  paciente_id: string;
  request: T;
  respuesta: ObjectValue;
}
async function requireClinicalProfile(client: SqlClient, patientId: string): Promise<void> {
  const row = await one<{ perfil_clinico: ObjectValue | null }>(
    client,
    'SELECT perfil_clinico FROM qc_demo_paciente WHERE id=$1',
    [patientId],
  );
  if (!row?.perfil_clinico || typeof row.perfil_clinico.id !== 'string') {
    throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Falta la ficha clínica del paciente.');
  }
}
async function saveSign(client: SqlClient, patientId: string, input: SignsInput) {
  const value = normalizedSigns(input);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sign:${input.id}`]);
  const stored = await one<Persisted<SignsInput>>(
    client,
    'SELECT paciente_id,request,respuesta FROM qc_demo_signo WHERE id=$1',
    [input.id],
  );
  if (stored) {
    if (stored.paciente_id !== patientId || !equivalentSigns(stored.request, value)) {
      throw new ApiError(
        409,
        'CONFLICTO_ESTADO',
        'UUID usado con datos o propietario incompatibles.',
      );
    }
    return { status: 200, body: stored.respuesta };
  }
  const response = { ...value, fecha_subida: new Date().toISOString(), sincronizado: true };
  await client.query(
    'INSERT INTO qc_demo_signo(id,paciente_id,request,respuesta) VALUES($1,$2,$3,$4)',
    [value.id, patientId, value, response],
  );
  return { status: 201, body: response };
}

export async function recordSign(db: Database, patientId: string, input: SignsInput) {
  return transaction(db, async (client) => {
    const state = await scenarioFor(client, patientId, true);
    await requireClinicalProfile(client, patientId);
    await requireConsent(client, patientId, state);
    const result = await saveSign(client, patientId, input);
    return { ...result, dropResponse: await consumeLostAck(client, state, 'signos') };
  });
}

export async function recordSignBatch(db: Database, patientId: string, inputs: SignsInput[]) {
  if (new Set(inputs.map((input) => input.id)).size !== inputs.length)
    invalid('UUID repetido dentro del lote.');
  return transaction(db, async (client) => {
    const state = await scenarioFor(client, patientId, true);
    await requireClinicalProfile(client, patientId);
    await requireConsent(client, patientId, state);
    const inserted: ObjectValue[] = [],
      existing: ObjectValue[] = [];
    // Stable lock ordering avoids deadlock when parallel batches contain overlapping UUIDs.
    for (const value of [...inputs].sort((a, b) => a.id.localeCompare(b.id))) {
      const result = await saveSign(client, patientId, value);
      (result.status === 201 ? inserted : existing).push(result.body);
    }
    return {
      status: inserted.length ? 201 : 200,
      body: {
        insertados: inserted,
        ya_existentes: existing,
        total_insertados: inserted.length,
        total_ya_existentes: existing.length,
        total_procesados: inputs.length,
      },
    };
  });
}

function comparableEpro(input: EproInput) {
  return {
    comentario: (input.comentario ?? '').trim(),
    respuestas: input.respuestas
      .map((a) => ({ pregunta_id: a.pregunta_id, valor: a.valor }))
      .sort((a, b) => a.pregunta_id.localeCompare(b.pregunta_id)),
  };
}

export async function recordEpro(
  db: Database,
  patientId: string,
  formId: string,
  input: EproInput,
) {
  return transaction(db, async (client) => {
    const state = await scenarioFor(client, patientId, true);
    await requireClinicalProfile(client, patientId);
    await requireConsent(client, patientId, state);
    checkCaptureDate(input.fecha_respuesta);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`epro:${input.id}`]);
    const stored = await one<Persisted<EproInput> & { formulario_id: string }>(
      client,
      'SELECT paciente_id,formulario_id,request,respuesta FROM qc_demo_epro WHERE id=$1',
      [input.id],
    );
    if (stored) {
      if (
        stored.paciente_id !== patientId ||
        stored.formulario_id !== formId ||
        !isDeepStrictEqual(comparableEpro(stored.request), comparableEpro(input))
      ) {
        throw new ApiError(
          409,
          'CONFLICTO_ESTADO',
          'UUID usado con datos o propietario incompatibles.',
        );
      }
      return {
        status: 201,
        body: stored.respuesta,
        dropResponse: await consumeLostAck(client, state, 'epro'),
      };
    }
    let form;
    try {
      form = await loadForm(client, formId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404)
        throw new ApiError(404, 'FORMULARIO_NO_ENCONTRADO', 'Edición no encontrada.');
      throw error;
    }
    const processed = validateAnswers(form, input.respuestas);
    const response = {
      id: input.id,
      formulario_id: formId,
      formulario_version: form.version,
      paciente_id: patientId,
      fecha_respuesta_cliente: new Date(input.fecha_respuesta).toISOString(),
      fecha_recepcion_servidor: new Date().toISOString(),
      respuestas: processed,
      comentario: (input.comentario ?? '').trim(),
      mensaje: 'Respuesta registrada exitosamente.',
    };
    await client.query(
      'INSERT INTO qc_demo_epro(id,paciente_id,formulario_id,request,respuesta) VALUES($1,$2,$3,$4,$5)',
      [input.id, patientId, formId, input, response],
    );
    return {
      status: 201,
      body: response,
      dropResponse: await consumeLostAck(client, state, 'epro'),
    };
  });
}

export async function patientData(
  client: SqlClient,
  patientId: string,
  field: 'perfil' | 'perfil_clinico' | 'tratamiento',
) {
  const row = await one<ObjectValue>(client, `SELECT ${field} FROM qc_demo_paciente WHERE id=$1`, [
    patientId,
  ]);
  if (!row) throw new ApiError(401, 'HTTP_401', 'Paciente sintético no registrado.');
  if (row[field] === null && field !== 'perfil')
    throw new ApiError(
      404,
      field === 'perfil_clinico'
        ? 'PERFIL_CLINICO_NO_ENCONTRADO'
        : 'TRATAMIENTO_ACTIVO_NO_ENCONTRADO',
      'Información no preparada.',
    );
  return row[field];
}

function validRut(value: string): boolean {
  const normalized = value.replace(/[.-]/g, '').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(normalized)) return false;
  let multiplier = 2,
    sum = 0;
  for (const digit of normalized.slice(0, -1).split('').reverse()) {
    sum += Number(digit) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const check = 11 - (sum % 11);
  return normalized.at(-1) === (check === 11 ? '0' : check === 10 ? 'K' : String(check));
}

export async function completeProfile(db: Database, patientId: string, input: ObjectValue) {
  if (typeof input.rut !== 'string' || !validRut(input.rut)) invalid('RUT inválido.');
  return transaction(db, async (client) => {
    const row = await one<{ perfil: ObjectValue }>(
      client,
      'SELECT perfil FROM qc_demo_paciente WHERE id=$1 FOR UPDATE',
      [patientId],
    );
    if (!row) throw new ApiError(401, 'HTTP_401', 'Paciente no registrado.');
    const unknown = Object.keys(input).filter(
      (key) => !['rut', 'telefono', 'fecha_nacimiento', 'sexo'].includes(key),
    );
    if (unknown.length)
      throw new ApiError(422, 'ERROR_VALIDACION', 'Campos de incorporación no admitidos.');
    const updated = {
      ...row.perfil,
      rut: input.rut,
      estado_incorporacion: 'COMPLETO',
    } as ObjectValue;
    for (const key of ['telefono', 'fecha_nacimiento', 'sexo']) {
      if (Object.prototype.hasOwnProperty.call(input, key)) updated[key] = input[key];
    }
    await client.query('UPDATE qc_demo_paciente SET perfil=$2 WHERE id=$1', [patientId, updated]);
    return updated;
  });
}

export async function createLinkCode(db: Database, patientId: string) {
  return transaction(db, async (client) => {
    await client.query('SELECT id FROM qc_demo_paciente WHERE id=$1 FOR UPDATE', [patientId]);
    const row = await one<{ vence_en: Date }>(
      client,
      'SELECT vence_en FROM qc_demo_vinculacion WHERE paciente_id=$1',
      [patientId],
    );
    if (row && row.vence_en.getTime() > Date.now())
      throw new ApiError(409, 'CONFLICTO_ESTADO', 'Ya existe un código vigente.');
    const code = randomBytes(6).toString('base64url').toUpperCase();
    const expires = new Date(Date.now() + 86400000);
    await client.query(
      `INSERT INTO qc_demo_vinculacion(paciente_id,codigo,vence_en) VALUES($1,$2,$3)
      ON CONFLICT(paciente_id) DO UPDATE SET codigo=excluded.codigo,vence_en=excluded.vence_en`,
      [patientId, code, expires],
    );
    return {
      codigo: code,
      fecha_expiracion: expires.toISOString(),
      mensaje: 'Código sintético para demostración.',
    };
  });
}

export function formForScenario(state: ScenarioState, formIds: string[]): string {
  return formIds[
    state.escenario === 'EDICION_CONDICIONAL'
      ? 1
      : state.escenario === 'EXCLUSIVIDAD_ACTIVA'
        ? 2
        : 0
  ]!;
}
