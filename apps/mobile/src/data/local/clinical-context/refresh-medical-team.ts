import type { HttpSessionAdapter } from '../../../services/session/http-session-adapter';
import { isUuid } from '../../../services/session/response-checks';
import type { SqlConnection } from '../core/sql';
import { ingestClinicalContextInTransaction } from './clinical-context-ingestion';

/** Extensión del simulador; conserva los DTO del contrato externo. */
export async function refreshMedicalTeam(
  session: HttpSessionAdapter,
  db: SqlConnection,
  owner: string,
  patientId: string,
) {
  const response = await session.request('clinical', '/api/v1/pacientes/me/equipo-tratante-demo');
  if (response.status === 404) return; // Servidor externo sin esta extensión.
  const body = response.body as { paciente_id?: string; items?: Array<Record<string, unknown>> };
  if (response.status !== 200 || body?.paciente_id !== owner || !Array.isArray(body.items))
    throw new Error('Equipo no disponible');
  const items = body.items.map((item) => {
    if (
      !isUuid(item.id) ||
      !isUuid(item.profesional_id) ||
      item.paciente_id !== owner ||
      typeof item.nombre !== 'string' ||
      typeof item.especialidad !== 'string' ||
      typeof item.vinculado_en !== 'string' ||
      !Number.isFinite(Date.parse(item.vinculado_en))
    )
      throw new Error('Equipo inválido');
    return {
      id: item.id as string,
      professionalId: item.profesional_id as string,
      name: item.nombre,
      specialty: item.especialidad,
      since: item.vinculado_en,
    };
  });
  await db.transaction(async (tx) => {
    if (session.getCurrentUser()?.id !== owner) throw new Error('Sesión modificada');
    await tx.run(
      "UPDATE paciente_clinico_cache SET estado_conocido='inactivo' WHERE paciente_id=?",
      [patientId],
    );
    await ingestClinicalContextInTransaction(tx, {
      profesionales: items.map((p) => ({
        id: p.professionalId,
        nombre: p.name,
        especialidad: p.specialty,
      })),
      vinculos: items.map((p) => ({
        id: p.id,
        pacienteId: patientId,
        profesionalId: p.professionalId,
        estadoConocido: 'activo',
        fechaVinculacion: p.since,
      })),
    });
    if (session.getCurrentUser()?.id !== owner) throw new Error('Sesión modificada');
  });
}
