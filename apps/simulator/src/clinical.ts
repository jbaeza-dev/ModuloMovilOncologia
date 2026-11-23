import { assignClinicalContext } from './preparation.js';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Database, SqlClient } from './db.js';
import { one, transaction } from './db.js';
import { ApiError, invalid, record } from './errors.js';
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
  'version_dolor',
  'dolor_ena',
] as const;

export function normalizedSigns(input: SignsInput): SignsInput {
  checkCaptureDate(input.fecha_registro);
  if (input.version_dolor !== undefined || input.dolor_ena !== undefined) {
    if (
      input.version_dolor !== 1 ||
      !Number.isInteger(input.dolor_ena) ||
      Number(input.dolor_ena) < 0 ||
      Number(input.dolor_ena) > 10
    )
      invalid('La ampliación ENA exige versión 1 y dolor entero de 0 a 10.');
    if (
      typeof input.temperatura === 'number' &&
      Math.abs(input.temperatura * 10 - Math.round(input.temperatura * 10)) > 1e-7
    )
      invalid('La captura nueva de temperatura admite como máximo un decimal sin redondeo.');
  }
  if (
    input.presion_arterial_sistolica != null &&
    input.presion_arterial_diastolica != null &&
    input.presion_arterial_sistolica <= input.presion_arterial_diastolica
  )
    invalid('La presión sistólica debe superar la diastólica.');
  return {
    ...(input.version_dolor === 1 ? { version_dolor: 1 as const, dolor_ena: input.dolor_ena } : {}),
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
    const linked = await one(
      client,
      "SELECT id FROM qc_demo_relacion_clinica WHERE paciente_id=$1 AND estado='activa'",
      [patientId],
    );
    if (linked) throw new ApiError(409, 'CONFLICTO_ESTADO', 'El paciente ya esta vinculado.');
    const row = await one<{ codigo: string; vence_en: Date; consumido: boolean }>(
      client,
      'SELECT codigo, vence_en, consumido FROM qc_demo_vinculacion WHERE paciente_id=$1',
      [patientId],
    );
    if (row && !row.consumido && row.vence_en.getTime() > Date.now())
      throw new ApiError(409, 'CONFLICTO_ESTADO', 'Ya existe un codigo vigente.');

    // Código alfanumérico limpio de 8 caracteres
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
    const expires = new Date(Date.now() + 86400000);
    await client.query(
      `INSERT INTO qc_demo_vinculacion(paciente_id,codigo,vence_en,consumido,consumido_en,consumido_por,request_token)
       VALUES($1,$2,$3,false,null,null,null)
       ON CONFLICT(paciente_id) DO UPDATE SET codigo=excluded.codigo,vence_en=excluded.vence_en,consumido=false,consumido_en=null,consumido_por=null,request_token=null`,
      [patientId, code, expires],
    );
    return {
      codigo: code,
      fecha_expiracion: expires.toISOString(),
      mensaje: 'Código sintético para demostración.',
    };
  });
}

export async function consumeLinkCode(
  db: Database,
  operatorId: string,
  code: string,
  templateId: string,
  requestToken?: string,
  expectedIssuer?: string,
) {
  const normalizedCode = code.trim().toUpperCase();
  if (
    !/^[A-Z0-9]{8}$/.test(normalizedCode) ||
    (requestToken !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestToken))
  )
    throw new ApiError(422, 'ERROR_VALIDACION', 'Codigo o identificador de operacion invalido.');
  const codeHash = createHash('sha256').update(normalizedCode).digest('hex');

  return transaction(db, async (client) => {
    // 1. Verificar operador autorizado. `operatorId` es el id del operador (no su usuario de
    // Supabase): los operadores dados de alta por correo tienen un id distinto de su auth_subject.
    const operator = await one<{ id: string; nombre: string }>(
      client,
      'SELECT id, nombre FROM qc_demo_operador WHERE id=$1 AND activo=true AND ($2::text IS NULL OR auth_issuer=$2)',
      [operatorId, expectedIssuer ?? null],
    );
    if (!operator)
      throw new ApiError(403, 'ACCESO_DENEGADO', 'Operador no autorizado en el sistema.');

    // 2. Buscar código con bloqueo de fila
    const row = await one<{
      paciente_id: string;
      consumido: boolean;
      consumido_por: string | null;
      vence_en: Date;
      request_token: string | null;
    }>(
      client,
      'SELECT paciente_id, consumido, consumido_por, vence_en, request_token FROM qc_demo_vinculacion WHERE codigo=$1 FOR UPDATE',
      [normalizedCode],
    );
    if (!row)
      throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Código de vinculación inexistente.');

    // 3. Manejo de reintento idempotente (caso de ACK perdido)
    if (row.consumido) {
      if (row.consumido_por === operatorId && requestToken && row.request_token === requestToken) {
        const existingRel = await one<{ id: string }>(
          client,
          'SELECT id FROM qc_demo_relacion_clinica WHERE paciente_id=$1 AND operador_id=$2 AND plantilla_id=$3',
          [row.paciente_id, operatorId, templateId],
        );
        if (!existingRel)
          throw new ApiError(409, 'CONFLICTO_ESTADO', 'La operacion tiene otra plantilla.');
        return {
          status: 200,
          body: {
            ok: true,
            relacion_id: existingRel?.id,
            paciente_id: row.paciente_id,
            reintento_idempotente: true,
            mensaje: 'Vinculación confirmada previamente.',
          },
        };
      }
      throw new ApiError(409, 'CONFLICTO_ESTADO', 'El código de vinculación ya ha sido consumido.');
    }

    if (row.vence_en.getTime() <= Date.now()) {
      throw new ApiError(410, 'RECURSO_NO_DISPONIBLE', 'El código de vinculación ha expirado.');
    }

    // 4. Buscar plantilla clínica sintética aprobada
    const template = await one<{
      perfil_clinico_template: ObjectValue;
      tratamiento_template: ObjectValue;
    }>(
      client,
      'SELECT perfil_clinico_template, tratamiento_template FROM qc_demo_plantilla_sintetica WHERE id=$1 AND activo=true',
      [templateId],
    );
    if (!template) {
      throw new ApiError(
        404,
        'RECURSO_NO_ENCONTRADO',
        'Plantilla clínica sintética no encontrada.',
      );
    }

    const actor = await one<{ perfil: ObjectValue }>(
      client,
      'SELECT perfil FROM qc_demo_paciente WHERE id=$1 FOR UPDATE',
      [row.paciente_id],
    );
    if (actor?.perfil.estado_incorporacion !== 'COMPLETO')
      throw new ApiError(409, 'INCORPORACION_PENDIENTE', 'Complete el perfil antes de vincular.');
    await requireConsent(client, row.paciente_id, await scenarioFor(client, row.paciente_id));
    if (
      await one(
        client,
        "SELECT id FROM qc_demo_relacion_clinica WHERE paciente_id=$1 AND estado='activa'",
        [row.paciente_id],
      )
    )
      throw new ApiError(409, 'CONFLICTO_ESTADO', 'El paciente ya está vinculado.');
    const now = new Date();
    await client.query(
      `INSERT INTO qc_demo_profesional(operador_id,nombre,especialidad)
       VALUES($1,'Dra. Camila Rojas — demostración','Oncología médica (perfil ficticio)')
       ON CONFLICT DO NOTHING`,
      [operatorId],
    );
    const professional = await one(
      client,
      'SELECT operador_id FROM qc_demo_profesional WHERE operador_id=$1 AND activo=true',
      [operatorId],
    );
    if (!professional)
      throw new ApiError(
        409,
        'PROFESIONAL_INACTIVO',
        'Active su perfil profesional antes de vincular pacientes.',
      );
    const profile: ObjectValue = {
      ...template.perfil_clinico_template,
      id: randomUUID(),
      paciente_id: row.paciente_id,
    };
    if (Array.isArray(profile.medicamentos))
      profile.medicamentos = profile.medicamentos.map((raw) => ({
        ...record(raw),
        id: randomUUID(),
      }));
    await assignClinicalContext(client, row.paciente_id, {
      perfil_clinico: profile,
      tratamiento: {
        ...template.tratamiento_template,
        id: randomUUID(),
        paciente_id: row.paciente_id,
        fecha_inicio: now.toISOString(),
      },
    });

    // 6. Registrar relación clínica activa
    const rel = await one<{ id: string }>(
      client,
      `INSERT INTO qc_demo_relacion_clinica (paciente_id, operador_id, plantilla_id, estado, vinculado_en)
       VALUES ($1, $2, $3, 'activa', $4)
       ON CONFLICT (paciente_id) DO UPDATE SET operador_id=excluded.operador_id, plantilla_id=excluded.plantilla_id, estado='activa', profesional_activo=true, vinculado_en=excluded.vinculado_en, desvinculado_en=NULL
       RETURNING id`,
      [row.paciente_id, operatorId, templateId, now],
    );

    // 7. Marcar código consumido
    await client.query(
      'UPDATE qc_demo_vinculacion SET consumido=true, consumido_en=$2, consumido_por=$3, request_token=$4 WHERE paciente_id=$1',
      [row.paciente_id, now, operatorId, requestToken ?? null],
    );

    // 8. Auditoría con hash criptográfico del código
    await client.query(
      `INSERT INTO qc_demo_auditoria_vinculacion (operador_id, paciente_id, relacion_id, codigo_sha256, plantilla_id, fecha)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [operatorId, row.paciente_id, rel!.id, codeHash, templateId, now],
    );

    return {
      status: 200,
      body: {
        ok: true,
        relacion_id: rel!.id,
        paciente_id: row.paciente_id,
        mensaje: 'Paciente vinculado y tratamiento sintético asignado exitosamente.',
      },
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
