import type { SqlClient } from './db.js';
import { one, transaction } from './db.js';
import type { Database } from './db.js';
import { ApiError } from './errors.js';
import { SCENARIOS } from './types.js';
import type { Principal, Scenario, ScenarioState } from './types.js';
import { randomUUID } from 'node:crypto';
import { EDUCATION_ID } from './seed-data.js';

export async function scenarioFor(
  client: SqlClient,
  patientId: string,
  lock = false,
): Promise<ScenarioState> {
  const state = await one<ScenarioState>(
    client,
    `SELECT * FROM qc_demo_escenario WHERE paciente_id=$1${lock ? ' FOR UPDATE' : ''}`,
    [patientId],
  );
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
      // Educational publication is global, not a clinical record of another patient.
      // Persist the withdrawal in the real origin so CDC observes the same removal as REST.
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
    const actor = await one<{ perfil: Record<string, unknown> }>(
      db,
      'SELECT perfil FROM qc_demo_paciente WHERE id=$1',
      [principal.id],
    );
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
  if (principal.generation !== state.session_epoch) {
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
  const result = await client.query(
    `UPDATE qc_demo_escenario SET ${column}=true WHERE paciente_id=$1 AND generation=$2 AND ${column}=false RETURNING paciente_id`,
    [state.paciente_id, state.generation],
  );
  return result.rowCount === 1;
}
