import { randomUUID } from 'node:crypto';
import type { Database, SqlClient } from './db.js';
import { one, transaction } from './db.js';
import { ApiError } from './errors.js';
import { EDUCATION_ID } from './seed-data.js';
import { SCENARIOS } from './types.js';
import type { Principal, Scenario, ScenarioState } from './types.js';

export async function scenarioFor(
  client: SqlClient,
  patientId: string,
  lock = false,
): Promise<ScenarioState> {
  let state = await one<ScenarioState>(
    client,
    `SELECT * FROM qc_demo_escenario WHERE paciente_id=$1${lock ? ' FOR UPDATE' : ''}`,
    [patientId],
  );
  if (!state) {
    const epoch = randomUUID();
    state = await one<ScenarioState>(
      client,
      `INSERT INTO qc_demo_escenario (paciente_id, escenario, aplicado_en, generation, session_epoch, ack_signos_usado, ack_epro_usado)
       VALUES ($1, 'NORMAL', now(), $2, $2, false, false)
       ON CONFLICT (paciente_id) DO UPDATE SET escenario=excluded.escenario
       RETURNING *`,
      [patientId, epoch],
    );
  }
  if (!state) throw new ApiError(503, 'HTTP_503', 'Dataset sintético no preparado.');
  return state;
}

export async function applyScenario(
  db: Database,
  patientId: string,
  scenario: Scenario,
): Promise<ScenarioState> {
  if (!SCENARIOS.includes(scenario))
    throw new ApiError(422, 'ERROR_VALIDACION', 'Escenario desconocido.');
  return transaction(db, async (client) => {
    const result = await client.query<ScenarioState>(
      `UPDATE qc_demo_escenario SET escenario=$2, aplicado_en=now(), generation=$3,
       session_epoch=CASE WHEN $2='SESION_EXPIRADA' THEN $4 ELSE session_epoch END,
       ack_signos_usado=false,ack_epro_usado=false WHERE paciente_id=$1 RETURNING *`,
      [patientId, scenario, randomUUID(), randomUUID()],
    );
    const state = result.rows[0];
    if (!state) throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Paciente sintético inexistente.');
    if (scenario === 'EDUCACION_RETIRADA') {
      await client.query('UPDATE contenido_educativo SET activo=false WHERE id=$1', [EDUCATION_ID]);
    }
    return state;
  });
}

export async function guardScenario(
  db: Database,
  principal: Principal,
  allowPending = false,
): Promise<ScenarioState> {
  let state: ScenarioState;
  try {
    let actor = await one<{
      perfil: Record<string, unknown>;
      auth_issuer?: string;
      auth_subject?: string;
      estado_cuenta?: string;
      nombre_origen?: string;
    }>(
      db,
      'SELECT perfil,auth_issuer,auth_subject,estado_cuenta,nombre_origen FROM qc_demo_paciente WHERE id=$1',
      [principal.id],
    );
    if (!actor && principal.tipo === 'external') {
      if (!principal.email) {
        throw new ApiError(
          403,
          'ACCESO_DENEGADO',
          'Falta correo electrónico verificado de Google.',
        );
      }
      const invitation = await one<{ activo: boolean; nombre: string }>(
        db,
        'SELECT activo, nombre FROM qc_demo_invitacion_paciente WHERE lower(email)=lower($1)',
        [principal.email],
      );
      if (!invitation || !invitation.activo) {
        throw new ApiError(
          403,
          'ACCESO_DENEGADO',
          'Cuenta no autorizada en la lista de evaluación universitaria.',
        );
      }
      const initialProfile = {
        id: principal.id,
        email: principal.email,
        nombre: principal.displayName || invitation.nombre || 'Paciente Universitario',
        rut: null,
        rol: 'paciente',
        activo: true,
        estado_incorporacion: 'PENDIENTE_DATOS',
        foto_url: null,
        telefono: null,
        fecha_nacimiento: null,
        sexo: null,
        especialidad: null,
      };
      await db.query(
        `INSERT INTO qc_demo_paciente (id, auth_subject, email, perfil, perfil_clinico, tratamiento, estado_cuenta, auth_issuer, nombre_origen)
         VALUES ($1::uuid, $1::text, $2, $3, null, null, 'activo', $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [
          principal.id,
          principal.email,
          initialProfile,
          principal.issuer,
          principal.displayName ? 'google' : 'invitacion',
        ],
      );
      actor = { perfil: initialProfile };
    }
    if (
      actor &&
      principal.tipo === 'external' &&
      ((actor.auth_issuer !== undefined && actor.auth_issuer !== principal.issuer) ||
        (actor.auth_subject !== undefined && actor.auth_subject !== principal.id) ||
        (actor.estado_cuenta !== undefined && actor.estado_cuenta !== 'activo'))
    )
      throw new ApiError(403, 'ACCESO_DENEGADO', 'Identidad o cuenta no autorizada.');
    if (
      actor &&
      principal.tipo === 'external' &&
      principal.displayName &&
      ['google', 'invitacion'].includes(actor.nombre_origen ?? '')
    ) {
      await db.query(
        "UPDATE qc_demo_paciente SET perfil=jsonb_set(perfil,'{nombre}',to_jsonb($2::text)),nombre_origen='google' WHERE id=$1",
        [principal.id, principal.displayName],
      );
      actor.perfil.nombre = principal.displayName;
    }
    if (!actor) throw new ApiError(401, 'HTTP_401', 'Usuario sintético no registrado.');
    if (
      actor.perfil.rol !== 'paciente' ||
      actor.perfil.activo !== true ||
      (!allowPending && actor.perfil.estado_incorporacion !== 'COMPLETO')
    ) {
      throw new ApiError(403, 'HTTP_403', 'La cuenta no está autorizada para esta operación.');
    }
    state = await scenarioFor(db, principal.id);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'HTTP_503', 'Autorización temporalmente no disponible.');
  }
  if (principal.tipo !== 'external' && principal.generation !== state.session_epoch) {
    throw new ApiError(401, 'HTTP_401', 'La sesión sintética requiere renovación.');
  }
  if (state.escenario === 'AUTORIZACION_DENEGADA')
    throw new ApiError(403, 'ACCESO_DENEGADO', 'Acceso no autorizado.');
  if (state.escenario === 'SERVICIO_NO_DISPONIBLE')
    throw new ApiError(503, 'HTTP_503', 'Servicio sintético temporalmente no disponible.');
  return state;
}

export async function consumeLostAck(
  client: SqlClient,
  state: ScenarioState,
  type: 'signos' | 'epro',
): Promise<boolean> {
  const expected = type === 'signos' ? 'ACK_SIGNOS_PERDIDO' : 'ACK_EPRO_PERDIDO';
  if (state.escenario !== expected) return false;
  const column = type === 'signos' ? 'ack_signos_usado' : 'ack_epro_usado';
  if (state[column]) return false;
  await client.query(`UPDATE qc_demo_escenario SET ${column}=true WHERE paciente_id=$1`, [
    state.paciente_id,
  ]);
  return true;
}
